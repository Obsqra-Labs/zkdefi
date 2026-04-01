from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.session_key_service import get_session_key_service
from app.services.starknet_signature_verification_service import (
    StarknetSignatureVerificationError,
    get_starknet_signature_verification_service,
)

router = APIRouter(tags=["session-keys"])
svc = get_session_key_service()
sig_svc = get_starknet_signature_verification_service()


class SessionKeyCreateRequest(BaseModel):
    owner_address: str
    session_public_key: str
    policy_hash: str | None = None
    expires_at: str | None = None
    message_hash: str
    signature: Any


class SessionKeyRevokeRequest(BaseModel):
    owner_address: str


@router.get("/{owner_address}")
async def list_session_keys(owner_address: str) -> list[dict[str, Any]]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return svc.list_keys(owner_address)


@router.get("/list/{owner_address}")
async def list_session_keys_legacy(owner_address: str) -> dict[str, Any]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    rows = await svc.list_user_sessions(owner_address)
    return {
        "owner_address": owner_address.lower(),
        "sessions": rows,
        "count": len(rows),
        "active_count": len([row for row in rows if row.get("is_active")]),
    }


@router.post("")
async def create_session_key(body: SessionKeyCreateRequest) -> dict[str, Any]:
    if not body.owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    if body.expires_at:
        try:
            expiry = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid expires_at timestamp") from exc
        if expiry <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="expires_at must be in the future")

    try:
        sig_svc.verify_message_hash(
            starknet_address=body.owner_address,
            message_hash=body.message_hash,
            signature=body.signature,
        )
    except StarknetSignatureVerificationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    signature_digest = str(body.signature).strip()
    if isinstance(body.signature, (list, dict)):
        signature_digest = str(body.signature)

    return svc.create_key(
        owner_address=body.owner_address,
        session_public_key=body.session_public_key,
        policy_hash=body.policy_hash,
        message_hash=body.message_hash,
        signature_digest=signature_digest[:128],
        expires_at=body.expires_at,
    )


@router.delete("/{key_id}")
async def revoke_session_key(key_id: str, body: SessionKeyRevokeRequest) -> dict[str, Any]:
    if not body.owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return svc.revoke_key(key_id, body.owner_address)
