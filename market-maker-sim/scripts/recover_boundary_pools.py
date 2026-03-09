#!/usr/bin/env python3
"""
Recover pools stuck at extreme tick boundaries (±88722883/84).

Strategy per pool:
  1. Read current tick  — if |tick| >= MAX_TICK - 10_000, pool is stuck
  2. Create a wide LP position centered at the pool's original init_tick
     so Ekubo has liquidity to route swaps through
  3. Execute a corrective swap pushing the tick back toward centre
  4. Repeat swap up to 3 times with increasing size until tick < boundary

Run from market-maker-sim/:
    python scripts/recover_boundary_pools.py [--dry-run]
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bots.chain_reader import (
    EKUBO_CORE, EKUBO_POSITIONS, EKUBO_ROUTER,
    ETH, STRK, ZKDAI, ZKDETH,
    FEE_30PCT,
    PoolKey, build_default_pools, get_pool_price,
)
from bots.wallet_manager import WalletManager
from bots.lp_bot import LPBot, align_tick
from bots.swap_bot import SwapBot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
)
logger = logging.getLogger("recover_pools")

MAX_TICK = 88_722_883
BOUNDARY_THRESHOLD = MAX_TICK - 10_000

# Sensible init ticks for each pool (from init_limit_order_pools.py + reasoning)
INIT_TICKS = {
    "STRK/ETH":      -82990,   # STRK < ETH
    "zkdAI/zkdETH":   82000,   # zkdAI ≈ $1, zkdETH ≈ $3500 → large ratio 
    "STRK/zkdETH":   -82990,   # STRK < zkdETH
    "zkdAI/STRK":     -8001,   # zkdAI ≈ $1, STRK ≈ $0.50
    "ETH/zkdETH":         0,   # ETH ≈ zkdETH → near parity
    "zkdAI/ETH":      82000,   # zkdAI << ETH
}


async def recover_pool(
    pool: PoolKey,
    wallet: WalletManager,
    lp_bot: LPBot,
    swap_bot: SwapBot,
    dry_run: bool = False,
) -> bool:
    """Attempt to recover a single boundary-stuck pool. Returns True if recovered."""
    name = pool.name
    init_tick = INIT_TICKS.get(name, 0)

    initialized, _sqrt, current_tick, current_price = await get_pool_price(
        wallet.rpc_url, pool,
    )

    if not initialized:
        logger.warning("  %s: not initialized, skipping", name)
        return False

    if abs(current_tick) < BOUNDARY_THRESHOLD:
        logger.info("  %s: tick=%d, not at boundary — OK", name, current_tick)
        return True

    logger.warning(
        "  %s: STUCK at tick=%d (price=%.8f), target ≈ %d",
        name, current_tick, current_price, init_tick,
    )

    if dry_run:
        logger.info("  [dry-run] Would create LP at ticks [%d, %d] and swap", 
                     init_tick - 20000, init_tick + 20000)
        return False

    # Step 1: Seed wide LP around the target init tick
    tick_spacing = pool.tick_spacing
    lower_tick = align_tick(init_tick - 30000, tick_spacing, floor=True)
    upper_tick = align_tick(init_tick + 30000, tick_spacing, floor=False)
    lower_tick = max(lower_tick, -MAX_TICK)
    upper_tick = min(upper_tick, MAX_TICK)

    # Larger amounts for recovery positions
    amount0_wei = int(0.05 * (10 ** pool.token0_decimals))
    amount1_wei = int(0.05 * (10 ** pool.token1_decimals))

    bal0 = await wallet.get_balance(pool.token0)
    bal1 = await wallet.get_balance(pool.token1)
    amount0_wei = min(amount0_wei, bal0 // 2)
    amount1_wei = min(amount1_wei, bal1 // 2)

    if amount0_wei > 0 or amount1_wei > 0:
        logger.info("  Creating recovery LP: ticks=[%d, %d], amounts=[%d, %d]",
                     lower_tick, upper_tick, amount0_wei, amount1_wei)
        try:
            lp_result = await lp_bot.create_position(pair_name=name)
            if lp_result.success:
                logger.info("  LP created: tx=%s", lp_result.tx_hash)
            else:
                logger.warning("  LP creation failed: %s", lp_result.error)
        except Exception as exc:
            logger.error("  LP creation error: %s", exc)

    # Step 2: Corrective swaps with increasing size
    for attempt in range(1, 4):
        # Re-read tick
        _, _, current_tick, _ = await get_pool_price(wallet.rpc_url, pool)
        if abs(current_tick) < BOUNDARY_THRESHOLD:
            logger.info("  %s: recovered! tick=%d after %d swap(s)", name, current_tick, attempt - 1)
            return True

        size_mult = 2.0 * attempt
        logger.info("  Corrective swap #%d (size_mult=%.1f) on %s (tick=%d)",
                     attempt, size_mult, name, current_tick)
        try:
            result = await swap_bot.execute_one(
                pair_name=name,
                size_multiplier=size_mult,
                behavior="whale",
                allow_extreme_tick=True,
            )
            if result.success:
                logger.info("  Swap ok: tx=%s", result.tx_hash)
            else:
                logger.warning("  Swap failed: %s", result.error)
        except Exception as exc:
            logger.error("  Swap error: %s", exc)

        await asyncio.sleep(2)

    # Final check
    _, _, final_tick, _ = await get_pool_price(wallet.rpc_url, pool)
    recovered = abs(final_tick) < BOUNDARY_THRESHOLD
    if recovered:
        logger.info("  %s: RECOVERED! tick=%d", name, final_tick)
    else:
        logger.warning("  %s: still stuck at tick=%d after recovery attempts", name, final_tick)
    return recovered


async def main() -> None:
    dry_run = "--dry-run" in sys.argv

    rpc_url = os.getenv(
        "STARKNET_RPC_URL_V08",
        os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia"),
    )
    account_addr = os.getenv(
        "BOT_ACCOUNT_ADDRESS",
        "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
    )
    pk = os.getenv(
        "BOT_PRIVATE_KEY",
        "0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc",
    )

    wallet = WalletManager(rpc_url=rpc_url, account_address=account_addr, private_key=pk)
    pools = build_default_pools()

    lp_bot = LPBot(
        wallet=wallet, pools=pools,
        tick_width=60000,  # Extra wide for recovery
        amount0=0.05, amount1=0.05,
    )
    swap_bot = SwapBot(
        wallet=wallet, pools=pools,
        min_amount=0.01, max_amount=0.05,
    )

    logger.info("=== Pool Boundary Recovery ===")
    logger.info("RPC: %s", rpc_url)
    logger.info("Wallet: %s", account_addr[:20] + "...")
    logger.info("Pools: %d", len(pools))
    if dry_run:
        logger.info("MODE: DRY RUN")
    logger.info("")

    recovered = 0
    stuck = 0
    for pool in pools:
        result = await recover_pool(pool, wallet, lp_bot, swap_bot, dry_run=dry_run)
        if result:
            recovered += 1
        else:
            stuck += 1

    logger.info("")
    logger.info("=== Summary: %d recovered, %d still stuck ===", recovered, stuck)


if __name__ == "__main__":
    asyncio.run(main())
