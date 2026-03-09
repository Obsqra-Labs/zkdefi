"""
AgentRunner — orchestrates a fleet of independent market-making agents.

Each agent gets its own WalletManager + SwapBot (+ optional LPBot/LimitOrderBot).
All agents run concurrently, each with its own asyncio task and staggered start.

Key design choices:
  - Agents with the SAME wallet address share a single WalletManager (nonce lock)
    but get independent SwapBot instances with different pair assignments.
  - Agents with DIFFERENT wallet addresses are fully independent.
  - The fleet coordinator periodically re-balances pair assignments based on
    deficit progress toward daily volume targets.
"""
from __future__ import annotations

import asyncio
import contextlib
import copy
import logging
import os
import random
import time
from dataclasses import dataclass, field, asdict
from typing import Any

from bots.chain_reader import PoolKey, build_default_pools, get_pool_price
from bots.swap_bot import SwapBot, SwapResult
from bots.lp_bot import LPBot
from bots.limit_order_bot import LimitOrderBot
from bots.wallet_manager import WalletManager, GasBudgetExhausted
from config.agents import AgentProfile

logger = logging.getLogger(__name__)

MAX_TICK = 88_722_883


@dataclass
class AgentStats:
    """Accumulated statistics for a single fleet agent."""
    agent_id: int = 0
    agent_name: str = ""
    enabled: bool = False
    assigned_pairs: list[str] = field(default_factory=list)
    total_swaps: int = 0
    successful_swaps: int = 0
    failed_swaps: int = 0
    total_volume_wei: int = 0
    lp_positions_created: int = 0
    limit_orders_placed: int = 0
    behavior_counts: dict[str, int] = field(default_factory=lambda: {
        "degen": 0, "retail": 0, "whale": 0,
    })
    pool_usage: dict[str, int] = field(default_factory=dict)
    last_swap_ts: float = 0.0
    last_swap_pair: str = ""
    last_swap_tx: str = ""
    last_error: str = ""
    uptime_sec: float = 0.0
    started_at: float = 0.0

    @property
    def success_rate(self) -> float:
        if self.total_swaps == 0:
            return 0.0
        return round(self.successful_swaps / self.total_swaps * 100, 1)


