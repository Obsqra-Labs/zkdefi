"""
Risk Passport API

Composes reputation, identity, onboarding, and receipts into user and pool passports.
No new user/tier storage; read-only view over existing data.
Exposes aggregation_sources and chain_id for transparency and explorer links.
"""
from __future__ import annotations

import os
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Query, Request

from app.services.attestation_service import (
    build_register_proof_calldata,
    get_active_attestation,
    get_user_attestations,
    issue_attestation,
    to_vc_format,
)
from app.services.credit_line_service import compute_credit_line, compute_predictive_credit_line
from app.services.linked_address_verification_service import get_linked_address_verification_service
from app.services.linked_addresses_store import get_linked
from app.services.pool_passport_store import get as get_pool_passport_store
from app.services.profile_decision_service import get_profile_decision_service
from app.services.receipt_service import get_receipt_service

router = APIRouter(prefix="/risk_passport", tags=["risk_passport"])


# Chain id for explorer links; default Sepolia. Set STARKNET_CHAIN=mainnet for mainnet.
def _passport_chain_id() -> str:
    raw = (os.getenv("STARKNET_CHAIN") or "sepolia").strip().lower()
    if raw == "mainnet":
        return "0x534e5f4d41494f"
    return "0x534e5f5345504f4c4941"


def _aggregation_sources(chain_label: str) -> list[dict[str, Any]]:
    return [
        {
            "id": "reputation",
            "description": "On-chain reputation: tier, tenure, volume, collateral",
            "chain": chain_label,
            "contract_hint": "ReputationRegistry",
        },
        {
            "id": "identity",
            "description": "ZK credit tier and score (RISC Zero)",
            "chain": chain_label,
            "contract_hint": "ReputationRegistry",
        },
        {
            "id": "proof_receipts",
            "description": "Proof timeline: risk_score, pool_safety, rebalance, policy_compile",
            "chain": chain_label,
            "contract_hint": None,
        },
    ]


