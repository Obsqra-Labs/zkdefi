"""
Collateral API Routes

Manages on-chain collateral for the lending system via CollateralVault.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.services.collateral_service import (
    get_user_positions,
    get_user_total_collateral,
    build_deposit_calldata,
    build_withdraw_calldata,
    record_deposit,
    record_withdrawal,
    ETH_TOKEN,
)

router = APIRouter(prefix="/collateral", tags=["collateral"])


class DepositRequest(BaseModel):
    token: str = ETH_TOKEN
    amount_wei: int
    pool_tier: str = "core"


class DepositConfirmRequest(BaseModel):
    address: str
    position_id: int
    token: str = ETH_TOKEN
    amount_wei: int
    pool_tier: str = "core"
    tx_hash: Optional[str] = None


class WithdrawRequest(BaseModel):
    position_id: int


class WithdrawConfirmRequest(BaseModel):
    address: str
    position_id: int


@router.get("/positions/{address}")
async def collateral_positions(address: str):
    positions = get_user_positions(address)
    return {"address": address, "positions": positions, "count": len(positions)}


@router.get("/total/{address}")
async def collateral_total(address: str):
    return get_user_total_collateral(address)


@router.post("/deposit")
async def deposit_collateral(req: DepositRequest):
    """Build multicall (approve + deposit_collateral) for wallet signing."""
    if req.pool_tier not in ("core", "boost"):
        return {"error": "invalid pool_tier, must be 'core' or 'boost'"}
    return build_deposit_calldata(req.token, req.amount_wei, req.pool_tier)


@router.post("/deposit/confirm")
async def confirm_deposit(req: DepositConfirmRequest):
    """Record a confirmed deposit in local cache after on-chain tx."""
    pos = record_deposit(
        address=req.address,
        position_id=req.position_id,
        token=req.token,
        amount_wei=req.amount_wei,
        pool_tier=req.pool_tier,
        tx_hash=req.tx_hash,
    )
    return {"status": "recorded", "position": pos}


@router.post("/withdraw")
async def withdraw_collateral(req: WithdrawRequest):
    """Build calldata for withdraw_collateral."""
    return build_withdraw_calldata(req.position_id)


@router.post("/withdraw/confirm")
async def confirm_withdrawal(req: WithdrawConfirmRequest):
    """Record a confirmed withdrawal in local cache."""
    ok = record_withdrawal(req.address, req.position_id)
    return {"status": "recorded" if ok else "not_found"}
