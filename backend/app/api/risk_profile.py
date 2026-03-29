"""
Risk Profile API — single composable bundle for profile UI and gating.

GET /risk_profile/{address} composes:
- reputation user
- risk_passport user
- onboarding status
- linked_addresses
- compliance profiles (summary)
- session_keys list (summary)
- governance voting power snapshot
- portfolio summary snapshot

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
from app.services.position_scanner import get_portfolio_summary_best_effort
from app.services.portable_identity_service import get_portable_identity_service
from app.services.trust_event_service import log_trust_event_if_changed
from app.services.trust_version_matrix import get_backend_trust_flags, get_trust_version_matrix

router = APIRouter(prefix="/risk_profile", tags=["risk_profile"])


async def _fetch(
    client: httpx.AsyncClient,
    base: str,
    path: str,
    *,
    timeout: float = 12.0,
) -> tuple[dict[str, Any] | list[Any] | None, bool]:
    """GET path under base; return (parsed json or None, ok)."""
    url = f"{base}{path}"
    try:
        r = await client.get(url, timeout=timeout)
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
    portfolio_task = asyncio.create_task(get_portfolio_summary_best_effort(address))

    async with httpx.AsyncClient(timeout=15.0) as client:
        fetch_specs = [
            (f"/api/v1/zkdefi/reputation/user/{address}", 12.0),
            (f"/api/v1/zkdefi/risk_passport/user/{address}", 12.0),
            (f"/api/v1/zkdefi/onboarding/status/{address}", 12.0),
            (f"/api/v1/zkdefi/linked_addresses/{address}", 12.0),
            (f"/api/v1/zkdefi/compliance/profiles/{address}", 12.0),
            (f"/api/v1/zkdefi/session_keys/list/{address}", 12.0),
            (f"/api/v1/zkdefi/auth/session/{address}", 12.0),
            (f"/api/v1/dao/voting_power/{address}", 1.5),
        ]
        results = await asyncio.gather(*[_fetch(client, base, path, timeout=timeout) for path, timeout in fetch_specs])
        portfolio_res = await portfolio_task

        rep, rep_ok = results[0]
        passport, passport_ok = results[1]
        onboarding, onb_ok = results[2]
        linked, linked_ok = results[3]
        compliance, comp_ok = results[4]
        sessions_res, sess_ok = results[5]
        dual_session_res, dual_ok = results[6]
        governance_res, gov_ok = results[7]

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
        "governance": governance_res if (gov_ok and isinstance(governance_res, dict)) else None,
        "portfolio_summary": portfolio_res if isinstance(portfolio_res, dict) else None,
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
    version_matrix = get_trust_version_matrix()
    trust_flags = get_backend_trust_flags()

    onboarding = bundle.get("onboarding") or {}
    rep = bundle.get("reputation") or {}
    passport = bundle.get("risk_passport") or {}
    linked = bundle.get("linked_addresses") or {}
    sessions = bundle.get("session_summary") or {}
    dual_session = bundle.get("dual_wallet_session") or {}
    governance = bundle.get("governance") or {}
    portfolio_summary = bundle.get("portfolio_summary") or {}
    if not isinstance(dual_session, dict):
        dual_session = {}
    if not isinstance(governance, dict):
        governance = {}
    if not isinstance(portfolio_summary, dict):
        portfolio_summary = {}

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
        pred_result = await asyncio.wait_for(
            predictor.predict(address, generate_proof=False),
            timeout=2.5,
        )
        collateral_eth = float(rep.get("collateral_eth", 0.0) or 0.0)
        pred_credit_line = await compute_predictive_credit_line(
            user_address=address,
            collateral_eth=collateral_eth,
            tier=int(rep.get("tier", 0) or 0),
            linked_address_count=len(linked_entries),
            cross_chain_verified=len(linked_entries) > 0,
            generate_proof=False,
        )
        pred_terms = pred_result.get("terms") or {}
        pred_grade = pred_result.get("credit_class", "C")
        is_fallback = pred_result.get("fallback", False)
        collateral_eth_val = float(rep.get("collateral_eth", 0.0) or 0.0)
        max_ltv = (
            pred_credit_line.collateral_line_eth / collateral_eth_val
            if collateral_eth_val > 0
            else (pred_terms.get("ltv") or 0.80)
        )
        predictive_credit = {
            "grade": pred_grade,
            "grade_confidence": pred_result.get("confidence", 0.0),
            "max_ltv": max_ltv,
            "rate_bps": pred_credit_line.rate_bps,
            "credit_line_eth": pred_credit_line.total_line_eth,
            "collaborative_multiplier": pred_credit_line.collaborative_multiplier,
            "model_name": pred_result.get("model_name", "fallback" if is_fallback else "creditworthiness_xgboost"),
            "model_hash": pred_result.get("model_hash"),
            "proof_hash": (pred_result.get("proof") or {}).get("proof_hash"),
            "proof_hex": (pred_result.get("proof") or {}).get("proof_hex"),
        }
    except Exception:
        pass  # Graceful: predictive_credit stays None

    portable_identity = get_portable_identity_service()
    attribution_summary: dict[str, Any] = {
        "event_count": 0,
        "chains": [],
    }
    credential_summary: dict[str, Any] = {
        "issued_count": 0,
        "active_count": 0,
        "revoked_count": 0,
        "latest_issued_at": None,
    }
    if portable_identity.enabled():
        try:
            attribution_summary = portable_identity.get_attribution_summary(address)
            credential_summary = portable_identity.get_credential_summary(address)
        except Exception:
            # Keep profile payload resilient when the additive layer is unavailable.
            pass

    verified_linked_count = len(
        [row for row in linked_entries if isinstance(row, dict) and bool(row.get("verified", False))]
    )

    out = {
        "profile_version": "2.0",
        "version_matrix": version_matrix,
        "address": address,
        "identity": {
            "has_agent": bool(onboarding.get("has_agent", False)),
            "identity_commitment": onboarding.get("identity_commitment"),
            "subject_id": address.lower(),
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
        "attribution_summary": attribution_summary,
        "credential_summary": credential_summary,
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
        "governance": {
            "voting_power": governance.get("voting_power", 0.0),
            "lp_usd": governance.get("lp_usd", 0.0),
            "lending_usd": governance.get("lending_usd", 0.0),
            "staking_usd": governance.get("staking_usd", 0.0),
            "tier_multiplier": governance.get("tier_multiplier", 1.0),
            "formula_version": governance.get(
                "formula_version",
                "vp_v2_sqrt_capital_tier_multiplier",
            ),
            "basis": governance.get("basis"),
        },
        "portfolio": {
            "total_value_usd": portfolio_summary.get("total_value_usd", 0.0),
            "protocol_count": portfolio_summary.get("protocol_count", 0),
            "position_count": portfolio_summary.get("position_count", 0),
            "protocols_found": portfolio_summary.get("protocols_found", []),
            "snapshot_hash": portfolio_summary.get("snapshot_hash"),
            "scanned_at": portfolio_summary.get("scanned_at"),
        },
        "predictive_credit": predictive_credit,
        "decisions": decision_payload.get("decisions", {}),
        "disclosures": decision_payload.get("disclosures", {}),
        "feature_flags": {
            **(decision_payload.get("feature_flags", {}) if isinstance(decision_payload.get("feature_flags"), dict) else {}),
            **trust_flags,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    out["trust_tuple"] = {
        "reputation": {
            "tier": out["reputation"].get("tier", 0),
            "tier_name": out["reputation"].get("tier_name", "Strict"),
            "letter_rating": out["passport"].get("letter_rating", "D"),
            "passport_score": out["passport"].get("composite_score", 0),
        },
        "credit": {
            "grade": (predictive_credit or {}).get("grade") if isinstance(predictive_credit, dict) else None,
            "credit_line_eth": (predictive_credit or {}).get("credit_line_eth")
            if isinstance(predictive_credit, dict)
            else None,
            "rate_bps": (predictive_credit or {}).get("rate_bps")
            if isinstance(predictive_credit, dict)
            else None,
        },
        "governance": {
            "voting_power": out["governance"].get("voting_power", 0.0),
            "tier_multiplier": out["governance"].get("tier_multiplier", 1.0),
        },
        "execution": {
            "mode": (out.get("decisions") or {}).get("execution", {}).get("mode", "advisory"),
            "active_sessions": out["identity"].get("session_summary", {}).get("active_count", 0),
        },
        "identity": {
            "linked_verified_count": verified_linked_count,
            "dual_wallet_active": bool(
                (out["identity"].get("dual_wallet_session") or {}).get("active", False)
            ),
            "subject_id": out["identity"].get("subject_id"),
            "attribution_event_count": int(attribution_summary.get("event_count", 0) or 0),
            "credential_active_count": int(credential_summary.get("active_count", 0) or 0),
            "portfolio_snapshot_hash": out["portfolio"].get("snapshot_hash"),
        },
    }
    try:
        await _emit_trust_state_events(address, out)
    except Exception:
        # Non-fatal telemetry path.
        pass
    return out


async def _emit_trust_state_events(address: str, profile_v2: dict[str, Any]) -> None:
    identity = profile_v2.get("identity") or {}
    governance = profile_v2.get("governance") or {}
    predictive_credit = profile_v2.get("predictive_credit") or {}
    decisions = profile_v2.get("decisions") or {}
    execution_gate = decisions.get("execution") if isinstance(decisions, dict) else {}

    dual_session = identity.get("dual_wallet_session") if isinstance(identity, dict) else {}
    if not isinstance(dual_session, dict):
        dual_session = {}

    linked = identity.get("linked_addresses") if isinstance(identity, dict) else []
    if not isinstance(linked, list):
        linked = []
    linked_verified_count = len(
        [row for row in linked if isinstance(row, dict) and bool(row.get("verified", False))]
    )

    await log_trust_event_if_changed(
        address,
        "governance.voting_power",
        governance.get("voting_power", 0.0),
        event_type="governance_power_updated",
        gate="governance",
        outcome="updated",
        metadata={
            "voting_power": governance.get("voting_power", 0.0),
            "tier_multiplier": governance.get("tier_multiplier", 1.0),
            "formula_version": governance.get("formula_version"),
        },
        receipt_proof_type="governance_power_updated",
    )

    if isinstance(predictive_credit, dict) and predictive_credit:
        credit_state = {
            "grade": predictive_credit.get("grade"),
            "rate_bps": predictive_credit.get("rate_bps"),
            "credit_line_eth": predictive_credit.get("credit_line_eth"),
            "model_name": predictive_credit.get("model_name"),
            "model_hash": predictive_credit.get("model_hash"),
        }
        await log_trust_event_if_changed(
            address,
            "credit.model_state",
            credit_state,
            event_type="credit_model_updated",
            gate="credit",
            outcome="updated",
            metadata=credit_state,
            receipt_proof_type="credit_model_updated",
        )

    identity_binding_state = {
        "active": bool(dual_session.get("active", False)),
        "status": dual_session.get("status", "missing"),
        "session_id": dual_session.get("session_id"),
        "linked_verified_count": linked_verified_count,
    }
    await log_trust_event_if_changed(
        address,
        "identity.binding_state",
        identity_binding_state,
        event_type="identity_binding_status_updated",
        gate="identity",
        outcome="updated",
        metadata=identity_binding_state,
        receipt_proof_type="identity_binding_status_updated",
    )

    if isinstance(execution_gate, dict):
        execution_gate_state = {
            "mode": execution_gate.get("mode"),
            "reason_codes": execution_gate.get("reason_codes", []),
            "active_sessions": (identity.get("session_summary") or {}).get("active_count", 0),
        }
        await log_trust_event_if_changed(
            address,
            "execution.gate_state",
            execution_gate_state,
            event_type="execution_gate_updated",
            gate="execution",
            outcome="updated",
            metadata=execution_gate_state,
            receipt_proof_type="execution_gate_updated",
        )


def _to_erc8004(bundle: dict[str, Any]) -> dict[str, Any]:
    """Project Risk Profile bundle to ERC-8004 portable identity shape."""
    rep = bundle.get("reputation") or {}
    passport = bundle.get("risk_passport") or {}
    onboarding = bundle.get("onboarding") or {}
    sessions = bundle.get("session_summary") or {}
    dual_session = bundle.get("dual_wallet_session") or {}
    compliance = bundle.get("compliance_summary") or {}
    governance = bundle.get("governance") or {}

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
        "voting_power": governance.get("voting_power", 0.0)
        if isinstance(governance, dict)
        else 0.0,
    }

    return {
        "identity_card": identity_card,
        "reputation": reputation_slice,
        "validations": validations,
        "session_summary": session_summary_slice,
        "disclosure_summary": disclosure_summary,
    }
