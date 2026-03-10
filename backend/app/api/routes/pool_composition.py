"""
Pool Composition API Routes

GET  /pools/{pool_id}/composition – current capital breakdown
POST /pools/{pool_id}/deploy      – deploy idle capital to an adapter
POST /pools/{pool_id}/close       – close an adapter position back to idle
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner, AdminOnly
from app.services.pool_composition_service import (
    VALID_POOL_IDS,
    close_position,
    credit_pool_idle,
    deploy_to_adapter,
    get_composition,
    invalidate_cache,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Pool Composition"])


# ---------------------------------------------------------------------------
# Lazy service accessors
# ---------------------------------------------------------------------------


def _vault_policy_svc():
    from app.services.vault_policy_service import get_vault_policy_service
    return get_vault_policy_service()


def _get_rebalance_mode(user_address: str) -> str:
    """Resolve rebalance_mode for the user from vault policy."""
    try:
        policy = _vault_policy_svc().get_policy(user_address, create_if_missing=True)
        return (policy or {}).get("execution_policy", {}).get("rebalance_mode", "user")
    except Exception:
        return "user"


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class PoolDeployRequest(BaseModel):
    adapter: str = Field(..., min_length=1, description="Target adapter (staking, lending, ekubo)")
    token: str = Field(..., min_length=1, description="Token symbol")
    amount_wei: int = Field(..., gt=0, description="Amount in wei")
    user_address: str = Field(..., min_length=3, description="Target user address for mode enforcement")
    refs: Optional[Dict[str, Any]] = None


class PoolCloseRequest(BaseModel):
    adapter: str = Field(..., min_length=1, description="Adapter to close from")
    token: str = Field(..., min_length=1, description="Token symbol")
    amount_wei: int = Field(..., gt=0, description="Amount in wei")
    user_address: str = Field(..., min_length=3, description="Target user address for mode enforcement")
    refs: Optional[Dict[str, Any]] = None


class PoolCreditRequest(BaseModel):
    token: str = Field(..., min_length=1, description="Token symbol")
    amount_wei: int = Field(..., gt=0, description="Amount in wei")
    source_account: str = Field(default="USER_DEPOSIT", min_length=1)
    refs: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Validation helper
# ---------------------------------------------------------------------------


def _validate_pool_id(pool_id: str) -> None:
    if pool_id not in VALID_POOL_IDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid pool_id '{pool_id}'. Must be one of: {', '.join(sorted(VALID_POOL_IDS))}",
        )


async def _enforce_rebalance_mode(
    user_address: str,
    request: Request,
    x_wallet_address: Optional[str] = None,
    x_admin_key: Optional[str] = None,
) -> str:
    """
    Enforce rebalance_mode authorization:
    - user mode: caller must be wallet owner (X-Wallet-Address matches user_address)
    - oracle mode: caller must be admin (X-Admin-Key valid); run zkML gate
    Returns the verified caller identity.
    """
    from app.middleware.auth import _normalize_address, ADMIN_API_KEY, APP_ENV

    mode = _get_rebalance_mode(user_address)

    if mode == "user":
        # Wallet owner auth
        caller = _normalize_address(x_wallet_address)
        if not caller or caller == "0x0":
            raise HTTPException(status_code=401, detail="Missing X-Wallet-Address header")
        target = _normalize_address(user_address)
        if caller != target:
            raise HTTPException(
                status_code=403,
                detail="Rebalance mode is 'user': only the wallet owner can deploy/close",
            )
        return caller

    elif mode == "oracle":
        # Admin auth
        if ADMIN_API_KEY:
            if x_admin_key != ADMIN_API_KEY:
                raise HTTPException(
                    status_code=403,
                    detail="Rebalance mode is 'oracle': requires valid admin key",
                )
        elif APP_ENV != "development":
            raise HTTPException(
                status_code=403,
                detail="Admin endpoints disabled — set ADMIN_API_KEY env var",
            )

        # zkML gate check (lightweight — use policy_engine)
        try:
            from app.services.policy_engine import check as policy_check
            result = await policy_check(
                user_address=user_address,
                action_type="rebalance",
                payload={"source": "oracle_rebalance"},
            )
            if not result.get("allowed", False):
                raise HTTPException(
                    status_code=403,
                    detail=f"zkML gate denied: {result.get('reason', 'unknown')}",
                )
        except HTTPException:
            raise
        except ImportError:
            logger.warning("policy_engine not available — skipping zkML gate in dev")
        except Exception as exc:
            logger.warning("zkML gate check failed (non-blocking in dev): %s", exc)

        return "admin"

    else:
        raise HTTPException(status_code=400, detail=f"Unknown rebalance_mode: {mode}")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/pools/{pool_id}/composition")
async def get_pool_composition(pool_id: str) -> Dict[str, Any]:
    """Return capital composition (idle + deployed breakdown) for a pool bucket."""
    _validate_pool_id(pool_id)
    return await get_composition(pool_id)


@router.post("/pools/{pool_id}/deploy")
async def deploy_pool_capital(
    pool_id: str,
    body: PoolDeployRequest,
    request: Request,
    x_wallet_address: Optional[str] = Header(None),
    x_admin_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Move idle capital from a pool bucket into an adapter position."""
    _validate_pool_id(pool_id)

    # Enforce rebalance mode authorization
    await _enforce_rebalance_mode(body.user_address, request, x_wallet_address, x_admin_key)

    try:
        entry = deploy_to_adapter(
            pool_id=pool_id,
            adapter=body.adapter,
            token=body.token,
            amount_wei=body.amount_wei,
            refs=body.refs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Invalidate cached composition
    await invalidate_cache(pool_id)

    return {"status": "ok", "entry": entry}


@router.post("/pools/{pool_id}/close")
async def close_pool_position(
    pool_id: str,
    body: PoolCloseRequest,
    request: Request,
    x_wallet_address: Optional[str] = Header(None),
    x_admin_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Close an adapter position and return capital to idle."""
    _validate_pool_id(pool_id)

    # Enforce rebalance mode authorization
    await _enforce_rebalance_mode(body.user_address, request, x_wallet_address, x_admin_key)

    try:
        entry = close_position(
            pool_id=pool_id,
            adapter=body.adapter,
            token=body.token,
            amount_wei=body.amount_wei,
            refs=body.refs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Invalidate cached composition
    await invalidate_cache(pool_id)

    return {"status": "ok", "entry": entry}
