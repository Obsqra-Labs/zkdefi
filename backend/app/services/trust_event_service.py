"""Trust event service.

Emits structured trust/profile events to both:
- decision event timeline store (`decision_events.json`)
- receipt timeline (`ReceiptService.append_proof_receipt`)

This keeps profile/identity/reputation events consumable by Memory Lane without
touching active frontend surfaces.
"""

from __future__ import annotations

import json
from typing import Any

from app.db.decision_store import get_decision_store
from app.services.json_store import JsonStore
from app.services.receipt_service import get_receipt_service

_STATE_STORE = JsonStore("trust_event_state")


def _normalize_address(value: str | None) -> str:
    return str(value or "").strip().lower()


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _stable_json(value: Any) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    except Exception:
        return str(value)


def _json_safe(value: Any) -> Any:
    """Return a detached JSON-serializable copy when possible."""
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


async def log_trust_event(
    user_address: str,
    event_type: str,
    *,
    gate: str = "trust",
    outcome: str = "updated",
    metadata: dict[str, Any] | None = None,
    receipt_proof_type: str | None = None,
) -> None:
    """Log a trust-domain event to decision + receipt timelines."""
    address = _normalize_address(user_address)
    if not address:
        return

    meta = _as_dict(metadata)

    try:
        await get_decision_store().log_event(
            user_address=address,
            event_type=event_type,
            gate=gate,
            outcome=outcome,
            metadata=meta,
        )
    except Exception:
        # Keep trust event logging non-fatal.
        pass

    try:
        get_receipt_service().append_proof_receipt(
            user_address=address,
            proof_type=receipt_proof_type or f"trust_{event_type}",
            threshold_or_model="capital_os_profile_v2",
            result=outcome,
            tx_hash=str(meta.get("tx_hash") or "") or None,
            fact_hash=str(meta.get("fact_hash") or "") or None,
            snapshot_hash=str(meta.get("snapshot_id") or "") or None,
            model_hash=str(meta.get("model_hash") or "") or None,
        )
    except Exception:
        pass


async def log_trust_event_if_changed(
    user_address: str,
    state_key: str,
    state_value: Any,
    *,
    event_type: str,
    gate: str = "trust",
    outcome: str = "updated",
    metadata: dict[str, Any] | None = None,
    receipt_proof_type: str | None = None,
) -> bool:
    """Emit event only when the tracked state value changes."""
    address = _normalize_address(user_address)
    if not address:
        return False

    cache = _as_dict(_STATE_STORE.get(address))
    previous = cache.get(state_key)
    if _stable_json(previous) == _stable_json(state_value):
        return False

    cache[state_key] = state_value
    _STATE_STORE.set(address, cache)

    meta = dict(_as_dict(metadata))
    meta["state_key"] = state_key
    meta["previous"] = _json_safe(previous)
    meta["current"] = _json_safe(state_value)

    await log_trust_event(
        address,
        event_type,
        gate=gate,
        outcome=outcome,
        metadata=meta,
        receipt_proof_type=receipt_proof_type,
    )
    return True
