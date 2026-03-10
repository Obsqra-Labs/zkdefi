"""
Decision Event Store.

File-backed async store used when relational DB plumbing is not present in this branch.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class DecisionStore:
    """Append-only telemetry store for proof/decision events."""

    _lock = asyncio.Lock()

    def __init__(self):
        root = Path(__file__).resolve().parents[2]
        self._path = root / "data" / "decision_events.json"
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._path.write_text("[]", encoding="utf-8")

    async def _read_all(self) -> list[dict[str, Any]]:
        text = self._path.read_text(encoding="utf-8").strip() or "[]"
        data = json.loads(text)
        if isinstance(data, list):
            return data
        return []

    async def _write_all(self, rows: list[dict[str, Any]]) -> None:
        self._path.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    async def log_event(
        self,
        user_address: str,
        event_type: str,
        *,
        gate: str | None = None,
        outcome: str | None = None,
        value_eth: float = 0.0,
        proof_mode: str | None = None,
        model_name: str | None = None,
        model_hash: str | None = None,
        metadata: dict[str, Any] | None = None,
        execution_chain: str | None = None,
        primary_chain: str | None = None,
        verification_mode: str | None = None,
        verified_on_chain: bool | None = None,
        l3_tx_hash: str | None = None,
        l2_tx_hash: str | None = None,
        mirror_status: str | None = None,
        failure_reason: str | None = None,
    ) -> int | None:
        async with self._lock:
            rows = await self._read_all()
            next_id = int(rows[-1]["id"]) + 1 if rows else 1
            row = {
                "id": next_id,
                "user_address": (user_address or "").lower(),
                "event_type": event_type,
                "gate": gate,
                "outcome": outcome,
                "value_eth": value_eth,
                "proof_mode": proof_mode,
                "model_name": model_name,
                "model_hash": model_hash,
                "execution_chain": execution_chain,
                "primary_chain": primary_chain,
                "verification_mode": verification_mode,
                "verified_on_chain": verified_on_chain,
                "l3_tx_hash": l3_tx_hash,
                "l2_tx_hash": l2_tx_hash,
                "mirror_status": mirror_status,
                "failure_reason": failure_reason,
                "metadata": metadata or {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            rows.append(row)
            await self._write_all(rows)
            return next_id

    async def get_user_history(
        self,
        user_address: str,
        limit: int = 100,
        event_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        rows = await self._read_all()
        filtered = [r for r in rows if r.get("user_address") == (user_address or "").lower()]
        if event_types:
            allowed = set(event_types)
            filtered = [r for r in filtered if r.get("event_type") in allowed]
        filtered.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return filtered[:limit]

    async def get_past_decisions(self, user_address: str, limit: int = 50) -> list[dict[str, Any]]:
        events = await self.get_user_history(
            user_address,
            limit=limit,
            event_types=["deposit", "withdraw", "rebalance", "early_exit"],
        )
        return [
            {
                "early_exit": ev.get("event_type") == "early_exit",
                "event_type": ev.get("event_type"),
                "value_eth": ev.get("value_eth", 0),
                "timestamp": ev.get("created_at"),
            }
            for ev in events
        ]

    async def get_event_count(self, user_address: str | None = None) -> int:
        rows = await self._read_all()
        if user_address:
            addr = user_address.lower()
            return len([r for r in rows if r.get("user_address") == addr])
        return len(rows)

    async def get_training_dataset(self, min_events: int = 10) -> list[dict[str, Any]]:
        """Aggregate per-user behavioural stats for creditworthiness training.

        Returns a list of user stat dicts for users with >= *min_events* events.
        """
        from collections import defaultdict

        rows = await self._read_all()
        user_events: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            addr = r.get("user_address", "")
            if addr:
                user_events[addr].append(r)

        dataset: list[dict[str, Any]] = []
        for addr, events in user_events.items():
            if len(events) < min_events:
                continue

            total_volume = sum(float(e.get("value_eth", 0) or 0) for e in events)
            early_exits = sum(1 for e in events if e.get("event_type") == "early_exit")
            proof_ok = sum(1 for e in events if e.get("outcome") in ("pass", "success", "confirmed"))
            timestamps = sorted(e.get("created_at", "") for e in events if e.get("created_at"))
            if len(timestamps) >= 2:
                from datetime import datetime as _dt

                try:
                    t0 = _dt.fromisoformat(timestamps[0])
                    t1 = _dt.fromisoformat(timestamps[-1])
                    span_hours = max((t1 - t0).total_seconds() / 3600, 0)
                except Exception:
                    span_hours = 0.0
            else:
                span_hours = 0.0

            n = len(events)
            dataset.append(
                {
                    "user_address": addr,
                    "total_actions": n,
                    "early_exit_rate": early_exits / n if n else 0,
                    "proof_success_rate": proof_ok / n if n else 1.0,
                    "avg_action_size_eth": total_volume / n if n else 0,
                    "total_volume_eth": total_volume,
                    "activity_span_hours": span_hours,
                }
            )

        return dataset


_store: DecisionStore | None = None


def get_decision_store() -> DecisionStore:
    global _store
    if _store is None:
        _store = DecisionStore()
    return _store
