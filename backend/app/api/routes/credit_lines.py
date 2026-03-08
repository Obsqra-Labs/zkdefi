"""Credit Lines & FICO Scoring API routes."""

import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

try:
    from app.services.credit_line_service import get_credit_line_service
    from app.services.credit_eligibility_proof_service import get_credit_eligibility_service
except ImportError:
    from backend.app.services.credit_line_service import get_credit_line_service
    from backend.app.services.credit_eligibility_proof_service import get_credit_eligibility_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["credit-lines"])


class CreditLineRequest(BaseModel):
    """Request to open/update credit line."""
    user_address: str = Field(..., description="User's Starknet address")
    collateral_token: str = Field(..., description="Collateral token address")
    collateral_amount: int = Field(..., ge=1, description="Collateral amount in wei")
    desired_credit_usd: int = Field(..., ge=100, description="Desired credit line in USD")


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


class CreditTransactionResponse(BaseModel):
    """Response from borrow/repay."""
    status: str  # "pending" | "confirmed" | "failed"
    tx_hash: str | None
    action: str
    amount: int
    new_balance: int


@router.post(
    "/credit/lines/open",
    response_model=CreditLineResponse,
    summary="Open credit line",
    description="Open a new credit line against collateral",
)
async def open_credit_line(request: CreditLineRequest) -> CreditLineResponse:
    """
    Open a credit line with collateral.
    
    Process:
    1. Verify collateral quality
    2. Calculate LTV ratio
    3. Determine credit limit based on FICO + collateral
    4. Create credit account
    5. Return credit line details
    """
    service = get_credit_line_service()
    
    try:
        # Open credit line
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
            f"limit=${request.desired_credit_usd}"
        )
        
        return CreditLineResponse(
            user_address=request.user_address,
            status="pending",
            credit_limit_usd=request.desired_credit_usd,
            credit_available_usd=request.desired_credit_usd,
            credit_used_usd=0,
            collateral_token=request.collateral_token,
            collateral_amount=request.collateral_amount,
            ltv_ratio=0.5,  # Placeholder
            interest_rate=0.08,  # Placeholder
            created_at="",
        )
        
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
    credit_service = get_credit_line_service()
    proof_service = get_credit_eligibility_service()
    
    try:
        # Calculate credit score
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
        
        return CreditScoreResponse(
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
async def get_credit_lines(address: str) -> dict[str, Any]:
    """Get all credit lines for user."""
    service = get_credit_line_service()
    
    try:
        lines = await service.get_user_credit_lines(address)
        return {
            "user_address": address,
            "active_lines": len(lines),
            "total_limit_usd": sum(l.get("limit", 0) for l in lines),
            "total_available_usd": sum(l.get("available", 0) for l in lines),
            "total_used_usd": sum(l.get("used", 0) for l in lines),
            "lines": lines,
        }
    except Exception as e:
        logger.error(f"Fetch credit lines failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
