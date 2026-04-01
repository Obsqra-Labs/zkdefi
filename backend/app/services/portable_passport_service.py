"""
Portable Passport Service — canonical PPP aggregator.

Composes over existing singleton services to produce a single Portable Passport
Profile (PPP v1) object consumed by /profile, /passport, and execution surfaces.

Design rules:
- Always return a valid PPP, even when upstream sources are degraded.
- Record source health per data source so the frontend can show partial-load indicators.
- Reuse existing parallel-fetch pattern from risk_profile._build_bundle().
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Address validation
# ---------------------------------------------------------------------------

_HEX_RE = re.compile(r"^0x[0-9a-fA-F]{1,64}$")


def _valid_address(address: str) -> bool:
    return bool(_HEX_RE.match((address or "").strip()))


# ---------------------------------------------------------------------------
# Source health record
# ---------------------------------------------------------------------------

class SourceHealth:
    __slots__ = ("name", "status", "latency_ms", "error")

    def __init__(self, name: str) -> None:
        self.name = name
        self.status: str = "pending"
        self.latency_ms: float = 0.0
        self.error: str | None = None

    def ok(self, latency_ms: float) -> None:
        self.status = "ok"
        self.latency_ms = latency_ms

    def fail(self, latency_ms: float, error: str) -> None:
        self.status = "error"
        self.latency_ms = latency_ms
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"name": self.name, "status": self.status, "latency_ms": round(self.latency_ms, 1)}
        if self.error:
            d["error"] = self.error
        return d


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _tier_name(tier: int) -> str:
    if tier <= 0:
        return "Strict"
    if tier == 1:
        return "Standard"
    return "Express"


def _letter_rating(composite: int) -> str:
    if composite >= 80:
        return "A"
    if composite >= 60:
        return "B"
    if composite >= 40:
        return "C"
    return "D"


def _compute_receipt_root(receipts: list[dict[str, Any]]) -> str:
    """Deterministic hash over receipt IDs for evidence binding."""
    if not receipts:
        return "0x0"
    ids = sorted(str(r.get("receipt_id") or "") for r in receipts if isinstance(r, dict))
    digest = hashlib.sha256("|".join(ids).encode()).hexdigest()
    return f"0x{digest[:40]}"


def _compute_policy_hash(decisions: dict[str, Any]) -> str:
    """Deterministic hash over decision gate state for provenance."""
    canonical = json.dumps(decisions, sort_keys=True, separators=(",", ":"))
    return f"0x{hashlib.sha256(canonical.encode()).hexdigest()[:40]}"


async def _timed(health: SourceHealth, coro):
    """Run a coroutine with timing and error capture."""
    t0 = time.monotonic()
    try:
        result = await coro
        health.ok((time.monotonic() - t0) * 1000)
        return result
    except Exception as exc:
        health.fail((time.monotonic() - t0) * 1000, str(exc)[:120])
        return None


# ---------------------------------------------------------------------------
# PPP Builder
# ---------------------------------------------------------------------------

async def _fetch_reputation_bundle(address: str, request=None) -> tuple[dict[str, Any] | None, SourceHealth]:
    """Fetch the risk_profile v2 bundle via internal service calls (not HTTP round-trip)."""
    health = SourceHealth("risk_profile_bundle")
    t0 = time.monotonic()
    try:
        from app.api.risk_profile import _build_bundle
        # _build_bundle needs a Request for base URL resolution; fall back if absent
        if request is not None:
            bundle = await _build_bundle(address, request)
        else:
            # Direct service call path when no Request context is available
            bundle = await _build_bundle_direct(address)
        health.ok((time.monotonic() - t0) * 1000)
        return bundle, health
    except Exception as exc:
        health.fail((time.monotonic() - t0) * 1000, str(exc)[:120])
        return None, health


async def _build_bundle_direct(address: str) -> dict[str, Any]:
    """Lightweight bundle builder for when no FastAPI Request is available."""
    from app.services.position_scanner import get_portfolio_summary_best_effort

    portfolio = await get_portfolio_summary_best_effort(address)
    return {
        "address": address,
        "reputation": None,
        "risk_passport": None,
        "onboarding": None,
        "linked_addresses": {},
        "compliance_summary": {"count": 0, "profiles": []},
        "session_summary": {"count": 0, "active_count": 0, "sessions": []},
        "dual_wallet_session": {"active": False, "status": "missing"},
        "governance": None,
        "portfolio_summary": portfolio if isinstance(portfolio, dict) else None,
    }


async def _fetch_receipts(address: str) -> tuple[list[dict[str, Any]], SourceHealth]:
    health = SourceHealth("receipts")
    t0 = time.monotonic()
    try:
        from app.services.receipt_service import get_receipt_service
        receipts = await get_receipt_service().get_user_receipts(address)
        health.ok((time.monotonic() - t0) * 1000)
        return receipts or [], health
    except Exception as exc:
        health.fail((time.monotonic() - t0) * 1000, str(exc)[:120])
        return [], health


async def _fetch_proofs(address: str) -> tuple[list[dict[str, Any]], SourceHealth]:
    health = SourceHealth("proof_registry")
    t0 = time.monotonic()
    try:
        from app.services.proof_registry import get_proof_registry
        records = get_proof_registry().list_proofs(user_address=address, limit=50)
        proof_dicts = [r.to_dict() for r in records]
        health.ok((time.monotonic() - t0) * 1000)
        return proof_dicts, health
    except Exception as exc:
        health.fail((time.monotonic() - t0) * 1000, str(exc)[:120])
        return [], health


def _build_ppp(
    address: str,
    bundle: dict[str, Any] | None,
    decision_payload: dict[str, Any] | None,
    receipts: list[dict[str, Any]],
    proofs: list[dict[str, Any]],
    source_health: list[SourceHealth],
) -> dict[str, Any]:
    """Assemble the canonical PPP v1 object from collected sources."""

    rep = (bundle or {}).get("reputation") or {}
    passport = (bundle or {}).get("risk_passport") or {}
    onboarding = (bundle or {}).get("onboarding") or {}
    linked = (bundle or {}).get("linked_addresses") or {}
    sessions = (bundle or {}).get("session_summary") or {}
    portfolio = (bundle or {}).get("portfolio_summary") or {}
    governance = (bundle or {}).get("governance") or {}

    decisions = (decision_payload or {}).get("decisions") or {}

    tier = _to_int(rep.get("tier"), 0)
    composite = _to_int(passport.get("composite_score"), 0)
    letter = passport.get("letter_rating") or _letter_rating(composite)

    # Linked addresses as flat list
    linked_addrs: list[str] = []
    if isinstance(linked, dict):
        for key in ("eth", "arb", "base", "opt"):
            addr = linked.get(key)
            if isinstance(addr, str) and addr.strip():
                linked_addrs.append(addr.strip())

    # Builder activity from receipts
    deploy_receipts = [r for r in receipts if isinstance(r, dict) and r.get("action_type") in ("deploy", "deployment")]
    verified_receipts = [r for r in receipts if isinstance(r, dict) and r.get("on_chain")]

    # Proof refs for evidence
    proof_refs = [p.get("proof_hash", "") for p in proofs if isinstance(p, dict) and p.get("proof_hash")]

    # Circuit names from proofs
    circuit_names = list({p.get("model_name", "") for p in proofs if isinstance(p, dict) and p.get("model_name")})

    # Execution eligibility from decision engine
    exec_decision = decisions.get("execution") or {}
    lending_decision = decisions.get("lending") or {}

    # On-chain activity from reputation enrichment
    on_chain = rep.get("on_chain") or {}

    return {
        "version": "ppp.v1",
        "subject": {
            "starknet_address": address,
            "subject_id": f"did:zkdefi:{address.lower()}",
        },
        "identity": {
            "linked_addresses": linked_addrs,
            "session_state": {
                "count": _to_int(sessions.get("count")),
                "active_count": _to_int(sessions.get("active_count")),
            },
            "privacy_mode": "selective",
        },
        "reputation": {
            "tier": tier,
            "tier_name": rep.get("tier_name") or _tier_name(tier),
            "score": composite,
            "credit_score": passport.get("credit_score"),
            "letter_rating": letter,
            "tenure_days": _to_int(rep.get("tenure_days")),
            "successful_txns": _to_int(rep.get("successful_txns")),
            "failed_txns": _to_int(rep.get("failed_txns")),
            "transaction_count": _to_int(rep.get("transaction_count")),
            "total_volume_eth": _to_float(rep.get("total_volume_eth")),
            "collateral_eth": _to_float(rep.get("collateral_eth")),
            "gates": rep.get("gates") or {},
            "upgrade_eligible": bool(rep.get("upgrade_eligible")),
            "upgrade_requirements": rep.get("upgrade_requirements"),
        },
        "activity": {
            "builder": {
                "deploy_count": len(deploy_receipts),
                "verified_receipt_count": len(verified_receipts),
                "proof_count": len(proofs),
            },
            "defi": {
                "tvl_usd": _to_float(portfolio.get("total_value_usd") or on_chain.get("total_value_usd")),
                "protocol_count": _to_int(portfolio.get("protocol_count") or on_chain.get("protocol_count")),
                "position_count": _to_int(portfolio.get("position_count") or on_chain.get("position_count")),
                "protocols_active": on_chain.get("protocols_active") or portfolio.get("protocols_found") or [],
                "turnover_30d_usd": _to_float(rep.get("total_volume_eth")) * 2000,
                "lending_value_usd": _to_float(on_chain.get("lending_value_usd")),
                "staking_value_usd": _to_float(on_chain.get("staking_value_usd")),
                "wallet_value_usd": _to_float(on_chain.get("wallet_value_usd")),
            },
            "on_chain": {
                "starknet_nonce": _to_int(on_chain.get("starknet_nonce")),
                "bridge_deposit_count": _to_int(on_chain.get("bridge_deposit_count")),
                "bridge_total_eth": _to_float(on_chain.get("bridge_total_eth")),
                "bridge_deposits": on_chain.get("bridge_deposits") or [],
                "collateral_eth": _to_float(on_chain.get("collateral_eth")),
                "total_value_usd": _to_float(on_chain.get("total_value_usd")),
                "account_age_days": _to_int(on_chain.get("account_age_days")),
                "swap_count": _to_int(on_chain.get("swap_count")),
                "first_tx_timestamp": _to_int(on_chain.get("first_tx_timestamp")),
            },
        },
        "evidence": {
            "receipt_root": _compute_receipt_root(receipts),
            "portfolio_snapshot_hash": portfolio.get("snapshot_hash") or "0x0",
            "proof_registry_refs": proof_refs[:20],
        },
        "claims": {
            "execution_eligibility": {
                "allowed": exec_decision.get("mode") == "allow",
                "mode": exec_decision.get("mode", "advisory"),
                "reason_codes": exec_decision.get("reason_codes", []),
                "confidence_band": "high" if exec_decision.get("mode") == "allow" else "low",
            },
            "lending_eligibility": {
                "allowed": lending_decision.get("mode") == "allow",
                "mode": lending_decision.get("mode", "advisory"),
                "max_ltv": _to_float((lending_decision.get("limits") or {}).get("total_line_eth")),
                "reason_codes": lending_decision.get("reason_codes", []),
            },
            "risk_posture": {
                "label": "conservative" if tier <= 0 else ("balanced" if tier == 1 else "aggressive"),
                "tier": tier,
                "composite_score": composite,
            },
        },
        "provenance": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "policy_hash": _compute_policy_hash(decisions),
            "circuits": circuit_names,
            "proof_mode": "hybrid" if proofs else "advisory",
        },
        "source_health": [h.to_dict() for h in source_health],
    }


def _redact_public(ppp: dict[str, Any]) -> dict[str, Any]:
    """Produce a public card: strip sensitive values, band scores."""
    import copy
    out = copy.deepcopy(ppp)

    # Band the score instead of exact value
    score = _to_int(out.get("reputation", {}).get("score"))
    if score >= 80:
        band = "80+"
    elif score >= 60:
        band = "60-79"
    elif score >= 40:
        band = "40-59"
    else:
        band = "<40"
    out["reputation"]["score"] = band
    out["reputation"].pop("credit_score", None)

    # Remove exact DeFi balances
    defi = out.get("activity", {}).get("defi", {})
    tvl = _to_float(defi.get("tvl_usd"))
    if tvl >= 100_000:
        defi["tvl_usd"] = "100k+"
    elif tvl >= 10_000:
        defi["tvl_usd"] = "10k-100k"
    elif tvl >= 1_000:
        defi["tvl_usd"] = "1k-10k"
    else:
        defi["tvl_usd"] = "<1k"
    defi.pop("turnover_30d_usd", None)

    # Strip lending limits
    lending = out.get("claims", {}).get("lending_eligibility", {})
    lending.pop("max_ltv", None)
    lending.pop("reason_codes", None)

    # Strip session details
    out.get("identity", {}).pop("session_state", None)

    # Strip source health from public view
    out.pop("source_health", None)

    return out


def _extract_evidence(ppp: dict[str, Any]) -> dict[str, Any]:
    """Extract evidence pointers only."""
    return {
        "version": ppp.get("version"),
        "subject": ppp.get("subject"),
        "evidence": ppp.get("evidence"),
        "provenance": ppp.get("provenance"),
    }


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------

class PortablePassportService:
    """Aggregates existing services into a canonical PPP v1 payload."""

    async def get_passport(self, address: str, *, request=None) -> dict[str, Any]:
        """Build the full PPP for an address.

        Args:
            address: Starknet address (must start with 0x).
            request: Optional FastAPI Request for internal API resolution.

        Returns:
            Full PPP v1 dict, always valid even when sources are degraded.
        """
        if not _valid_address(address):
            raise ValueError(f"Invalid address format: {address}")

        # Parallel fetch all sources
        bundle_task = asyncio.create_task(_fetch_reputation_bundle(address, request))
        receipts_task = asyncio.create_task(_fetch_receipts(address))
        proofs_task = asyncio.create_task(_fetch_proofs(address))

        bundle, bundle_health = await bundle_task
        receipts, receipts_health = await receipts_task
        proofs, proofs_health = await proofs_task

        # Run decision engine if bundle is available
        decision_payload = None
        decision_health = SourceHealth("decision_engine")
        if bundle is not None:
            t0 = time.monotonic()
            try:
                from app.services.profile_decision_service import get_profile_decision_service
                decision_payload = get_profile_decision_service().evaluate(bundle)
                decision_health.ok((time.monotonic() - t0) * 1000)
            except Exception as exc:
                decision_health.fail((time.monotonic() - t0) * 1000, str(exc)[:120])
        else:
            decision_health.fail(0, "bundle unavailable")

        source_health = [bundle_health, decision_health, receipts_health, proofs_health]

        return _build_ppp(address, bundle, decision_payload, receipts, proofs, source_health)

    async def get_public_card(self, address: str, *, request=None) -> dict[str, Any]:
        """Build a redacted public card suitable for sharing."""
        ppp = await self.get_passport(address, request=request)
        return _redact_public(ppp)

    async def get_evidence(self, address: str, *, request=None) -> dict[str, Any]:
        """Extract evidence pointers only (lightweight)."""
        ppp = await self.get_passport(address, request=request)
        return _extract_evidence(ppp)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: PortablePassportService | None = None


def get_portable_passport_service() -> PortablePassportService:
    global _instance
    if _instance is None:
        _instance = PortablePassportService()
    return _instance
