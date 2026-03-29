"""
Portfolio monitor state for the `/portfolio` mainnet-v1 lane.

Stores lightweight review metadata so allocator drift can be tracked over time
without depending on the frontend being open.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.json_store import JsonStore


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PortfolioMonitorService:
    def __init__(self, store_prefix: str = "portfolio_monitor_state") -> None:
        self._store = JsonStore(store_prefix)

    @staticmethod
    def _normalize_address(address: str) -> str:
        return (address or "").strip().lower()

    def get_state(self, owner_address: str) -> dict[str, Any] | None:
        return self._store.get(self._normalize_address(owner_address))

    def record_review(
        self,
        owner_address: str,
        *,
        recommendation: dict[str, Any],
        emitted_receipt: bool = False,
    ) -> dict[str, Any]:
        address = self._normalize_address(owner_address)
        drift = recommendation.get("drift_monitor") if isinstance(recommendation.get("drift_monitor"), dict) else {}
        previous = self._store.get(address) or {}
        state = {
            **previous,
            "owner_address": address,
            "last_reviewed_at": _utc_now_iso(),
            "last_source": recommendation.get("source"),
            "last_recommendation_id": recommendation.get("recommendation_id"),
            "drift_status": drift.get("status"),
            "total_turnover_pct": drift.get("total_turnover_pct"),
            "estimated_turnover_usd": drift.get("estimated_turnover_usd"),
            "largest_gap_asset": drift.get("largest_gap_asset"),
            "largest_gap_pct": drift.get("largest_gap_pct"),
            "driver_kinds": [
                str(item.get("kind"))
                for item in (drift.get("drivers") or [])
                if isinstance(item, dict) and item.get("kind")
            ],
        }
        if emitted_receipt:
            state["last_alerted_at"] = state["last_reviewed_at"]
            state["last_alerted_status"] = state.get("drift_status")
        self._store.set(address, state)
        return state

    def should_emit_alert(self, owner_address: str, recommendation: dict[str, Any]) -> bool:
        address = self._normalize_address(owner_address)
        previous = self._store.get(address) or {}
        drift = recommendation.get("drift_monitor") if isinstance(recommendation.get("drift_monitor"), dict) else {}
        status = str(drift.get("status") or "").strip().lower()
        if status not in {"watch", "rebalance"}:
            return False
        if previous.get("drift_status") != status:
            return True
        last_alerted_at = previous.get("last_alerted_at")
        if not isinstance(last_alerted_at, str):
            return True
        try:
            alerted = datetime.fromisoformat(last_alerted_at.replace("Z", "+00:00"))
        except ValueError:
            return True
        review_seconds = 900 if status == "watch" else 300
        return (datetime.now(timezone.utc) - alerted).total_seconds() >= review_seconds


_service: PortfolioMonitorService | None = None


def get_portfolio_monitor_service() -> PortfolioMonitorService:
    global _service
    if _service is None:
        _service = PortfolioMonitorService()
    return _service
