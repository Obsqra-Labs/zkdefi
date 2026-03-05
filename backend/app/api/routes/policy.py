"""Vault policy + compile API routes."""

from __future__ import annotations

import os
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ...middleware.auth import require_wallet_owner, require_admin

from app.services.policy_compiler_service import get_policy_compiler_service
from app.services.receipt_service import get_receipt_service
from app.services.session_key_service import get_session_service
from app.services.shared_pool_service import get_shared_pool_service
from app.services.vault_policy_service import get_vault_policy_service
from app.api.routes.onboarding import clear_onboarding_state

router = APIRouter(prefix="/policy", tags=["policy"])


class VaultPolicyPutRequest(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)


class PolicyCompileRequest(BaseModel):
    user_address: str
    action_type: Literal["deposit", "withdraw", "swap", "lp_add", "lp_remove", "deploy", "rebalance"] = "deposit"
    execution_intent: Literal["manual_wallet", "orchestrated", "autonomous", "session"] = "manual_wallet"
    wallet_connected: bool = False
    shared_pool_id: str | None = None
    member_address: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class PolicyPreviewRequest(PolicyCompileRequest):
    pass



def _enabled() -> bool:
    return os.getenv("VAULT_POLICY_V1_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}


def _reset_enabled() -> bool:
    explicit = os.getenv("DEV_STATE_RESET_ENABLED", "").strip().lower()
    if explicit in {"1", "true", "yes", "on"}:
        return True
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    return app_env != "production"


async def _decision_context(user_address: str, request: Request) -> dict[str, Any] | None:
    base = str(request.base_url).rstrip("/")
    if not base:
        return None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{base}/api/v1/zkdefi/risk_profile/v2/{user_address}")
            if resp.status_code != 200:
                return None
            payload = resp.json()
            return {
                "decisions": payload.get("decisions", {}),
                "disclosures": payload.get("disclosures", {}),
                "feature_flags": payload.get("feature_flags", {}),
            }
    except Exception:
        return None


@router.get("/vault/{user_address}")
async def get_vault_policy(user_address: str):
    if not _enabled():
        raise HTTPException(status_code=404, detail="vault policy disabled")

    svc = get_vault_policy_service()
    policy = svc.get_policy(user_address, create_if_missing=True)
    if not policy:
        raise HTTPException(status_code=400, detail="invalid user address")
    return policy


@router.put("/vault/{user_address}")
async def put_vault_policy(
    user_address: str,
    data: VaultPolicyPutRequest,
    _caller: str = Depends(require_wallet_owner),
):
    if not _enabled():
        raise HTTPException(status_code=404, detail="vault policy disabled")

    try:
        policy = get_vault_policy_service().put_policy(user_address, data.patch)
        return policy
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/compile")
async def compile_policy(data: PolicyCompileRequest, request: Request):
    if not _enabled():
        raise HTTPException(status_code=404, detail="vault policy disabled")

    try:
        result = get_policy_compiler_service().compile(data.model_dump())
        get_receipt_service().append_policy_compile_receipt(
            user_address=data.member_address or data.user_address,
            action_type=data.action_type,
            execution_intent=data.execution_intent,
            effective_policy_hash=result.get("effective_policy_hash"),
            execution_path=result.get("execution_path"),
            can_execute=bool(result.get("can_execute", False)),
            blocking_reasons=result.get("blocking_reasons") or [],
            warnings=result.get("warnings") or [],
            shared_pool_id=data.shared_pool_id,
        )
        out = {k: v for k, v in result.items() if k != "effective_policy"}
        ctx = await _decision_context(data.member_address or data.user_address, request)
        if ctx is not None:
            out["decision_context"] = ctx
        return out
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/preview")
async def preview_policy(data: PolicyPreviewRequest, request: Request):
    if not _enabled():
        raise HTTPException(status_code=404, detail="vault policy disabled")

    try:
        result = get_policy_compiler_service().compile(data.model_dump())
        out = {
            "path_label": result.get("execution_path"),
            "required_proofs": result.get("required_proofs"),
            "requires_relayer": result.get("requires_relayer"),
            "estimated_steps": max(1, len(result.get("required_proofs") or [])),
            "warnings": result.get("warnings") or [],
            "can_execute": result.get("can_execute", False),
            "blocking_reasons": result.get("blocking_reasons") or [],
            "effective_policy_hash": result.get("effective_policy_hash"),
            "legacy_preset_label": result.get("legacy_preset_label"),
            "gate_required": result.get("gate_required"),
            "advisory_only": result.get("advisory_only"),
        }
        ctx = await _decision_context(data.member_address or data.user_address, request)
        if ctx is not None:
            out["decision_context"] = ctx
        return out
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/reset/{user_address}")
async def reset_user_policy_state(user_address: str, _admin: str = Depends(require_admin)):
    """
    Development reset helper.
    Clears backend-file state for one user so onboarding/policy/proof testing can restart clean.
    Note: immutable on-chain records are not deleted.
    """
    if not _reset_enabled():
        raise HTTPException(status_code=404, detail="state reset disabled")

    try:
        onboarding_cleared = clear_onboarding_state(user_address)
        policy_deleted = get_vault_policy_service().delete_policy(user_address)
        receipt_stats = get_receipt_service().delete_user_receipts(user_address)
        session_removed = get_session_service().clear_user_sessions(user_address)
        shared_pool_stats = get_shared_pool_service().purge_user(user_address)

        return {
            "user_address": user_address,
            "reset": {
                "onboarding_state_cleared": onboarding_cleared,
                "vault_policy_deleted": policy_deleted,
                "sessions_removed": session_removed,
                "receipts_removed": receipt_stats.get("removed_receipts", 0),
                "receipt_index_entries_removed": receipt_stats.get("removed_index_entries", 0),
                "shared_pools_removed": shared_pool_stats.get("removed_pools", 0),
                "shared_memberships_removed": shared_pool_stats.get("removed_memberships", 0),
            },
            "note": "Browser history/localStorage and on-chain immutable records are not deleted by this endpoint.",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