class FleetAgent:
    """
    A single agent within the fleet — wraps its own bot instances and
    runs an independent swap loop.
    """

    def __init__(
        self,
        profile: AgentProfile,
        wallet: WalletManager,
        pools: list[PoolKey],
        rpc_url: str,
    ) -> None:
        self.profile = profile
        self.wallet = wallet
        self.rpc_url = rpc_url

        # Filter pools to assigned pairs (empty = all)
        if profile.assigned_pairs:
            assigned_lower = {p.lower() for p in profile.assigned_pairs}
            self.pools = [p for p in pools if p.name.lower() in assigned_lower]
            if not self.pools:
                # Fallback to all pools if assignment doesn't match
                self.pools = list(pools)
                logger.warning(
                    "Agent %d (%s): no matching pools for %s, using all %d pools",
                    profile.agent_id, profile.name, profile.assigned_pairs, len(pools),
                )
        else:
            self.pools = list(pools)

        self.swap_bot = SwapBot(
            wallet=wallet,
            pools=self.pools,
            interval_sec=profile.swap_interval_sec,
            min_amount=profile.swap_min_amount,
            max_amount=profile.swap_max_amount,
        )

        self.lp_bot: LPBot | None = None
        if profile.lp_enabled:
            self.lp_bot = LPBot(
                wallet=wallet,
                pools=self.pools,
                interval_sec=profile.lp_interval_sec,
                amount0=profile.lp_amount0,
                amount1=profile.lp_amount1,
            )

        self.limit_bot: LimitOrderBot | None = None
        if profile.limit_enabled:
            self.limit_bot = LimitOrderBot(
                wallet=wallet,
                pools=self.pools,
                interval_sec=profile.limit_interval_sec,
                amount=profile.limit_amount,
            )

        self.stats = AgentStats(
            agent_id=profile.agent_id,
            agent_name=profile.name,
            assigned_pairs=[p.name for p in self.pools],
        )
        self._swap_attempts_per_cycle = max(1, int(os.getenv("AGENT_SWAP_ATTEMPTS_PER_CYCLE", "3")))
        self._burst_chance_retail = min(
            1.0,
            max(0.0, float(os.getenv("AGENT_BURST_CHANCE_RETAIL", "0.10"))),
        )
        self._burst_chance_aggressive = min(
            1.0,
            max(0.0, float(os.getenv("AGENT_BURST_CHANCE_AGGRESSIVE", "0.25"))),
        )
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._lp_task: asyncio.Task[None] | None = None
        self._limit_task: asyncio.Task[None] | None = None

    @property
    def enabled(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self.stats.enabled = True
        self.stats.started_at = time.time()

        # Stagger startup
        if self.profile.startup_delay_sec > 0:
            await asyncio.sleep(self.profile.startup_delay_sec)

        self._task = asyncio.create_task(self._swap_loop())
        if self.lp_bot:
            self._lp_task = asyncio.create_task(self._lp_loop())
        if self.limit_bot:
            self._limit_task = asyncio.create_task(self._limit_loop())

        logger.info(
            "Agent %d (%s) started: pairs=%s, interval=%.0fs",
            self.profile.agent_id, self.profile.name,
            [p.name for p in self.pools], self.profile.swap_interval_sec,
        )

    async def stop(self) -> None:
        self._running = False
        self.stats.enabled = False
        self.stats.uptime_sec = time.time() - self.stats.started_at if self.stats.started_at > 0 else 0.0
        for task in [self._task, self._lp_task, self._limit_task]:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        logger.info("Agent %d (%s) stopped", self.profile.agent_id, self.profile.name)

    def _sample_behavior(self) -> str:
        """Sample behaviour type using the agent's weight profile."""
        weights = self.profile.behavior_weights
        roll = random.random()
        cumulative = 0.0
        for behavior, weight in weights.items():
            cumulative += weight
            if roll < cumulative:
                return behavior
        return "retail"

    async def _swap_loop(self) -> None:
        """Main swap execution loop for this agent."""
        # Initial jitter
        await asyncio.sleep(random.uniform(1.0, 5.0))

        while self._running:
            behavior = self._sample_behavior()
            size_mult = {
                "degen": random.uniform(0.6, 1.5),
                "retail": random.uniform(1.2, 3.0),
                "whale": random.uniform(4.0, 12.0),
            }.get(behavior, 1.0)

            result: SwapResult | None = None
            skip_pools: set[str] = set()  # balance-aware skip list for this cycle
            for attempt in range(self._swap_attempts_per_cycle):
                try:
                    result = await self.swap_bot.execute_one(
                        size_multiplier=size_mult,
                        behavior=behavior,
                        allow_extreme_tick=True,
                        exclude_pools=skip_pools if skip_pools else None,
                    )
                    if result.success:
                        self.stats.successful_swaps += 1
                        self.stats.total_volume_wei += result.amount_in_wei
                        self.stats.last_swap_ts = time.time()
                        self.stats.last_swap_pair = result.pair
                        self.stats.last_swap_tx = result.tx_hash or ""
                        pair_key = result.pair
                        self.stats.pool_usage[pair_key] = self.stats.pool_usage.get(pair_key, 0) + 1
                        break
                    else:
                        self.stats.failed_swaps += 1
                        self.stats.last_error = result.error or ""
                        # On insufficient balance, skip this pool for the rest
                        # of this swap cycle so the next attempt picks a
                        # different (hopefully funded) pool.
                        if result.pair and "insufficient balance" in (result.error or "").lower():
                            skip_pools.add(result.pair)
                except GasBudgetExhausted as exc:
                    self.stats.last_error = str(exc)
                    logger.info(
                        "Agent %d: daily gas budget exhausted, sleeping 5 min",
                        self.profile.agent_id,
                    )
                    await asyncio.sleep(300)  # sleep 5 min, then re-check
                    break
                except Exception as exc:
                    self.stats.failed_swaps += 1
                    self.stats.last_error = str(exc)

            self.stats.total_swaps += 1
            self.stats.behavior_counts[behavior] = self.stats.behavior_counts.get(behavior, 0) + 1

            burst_chance = (
                self._burst_chance_aggressive
                if behavior != "retail"
                else self._burst_chance_retail
            )
            if self._running and random.random() < burst_chance:
                try:
                    burst_result = await self.swap_bot.execute_one(
                        size_multiplier=size_mult * random.uniform(0.7, 1.2),
                        behavior=behavior,
                        allow_extreme_tick=True,
                    )
                    if burst_result.success:
                        self.stats.successful_swaps += 1
                        self.stats.total_volume_wei += burst_result.amount_in_wei
                        pair_key = burst_result.pair
                        self.stats.pool_usage[pair_key] = self.stats.pool_usage.get(pair_key, 0) + 1
                    self.stats.total_swaps += 1
                except Exception:
                    pass

            # Interval with jitter
            jitter = random.uniform(0.7, 1.4)
            sleep_mult = {
                "degen": random.uniform(0.4, 0.8),
                "retail": random.uniform(0.8, 1.2),
                "whale": random.uniform(1.0, 2.0),
            }.get(behavior, 1.0)
            await asyncio.sleep(self.profile.swap_interval_sec * jitter * sleep_mult)

    async def _lp_loop(self) -> None:
        """LP management loop (only on LP-enabled agents)."""
        if not self.lp_bot:
            return
        await asyncio.sleep(random.uniform(5.0, 15.0))
        cycle = 0
        while self._running:
            try:
                if cycle % 3 == 0:
                    result = await self.lp_bot.create_position()
                    if result.success:
                        self.stats.lp_positions_created += 1
                else:
                    await self.lp_bot.collect_all_fees()
            except Exception as exc:
                logger.debug("Agent %d LP error: %s", self.profile.agent_id, exc)
            cycle += 1
            await asyncio.sleep(self.profile.lp_interval_sec * random.uniform(0.8, 1.3))

    async def _limit_loop(self) -> None:
        """Limit order loop (only on limit-enabled agents)."""
        if not self.limit_bot:
            return
        await asyncio.sleep(random.uniform(10.0, 25.0))
        while self._running:
            try:
                result = await self.limit_bot.place_order()
                if result.success:
                    self.stats.limit_orders_placed += 1
            except Exception as exc:
                logger.debug("Agent %d limit error: %s", self.profile.agent_id, exc)
            await asyncio.sleep(self.profile.limit_interval_sec * random.uniform(0.8, 1.3))

    def status(self) -> dict[str, Any]:
        """Return current agent status for dashboard."""
        self.stats.uptime_sec = time.time() - self.stats.started_at if self.stats.started_at > 0 else 0.0
        return {
            "agent_id": self.stats.agent_id,
            "name": self.stats.agent_name,
            "enabled": self._running,
            "wallet": self.wallet.address[:16] + "..." if self.wallet.address else "unconfigured",
            "assigned_pairs": self.stats.assigned_pairs,
            "total_swaps": self.stats.total_swaps,
            "successful_swaps": self.stats.successful_swaps,
            "failed_swaps": self.stats.failed_swaps,
            "success_rate": self.stats.success_rate,
            "total_volume_wei": self.stats.total_volume_wei,
            "pool_usage": dict(self.stats.pool_usage),
            "behavior_counts": dict(self.stats.behavior_counts),
            "lp_positions_created": self.stats.lp_positions_created,
            "limit_orders_placed": self.stats.limit_orders_placed,
            "last_swap_ts": self.stats.last_swap_ts,
            "last_swap_pair": self.stats.last_swap_pair,
            "last_swap_tx": self.stats.last_swap_tx,
            "last_error": self.stats.last_error,
            "uptime_sec": round(self.stats.uptime_sec, 1),
        }


class AgentFleetRunner:
    """
    Manages the entire fleet of agents.

    Provides start/stop/status for the whole fleet, per-agent control,
    and an aggregate volume tracker for volume target tracking.
    """

    def __init__(
        self,
        profiles: list[AgentProfile],
        pools: list[PoolKey] | None = None,
        rpc_url: str = "",
    ) -> None:
        self.rpc_url = rpc_url
        self.pools = pools or build_default_pools()
        self.profiles = profiles

        # Deduplicate wallets: agents sharing the same address share a WalletManager
        self._wallets: dict[str, WalletManager] = {}
        self.agents: list[FleetAgent] = []

        for profile in profiles:
            addr = profile.account_address.lower()
            if addr not in self._wallets:
                self._wallets[addr] = WalletManager(
                    rpc_url=rpc_url,
                    account_address=profile.account_address,
                    private_key=profile.private_key,
                )
            wallet = self._wallets[addr]

            self.agents.append(FleetAgent(
                profile=profile,
                wallet=wallet,
                pools=self.pools,
                rpc_url=rpc_url,
            ))

        self._running = False
        self._started_at = 0.0
        logger.info(
            "Fleet initialized: %d agents, %d unique wallets, %d pools",
            len(self.agents), len(self._wallets), len(self.pools),
        )

    async def start_all(self) -> list[str]:
        """Start all agents. Returns list of started agent names."""
        self._running = True
        self._started_at = time.time()
        started = []
        for agent in self.agents:
            try:
                await agent.start()
                started.append(agent.profile.name)
            except Exception as exc:
                logger.error(
                    "Agent %d (%s) failed to start: %s",
                    agent.profile.agent_id, agent.profile.name, exc,
                )
        return started

    async def stop_all(self) -> None:
        """Stop all agents."""
        self._running = False
        for agent in self.agents:
            try:
                await agent.stop()
            except Exception as exc:
                logger.error("Agent %d stop error: %s", agent.profile.agent_id, exc)

    async def start_agent(self, agent_id: int) -> dict[str, Any]:
        """Start a specific agent by ID."""
        agent = self._get_agent(agent_id)
        if agent is None:
            return {"ok": False, "error": f"Agent {agent_id} not found"}
        await agent.start()
        return {"ok": True, "agent": agent.profile.name, "status": "started"}

    async def stop_agent(self, agent_id: int) -> dict[str, Any]:
        """Stop a specific agent by ID."""
        agent = self._get_agent(agent_id)
        if agent is None:
            return {"ok": False, "error": f"Agent {agent_id} not found"}
        await agent.stop()
        return {"ok": True, "agent": agent.profile.name, "status": "stopped"}

    def _get_agent(self, agent_id: int) -> FleetAgent | None:
        for agent in self.agents:
            if agent.profile.agent_id == agent_id:
                return agent
        return None

    def fleet_status(self) -> dict[str, Any]:
        """Aggregate status across all agents."""
        agent_statuses = [agent.status() for agent in self.agents]
        active_count = sum(1 for a in agent_statuses if a["enabled"])
        total_swaps = sum(a["total_swaps"] for a in agent_statuses)
        total_successful = sum(a["successful_swaps"] for a in agent_statuses)
        total_volume_wei = sum(a["total_volume_wei"] for a in agent_statuses)

        # Aggregate pool usage across all agents
        aggregate_pool_usage: dict[str, int] = {}
        for a in agent_statuses:
            for pair, count in a.get("pool_usage", {}).items():
                aggregate_pool_usage[pair] = aggregate_pool_usage.get(pair, 0) + count

        # Aggregate behaviour mix
        aggregate_behavior: dict[str, int] = {}
        for a in agent_statuses:
            for behavior, count in a.get("behavior_counts", {}).items():
                aggregate_behavior[behavior] = aggregate_behavior.get(behavior, 0) + count

        # Per-pair volume estimation (heuristic: wei → USD overlay)
        pair_volume_usd: dict[str, float] = {}
        for a in agent_statuses:
            agent_vol = a.get("total_volume_wei", 0)
            usage = a.get("pool_usage", {})
            total_usage = sum(usage.values()) or 1
            for pair, count in usage.items():
                share = count / total_usage
                # 1e14 wei ≈ 1 USD-equivalent (same heuristic as onchain_engine)
                pair_volume_usd[pair] = pair_volume_usd.get(pair, 0.0) + (agent_vol * share / 1e14)

        return {
            "fleet_running": self._running,
            "total_agents": len(self.agents),
            "active_agents": active_count,
            "unique_wallets": len(self._wallets),
            "total_swaps": total_swaps,
            "total_successful": total_successful,
            "overall_success_rate": round(
                (total_successful / total_swaps * 100) if total_swaps > 0 else 0, 1
            ),
            "total_volume_wei": total_volume_wei,
            "aggregate_pool_usage": aggregate_pool_usage,
            "aggregate_behavior": aggregate_behavior,
            "pair_volume_usd": {k: round(v, 2) for k, v in pair_volume_usd.items()},
            "uptime_sec": round(time.time() - self._started_at, 1) if self._started_at > 0 else 0.0,
            "gas_budget": self._get_gas_budget(),
            "agents": agent_statuses,
        }

    def _get_gas_budget(self) -> dict[str, Any]:
        """Return aggregate gas budget status from all unique wallets."""
        for wallet in self._wallets.values():
            return wallet.gas_budget_status
        return {}

    def agent_volume_overlay(self) -> dict[str, float]:
        """
        Return per-pair volume overlay in USD-equivalent from all fleet agents.
        Used by OnChainEngine to merge fleet volume into the pool display.
        """
        overlay: dict[str, float] = {}
        for agent in self.agents:
            if not agent.enabled:
                continue
            swap_status = agent.swap_bot.status()
            agent_vol_wei = int(swap_status.get("total_volume_wei", 0) or 0)
            pool_usage = swap_status.get("pool_usage", {}) or {}
            total_usage = sum(int(v or 0) for v in pool_usage.values()) or 1

            for pair, count in pool_usage.items():
                count_int = int(count or 0)
                if count_int <= 0:
                    continue
                share = count_int / total_usage
                usd_equiv = (agent_vol_wei * share) / 1e14
                overlay[pair] = overlay.get(pair, 0.0) + usd_equiv

        return overlay

    def agent_pool_usage(self) -> dict[str, int]:
        """Aggregate pool usage (swap counts) across all fleet agents."""
        usage: dict[str, int] = {}
        for agent in self.agents:
            if not agent.enabled:
                continue
            swap_status = agent.swap_bot.status()
            for pair, count in (swap_status.get("pool_usage", {}) or {}).items():
                usage[pair] = usage.get(pair, 0) + int(count or 0)
        return usage
