"""Portable Identity / Reputation V3 additive routes."""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.portable_identity_service import get_portable_identity_service
from app.services.trust_event_service import log_trust_event
from app.api.reputation import get_user_data, compute_reputation_score, compute_gates, TIER_INFO
from app.services.credit_line_service import compute_credit_line
from app.services.linked_addresses_store import get_linked
from app.services.linked_address_verification_service import get_linked_address_verification_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["portable-identity"])


class IdentityLinkRequest(BaseModel):
    chain: str
    address: str
    verification_method: str = "signature_challenge"
    verified: bool = False
    confidence: float = Field(default=0.4, ge=0.0, le=1.0)
    verification_ref: str | None = None
    identity_commitment: str | None = None


class AttributionQueryRequest(BaseModel):
    subject: str
    window_days: int = Field(default=90, ge=1, le=3650)
    filters: dict[str, Any] | None = None
    include_evidence: bool = False


class ClaimsDeriveRequest(BaseModel):
    subject: str
    window_days: int = Field(default=90, ge=1, le=3650)
    min_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class CredentialIssueRequest(BaseModel):
    subject: str
    template: str = "portable_identity_v3"
    audience: str = "self"
    claim_keys: list[str] | None = None
    claims: dict[str, Any] | None = None
    ttl_hours: int = Field(default=24, ge=1, le=24 * 365)


class CredentialVerifyRequest(BaseModel):
    credential_id: str
    signature: str | None = None


class CredentialRevokeRequest(BaseModel):
    credential_id: str | None = None
    revocation_id: str | None = None
    reason: str | None = None


def _svc():
    service = get_portable_identity_service()
    if not service.enabled():
        raise HTTPException(status_code=503, detail="portable_identity_v3_disabled")
    return service


@router.get("/identity/graph/{subject}")
async def get_identity_graph(subject: str) -> dict[str, Any]:
    service = _svc()
    return await service.get_identity_graph(subject)


@router.post("/identity/graph/{subject}/link")
async def link_identity(subject: str, req: IdentityLinkRequest) -> dict[str, Any]:
    service = _svc()

    if req.identity_commitment:
        service.set_identity_commitment(subject, req.identity_commitment)

    result = service.upsert_identity_link(
        subject=subject,
        chain=req.chain,
        address=req.address,
        verification_method=req.verification_method,
        verified=req.verified,
        confidence=req.confidence,
        verification_ref=req.verification_ref,
    )

    await log_trust_event(
        subject,
        "identity_link_updated",
        gate="identity",
        outcome="updated",
        metadata={
            "chain": req.chain,
            "address": req.address,
            "verified": req.verified,
            "confidence": req.confidence,
            "verification_method": req.verification_method,
        },
        receipt_proof_type="identity_link_updated",
    )

    return {
        "status": "ok",
        "subject": service.normalize_subject(subject),
        "result": result,
        "version_matrix": service.get_version_matrix(),
    }


@router.post("/attributions/query")
async def query_attributions(req: AttributionQueryRequest) -> dict[str, Any]:
    service = _svc()
    result = await service.query_attributions(
        subject=req.subject,
        window_days=req.window_days,
        filters=req.filters,
        include_evidence=req.include_evidence,
    )
    # Persist normalized rows for deterministic replay / claim derivation.
    service.persist_attributions(req.subject, list(result.get("attributions") or []))
    return {
        **result,
        "version_matrix": service.get_version_matrix(),
    }


