"""
Cross-chain Reputation Export API (Phase 2 – Gap 26).

Packages credentials into a portable W3C-VC-style JSON envelope that can be
shared with external chains or verifiers.

Routes:
  POST /api/v1/zkdefi/reputation/export   — derive + issue + wrap into portable VC
  POST /api/v1/zkdefi/reputation/verify    — verify a portable VC envelope
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner
from app.services.portable_identity_service import get_portable_identity_service

router = APIRouter(tags=["reputation-export"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ExportRequest(BaseModel):
    """Request to export a portable reputation credential."""
    subject: str
    target_chain: str = Field(
        default="ethereum",
        description="Target chain ID for the credential (ethereum, arbitrum, base, starknet)",
    )
    window_days: int = Field(default=90, ge=1, le=3650)
    ttl_hours: int = Field(default=168, ge=1, le=8760)  # 1 week default
    claim_keys: list[str] | None = None


class VerifyPortableRequest(BaseModel):
    """Request to verify a portable credential envelope."""
    envelope: dict[str, Any]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sha256(data: str) -> str:
    return "0x" + hashlib.sha256(data.encode()).hexdigest()


def _build_vc_envelope(
    credential: dict[str, Any],
    target_chain: str,
    claims_summary: dict[str, Any],
) -> dict[str, Any]:
    """Wrap an internal credential into a W3C-VC-style JSON envelope."""
    now_iso = datetime.now(timezone.utc).isoformat()

    # Compute integrity hash over credential + claims
    integrity_payload = json.dumps(
        {"credential_id": credential.get("credential_id"), "claims": credential.get("claims")},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    integrity_hash = _sha256(integrity_payload)

    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://zkde.fi/credentials/reputation/v1",
        ],
        "type": ["VerifiableCredential", "ReputationCredential"],
        "issuer": {
            "id": "did:web:zkde.fi",
            "name": "zkde.fi by Obsqra Labs",
        },
        "issuanceDate": credential.get("issued_at", now_iso),
        "expirationDate": credential.get("expires_at"),
        "credentialSubject": {
            "id": f"did:starknet:{credential.get('subject', '')}",
            "reputationScore": claims_summary.get("reputation_score_0_100", 0),
            "activityScore": claims_summary.get("activity_score_0_100", 0),
            "verifiedChains": claims_summary.get("verified_chain_count", 0),
            "protocolInteractions": claims_summary.get("action_type_counts", {}),
        },
        "proof": {
            "type": "Sha256HmacKey2024",
            "created": now_iso,
            "verificationMethod": "did:web:zkde.fi#reputation-signing-key",
            "proofPurpose": "assertionMethod",
            "signature": credential.get("signature", ""),
            "integrityHash": integrity_hash,
        },
        "metadata": {
            "credentialId": credential.get("credential_id"),
            "revocationId": credential.get("revocation_id"),
            "targetChain": target_chain,
            "template": credential.get("template"),
            "windowDays": claims_summary.get("window_days"),
            "versionMatrix": credential.get("version_matrix", {}),
        },
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/reputation/export")
async def export_reputation(
    req: ExportRequest,
    _wallet: str = WalletOwner,
):
    """
    Export a portable reputation credential.

    Flow: derive claims → issue credential → wrap as W3C-VC JSON → return.
    """
    svc = get_portable_identity_service()
    if not svc.enabled():
        raise HTTPException(status_code=503, detail="portable_identity_v3_disabled")

    target_chain = req.target_chain.lower().strip()
    if target_chain not in ("ethereum", "arbitrum", "base", "starknet", "optimism", "polygon"):
        raise HTTPException(status_code=400, detail=f"Unsupported target chain: {target_chain}")

    # 1. Derive claims (queries cross-chain fetcher + attribution store)
    attribution = await svc.query_attributions(
        subject=req.subject,
        window_days=req.window_days,
        filters=None,
        include_evidence=False,
    )
    rows = list(attribution.get("attributions") or [])

    coverage_score = float((attribution.get("summary") or {}).get("coverage_score", 0.0))
    verified_chain_count = int((attribution.get("summary") or {}).get("verified_chain_count", 0))
    activity_score = min(100.0, round(len(rows) * 2.5 + coverage_score * 25.0, 2))
    reputation_score = min(100.0, round(activity_score * 0.55 + verified_chain_count * 15.0, 2))

    action_type_counts: dict[str, int] = {}
    for r in rows:
        if isinstance(r, dict):
            act = str(r.get("action_type") or "unknown")
            action_type_counts[act] = action_type_counts.get(act, 0) + 1

    claims: dict[str, Any] = {
        "activity_score_0_100": activity_score,
        "reputation_score_0_100": reputation_score,
        "action_type_counts": action_type_counts,
    }

    # Filter claim keys if requested
    if req.claim_keys:
        claims = {k: v for k, v in claims.items() if k in req.claim_keys}

    claims_summary = {
        **claims,
        "window_days": req.window_days,
        "verified_chain_count": verified_chain_count,
    }

    # 2. Issue credential
    credential = svc.issue_credential(
        subject=req.subject,
        template="reputation_export",
        audience=target_chain,
        claims=claims,
        ttl_hours=req.ttl_hours,
    )

    # 3. Wrap into W3C-VC envelope
    envelope = _build_vc_envelope(credential, target_chain, claims_summary)

    return {
        "status": "ok",
        "target_chain": target_chain,
        "credential_id": credential.get("credential_id"),
        "revocation_id": credential.get("revocation_id"),
        "envelope": envelope,
    }


@router.post("/reputation/verify")
async def verify_portable(req: VerifyPortableRequest):
    """
    Verify a portable reputation credential envelope.

    Checks internal credential validity (signature, expiry, revocation) and
    re-hashes the integrity proof.
    """
    svc = get_portable_identity_service()
    if not svc.enabled():
        raise HTTPException(status_code=503, detail="portable_identity_v3_disabled")

    envelope = req.envelope
    metadata = envelope.get("metadata") or {}
    proof = envelope.get("proof") or {}
    credential_id = metadata.get("credentialId")

    if not credential_id:
        raise HTTPException(status_code=400, detail="Missing metadata.credentialId")

    # 1. Verify the underlying credential
    result = svc.verify_credential(credential_id, signature=proof.get("signature"))

    # 2. Verify integrity hash
    credential = result.get("credential") or {}
    integrity_payload = json.dumps(
        {"credential_id": credential.get("credential_id"), "claims": credential.get("claims")},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    expected_hash = _sha256(integrity_payload)
    integrity_ok = proof.get("integrityHash") == expected_hash

    return {
        "verified": result.get("verified", False) and integrity_ok,
        "credential_verified": result.get("verified", False),
        "integrity_verified": integrity_ok,
        "reason": result.get("reason", ""),
        "credential_id": credential_id,
        "subject": credential.get("subject"),
        "expires_at": credential.get("expires_at"),
        "target_chain": metadata.get("targetChain"),
    }
