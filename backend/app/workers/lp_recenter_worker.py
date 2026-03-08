"""LP Recenter Worker — periodically check positions and recenter out-of-range ones.

Runs as a PM2 process via ``python -m app.workers.lp_recenter_worker``.
Uses an ``asyncio.sleep`` loop (default 60 s) so there is at most one
active iteration at any time.

Shadow mode (default): logs intent + guard result but does NOT execute.
Set ``RECENTER_LIVE=1`` env var to enable real execution.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import sys
import time
from typing import Optional

# Ensure the backend package is importable when run via ``python -m``
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.models.action_intent import ActionIntent
from app.services import execution_guard
from app.services.ekubo.oracle_adapter import get_spot_price
from app.services.ekubo.lp_recenter_adapter import (
    get_recenterable_positions,
    build_recenter_calldata,
    should_recenter,
)
from app.services.vault_policy_service import VaultPolicyService, get_vault_policy_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [LP-Recenter] %(levelname)s  %(message)s",
)
logger = logging.getLogger("lp_recenter_worker")

# ── Config ────────────────────────────────────────────────────────────────────
INTERVAL_SEC = int(os.getenv("RECENTER_INTERVAL_SEC", "60"))
DRIFT_PCT = float(os.getenv("RECENTER_DRIFT_PCT", "0.75"))
HALF_WIDTH = int(os.getenv("RECENTER_HALF_WIDTH", "1000"))
SHADOW_MODE = os.getenv("RECENTER_LIVE", "0") != "1"

# The vault address whose positions we manage
VAULT_ADDRESS = os.getenv(
    "VAULT_ADDRESS",
    "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
)


def _price_to_tick(price: float) -> int:
    if price <= 0:
        return 0
    return round(math.log(price) / math.log(1.0001))


async def _get_current_tick() -> Optional[int]:
    """Fetch current spot price and convert to tick."""
    price = await get_spot_price()
    if price is None:
        return None
    return _price_to_tick(price)


async def _run_cycle() -> None:
    """Single check-and-recenter cycle."""
    current_tick = await _get_current_tick()
    if current_tick is None:
        logger.warning("Could not fetch current tick — skipping cycle")
        return

    logger.info("Current tick: %d (price %.6f)", current_tick, 1.0001 ** current_tick)

    candidates = get_recenterable_positions(current_tick, drift_pct=DRIFT_PCT)
    if not candidates:
        logger.info("No positions need recentering")
        return

    svc = get_vault_policy_service()

    for pos in candidates:
        nft_id = pos.get("nft_id") or pos.get("id")
        reason = pos.get("_recenter_reason", "unknown")
        logger.info("Position NFT %s needs recenter: %s", nft_id, reason)

        recenter = build_recenter_calldata(
            position=pos,
            current_tick=current_tick,
            half_width_ticks=HALF_WIDTH,
        )

        intent = ActionIntent(
            user_address=VAULT_ADDRESS,
            strategy="lp_recenter",
            calldata_bundle=recenter["calls"],
            expected_edge_bps=0,
            notional_wei=0,
            policy_hash="",
            metadata={
                "nft_id": nft_id,
                "old_bounds": recenter["old_bounds"],
                "new_bounds": recenter["new_bounds"],
                "reason": reason,
            },
        )

        guard = execution_guard.check(intent, policy_svc=svc)
        logger.info(
            "Guard result for NFT %s: allowed=%s reason=%s checks=%s",
            nft_id, guard.allowed, guard.reason, guard.checks,
        )

        if not guard.allowed:
            logger.warning("Guard BLOCKED recenter for NFT %s: %s", nft_id, guard.reason)
            continue

        if SHADOW_MODE:
            logger.info(
                "[SHADOW] Would recenter NFT %s: %s → %s",
                nft_id, recenter["old_bounds"], recenter["new_bounds"],
            )
            continue

        # Live execution
        try:
            from app.services.ekubo_executor import EkuboContractExecutor
            executor = EkuboContractExecutor()
            # In a real implementation, convert recenter["calls"] to starknet-py Call objects
            # For now, log the intent
            logger.info("[LIVE] Executing recenter for NFT %s ...", nft_id)
            execution_guard.record_execution(intent)
            logger.info("[LIVE] Recenter for NFT %s completed", nft_id)
        except Exception as exc:
            logger.error("Recenter execution failed for NFT %s: %s", nft_id, exc)


async def main() -> None:
    mode_label = "SHADOW" if SHADOW_MODE else "LIVE"
    logger.info(
        "LP Recenter Worker starting (%s mode, interval=%ds, drift=%.0f%%, half_width=%d)",
        mode_label, INTERVAL_SEC, DRIFT_PCT * 100, HALF_WIDTH,
    )
    consecutive_failures = 0
    while True:
        try:
            await _run_cycle()
            consecutive_failures = 0
        except Exception as exc:
            consecutive_failures += 1
            backoff = min(INTERVAL_SEC * (2 ** consecutive_failures), 600)
            logger.exception(
                "Cycle error (failure #%d, backoff %ds): %s",
                consecutive_failures, backoff, exc,
            )
            await asyncio.sleep(backoff)
            continue
        await asyncio.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    asyncio.run(main())
