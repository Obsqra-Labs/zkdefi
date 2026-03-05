"""
LimitOrderBot — places concentrated LP positions that function as limit orders.

Ekubo's native limit order extension requires a custom smart contract implementing
ILocker (callback pattern: core.lock -> core.forward -> limit_orders.forwarded).
Since we operate from an EOA, we use narrow concentrated LP positions in regular
pools (extension=0) which behave identically:

  - Buy limit: 1-tick-wide position BELOW current price, providing token1 only
  - Sell limit: 1-tick-wide position ABOVE current price, providing token0 only
  - When price crosses through the position, it gets fully converted (= filled)

This is the same mechanism Ekubo's extension uses internally — the on-chain
effect is identical: real liquidity at a specific tick that fills when price
moves through it.
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
    EKUBO_POSITIONS,
    PoolKey,
    get_pool_price,
)
from bots.wallet_manager import WalletManager

logger = logging.getLogger(__name__)

MAX_TICK = 88_722_883

_LOG_1_0001 = math.log(1.0001)


def price_to_tick(price: float) -> int:
    if price <= 0:
        return 0
    return math.floor(math.log(price) / _LOG_1_0001)


def align_tick(tick: int, tick_spacing: int, *, floor: bool = True) -> int:
    if floor:
        return (tick // tick_spacing) * tick_spacing
    return math.ceil(tick / tick_spacing) * tick_spacing


def _i129(value: int) -> dict:
    return {"mag": abs(value), "sign": value < 0}


# -- Persisted order tracking ------------------------------------------------

_ORDERS_FILE = Path(__file__).resolve().parent.parent / "data" / "bot_limit_orders.json"


def _load_orders() -> list[dict[str, Any]]:
    if not _ORDERS_FILE.exists():
        return []
    try:
        return json.loads(_ORDERS_FILE.read_text()).get("orders", [])
    except Exception:
        return []


def _save_orders(orders: list[dict[str, Any]]) -> None:
    _ORDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {"orders": orders, "updated_at": time.time()}
    _ORDERS_FILE.write_text(json.dumps(data, indent=2))


@dataclass
class LimitOrderResult:
    success: bool
    action: str = ""
    tx_hash: str | None = None
    pair: str = ""
    side: str = ""
    tick: int = 0
    amount_wei: int = 0
    error: str | None = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class LimitBotStats:
    orders_placed: int = 0
    orders_cancelled: int = 0
    failed_ops: int = 0
    last_result: LimitOrderResult | None = None


class LimitOrderBot:
    """Places concentrated LP positions that act as limit orders on Ekubo."""

    def __init__(
        self,
        wallet: WalletManager,
        pools: list[PoolKey],
        interval_sec: float = 180.0,
        amount: float = 0.002,
        spread_ticks: int = 1000,
    ) -> None:
        self.wallet = wallet
        self.pools = pools
        self.interval_sec = interval_sec
        self.amount = amount
        self.spread_ticks = spread_ticks
        self.stats = LimitBotStats()
        self._orders = _load_orders()
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._pool_index = 0

    @property
    def enabled(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("LimitOrderBot started (interval=%.0fs, orders=%d)", self.interval_sec, len(self._orders))

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        logger.info("LimitOrderBot stopped")

    async def place_order(self, pair_name: str | None = None, side: str | None = None) -> LimitOrderResult:
        """Place a concentrated LP position acting as a limit order."""
        pool = self._pick_pool(pair_name)
        if pool is None:
            return LimitOrderResult(success=False, action="create", error="No valid pool found")

        initialized, _sqrt, current_tick, current_price = await get_pool_price(
            self.wallet.rpc_url, pool,
        )
        if not initialized:
            return LimitOrderResult(success=False, action="create", pair=pool.name, error="Pool not initialized")

        if abs(current_tick) > MAX_TICK - self.spread_ticks - pool.tick_spacing:
            return LimitOrderResult(success=False, action="create", pair=pool.name,
                                    error=f"Pool tick {current_tick} at boundary, skipping")

        requested_side = str(side or "").strip().lower()
        if requested_side and requested_side not in {"buy", "sell"}:
            return LimitOrderResult(
                success=False,
                action="create",
                pair=pool.name,
                error=f"Unsupported side '{requested_side}'",
            )
        side = requested_side or random.choice(["buy", "sell"])

        if side == "buy":
            offset = random.randint(1, self.spread_ticks)
            target_tick = align_tick(current_tick - offset, pool.tick_spacing, floor=True)
            token_in = pool.token1
            decimals = pool.token1_decimals
        else:
            offset = random.randint(1, self.spread_ticks)
            target_tick = align_tick(current_tick + offset, pool.tick_spacing, floor=False)
            token_in = pool.token0
            decimals = pool.token0_decimals

        amount_wei = int(self.amount * (10 ** decimals))

        balance = await self.wallet.get_balance(token_in)
        if balance < amount_wei:
            return LimitOrderResult(success=False, action="create", pair=pool.name, side=side,
                                    error=f"Insufficient balance: have {balance}, need {amount_wei}")

        try:
            tx_hash = await self._submit_concentrated_position(pool, token_in, target_tick, amount_wei, side)
            result = LimitOrderResult(
                success=True, action="create", tx_hash=tx_hash,
                pair=pool.name, side=side, tick=target_tick, amount_wei=amount_wei,
            )
            self._orders.append({
                "pair": pool.name, "side": side, "tick": target_tick,
                "token_in": token_in, "amount_wei": amount_wei,
                "tx_hash": tx_hash, "created_at": time.time(), "status": "open",
                "pool_key": {"token0": pool.token0, "token1": pool.token1,
                             "fee": pool.fee, "tick_spacing": pool.tick_spacing,
                             "extension": pool.extension},
            })
            _save_orders(self._orders)
            self.stats.orders_placed += 1
        except Exception as exc:
            result = LimitOrderResult(success=False, action="create", pair=pool.name, side=side, error=str(exc))
            self.stats.failed_ops += 1

        self.stats.last_result = result
        return result

    async def _submit_concentrated_position(
        self, pool: PoolKey, token_in: str, target_tick: int, amount_wei: int, side: str,
    ) -> str:
        """
        Create a 1-tick-wide LP position in a regular pool (extension=0).

        Functionally equivalent to a limit order: provides single-sided liquidity
        at a specific tick. Fully converts when price crosses through.
        Uses mint_and_deposit_and_clear_both via Positions contract (push model).
        """
        positions_int = int(EKUBO_POSITIONS, 16)
        target_tick = max(min(target_tick, MAX_TICK - pool.tick_spacing), -MAX_TICK)

        pool_key = {
            "token0": int(pool.token0, 16),
            "token1": int(pool.token1, 16),
            "fee": pool.fee,
            "tick_spacing": pool.tick_spacing,
            "extension": int(pool.extension, 16) if pool.extension.startswith("0x") else int(pool.extension),
        }
        bounds = {
            "lower": _i129(target_tick),
            "upper": _i129(target_tick + pool.tick_spacing),
        }

        token_contract = await self.wallet.get_contract(token_in)
        positions_contract = await self.wallet.get_contract(EKUBO_POSITIONS)

        calls = [
            token_contract.functions["transfer"].prepare_call(positions_int, amount_wei),
            positions_contract.functions["mint_and_deposit_and_clear_both"].prepare_call(pool_key, bounds, 0),
        ]
        return await self.wallet.execute(calls)

    def _pick_pool(self, pair_name: str | None) -> PoolKey | None:
        if pair_name:
            for p in self.pools:
                if p.name.lower() == pair_name.lower():
                    return p
            return None
        if not self.pools:
            return None
        if random.random() < 0.3:
            return random.choice(self.pools)
        pool = self.pools[self._pool_index % len(self.pools)]
        self._pool_index += 1
        return pool

    async def _loop(self) -> None:
        await asyncio.sleep(random.uniform(3.0, 10.0))
        while self._running:
            for attempt in range(3):
                try:
                    result = await self.place_order()
                    if result.success:
                        logger.info("LimitOrderBot: %s %s tick=%d amount=%d tx=%s",
                                    result.side, result.pair, result.tick, result.amount_wei, result.tx_hash)
                        break
                    else:
                        logger.info("LimitOrderBot attempt %d: %s (pool=%s)", attempt + 1, result.error, result.pair)
                except Exception as exc:
                    logger.warning("LimitOrderBot attempt %d error: %s", attempt + 1, exc)
            else:
                logger.info("LimitOrderBot: all attempts failed this cycle, will retry next interval")
            jitter = random.uniform(0.8, 1.3)
            await asyncio.sleep(self.interval_sec * jitter)

    def status(self) -> dict[str, Any]:
        last = None
        if self.stats.last_result:
            lr = self.stats.last_result
            last = {"success": lr.success, "action": lr.action, "tx_hash": lr.tx_hash,
                    "pair": lr.pair, "side": lr.side, "tick": lr.tick,
                    "error": lr.error, "timestamp": lr.timestamp}
        open_orders = len([o for o in self._orders if o.get("status") == "open"])
        return {
            "enabled": self._running,
            "open_orders": open_orders,
            "orders_placed": self.stats.orders_placed,
            "orders_cancelled": self.stats.orders_cancelled,
            "failed_ops": self.stats.failed_ops,
            "last_result": last,
        }
