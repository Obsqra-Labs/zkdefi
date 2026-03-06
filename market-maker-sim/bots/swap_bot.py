"""
SwapBot — executes real token swaps on Ekubo Router (Starknet Sepolia).

Periodically picks a random pair from the tracked pool list, quotes the swap
via Router.quote_swap, then submits Router.swap as a real on-chain transaction.
This generates volume + fees that feed into real APY.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import random
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from bots.chain_reader import (
    EKUBO_CORE,
    EKUBO_ROUTER,
    ETH,
    FEE_05PCT,
    FEE_30PCT,
    GET_POOL_PRICE_SELECTOR,
    PoolKey,
    STRK,
    ZKDAI,
    ZKDETH,
    _TWO128,
    get_pool_price,
)
from bots.wallet_manager import WalletManager

logger = logging.getLogger(__name__)

# Ekubo maximum tick magnitude
MAX_TICK = 88_722_883

# ── Helpers ──────────────────────────────────────────────────────────────────

def _i129(value: int) -> dict:
    """Serialise a signed integer as Ekubo's i129 struct."""
    return {"mag": abs(value), "sign": value < 0}


def _felt_hex(value: int | str) -> str:
    if isinstance(value, str):
        v = int(value, 16) if value.startswith("0x") else int(value)
    else:
        v = int(value)
    return hex(v)


def _sorted_tokens(a: str, b: str) -> tuple[str, str]:
    """Return (token0, token1) in Ekubo order (numerically smaller first)."""
    return (a, b) if int(a, 16) < int(b, 16) else (b, a)


@dataclass
class SwapResult:
    success: bool
    tx_hash: str | None = None
    pair: str = ""
    token_in: str = ""
    token_out: str = ""
    amount_in_wei: int = 0
    amount_out_estimate: int = 0
    behavior: str = "retail"
    error: str | None = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class SwapBotStats:
    total_swaps: int = 0
    successful_swaps: int = 0
    failed_swaps: int = 0
    total_volume_wei: int = 0
    behavior_counts: dict[str, int] = field(default_factory=lambda: {
        "degen": 0,
        "retail": 0,
        "whale": 0,
    })
    last_behavior: str | None = None
    last_swap: SwapResult | None = None


