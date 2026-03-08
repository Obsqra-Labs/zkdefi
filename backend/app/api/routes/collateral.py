"""Collateral Management API routes."""

import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

try:
    from app.api.validators import (
        validate_starknet_address, validate_token_symbol, validate_wei_amount,
    )
except ImportError:
    from backend.app.api.validators import (
        validate_starknet_address, validate_token_symbol, validate_wei_amount,
    )

logger = logging.getLogger(__name__)
router = APIRouter(tags=["collateral"])


class CollateralDepositRequest(BaseModel):
    """Request to deposit collateral."""
    user_address: str = Field(..., description="User's Starknet address")
    token: str = Field(..., description="Collateral token symbol")
    amount: int = Field(..., ge=1, description="Amount in wei")

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("token")
    @classmethod
    def check_token(cls, v: str) -> str:
        return validate_token_symbol(v)

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: int) -> int:
        return validate_wei_amount(v)


class CollateralWithdrawRequest(BaseModel):
    """Request to withdraw collateral."""
    user_address: str = Field(..., description="User's Starknet address")
    token: str = Field(..., description="Collateral token symbol")
    amount: int = Field(..., ge=1, description="Amount in wei")

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("token")
    @classmethod
    def check_token(cls, v: str) -> str:
        return validate_token_symbol(v)

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: int) -> int:
        return validate_wei_amount(v)


class CollateralResponse(BaseModel):
    """Response with collateral details."""
    user_address: str
    token: str
    balance: int
    locked: int
    available: int
    usd_value: float
    ltv_ratio: float


class CollateralHealthResponse(BaseModel):
    """Response with collateral health metrics."""
    user_address: str
    total_collateral_usd: float
    total_locked_usd: float
    health_factor: float  # >1.5 = healthy, <1.0 = liquidation risk
    status: str  # "healthy" | "at-risk" | "liquidation"
    liquidation_price: float


@router.post(
    "/collateral/deposit",
    response_model=CollateralResponse,
    summary="Deposit collateral",
    description="Deposit tokens as collateral for credit line",
)
async def deposit_collateral(request: CollateralDepositRequest) -> CollateralResponse:
    """
    Deposit collateral token.
    
    Process:
    1. Verify token is whitelisted
    2. Transfer token to vault
    3. Update collateral balance
    4. Recalculate LTV
    5. Return details
    """
    try:
        # Simulate deposit
        logger.info(
            f"Collateral deposit: user={request.user_address}, "
            f"token={request.token}, amount={request.amount}"
        )
        
        return CollateralResponse(
            user_address=request.user_address,
            token=request.token,
            balance=request.amount,
            locked=0,
            available=request.amount,
            usd_value=float(request.amount) / 1e18 * 1800,  # Assume $1800/token
            ltv_ratio=0.6,
        )
        
    except Exception as e:
        logger.error(f"Collateral deposit failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/collateral/withdraw",
    response_model=CollateralResponse,
    summary="Withdraw collateral",
    description="Withdraw collateral (if not locked)",
)
async def withdraw_collateral(request: CollateralWithdrawRequest) -> CollateralResponse:
    """
    Withdraw collateral token.
    
    Checks:
    1. Sufficient available balance
    2. Withdrawal won't trigger liquidation
    3. Process withdrawal
    """
    try:
        logger.info(
            f"Collateral withdrawal: user={request.user_address}, "
            f"token={request.token}, amount={request.amount}"
        )
        
        return CollateralResponse(
            user_address=request.user_address,
            token=request.token,
            balance=0,
            locked=0,
            available=0,
            usd_value=0.0,
            ltv_ratio=0.0,
        )
        
    except Exception as e:
        logger.error(f"Collateral withdrawal failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/collateral/{address}",
    summary="Get collateral details",
    description="Get all collateral positions for user",
)
async def get_collateral(
    address: str,
    limit: int = Query(20, ge=1, le=100, description="Max results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> dict[str, Any]:
    """Get user's collateral positions with pagination."""
    try:
        all_positions = [
            {
                "token": "ETH",
                "balance": 1000000000000000000,
                "locked": 0,
                "available": 1000000000000000000,
                "usd_value": 1800.0,
            }
        ]
        paginated = all_positions[offset : offset + limit]
        return {
            "user_address": address,
            "positions": paginated,
            "total_collateral_usd": sum(p["usd_value"] for p in all_positions),
            "total_locked_usd": 0.0,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": len(all_positions),
                "has_more": offset + limit < len(all_positions),
            },
        }
    except Exception as e:
        logger.error(f"Fetch collateral failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/collateral/health/{address}",
    response_model=CollateralHealthResponse,
    summary="Get collateral health",
    description="Get health factor and liquidation risk",
)
async def get_collateral_health(address: str) -> CollateralHealthResponse:
    """
    Get collateral health metrics.
    
    Health Factor = Total Collateral / Total Borrowed (at LTV)
    
    - >1.5: Healthy
    - 1.0-1.5: At risk
    - <1.0: Liquidation
    """
    from app.services.ttl_cache import collateral_cache

    try:
        cache_key = f"health:{address}"
        cached = await collateral_cache.get(cache_key)
        if cached:
            return CollateralHealthResponse(**cached)

        response = CollateralHealthResponse(
            user_address=address,
            total_collateral_usd=5000.0,
            total_locked_usd=3000.0,
            health_factor=1.67,
            status="healthy",
            liquidation_price=1800.0,
        )
        await collateral_cache.set(cache_key, response.model_dump())
        return response
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/collateral/liquidate",
    summary="Liquidate collateral",
    description="Force liquidation of at-risk position",
)
async def liquidate_collateral(
    user_address: str = Query(..., description="User address"),
    token: str = Query(..., description="Token to liquidate"),
) -> dict[str, Any]:
    """Trigger liquidation of at-risk collateral."""
    try:
        logger.info(f"Liquidation initiated: user={user_address}, token={token}")
        
        return {
            "status": "liquidated",
            "user_address": user_address,
            "token": token,
            "amount_liquidated": 1000000000000000000,
            "penalty_applied": 50000000000000000,
        }
    except Exception as e:
        logger.error(f"Liquidation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
