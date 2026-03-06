"""
Lending API Routes

Reputation-driven lending pool: supply, borrow, repay, withdraw, liquidate.
All actions build calldata for frontend wallet signing.
"""
from __future__ import annotations

from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.lending_service import (
    get_pool_stats,
    get_user_positions,
    build_supply_calldata,
    build_borrow_calldata,
    build_repay_calldata,
    build_withdraw_calldata,
    build_liquidate_calldata,
    compute_health_factor,
    check_all_loans_health,
    record_supply,
    record_borrow,
    record_repay,
    record_liquidation,
)

router = APIRouter(prefix="/lending", tags=["lending"])


def _resolve_base(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    if base.startswith("http"):
        return base
    host, port = request.scope.get("server", ("localhost", 8000))
    root_path = request.scope.get("root_path", "")
    return f"http://{host}:{port}{root_path}".rstrip("/")


async def _get_lending_gate(address: str, request: Request) -> dict[str, Any]:
    gate: dict[str, Any] = {
        "mode": "allow",
        "reason_codes": [],
        "reason_hints": [],
        "limits": {},
        "disclaimer": "Eligibility signal only; not legal, tax, or financial advice.",
    }
    if not address:
        return gate

    base = _resolve_base(request)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{base}/api/v1/zkdefi/risk_profile/v2/{address}")
        if r.status_code != 200:
            return gate
        payload = r.json()
        decisions = payload.get("decisions")
        disclosures = payload.get("disclosures")
        if isinstance(disclosures, dict):
            disclaimer = disclosures.get("disclaimer")
            if isinstance(disclaimer, str) and disclaimer.strip():
                gate["disclaimer"] = disclaimer.strip()
        if not isinstance(decisions, dict):
            return gate
        lending = decisions.get("lending")
        if not isinstance(lending, dict):
            return gate
        mode = lending.get("mode")
        if isinstance(mode, str) and mode in {"allow", "advisory", "block"}:
            gate["mode"] = mode
        reason_codes = lending.get("reason_codes")
        if isinstance(reason_codes, list):
            gate["reason_codes"] = [str(x) for x in reason_codes]
        reason_hints = lending.get("reason_hints")
        if isinstance(reason_hints, list):
            gate["reason_hints"] = [str(x) for x in reason_hints]
        limits = lending.get("limits")
        if isinstance(limits, dict):
            gate["limits"] = limits
    except Exception:
        # Borrow path should still work if decision context is unavailable.
        return gate
    return gate


class SupplyRequest(BaseModel):
    amount_wei: int


class SupplyConfirmRequest(BaseModel):
    address: str
    supply_id: int
    amount_wei: int
    tx_hash: Optional[str] = None


class BorrowRequest(BaseModel):
    address: Optional[str] = None
    amount_wei: int
    attestation_hash: str


class BorrowConfirmRequest(BaseModel):
    address: str
    loan_id: int
    principal_wei: int
    interest_rate_bps: int = 500
    attestation_hash: Optional[str] = None
    tx_hash: Optional[str] = None


class RepayRequest(BaseModel):
    loan_id: int
    amount_wei: int


class RepayConfirmRequest(BaseModel):
    address: str
    loan_id: int
    amount_wei: int
    tx_hash: Optional[str] = None


class WithdrawRequest(BaseModel):
    supply_id: int


class LiquidateRequest(BaseModel):
    loan_id: int


class LiquidationConfirmRequest(BaseModel):
    borrower_address: str
    loan_id: int
    debt_repaid_wei: int
    collateral_seized_wei: int
    liquidator_address: str
    tx_hash: Optional[str] = None


@router.get("/pool")
async def pool_stats():
    """Get pool-level statistics: TVL, utilization, APY.

    Includes private vault TVL when available so the Lend tab
    reflects real capital backing the lending pool.
    """
    stats = get_pool_stats()
    try:
        from app.services.private_yield_service import get_vault_stats
        vault = get_vault_stats()
        stats["private_vault_tvl_wei"] = vault.get("tvl_wei", 0)
        stats["private_vault_tvl_eth"] = vault.get("tvl_eth", 0)
        stats["private_vault_lending_wei"] = vault.get("lending_deployed_wei", 0)
        stats["private_vault_lending_eth"] = vault.get("lending_deployed_eth", 0)
        stats["private_vault_blended_apy_bps"] = vault.get("blended_apy_bps", 0)
        effective_supply = int(stats.get("total_supplied_wei", 0)) + int(vault.get("lending_deployed_wei", 0))
        stats["effective_tvl_wei"] = effective_supply
        stats["effective_tvl_eth"] = round(effective_supply / 1e18, 6)
    except Exception:
        pass
    return stats


@router.get("/positions/{address}")
async def user_positions(address: str):
    """Get all lending positions (loans + supplies) for a user."""
    return get_user_positions(address)


@router.post("/supply")
async def supply(req: SupplyRequest):
    """Build multicall (approve + supply) for wallet signing."""
    return build_supply_calldata(req.amount_wei)


@router.post("/supply/confirm")
async def confirm_supply(req: SupplyConfirmRequest):
    """Record a confirmed supply in local cache."""
    pos = record_supply(req.address, req.supply_id, req.amount_wei, req.tx_hash)
    return {"status": "recorded", "supply": pos}


@router.post("/borrow")
async def borrow(req: BorrowRequest, request: Request):
    """Build calldata for borrow (requires valid attestation and gate check)."""
    address = (req.address or "").strip().lower()
    if not address:
        raise HTTPException(status_code=400, detail="address is required for borrow")

    gate = await _get_lending_gate(address, request)
    if gate.get("mode") == "block":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "borrow_blocked_by_risk_gate",
                "message": "Borrow blocked by trust controls. Resolve profile warnings first.",
                "reason_codes": gate.get("reason_codes", []),
                "reason_hints": gate.get("reason_hints", []),
                "limits": gate.get("limits", {}),
                "disclaimer": gate.get("disclaimer"),
            },
        )

    payload = build_borrow_calldata(req.amount_wei, req.attestation_hash)
    payload["decision_context"] = {
        "mode": gate.get("mode", "allow"),
        "reason_codes": gate.get("reason_codes", []),
        "reason_hints": gate.get("reason_hints", []),
        "limits": gate.get("limits", {}),
        "disclaimer": gate.get("disclaimer"),
    }
    return payload


