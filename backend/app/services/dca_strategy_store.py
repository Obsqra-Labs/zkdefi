"""
DCA Strategy Store — Persistent CRUD for user DCA strategies.

Uses JsonStore for persistence. Each user can have multiple DCA strategies
(e.g., "DCA ETH→USDC every 4h", "DCA STRK→ETH every 1d").
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from app.services.json_store import JsonStore

_store = JsonStore("dca_strategies")


def _key(user_address: str) -> str:
    return user_address.lower()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def list_strategies(user_address: str) -> list[dict[str, Any]]:
    """Return all DCA strategies for a user (active + paused)."""
    data = _store.get(_key(user_address)) or {}
    return list(data.values())


def get_strategy(user_address: str, strategy_id: str) -> dict[str, Any] | None:
    """Return a single strategy or None."""
    data = _store.get(_key(user_address)) or {}
    return data.get(strategy_id)


def create_strategy(
    user_address: str,
    token_in: str,
    token_out: str,
    amount_per_interval: float,
    interval_secs: int = 3600,
    max_slippage_bps: int = 50,
    label: str | None = None,
) -> dict[str, Any]:
    """Create a new DCA strategy. Returns the created record."""
    strategy_id = f"dca_{uuid.uuid4().hex[:12]}"
    record: dict[str, Any] = {
        "id": strategy_id,
        "user_address": user_address,
        "token_in": token_in,
        "token_out": token_out,
        "amount_per_interval": amount_per_interval,
        "interval_secs": interval_secs,
        "max_slippage_bps": max_slippage_bps,
        "label": label or f"DCA {token_in[:10]}→{token_out[:10]}",
        "status": "active",
        "created_at": int(time.time()),
        "last_run": None,
        "total_executed": 0,
        "total_volume": 0.0,
    }
    key = _key(user_address)
    data = _store.get(key) or {}
    data[strategy_id] = record
    _store.set(key, data)
    return record


def update_strategy(
    user_address: str,
    strategy_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    """Update mutable fields of a strategy. Returns updated record or None."""
    key = _key(user_address)
    data = _store.get(key) or {}
    record = data.get(strategy_id)
    if record is None:
        return None

    allowed = {
        "amount_per_interval", "interval_secs", "max_slippage_bps",
        "label", "status",
    }
    for k, v in updates.items():
        if k in allowed:
            record[k] = v

    data[strategy_id] = record
    _store.set(key, data)
    return record


def delete_strategy(user_address: str, strategy_id: str) -> bool:
    """Remove a strategy entirely. Returns True if found & deleted."""
    key = _key(user_address)
    data = _store.get(key) or {}
    if strategy_id not in data:
        return False
    del data[strategy_id]
    _store.set(key, data)
    return True


def record_execution(
    user_address: str,
    strategy_id: str,
    volume: float,
) -> None:
    """Update counters after a successful DCA step."""
    key = _key(user_address)
    data = _store.get(key) or {}
    record = data.get(strategy_id)
    if not record:
        return
    record["last_run"] = int(time.time())
    record["total_executed"] = record.get("total_executed", 0) + 1
    record["total_volume"] = record.get("total_volume", 0.0) + volume
    data[strategy_id] = record
    _store.set(key, data)


def get_all_active() -> list[dict[str, Any]]:
    """Return all active strategies across all users (for scheduler)."""
    active: list[dict[str, Any]] = []
    for _user_key, strategies in _store.items():
        if not isinstance(strategies, dict):
            continue
        for strat in strategies.values():
            if isinstance(strat, dict) and strat.get("status") == "active":
                active.append(strat)
    return active
