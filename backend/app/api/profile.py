"""Profile snapshot and diff API routes.

Additive profile introspection endpoints for explainability:
- GET /profile/snapshot/{address}
- GET /profile/diff/{address}?from=...&to=...
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.risk_profile import get_risk_profile_v2
from app.services.json_store import JsonStore

router = APIRouter(prefix="/profile", tags=["profile"])

_snapshot_store = JsonStore("profile_snapshots")
_MAX_HISTORY = 120


def _norm_addr(address: str) -> str:
    return str(address or "").strip().lower()


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _make_snapshot_id(address: str, payload: dict[str, Any], taken_at: str) -> str:
    body = f"{_norm_addr(address)}|{taken_at}|{_stable_json(payload)}"
    return "0x" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def _history_for(address: str) -> dict[str, Any]:
    entry = _snapshot_store.get(_norm_addr(address))
    if isinstance(entry, dict):
        history = entry.get("history")
        if isinstance(history, list):
            return {
                "history": [h for h in history if isinstance(h, dict)],
                "latest": entry.get("latest"),
            }
    return {"history": [], "latest": None}


def _persist_snapshot(address: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    key = _norm_addr(address)
    state = _history_for(key)
    history = state["history"]
    history.append(snapshot)
    if len(history) > _MAX_HISTORY:
        history = history[-_MAX_HISTORY:]
    latest = snapshot.get("snapshot_id")
    out = {"history": history, "latest": latest}
    _snapshot_store.set(key, out)
    return out


def _find_snapshot(address: str, snapshot_id: str | None) -> dict[str, Any] | None:
    state = _history_for(address)
    history = state["history"]
    if not history:
        return None

    if snapshot_id:
        for row in history:
            if str(row.get("snapshot_id")) == snapshot_id:
                return row
        return None

    latest = state.get("latest")
    if latest:
        for row in reversed(history):
            if str(row.get("snapshot_id")) == str(latest):
                return row
    return history[-1]


def _flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(value, dict):
        if not value and prefix:
            out[prefix] = {}
            return out
        for key in sorted(value.keys()):
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            out.update(_flatten(value[key], child_prefix))
        return out

    if isinstance(value, list):
        out[prefix] = value
        return out

    out[prefix] = value
    return out


def _build_diff(before_payload: dict[str, Any], after_payload: dict[str, Any]) -> dict[str, Any]:
    before_map = _flatten(before_payload)
    after_map = _flatten(after_payload)
    keys = sorted(set(before_map.keys()) | set(after_map.keys()))

    changes: list[dict[str, Any]] = []
    sections: set[str] = set()

    for key in keys:
        left = before_map.get(key)
        right = after_map.get(key)
        if _stable_json(left) == _stable_json(right):
            continue
        changes.append({"path": key, "from": left, "to": right})
        head = key.split(".", 1)[0] if key else "root"
        sections.add(head)

    return {
        "changed_fields": changes,
        "summary": {
            "changed_count": len(changes),
            "sections_changed": sorted(sections),
        },
    }


@router.get("/snapshot/{address}")
async def get_profile_snapshot(
    address: str,
    request: Request,
    persist: bool = Query(default=True),
):
    profile = await get_risk_profile_v2(address, request)
    taken_at = datetime.now(timezone.utc).isoformat()
    snapshot_id = _make_snapshot_id(address, profile, taken_at)
    snapshot = {
        "snapshot_id": snapshot_id,
        "taken_at": taken_at,
        "address": _norm_addr(address),
        "profile_version": profile.get("profile_version", "2.0"),
        "payload": profile,
    }

    history_count = len(_history_for(address)["history"])
    if persist:
        state = _persist_snapshot(address, snapshot)
        history_count = len(state["history"])

    return {
        "address": _norm_addr(address),
        "snapshot_id": snapshot_id,
        "taken_at": taken_at,
        "profile_version": snapshot["profile_version"],
        "history_count": history_count,
        "payload": profile,
    }


@router.get("/diff/{address}")
async def get_profile_diff(
    address: str,
    from_snapshot: str | None = Query(default=None, alias="from"),
    to_snapshot: str | None = Query(default=None, alias="to"),
):
    state = _history_for(address)
    if not state["history"]:
        raise HTTPException(status_code=404, detail="No snapshots found for address")

    before = _find_snapshot(address, from_snapshot)
    if before is None:
        raise HTTPException(status_code=404, detail="Source snapshot not found")

    after = _find_snapshot(address, to_snapshot)
    if after is None:
        raise HTTPException(status_code=404, detail="Target snapshot not found")

    before_payload = before.get("payload")
    after_payload = after.get("payload")
    if not isinstance(before_payload, dict) or not isinstance(after_payload, dict):
        raise HTTPException(status_code=500, detail="Snapshot payload is invalid")

    diff = _build_diff(before_payload, after_payload)
    return {
        "address": _norm_addr(address),
        "from_snapshot_id": before.get("snapshot_id"),
        "to_snapshot_id": after.get("snapshot_id"),
        "from_taken_at": before.get("taken_at"),
        "to_taken_at": after.get("taken_at"),
        "changed_fields": diff["changed_fields"],
        "summary": diff["summary"],
    }
