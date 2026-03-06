"""
LPBot — manages real LP positions on Ekubo Positions contract (Starknet Sepolia).

Periodically:
  1. Creates new concentrated LP positions (push model: transfer → mint_and_deposit)
  2. Collects accumulated fees from existing positions
  3. Optionally rebalances (withdraw + re-deposit at new ticks)

All operations are real on-chain transactions; fees collected are real APY.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from bots.chain_reader import (
    EKUBO_CORE,
    EKUBO_POSITIONS,
    ETH,
    PoolKey,
    STRK,
    ZKDAI,
    ZKDETH,
    _TWO128,
    get_pool_price,
)
from bots.wallet_manager import WalletManager

logger = logging.getLogger(__name__)

# ── Helpers ──────────────────────────────────────────────────────────────────

_LOG_1_0001 = math.log(1.0001)


def price_to_tick(price: float) -> int:
    if price <= 0:
        return 0
    return math.floor(math.log(price) / _LOG_1_0001)


def tick_to_price(tick: int) -> float:
    return 1.0001 ** tick


def align_tick(tick: int, tick_spacing: int, *, floor: bool = True) -> int:
    if floor:
        return (tick // tick_spacing) * tick_spacing
    return math.ceil(tick / tick_spacing) * tick_spacing


def _i129(value: int) -> dict:
    return {"mag": abs(value), "sign": value < 0}


# ── Position tracking (persisted to disk) ────────────────────────────────────

_POSITIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "bot_lp_positions.json"


def _load_positions() -> list[dict[str, Any]]:
    if not _POSITIONS_FILE.exists():
        return []
    try:
        return json.loads(_POSITIONS_FILE.read_text()).get("positions", [])
    except Exception:
        return []


def _save_positions(positions: list[dict[str, Any]]) -> None:
    _POSITIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {"positions": positions, "updated_at": time.time()}
    _POSITIONS_FILE.write_text(json.dumps(data, indent=2))


@dataclass
class LPResult:
    success: bool
    action: str = ""  # "create" | "collect_fees" | "withdraw"
    tx_hash: str | None = None
    pair: str = ""
    position_id: int | None = None
    lower_tick: int = 0
    upper_tick: int = 0
    amount0_wei: int = 0
    amount1_wei: int = 0
    error: str | None = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class LPBotStats:
    positions_created: int = 0
    fees_collected: int = 0
    positions_closed: int = 0
    failed_ops: int = 0
    last_result: LPResult | None = None


class LPBot:
    """Creates and manages real LP positions on Ekubo."""

    def __init__(
        self,
        wallet: WalletManager,
        pools: list[PoolKey],
        interval_sec: float = 300.0,
        amount0: float = 0.005,
        amount1: float = 0.005,
        tick_width: int = 20000,
        max_positions_per_pool: int = 10,
        rebalance_enabled: bool = True,
        stale_threshold_pct: float = 50.0,
    ) -> None:
        self.wallet = wallet
        self.pools = pools
        self.interval_sec = interval_sec
        self.amount0 = amount0
        self.amount1 = amount1
        self.tick_width = tick_width
        self.max_positions_per_pool = max_positions_per_pool
        self.rebalance_enabled = rebalance_enabled
        self.stale_threshold_pct = stale_threshold_pct
        self.stats = LPBotStats()
        self._positions = _load_positions()
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._pool_index = 0  # round-robin for even pool coverage

    @property
    def enabled(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("LPBot started (interval=%.0fs, positions=%d)", self.interval_sec, len(self._positions))

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        logger.info("LPBot stopped")

    async def create_position(self, pair_name: str | None = None) -> LPResult:
        """Create a new concentrated LP position around current pool price."""
        pool = self._pick_pool(pair_name)
        if pool is None:
            return LPResult(success=False, action="create", error="No valid pool found")

        # Read current tick from chain
        initialized, _sqrt, current_tick, current_price = await get_pool_price(
            self.wallet.rpc_url, pool
        )
        if not initialized:
            return LPResult(
                success=False, action="create", pair=pool.name,
                error="Pool not initialized on chain",
            )

        # Calculate tick range centered on current price
        # Ekubo max tick magnitude is 88,722,883 — clamp to stay within bounds
        MAX_TICK = 88_722_883
        half_width = self.tick_width // 2
        lower_tick = align_tick(current_tick - half_width, pool.tick_spacing, floor=True)
        upper_tick = align_tick(current_tick + half_width, pool.tick_spacing, floor=False)

        # Clamp to Ekubo's valid tick range
        lower_tick = max(lower_tick, -MAX_TICK)
        upper_tick = min(upper_tick, MAX_TICK)

        if lower_tick >= upper_tick:
            upper_tick = lower_tick + pool.tick_spacing
        if upper_tick > MAX_TICK or lower_tick < -MAX_TICK:
            return LPResult(
                success=False, action="create", pair=pool.name,
                error=f"Pool tick {current_tick} at boundary, cannot create position",
            )

        # Convert amounts to wei
        amount0_wei = int(self.amount0 * (10 ** pool.token0_decimals))
        amount1_wei = int(self.amount1 * (10 ** pool.token1_decimals))

        # Check balances
        bal0 = await self.wallet.get_balance(pool.token0)
        bal1 = await self.wallet.get_balance(pool.token1)

        # Use what we have, capped by configured amount
        amount0_wei = min(amount0_wei, bal0)
        amount1_wei = min(amount1_wei, bal1)

        if amount0_wei <= 0 and amount1_wei <= 0:
            return LPResult(
                success=False, action="create", pair=pool.name,
                error="Insufficient balance for both tokens",
            )

        try:
            tx_hash = await self._submit_create_position(
                pool, lower_tick, upper_tick, amount0_wei, amount1_wei
            )
            result = LPResult(
                success=True,
                action="create",
                tx_hash=tx_hash,
                pair=pool.name,
                lower_tick=lower_tick,
                upper_tick=upper_tick,
                amount0_wei=amount0_wei,
                amount1_wei=amount1_wei,
            )
            # Track the position locally (we'll need to discover the NFT ID from events later)
            self._positions.append({
                "pair": pool.name,
                "pool_key": {
                    "token0": pool.token0,
                    "token1": pool.token1,
                    "fee": pool.fee,
                    "tick_spacing": pool.tick_spacing,
                    "extension": pool.extension,
                },
                "lower_tick": lower_tick,
                "upper_tick": upper_tick,
                "amount0_wei": amount0_wei,
                "amount1_wei": amount1_wei,
                "tx_hash": tx_hash,
                "created_at": time.time(),
                "status": "active",
            })
            _save_positions(self._positions)
            self.stats.positions_created += 1
        except Exception as exc:
            result = LPResult(
                success=False, action="create", pair=pool.name,
                error=str(exc),
            )
            self.stats.failed_ops += 1

        self.stats.last_result = result
        return result

    async def collect_all_fees(self) -> list[LPResult]:
        """Collect fees from all tracked active positions."""
        results = []
        for pos in self._positions:
            if pos.get("status") != "active":
                continue
            if not pos.get("position_nft_id"):
                # Can't collect without knowing the NFT ID
                continue
            try:
                result = await self._collect_fees(pos)
                results.append(result)
                if result.success:
                    self.stats.fees_collected += 1
                else:
                    self.stats.failed_ops += 1
            except Exception as exc:
                results.append(LPResult(
                    success=False, action="collect_fees",
                    pair=pos.get("pair", ""),
                    error=str(exc),
                ))
                self.stats.failed_ops += 1
        return results

    async def _submit_create_position(
        self,
        pool: PoolKey,
        lower_tick: int,
        upper_tick: int,
        amount0_wei: int,
        amount1_wei: int,
    ) -> str:
        """Build and submit mint_and_deposit_and_clear_both via Positions contract."""
        positions_int = int(EKUBO_POSITIONS, 16)
        token0_contract = await self.wallet.get_contract(pool.token0)
        token1_contract = await self.wallet.get_contract(pool.token1)
        positions_contract = await self.wallet.get_contract(EKUBO_POSITIONS)

        pool_key = {
            "token0": int(pool.token0, 16),
            "token1": int(pool.token1, 16),
            "fee": pool.fee,
            "tick_spacing": pool.tick_spacing,
            "extension": int(pool.extension, 16) if pool.extension.startswith("0x") else int(pool.extension),
        }
        bounds = {
            "lower": _i129(lower_tick),
            "upper": _i129(upper_tick),
        }

        calls = []

        # Push model: transfer tokens TO Positions contract
        if amount0_wei > 0:
            calls.append(
                token0_contract.functions["transfer"].prepare_call(
                    positions_int, amount0_wei,
                )
            )
        if amount1_wei > 0:
            calls.append(
                token1_contract.functions["transfer"].prepare_call(
                    positions_int, amount1_wei,
                )
            )

        # mint_and_deposit_and_clear_both(pool_key, bounds, min_liquidity)
        calls.append(
            positions_contract.functions["mint_and_deposit_and_clear_both"].prepare_call(
                pool_key, bounds, 0,  # min_liquidity=0
            )
        )

        return await self.wallet.execute(calls)

    async def _collect_fees(self, pos: dict[str, Any]) -> LPResult:
        """Collect fees from a specific tracked position."""
        nft_id = int(pos["position_nft_id"])
        pk = pos["pool_key"]

        positions_contract = await self.wallet.get_contract(EKUBO_POSITIONS)

        pool_key = {
            "token0": int(pk["token0"], 16),
            "token1": int(pk["token1"], 16),
            "fee": pk["fee"],
            "tick_spacing": pk["tick_spacing"],
            "extension": int(pk["extension"], 16) if str(pk["extension"]).startswith("0x") else int(pk["extension"]),
        }
        bounds = {
            "lower": _i129(pos["lower_tick"]),
            "upper": _i129(pos["upper_tick"]),
        }

        call = positions_contract.functions["collect_fees"].prepare_call(
            nft_id, pool_key, bounds,
        )
        tx_hash = await self.wallet.execute([call])

        return LPResult(
            success=True,
            action="collect_fees",
            tx_hash=tx_hash,
            pair=pos.get("pair", ""),
            position_id=nft_id,
            lower_tick=pos["lower_tick"],
            upper_tick=pos["upper_tick"],
        )

    def _pick_pool(self, pair_name: str | None) -> PoolKey | None:
        if pair_name:
            for p in self.pools:
                if p.name.lower() == pair_name.lower():
                    return p
            return None
        if not self.pools:
            return None
        # Round-robin with occasional randomness for organic feel
        if random.random() < 0.3:
            return random.choice(self.pools)
        pool = self.pools[self._pool_index % len(self.pools)]
        self._pool_index += 1
        return pool

    def _pool_position_count(self, pool_name: str) -> int:
        """Count active tracked positions for a specific pool."""
        return sum(
            1 for p in self._positions
            if p.get("status") == "active" and p.get("pair", "").lower() == pool_name.lower()
        )

    def active_positions_by_pool(self) -> dict[str, int]:
        """Return active position counts keyed by pool name."""
        counts: dict[str, int] = {}
        for pos in self._positions:
            if pos.get("status") != "active":
                continue
            pair = str(pos.get("pair", "")).strip()
            if not pair:
                continue
            counts[pair] = counts.get(pair, 0) + 1
        return counts

    async def ensure_pool_coverage(self, pair_name: str, min_active_positions: int = 1) -> LPResult | None:
        """
        Ensure a pool has at least `min_active_positions` tracked active LPs.

        Returns:
          - None when no action is needed.
          - LPResult when a create attempt was made (success or failure).
        """
        pair = str(pair_name or "").strip()
        target = max(0, int(min_active_positions))
        if not pair or target <= 0:
            return None

        active_now = self._pool_position_count(pair)
        if active_now >= target:
            return None
        if active_now >= self.max_positions_per_pool:
            return LPResult(
                success=False,
                action="ensure_coverage",
                pair=pair,
                error=f"Pool at cap ({self.max_positions_per_pool} active positions)",
            )

        return await self.create_position(pair_name=pair)

    async def check_and_close_stale(self) -> list[LPResult]:
        """Check all active positions and close ones that are far out of range.

        This prevents unbounded position accumulation. Positions whose current
        tick is > tick_width ticks away from the position range are considered
        stale and withdrawn.
        """
        results: list[LPResult] = []
        if not self.rebalance_enabled:
            return results

        for pool in self.pools:
            pool_positions = [
                p for p in self._positions
                if p.get("status") == "active" and p.get("pair", "").lower() == pool.name.lower()
            ]
            if not pool_positions:
                continue

            # Read current pool price
            try:
                initialized, _sqrt, current_tick, _price = await get_pool_price(
                    self.wallet.rpc_url, pool
                )
            except Exception:
                continue
            if not initialized:
                continue

            # Find out-of-range positions
            stale = []
            in_range_count = 0
            for pos in pool_positions:
                lt = pos.get("lower_tick", 0)
                ut = pos.get("upper_tick", 0)
                if lt <= current_tick <= ut:
                    in_range_count += 1
                else:
                    dist = min(abs(current_tick - lt), abs(current_tick - ut))
                    # Only close positions that are far out of range (>= tick_width away)
                    if dist >= self.tick_width:
                        stale.append(pos)

            total = len(pool_positions)
            stale_pct = (len(stale) / total * 100) if total > 0 else 0

            if stale_pct < self.stale_threshold_pct:
                continue

            # Close stale positions (mark as closed; withdraw if NFT ID known)
            for pos in stale:
                nft_id = pos.get("position_nft_id")
                if nft_id:
                    try:
                        result = await self._withdraw_position(pos)
                        results.append(result)
                        if result.success:
                            pos["status"] = "closed"
                            pos["closed_at"] = time.time()
                            pos["close_reason"] = "stale_rebalance"
                            self.stats.positions_closed += 1
                    except Exception as exc:
                        results.append(LPResult(
                            success=False, action="withdraw",
                            pair=pos.get("pair", ""),
                            error=str(exc),
                        ))
                        self.stats.failed_ops += 1
                else:
                    # No NFT ID — just mark closed in tracker
                    pos["status"] = "closed"
                    pos["closed_at"] = time.time()
                    pos["close_reason"] = "stale_no_nft"
                    self.stats.positions_closed += 1
                    results.append(LPResult(
                        success=True,
                        action="stale_close_tracker_only",
                        pair=pos.get("pair", ""),
                        lower_tick=pos.get("lower_tick", 0),
                        upper_tick=pos.get("upper_tick", 0),
                    ))

            _save_positions(self._positions)
            if stale:
                logger.info(
                    "LPBot: Closed %d stale positions for %s (%.0f%% were stale, %d in-range remain)",
                    len(stale), pool.name, stale_pct, in_range_count,
                )

        if results:
            self.stats.last_result = results[-1]
        return results

    async def _withdraw_position(self, pos: dict[str, Any]) -> LPResult:
        """Withdraw liquidity from a stale position."""
        nft_id = int(pos["position_nft_id"])
        pk = pos["pool_key"]

        positions_contract = await self.wallet.get_contract(EKUBO_POSITIONS)
        pool_key = {
            "token0": int(pk["token0"], 16),
            "token1": int(pk["token1"], 16),
            "fee": pk["fee"],
            "tick_spacing": pk["tick_spacing"],
            "extension": int(pk["extension"], 16) if str(pk["extension"]).startswith("0x") else int(pk["extension"]),
        }
        bounds = {
            "lower": _i129(pos["lower_tick"]),
            "upper": _i129(pos["upper_tick"]),
        }

        # Withdraw all liquidity (use u128 max as amount to withdraw everything)
        max_liquidity = (1 << 128) - 1
        call = positions_contract.functions["withdraw"].prepare_call(
            nft_id, pool_key, bounds, max_liquidity, 0, 0,  # min_token0, min_token1
        )
        tx_hash = await self.wallet.execute([call])

        return LPResult(
            success=True,
            action="withdraw",
            tx_hash=tx_hash,
            pair=pos.get("pair", ""),
            position_id=nft_id,
            lower_tick=pos["lower_tick"],
            upper_tick=pos["upper_tick"],
        )

    async def _loop(self) -> None:
        await asyncio.sleep(random.uniform(2.0, 8.0))
        cycle = 0
        while self._running:
            try:
                if cycle % 5 == 0 and self.rebalance_enabled:
                    # Periodic stale position cleanup
                    results = await self.check_and_close_stale()
                    closed = sum(1 for r in results if r.success)
                    if closed > 0:
                        logger.info("LPBot: Cleaned up %d stale positions", closed)

                # Alternate between creating positions and collecting fees
                if cycle % 3 == 0:
                    # Create a new position (respect per-pool cap)
                    pool = self._pick_pool(None)
                    if pool and self._pool_position_count(pool.name) >= self.max_positions_per_pool:
                        logger.debug(
                            "LPBot: Skipping create for %s — at cap (%d positions)",
                            pool.name, self.max_positions_per_pool,
                        )
                    else:
                        result = await self.create_position()
                        if result.success:
                            logger.info(
                                "LPBot: Created position %s ticks=[%d,%d] tx=%s",
                                result.pair, result.lower_tick, result.upper_tick, result.tx_hash,
                            )
                        else:
                            logger.warning("LPBot create failed: %s", result.error)
                else:
                    # Collect fees
                    results = await self.collect_all_fees()
                    collected = sum(1 for r in results if r.success)
                    if collected > 0:
                        logger.info("LPBot: Collected fees from %d positions", collected)
            except Exception as exc:
                logger.error("LPBot loop error: %s", exc)

            cycle += 1
            jitter = random.uniform(0.8, 1.3)
            await asyncio.sleep(self.interval_sec * jitter)

    def status(self) -> dict[str, Any]:
        last = None
        if self.stats.last_result:
            lr = self.stats.last_result
            last = {
                "success": lr.success,
                "action": lr.action,
                "tx_hash": lr.tx_hash,
                "pair": lr.pair,
                "error": lr.error,
                "timestamp": lr.timestamp,
            }
        return {
            "enabled": self._running,
            "tracked_positions": len([p for p in self._positions if p.get("status") == "active"]),
            "positions_created": self.stats.positions_created,
            "positions_closed": self.stats.positions_closed,
            "fees_collected": self.stats.fees_collected,
            "failed_ops": self.stats.failed_ops,
            "tick_width": self.tick_width,
            "max_per_pool": self.max_positions_per_pool,
            "rebalance_enabled": self.rebalance_enabled,
            "last_result": last,
        }
