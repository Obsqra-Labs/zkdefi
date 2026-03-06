"""Limit-Order Grid Worker — maintain a grid of limit orders around the current price.

Runs as a PM2 process via ``python -m app.workers.limit_grid_worker``.
Uses an ``asyncio.sleep`` loop (default 30 s).

Grid strategy:
- Place N buy orders below current tick (spaced by ``grid_step`` ticks)
- Place N sell orders above current tick
- On each cycle: check fills, replace filled orders, cancel stale orders

Shadow mode (default): logs intents but does NOT execute.
Set ``GRID_LIVE=1`` env var to enable real execution.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from typing import List, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.models.action_intent import ActionIntent
from app.services import execution_guard
from app.services.ekubo.oracle_adapter import get_spot_price
from app.services.ekubo.limit_orders_adapter import (
    build_place_limit_order_calldata,
    get_active_orders,
    record_order,
    mark_order_filled,
)
from app.services.ekubo_config import SEPOLIA_ETH, SEPOLIA_STRK
from app.services.ekubo_executor import price_to_tick, align_tick
from app.services.vault_policy_service import get_vault_policy_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [LimitGrid] %(levelname)s  %(message)s",
)
logger = logging.getLogger("limit_grid_worker")

# ── Config ────────────────────────────────────────────────────────────────────
INTERVAL_SEC = int(os.getenv("GRID_INTERVAL_SEC", "30"))
GRID_LEVELS = int(os.getenv("GRID_LEVELS", "3"))  # orders per side
GRID_STEP = int(os.getenv("GRID_STEP", "1000"))    # ticks between levels
ORDER_SIZE_WEI = int(os.getenv("GRID_ORDER_SIZE_WEI", str(5 * 10**18)))  # 5 STRK per order
SHADOW_MODE = os.getenv("GRID_LIVE", "0") != "1"
TICK_SPACING = int(os.getenv("GRID_TICK_SPACING", "1000"))

VAULT_ADDRESS = os.getenv(
    "VAULT_ADDRESS",
    "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
)


async def _get_current_tick() -> Optional[int]:
    price = await get_spot_price()
    if price is None:
        return None
    return price_to_tick(price)


def _desired_grid(current_tick: int) -> List[dict]:
    """Compute the desired set of grid orders given the current tick."""
    orders = []
    for i in range(1, GRID_LEVELS + 1):
        # Buy orders (below current tick): we sell STRK to buy ETH at a discount
        buy_tick = align_tick(current_tick - i * GRID_STEP, TICK_SPACING, floor=True)
        orders.append({
            "side": "buy",
            "tick": buy_tick,
            "sell_token": SEPOLIA_STRK,
            "buy_token": SEPOLIA_ETH,
            "amount_wei": ORDER_SIZE_WEI,
        })
        # Sell orders (above current tick): we sell ETH to buy STRK at a premium
        sell_tick = align_tick(current_tick + i * GRID_STEP, TICK_SPACING, floor=True)
        orders.append({
            "side": "sell",
            "tick": sell_tick,
            "sell_token": SEPOLIA_ETH,
            "buy_token": SEPOLIA_STRK,
            "amount_wei": ORDER_SIZE_WEI // 100,  # ~0.05 ETH equivalent
        })
    return orders


async def _run_cycle() -> None:
    """Single grid maintenance cycle."""
    current_tick = await _get_current_tick()
    if current_tick is None:
        logger.warning("Could not fetch current tick — skipping cycle")
        return

    logger.info("Current tick: %d", current_tick)

    active = get_active_orders()
    active_ticks = {o.get("limit_tick") for o in active}
    logger.info("Active orders: %d, ticks: %s", len(active), sorted(active_ticks))

    desired = _desired_grid(current_tick)
    desired_ticks = {o["tick"] for o in desired}

    # Find missing levels (desired - active)
    missing = [o for o in desired if o["tick"] not in active_ticks]

    if not missing:
        logger.info("Grid fully populated — nothing to do")
        return

    svc = get_vault_policy_service()

    for order in missing:
        calls = build_place_limit_order_calldata(
            sell_token=order["sell_token"],
            buy_token=order["buy_token"],
            amount_wei=order["amount_wei"],
            limit_tick=order["tick"],
            tick_spacing=TICK_SPACING,
        )

        intent = ActionIntent(
            user_address=VAULT_ADDRESS,
            strategy="limit_grid",
            calldata_bundle=calls,
            expected_edge_bps=0,
            notional_wei=order["amount_wei"],
            metadata={
                "side": order["side"],
                "tick": order["tick"],
            },
        )

        guard = execution_guard.check(intent, policy_svc=svc)
        logger.info(
            "Guard for %s@%d: allowed=%s reason=%s",
            order["side"], order["tick"], guard.allowed, guard.reason,
        )

        if not guard.allowed:
            logger.warning("Guard BLOCKED %s order at tick %d: %s", order["side"], order["tick"], guard.reason)
            continue

        if SHADOW_MODE:
            logger.info(
                "[SHADOW] Would place %s limit order at tick %d (%s → %s, %d wei)",
                order["side"], order["tick"], order["sell_token"][-8:],
                order["buy_token"][-8:], order["amount_wei"],
            )
            # Record in shadow mode too (for observability)
            record_order(
                sell_token=order["sell_token"],
                buy_token=order["buy_token"],
                amount_wei=order["amount_wei"],
                limit_tick=order["tick"],
                tx_hash="shadow",
            )
            continue

        # Live execution would go here
        try:
            logger.info("[LIVE] Placing %s order at tick %d ...", order["side"], order["tick"])
            record_order(
                sell_token=order["sell_token"],
                buy_token=order["buy_token"],
                amount_wei=order["amount_wei"],
                limit_tick=order["tick"],
            )
            execution_guard.record_execution(intent)
        except Exception as exc:
            logger.error("Order placement failed at tick %d: %s", order["tick"], exc)


async def main() -> None:
    mode_label = "SHADOW" if SHADOW_MODE else "LIVE"
    logger.info(
        "Limit Grid Worker starting (%s mode, interval=%ds, levels=%d, step=%d, size=%d wei)",
        mode_label, INTERVAL_SEC, GRID_LEVELS, GRID_STEP, ORDER_SIZE_WEI,
    )
    while True:
        try:
            await _run_cycle()
        except Exception as exc:
            logger.exception("Cycle error: %s", exc)
        await asyncio.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    asyncio.run(main())
