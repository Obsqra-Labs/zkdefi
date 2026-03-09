"""P2P Lending API Routes — Request book + first-come fund model."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner, AdminOnly
from app.services import p2p_lending_service as p2p

router = APIRouter(prefix="/p2p-lending", tags=["p2p-lending"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class CreateLoanRequestBody(BaseModel):
    borrower_address: str = Field(..., alias="user_address")
    amount_wei: int = Field(..., gt=0)
    collateral_wei: int = Field(..., gt=0)
    duration_secs: int = Field(default=30 * 86400, ge=3600, description="Loan duration (default 30 days)")
    interest_rate_bps: int = Field(default=500, ge=0, le=3000, description="Annual rate in bps")

    class Config:
        populate_by_name = True


class FundRequestBody(BaseModel):
    lender_address: str = Field(..., alias="user_address")
    amount_wei: int = Field(..., gt=0)

    class Config:
        populate_by_name = True


class RepaymentBody(BaseModel):
    borrower_address: str = Field(..., alias="user_address")
    amount_wei: int = Field(..., gt=0)

    class Config:
        populate_by_name = True


# ---------------------------------------------------------------------------
# Loan Request endpoints
# ---------------------------------------------------------------------------


@router.get("/requests")
async def list_open_requests() -> dict[str, Any]:
    """List all open loan requests available for funding."""
    requests = p2p.list_open_requests()
    return {"requests": requests, "count": len(requests)}


@router.get("/requests/{request_id}")
async def get_request(request_id: str) -> dict[str, Any]:
    """Get details of a specific loan request."""
    req = p2p.get_request(request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


@router.post("/requests")
async def create_loan_request(body: CreateLoanRequestBody, _caller: str = WalletOwner) -> dict[str, Any]:
    """Create a new loan request on the P2P book."""
    try:
        record = p2p.create_loan_request(
            borrower_address=body.borrower_address,
            amount_wei=body.amount_wei,
            collateral_wei=body.collateral_wei,
            duration_secs=body.duration_secs,
            interest_rate_bps=body.interest_rate_bps,
        )
        return {"status": "created", **record}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/requests/{request_id}/fund")
async def fund_request(request_id: str, body: FundRequestBody, _caller: str = WalletOwner) -> dict[str, Any]:
    """Fund a loan request (partial or full)."""
    try:
        result = p2p.fund_request(request_id, body.lender_address, body.amount_wei)
        return {"status": "funded", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/requests/{request_id}/cancel")
async def cancel_request(request_id: str, borrower_address: str, _caller: str = WalletOwner) -> dict[str, Any]:
    """Cancel an unfunded loan request."""
    try:
        result = p2p.cancel_request(request_id, borrower_address)
        return {"status": "cancelled", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Loan endpoints
# ---------------------------------------------------------------------------


@router.get("/loans")
async def list_loans(user_address: str | None = None) -> dict[str, Any]:
    """List loans, optionally filtered by user address."""
    loans = p2p.list_loans(user_address)
    return {"loans": loans, "count": len(loans)}


@router.get("/loans/{loan_id}")
async def get_loan(loan_id: str) -> dict[str, Any]:
    """Get details of a specific loan."""
    loan = p2p.get_loan(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.get("/loans/{loan_id}/health")
async def get_loan_health(loan_id: str) -> dict[str, Any]:
    """Get current health factor for a loan."""
    try:
        return p2p.get_loan_health(loan_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/loans/{loan_id}/repay")
async def repay_loan(loan_id: str, body: RepaymentBody, _caller: str = WalletOwner) -> dict[str, Any]:
    """Repay a loan (partial or full)."""
    try:
        result = p2p.repay_loan(loan_id, body.borrower_address, body.amount_wei)
        return {"status": "repaid" if result.get("status") == "repaid" else "partial_repayment", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/loans/{loan_id}/liquidate")
async def liquidate_loan(loan_id: str, _admin: str = AdminOnly) -> dict[str, Any]:
    """Liquidate an unhealthy loan (admin only)."""
    try:
        result = p2p.liquidate_loan(loan_id)
        return {"status": "liquidated", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
