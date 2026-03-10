"""
On-chain market engine — orchestrates real bots that execute on Ekubo.

Polls Ekubo pool prices via Starknet RPC every N seconds for display,
AND manages real-activity bots (swap, LP, limit orders) that generate
actual on-chain volume and fees → real APY.
"""
from __future__ import annotations

import asyncio
import contextlib
import copy
import logging
import os
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Deque

from bots.chain_reader import (
    ChainSnapshot,
    PoolKey,
    build_default_pools,
    read_chain_snapshot,
    snapshot_to_dict,
)
from bots.wallet_manager import WalletManager
from bots.swap_bot import SwapBot
from bots.lp_bot import LPBot
from bots.limit_order_bot import LimitOrderBot
from bots.apy_tracker import APYTracker

logger = logging.getLogger(__name__)

MAX_TICK = 88_722_883


@dataclass
class Event:
    ts: float
    category: str
    message: str
    payload: dict[str, Any] = field(default_factory=dict)


class OnChainEngine:
    """
    Reads real Ekubo pool state AND orchestrates activity bots.

    Three bot types execute real on-chain transactions:
      - SwapBot:        Random swaps → volume + swap fees
      - LPBot:          LP position creation/management → LP fees
      - LimitOrderBot:  Limit orders → order-fill fees

    APYTracker reads cumulative fees from positions and computes real yield.
    """

    def __init__(
        self,
        poll_interval_sec: float = 10.0,
        rpc_url: str | None = None,
        pools: list[PoolKey] | None = None,
        wallet: WalletManager | None = None,
        # Bot config
        swap_interval_sec: float = 60.0,
        swap_min_amount: float = 0.001,
        swap_max_amount: float = 0.01,
        swap_enabled_on_start: bool = True,
        lp_interval_sec: float = 300.0,
        lp_amount0: float = 0.005,
        lp_amount1: float = 0.005,
        lp_tick_width: int = 20000,
        lp_max_positions_per_pool: int = 10,
        lp_rebalance_enabled: bool = True,
        lp_stale_threshold_pct: float = 50.0,
        lp_enabled_on_start: bool = True,
        limit_interval_sec: float = 180.0,
        limit_amount: float = 0.002,
        limit_enabled_on_start: bool = True,
        coordination_enabled: bool = True,
        coordination_cycle_sec: float = 180.0,
        coordination_min_active_lp_per_pair: int = 1,
        coordination_max_actions_per_cycle: int = 4,
        coordination_auto_close_stale: bool = True,
        coordination_auto_recenter: bool = True,
        coordination_limit_support_enabled: bool = True,
        coordination_target_pairs: list[str] | None = None,
        coordination_volume_ramp_enabled: bool = True,
        coordination_max_swap_actions_per_cycle: int = 3,
        coordination_coverage_boost_enabled: bool = True,
        coordination_min_pool_coverage_ratio: float = 0.8,
        coordination_max_coverage_swap_actions_per_cycle: int = 2,
        coordination_min_swap_size_multiplier: float = 1.0,
        coordination_max_swap_size_multiplier: float = 6.0,
        coordination_primary_volume_pairs: list[str] | None = None,
        coordination_volume_targets_usd: dict[str, float] | None = None,
    ) -> None:
        self.poll_interval_sec = poll_interval_sec
        self.rpc_url = rpc_url
        self.pools = pools or build_default_pools()
        self.wallet = wallet

        # Chain state
        self._snapshot: ChainSnapshot | None = None
        self._snapshot_dict: dict[str, Any] = {}
        self.events: Deque[Event] = deque(maxlen=2500)
        self._lock = asyncio.Lock()
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._poll_count = 0
        self._last_prices: dict[str, float] = {}
        self._last_swap_total_volume_wei: int = 0
        self._last_pool_usage: dict[str, int] = {}
        self._bot_volume_overlay_usd: dict[str, float] = {}
        self._last_bot_tx_hash: dict[str, str] = {}
        self._last_bot_event_ts: dict[str, float] = {}
        self._boundary_recovery_last_ts: dict[str, float] = {}
        self._boundary_recovery_cooldown_sec = float(os.getenv("MM_SIM_BOUNDARY_RECOVERY_COOLDOWN_SEC", "240"))
        self._bot_startup_flags: dict[str, bool] = {
            "swap": bool(swap_enabled_on_start),
            "lp": bool(lp_enabled_on_start),
            "limit": bool(limit_enabled_on_start),
        }

        # Fleet runner (attached after construction by api/main.py startup)
        self.fleet: Any = None

        # Real activity bots (only created if wallet is configured)
        self.swap_bot: SwapBot | None = None
        self.lp_bot: LPBot | None = None
        self.limit_bot: LimitOrderBot | None = None
        self.apy_tracker: APYTracker | None = None

        if self.wallet and self.wallet.configured:
            self.swap_bot = SwapBot(
                wallet=self.wallet,
                pools=self.pools,
                interval_sec=swap_interval_sec,
                min_amount=swap_min_amount,
                max_amount=swap_max_amount,
            )
            self.lp_bot = LPBot(
                wallet=self.wallet,
                pools=self.pools,
                interval_sec=lp_interval_sec,
                amount0=lp_amount0,
                amount1=lp_amount1,
                tick_width=lp_tick_width,
                max_positions_per_pool=lp_max_positions_per_pool,
                rebalance_enabled=lp_rebalance_enabled,
                stale_threshold_pct=lp_stale_threshold_pct,
            )
            self.limit_bot = LimitOrderBot(
                wallet=self.wallet,
                pools=self.pools,
                interval_sec=limit_interval_sec,
                amount=limit_amount,
            )
            self.apy_tracker = APYTracker(rpc_url=self.rpc_url or "")
            logger.info("Bots initialized with wallet %s", self.wallet.address[:16])
        else:
            logger.warning("No bot wallet configured — bots will be read-only (no real activity)")

        # Scenario overrides (admin tools — applied to display only)
        self._pair_overrides: dict[str, dict[str, float]] = {}
        self._scenario_kind: str | None = None
        self._scenario_ticks_remaining: int = 0
        self._scenario_severity: float = 0.0

        # Fee utilization policy (hook for automation routing).
        self._fee_policy: dict[str, Any] = {
            "mode": "split",  # reinvest_lp | stake_strk | zkd_buyback | treasury_reserve | split
            "split": {
                "reinvest_lp": 45,
                "stake_strk": 45,
                "treasury_reserve": 10,
            },
            "min_cycle_fees_usd": 10.0,
            "enabled": True,
            "updated_at": time.time(),
        }
        self._fee_cycle_sec = float(os.getenv("MM_SIM_FEE_CYCLE_SEC", "900"))
        self._last_fee_cycle_ts = 0.0
        self._fee_automation: dict[str, Any] = {
            "cycles": 0,
            "fee_txs": 0,
            "last_cycle_ts": 0.0,
            "last_mode": self._fee_policy.get("mode", "reinvest_lp"),
            "last_result": "idle",
        }

        normalized_pairs = sorted({
            str(pair).strip().lower()
            for pair in (coordination_target_pairs or [])
            if str(pair).strip()
        })
        default_primary_pairs = ["zkdai/zkdeth"]
        primary_volume_pairs = sorted({
            str(pair).strip().lower()
            for pair in (coordination_primary_volume_pairs or default_primary_pairs)
            if str(pair).strip()
        })
        default_volume_targets = {
            "zkdai/zkdeth": 200_000.0,
            "strk/zkdeth": 75_000.0,
            "zkdai/strk": 75_000.0,
        }
        raw_volume_targets = coordination_volume_targets_usd if coordination_volume_targets_usd is not None else default_volume_targets
        volume_targets_usd = self._normalize_volume_targets(raw_volume_targets)
        if not volume_targets_usd and coordination_volume_targets_usd is None:
            volume_targets_usd = dict(default_volume_targets)
        self._coordination_policy: dict[str, Any] = {
            "enabled": bool(coordination_enabled),
            "cycle_sec": max(20.0, float(coordination_cycle_sec)),
            "min_active_lp_per_pair": max(0, int(coordination_min_active_lp_per_pair)),
            "max_actions_per_cycle": max(0, int(coordination_max_actions_per_cycle)),
            "auto_close_stale": bool(coordination_auto_close_stale),
            "auto_recenter": bool(coordination_auto_recenter),
            "limit_support_enabled": bool(coordination_limit_support_enabled),
            "target_pairs": normalized_pairs,
            "volume_ramp_enabled": bool(coordination_volume_ramp_enabled),
            "max_swap_actions_per_cycle": max(0, int(coordination_max_swap_actions_per_cycle)),
            "coverage_boost_enabled": bool(coordination_coverage_boost_enabled),
            "min_pool_coverage_ratio": min(1.0, max(0.0, float(coordination_min_pool_coverage_ratio))),
            "max_coverage_swap_actions_per_cycle": max(0, int(coordination_max_coverage_swap_actions_per_cycle)),
            "min_swap_size_multiplier": max(0.1, float(coordination_min_swap_size_multiplier)),
            "max_swap_size_multiplier": max(0.1, float(coordination_max_swap_size_multiplier)),
            "primary_volume_pairs": primary_volume_pairs,
            "volume_targets_usd": volume_targets_usd,
            "updated_at": time.time(),
        }
        if self._coordination_policy["max_swap_size_multiplier"] < self._coordination_policy["min_swap_size_multiplier"]:
            self._coordination_policy["max_swap_size_multiplier"] = self._coordination_policy["min_swap_size_multiplier"]
        self._last_coordination_ts = 0.0
        self._coordination_state: dict[str, Any] = {
            "cycles": 0,
            "actions": 0,
            "stale_closed": 0,
            "recenters": 0,
            "limit_support_orders": 0,
            "ramp_swaps": 0,
            "coverage_swaps": 0,
            "coverage_ratio": 0.0,
            "pools_targeted": 0,
            "pools_covered": 0,
            "last_cycle_ts": 0.0,
            "last_result": "idle",
            "last_actions": [],
        }

    def set_startup_flags(
        self, *, swap: bool | None = None, lp: bool | None = None, limit: bool | None = None
    ) -> None:
        """Override bot startup flags (call before start())."""
        if swap is not None:
            self._bot_startup_flags["swap"] = swap
        if lp is not None:
            self._bot_startup_flags["lp"] = lp
        if limit is not None:
            self._bot_startup_flags["limit"] = limit

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        auto_started_bots = await self._auto_start_bots()
        await self._emit("system", "On-chain engine started", {
            "poll_interval_sec": self.poll_interval_sec,
            "tracked_pools": len(self.pools),
            "wallet_configured": self.wallet.configured if self.wallet else False,
            "bots_available": {
                "swap": self.swap_bot is not None,
                "lp": self.lp_bot is not None,
                "limit": self.limit_bot is not None,
            },
            "bots_startup_enabled": dict(self._bot_startup_flags),
            "bots_auto_started": auto_started_bots,
        })

    async def stop(self) -> None:
        self._running = False
        # Stop all bots
        for bot in [self.swap_bot, self.lp_bot, self.limit_bot]:
            if bot:
                await bot.stop()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self._emit("system", "On-chain engine stopped")

    async def _auto_start_bots(self) -> list[str]:
        """Start configured bots at process startup."""
        bot_map = {
            "swap": self.swap_bot,
            "lp": self.lp_bot,
            "limit": self.limit_bot,
        }
        auto_started: list[str] = []
        for bot_name, bot in bot_map.items():
            if not self._bot_startup_flags.get(bot_name, False):
                continue
            if bot is None:
                continue
            if bot.enabled:
                continue
            try:
                await bot.start()
                auto_started.append(bot_name)
            except Exception as exc:
                await self._emit("error", f"Bot {bot_name} failed to auto-start", {
                    "bot": bot_name,
                    "error": str(exc),
                })
        return auto_started

    # ── Bot control (admin) ─────────────────────────────────────────────────

    async def set_bot(self, bot_name: str, enabled: bool) -> dict[str, Any]:
        """Start or stop a bot by name."""
        bot_map = {
            "swap": self.swap_bot,
            "lp": self.lp_bot,
            "limit": self.limit_bot,
        }
        bot = bot_map.get(bot_name)
        if bot is None:
            raise ValueError(f"Unknown bot: {bot_name}. Available: {list(bot_map)}")

        if enabled:
            await bot.start()
        else:
            await bot.stop()

        await self._emit("admin", f"Bot {bot_name} {'started' if enabled else 'stopped'}", {
            "bot": bot_name, "enabled": enabled,
        })
        return {"bot": bot_name, "enabled": bot.enabled}

    async def trigger_swap(self, pair: str | None = None) -> dict[str, Any]:
        """Admin: trigger a single swap immediately."""
        if not self.swap_bot:
            raise ValueError("Swap bot not configured (no wallet)")
        result = await self.swap_bot.execute_one(
            pair_name=pair,
            allow_extreme_tick=bool(pair),
        )
        await self._emit("trade", "Admin-triggered swap", {
            "success": result.success,
            "pair": result.pair,
            "tx_hash": result.tx_hash,
            "amount_in": result.amount_in_wei,
            "error": result.error,
        })
        return {
            "success": result.success,
            "tx_hash": result.tx_hash,
            "pair": result.pair,
            "error": result.error,
        }

    async def trigger_lp(self, pair: str | None = None) -> dict[str, Any]:
        """Admin: create an LP position immediately."""
        if not self.lp_bot:
            raise ValueError("LP bot not configured (no wallet)")
        result = await self.lp_bot.create_position(pair_name=pair)
        await self._emit("lp", "Admin-triggered LP creation", {
            "success": result.success,
            "pair": result.pair,
            "tx_hash": result.tx_hash,
            "ticks": [result.lower_tick, result.upper_tick],
            "error": result.error,
        })
        return {
            "success": result.success,
            "tx_hash": result.tx_hash,
            "pair": result.pair,
            "lower_tick": result.lower_tick,
            "upper_tick": result.upper_tick,
            "error": result.error,
        }

    async def trigger_limit_order(self, pair: str | None = None) -> dict[str, Any]:
        """Admin: place a limit order immediately."""
        if not self.limit_bot:
            raise ValueError("Limit order bot not configured (no wallet)")
        result = await self.limit_bot.place_order(pair_name=pair)
        await self._emit("limit", "Admin-triggered limit order", {
            "success": result.success,
            "pair": result.pair,
            "side": result.side,
            "tick": result.tick,
            "tx_hash": result.tx_hash,
            "error": result.error,
        })
        return {
            "success": result.success,
            "tx_hash": result.tx_hash,
            "pair": result.pair,
            "side": result.side,
            "tick": result.tick,
            "error": result.error,
        }

    async def collect_fees(self) -> dict[str, Any]:
        """Admin: trigger fee collection from all LP positions."""
        if not self.lp_bot:
            raise ValueError("LP bot not configured (no wallet)")
        results = await self.lp_bot.collect_all_fees()
        collected = sum(1 for r in results if r.success)
        await self._emit("lp", "Admin-triggered fee collection", {
            "positions_checked": len(results),
            "fees_collected": collected,
            "fee_policy": self._fee_policy,
        })
        return {
            "positions_checked": len(results),
            "fees_collected": collected,
            "fee_policy": dict(self._fee_policy),
            "next_step": self._fee_policy.get("mode", "reinvest_lp"),
            "results": [
                {"success": r.success, "tx_hash": r.tx_hash, "pair": r.pair, "error": r.error}
                for r in results
            ],
        }

    async def get_fee_policy(self) -> dict[str, Any]:
        return dict(self._fee_policy)

    async def set_fee_policy(self, policy: dict[str, Any]) -> dict[str, Any]:
        mode = str(policy.get("mode", self._fee_policy.get("mode", "reinvest_lp"))).strip().lower()
        allowed = {"reinvest_lp", "stake_strk", "zkd_buyback", "treasury_reserve", "split"}
        if mode not in allowed:
            raise ValueError(f"Unsupported fee policy mode: {mode}")

        enabled = bool(policy.get("enabled", self._fee_policy.get("enabled", True)))
        min_cycle = float(policy.get("min_cycle_fees_usd", self._fee_policy.get("min_cycle_fees_usd", 10.0)))
        split_in = policy.get("split") if isinstance(policy.get("split"), dict) else self._fee_policy.get("split", {})
        split = {
            "reinvest_lp": int(split_in.get("reinvest_lp", 0)),
            "stake_strk": int(split_in.get("stake_strk", 0)),
            "treasury_reserve": int(split_in.get("treasury_reserve", 0)),
        }
        split_total = sum(max(0, int(v)) for v in split.values())
        if mode == "split" and split_total != 100:
            raise ValueError("Split policy must total 100")

        self._fee_policy = {
            "mode": mode,
            "split": split,
            "min_cycle_fees_usd": max(0.0, min_cycle),
            "enabled": enabled,
            "updated_at": time.time(),
        }
        await self._emit("admin", "fee policy updated", {"fee_policy": self._fee_policy})
        return dict(self._fee_policy)

    @staticmethod
    def _normalize_volume_targets(raw: Any) -> dict[str, float]:
        parsed: dict[str, float] = {}
        if isinstance(raw, dict):
            items = raw.items()
            for pair, value in items:
                key = str(pair).strip().lower()
                if not key:
                    continue
                try:
                    target = float(value)
                except (TypeError, ValueError):
                    continue
                if target > 0:
                    parsed[key] = target
            return parsed

        if isinstance(raw, str):
            for item in raw.split(","):
                chunk = item.strip()
                if not chunk or ":" not in chunk:
                    continue
                pair, value = chunk.split(":", 1)
                key = pair.strip().lower()
                if not key:
                    continue
                try:
                    target = float(value.strip())
                except ValueError:
                    continue
                if target > 0:
                    parsed[key] = target
        return parsed

    async def get_coordination_policy(self) -> dict[str, Any]:
        policy = dict(self._coordination_policy)
        policy["target_pairs"] = list(self._coordination_policy.get("target_pairs", []))
        policy["primary_volume_pairs"] = list(self._coordination_policy.get("primary_volume_pairs", []))
        policy["volume_targets_usd"] = dict(self._coordination_policy.get("volume_targets_usd", {}))
        return policy

    async def set_coordination_policy(self, policy: dict[str, Any]) -> dict[str, Any]:
        target_pairs_in = policy.get("target_pairs", self._coordination_policy.get("target_pairs", []))
        if isinstance(target_pairs_in, str):
            parsed_pairs = [item.strip() for item in target_pairs_in.split(",")]
        elif isinstance(target_pairs_in, list):
            parsed_pairs = [str(item).strip() for item in target_pairs_in]
        else:
            raise ValueError("target_pairs must be a comma-separated string or list")

        normalized_pairs = sorted({
            pair.lower()
            for pair in parsed_pairs
            if pair
        })
        primary_volume_pairs_in = policy.get(
            "primary_volume_pairs",
            self._coordination_policy.get("primary_volume_pairs", []),
        )
        if isinstance(primary_volume_pairs_in, str):
            parsed_primary_pairs = [item.strip() for item in primary_volume_pairs_in.split(",")]
        elif isinstance(primary_volume_pairs_in, list):
            parsed_primary_pairs = [str(item).strip() for item in primary_volume_pairs_in]
        else:
            raise ValueError("primary_volume_pairs must be a comma-separated string or list")
        normalized_primary_pairs = sorted({pair.lower() for pair in parsed_primary_pairs if pair})

        volume_targets_usd_in = policy.get(
            "volume_targets_usd",
            self._coordination_policy.get("volume_targets_usd", {}),
        )
        volume_targets_usd = self._normalize_volume_targets(volume_targets_usd_in)
        if not volume_targets_usd and volume_targets_usd_in not in ({}, "", None):
            raise ValueError("volume_targets_usd must be a dict or comma-separated 'pair:target' string")

        min_swap_size_multiplier = max(
            0.1,
            float(policy.get("min_swap_size_multiplier", self._coordination_policy.get("min_swap_size_multiplier", 1.0))),
        )
        max_swap_size_multiplier = max(
            min_swap_size_multiplier,
            float(policy.get("max_swap_size_multiplier", self._coordination_policy.get("max_swap_size_multiplier", 6.0))),
        )

        self._coordination_policy = {
            "enabled": bool(policy.get("enabled", self._coordination_policy.get("enabled", True))),
            "cycle_sec": max(20.0, float(policy.get("cycle_sec", self._coordination_policy.get("cycle_sec", 180.0)))),
            "min_active_lp_per_pair": max(
                0,
                int(policy.get("min_active_lp_per_pair", self._coordination_policy.get("min_active_lp_per_pair", 1))),
            ),
            "max_actions_per_cycle": max(
                0,
                int(policy.get("max_actions_per_cycle", self._coordination_policy.get("max_actions_per_cycle", 4))),
            ),
            "auto_close_stale": bool(policy.get("auto_close_stale", self._coordination_policy.get("auto_close_stale", True))),
            "auto_recenter": bool(policy.get("auto_recenter", self._coordination_policy.get("auto_recenter", True))),
            "limit_support_enabled": bool(
                policy.get("limit_support_enabled", self._coordination_policy.get("limit_support_enabled", True))
            ),
            "target_pairs": normalized_pairs,
            "volume_ramp_enabled": bool(
                policy.get("volume_ramp_enabled", self._coordination_policy.get("volume_ramp_enabled", True))
            ),
            "max_swap_actions_per_cycle": max(
                0,
                int(policy.get("max_swap_actions_per_cycle", self._coordination_policy.get("max_swap_actions_per_cycle", 3))),
            ),
            "coverage_boost_enabled": bool(
                policy.get("coverage_boost_enabled", self._coordination_policy.get("coverage_boost_enabled", True))
            ),
            "min_pool_coverage_ratio": min(
                1.0,
                max(
                    0.0,
                    float(
                        policy.get(
                            "min_pool_coverage_ratio",
                            self._coordination_policy.get("min_pool_coverage_ratio", 0.8),
                        )
                    ),
                ),
            ),
            "max_coverage_swap_actions_per_cycle": max(
                0,
                int(
                    policy.get(
                        "max_coverage_swap_actions_per_cycle",
                        self._coordination_policy.get("max_coverage_swap_actions_per_cycle", 2),
                    )
                ),
            ),
            "min_swap_size_multiplier": min_swap_size_multiplier,
            "max_swap_size_multiplier": max_swap_size_multiplier,
            "primary_volume_pairs": normalized_primary_pairs,
            "volume_targets_usd": volume_targets_usd,
            "updated_at": time.time(),
        }
        await self._emit("admin", "coordination policy updated", {"coordination_policy": self._coordination_policy})
        return await self.get_coordination_policy()

    async def run_coordination_cycle(self) -> dict[str, Any]:
        base_snapshot = self._snapshot_dict or {"pools": []}
        result = await self._maybe_run_coordination_cycle(base_snapshot, force=True)
        return result or {
            "executed": False,
            "reason": "coordination_disabled_or_unavailable",
            "state": dict(self._coordination_state),
        }

    # ── Scenario overrides (display only) ───────────────────────────────────

    async def set_pair_override(
        self,
        pair_key: str,
        *,
        price_bias_bps: float = 0.0,
        tvl_delta_usd: float = 0.0,
        volume_delta_usd: float = 0.0,
        reset: bool = False,
    ) -> dict[str, Any]:
        norm = str(pair_key).strip().lower()
        async with self._lock:
            if reset:
                self._pair_overrides.pop(norm, None)
                await self._emit("admin", "pair override reset", {"pair": norm})
                return {"pair": norm, "reset": True}
            self._pair_overrides[norm] = {
                "price_bias_bps": float(price_bias_bps),
                "tvl_delta_usd": float(tvl_delta_usd),
                "volume_delta_usd": float(volume_delta_usd),
            }
            return {"pair": norm, **self._pair_overrides[norm]}

    async def manual_trade(self, pair: str, side: str, notional_usd: float) -> dict[str, Any]:
        """Admin: trigger a real swap or apply display override."""
        if self.swap_bot:
            # Execute real swap
            result = await self.swap_bot.execute_one(
                pair_name=pair,
                allow_extreme_tick=bool(pair),
            )
            await self._emit("trade", f"Manual {side} trade", {
                "pair": pair, "side": side, "notional_usd": notional_usd,
                "tx_hash": result.tx_hash, "success": result.success,
                "error": result.error,
            })
            return {
                "pair": pair, "side": side, "real_tx": True,
                "tx_hash": result.tx_hash, "success": result.success,
            }
        else:
            # Fallback: display-only override
            return await self.set_pair_override(
                pair, volume_delta_usd=notional_usd,
            )

    async def trigger_scenario(self, scenario: str, severity: float, duration_ticks: int) -> dict[str, Any]:
        kind = str(scenario).strip().lower()
        if kind not in {"depeg_down", "depeg_up", "liquidity_drain"}:
            raise ValueError("Unsupported scenario")
        async with self._lock:
            self._scenario_kind = kind
            self._scenario_severity = min(0.95, max(0.01, float(severity)))
            self._scenario_ticks_remaining = max(1, int(duration_ticks))
            await self._emit("scenario", "scenario triggered", {
                "scenario": kind, "severity": self._scenario_severity,
                "duration_ticks": self._scenario_ticks_remaining,
            })
            return {
                "scenario": kind,
                "severity": self._scenario_severity,
                "duration_ticks": self._scenario_ticks_remaining,
            }

    # ── Snapshots ───────────────────────────────────────────────────────────

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            if not self._snapshot_dict:
                return {
                    "block_number": 0,
                    "total_tvl_usd": 0,
                    "total_pools": len(self.pools),
                    "initialized_pools": 0,
                    "data_quality": "loading",
                    "pools": [],
                    "timestamp": time.time(),
                    "poll_count": 0,
                    "bots": self._bots_status(),
                    "apy": self._apy_status(),
                    "fee_policy": dict(self._fee_policy),
                    "fee_automation": dict(self._fee_automation),
                    "coordination_policy": dict(self._coordination_policy),
                    "coordination": dict(self._coordination_state),
                }
            out = dict(self._snapshot_dict)
            out["timestamp"] = time.time()
            out["poll_count"] = self._poll_count
            out["bots"] = self._bots_status()
            out["apy"] = self._apy_status()
            out["fee_policy"] = dict(self._fee_policy)
            out["fee_automation"] = dict(self._fee_automation)
            out["coordination_policy"] = dict(self._coordination_policy)
            out["coordination"] = dict(self._coordination_state)
            # Include fleet summary if available
            if self.fleet is not None:
                try:
                    out["fleet"] = self.fleet.fleet_status()
                except Exception:
                    out["fleet"] = None
            return out

    async def admin_state(self) -> dict[str, Any]:
        return {
            "bots": self._bots_status(),
            "apy": self._apy_status(),
            "fee_policy": dict(self._fee_policy),
            "fee_automation": dict(self._fee_automation),
            "coordination_policy": dict(self._coordination_policy),
            "coordination": dict(self._coordination_state),
            "pair_overrides": dict(self._pair_overrides),
            "scenario": {
                "kind": self._scenario_kind,
                "ticks_remaining": self._scenario_ticks_remaining,
                "severity": self._scenario_severity,
            },
            "wallet_configured": self.wallet.configured if self.wallet else False,
            "wallet_address": self.wallet.address[:16] + "..." if self.wallet and self.wallet.address else None,
        }

    async def recent_events(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 1000))
        return [asdict(ev) for ev in list(self.events)[-limit:]]

    # ── Internal ────────────────────────────────────────────────────────────

    def _bots_status(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        # Swap bot
        if self.swap_bot:
            raw = self.swap_bot.status()
            last_swap = raw.get("last_swap") or {}
            result["swap"] = {
                "enabled": raw.get("enabled", False),
                "available": True,
                "interval_sec": self.swap_bot.interval_sec,
                "total": raw.get("total_swaps", 0),
                "successful": raw.get("successful_swaps", 0),
                "failed": raw.get("failed_swaps", 0),
                "total_volume_wei": raw.get("total_volume_wei", 0),
                "behavior_mix": raw.get("behavior_mix", {}),
                "pool_usage": raw.get("pool_usage", {}),
                "last_behavior": raw.get("last_behavior"),
                "last_tx_hash": last_swap.get("tx_hash"),
            }
        else:
            result["swap"] = {"enabled": False, "available": False}

        # LP bot
        if self.lp_bot:
            raw = self.lp_bot.status()
            last_result = raw.get("last_result") or {}
            result["lp"] = {
                "enabled": raw.get("enabled", False),
                "available": True,
                "interval_sec": self.lp_bot.interval_sec,
                "total": raw.get("positions_created", 0) + raw.get("fees_collected", 0),
                "successful": raw.get("positions_created", 0),
                "failed": raw.get("failed_ops", 0),
                "positions_created": raw.get("positions_created", 0),
                "tracked_positions": raw.get("tracked_positions", 0),
                "fees_collected": raw.get("fees_collected", 0),
                "last_tx_hash": last_result.get("tx_hash"),
            }
        else:
            result["lp"] = {"enabled": False, "available": False}

        # Limit order bot
        if self.limit_bot:
            raw = self.limit_bot.status()
            last_result = raw.get("last_result") or {}
            result["limit"] = {
                "enabled": raw.get("enabled", False),
                "available": True,
                "interval_sec": self.limit_bot.interval_sec,
                "total": raw.get("orders_placed", 0),
                "successful": raw.get("orders_placed", 0),
                "failed": raw.get("failed_ops", 0),
                "orders_placed": raw.get("orders_placed", 0),
                "orders_cancelled": raw.get("orders_cancelled", 0),
                "open_orders": raw.get("open_orders", 0),
                "last_tx_hash": last_result.get("tx_hash"),
            }
        else:
            result["limit"] = {"enabled": False, "available": False}

        return result

    def _apy_status(self) -> dict[str, Any]:
        if self.apy_tracker:
            return self.apy_tracker.status()
        return {"tracked_positions": 0, "weighted_apy_pct": 0.0}

    async def _loop(self) -> None:
        await self._poll_once()
        while self._running:
            await asyncio.sleep(self.poll_interval_sec)
            await self._poll_once()

    async def _poll_once(self) -> None:
        try:
            snap = await read_chain_snapshot(
                rpc_url=self.rpc_url,
                pools=self.pools,
            )

            base_snapshot = snapshot_to_dict(snap)

            # Feed bot-generated flow into pool volume overlays so UI shows live movement.
            if self.swap_bot:
                raw = self.swap_bot.status()
                total_volume_wei = int(raw.get("total_volume_wei", 0) or 0)
                delta_volume_wei = max(0, total_volume_wei - self._last_swap_total_volume_wei)
                self._last_swap_total_volume_wei = total_volume_wei

                last_swap = raw.get("last_swap") or {}
                last_pair = str(last_swap.get("pair") or "").strip()
                last_error = str(last_swap.get("error") or "").lower()
                if last_pair and ("extreme tick" in last_error or "not initialized" in last_error):
                    await self._attempt_boundary_recovery(
                        pair_name=last_pair,
                        reason="swap_skip",
                    )

                pool_usage = raw.get("pool_usage", {}) or {}
                pool_deltas: dict[str, int] = {}
                for pair, current_count in pool_usage.items():
                    curr = int(current_count or 0)
                    prev = int(self._last_pool_usage.get(pair, 0) or 0)
                    if curr > prev:
                        pool_deltas[pair] = curr - prev
                self._last_pool_usage = {k: int(v or 0) for k, v in pool_usage.items()}

                # Heuristic conversion to USD-equivalent for display momentum.
                # 1e14 wei ~= 1 unit in overlay scale.
                if delta_volume_wei > 0:
                    delta_usd_equiv = delta_volume_wei / 1e14
                    shares = sum(pool_deltas.values()) or 1
                    if pool_deltas:
                        for pair, trades in pool_deltas.items():
                            current = float(self._bot_volume_overlay_usd.get(pair, 0.0) or 0.0)
                            self._bot_volume_overlay_usd[pair] = min(
                                10_000_000.0,
                                current + (delta_usd_equiv * (trades / shares)),
                            )
                    else:
                        # Fallback: allocate to most-recently swapped pair when counts race polling.
                        last_swap = raw.get("last_swap") or {}
                        pair = str(last_swap.get("pair") or "").strip()
                        if pair:
                            current = float(self._bot_volume_overlay_usd.get(pair, 0.0) or 0.0)
                            self._bot_volume_overlay_usd[pair] = min(10_000_000.0, current + delta_usd_equiv)

            # Periodic boundary pool recovery probes to broaden cross-pool activity.
            target_focus = {pair.lower() for pair in self._coordination_target_pairs(base_snapshot)}
            boundary_candidates: list[tuple[str, int, float]] = []
            for pool in (base_snapshot.get("pools") or []):
                pair = str(pool.get("name") or "").strip()
                if target_focus and pair.lower() not in target_focus:
                    continue
                tick = int(pool.get("tick") or 0)
                if pair and abs(tick) >= MAX_TICK - 10_000:
                    boundary_candidates.append((pair, abs(tick), float(pool.get("tvl_usd") or 0.0)))
            # Recover multiple highest-priority boundary pools per poll for faster convergence.
            boundary_candidates.sort(key=lambda item: (item[1], item[2]), reverse=True)
            recovery_budget = max(2, min(4, len(target_focus) if target_focus else 2))
            for pair, _tick_abs, _tvl in boundary_candidates[:recovery_budget]:
                await self._attempt_boundary_recovery(pair_name=pair, reason="boundary_probe")

            await self._maybe_run_coordination_cycle(base_snapshot)
            await self._capture_bot_activity_events()

            async with self._lock:
                self._snapshot = snap
                self._snapshot_dict = self._apply_display_overrides(base_snapshot)
                self._poll_count += 1

            # Emit events for price changes
            for ps in snap.pools:
                name = ps.pool_key.name
                prev_price = self._last_prices.get(name, 0)
                if ps.initialized and ps.price > 0:
                    if prev_price == 0:
                        await self._emit("pool", f"Pool {name} discovered", {
                            "price": round(ps.price, 8), "tick": ps.tick,
                        })
                    elif abs(ps.price - prev_price) / max(prev_price, 1e-18) > 0.001:
                        direction = "up" if ps.price > prev_price else "down"
                        pct = ((ps.price - prev_price) / prev_price) * 100
                        await self._emit("price", f"{name} price {direction} {abs(pct):.3f}%", {
                            "pool": name,
                            "price": round(ps.price, 8),
                            "change_pct": round(pct, 4),
                        })
                    self._last_prices[name] = ps.price
                elif not ps.initialized and name not in self._last_prices:
                    await self._emit("pool", f"Pool {name} not yet initialized", {
                        "token0": ps.pool_key.token0, "token1": ps.pool_key.token1,
                    })
                    self._last_prices[name] = 0

            await self._emit("system", "Chain poll complete", {
                "block": snap.block_number,
                "initialized": snap.initialized_pools,
                "total_tvl_usd": round(float(self._snapshot_dict.get("total_tvl_usd", 0)), 2),
                "poll_count": self._poll_count,
            })
            await self._maybe_run_fee_cycle()

        except Exception as exc:
            logger.error("Poll failed: %s", exc)
            await self._emit("error", f"Chain poll failed: {exc}")

    async def _maybe_run_fee_cycle(self) -> None:
        """Auto-run fee collection and policy routing metadata on a fixed cadence."""
        if not self.lp_bot:
            return
        if not bool(self._fee_policy.get("enabled", True)):
            return

        now = time.time()
        if now - self._last_fee_cycle_ts < max(60.0, self._fee_cycle_sec):
            return
        self._last_fee_cycle_ts = now

        results = await self.lp_bot.collect_all_fees()
        fee_txs = sum(1 for r in results if getattr(r, "success", False))
        mode = str(self._fee_policy.get("mode", "reinvest_lp"))

        self._fee_automation["cycles"] = int(self._fee_automation.get("cycles", 0)) + 1
        self._fee_automation["fee_txs"] = int(self._fee_automation.get("fee_txs", 0)) + fee_txs
        self._fee_automation["last_cycle_ts"] = now
        self._fee_automation["last_mode"] = mode
        self._fee_automation["last_result"] = "ok" if fee_txs > 0 else "no_fees"

        await self._emit("fees", "Auto fee cycle complete", {
            "mode": mode,
            "fee_txs": fee_txs,
            "positions_checked": len(results),
            "split": self._fee_policy.get("split", {}),
            "min_cycle_fees_usd": self._fee_policy.get("min_cycle_fees_usd", 0),
        })

    def _coordination_target_pairs(self, base_snapshot: dict[str, Any]) -> list[str]:
        pairs: list[str] = []
        seen: set[str] = set()

        for pool in (base_snapshot.get("pools") or []):
            name = str(pool.get("name") or "").strip()
            if not name:
                continue
            lowered = name.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            pairs.append(name)

        if not pairs:
            for pool in self.pools:
                name = str(pool.name or "").strip()
                if not name:
                    continue
                lowered = name.lower()
                if lowered in seen:
                    continue
                seen.add(lowered)
                pairs.append(name)

        explicit_targets = {
            str(pair).strip().lower()
            for pair in (self._coordination_policy.get("target_pairs") or [])
            if str(pair).strip()
        }
        volume_target_keys = {
            str(pair).strip().lower()
            for pair, target in dict(self._coordination_policy.get("volume_targets_usd", {})).items()
            if str(pair).strip() and float(target or 0.0) > 0
        }
        allow_list = explicit_targets or volume_target_keys
        if not allow_list:
            return pairs
        filtered = [pair for pair in pairs if pair.lower() in allow_list]
        return filtered or pairs

    async def _maybe_run_coordination_cycle(
        self,
        base_snapshot: dict[str, Any],
        *,
        force: bool = False,
    ) -> dict[str, Any] | None:
        if not self.lp_bot:
            return None
        if not bool(self._coordination_policy.get("enabled", True)):
            return None

        # When fleet is active, it handles all trading — skip coordination's
        # direct swap/LP/limit calls to avoid nonce contention on the shared wallet.
        fleet_active = self.fleet is not None and getattr(self.fleet, "_running", False)
        if fleet_active:
            return None

        now = time.time()
        cycle_sec = max(20.0, float(self._coordination_policy.get("cycle_sec", 180.0)))
        if (not force) and (now - self._last_coordination_ts < cycle_sec):
            return None
        self._last_coordination_ts = now

        max_actions = max(0, int(self._coordination_policy.get("max_actions_per_cycle", 4)))
        remaining_actions = max_actions
        min_active_lp = max(0, int(self._coordination_policy.get("min_active_lp_per_pair", 1)))
        auto_close_stale = bool(self._coordination_policy.get("auto_close_stale", True))
        auto_recenter = bool(self._coordination_policy.get("auto_recenter", True))
        limit_support_enabled = bool(self._coordination_policy.get("limit_support_enabled", True))
        volume_ramp_enabled = bool(self._coordination_policy.get("volume_ramp_enabled", True))
        max_swap_actions = max(0, int(self._coordination_policy.get("max_swap_actions_per_cycle", 3)))
        coverage_boost_enabled = bool(self._coordination_policy.get("coverage_boost_enabled", True))
        min_pool_coverage_ratio = min(1.0, max(0.0, float(self._coordination_policy.get("min_pool_coverage_ratio", 0.8))))
        max_coverage_swap_actions = max(
            0,
            int(self._coordination_policy.get("max_coverage_swap_actions_per_cycle", 2)),
        )
        min_swap_mult = max(0.1, float(self._coordination_policy.get("min_swap_size_multiplier", 1.0)))
        max_swap_mult = max(min_swap_mult, float(self._coordination_policy.get("max_swap_size_multiplier", 6.0)))

        stale_closed = 0
        recenters = 0
        limit_support_orders = 0
        ramp_swaps = 0
        coverage_swaps = 0
        stale_pairs: set[str] = set()
        target_pairs = self._coordination_target_pairs(base_snapshot)
        target_pair_keys = {pair.lower() for pair in target_pairs}
        pools_targeted = len(target_pairs)
        pools_covered_before = 0
        pools_covered_after = 0
        coverage_ratio_before = 0.0
        coverage_ratio_after = 0.0
        actions: list[dict[str, Any]] = []
        errors: list[str] = []
        pool_by_name: dict[str, dict[str, Any]] = {}
        for pool in (base_snapshot.get("pools") or []):
            name = str(pool.get("name") or "").strip()
            if name:
                base_volume = float(pool.get("volume_24h_usd", 0.0) or 0.0)
                base_volume += float(self._bot_volume_overlay_usd.get(name, 0.0) or 0.0)
                override = self._pair_overrides.get(name.lower())
                if override:
                    base_volume += float(override.get("volume_delta_usd", 0.0) or 0.0)
                enriched = dict(pool)
                enriched["volume_24h_usd"] = max(0.0, base_volume)
                pool_by_name[name.lower()] = enriched

        if auto_close_stale and self.lp_bot.rebalance_enabled:
            try:
                stale_results = await self.lp_bot.check_and_close_stale()
                for stale in stale_results:
                    if not getattr(stale, "success", False):
                        continue
                    stale_closed += 1
                    pair = str(getattr(stale, "pair", "") or "").strip()
                    if pair:
                        stale_pairs.add(pair)
                if stale_closed > 0:
                    actions.append({
                        "action": "stale_cleanup",
                        "closed_positions": stale_closed,
                    })
            except Exception as exc:
                errors.append(f"stale_cleanup:{exc}")

        covered_pair_keys: set[str] = set()
        if self.swap_bot and target_pairs:
            swap_status = self.swap_bot.status() or {}
            pool_usage = swap_status.get("pool_usage", {}) or {}
            covered_pair_keys = {
                str(pair).strip().lower()
                for pair, count in pool_usage.items()
                if int(count or 0) > 0 and str(pair).strip().lower() in target_pair_keys
            }
        # Also count fleet agent swap coverage
        if self.fleet is not None:
            try:
                fleet_usage = self.fleet.agent_pool_usage()
                for pair, count in fleet_usage.items():
                    if int(count or 0) > 0 and str(pair).strip().lower() in target_pair_keys:
                        covered_pair_keys.add(str(pair).strip().lower())
            except Exception:
                pass
        if target_pairs:
            pools_covered_before = len(covered_pair_keys)
            coverage_ratio_before = pools_covered_before / max(1, pools_targeted)

        if (
            coverage_boost_enabled
            and self.swap_bot
            and target_pairs
            and remaining_actions > 0
            and max_coverage_swap_actions > 0
            and coverage_ratio_before < min_pool_coverage_ratio
        ):
            coverage_swap_budget = min(remaining_actions, max_coverage_swap_actions)
            uncovered_pairs = [pair for pair in target_pairs if pair.lower() not in covered_pair_keys]

            def coverage_priority(pair: str) -> tuple[int, float]:
                pool = pool_by_name.get(pair.lower(), {})
                initialized = bool(pool.get("initialized", True))
                tvl = float(pool.get("tvl_usd", 0.0) or 0.0)
                return (0 if initialized else 1, -tvl)

            uncovered_pairs.sort(key=coverage_priority)

            for pair in uncovered_pairs:
                if coverage_swap_budget <= 0:
                    break

                size_multiplier = min(max_swap_mult, max(min_swap_mult, 1.8))
                behavior = "retail"
                try:
                    if abs(int(pool_by_name.get(pair.lower(), {}).get("tick") or 0)) >= MAX_TICK - 10_000:
                        await self._attempt_boundary_recovery(pair_name=pair, reason="coverage_boost")
                    swap_result = await self.swap_bot.execute_one(
                        pair_name=pair,
                        size_multiplier=size_multiplier,
                        behavior=behavior,
                        allow_extreme_tick=True,
                    )
                except Exception as exc:
                    errors.append(f"coverage_boost:{pair}:{exc}")
                    swap_result = None

                coverage_swap_budget -= 1
                remaining_actions -= 1

                if swap_result is None:
                    actions.append({
                        "action": "coverage_boost_swap",
                        "pair": pair,
                        "size_multiplier": round(size_multiplier, 3),
                        "behavior": behavior,
                        "success": False,
                        "error": "swap_execution_failed",
                    })
                    continue

                actions.append({
                    "action": "coverage_boost_swap",
                    "pair": pair,
                    "size_multiplier": round(size_multiplier, 3),
                    "behavior": behavior,
                    "success": bool(swap_result.success),
                    "tx_hash": swap_result.tx_hash,
                    "amount_in_wei": swap_result.amount_in_wei,
                    "error": swap_result.error,
                })
                if swap_result.success:
                    coverage_swaps += 1
                    covered_pair_keys.add(pair.lower())
                elif swap_result.error:
                    errors.append(f"coverage_boost:{pair}:{swap_result.error}")

        if auto_recenter and min_active_lp > 0 and remaining_actions > 0:
            active_by_pool = self.lp_bot.active_positions_by_pool()

            def pair_priority(pair: str) -> tuple[float, float, float, str]:
                pool = pool_by_name.get(pair.lower(), {})
                return (
                    float(active_by_pool.get(pair, 0)),
                    float(pool.get("volume_24h_usd", 0.0) or 0.0),
                    -float(pool.get("tvl_usd", 0.0) or 0.0),
                    pair.lower(),
                )

            stale_ranked = sorted([pair for pair in target_pairs if pair in stale_pairs], key=pair_priority)
            coverage_ranked = sorted([pair for pair in target_pairs if pair not in stale_pairs], key=pair_priority)
            candidate_pairs = stale_ranked + coverage_ranked

            for pair in candidate_pairs:
                if remaining_actions <= 0:
                    break
                try:
                    lp_result = await self.lp_bot.ensure_pool_coverage(
                        pair_name=pair,
                        min_active_positions=min_active_lp,
                    )
                except Exception as exc:
                    errors.append(f"lp_recenter:{pair}:{exc}")
                    continue

                if lp_result is None:
                    continue

                remaining_actions -= 1
                actions.append({
                    "action": "lp_recenter",
                    "pair": pair,
                    "success": bool(lp_result.success),
                    "tx_hash": lp_result.tx_hash,
                    "error": lp_result.error,
                })

                if not lp_result.success:
                    continue

                recenters += 1

                if limit_support_enabled and self.limit_bot and remaining_actions > 0:
                    support_side = "buy" if (recenters % 2 == 0) else "sell"
                    try:
                        limit_result = await self.limit_bot.place_order(pair_name=pair, side=support_side)
                    except Exception as exc:
                        errors.append(f"limit_support:{pair}:{exc}")
                        continue

                    remaining_actions -= 1
                    actions.append({
                        "action": "limit_support",
                        "pair": pair,
                        "side": support_side,
                        "success": bool(limit_result.success),
                        "tx_hash": limit_result.tx_hash,
                        "error": limit_result.error,
                    })
                    if limit_result.success:
                        limit_support_orders += 1

        if volume_ramp_enabled and self.swap_bot and remaining_actions > 0 and max_swap_actions > 0:
            swap_budget = min(remaining_actions, max_swap_actions)
            volume_targets = dict(self._coordination_policy.get("volume_targets_usd", {}))
            primary_pairs = {
                str(pair).strip().lower()
                for pair in (self._coordination_policy.get("primary_volume_pairs") or [])
                if str(pair).strip()
            }
            deficit_candidates: list[dict[str, Any]] = []
            for pair in target_pairs:
                key = pair.lower()
                target = float(volume_targets.get(key, 0.0) or 0.0)
                if target <= 0:
                    continue
                pool = pool_by_name.get(key, {})
                current = max(0.0, float(pool.get("volume_24h_usd", 0.0) or 0.0))
                deficit = max(0.0, target - current)
                if deficit <= 0:
                    continue
                deficit_candidates.append({
                    "pair": pair,
                    "pair_key": key,
                    "target": target,
                    "current": current,
                    "deficit": deficit,
                    "is_primary": key in primary_pairs,
                })

            deficit_candidates.sort(
                key=lambda item: (
                    0 if item.get("is_primary") else 1,
                    -float(item.get("deficit", 0.0)),
                )
            )

            attempt_idx = 0
            while swap_budget > 0 and deficit_candidates:
                candidate = deficit_candidates[attempt_idx % len(deficit_candidates)]
                attempt_idx += 1

                pair = str(candidate.get("pair") or "")
                target = float(candidate.get("target", 0.0) or 0.0)
                current = float(candidate.get("current", 0.0) or 0.0)
                deficit = float(candidate.get("deficit", 0.0) or 0.0)

                severity = min(1.0, deficit / max(target, 1.0))
                size_multiplier = min_swap_mult + ((max_swap_mult - min_swap_mult) * severity)
                if severity >= 0.8:
                    behavior = "whale"
                elif severity >= 0.35:
                    behavior = "retail"
                else:
                    behavior = "degen"

                try:
                    if abs(int(pool_by_name.get(pair.lower(), {}).get("tick") or 0)) >= MAX_TICK - 10_000:
                        await self._attempt_boundary_recovery(pair_name=pair, reason="volume_ramp")
                    swap_result = await self.swap_bot.execute_one(
                        pair_name=pair,
                        size_multiplier=size_multiplier,
                        behavior=behavior,
                        allow_extreme_tick=True,
                    )
                except Exception as exc:
                    errors.append(f"volume_ramp:{pair}:{exc}")
                    swap_result = None

                swap_budget -= 1
                remaining_actions -= 1

                if swap_result is None:
                    actions.append({
                        "action": "volume_ramp_swap",
                        "pair": pair,
                        "target_volume_usd": round(target, 2),
                        "current_volume_usd": round(current, 2),
                        "deficit_usd": round(deficit, 2),
                        "size_multiplier": round(size_multiplier, 3),
                        "behavior": behavior,
                        "success": False,
                        "error": "swap_execution_failed",
                    })
                    continue

                actions.append({
                    "action": "volume_ramp_swap",
                    "pair": pair,
                    "target_volume_usd": round(target, 2),
                    "current_volume_usd": round(current, 2),
                    "deficit_usd": round(deficit, 2),
                    "size_multiplier": round(size_multiplier, 3),
                    "behavior": behavior,
                    "success": bool(swap_result.success),
                    "tx_hash": swap_result.tx_hash,
                    "amount_in_wei": swap_result.amount_in_wei,
                    "error": swap_result.error,
                })
                if swap_result.success:
                    ramp_swaps += 1
                elif swap_result.error:
                    errors.append(f"volume_ramp:{pair}:{swap_result.error}")

        if self.swap_bot and target_pairs:
            swap_status_after = self.swap_bot.status() or {}
            pool_usage_after = swap_status_after.get("pool_usage", {}) or {}
            covered_pair_keys_after = {
                str(pair).strip().lower()
                for pair, count in pool_usage_after.items()
                if int(count or 0) > 0 and str(pair).strip().lower() in target_pair_keys
            }
            pools_covered_after = len(covered_pair_keys_after)
            coverage_ratio_after = pools_covered_after / max(1, pools_targeted)
        else:
            pools_covered_after = pools_covered_before
            coverage_ratio_after = coverage_ratio_before

        cycle_result = "ok"
        if errors and not actions:
            cycle_result = "error"
        elif errors:
            cycle_result = "partial_error"
        elif not actions:
            cycle_result = "idle"

        self._coordination_state["cycles"] = int(self._coordination_state.get("cycles", 0)) + 1
        self._coordination_state["actions"] = int(self._coordination_state.get("actions", 0)) + len(actions)
        self._coordination_state["stale_closed"] = int(self._coordination_state.get("stale_closed", 0)) + stale_closed
        self._coordination_state["recenters"] = int(self._coordination_state.get("recenters", 0)) + recenters
        self._coordination_state["limit_support_orders"] = int(
            self._coordination_state.get("limit_support_orders", 0)
        ) + limit_support_orders
        self._coordination_state["ramp_swaps"] = int(self._coordination_state.get("ramp_swaps", 0)) + ramp_swaps
        self._coordination_state["coverage_swaps"] = int(self._coordination_state.get("coverage_swaps", 0)) + coverage_swaps
        self._coordination_state["coverage_ratio"] = round(coverage_ratio_after, 4)
        self._coordination_state["pools_targeted"] = pools_targeted
        self._coordination_state["pools_covered"] = pools_covered_after
        self._coordination_state["last_cycle_ts"] = now
        self._coordination_state["last_result"] = cycle_result
        self._coordination_state["last_actions"] = actions[-20:]

        summary = {
            "executed": True,
            "result": cycle_result,
            "actions_executed": len(actions),
            "stale_closed": stale_closed,
            "recenters": recenters,
            "limit_support_orders": limit_support_orders,
            "ramp_swaps": ramp_swaps,
            "coverage_swaps": coverage_swaps,
            "pools_targeted": pools_targeted,
            "pools_covered_before": pools_covered_before,
            "pools_covered_after": pools_covered_after,
            "coverage_ratio_before": round(coverage_ratio_before, 4),
            "coverage_ratio_after": round(coverage_ratio_after, 4),
            "errors": errors,
            "actions": actions,
            "state": dict(self._coordination_state),
            "policy": dict(self._coordination_policy),
        }
        if force or actions or errors:
            await self._emit("coordination", "Pair coordination cycle", summary)
        return summary

    async def _attempt_boundary_recovery(self, pair_name: str, reason: str) -> None:
        pair = str(pair_name or "").strip()
        if not pair:
            return
        # Skip when fleet is active — fleet agents handle their own recovery via
        # allow_extreme_tick=True in their swap loops.
        if self.fleet is not None and getattr(self.fleet, "_running", False):
            return
        now = time.time()
        last_ts = float(self._boundary_recovery_last_ts.get(pair, 0.0) or 0.0)
        if now - last_ts < max(120.0, self._boundary_recovery_cooldown_sec):
            return
        self._boundary_recovery_last_ts[pair] = now

        lp_success = False
        lp_error = None
        if self.lp_bot:
            try:
                lp_result = await self.lp_bot.create_position(pair_name=pair)
                lp_success = bool(lp_result.success)
                lp_error = lp_result.error
            except Exception as exc:
                lp_error = str(exc)

        limit_success = False
        limit_error = None
        if (not lp_success) and self.limit_bot:
            try:
                limit_result = await self.limit_bot.place_order(pair_name=pair)
                limit_success = bool(limit_result.success)
                limit_error = limit_result.error
            except Exception as exc:
                limit_error = str(exc)

        await self._emit("recovery", "Boundary pool recovery attempt", {
            "pair": pair,
            "reason": reason,
            "lp_success": lp_success,
            "lp_error": lp_error,
            "limit_success": limit_success,
            "limit_error": limit_error,
        })

    async def _capture_bot_activity_events(self) -> None:
        """Promote latest bot results into event stream for dashboard histories."""
        # Swap bot
        if self.swap_bot:
            raw = self.swap_bot.status()
            last_swap = raw.get("last_swap") or {}
            tx_hash = str(last_swap.get("tx_hash") or "").strip()
            event_ts = float(last_swap.get("timestamp") or 0.0)
            if tx_hash and tx_hash != self._last_bot_tx_hash.get("swap"):
                self._last_bot_tx_hash["swap"] = tx_hash
                self._last_bot_event_ts["swap"] = event_ts
                await self._emit("trade", "Autonomous swap executed", {
                    "source": "bot",
                    "pair": last_swap.get("pair"),
                    "tx_hash": tx_hash,
                    "amount_in": last_swap.get("amount_in_wei"),
                    "behavior": last_swap.get("behavior"),
                    "success": True,
                })
            elif last_swap.get("error") and event_ts > float(self._last_bot_event_ts.get("swap", 0.0)):
                self._last_bot_event_ts["swap"] = event_ts
                await self._emit("trade", "Autonomous swap failed", {
                    "source": "bot",
                    "pair": last_swap.get("pair"),
                    "error": last_swap.get("error"),
                    "behavior": last_swap.get("behavior"),
                    "success": False,
                })

        # LP bot
        if self.lp_bot:
            raw = self.lp_bot.status()
            last = raw.get("last_result") or {}
            tx_hash = str(last.get("tx_hash") or "").strip()
            event_ts = float(last.get("timestamp") or 0.0)
            if tx_hash and tx_hash != self._last_bot_tx_hash.get("lp"):
                self._last_bot_tx_hash["lp"] = tx_hash
                self._last_bot_event_ts["lp"] = event_ts
                await self._emit("lp", "Autonomous LP action", {
                    "source": "bot",
                    "pair": last.get("pair"),
                    "tx_hash": tx_hash,
                    "action": last.get("action"),
                    "success": bool(last.get("success", True)),
                })
            elif last.get("error") and event_ts > float(self._last_bot_event_ts.get("lp", 0.0)):
                self._last_bot_event_ts["lp"] = event_ts
                await self._emit("lp", "Autonomous LP action failed", {
                    "source": "bot",
                    "pair": last.get("pair"),
                    "action": last.get("action"),
                    "error": last.get("error"),
                    "success": False,
                })

        # Limit bot
        if self.limit_bot:
            raw = self.limit_bot.status()
            last = raw.get("last_result") or {}
            tx_hash = str(last.get("tx_hash") or "").strip()
            event_ts = float(last.get("timestamp") or 0.0)
            if tx_hash and tx_hash != self._last_bot_tx_hash.get("limit"):
                self._last_bot_tx_hash["limit"] = tx_hash
                self._last_bot_event_ts["limit"] = event_ts
                await self._emit("limit", "Autonomous limit action", {
                    "source": "bot",
                    "pair": last.get("pair"),
                    "tx_hash": tx_hash,
                    "side": last.get("side"),
                    "tick": last.get("tick"),
                    "action": last.get("action"),
                    "success": bool(last.get("success", True)),
                })
            elif last.get("error") and event_ts > float(self._last_bot_event_ts.get("limit", 0.0)):
                self._last_bot_event_ts["limit"] = event_ts
                await self._emit("limit", "Autonomous limit action failed", {
                    "source": "bot",
                    "pair": last.get("pair"),
                    "side": last.get("side"),
                    "tick": last.get("tick"),
                    "action": last.get("action"),
                    "error": last.get("error"),
                    "success": False,
                })

    def _apply_display_overrides(self, base: dict[str, Any]) -> dict[str, Any]:
        """Apply admin display overrides + scenario shocks."""
        out = copy.deepcopy(base)
        pools = out.get("pools", [])

        for pool in pools:
            pool.setdefault("volume_24h_usd", 0.0)

        # Pair overrides
        for pool in pools:
            key = str(pool.get("name", "")).strip().lower()
            override = self._pair_overrides.get(key)
            if override:
                self._apply_price_bps(pool, float(override.get("price_bias_bps", 0.0)))
                pool["tvl_usd"] = max(0.0, float(pool.get("tvl_usd", 0)) + float(override.get("tvl_delta_usd", 0)))
                pool["volume_24h_usd"] = max(0.0, float(pool.get("volume_24h_usd", 0)) + float(override.get("volume_delta_usd", 0)))

        # Overlay bot-generated volume directly into each pool for live app movement.
        for pool in pools:
            name = str(pool.get("name", "")).strip()
            bot_overlay = float(self._bot_volume_overlay_usd.get(name, 0.0) or 0.0)
            if bot_overlay > 0:
                pool["volume_24h_usd"] = max(0.0, float(pool.get("volume_24h_usd", 0)) + bot_overlay)
                pool["bot_generated_volume_usd"] = round(bot_overlay, 2)

        # Overlay fleet agent volume into each pool.
        if self.fleet is not None:
            try:
                fleet_overlay = self.fleet.agent_volume_overlay()
                for pool in pools:
                    name = str(pool.get("name", "")).strip()
                    fleet_vol = float(fleet_overlay.get(name, 0.0) or 0.0)
                    if fleet_vol > 0:
                        pool["volume_24h_usd"] = max(0.0, float(pool.get("volume_24h_usd", 0)) + fleet_vol)
                        existing_bot = float(pool.get("bot_generated_volume_usd", 0.0) or 0.0)
                        pool["bot_generated_volume_usd"] = round(existing_bot + fleet_vol, 2)
                        pool["fleet_volume_usd"] = round(fleet_vol, 2)
            except Exception:
                pass  # fleet overlay is best-effort

        # Scenario shock
        if self._scenario_ticks_remaining > 0 and self._scenario_kind:
            for pool in pools:
                if self._scenario_kind == "depeg_down":
                    self._apply_price_bps(pool, -(self._scenario_severity * 120.0))
                elif self._scenario_kind == "depeg_up":
                    self._apply_price_bps(pool, (self._scenario_severity * 120.0))
                elif self._scenario_kind == "liquidity_drain":
                    pool["tvl_usd"] = max(0.0, float(pool.get("tvl_usd", 0)) * (1.0 - self._scenario_severity * 0.08))
            self._scenario_ticks_remaining -= 1
            if self._scenario_ticks_remaining <= 0:
                self._scenario_kind = None
                self._scenario_severity = 0.0

        out["total_tvl_usd"] = round(sum(max(0.0, float(p.get("tvl_usd", 0))) for p in pools), 2)
        out["mode"] = "real_activity" if (self.wallet and self.wallet.configured) else "read_only"
        return out

    @staticmethod
    def _apply_price_bps(pool: dict[str, Any], bps: float) -> None:
        price = float(pool.get("price", 0) or 0)
        if price > 0:
            pool["price"] = max(0.0000001, price * (1.0 + bps / 10_000.0))

    async def _emit(self, category: str, message: str, payload: dict[str, Any] | None = None) -> None:
        self.events.append(Event(
            ts=time.time(), category=category,
            message=message, payload=payload or {},
        ))
