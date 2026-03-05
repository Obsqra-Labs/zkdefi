"""Shared pool API routes (manager envelope + member overrides)."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.shared_pool_executor import get_shared_pool_executor
from app.services.shared_pool_service import get_shared_pool_service

router = APIRouter(prefix="/shared_pools", tags=["shared_pools"])


class CreateSharedPoolRequest(BaseModel):
    manager_address: str
    shared_pool_id: str | None = None
    envelope: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class UpdateEnvelopeRequest(BaseModel):
    envelope: dict[str, Any] = Field(default_factory=dict)


class JoinSharedPoolRequest(BaseModel):
    member_address: str
    member_override: dict[str, Any] = Field(default_factory=dict)
    autopilot_opt_in: bool = False
    session_scope: dict[str, Any] = Field(default_factory=dict)


class UpdateMemberRequest(BaseModel):
    member_override: dict[str, Any] | None = None
    autopilot_opt_in: bool | None = None
    session_scope: dict[str, Any] | None = None


class CreateProposalRequest(BaseModel):
    manager_address: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ExecuteProposalRequest(BaseModel):
    proposal_id: str
    member_address: str
    execution_intent: str = "autonomous"
    wallet_connected: bool = False



def _enabled() -> bool:
    return os.getenv("SHARED_POOLS_V1_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}


@router.post("")
async def create_shared_pool(data: CreateSharedPoolRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    try:
        return get_shared_pool_service().create_pool(
            manager_address=data.manager_address,
            shared_pool_id=data.shared_pool_id,
            envelope=data.envelope,
            metadata=data.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{shared_pool_id}")
async def get_shared_pool(shared_pool_id: str):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    item = get_shared_pool_service().get_pool(shared_pool_id)
    if not item:
        raise HTTPException(status_code=404, detail="shared pool not found")
    item["members"] = get_shared_pool_service().list_members(shared_pool_id)
    return item


@router.put("/{shared_pool_id}/envelope")
async def put_shared_pool_envelope(shared_pool_id: str, data: UpdateEnvelopeRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    try:
        return get_shared_pool_service().update_envelope(shared_pool_id, data.envelope)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{shared_pool_id}/join")
async def join_shared_pool(shared_pool_id: str, data: JoinSharedPoolRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    try:
        return get_shared_pool_service().join_pool(
            shared_pool_id,
            data.member_address,
            member_override=data.member_override,
            autopilot_opt_in=data.autopilot_opt_in,
            session_scope=data.session_scope,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/{shared_pool_id}/member/{member_address}")
async def put_shared_pool_member(shared_pool_id: str, member_address: str, data: UpdateMemberRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    try:
        patch: dict[str, Any] = {}
        if data.member_override is not None:
            patch["member_override"] = data.member_override
        if data.autopilot_opt_in is not None:
            patch["autopilot_opt_in"] = data.autopilot_opt_in
        if data.session_scope is not None:
            patch["session_scope"] = data.session_scope
        return get_shared_pool_service().update_member(shared_pool_id, member_address, patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{shared_pool_id}/proposals")
async def create_shared_pool_proposal(shared_pool_id: str, data: CreateProposalRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    try:
        return get_shared_pool_service().create_proposal(
            shared_pool_id,
            data.manager_address,
            data.payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{shared_pool_id}/execute")
async def execute_shared_pool_proposal(shared_pool_id: str, data: ExecuteProposalRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="shared pools disabled")
    proposal_id = str(data.proposal_id or "")
    if not proposal_id:
        raise HTTPException(status_code=422, detail="proposal_id is required")
    try:
        return await get_shared_pool_executor().execute(
            shared_pool_id=shared_pool_id,
            proposal_id=proposal_id,
            member_address=data.member_address,
            execution_intent=data.execution_intent,
            wallet_connected=data.wallet_connected,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
