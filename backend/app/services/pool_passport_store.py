"""
Pool Passport Store

Persisted store for pool/asset risk passport data (last anomaly result per pool_id).
Read by GET /risk_passport/pool/{pool_id}; updated when anomaly proof runs.
"""
from datetime import datetime
from typing import Any

from app.services.json_store import JsonStore

_store = JsonStore("pool_passports")


def save(pool_id: str, anomaly_result: dict[str, Any], snapshot_hash: str | None = None) -> None:
    """Save last anomaly result for a pool. Derive health_score from result."""
    safe = anomaly_result.get("is_safe", False)
    health_score = 100 if safe else max(0, 50 - (anomaly_result.get("anomaly_flag", 1) * 25))
    entry = {
        "pool_id": pool_id,
        "safe": safe,
        "health_score": health_score,
        "factors": {},
        "last_anomaly_result": anomaly_result,
        "timestamp": datetime.utcnow().isoformat(),
        "snapshot_hash": snapshot_hash,
    }
    _store.set(pool_id, entry)


def get(pool_id: str) -> dict[str, Any] | None:
    """Get pool passport for pool_id, or None if never analyzed."""
    return _store.get(pool_id)
