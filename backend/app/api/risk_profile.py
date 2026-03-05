"""
Risk Profile API — single composable bundle for profile UI and gating.

GET /risk_profile/{address} composes:
- reputation user
- risk_passport user
- onboarding status
- linked_addresses
- compliance profiles (summary)
- session_keys list (summary)

GET /risk_profile/v2/{address} adds canonical trust decisions used by relayer,
policy preview, lending, and UI explainability.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncio
import httpx
from fastapi import APIRouter, Request

from app.services.profile_decision_service import get_profile_decision_service
from app.services.credit_line_service import compute_predictive_credit_line

router = APIRouter(prefix="/risk_profile", tags=["risk_profile"])


async def _fetch(
    client: httpx.AsyncClient,
    base: str,
    path: str,
) -> tuple[dict[str, Any] | list[Any] | None, bool]:
    """GET path under base; return (parsed json or None, ok)."""
    url = f"{base}{path}"
    try:
        r = await client.get(url, timeout=12.0)
        if r.status_code != 200:
            return None, False
        return r.json(), True
    except Exception:
        return None, False


def _resolve_base(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    if base.startswith("http"):
        return base
    host, port = request.scope.get("server", ("localhost", 8000))
    root_path = request.scope.get("root_path", "")
    return f"http://{host}:{port}{root_path}".rstrip("/")


async def _build_bundle(address: str, request: Request) -> dict[str, Any]:
    base = _resolve_base(request)

    async with httpx.AsyncClient(timeout=15.0) as client:
        paths = [
            f"/api/v1/zkdefi/reputation/user/{address}",
            f"/api/v1/zkdefi/risk_passport/user/{address}",
            f"/api/v1/zkdefi/onboarding/status/{address}",
            f"/api/v1/zkdefi/linked_addresses/{address}",
            f"/api/v1/zkdefi/compliance/profiles/{address}",
            f"/api/v1/zkdefi/session_keys/list/{address}",
            f"/api/v1/zkdefi/auth/session/{address}",
        ]
        results = await asyncio.gather(*[_fetch(client, base, p) for p in paths])

        rep, rep_ok = results[0]
        passport, passport_ok = results[1]
        onboarding, onb_ok = results[2]
        linked, linked_ok = results[3]
        compliance, comp_ok = results[4]
        sessions_res, sess_ok = results[5]
        dual_session_res, dual_ok = results[6]

    if linked_ok and isinstance(linked, dict):
        linked_payload = {k: v for k, v in linked.items() if v is not None}
    else:
        linked_payload = {}

    if sess_ok and isinstance(sessions_res, dict):
        session_summary = {
            "count": sessions_res.get("count", 0),
            "active_count": sessions_res.get("active_count", 0),
            "sessions": sessions_res.get("sessions", []),
        }
    else:
        session_summary = {"count": 0, "active_count": 0, "sessions": []}

    compliance_list = compliance if (comp_ok and isinstance(compliance, list)) else []
    compliance_summary = {
        "count": len(compliance_list),
        "profiles": compliance_list[:10],
    }
    dual_wallet_session: dict[str, Any]
    if dual_ok and isinstance(dual_session_res, dict):
        dual_wallet_session = {
            "active": bool(dual_session_res.get("active", False)),
            "status": dual_session_res.get("status", "missing"),
            "chain": dual_session_res.get("chain"),
            "evm_address": dual_session_res.get("evm_address"),
            "expires_at": dual_session_res.get("expires_at"),
            "verified_at": dual_session_res.get("verified_at"),
            "session_id": dual_session_res.get("session_id"),
            "identity_binding": dual_session_res.get("identity_binding"),
            "auth_provider": dual_session_res.get("auth_provider"),
            "credential_summary": dual_session_res.get("credential_summary"),
            "history": dual_session_res.get("history", []),
        }
    else:
        dual_wallet_session = {
            "active": False,
            "status": "missing",
            "chain": None,
            "evm_address": None,
            "expires_at": None,
            "verified_at": None,
            "session_id": None,
            "identity_binding": None,
            "auth_provider": None,
            "credential_summary": None,
            "history": [],
        }

    return {
        "address": address,
        "reputation": rep if rep_ok else None,
        "risk_passport": passport if passport_ok else None,
        "onboarding": onboarding if onb_ok else None,
        "linked_addresses": linked_payload,
        "compliance_summary": compliance_summary,
        "session_summary": session_summary,
        "dual_wallet_session": dual_wallet_session,
    }


@router.get("/{address}")
async def get_risk_profile(address: str, request: Request, format: str | None = None):
    """
    Get the full Risk Profile bundle for an address.

    Query:
      format=erc8004 — return ERC-8004 portable identity shape instead of raw bundle.
    """
    bundle = await _build_bundle(address, request)
    if (format or "").strip().lower() == "erc8004":
        return _to_erc8004(bundle)
    return bundle


@router.get("/v2/{address}")
async def get_risk_profile_v2(address: str, request: Request):
    """Risk Profile v2: canonical identity + passport + decision payload."""
    bundle = await _build_bundle(address, request)
    decision_payload = get_profile_decision_service().evaluate(bundle)

    onboarding = bundle.get("onboarding") or {}
    rep = bundle.get("reputation") or {}
    passport = bundle.get("risk_passport") or {}
    linked = bundle.get("linked_addresses") or {}
    sessions = bundle.get("session_summary") or {}
    dual_session = bundle.get("dual_wallet_session") or {}
    if not isinstance(dual_session, dict):
        dual_session = {}

    verification = linked.get("verification") if isinstance(linked, dict) else None
    if not isinstance(verification, dict):
        verification = {}

    linked_entries: list[dict[str, Any]] = []
    chain_map = {
        "eth": "ethereum",
        "arb": "arbitrum",
        "base": "base",
        "opt": "optimism",
    }
    for key, chain_name in chain_map.items():
        value = linked.get(key) if isinstance(linked, dict) else None
        if not value:
            continue
        meta = verification.get(key) if isinstance(verification, dict) else {}
        if not isinstance(meta, dict):
            meta = {}
        linked_entries.append(
            {
                "chain": chain_name,
                "address": value,
                "verified": bool(meta.get("verified", False)),
                "verified_at": meta.get("verified_at"),
            }
        )

    proof_receipts = passport.get("proof_receipts") if isinstance(passport, dict) else None
    receipt_list = proof_receipts if isinstance(proof_receipts, list) else []
    by_type: dict[str, int] = {}
    for row in receipt_list:
        if not isinstance(row, dict):
            continue
        proof_type = str(row.get("proof_type") or "unknown")
        by_type[proof_type] = int(by_type.get(proof_type, 0)) + 1

    # v6: Predictive credit from XGBoost model (graceful fallback)
    predictive_credit = None
    try:
        from app.ml.creditworthiness.predictor import get_creditworthiness_predictor
        predictor = get_creditworthiness_predictor()
        pred_result = await predictor.predict(address, generate_proof=True)
        collateral_eth = float(rep.get("collateral_eth", 0.0) or 0.0)
        pred_credit_line = await compute_predictive_credit_line(
            user_address=address,
            collateral_eth=collateral_eth,
            tier=int(rep.get("tier", 0) or 0),
            linked_address_count=len(linked_entries),
            cross_chain_verified=len(linked_entries) > 0,
        )
        pred_terms = pred_result.get("terms") or {}
        pred_grade = pred_result.get("credit_class", "C")
        is_fallback = pred_result.get("fallback", False)
        predictive_credit = {
            "grade": pred_grade,
            "grade_confidence": pred_result.get("confidence", 0.0),
            "max_ltv": pred_terms.get("ltv", 0.5),
            "rate_bps": pred_terms.get("rate_bps", 1000),
            "credit_line_eth": pred_credit_line.total_line_eth,
            "collaborative_multiplier": pred_credit_line.collaborative_multiplier,
            "model_name": pred_result.get("model_name", "fallback" if is_fallback else "creditworthiness_xgboost"),
            "model_hash": pred_result.get("model_hash"),
            "proof_hash": (pred_result.get("proof") or {}).get("proof_hash"),
            "proof_hex": (pred_result.get("proof") or {}).get("proof_hex"),
        }
    except Exception:
        pass  # Graceful: predictive_credit stays None

    out = {
        "profile_version": "2.0",
        "address": address,
        "identity": {
            "has_agent": bool(onboarding.get("has_agent", False)),
            "identity_commitment": onboarding.get("identity_commitment"),
            "linked_addresses": linked_entries,
            "session_summary": {
                "count": sessions.get("count", 0),
                "active_count": sessions.get("active_count", 0),
            },
            "dual_wallet_session": {
                "active": bool(dual_session.get("active", False)),
                "status": dual_session.get("status", "missing"),
                "chain": dual_session.get("chain"),
                "evm_address": dual_session.get("evm_address"),
                "expires_at": dual_session.get("expires_at"),
                "verified_at": dual_session.get("verified_at"),
                "identity_binding": dual_session.get("identity_binding"),
                "auth_provider": dual_session.get("auth_provider"),
                "credential_summary": dual_session.get("credential_summary"),
                "history_count": len(dual_session.get("history", []))
                if isinstance(dual_session.get("history"), list)
                else 0,
            },
        },
        "reputation": {
            "tier": rep.get("tier", 0),
            "tier_name": rep.get("tier_name", "Strict"),
            "tenure_days": rep.get("tenure_days", 0),
            "transaction_count": rep.get("transaction_count", 0),
            "successful_txns": rep.get("successful_txns", 0),
            "collateral_eth": rep.get("collateral_eth", 0.0),
            "total_volume_eth": rep.get("total_volume_eth", 0.0),
        },
        "passport": {
            "composite_score": passport.get("composite_score", 0),
            "letter_rating": passport.get("letter_rating", "D"),
            "tier": passport.get("tier", 0),
            "tier_name": passport.get("tier_name", "Strict"),
            "credit_tier": passport.get("credit_tier"),
            "credit_score": passport.get("credit_score"),
            "receipt_summary": {
                "count": len(receipt_list),
                "by_type": by_type,
            },
        },
        "predictive_credit": predictive_credit,
        "decisions": decision_payload.get("decisions", {}),
        "disclosures": decision_payload.get("disclosures", {}),
        "feature_flags": decision_payload.get("feature_flags", {}),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    return out


def _to_erc8004(bundle: dict[str, Any]) -> dict[str, Any]:
    """Project Risk Profile bundle to ERC-8004 portable identity shape."""
    rep = bundle.get("reputation") or {}
    passport = bundle.get("risk_passport") or {}
    onboarding = bundle.get("onboarding") or {}
    sessions = bundle.get("session_summary") or {}
    dual_session = bundle.get("dual_wallet_session") or {}
    compliance = bundle.get("compliance_summary") or {}

    tier = rep.get("tier", 0)
    tier_name = rep.get("tier_name", "Strict")
    letter = passport.get("letter_rating", "D")
    composite = passport.get("composite_score", 0)
    credit_tier = passport.get("credit_tier")
    credit_score = passport.get("credit_score")

    identity_card = {
        "agent_name": "zkdefi_agent",
        "reputation_score": composite,
        "privacy_tier": tier_name,
        "tier": tier,
        "letter_rating": letter,
        "credit_tier": credit_tier,
        "credit_score": credit_score,
    }

    reputation_slice = {
        "tier": tier,
        "tier_name": tier_name,
        "tenure_days": rep.get("tenure_days", 0),
        "successful_txns": rep.get("successful_txns", 0),
        "collateral_eth": rep.get("collateral_eth", 0.0),
        "total_volume_eth": rep.get("total_volume_eth", 0.0),
    }

    validations = {
        "has_agent": onboarding.get("has_agent", False),
        "fact_hash": onboarding.get("fact_hash"),
        "identity_commitment": onboarding.get("identity_commitment"),
    }

    session_summary_slice = {
        "active_count": sessions.get("active_count", 0),
        "count": sessions.get("count", 0),
        "dual_wallet_active": bool(dual_session.get("active", False))
        if isinstance(dual_session, dict)
        else False,
    }

    disclosure_summary = {
        "profile_count": compliance.get("count", 0),
    }

    return {
        "identity_card": identity_card,
        "reputation": reputation_slice,
        "validations": validations,
        "session_summary": session_summary_slice,
        "disclosure_summary": disclosure_summary,
    }