@router.post("/borrow/confirm")
async def confirm_borrow(req: BorrowConfirmRequest):
    """Record a confirmed borrow in local cache."""
    loan = record_borrow(
        req.address, req.loan_id, req.principal_wei,
        req.interest_rate_bps, req.attestation_hash, req.tx_hash,
    )
    return {"status": "recorded", "loan": loan}


@router.post("/repay")
async def repay(req: RepayRequest):
    """Build multicall (approve + repay) for wallet signing."""
    return build_repay_calldata(req.loan_id, req.amount_wei)


@router.post("/repay/confirm")
async def confirm_repay(req: RepayConfirmRequest):
    """Record a confirmed repayment in local cache."""
    ok = record_repay(req.address, req.loan_id, req.amount_wei, req.tx_hash)
    return {"status": "recorded" if ok else "not_found"}


@router.post("/withdraw")
async def withdraw(req: WithdrawRequest):
    """Build calldata for withdraw."""
    return build_withdraw_calldata(req.supply_id)


@router.post("/liquidate")
async def liquidate(req: LiquidateRequest):
    """Build calldata for liquidate."""
    return build_liquidate_calldata(req.loan_id)


@router.post("/liquidate/confirm")
async def confirm_liquidation(req: LiquidationConfirmRequest):
    """Record a confirmed liquidation in local cache."""
    ok = record_liquidation(
        req.borrower_address, req.loan_id, req.debt_repaid_wei,
        req.collateral_seized_wei, req.liquidator_address, req.tx_hash,
    )
    return {"status": "recorded" if ok else "not_found"}


@router.get("/health/{address}")
async def health_factor(address: str, loan_id: Optional[int] = None):
    """Get health factor for user loans."""
    return compute_health_factor(address, loan_id)


@router.get("/health/all/at-risk")
async def at_risk_loans():
    """Check all loans and return those at risk or liquidatable."""
    return {"at_risk": check_all_loans_health()}


class CreditProofRequest(BaseModel):
    credit_score: int
    collateral_wei: int
    min_credit_score: int = 500
    min_collateral: int = 100000000000000000  # 0.1 ETH default


@router.post("/proof/credit-eligibility")
async def generate_credit_proof(req: CreditProofRequest):
    """
    Generate a Groth16 ZK proof that credit_score >= min AND collateral >= min.
    The proof can be submitted on-chain via borrow_with_proof.
    """
    try:
        from app.services.credit_eligibility_proof_service import (
            generate_credit_eligibility_proof,
        )
        result = generate_credit_eligibility_proof(
            credit_score=req.credit_score,
            collateral_wei=req.collateral_wei,
            min_credit_score=req.min_credit_score,
            min_collateral=req.min_collateral,
        )
        return result
    except FileNotFoundError as e:
        return {"error": "circuit_not_built", "message": str(e)}
    except RuntimeError as e:
        return {"error": "proof_generation_failed", "message": str(e)}