@router.post("/claims/derive")
async def derive_claims(req: ClaimsDeriveRequest) -> dict[str, Any]:
    service = _svc()
    attribution = await service.query_attributions(
        subject=req.subject,
        window_days=req.window_days,
        filters=None,
        include_evidence=False,
    )
    rows = list(attribution.get("attributions") or [])
    filtered_rows = [
        row for row in rows if float((row or {}).get("confidence", 0.0) or 0.0) >= req.min_confidence
    ]

    action_type_counts: dict[str, int] = {}
    protocol_counts: dict[str, int] = {}
    for row in filtered_rows:
        if not isinstance(row, dict):
            continue
        action = str(row.get("action_type") or "unknown")
        protocol = str(row.get("protocol_id") or "unknown")
        action_type_counts[action] = int(action_type_counts.get(action, 0)) + 1
        protocol_counts[protocol] = int(protocol_counts.get(protocol, 0)) + 1

    coverage_score = float((attribution.get("summary") or {}).get("coverage_score", 0.0) or 0.0)
    verified_chain_count = int((attribution.get("summary") or {}).get("verified_chain_count", 0) or 0)
    activity_score = min(100.0, round(len(filtered_rows) * 2.5 + coverage_score * 25.0, 2))

    subject_key = service.normalize_subject(req.subject)
    user_data = get_user_data(subject_key)
    tier = int(user_data.get("tier", 0))
    tier_name = TIER_INFO.get(tier, TIER_INFO[0]).tier_name
    tenure_days = 0
    first_interaction = int(user_data.get("first_interaction", 0) or 0)
    if first_interaction > 0:
        tenure_days = int((time.time() - first_interaction) / 86400)
    successful_txns = int(user_data.get("successful_txns", 0) or 0)
    failed_txns = int(user_data.get("failed_txns", 0) or 0)
    collateral_eth = float(user_data.get("collateral", 0) or 0) / 1e18
    reputation_score = compute_reputation_score(tier, tenure_days, successful_txns, collateral_eth, failed_txns)
    gates = compute_gates(tier)

    linked = get_linked(subject_key)
    verifier = get_linked_address_verification_service()
    verified = verifier.filter_verified(subject_key, linked)
    linked_count = len([v for k, v in verified.items() if k in ("eth", "arb", "base", "opt") and v])
    cross_chain_verified = linked_count > 0

    letter_rating = "A" if reputation_score >= 70 else ("B" if reputation_score >= 40 else ("C" if reputation_score >= 20 else "D"))
    credit_line = compute_credit_line(
        collateral_eth=collateral_eth,
        tier=tier,
        letter_rating=letter_rating,
        linked_address_count=linked_count,
        cross_chain_verified=cross_chain_verified,
    )

    claims_payload = {
        "subject": subject_key,
        "window_days": req.window_days,
        "min_confidence": req.min_confidence,
        "summary": {
            "attribution_count": len(filtered_rows),
            "coverage_score": coverage_score,
            "verified_chain_count": verified_chain_count,
        },
        "claims": {
            "activity_score_0_100": activity_score,
            "reputation_score_0_100": reputation_score,
            "reputation_tier": tier,
            "reputation_tier_name": tier_name,
            "tenure_days": tenure_days,
            "gates": gates,
            "letter_rating": letter_rating,
            "credit_line_eth": credit_line.total_line_eth,
            "collateral_line_eth": credit_line.collateral_line_eth,
            "unsecured_cap_eth": credit_line.unsecured_cap_eth,
            "rate_bps": credit_line.rate_bps,
            "cross_chain_verified": cross_chain_verified,
            "linked_chain_count": linked_count,
            "action_type_counts": action_type_counts,
            "protocol_counts": protocol_counts,
        },
        "version_matrix": service.get_version_matrix(),
    }

    service.set_derived_claims(req.subject, claims_payload)

    await log_trust_event(
        req.subject,
        "claims_derived",
        gate="reputation",
        outcome="updated",
        metadata={
            "attribution_count": len(filtered_rows),
            "coverage_score": coverage_score,
            "verified_chain_count": verified_chain_count,
            "reputation_score_0_100": reputation_score,
            "reputation_tier": tier,
            "letter_rating": letter_rating,
            "credit_line_eth": credit_line.total_line_eth,
        },
        receipt_proof_type="claims_derived",
    )

    return claims_payload


@router.post("/credentials/issue")
async def issue_credential(req: CredentialIssueRequest) -> dict[str, Any]:
    service = _svc()
    claims: dict[str, Any] = {}
    if isinstance(req.claims, dict):
        claims.update(req.claims)

    derived = service.get_derived_claims(req.subject)
    derived_claims = (derived or {}).get("claims") if isinstance(derived, dict) else None
    if isinstance(derived_claims, dict):
        if req.claim_keys:
            for key in req.claim_keys:
                if key in derived_claims:
                    claims[key] = derived_claims[key]
        else:
            claims.update(derived_claims)

    issued = service.issue_credential(
        subject=req.subject,
        template=req.template,
        audience=req.audience,
        claims=claims,
        ttl_hours=req.ttl_hours,
    )

    await log_trust_event(
        req.subject,
        "credential_issued",
        gate="identity",
        outcome="updated",
        metadata={
            "credential_id": issued.get("credential_id"),
            "template": req.template,
            "audience": req.audience,
            "revocation_id": issued.get("revocation_id"),
            "claims_count": len(claims),
        },
        receipt_proof_type="credential_issued",
    )

    return {
        "status": "ok",
        "credential": issued,
    }


@router.post("/credentials/verify")
async def verify_credential(req: CredentialVerifyRequest) -> dict[str, Any]:
    service = _svc()
    return service.verify_credential(req.credential_id, req.signature)


@router.post("/credentials/revoke")
async def revoke_credential(req: CredentialRevokeRequest) -> dict[str, Any]:
    service = _svc()
    result = service.revoke_credential(
        credential_id=req.credential_id,
        revocation_id=req.revocation_id,
        reason=req.reason,
    )

    if result.get("revoked"):
        subject = None
        verify_result = service.verify_credential(str(result.get("credential_id") or ""))
        if isinstance(verify_result, dict):
            credential = verify_result.get("credential")
            if isinstance(credential, dict):
                subject = credential.get("subject")
        if subject:
            await log_trust_event(
                str(subject),
                "credential_revoked",
                gate="identity",
                outcome="updated",
                metadata={
                    "credential_id": result.get("credential_id"),
                    "revocation_id": result.get("revocation_id"),
                    "reason": result.get("reason"),
                },
                receipt_proof_type="credential_revoked",
            )

    return result


