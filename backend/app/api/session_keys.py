"""
Session Keys API endpoints.

Endpoints:
- /api/v1/zkdefi/session_keys/grant - Generate session key request
- /api/v1/zkdefi/session_keys/revoke - Revoke session key
- /api/v1/zkdefi/session_keys/list - List active sessions
- /api/v1/zkdefi/session_keys/validate - Validate session key
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.session_key_service import get_session_service

router = APIRouter()


# ==================== Request Models ====================

class GrantSessionRequest(BaseModel):
    """Request to grant a new session key."""
    owner_address: str
    session_key_address: str
    max_position: int
    allowed_protocols: list[str]  # ["pools", "ekubo", "jediswap"]
    duration_hours: int = 24


class ConfirmGrantRequest(BaseModel):
    """Confirm session grant on-chain."""
    session_id: str
    tx_hash: str


class RevokeSessionRequest(BaseModel):
    """Request to revoke a session key."""
    session_id: str
    owner_address: str


class ConfirmRevokeRequest(BaseModel):
    """Confirm session revoke on-chain."""
    session_id: str
    tx_hash: str


class ValidateSessionRequest(BaseModel):
    """Validate an action under a session."""
    session_id: str
    protocol_id: int
    amount: int


# ==================== Endpoints ====================

@router.post("/grant")
async def grant_session(data: GrantSessionRequest):
    """
    Generate a session key grant request.
    
    Returns calldata for the wallet to sign and submit on-chain.
    """
    try:
        service = get_session_service()
        result = await service.generate_session_request(
            owner_address=data.owner_address,
            session_key_address=data.session_key_address,
            max_position=data.max_position,
            allowed_protocols=data.allowed_protocols,
            duration_hours=data.duration_hours
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/grant/confirm")
async def confirm_grant(data: ConfirmGrantRequest):
    """
    Confirm that a session was granted on-chain.
    """
    try:
        service = get_session_service()
        result = await service.confirm_session_grant(
            session_id=data.session_id,
            tx_hash=data.tx_hash
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/revoke")
async def revoke_session(data: RevokeSessionRequest):
    """
    Generate a session revocation request.
    
    Returns calldata for the wallet to sign and submit on-chain.
    """
    try:
        service = get_session_service()
        result = await service.revoke_session(
            session_id=data.session_id,
            owner_address=data.owner_address
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/revoke/confirm")
async def confirm_revoke(data: ConfirmRevokeRequest):
    """
    Confirm that a session was revoked on-chain.
    """
    try:
        service = get_session_service()
        result = await service.confirm_session_revoke(
            session_id=data.session_id,
            tx_hash=data.tx_hash
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list/{owner_address}")
async def list_sessions(owner_address: str):
    """
    List all sessions for a user.
    """
    try:
        service = get_session_service()
        sessions = await service.list_user_sessions(owner_address=owner_address)
        return {
            "owner_address": owner_address,
            "sessions": sessions,
            "count": len(sessions),
            "active_count": len([s for s in sessions if s["is_active"]])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/validate")
async def validate_session(data: ValidateSessionRequest):
    """
    Validate if an action is allowed under a session.
    """
    try:
        service = get_session_service()
        result = await service.validate_session(
            session_id=data.session_id,
            protocol_id=data.protocol_id,
            amount=data.amount
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