def _composite_score(tier: int, tenure_days: int, total_volume_eth: float, collateral_eth: float) -> int:
    """Deterministic composite score 0-100 from reputation inputs."""
    score = (
        tier * 30
        + min(tenure_days // 10, 20)
        + min(int(total_volume_eth * 2), 25)
        + min(int(collateral_eth * 10), 25)
    )
    return max(0, min(100, score))


def _letter_rating(composite: int) -> str:
    """Letter rating A/B/C/D from composite score."""
    if composite >= 80:
        return "A"
    if composite >= 60:
        return "B"
    if composite >= 40:
        return "C"
    return "D"


_PROOF_TYPE_TO_CIRCUIT: dict[str, str] = {
    "risk_score": "RiskScore",
    "pool_safety": "AnomalyDetector",
    "anomaly": "AnomalyDetector",
    "rebalance": "RebalanceTimingCommitment",
    "policy_compile": "ModelBridge",
    "shared_pool_execution": "ModelBridge",
    "model_bridge": "ModelBridge",
    "rebalance_timing_commitment": "RebalanceTimingCommitment",
    "robustness_certificate": "RobustnessCertificate",
}

_PRIORITY_CIRCUITS = [
    "RiskScore",
    "AnomalyDetector",
    "ModelBridge",
    "RebalanceTimingCommitment",
    "RobustnessCertificate",
]


def _build_circuit_context(receipts: Any) -> dict[str, Any]:
    """Summarize how recent proof receipts map to current zkML circuit inventory."""
    observed_types: set[str] = set()
    observed_circuits: set[str] = set()

    if isinstance(receipts, list):
        for row in receipts:
            if not isinstance(row, dict):
                continue
            proof_type = str(row.get("proof_type") or "unknown")
            observed_types.add(proof_type)
            mapped = _PROOF_TYPE_TO_CIRCUIT.get(proof_type)
            if mapped:
                observed_circuits.add(mapped)

    available_circuits: list[dict[str, Any]] = []
    try:
        from app.services.zkml.circuit_scanner import list_available_circuits

        available_circuits = list_available_circuits()
    except Exception:
        available_circuits = []

    ready = [c for c in available_circuits if bool(c.get("ready", False))]
    ready_names = {str(c.get("name") or "") for c in ready}

    category_counts: dict[str, int] = {}
    for row in ready:
        cat = str(row.get("category") or "unknown")
        category_counts[cat] = int(category_counts.get(cat, 0)) + 1

    observed_ready = sorted([name for name in observed_circuits if name in ready_names])
    coverage_pct = 0.0
    if ready_names:
        coverage_pct = round((len(observed_ready) / len(ready_names)) * 100.0, 2)

    return {
        "registered_circuit_count": len(available_circuits),
        "ready_circuit_count": len(ready),
        "ready_categories": category_counts,
        "observed_proof_types": sorted(observed_types),
        "observed_circuits": observed_ready,
        "coverage_pct_of_ready": coverage_pct,
        "priority_gaps": [name for name in _PRIORITY_CIRCUITS if name not in observed_ready],
    }


def _resolve_base(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    if base.startswith("http"):
        return base
    host, port = request.scope.get("server", ("localhost", 8000))
    root_path = request.scope.get("root_path", "")
    return f"http://{host}:{port}{root_path}".rstrip("/")


async def _load_user_context(address: str, request: Request) -> dict[str, Any]:
    base = _resolve_base(request)

    reputation: dict[str, Any] | None = None
    onboarding: dict[str, Any] | None = None
    session_summary = {"count": 0, "active_count": 0, "sessions": []}
    credit_tier = None
    credit_score = None

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            rep_res = await client.get(f"{base}/api/v1/zkdefi/reputation/user/{address}")
            if rep_res.status_code == 200:
                reputation = rep_res.json()
        except Exception:
            reputation = None

        try:
            onb_res = await client.get(f"{base}/api/v1/zkdefi/onboarding/status/{address}")
            if onb_res.status_code == 200:
                onboarding = onb_res.json()
        except Exception:
            onboarding = None

        try:
            sess_res = await client.get(f"{base}/api/v1/zkdefi/session_keys/list/{address}")
            if sess_res.status_code == 200:
                payload = sess_res.json()
                if isinstance(payload, dict):
                    session_summary = {
                        "count": payload.get("count", 0),
                        "active_count": payload.get("active_count", 0),
                        "sessions": payload.get("sessions", []),
                    }
        except Exception:
            pass

        if isinstance(onboarding, dict):
            commitment = onboarding.get("identity_commitment")
            if commitment:
                try:
                    id_res = await client.get(f"{base}/api/v1/identity/commitment/{commitment}")
                    if id_res.status_code == 200:
                        id_payload = id_res.json()
                        if id_payload.get("found"):
                            credit_tier = id_payload.get("tier")
                            credit_score = id_payload.get("score")
                except Exception:
                    pass

    linked = get_linked(address)
    verifier = get_linked_address_verification_service()
    verified = verifier.filter_verified(address, linked)

    return {
        "reputation": reputation,
        "onboarding": onboarding,
        "session_summary": session_summary,
        "credit_tier": credit_tier,
        "credit_score": credit_score,
        "linked": linked,
        "verified_linked": verified,
    }


async def _build_user_passport_payload(address: str, request: Request) -> dict[str, Any]:
    ctx = await _load_user_context(address, request)
    rep = ctx.get("reputation") or {}

    if not rep:
        return {
            "composite_score": 0,
            "letter_rating": "D",
            "tier": 0,
            "tier_name": "Strict",
            "credit_tier": None,
            "credit_score": None,
            "proof_receipts": [],
            "aggregation_sources": _aggregation_sources("starknet-sepolia"),
            "chain_id": _passport_chain_id(),
            "message": "Reputation unavailable",
        }

    tier = rep.get("tier", 0)
    tier_name = rep.get("tier_name", "Strict")
    tenure_days = rep.get("tenure_days", 0)
    total_volume_eth = rep.get("total_volume_eth", 0.0)
    collateral_eth = rep.get("collateral_eth", 0.0)

    receipt_svc = get_receipt_service()
    proof_receipts = await receipt_svc.get_user_receipts((address or "").strip().lower())
    proof_receipts = sorted(proof_receipts, key=lambda x: x.get("timestamp", ""), reverse=True)[:20]

    composite = _composite_score(tier, tenure_days, total_volume_eth, collateral_eth)
    letter = _letter_rating(composite)

    return {
        "composite_score": composite,
        "letter_rating": letter,
        "tier": tier,
        "tier_name": tier_name,
        "credit_tier": ctx.get("credit_tier"),
        "credit_score": ctx.get("credit_score"),
        "proof_receipts": proof_receipts,
        "aggregation_sources": _aggregation_sources("starknet-sepolia"),
        "chain_id": _passport_chain_id(),
    }


@router.get("/user/{address}")
async def get_user_passport(address: str, request: Request):
    """Get user Risk Passport: composite score, letter, tier, credit, proof receipts."""
    return await _build_user_passport_payload(address, request)


@router.get("/v2/user/{address}")
async def get_user_passport_v2(address: str, request: Request):
    """Get Risk Passport v2 with receipt summary, lending context, and decision context."""
    passport = await _build_user_passport_payload(address, request)
    ctx = await _load_user_context(address, request)

    rep = ctx.get("reputation") or {}
    onboarding = ctx.get("onboarding") or {}
    verified_linked = ctx.get("verified_linked") or {}

    linked_count = len([v for v in verified_linked.values() if isinstance(v, str) and v.strip()])
    collateral_eth = float(rep.get("collateral_eth", 0.0) or 0.0)
    credit_line = compute_credit_line(
        collateral_eth=collateral_eth,
        tier=int(rep.get("tier", 0) or 0),
        letter_rating=str(passport.get("letter_rating") or "D"),
        credit_tier=passport.get("credit_tier"),
        linked_address_count=linked_count,
        cross_chain_verified=linked_count > 0,
    )

    receipts = passport.get("proof_receipts", [])
    by_type: dict[str, int] = {}
    if isinstance(receipts, list):
        for row in receipts:
            if isinstance(row, dict):
                proof_type = str(row.get("proof_type") or "unknown")
                by_type[proof_type] = int(by_type.get(proof_type, 0)) + 1

    bundle_for_decisions = {
        "address": address,
        "reputation": rep,
        "risk_passport": passport,
        "onboarding": onboarding,
        # Decision engine should only consume signature-verified links.
        "linked_addresses": ctx.get("verified_linked") or {},
        "session_summary": ctx.get("session_summary") or {"count": 0, "active_count": 0, "sessions": []},
    }
    decision_payload = get_profile_decision_service().evaluate(bundle_for_decisions)

    active_att = get_active_attestation(address)

    # v6: Predictive credit from XGBoost model (graceful fallback)
    predictive_credit = None
    try:
        from app.ml.creditworthiness.predictor import get_creditworthiness_predictor
        predictor = get_creditworthiness_predictor()
        pred_result = await predictor.predict(address)
        pred_credit_line = await compute_predictive_credit_line(
            user_address=address,
            collateral_eth=collateral_eth,
            tier=int(rep.get("tier", 0) or 0),
            linked_address_count=linked_count,
            cross_chain_verified=linked_count > 0,
        )
        pred_terms = pred_result.get("terms") or {}
        pred_grade = pred_result.get("credit_class", "C")
        predictive_credit = {
            "grade": pred_grade,
            "grade_confidence": pred_result.get("confidence", 0.0),
            "max_ltv": pred_terms.get("ltv", 0.5),
            "rate_bps": pred_terms.get("rate_bps", 1000),
            "credit_line_eth": pred_credit_line.total_line_eth,
            "collaborative_multiplier": pred_credit_line.collaborative_multiplier,
            "model_name": "creditworthiness_xgboost",
            "model_hash": pred_result.get("model_hash"),
        }
    except Exception:
        pass  # Graceful: predictive_credit stays None

    return {
        "profile_version": "2.0",
        "address": address,
        **passport,
        "receipt_summary": {
            "count": len(receipts) if isinstance(receipts, list) else 0,
            "by_type": by_type,
        },
        "lending_context": {
            "collateral_line_eth": credit_line.collateral_line_eth,
            "unsecured_cap_eth": credit_line.unsecured_cap_eth,
            "total_line_eth": credit_line.total_line_eth,
            "total_line_wei": str(int(credit_line.total_line_eth * 10**18)),
            "rate_bps": credit_line.rate_bps,
            "active_attestation_hash": (active_att or {}).get("attestation_hash"),
            "active_attestation_expires_at": (active_att or {}).get("expires_at"),
        },
        "decisions": decision_payload.get("decisions", {}),
        "disclosures": decision_payload.get("disclosures", {}),
        "predictive_credit": predictive_credit,
        "circuit_context": _build_circuit_context(receipts),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/user/{address}/attestation")
async def issue_user_attestation(address: str, request: Request):
    """
    Issue or reuse a credit attestation for the user from their Risk Profile.
    Optional query: ?format=vc returns W3C Verifiable Credential shape.
    """
    ctx = await _load_user_context(address, request)
    rep = ctx.get("reputation") or {}
    if not rep:
        return {"error": "reputation_unavailable", "attestation": None}

    composite = _composite_score(
        int(rep.get("tier", 0) or 0),
        int(rep.get("tenure_days", 0) or 0),
        float(rep.get("total_volume_eth", 0.0) or 0.0),
        float(rep.get("collateral_eth", 0.0) or 0.0),
    )
    letter = _letter_rating(composite)
    chain_id = _passport_chain_id()
    verified_linked = ctx.get("verified_linked") or {}
    linked_count = len([v for v in verified_linked.values() if isinstance(v, str) and v.strip()])

    force = request.query_params.get("force", "").strip().lower() in {"1", "true", "yes", "on"}

    att = issue_attestation(
        address=address,
        composite_score=composite,
        letter_rating=letter,
        tier=int(rep.get("tier", 0) or 0),
        credit_tier=ctx.get("credit_tier"),
        collateral_eth=float(rep.get("collateral_eth", 0.0) or 0.0),
        chain_id=chain_id,
        linked_address_count=linked_count,
        cross_chain_verified=linked_count > 0,
        force_issue=force,
    )

    att_dict = asdict(att)
    fmt = request.query_params.get("format", "").strip().lower()
    if fmt == "vc":
        return to_vc_format(att_dict)
    return att_dict


@router.get("/user/{address}/attestation")
async def get_user_attestation_compat(address: str, request: Request):
    """
    Legacy compatibility path for clients that still use GET.

    Returns the active attestation when available; otherwise reuses/creates one
    through the same idempotent issuance path used by POST.
    """
    active = get_active_attestation(address)
    fmt = request.query_params.get("format", "").strip().lower()
    if active:
        if fmt == "vc":
            return to_vc_format(active)
        return active
    return await issue_user_attestation(address, request)


@router.get("/v2/user/{address}/attestation/active")
async def get_active_user_attestation(address: str):
    """Return active (non-expired) attestation for a user, if present."""
    active = get_active_attestation(address)
    if not active:
        return {"address": address, "found": False, "attestation": None}
    return {"address": address, "found": True, "attestation": active}


@router.post("/v2/user/{address}/attestation/issue")
async def issue_user_attestation_v2(
    address: str,
    request: Request,
    force: bool = Query(default=False),
):
    """Issue or reuse attestation in idempotent mode; use force=true to re-issue."""
    before = get_active_attestation(address)
    issued = await issue_user_attestation(address, request)
    after_hash = issued.get("attestation_hash") if isinstance(issued, dict) else None
    before_hash = before.get("attestation_hash") if isinstance(before, dict) else None
    return {
        "address": address,
        "issued_new": bool(after_hash and after_hash != before_hash),
        "attestation": issued,
        "force": bool(force),
    }


@router.get("/user/{address}/attestations")
async def list_user_attestations(address: str):
    """List all credit attestations issued for a user."""
    atts = get_user_attestations(address)
    return {"address": address, "count": len(atts), "attestations": atts}


@router.post("/user/{address}/attestation/register")
async def register_attestation_onchain(address: str):
    """Build calldata to register the latest attestation on-chain via ValidationProofRegistry."""
    atts = get_user_attestations(address)
    if not atts:
        return {"error": "no_attestation", "calldata": None}
    latest = atts[0]
    att_hash = latest.get("attestation_hash", "")
    if not att_hash:
        return {"error": "missing_hash", "calldata": None}
    cd = build_register_proof_calldata(att_hash)
    return {
        "attestation_hash": att_hash,
        "calldata": cd,
        "message": "Sign and submit this transaction to register the attestation on-chain.",
    }


@router.get("/pool/{pool_id}")
async def get_pool_passport(pool_id: str):
    """
    Get pool Risk Passport: health score, safe, factors, last proof (when anomaly was run).
    Returns passport null if pool has not been analyzed yet.
    """
    entry = get_pool_passport_store(pool_id)
    if entry is None:
        return {
            "pool_id": pool_id,
            "passport": None,
            "safe": None,
            "health_score": None,
            "factors": {},
            "proof_receipts": [],
            "message": "No passport yet. Run anomaly analysis for this pool.",
        }
    receipt_svc = get_receipt_service()
    pool_receipts = receipt_svc.get_receipts_by_pool(pool_id)
    return {
        "pool_id": pool_id,
        "passport": entry,
        "safe": entry.get("safe"),
        "health_score": entry.get("health_score"),
        "factors": entry.get("factors", {}),
        "proof_receipts": pool_receipts,
        "snapshot_hash": entry.get("snapshot_hash"),
    }


# ── STARK-Proven Reputation Passport ────────────────────────────────────────

@router.post("/user/{address}/stark-passport")
async def generate_stark_passport(address: str, request: Request):
    """
    Generate a STARK-proven reputation passport for a user.

    Collects the user's recent proof fact-hashes, sends them to the obsqra
    coprocessor (Stone prover + reputation_passport Cairo0 program), and
    returns a single aggregated STARK proof + tier.

    This is the coprocessor pattern:
      off-chain compute → Stone prove → Integrity fact → Starknet gates on fact
    """
    from app.services.reputation_passport_client import get_reputation_passport_client

    # Collect badge fact_hashes from the user's proof receipts
    receipt_svc = get_receipt_service()
    receipts = await receipt_svc.get_user_receipts((address or "").strip().lower())

    badge_fact_hashes: dict[str, str] = {}
    for receipt in receipts:
        if not isinstance(receipt, dict):
            continue
        proof_type = str(receipt.get("proof_type") or "")
        fact_hash = str(receipt.get("fact_hash") or receipt.get("proof_hash") or "")
        if proof_type and fact_hash and fact_hash.startswith("0x") and len(fact_hash) > 10:
            # Use the most recent receipt per proof_type
            if proof_type not in badge_fact_hashes:
                badge_fact_hashes[proof_type] = fact_hash

    if not badge_fact_hashes:
        return {
            "success": False,
            "error": "No proof receipts with fact hashes found for this address.",
            "address": address,
            "badge_count": 0,
        }

    client = get_reputation_passport_client()
    result = await client.aggregate_passport(badge_fact_hashes=badge_fact_hashes)

    return {
        "address": address,
        "chain_id": _passport_chain_id(),
        **result.to_dict(),
    }


@router.get("/stark-passport/config")
async def stark_passport_config():
    """Return STARK passport aggregation configuration (badge weights, tier thresholds)."""
    from app.services.reputation_passport_client import get_reputation_passport_client
    client = get_reputation_passport_client()
    return await client.get_passport_config()


@router.get("/settlement/config")
async def settlement_config():
    """
    Return current proof settlement configuration.

    Shows whether proofs settle to Madara L3, Starknet L2, or both.
    Useful for the frontend to display which chain the user's proofs are on.
    """
    from app.services.madara_settlement_client import get_madara_settlement_client
    client = get_madara_settlement_client()
    config = await client.settlement_config()
    return {
        "primary_settlement": config.primary_settlement,
        "madara_l3": {
            "enabled": config.madara_enabled,
            "configured": config.madara_configured,
            "chain_id": config.madara_chain_id,
        },
        "starknet_l2": {
            "enabled": config.starknet_l2_enabled,
            "network": config.starknet_l2_network,
        },
        "error": config.error or None,
    }


@router.get("/settlement/madara/health")
async def madara_health():
    """Check Madara L3 appchain health (proxied from obsqra parent)."""
    from app.services.madara_settlement_client import get_madara_settlement_client
    client = get_madara_settlement_client()
    health = await client.health()
    return {
        "healthy": health.healthy,
        "enabled": health.enabled,
        "chain_id": health.chain_id,
        "latest_block": health.latest_block,
        "error": health.error or None,
    }


@router.post("/settlement/madara/verify")
async def madara_verify_fact(fact_hash: str):
    """Verify a fact hash on the Madara L3 FactRegistry."""
    from app.services.madara_settlement_client import get_madara_settlement_client
    client = get_madara_settlement_client()
    result = await client.verify_fact(fact_hash)
    return {
        "valid": result.valid,
        "fact_hash": result.fact_hash,
        "chain_id": result.chain_id,
        "error": result.error or None,
    }


# ── L3 Proving Paths (obsqra stack integration) ─────────────────────────


@router.get("/l3/capabilities")
async def l3_capabilities():
    """
    Full obsqra stack capability discovery for zkde.fi.

    Returns all proving paths (on-chain verification, SNOS, aggregation),
    available obsqra services (Stone prover, dual prover, sequencer, etc.),
    and complete circuit inventory. Use this to render the zkde.fi proof
    infrastructure dashboard.
    """
    from app.services.l3_proving_path_client import get_l3_proving_path_client
    client = get_l3_proving_path_client()
    caps = await client.capabilities()
    if caps.error:
        return {"error": caps.error}
    return caps.raw


@router.get("/l3/proving-paths")
async def l3_proving_paths():
    """
    List available L3 proving paths.

    Path 1: On-chain Verification (Garaga/Integrity) — zero gas cost
    Path 2: SNOS Block Proving — L3→L2 validity proofs
    Path 3: Recursive Aggregation on L3 — batched contract verification
    """
    from app.services.l3_proving_path_client import get_l3_proving_path_client
    client = get_l3_proving_path_client()
    return await client.proving_paths()


@router.get("/l3/stats")
async def l3_stats():
    """Comprehensive L3 proving statistics across all three paths."""
    from app.services.l3_proving_path_client import get_l3_proving_path_client
    client = get_l3_proving_path_client()
    return await client.stats()


@router.post("/l3/verify")
async def l3_verify_proof(
    fact_hash: str,
    proof_type: str = "stark",
    circuit_name: str = "",
):
    """
    Verify a proof on L3 and register the fact on-chain.

    Uses the best available on-chain verifier (Garaga Groth16 or Integrity STARK),
    all at zero gas cost on the Madara L3 appchain. Falls back to hash-only
    registration if no on-chain verifier is deployed.
    """
    from app.services.l3_proving_path_client import get_l3_proving_path_client
    client = get_l3_proving_path_client()
    result = await client.verify_proof(
        fact_hash=fact_hash,
        proof_type=proof_type,
        circuit_name=circuit_name,
    )
    return {
        "success": result.success,
        "mode": result.mode,
        "fact_hash": result.fact_hash,
        "tx_hash": result.tx_hash,
        "verified_on_chain": result.verified_on_chain,
        "latency_ms": result.latency_ms,
        "error": result.error or None,
    }


@router.get("/l3/snos/queue")
async def l3_snos_queue():
    """Blocks queued for SNOS proving (Path 2 status)."""
    from app.services.l3_proving_path_client import get_l3_proving_path_client
    client = get_l3_proving_path_client()
    return await client.snos_queue()


@router.get("/l3/blocks")
async def l3_recent_blocks(limit: int = 10):
    """Recent blocks processed through L3 proving paths."""
    from app.services.l3_proving_path_client import get_l3_proving_path_client
    client = get_l3_proving_path_client()
    return await client.recent_blocks(limit=limit)

