"""Shared pool service (manager envelope + member overrides, file-backed)."""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
POOLS_FILE = DATA_DIR / "shared_pools.json"
MEMBERS_FILE = DATA_DIR / "shared_pool_members.json"


SETTLEMENT_RANK = {
    "public_transfer": 0,
    "hashed_claim": 1,
    "internal_ledger": 2,
}

RELAY_RANK = {
    "none": 0,
    "optional": 1,
    "required": 2,
}



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _normalize_address(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    without = raw[2:] if raw.startswith("0x") else raw
    stripped = without.lstrip("0")
    return f"0x{stripped or '0'}"



def _normalize_pool_id(value: str | None) -> str:
    raw = (value or "").strip().lower().replace(" ", "_")
    return raw



def _normalize_allowlist(items: list[str] | None) -> list[str]:
    if not items:
        return []
    out: list[str] = []
    for item in items:
        text = str(item or "").strip().lower()
        if not text:
            continue
        if text.startswith("0x"):
            text = _normalize_address(text)
        if text not in out:
            out.append(text)
    return out



def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out



def _read_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass
    return {}



def _write_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")



def _pool_key(pool_id: str) -> str:
    return _normalize_pool_id(pool_id)



def _member_key(member_address: str) -> str:
    return _normalize_address(member_address)



def _shared_pool_id(manager_address: str, hint: str | None = None) -> str:
    if hint:
        safe = _normalize_pool_id(hint)
        if safe:
            return safe
    seed = hashlib.sha256(f"shared_pool:{_normalize_address(manager_address)}:{_now_iso()}".encode("utf-8")).hexdigest()[:14]
    return f"sp_{seed}"



def _apply_envelope_constraints(policy: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(policy)

    max_risk = envelope.get("max_risk_budget") or {}
    risk = out.setdefault("risk_budget", {})
    for key in ("max_drawdown_bps", "max_daily_turnover_bps", "max_position_pct"):
        if key in max_risk:
            try:
                risk[key] = min(int(risk.get(key, 0)), int(max_risk[key])) if int(risk.get(key, 0)) > 0 else int(max_risk[key])
            except Exception:
                pass

    allowed_strategies = envelope.get("allowed_strategies") or {}
    strategies = out.setdefault("strategy_permissions", {})
    for key in ("enable_dca", "enable_lp", "enable_rotation", "enable_rebalance"):
        if key in allowed_strategies:
            strategies[key] = bool(strategies.get(key, False)) and bool(allowed_strategies.get(key, False))

    env_venues = _normalize_allowlist(envelope.get("venue_allowlist") or [])
    env_tokens = _normalize_allowlist(envelope.get("token_allowlist") or [])

    cur_venues = _normalize_allowlist(out.get("venue_allowlist") or [])
    cur_tokens = _normalize_allowlist(out.get("token_allowlist") or [])

    if env_venues:
        out["venue_allowlist"] = [item for item in cur_venues if item in env_venues] if cur_venues else env_venues
    else:
        out["venue_allowlist"] = cur_venues

    if env_tokens:
        out["token_allowlist"] = [item for item in cur_tokens if item in env_tokens] if cur_tokens else env_tokens
    else:
        out["token_allowlist"] = cur_tokens

    floor = envelope.get("privacy_floor") or {}
    privacy = out.setdefault("privacy_policy", {})
    for key in ("hide_amounts", "hide_recipient", "hide_sender", "use_nullifier"):
        if key in floor:
            privacy[key] = bool(privacy.get(key, False)) or bool(floor.get(key, False))

    floor_settlement = str(floor.get("settlement_mode") or "")
    current_settlement = str(privacy.get("settlement_mode") or "public_transfer")
    if floor_settlement in SETTLEMENT_RANK:
        if SETTLEMENT_RANK.get(floor_settlement, 0) > SETTLEMENT_RANK.get(current_settlement, 0):
            privacy["settlement_mode"] = floor_settlement

    floor_relay = str(floor.get("relay_mode") or "")
    current_relay = str(privacy.get("relay_mode") or "none")
    if floor_relay in RELAY_RANK:
        if RELAY_RANK.get(floor_relay, 0) > RELAY_RANK.get(current_relay, 0):
            privacy["relay_mode"] = floor_relay

    if "max_relayer_delay_seconds" in floor:
        try:
            floor_delay = int(floor["max_relayer_delay_seconds"])
            cur_delay = int(privacy.get("max_relayer_delay_seconds", floor_delay))
            privacy["max_relayer_delay_seconds"] = min(cur_delay, floor_delay) if cur_delay > 0 and floor_delay > 0 else max(cur_delay, floor_delay)
        except Exception:
            pass

    limits = envelope.get("execution_limits") or {}
    execution = out.setdefault("execution_policy", {})
    if "per_member_daily_notional_usd" in limits:
        try:
            cap = float(limits["per_member_daily_notional_usd"])
            current = float(execution.get("session_max_notional_usd", cap))
            execution["session_max_notional_usd"] = min(current, cap)
        except Exception:
            pass

    return out


class SharedPoolService:
    def create_pool(self, manager_address: str, *, shared_pool_id: str | None = None, envelope: dict[str, Any] | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        manager = _normalize_address(manager_address)
        if not manager:
            raise ValueError("manager_address is required")

        pool_id = _shared_pool_id(manager, shared_pool_id)
        pools = _read_file(POOLS_FILE)
        if pool_id in pools:
            raise ValueError("shared_pool_id already exists")

        env = copy.deepcopy(envelope or {})
        env["venue_allowlist"] = _normalize_allowlist(env.get("venue_allowlist") or [])
        env["token_allowlist"] = _normalize_allowlist(env.get("token_allowlist") or [])
        record = {
            "shared_pool_id": pool_id,
            "manager_address": manager,
            "envelope": env,
            "metadata": metadata or {},
            "proposals": [],
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        pools[pool_id] = record
        _write_file(POOLS_FILE, pools)
        return copy.deepcopy(record)

    def get_pool(self, shared_pool_id: str) -> dict[str, Any] | None:
        pools = _read_file(POOLS_FILE)
        item = pools.get(_pool_key(shared_pool_id))
        return copy.deepcopy(item) if isinstance(item, dict) else None

    def update_envelope(self, shared_pool_id: str, envelope_patch: dict[str, Any]) -> dict[str, Any]:
        pool_id = _pool_key(shared_pool_id)
        pools = _read_file(POOLS_FILE)
        existing = pools.get(pool_id)
        if not isinstance(existing, dict):
            raise ValueError("shared pool not found")

        merged = _deep_merge(existing.get("envelope") or {}, envelope_patch or {})
        merged["venue_allowlist"] = _normalize_allowlist(merged.get("venue_allowlist") or [])
        merged["token_allowlist"] = _normalize_allowlist(merged.get("token_allowlist") or [])

        existing["envelope"] = merged
        existing["updated_at"] = _now_iso()
        pools[pool_id] = existing
        _write_file(POOLS_FILE, pools)
        return copy.deepcopy(existing)

    def join_pool(
        self,
        shared_pool_id: str,
        member_address: str,
        *,
        member_override: dict[str, Any] | None = None,
        autopilot_opt_in: bool = False,
        session_scope: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        pool_id = _pool_key(shared_pool_id)
        member = _member_key(member_address)
        if not member:
            raise ValueError("member_address is required")
        if not self.get_pool(pool_id):
            raise ValueError("shared pool not found")

        members = _read_file(MEMBERS_FILE)
        bucket = members.get(pool_id)
        if not isinstance(bucket, dict):
            bucket = {}

        record = {
            "shared_pool_id": pool_id,
            "member_address": member,
            "member_override": member_override or {},
            "autopilot_opt_in": bool(autopilot_opt_in),
            "session_scope": session_scope or {
                "enabled": False,
                "max_notional_usd": 0,
                "expires_at": None,
            },
            "updated_at": _now_iso(),
        }

        bucket[member] = record
        members[pool_id] = bucket
        _write_file(MEMBERS_FILE, members)
        return copy.deepcopy(record)

    def update_member(self, shared_pool_id: str, member_address: str, patch: dict[str, Any]) -> dict[str, Any]:
        pool_id = _pool_key(shared_pool_id)
        member = _member_key(member_address)

        members = _read_file(MEMBERS_FILE)
        bucket = members.get(pool_id)
        if not isinstance(bucket, dict) or member not in bucket:
            raise ValueError("shared pool member not found")

        existing = bucket[member]
        merged = _deep_merge(existing, patch or {})
        merged["shared_pool_id"] = pool_id
        merged["member_address"] = member
        merged["updated_at"] = _now_iso()

        bucket[member] = merged
        members[pool_id] = bucket
        _write_file(MEMBERS_FILE, members)
        return copy.deepcopy(merged)

    def get_member(self, shared_pool_id: str, member_address: str) -> dict[str, Any] | None:
        pool_id = _pool_key(shared_pool_id)
        member = _member_key(member_address)
        members = _read_file(MEMBERS_FILE)
        bucket = members.get(pool_id)
        if not isinstance(bucket, dict):
            return None
        item = bucket.get(member)
        return copy.deepcopy(item) if isinstance(item, dict) else None

    def list_members(self, shared_pool_id: str) -> list[dict[str, Any]]:
        pool_id = _pool_key(shared_pool_id)
        members = _read_file(MEMBERS_FILE)
        bucket = members.get(pool_id)
        if not isinstance(bucket, dict):
            return []
        out: list[dict[str, Any]] = []
        for value in bucket.values():
            if isinstance(value, dict):
                out.append(copy.deepcopy(value))
        return out

    def create_proposal(self, shared_pool_id: str, manager_address: str, payload: dict[str, Any]) -> dict[str, Any]:
        pool_id = _pool_key(shared_pool_id)
        manager = _member_key(manager_address)
        pools = _read_file(POOLS_FILE)
        pool = pools.get(pool_id)
        if not isinstance(pool, dict):
            raise ValueError("shared pool not found")
        if _member_key(pool.get("manager_address")) != manager:
            raise ValueError("only manager can create proposals")

        proposal_id = "spp_" + hashlib.sha256(f"{pool_id}:{manager}:{_now_iso()}".encode("utf-8")).hexdigest()[:16]
        proposal = {
            "proposal_id": proposal_id,
            "shared_pool_id": pool_id,
            "manager_address": manager,
            "payload": payload or {},
            "status": "proposed",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        proposals = pool.get("proposals")
        if not isinstance(proposals, list):
            proposals = []
        proposals.append(proposal)
        pool["proposals"] = proposals
        pool["updated_at"] = _now_iso()
        pools[pool_id] = pool
        _write_file(POOLS_FILE, pools)
        return copy.deepcopy(proposal)

    def get_proposal(self, shared_pool_id: str, proposal_id: str) -> dict[str, Any] | None:
        pool = self.get_pool(shared_pool_id)
        if not pool:
            return None
        proposals = pool.get("proposals")
        if not isinstance(proposals, list):
            return None
        for row in proposals:
            if isinstance(row, dict) and str(row.get("proposal_id")) == proposal_id:
                return copy.deepcopy(row)
        return None

    def update_proposal(self, shared_pool_id: str, proposal_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        pool_id = _pool_key(shared_pool_id)
        pools = _read_file(POOLS_FILE)
        pool = pools.get(pool_id)
        if not isinstance(pool, dict):
            raise ValueError("shared pool not found")

        proposals = pool.get("proposals")
        if not isinstance(proposals, list):
            raise ValueError("proposal not found")

        updated: dict[str, Any] | None = None
        for idx, row in enumerate(proposals):
            if isinstance(row, dict) and str(row.get("proposal_id")) == proposal_id:
                merged = _deep_merge(row, patch or {})
                merged["updated_at"] = _now_iso()
                proposals[idx] = merged
                updated = merged
                break

        if updated is None:
            raise ValueError("proposal not found")

        pool["proposals"] = proposals
        pool["updated_at"] = _now_iso()
        pools[pool_id] = pool
        _write_file(POOLS_FILE, pools)
        return copy.deepcopy(updated)

    def compute_effective_policy(self, shared_pool_id: str, member_policy: dict[str, Any], member_address: str | None = None) -> dict[str, Any]:
        pool = self.get_pool(shared_pool_id)
        if not pool:
            raise ValueError("shared pool not found")

        member_record = self.get_member(shared_pool_id, member_address or member_policy.get("user_address", ""))
        member_override = (member_record or {}).get("member_override") or {}

        merged = _deep_merge(member_policy, member_override)
        merged = _apply_envelope_constraints(merged, pool.get("envelope") or {})
        merged["mode"] = "shared_member"
        merged["updated_at"] = _now_iso()
        merged["shared_pool_context"] = {
            "shared_pool_id": pool.get("shared_pool_id"),
            "manager_address": pool.get("manager_address"),
            "execution_limits": (pool.get("envelope") or {}).get("execution_limits") or {},
            "member": member_record,
        }
        return merged

    def purge_user(self, user_address: str) -> dict[str, int]:
        """
        Remove a user from shared-pool state.
        - Deletes pools managed by the user.
        - Removes member entries for the user across all pools.
        """
        user = _normalize_address(user_address)
        if not user:
            return {"removed_pools": 0, "removed_memberships": 0}

        pools = _read_file(POOLS_FILE)
        members = _read_file(MEMBERS_FILE)
        removed_pools = 0
        removed_memberships = 0

        # Remove manager-owned pools.
        for pool_id, record in list(pools.items()):
            if not isinstance(record, dict):
                continue
            if _normalize_address(record.get("manager_address")) == user:
                del pools[pool_id]
                if pool_id in members:
                    removed_memberships += len(members.get(pool_id, {})) if isinstance(members.get(pool_id), dict) else 0
                    del members[pool_id]
                removed_pools += 1

        # Remove user member entries from remaining pools.
        for pool_id, bucket in list(members.items()):
            if not isinstance(bucket, dict):
                continue
            if user in bucket:
                del bucket[user]
                removed_memberships += 1
            if bucket:
                members[pool_id] = bucket
            else:
                del members[pool_id]

        _write_file(POOLS_FILE, pools)
        _write_file(MEMBERS_FILE, members)
        return {"removed_pools": removed_pools, "removed_memberships": removed_memberships}


_shared_pool_service: SharedPoolService | None = None


def get_shared_pool_service() -> SharedPoolService:
    global _shared_pool_service
    if _shared_pool_service is None:
        _shared_pool_service = SharedPoolService()
    return _shared_pool_service
