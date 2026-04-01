"""
Background allocator drift monitor for `/portfolio`.

Re-evaluates recently active wallets and emits monitor receipts when the drift
state meaningfully changes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from app.services.portfolio_execution_gate import get_portfolio_execution_gate_service
from app.services.portfolio_monitor_service import get_portfolio_monitor_service
from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)


class PortfolioMonitorWorker:
    def __init__(self, poll_interval: int = 180) -> None:
        self.poll_interval = poll_interval
        self._gate_service = get_portfolio_execution_gate_service()
        self._receipt_service = get_receipt_service()
        self._monitor_service = get_portfolio_monitor_service()
        self.running = False

    async def start(self) -> None:
        self.running = True
        logger.info("PortfolioMonitorWorker started (poll interval: %ss)", self.poll_interval)
        while self.running:
            try:
                await self._poll_wallets()
            except Exception as exc:
                logger.warning("PortfolioMonitorWorker poll failed: %s", exc)
            await asyncio.sleep(self.poll_interval)

    async def stop(self) -> None:
        self.running = False
        logger.info("PortfolioMonitorWorker stopping")

    async def _poll_wallets(self) -> None:
        receipts = await self._receipt_service.get_receipts(limit=300)
        seen: set[str] = set()
        for receipt in receipts:
            user_address = str(receipt.get("user") or "").strip().lower()
            if not user_address.startswith("0x") or user_address in seen:
                continue
            metadata = receipt.get("metadata") if isinstance(receipt.get("metadata"), dict) else {}
            if metadata.get("source") != "execution_gate_v1":
                continue
            seen.add(user_address)

        for user_address in seen:
            recommendation = await self._gate_service.recommend(user_address)
            emit_alert = self._monitor_service.should_emit_alert(user_address, recommendation)
            if emit_alert:
                drift = recommendation.get("drift_monitor") if isinstance(recommendation.get("drift_monitor"), dict) else {}
                await self._receipt_service.create_receipt(
                    user_address=user_address,
                    constraints_hash=str(recommendation.get("attestation_hash") or ""),
                    proof_hash=str(recommendation.get("recommendation_id") or ""),
                    action_type="allocator_monitor",
                    metadata={
                        "source": "execution_gate_v1",
                        "stage": "monitor",
                        "status": str(drift.get("status") or "watch"),
                        "monitor": {
                            "reviewed_at": datetime.now(timezone.utc).isoformat(),
                            "source": recommendation.get("source"),
                            "drift_status": drift.get("status"),
                            "total_turnover_pct": drift.get("total_turnover_pct"),
                            "estimated_turnover_usd": drift.get("estimated_turnover_usd"),
                            "largest_gap_asset": drift.get("largest_gap_asset"),
                            "largest_gap_pct": drift.get("largest_gap_pct"),
                            "drivers": drift.get("drivers") or [],
                            "explanation": drift.get("explanation"),
                        },
                    },
                )
                try:
                    from app.services import studio_notify

                    await studio_notify.notify_studio_personal_alert(
                        wallet=user_address,
                        kind="portfolio_drift",
                        payload={
                            "drift_status": drift.get("status"),
                            "recommendation_id": recommendation.get("recommendation_id"),
                            "explanation": drift.get("explanation"),
                        },
                    )
                except Exception as exc:
                    logger.debug("studio_notify after monitor alert: %s", exc)
            self._monitor_service.record_review(
                user_address,
                recommendation=recommendation,
                emitted_receipt=emit_alert,
            )


_worker: Optional[PortfolioMonitorWorker] = None


def get_portfolio_monitor_worker() -> PortfolioMonitorWorker:
    global _worker
    if _worker is None:
        _worker = PortfolioMonitorWorker(poll_interval=180)
    return _worker
