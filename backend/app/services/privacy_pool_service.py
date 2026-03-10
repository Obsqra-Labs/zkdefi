"""
Privacy pool persistence and analytics service.

Provides deterministic JSON-backed state for the three DAO-governed pools:
CONSERVATIVE_POOL, MODERATE_POOL, AGGRESSIVE_POOL.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

from app.services.json_store import JsonStore

POOL_IDS = ("CONSERVATIVE_POOL", "MODERATE_POOL", "AGGRESSIVE_POOL")

_metrics_store = JsonStore("dao_pool_metrics")
_positions_store = JsonStore("dao_pool_positions")
_yield_store = JsonStore("dao_pool_yield_distributions")
_policy_store = JsonStore("dao_pool_lending_policies")
_loans_store = JsonStore("dao_pool_active_loans")
_proposal_store = JsonStore("dao_pool_governance_proposals")


_DEFAULT_METRICS = {
    "CONSERVATIVE_POOL": {
        "pool": "CONSERVATIVE_POOL",
        "totalDeposited": 1_250_000.0,
        "currentYield": 10.2,
        "borrowersActive": 11,
        "avgBorrowingRate": 4.3,
        "idleCapital": 562_500.0,
        "utilizationRate": 0.55,
        "daoApr": 1.9,
        "source": "simulated",
    },
    "MODERATE_POOL": {
        "pool": "MODERATE_POOL",
        "totalDeposited": 1_820_000.0,
        "currentYield": 12.6,
        "borrowersActive": 26,
        "avgBorrowingRate": 5.4,
        "idleCapital": 637_000.0,
        "utilizationRate": 0.65,
        "daoApr": 2.4,
        "source": "simulated",
    },
    "AGGRESSIVE_POOL": {
        "pool": "AGGRESSIVE_POOL",
        "totalDeposited": 940_000.0,
        "currentYield": 17.9,
        "borrowersActive": 19,
        "avgBorrowingRate": 7.1,
        "idleCapital": 235_000.0,
        "utilizationRate": 0.75,
        "daoApr": 3.1,
        "source": "simulated",
    },
}

_DEFAULT_POLICIES = {
    "CONSERVATIVE_POOL": {
        "poolId": "CONSERVATIVE_POOL",
        "tier1": {"canBorrow": False},
        "tier2": {"ltv": 0.45, "apr": 4.2},
        "tier3": {"ltv": 0.6, "apr": 3.9},
        "votedBy": [],
        "votedAt": "2026-03-07T00:00:00Z",
        "nextVoteWindow": "2026-03-14T00:00:00Z",
        "source": "simulated",
    },
    "MODERATE_POOL": {
        "poolId": "MODERATE_POOL",
        "tier1": {"canBorrow": False},
        "tier2": {"ltv": 0.55, "apr": 5.2},
        "tier3": {"ltv": 0.7, "apr": 4.8},
        "votedBy": [],
        "votedAt": "2026-03-07T00:00:00Z",
        "nextVoteWindow": "2026-03-14T00:00:00Z",
        "source": "simulated",
    },
    "AGGRESSIVE_POOL": {
        "poolId": "AGGRESSIVE_POOL",
        "tier1": {"canBorrow": False},
        "tier2": {"ltv": 0.62, "apr": 6.8},
        "tier3": {"ltv": 0.78, "apr": 6.1},
        "votedBy": [],
        "votedAt": "2026-03-07T00:00:00Z",
        "nextVoteWindow": "2026-03-14T00:00:00Z",
        "source": "simulated",
    },
}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _pool_key(pool: str) -> str:
    key = str(pool or "").strip().upper()
    if key not in POOL_IDS:
        raise ValueError(f"Unknown pool: {pool}")
    return key


def _tx_hash(*parts: Any) -> str:
    joined = "|".join(str(p) for p in parts)
    digest = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    return f"0x{digest[:64]}"


def _load_metrics() -> dict[str, dict[str, Any]]:
    raw = _metrics_store.all()
    data: dict[str, dict[str, Any]] = {}
    for pool_id in POOL_IDS:
        base = dict(_DEFAULT_METRICS[pool_id])
        base.update(raw.get(pool_id, {}))
        base["pool"] = pool_id
        base.setdefault("source", "simulated")
        base["updated_at"] = base.get("updated_at") or _now_iso()
        data[pool_id] = base
    return data


def _save_metrics(metrics: dict[str, dict[str, Any]]) -> None:
    for pool_id, payload in metrics.items():
        _metrics_store.set(pool_id, payload)


def _load_policies() -> dict[str, dict[str, Any]]:
    raw = _policy_store.all()
    out: dict[str, dict[str, Any]] = {}
    for pool_id in POOL_IDS:
        base = dict(_DEFAULT_POLICIES[pool_id])
        base.update(raw.get(pool_id, {}))
        base["poolId"] = pool_id
        base.setdefault("source", "simulated")
        out[pool_id] = base
    return out


class PrivacyPoolService:
    def get_pool_stats(self, pool: str) -> dict[str, Any]:
        pool_id = _pool_key(pool)
        metrics = _load_metrics()[pool_id]
        metrics["updated_at"] = _now_iso()
        return metrics

    def get_pool_liquidity(self, pool: str) -> dict[str, Any]:
        stats = self.get_pool_stats(pool)
        return {
            "pool": stats["pool"],
            "totalDeposited": float(stats.get("totalDeposited", 0.0)),
            "idleCapital": float(stats.get("idleCapital", 0.0)),
            "activeStrategies": 3,
            "utilizationRate": float(stats.get("utilizationRate", 0.0)),
            "source": stats.get("source", "simulated"),
            "updated_at": stats.get("updated_at"),
        }

    def get_lending_policy(self, pool: str) -> dict[str, Any]:
        pool_id = _pool_key(pool)
        return _load_policies()[pool_id]

    def get_active_loans(self, pool: str) -> list[dict[str, Any]]:
        pool_id = _pool_key(pool)
        existing = _loans_store.get(pool_id)
        if isinstance(existing, list):
            return existing
        # deterministic seeded demo loans
        seeded = [
            {
                "loanId": f"{pool_id.lower()}-loan-1",
                "amount": 42_000.0,
                "rate": 5.8,
                "tier": "Tier2",
                "status": "active",
                "createdAt": "2026-03-06T18:00:00Z",
                "source": "simulated",
            },
            {
                "loanId": f"{pool_id.lower()}-loan-2",
                "amount": 65_000.0,
                "rate": 6.1,
                "tier": "Tier3",
                "status": "active",
                "createdAt": "2026-03-06T23:30:00Z",
                "source": "simulated",
            },
        ]
        _loans_store.set(pool_id, seeded)
        return seeded

    def get_yield_distributions(self) -> list[dict[str, Any]]:
        raw = _yield_store.all()
        if raw:
            rows = list(raw.values())
            rows.sort(key=lambda r: str(r.get("timestamp", "")), reverse=True)
            return rows
        seeded = [
            {
                "id": "dist-001",
                "pool": "CONSERVATIVE_POOL",
                "amount": 12_450.0,
                "timestamp": "2026-03-01T00:00:00Z",
                "reason": "monthly",
                "source": "simulated",
            },
            {
                "id": "dist-002",
                "pool": "MODERATE_POOL",
                "amount": 18_220.0,
                "timestamp": "2026-03-01T00:00:00Z",
                "reason": "monthly",
                "source": "simulated",
            },
            {
                "id": "dist-003",
                "pool": "AGGRESSIVE_POOL",
                "amount": 16_980.0,
                "timestamp": "2026-03-01T00:00:00Z",
                "reason": "monthly",
                "source": "simulated",
            },
        ]
        for item in seeded:
            _yield_store.set(str(item["id"]), item)
        return seeded

    def get_user_positions(self, address: str) -> dict[str, Any]:
        key = str(address or "").strip().lower()
        return _positions_store.get(key) or {"address": address, "pools": {}, "updated_at": _now_iso()}

    def deposit(
        self,
        pool: str,
        amount: float,
        address: str,
        privacy_mode: str = "public",
        source: str = "simulated",
    ) -> dict[str, Any]:
        pool_id = _pool_key(pool)
        if amount <= 0:
            raise ValueError("Deposit amount must be greater than 0")

        metrics = _load_metrics()
        m = metrics[pool_id]
        total_before = float(m.get("totalDeposited", 0.0))
        idle_ratio_target = {
            "CONSERVATIVE_POOL": 0.45,
            "MODERATE_POOL": 0.35,
            "AGGRESSIVE_POOL": 0.25,
        }[pool_id]

        total_after = total_before + amount
        idle_after = max(0.0, float(m.get("idleCapital", 0.0)) + (amount * idle_ratio_target))
        util_after = (total_after - idle_after) / total_after if total_after > 0 else 0.0

        m["totalDeposited"] = round(total_after, 6)
        m["idleCapital"] = round(idle_after, 6)
        m["utilizationRate"] = round(max(0.0, min(0.99, util_after)), 6)
        m["updated_at"] = _now_iso()
        m["source"] = source
        _save_metrics(metrics)

        key = str(address or "").strip().lower()
        pos = _positions_store.get(key) or {"address": address, "pools": {}, "updated_at": _now_iso()}
        pools = pos.setdefault("pools", {})
        pool_pos = pools.get(pool_id, {"deposited_amount": 0.0})
        pool_pos["deposited_amount"] = round(float(pool_pos.get("deposited_amount", 0.0)) + amount, 6)
        pool_pos["updated_at"] = _now_iso()
        pool_pos["source"] = source
        pools[pool_id] = pool_pos
        pos["updated_at"] = _now_iso()
        _positions_store.set(key, pos)

        tx_hash = _tx_hash("deposit", pool_id, address, amount, privacy_mode, pos["updated_at"])
        commitment = _tx_hash("commitment", tx_hash) if privacy_mode != "public" else None
        pool_share = amount / max(total_after, 1.0)
        return {
            "id": f"dep-{tx_hash[2:10]}",
            "pool": pool_id,
            "amount": round(amount, 6),
            "privacyMode": privacy_mode,
            "poolShare": round(pool_share, 8),
            "txHash": tx_hash,
            "timestamp": _now_iso(),
            "commitment": commitment,
            "source": source,
            "userPosition": pool_pos["deposited_amount"],
        }

    def withdraw(
        self,
        pool: str,
        amount: float,
        address: str,
        source: str = "simulated",
    ) -> dict[str, Any]:
        pool_id = _pool_key(pool)
        if amount <= 0:
            raise ValueError("Withdrawal amount must be greater than 0")

        key = str(address or "").strip().lower()
        pos = _positions_store.get(key) or {"address": address, "pools": {}, "updated_at": _now_iso()}
        pools = pos.setdefault("pools", {})
        pool_pos = pools.get(pool_id, {"deposited_amount": 0.0})
        current_amount = float(pool_pos.get("deposited_amount", 0.0))
        if amount > current_amount:
            raise ValueError("Insufficient deposited balance for withdrawal")

        remaining = current_amount - amount
        pool_pos["deposited_amount"] = round(remaining, 6)
        pool_pos["updated_at"] = _now_iso()
        pool_pos["source"] = source
        pools[pool_id] = pool_pos
        pos["updated_at"] = _now_iso()
        _positions_store.set(key, pos)

        metrics = _load_metrics()
        m = metrics[pool_id]
        total_before = float(m.get("totalDeposited", 0.0))
        total_after = max(0.0, total_before - amount)
        idle_after = max(0.0, float(m.get("idleCapital", 0.0)) - amount * 0.4)
        util_after = (total_after - idle_after) / total_after if total_after > 0 else 0.0
        m["totalDeposited"] = round(total_after, 6)
        m["idleCapital"] = round(idle_after, 6)
        m["utilizationRate"] = round(max(0.0, min(0.99, util_after)), 6)
        m["updated_at"] = _now_iso()
        m["source"] = source
        _save_metrics(metrics)

        tx_hash = _tx_hash("withdraw", pool_id, address, amount, pos["updated_at"])
        return {
            "id": f"wd-{tx_hash[2:10]}",
            "pool": pool_id,
            "amount": round(amount, 6),
            "address": address,
            "txHash": tx_hash,
            "timestamp": _now_iso(),
            "source": source,
            "userPosition": round(remaining, 6),
        }

    def create_governance_proposal(self, pool: str, payload: dict[str, Any]) -> dict[str, Any]:
        pool_id = _pool_key(pool)
        proposal_id = f"prop-{int(time.time() * 1000)}"
        proposal = {
            "proposalId": proposal_id,
            "pool": pool_id,
            "createdAt": _now_iso(),
            "status": "open",
            "source": "simulated",
            **payload,
        }
        _proposal_store.set(proposal_id, proposal)
        return proposal


_svc: PrivacyPoolService | None = None


def get_privacy_pool_service() -> PrivacyPoolService:
    global _svc
    if _svc is None:
        _svc = PrivacyPoolService()
    return _svc
