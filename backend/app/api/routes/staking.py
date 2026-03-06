"""
Staking API Routes

Native Starknet delegated staking endpoints: pools, positions, stake/unstake
calldata, and APY queries. All calldata endpoints build multicall payloads
for frontend wallet signing (no private keys needed).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from app.services.staking.native_staking import (
        get_delegation_pools,
        get_user_delegation_positions,
        get_staking_overview,
        build_delegate_calldata,
        build_exit_intent_calldata,
    )

    _SERVICE_AVAILABLE = True
except Exception:
    _SERVICE_AVAILABLE = False

router = APIRouter(prefix="/staking", tags=["staking"])


def _check_service() -> None:
    if not _SERVICE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Staking service unavailable")


# ── Request models ────────────────────────────────────────────────────────


class StakeCalldataRequest(BaseModel):
    pool_contract: str
    amount_wei: int
    reward_address: str


class UnstakeCalldataRequest(BaseModel):
    pool_contract: str
    amount_wei: int


# ── Endpoints ─────────────────────────────────────────────────────────────


@router.get("/pools")
async def staking_pools() -> dict[str, Any]:
    """Available staking pools / validators accepting delegation."""
    _check_service()
    pools = await get_delegation_pools()
    return {
        "pools": [
            {
                "pool_address": p.pool_address,
                "staker_address": p.staker_address,
                "name": p.name,
                "commission_pct": p.commission_pct,
                "estimated_apr_pct": p.estimated_apr_pct,
                "active": p.active,
            }
            for p in pools
        ],
        "count": len(pools),
    }


@router.get("/positions/{address}")
async def user_positions(address: str) -> dict[str, Any]:
    """User's delegation positions across known pools."""
    _check_service()
    positions = await get_user_delegation_positions(address)
    return {
        "address": address,
        "positions": [
            {
                "pool_address": pos.pool_address,
                "pool_name": pos.pool_name,
                "delegated_wei": str(pos.delegated_wei),
                "delegated_strk": pos.delegated_wei / 1e18,
                "unclaimed_rewards_wei": str(pos.unclaimed_rewards_wei),
                "unclaimed_rewards_strk": pos.unclaimed_rewards_wei / 1e18,
                "pending_exit_wei": str(pos.pending_exit_wei),
                "exit_available_at": pos.exit_available_at,
            }
            for pos in positions
        ],
        "count": len(positions),
    }


@router.post("/stake/calldata")
async def stake_calldata(req: StakeCalldataRequest) -> dict[str, Any]:
    """Build multicall (approve STRK + enter_delegation_pool) for wallet signing."""
    _check_service()
    if req.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    if not req.pool_contract:
        raise HTTPException(status_code=400, detail="pool_contract is required")
    calls = build_delegate_calldata(req.pool_contract, req.amount_wei, req.reward_address)
    return {
        "calls": calls,
        "message": f"Delegate {req.amount_wei} wei STRK to pool {req.pool_contract}",
    }


@router.post("/unstake/calldata")
async def unstake_calldata(req: UnstakeCalldataRequest) -> dict[str, Any]:
    """Build calldata for exit_delegation_pool_intent (starts cooldown)."""
    _check_service()
    if req.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    if not req.pool_contract:
        raise HTTPException(status_code=400, detail="pool_contract is required")
    calls = build_exit_intent_calldata(req.pool_contract, req.amount_wei)
    return {
        "calls": calls,
        "message": f"Begin unstake of {req.amount_wei} wei STRK from pool {req.pool_contract}",
    }


@router.get("/apy")
async def staking_apy() -> dict[str, Any]:
    """Current staking APY derived from on-chain overview and pool data."""
    _check_service()
    overview = await get_staking_overview()
    pools = await get_delegation_pools()

    pool_aprs = [p.estimated_apr_pct for p in pools if p.active and p.estimated_apr_pct > 0]
    avg_apr = sum(pool_aprs) / len(pool_aprs) if pool_aprs else 0.0

    return {
        "network": "sepolia",
        "total_stake_strk": overview.total_stake_strk,
        "current_epoch": overview.current_epoch,
        "is_paused": overview.is_paused,
        "average_apr_pct": round(avg_apr, 2),
        "pool_count": len(pool_aprs),
    }
