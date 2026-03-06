"""
Private Yield Vault API Routes

Endpoints for the hybrid lending vault: deposit tracking, vault stats,
deployment management, yield accrual, and withdrawal preparation.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.private_yield_service import (
    get_vault_stats,
    register_deposit,
    get_position,
    get_user_positions,
    prepare_withdrawal,
    complete_withdrawal,
    deploy_idle_capital,
    compute_allocation_split,
    accrue_yield,
    get_blended_apy,
    get_active_deployments,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/private-yield", tags=["Private Yield"])


class DepositRegistration(BaseModel):
    commitment: str
    amount_wei: int
    user_address: Optional[str] = None


@router.get("/vault/stats")
async def vault_stats():
    """Get private yield vault aggregate statistics."""
    return get_vault_stats()


@router.post("/deposit/register")
async def register_yield_deposit(req: DepositRegistration):
    """
    Register a private deposit in the yield vault ledger.
    Called after the on-chain deposit commitment is confirmed.
    """
    try:
        position = register_deposit(
            commitment=req.commitment,
            amount_wei=req.amount_wei,
            user_address=req.user_address,
        )
        return {"status": "registered", "position": position}
    except Exception as e:
        logger.exception("register_yield_deposit error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/position/{commitment}")
async def get_yield_position(commitment: str):
    """Get a specific yield vault position by commitment."""
    pos = get_position(commitment)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    return pos


@router.get("/positions/{user_address}")
async def get_user_yield_positions(user_address: str):
    """Get all active yield vault positions for a user."""
    positions = get_user_positions(user_address)
    return {
        "user_address": user_address,
        "positions": positions,
        "count": len(positions),
    }


@router.get("/withdrawal/prepare/{commitment}")
async def prepare_yield_withdrawal(commitment: str):
    """
    Prepare withdrawal data: compute principal + yield.
    Returns whether idle balance is sufficient or unwind is needed.
    """
    return prepare_withdrawal(commitment)


@router.post("/withdrawal/complete/{commitment}")
async def complete_yield_withdrawal(commitment: str):
    """Mark position as withdrawn after on-chain ZK withdrawal succeeds."""
    success = complete_withdrawal(commitment)
    if not success:
        raise HTTPException(status_code=404, detail="Position not found or already withdrawn")
    return {"status": "withdrawn", "commitment": commitment}


class DeployRequest(BaseModel):
    risk_profile: str = "balanced"


@router.post("/deploy")
async def deploy_idle(req: DeployRequest):
    """Deploy idle vault capital to Ekubo LP and/or LendingPool."""
    try:
        result = await deploy_idle_capital(req.risk_profile)
        return result
    except Exception as e:
        logger.exception("deploy_idle error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/allocation/preview/{amount_wei}")
async def preview_allocation(amount_wei: int, risk_profile: str = "balanced"):
    """Preview how capital would be allocated between Ekubo and LendingPool."""
    return compute_allocation_split(amount_wei, risk_profile)


@router.post("/yield/accrue")
async def trigger_accrual():
    """Manually trigger yield accrual across all active deployments."""
    return accrue_yield()


@router.get("/yield/blended")
async def blended_yield():
    """Get unified yield calculation: Ekubo fees + lending interest = blended APY."""
    return get_blended_apy()


@router.get("/deployments")
async def list_deployments():
    """List all active capital deployments."""
    deployments = get_active_deployments()
    return {"deployments": deployments, "count": len(deployments)}
