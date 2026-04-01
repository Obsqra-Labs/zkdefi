"""
Portable Passport API — canonical PPP endpoints.

GET  /portable/{address}           → full PPP v1 object
GET  /portable/{address}/public    → redacted public card
GET  /portable/{address}/evidence  → evidence pointers only
POST /portable/{address}/disclosure-pack → selective disclosure bundle
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.services.portable_passport_service import get_portable_passport_service
from app.services.disclosure_pack_service import get_disclosure_pack_service, VALID_CLAIM_KEYS
from app.services.passport_export_service import get_passport_export_service

router = APIRouter(tags=["passport-portable"])

_HEX_RE = re.compile(r"^0x[0-9a-fA-F]{1,64}$")


def _validate_address(address: str) -> str:
    addr = (address or "").strip()
    if not _HEX_RE.match(addr):
        raise HTTPException(status_code=400, detail="Address must be a valid hex string starting with 0x")
    return addr


@router.get("/portable/{address}")
async def get_portable_passport(address: str, request: Request) -> dict[str, Any]:
    """Full Portable Passport Profile v1 for an address."""
    addr = _validate_address(address)
    svc = get_portable_passport_service()
    return await svc.get_passport(addr, request=request)


@router.get("/portable/{address}/public")
async def get_portable_passport_public(address: str, request: Request) -> dict[str, Any]:
    """Redacted public card — safe to share externally."""
    addr = _validate_address(address)
    svc = get_portable_passport_service()
    return await svc.get_public_card(addr, request=request)


@router.get("/portable/{address}/evidence")
async def get_portable_passport_evidence(address: str, request: Request) -> dict[str, Any]:
    """Evidence pointers only — lightweight verification references."""
    addr = _validate_address(address)
    svc = get_portable_passport_service()
    return await svc.get_evidence(addr, request=request)


@router.post("/portable/{address}/disclosure-pack")
async def create_disclosure_pack(address: str, request: Request) -> dict[str, Any]:
    """Generate a selective disclosure pack from the holder's PPP.

    Request body: { "claim_keys": ["reputation_tier", "execution_eligibility", ...] }
    Valid keys: identity_binding, reputation_tier, execution_eligibility,
                lending_eligibility, risk_posture, defi_activity,
                builder_activity, evidence.
    """
    addr = _validate_address(address)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")

    claim_keys = body.get("claim_keys")
    if not isinstance(claim_keys, list) or not claim_keys:
        raise HTTPException(
            status_code=400,
            detail=f"claim_keys must be a non-empty list. Valid keys: {sorted(VALID_CLAIM_KEYS)}",
        )

    try:
        svc = get_disclosure_pack_service()
        return await svc.generate(addr, claim_keys, request=request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/portable/{address}/export")
async def export_signed_passport(address: str, request: Request) -> dict[str, Any]:
    """Export a signed envelope containing the full PPP.

    Optional body: { "ttl_hours": 168 }   (default 168 = 7 days)
    """
    addr = _validate_address(address)

    ttl = 168
    try:
        body = await request.json()
        ttl = body.get("ttl_hours", 168)
    except Exception:
        pass  # no body is fine — use defaults

    ppp_svc = get_portable_passport_service()
    ppp = await ppp_svc.get_passport(addr, request=request)

    export_svc = get_passport_export_service()
    return export_svc.sign_envelope(ppp, payload_type="ppp_v1", ttl_hours=ttl)


@router.post("/portable/{address}/export-disclosure")
async def export_signed_disclosure(address: str, request: Request) -> dict[str, Any]:
    """Export a signed envelope wrapping a disclosure pack.

    Body: { "claim_keys": ["reputation_tier", ...], "ttl_hours": 168 }
    """
    addr = _validate_address(address)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")

    claim_keys = body.get("claim_keys")
    if not isinstance(claim_keys, list) or not claim_keys:
        raise HTTPException(
            status_code=400,
            detail=f"claim_keys must be a non-empty list. Valid keys: {sorted(VALID_CLAIM_KEYS)}",
        )

    ttl = body.get("ttl_hours", 168)

    try:
        dp_svc = get_disclosure_pack_service()
        pack = await dp_svc.generate(addr, claim_keys, request=request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    export_svc = get_passport_export_service()
    return export_svc.sign_envelope(pack, payload_type="disclosure_pack.v1", ttl_hours=ttl)


@router.post("/verify-envelope")
async def verify_envelope(request: Request) -> dict[str, Any]:
    """Verify a signed export envelope (no address needed).

    Body: the full envelope dict as received from /export or /export-disclosure.
    Returns: { "valid": bool, "reason": str | null, "payload_type": str }
    """
    try:
        envelope = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")

    if not isinstance(envelope, dict) or "signature" not in envelope:
        raise HTTPException(status_code=400, detail="Body must be a signed envelope with a 'signature' field")

    svc = get_passport_export_service()
    return svc.verify_envelope(envelope)