@router.get("/credentials/revocation/{revocation_id}")
async def get_revocation_status(revocation_id: str) -> dict[str, Any]:
    service = _svc()
    row = service.get_revocation_status(revocation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="revocation_not_found")
    return row


# ──────────────────────────────────────────────────────────────────────────────
# Portfolio Import → Identity Seeding
# ──────────────────────────────────────────────────────────────────────────────

class PortfolioImportRequest(BaseModel):
    """Trigger a mainnet portfolio scan and seed into the identity graph."""
    wallet_address: str
    chain: str = "starknet"
    # If the user signs a message, pass the signature here
    signature: str | None = None
    signature_message: str | None = None


@router.post("/identity/graph/{subject}/import-portfolio")
async def import_portfolio_into_identity(
    subject: str, req: PortfolioImportRequest
) -> dict[str, Any]:
    """
    Scan the user's mainnet positions and seed their portable identity.

    Flow:
      1. Scan mainnet positions (Vesu, Endur, Nostra, wallet tokens)
      2. Link the wallet address in the identity graph
      3. Record portfolio snapshot as an attribution event
      4. Compute initial reputation from real position data
      5. Return snapshot + reputation seed

    This is the onboarding trigger: one wallet signature → full identity.
    """
    service = _svc()
    subject_key = service.normalize_subject(subject)

    # 1. Scan mainnet positions
    try:
        from app.services.position_scanner import scan_portfolio
        snapshot = await scan_portfolio(req.wallet_address)
    except Exception as exc:
        logger.warning("Portfolio scan failed for %s: %s", req.wallet_address[:20], exc)
        raise HTTPException(status_code=502, detail=f"Portfolio scan failed: {exc}")

    # 2. Link wallet in identity graph
    link_result = service.upsert_identity_link(
        subject=subject_key,
        chain=req.chain,
        address=req.wallet_address,
        verification_method="signature_challenge" if req.signature else "self_declared",
        verified=bool(req.signature),
        confidence=0.9 if req.signature else 0.4,
        verification_ref=req.signature,
    )

    # 3. Set identity commitment from snapshot hash
    service.set_identity_commitment(subject_key, snapshot.snapshot_hash)

    # 4. Record portfolio scan as attribution event
    portfolio_attribution = {
        "action_type": "portfolio_import",
        "source": "position_scanner",
        "protocol_id": "multi_protocol",
        "chain": req.chain,
        "wallet_address": req.wallet_address,
        "timestamp": snapshot.scanned_at,
        "confidence": 1.0,
        "metadata": {
            "position_count": snapshot.position_count,
            "protocol_count": snapshot.protocol_count,
            "protocols_found": snapshot.protocols_found,
            "total_value_usd": snapshot.total_value_usd,
            "snapshot_hash": snapshot.snapshot_hash,
        },
    }
    service.persist_attributions(subject_key, [portfolio_attribution])

    # 5. Compute reputation seed from real data
    user_data = get_user_data(subject_key)
    tier = max(1, int(user_data.get("tier", 0)))  # At least tier 1 for importers
    tenure_days = 0
    first_interaction = int(user_data.get("first_interaction", 0) or 0)
    if first_interaction > 0:
        tenure_days = int((time.time() - first_interaction) / 86400)

    # Boost txn count estimate from position count (they're active DeFi users)
    est_txns = max(int(user_data.get("successful_txns", 0) or 0), snapshot.position_count * 10)
    collateral_eth = snapshot.total_value_usd / 2500.0  # rough ETH estimate
    reputation_score = compute_reputation_score(tier, tenure_days, est_txns, collateral_eth)
    gates = compute_gates(tier)

    # Log trust event
    await log_trust_event(
        subject_key,
        "portfolio_imported",
        gate="identity",
        outcome="updated",
        metadata={
            "wallet_address": req.wallet_address,
            "position_count": snapshot.position_count,
            "total_value_usd": snapshot.total_value_usd,
            "protocols_found": snapshot.protocols_found,
            "snapshot_hash": snapshot.snapshot_hash,
            "reputation_score": reputation_score,
            "signed": bool(req.signature),
        },
        receipt_proof_type="portfolio_imported",
    )

    return {
        "status": "ok",
        "subject": subject_key,
        "portfolio": snapshot.to_dict(),
        "identity": {
            "identity_commitment": snapshot.snapshot_hash,
            "link": link_result,
            "verified": bool(req.signature),
        },
        "reputation_seed": {
            "score": reputation_score,
            "tier": tier,
            "gates": gates,
            "estimated_txns": est_txns,
            "collateral_eth_estimate": round(collateral_eth, 4),
        },
        "version_matrix": service.get_version_matrix(),
    }

