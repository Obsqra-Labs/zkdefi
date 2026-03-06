"""Dual-wallet auth/session routes.

This route binds a Starknet address to a signature-verified EVM address as an
off-chain session handle for UX and trust-context use.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.dual_wallet_session_service import get_dual_wallet_session_service
from app.services.linked_address_verification_service import LinkedAddressVerificationError

router = APIRouter(prefix="/auth/session", tags=["auth_session"])


class SessionStartRequest(BaseModel):
    starknet_address: str
    chain: str = "ethereum"
    address: str


class SessionCompleteRequest(BaseModel):
    starknet_address: str
    chain: str = "ethereum"
    address: str
    nonce_id: str
    signature: str
    auth_provider: str | None = None
    credentials: dict[str, Any] | None = None


@router.post("/start")
async def start_session(req: SessionStartRequest):
    svc = get_dual_wallet_session_service()
    try:
        payload = svc.start(req.starknet_address, req.chain, req.address)
        payload["purpose"] = "dual_wallet_session"
        return payload
    except LinkedAddressVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/complete")
async def complete_session(req: SessionCompleteRequest):
    svc = get_dual_wallet_session_service()
    try:
        payload = svc.complete(
            req.starknet_address,
            req.chain,
            req.address,
            req.nonce_id,
            req.signature,
            auth_provider=req.auth_provider,
            credentials=req.credentials,
        )
        payload["purpose"] = "dual_wallet_session"
        payload["identity_binding_enabled"] = True
        payload["disclaimer"] = (
            "Signature-verified identity bind; not a legal identity verification."
        )
        return payload
    except LinkedAddressVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{starknet_address}")
async def get_session(starknet_address: str):
    return get_dual_wallet_session_service().get(starknet_address)


@router.delete("/{starknet_address}")
async def revoke_session(starknet_address: str):
    payload = get_dual_wallet_session_service().revoke(starknet_address)
    payload["revoked"] = payload.get("status") == "revoked"
    return payload