class SwapBot:
    """Executes real swaps on Ekubo Router at configurable intervals."""

    def __init__(
        self,
        wallet: WalletManager,
        pools: list[PoolKey],
        interval_sec: float = 60.0,
        min_amount: float = 0.001,
        max_amount: float = 0.01,
        slippage_bps: int = 100,
    ) -> None:
        self.wallet = wallet
        self.pools = pools
        self.interval_sec = interval_sec
        self.min_amount = min_amount
        self.max_amount = max_amount
        self.slippage_bps = slippage_bps
        self.stats = SwapBotStats()
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._pool_index = 0  # round-robin counter for even pool coverage
        self._pool_usage: dict[str, int] = {}
        self._pool_cooldown_until: dict[str, float] = {}

    def _sample_behavior(self) -> tuple[str, float, float]:
        """Return (behavior, size_multiplier, sleep_multiplier)."""
        roll = random.random()
        if roll < 0.45:
            # Degen: frequent, smaller tickets
            return "degen", random.uniform(0.6, 1.35), random.uniform(0.35, 0.75)
        if roll < 0.80:
            # Retail: baseline flow
            return "retail", random.uniform(1.2, 2.8), random.uniform(0.7, 1.1)
        # Whale: rarer, larger tickets
        return "whale", random.uniform(4.5, 11.5), random.uniform(1.0, 1.9)

    @property
    def enabled(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("SwapBot started (interval=%.0fs)", self.interval_sec)

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        logger.info("SwapBot stopped")

    async def execute_one(
        self,
        pair_name: str | None = None,
        *,
        size_multiplier: float = 1.0,
        behavior: str = "retail",
        allow_extreme_tick: bool = False,
    ) -> SwapResult:
        """Execute a single swap. If pair_name is None, pick a random initialized pool."""
        pool = self._pick_pool(pair_name)
        if pool is None:
            return SwapResult(success=False, error="No valid pool found")

        # Pre-check: read current tick, skip pools at extreme boundaries
        try:
            initialized, _sqrt, current_tick, _price = await get_pool_price(
                self.wallet.rpc_url, pool,
            )
            if not initialized:
                self._pool_cooldown_until[pool.name] = time.time() + 180
                return SwapResult(success=False, error=f"Pool {pool.name} not initialized", pair=pool.name)
            at_extreme_tick = abs(current_tick) > MAX_TICK - 10_000
            if at_extreme_tick and not allow_extreme_tick:
                self._pool_cooldown_until[pool.name] = time.time() + 300
                return SwapResult(success=False, error=f"Pool {pool.name} at extreme tick {current_tick}, skipping", pair=pool.name)
        except Exception as exc:
            self._pool_cooldown_until[pool.name] = time.time() + 120
            return SwapResult(success=False, error=f"Pre-check failed: {exc}", pair=pool.name)

        # Choose swap direction.
        # In boundary-recovery mode, push price back into a tradable range.
        if allow_extreme_tick and abs(current_tick) > MAX_TICK - 10_000:
            if current_tick <= (-MAX_TICK + 10_000):
                token_in, token_out = pool.token1, pool.token0
            else:
                token_in, token_out = pool.token0, pool.token1
        else:
            if random.random() < 0.5:
                token_in, token_out = pool.token0, pool.token1
            else:
                token_in, token_out = pool.token1, pool.token0

        # Random amount in human units → wei
        decimals = pool.token0_decimals if token_in == pool.token0 else pool.token1_decimals
        human_amount = random.uniform(self.min_amount, self.max_amount) * max(0.1, size_multiplier)
        amount_in_wei = int(human_amount * (10 ** decimals))

        if amount_in_wei <= 0:
            return SwapResult(success=False, error="Amount too small", pair=pool.name)

        # Check balance
        balance = await self.wallet.get_balance(token_in)
        if balance < amount_in_wei:
            return SwapResult(
                success=False,
                error=f"Insufficient balance: have {balance}, need {amount_in_wei}",
                pair=pool.name,
                token_in=token_in,
                amount_in_wei=amount_in_wei,
                behavior=behavior,
            )

        # Quote swap to get expected output
        quote_out = await self._quote_swap(pool, token_in, amount_in_wei)

        # Build and execute swap
        try:
            tx_hash = await self._execute_swap(pool, token_in, amount_in_wei, quote_out)
            result = SwapResult(
                success=True,
                tx_hash=tx_hash,
                pair=pool.name,
                token_in=token_in,
                token_out=token_out,
                amount_in_wei=amount_in_wei,
                amount_out_estimate=quote_out,
                behavior=behavior,
            )
            self.stats.successful_swaps += 1
            self.stats.total_volume_wei += amount_in_wei
            self._pool_usage[pool.name] = self._pool_usage.get(pool.name, 0) + 1
        except Exception as exc:
            result = SwapResult(
                success=False,
                error=str(exc),
                pair=pool.name,
                token_in=token_in,
                token_out=token_out,
                amount_in_wei=amount_in_wei,
                behavior=behavior,
            )
            self.stats.failed_swaps += 1

        self.stats.total_swaps += 1
        self.stats.behavior_counts[behavior] = self.stats.behavior_counts.get(behavior, 0) + 1
        self.stats.last_behavior = behavior
        self.stats.last_swap = result
        return result

    def _pick_pool(self, pair_name: str | None) -> PoolKey | None:
        if pair_name:
            for p in self.pools:
                if p.name.lower() == pair_name.lower():
                    return p
            return None
        if not self.pools:
            return None
        now = time.time()
        eligible = [p for p in self.pools if now >= float(self._pool_cooldown_until.get(p.name, 0.0) or 0.0)]
        candidate_pools = eligible or self.pools
        # Weighted diversity: prioritize least-used pools, but keep randomness.
        scored = sorted(
            candidate_pools,
            key=lambda p: (self._pool_usage.get(p.name, 0), random.random()),
        )
        top = scored[: max(1, min(3, len(scored)))]
        if random.random() < 0.25:
            return random.choice(candidate_pools)
        return random.choice(top)

    async def _quote_swap(
        self, pool: PoolKey, token_in: str, amount_in_wei: int,
    ) -> int:
        """Call Router.quote_swap via RPC to get expected output."""
        token0, token1 = _sorted_tokens(pool.token0, pool.token1)

        # Build calldata: PoolKey(5 felts) + sqrt_ratio_limit(u256=2) + skip_ahead(1) + TokenAmount(token, mag, sign)
        calldata = [
            _felt_hex(token0),
            _felt_hex(token1),
            _felt_hex(pool.fee),
            _felt_hex(pool.tick_spacing),
            pool.extension,
            "0x0", "0x0",  # sqrt_ratio_limit (0 = no limit)
            "0x0",         # skip_ahead
            _felt_hex(token_in),
            _felt_hex(amount_in_wei),
            "0x0",         # sign=0 (positive = exact input)
        ]

        ROUTER_QUOTE_SELECTOR = 0x2904B7C28F3FD4556D8AA4F93483EA2077DD95E61C54DB86C2EA5FC1F3FFD54    
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(self.wallet.rpc_url, json={
                    "jsonrpc": "2.0",
                    "method": "starknet_call",
                    "params": {
                        "request": {
                            "contract_address": EKUBO_ROUTER,
                            "entry_point_selector": hex(ROUTER_QUOTE_SELECTOR),
                            "calldata": calldata,
                        },
                        "block_id": "latest",
                    },
                    "id": 1,
                })
                data = resp.json()
        except Exception as exc:
            logger.warning("quote_swap RPC failed: %s", exc)
            return 0

        result = data.get("result") or []
        if len(result) < 4:
            return 0

        # Parse i129 deltas: (amount0_mag, amount0_sign, amount1_mag, amount1_sign)
        try:
            a0_mag = int(result[0], 16)
            a0_sign = int(result[1], 16)
            a1_mag = int(result[2], 16)
            a1_sign = int(result[3], 16)
        except (ValueError, IndexError):
            return 0

        # Output is the negative delta (token flowing out of the pool to user)
        token0, token1 = _sorted_tokens(pool.token0, pool.token1)
        token_out = pool.token1 if token_in.lower() == pool.token0.lower() else pool.token0
        if token_out.lower() == token0.lower() and a0_mag != 0 and a0_sign != 0:
            return a0_mag
        if token_out.lower() == token1.lower() and a1_mag != 0 and a1_sign != 0:
            return a1_mag
        return 0

    async def _execute_swap(
        self, pool: PoolKey, token_in: str, amount_in_wei: int, expected_out: int,
    ) -> str:
        """
        Build and submit Router.swap using the proven push model:
          1. transfer(input_token → Router)
          2. Router.swap(RouteNode, TokenAmount)
          3. Router.clear_minimum(output_token, 0) to claim output
        Uses raw Call objects because starknet-py can't parse Ekubo custom types.
        """
        from starknet_py.net.client_models import Call

        token0, token1 = _sorted_tokens(pool.token0, pool.token1)
        token_in_contract = await self.wallet.get_contract(token_in)
        router_int = int(EKUBO_ROUTER, 16)

        token_in_int = int(token_in, 16) if isinstance(token_in, str) else int(token_in)
        token_out = pool.token1 if token_in.lower() == pool.token0.lower() else pool.token0
        token_out_int = int(token_out, 16) if isinstance(token_out, str) else int(token_out)
        ext_int = int(pool.extension, 16) if pool.extension.startswith("0x") else int(pool.extension)

        # Call 1: transfer input tokens TO Router (push model)
        call_transfer = token_in_contract.functions["transfer"].prepare_call(
            router_int, amount_in_wei,
        )

        # Call 2: Router.swap(RouteNode, TokenAmount) — raw calldata
        # RouteNode = pool_key(5) + sqrt_ratio_limit(u256=2) + skip_ahead(1)
        # TokenAmount = token(1) + i129(mag, sign)
        SEL_SWAP = 0x15543c3708653cda9d418b4ccd3be11368e40636c10c44b18cfe756b6d88b29
        swap_calldata = [
            int(token0, 16), int(token1, 16), pool.fee, pool.tick_spacing, ext_int,
            0, 0,           # sqrt_ratio_limit = 0 (no limit)
            0,              # skip_ahead = 0
            token_in_int,   # TokenAmount.token
            amount_in_wei,  # TokenAmount.amount.mag
            0,              # TokenAmount.amount.sign (0 = positive = exact input)
        ]
        call_swap = Call(to_addr=router_int, selector=SEL_SWAP, calldata=swap_calldata)

        # Call 3: Router.clear_minimum(output_token, min=0) to claim output
        SEL_CLEAR = 0x2e1d93dafae32660a4a76a0fd6f31550f3ddfd6a51c29ef2e055b80afbbd011
        call_clear = Call(
            to_addr=router_int,
            selector=SEL_CLEAR,
            calldata=[token_out_int, 0, 0],  # token, min_low, min_high
        )

        return await self.wallet.execute([call_transfer, call_swap, call_clear])

    async def _loop(self) -> None:
        # Small initial jitter to avoid all bots hitting RPC simultaneously
        await asyncio.sleep(random.uniform(1.0, 5.0))
        while self._running:
            result = None
            behavior, size_mult, sleep_mult = self._sample_behavior()
            # Try up to 3 pools before giving up this cycle
            for attempt in range(3):
                try:
                    result = await self.execute_one(size_multiplier=size_mult, behavior=behavior)
                    if result.success:
                        logger.info(
                            "SwapBot[%s]: %s %s in=%d out≈%d tx=%s",
                            behavior,
                            result.pair, result.token_in[:10], result.amount_in_wei,
                            result.amount_out_estimate, result.tx_hash,
                        )
                        break
                    else:
                        logger.warning("SwapBot attempt %d failed: %s (pool=%s)", attempt + 1, result.error, result.pair)
                except Exception as exc:
                    logger.error("SwapBot attempt %d error: %s", attempt + 1, exc)
            else:
                if result and not result.success:
                    logger.warning("SwapBot: all 3 attempts failed this cycle")

            burst_chance = 0.25 if behavior != "retail" else 0.12
            if self._running and random.random() < burst_chance:
                burst_mult = size_mult * random.uniform(0.65, 1.15)
                for attempt in range(2):
                    try:
                        burst = await self.execute_one(size_multiplier=burst_mult, behavior=behavior)
                        if burst.success:
                            logger.info(
                                "SwapBot[%s-burst]: %s %s in=%d out≈%d tx=%s",
                                behavior,
                                burst.pair, burst.token_in[:10], burst.amount_in_wei,
                                burst.amount_out_estimate, burst.tx_hash,
                            )
                            break
                    except Exception as exc:
                        logger.error("SwapBot burst attempt %d error: %s", attempt + 1, exc)

            # Add jitter to interval
            jitter = random.uniform(0.8, 1.3)
            await asyncio.sleep(self.interval_sec * jitter * sleep_mult)

    def status(self) -> dict[str, Any]:
        last = None
        if self.stats.last_swap:
            ls = self.stats.last_swap
            last = {
                "success": ls.success,
                "tx_hash": ls.tx_hash,
                "pair": ls.pair,
                "amount_in_wei": ls.amount_in_wei,
                "behavior": ls.behavior,
                "error": ls.error,
                "timestamp": ls.timestamp,
            }
        return {
            "enabled": self._running,
            "total_swaps": self.stats.total_swaps,
            "successful_swaps": self.stats.successful_swaps,
            "failed_swaps": self.stats.failed_swaps,
            "total_volume_wei": self.stats.total_volume_wei,
            "behavior_mix": self.stats.behavior_counts,
            "last_behavior": self.stats.last_behavior,
            "pool_usage": dict(self._pool_usage),
            "last_swap": last,
        }
