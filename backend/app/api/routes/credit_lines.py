"""Credit Lines & FICO Scoring API routes."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.middleware.auth import WalletOwner

try:
    from app.services.credit_line_service import get_credit_line_service, compute_credit_line
    from app.services.credit_eligibility_proof_service import get_credit_eligibility_service
    from app.api.validators import (
        validate_starknet_address, validate_token_symbol,
        validate_wei_amount, validate_usd_amount,
    )
except ImportError:
    from backend.app.services.credit_line_service import get_credit_line_service, compute_credit_line
    from backend.app.services.credit_eligibility_proof_service import get_credit_eligibility_service
    from backend.app.api.validators import (
        validate_starknet_address, validate_token_symbol,
        validate_wei_amount, validate_usd_amount,
    )

logger = logging.getLogger(__name__)

WEI_PER_ETH = 10**18
router = APIRouter(tags=["credit-lines"])


class CreditLineRequest(BaseModel):
    """Request to open/update credit line."""
    user_address: str = Field(..., description="User's Starknet address")
    collateral_token: str = Field(..., description="Collateral token symbol")
    collateral_amount: int = Field(..., ge=1, description="Collateral amount in wei")
    desired_credit_usd: int = Field(..., ge=100, description="Desired credit line in USD")

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("collateral_token")
    @classmethod
    def check_token(cls, v: str) -> str:
        return validate_token_symbol(v)

    @field_validator("collateral_amount")
    @classmethod
    def check_collateral(cls, v: int) -> int:
        return validate_wei_amount(v)

    @field_validator("desired_credit_usd")
    @classmethod
    def check_credit(cls, v: int) -> int:
        return validate_usd_amount(v)


class CreditScoreRequest(BaseModel):
    """Request to calculate credit score."""
    user_address: str = Field(..., description="User's Starknet address")
    include_proof: bool = Field(default=False, description="Generate zk-proof of score")


class CreditLineResponse(BaseModel):
    """Response with credit line details."""
    user_address: str
    status: str  # "pending" | "active" | "closed"
    credit_limit_usd: int
    credit_available_usd: int
    credit_used_usd: int
    collateral_token: str
    collateral_amount: int
    ltv_ratio: float
    interest_rate: float
    created_at: str


class CreditScoreResponse(BaseModel):
    """Response with credit score."""
    user_address: str
    fico_score: int  # 300-850
    fico_tier: str  # "poor" | "fair" | "good" | "excellent"
    components: dict[str, Any]
    confidence: float
    proof: str | None = None


class CreditTransactionRequest(BaseModel):
    """Request to borrow or repay."""
    user_address: str
    amount_usd: int = Field(..., ge=1, description="Amount to borrow/repay in USD")
    action: str = Field(..., description="'borrow' or 'repay'")

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("amount_usd")
    @classmethod
    def check_amount(cls, v: int) -> int:
        return validate_usd_amount(v)

    @field_validator("action")
    @classmethod
    def check_action(cls, v: str) -> str:
        if v not in ("borrow", "repay"):
            raise ValueError("action must be 'borrow' or 'repay'")
        return v


class CreditTransactionResponse(BaseModel):
    """Response from borrow/repay."""
    status: str  # "pending" | "confirmed" | "failed"
    tx_hash: str | None
    action: str
    amount: int
    new_balance: int


async def _fetch_credit_context(base_url: str, address: str) -> tuple[dict, dict, dict]:
    """Fetch reputation, risk_passport, linked_addresses for credit line computation."""
    async with httpx.AsyncClient(timeout=12.0) as client:
        paths = [
            f"/api/v1/zkdefi/reputation/user/{address}",
            f"/api/v1/zkdefi/risk_passport/user/{address}",
            f"/api/v1/zkdefi/linked_addresses/{address}",
        ]
        results = await asyncio.gather(
            *[client.get(f"{base_url.rstrip('/')}{p}") for p in paths],
            return_exceptions=True,
        )
    rep = results[0].json() if not isinstance(results[0], Exception) and results[0].status_code == 200 else {}
    passport = results[1].json() if not isinstance(results[1], Exception) and results[1].status_code == 200 else {}
    linked = results[2].json() if not isinstance(results[2], Exception) and results[2].status_code == 200 else {}
    return rep, passport, linked


async def _collateral_eth_from_request(
    collateral_token: str,
    collateral_amount: int,
) -> float:
    """Convert collateral amount (wei) to ETH-equivalent for credit line computation."""
    amount_token = collateral_amount / WEI_PER_ETH
    if collateral_token.upper() == "ETH":
        return amount_token
    try:
        from app.services.ekubo.oracle_adapter import get_live_prices
        prices = await get_live_prices()
        eth_usd = float(prices.get("eth_usd") or 1800)
        token_usd = float(prices.get("strk_usd") or 0.45) if collateral_token.upper() == "STRK" else eth_usd
        return amount_token * token_usd / eth_usd if eth_usd > 0 else amount_token
    except Exception:
        return amount_token  # fallback: treat as ETH-equivalent


@router.post(
    "/credit/lines/open",
    response_model=CreditLineResponse,
    summary="Open credit line",
    description="Open a new credit line against collateral",
)
async def open_credit_line(
    request: CreditLineRequest,
    http_request: Request,
    _caller: str = WalletOwner,
) -> CreditLineResponse:
    """
    Open a credit line with collateral.
    
    Process:
    1. Verify collateral quality
    2. Compute LTV and rate from credit_line_service (reputation + collateral)
    3. Determine credit limit based on FICO + collateral
    4. Create credit account
    5. Return credit line details
    """
    service = get_credit_line_service()
    
    try:
        base = str(http_request.base_url).rstrip("/")
        rep, passport, linked = await _fetch_credit_context(base, request.user_address)
        
        collateral_eth = await _collateral_eth_from_request(
            request.collateral_token,
            request.collateral_amount,
        )
        tier = int(rep.get("tier", 0) or 0)
        letter_rating = str(passport.get("letter_rating", "D") or "D")
        credit_tier = passport.get("credit_tier")
        verification = linked.get("verification") or {}
        linked_count = (
            sum(1 for v in verification.values() if isinstance(v, dict) and v.get("verified"))
            if isinstance(verification, dict)
            else 0
        )
        cross_chain_verified = linked_count > 0
        
        terms = compute_credit_line(
            collateral_eth=collateral_eth,
            tier=tier,
            letter_rating=letter_rating,
            credit_tier=credit_tier,
            linked_address_count=linked_count,
            cross_chain_verified=cross_chain_verified,
        )
        
        ltv_ratio = (
            terms.collateral_line_eth / collateral_eth
            if collateral_eth > 0
            else 0.80
        )
        interest_rate = terms.rate_bps / 10_000
        
        credit_line = await service.open_credit_line(
            user_address=request.user_address,
            collateral_token=request.collateral_token,
            collateral_amount=request.collateral_amount,
            desired_credit_usd=request.desired_credit_usd,
        )
        
        if not credit_line:
            raise HTTPException(status_code=400, detail="Failed to open credit line")
        
        logger.info(
            f"Credit line opened: user={request.user_address}, "
            f"limit=${request.desired_credit_usd}, ltv={ltv_ratio:.2f}, rate={interest_rate:.2%}"
        )
        
        return CreditLineResponse(
            user_address=request.user_address,
            status="pending",
            credit_limit_usd=request.desired_credit_usd,
            credit_available_usd=request.desired_credit_usd,
            credit_used_usd=0,
            collateral_token=request.collateral_token,
            collateral_amount=request.collateral_amount,
            ltv_ratio=round(ltv_ratio, 4),
            interest_rate=round(interest_rate, 4),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Credit line opening failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/credit/score/{address}",
    response_model=CreditScoreResponse,
    summary="Get FICO credit score",
    description="Calculate FICO score with zk-proof option",
)
async def get_credit_score(
    address: str,
    include_proof: bool = Query(False, description="Include zk-proof of score"),
) -> CreditScoreResponse:
    """
    Calculate FICO score for user.
    
    Factors:
    - Payment history (35%)
    - Credit utilization (30%)
    - Credit history length (15%)
    - Credit mix (10%)
    - New credit (10%)
    
    Score range: 300-850
    """
    from app.services.ttl_cache import fico_cache

    credit_service = get_credit_line_service()
    proof_service = get_credit_eligibility_service()
    
    try:
        # Check cache first (FICO scores are expensive to compute)
        cache_key = f"fico:{address}"
        cached_score = await fico_cache.get(cache_key)
        if cached_score and not include_proof:
            return CreditScoreResponse(**cached_score)

        score_data = await credit_service.calculate_credit_score(address)
        
        fico_score = score_data.get("fico_score", 650)
        
        # Determine tier
        if fico_score >= 750:
            tier = "excellent"
        elif fico_score >= 670:
            tier = "good"
        elif fico_score >= 580:
            tier = "fair"
        else:
            tier = "poor"
        
        # Generate proof if requested
        proof = None
        if include_proof:
            proof_result = await proof_service.generate_eligibility_proof(
                user_address=address,
                score=fico_score,
            )
            proof = proof_result.get("proof")
        
        logger.info(f"Credit score calculated: user={address}, score={fico_score}")
        
        response = CreditScoreResponse(
            user_address=address,
            fico_score=fico_score,
            fico_tier=tier,
            components={
                "payment_history": 35,
                "utilization": 30,
                "history_length": 15,
                "credit_mix": 10,
                "new_credit": 10,
            },
            confidence=0.92,
            proof=proof,
        )

        if not include_proof:
            await fico_cache.set(cache_key, response.model_dump())

        return response
        
    except Exception as e:
        logger.error(f"Credit score calculation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/credit/lines/{line_id}/borrow",
    response_model=CreditTransactionResponse,
    summary="Borrow against credit line",
    description="Borrow USD against available credit",
)
async def borrow_against_line(
    line_id: str,
    request: CreditTransactionRequest,
    _caller: str = WalletOwner,
) -> CreditTransactionResponse:
    """Borrow against credit line."""
    service = get_credit_line_service()
    
    try:
        result = await service.borrow(
            user_address=request.user_address,
            amount_usd=request.amount_usd,
        )
        
        if not result:
            raise HTTPException(status_code=400, detail="Borrow failed")
        
        return CreditTransactionResponse(
            status="pending",
            tx_hash=result.get("tx_hash"),
            action="borrow",
            amount=request.amount_usd,
            new_balance=result.get("new_balance", 0),
        )
        
    except Exception as e:
        logger.error(f"Borrow failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/credit/lines/{line_id}/repay",
    response_model=CreditTransactionResponse,
    summary="Repay credit line",
    description="Repay borrowed amount",
)
async def repay_credit_line(
    line_id: str,
    request: CreditTransactionRequest,
    _caller: str = WalletOwner,
) -> CreditTransactionResponse:
    """Repay credit line balance."""
    service = get_credit_line_service()
    
    try:
        result = await service.repay(
            user_address=request.user_address,
            amount_usd=request.amount_usd,
        )
        
        if not result:
            raise HTTPException(status_code=400, detail="Repay failed")
        
        return CreditTransactionResponse(
            status="pending",
            tx_hash=result.get("tx_hash"),
            action="repay",
            amount=request.amount_usd,
            new_balance=result.get("new_balance", 0),
        )
        
    except Exception as e:
        logger.error(f"Repay failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/credit/lines/{address}",
    summary="Get credit line details",
    description="Get all credit lines for an address",
)
async def get_credit_lines(
    address: str,
    limit: int = Query(20, ge=1, le=100, description="Max results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> dict[str, Any]:
    """Get all credit lines for user with pagination."""
    service = get_credit_line_service()
    
    try:
        all_lines = await service.get_user_credit_lines(address)
        paginated = all_lines[offset : offset + limit]
        return {
            "user_address": address,
            "active_lines": len(all_lines),
            "total_limit_usd": sum(l.get("limit", 0) for l in all_lines),
            "total_available_usd": sum(l.get("available", 0) for l in all_lines),
            "total_used_usd": sum(l.get("used", 0) for l in all_lines),
            "lines": paginated,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": len(all_lines),
                "has_more": offset + limit < len(all_lines),
            },
        }
    except Exception as e:
        logger.error(f"Fetch credit lines failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
