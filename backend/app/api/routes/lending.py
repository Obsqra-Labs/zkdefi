"""
Lending API Routes

Native lending pool endpoints: supply, borrow, repay, health factor.
All calldata endpoints build multicall payloads for frontend wallet signing.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from app.services.lending_service import (
        get_pool_stats,
        get_user_positions,
        build_supply_calldata,
        build_borrow_calldata,
        build_repay_calldata,
        compute_health_factor,
    )

    _SERVICE_AVAILABLE = True
except Exception:
    _SERVICE_AVAILABLE = False

router = APIRouter(tags=["lending"])


def _check_service() -> None:
    if not _SERVICE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Lending service unavailable")


# ── Request models ────────────────────────────────────────────────────────


class SupplyCalldataRequest(BaseModel):
    amount_wei: int


class BorrowCalldataRequest(BaseModel):
    amount_wei: int
    attestation_hash: str


class BorrowGatedRequest(BaseModel):
    address: Optional[str] = None
    amount_wei: int
    attestation_hash: str


class RepayCalldataRequest(BaseModel):
    loan_id: int
    amount_wei: int


# ── Lending gate  ─────────────────────────────────────────────────────────


async def _get_lending_gate(address: str, request: BorrowGatedRequest) -> dict[str, Any]:
    """Default no-op gate — always allows.
    Override via monkeypatch or dependency injection in tests.
    """
    return {
        "mode": "allow",
        "reason_codes": [],
        "reason_hints": [],
        "limits": {"total_line_eth": 10.0},
        "disclaimer": "Eligibility signal only; not legal, tax, or financial advice.",
    }


# ── Endpoints ─────────────────────────────────────────────────────────────


@router.get("/pool")
async def pool_stats() -> dict[str, Any]:
    """Pool-level statistics: TVL, utilization, APY."""
    _check_service()
    return get_pool_stats()


@router.get("/positions/{address}")
async def user_positions(address: str) -> dict[str, Any]:
    """All lending positions (loans + supplies) for a user."""
    _check_service()
    return get_user_positions(address)


@router.post("/supply/calldata")
async def supply_calldata(req: SupplyCalldataRequest) -> dict[str, Any]:
    """Build multicall (approve + supply) for wallet signing."""
    _check_service()
    if req.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    return build_supply_calldata(req.amount_wei)


@router.post("/borrow")
async def borrow_gated(req: BorrowGatedRequest) -> dict[str, Any]:
    """Risk-gated borrow: runs lending gate then builds calldata."""
    _check_service()
    if not req.address:
        raise HTTPException(status_code=400, detail="address is required for borrow")

    gate_result = await _get_lending_gate(req.address, req)
    mode = gate_result.get("mode", "block")

    if mode == "block":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "borrow_blocked_by_risk_gate",
                "reason_codes": gate_result.get("reason_codes", []),
                "reason_hints": gate_result.get("reason_hints", []),
                "limits": gate_result.get("limits", {}),
                "disclaimer": gate_result.get("disclaimer", ""),
            },
        )

    calldata = build_borrow_calldata(req.amount_wei, req.attestation_hash)
    return {
        **calldata,
        "decision_context": gate_result,
    }


@router.post("/borrow/calldata")
async def borrow_calldata(req: BorrowCalldataRequest) -> dict[str, Any]:
    """Build calldata for borrow (requires valid attestation hash)."""
    _check_service()
    if req.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    if not req.attestation_hash:
        raise HTTPException(status_code=400, detail="attestation_hash is required")
    return build_borrow_calldata(req.amount_wei, req.attestation_hash)


@router.post("/repay/calldata")
async def repay_calldata(req: RepayCalldataRequest) -> dict[str, Any]:
    """Build multicall (approve + repay) for wallet signing."""
    _check_service()
    if req.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    return build_repay_calldata(req.loan_id, req.amount_wei)


@router.get("/health-factor/{address}")
async def health_factor(address: str, loan_id: Optional[int] = None) -> dict[str, Any]:
    """Health factor for a user's loans (> 1.0 = healthy, < 1.0 = liquidatable)."""
    _check_service()
    return compute_health_factor(address, loan_id)
