"""Canonical gate resolution helpers.

Reads risk_profile/v2 decisions and provides helpers for execution/lending
enforcement across agent execution surfaces.
"""

from __future__ import annotations

from typing import Any

import httpx


def is_lending_intent(
    signal: dict[str, Any] | None = None,
    execution_params: dict[str, Any] | None = None,
    constraints: dict[str, Any] | None = None,
) -> bool:
    """Best-effort intent classifier for actions that should honor lending gate."""
    sig = signal or {}
    params = execution_params or {}
    cons = constraints or {}

    # Signal path (oracle execution)
    sig_type = str(sig.get("type") or "").strip().lower()
    if sig_type == "lending":
        return True

    sig_name = str(sig.get("name") or "").strip().lower()
    if any(token in sig_name for token in ("lend", "borrow", "supply", "credit")):
        return True

    adapter_id = str(params.get("adapterId") or "").strip().lower()
    if "lending" in adapter_id or "borrow" in adapter_id:
        return True

    method = str(params.get("method") or "").strip().lower()
    if method in {"borrow", "lend", "supply", "repay"}:
        return True

    # Generic agent path constraints (optional hinting)
    if bool(cons.get("requires_lending_gate", False)):
        return True

    requested_products = cons.get("products")
    if isinstance(requested_products, list):
        lowered = {str(x).strip().lower() for x in requested_products}
        if "lending" in lowered or "credit" in lowered:
            return True

    return False


async def resolve_canonical_decisions(address: str, base_url: str) -> dict[str, Any]:
    """Fetch canonical decisions from risk_profile/v2.

    Returns a resilient shape even when unavailable.
    """
    safe_address = str(address or "").strip().lower()
    safe_base = str(base_url or "").rstrip("/")

    fallback = {
        "available": False,
        "source": "unavailable",
        "execution": {"mode": "advisory", "reason_codes": ["profile_unavailable"], "reason_hints": []},
        "lending": {"mode": "advisory", "reason_codes": ["profile_unavailable"], "reason_hints": []},
    }

    if not safe_address or not safe_base:
        return fallback

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(f"{safe_base}/api/v1/zkdefi/risk_profile/v2/{safe_address}")
            if resp.status_code != 200:
                return fallback
            payload = resp.json()
    except Exception:
        return fallback

    decisions = payload.get("decisions") if isinstance(payload, dict) else None
    if not isinstance(decisions, dict):
        return fallback

    execution = decisions.get("execution") if isinstance(decisions.get("execution"), dict) else {}
    lending = decisions.get("lending") if isinstance(decisions.get("lending"), dict) else {}

    return {
        "available": True,
        "source": "risk_profile_v2",
        "execution": {
            "mode": str(execution.get("mode") or "advisory"),
            "reason_codes": execution.get("reason_codes") or [],
            "reason_hints": execution.get("reason_hints") or [],
        },
        "lending": {
            "mode": str(lending.get("mode") or "advisory"),
            "reason_codes": lending.get("reason_codes") or [],
            "reason_hints": lending.get("reason_hints") or [],
        },
    }


def is_blocked(decision: dict[str, Any] | None) -> bool:
    return str((decision or {}).get("mode") or "").lower() == "block"
