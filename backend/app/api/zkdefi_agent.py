"""
zkdefi agent API: proof-gated deposit/withdraw, disclosure, positions.
"""
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.zkdefi_agent_service import ZkdefiAgentService
from app.services.receipt_service import get_receipt_service

router = APIRouter()
_service: ZkdefiAgentService | None = None


def get_service() -> ZkdefiAgentService:
    global _service
    if _service is None:
        _service = ZkdefiAgentService()
    return _service


_COMPLIANCE_PROOF_TYPES = {
    "disclosure",
    "disclosure_yield_above",
    "disclosure_balance_above",
    "disclosure_risk_compliance",
    "disclosure_performance",
    "disclosure_kyc_eligibility",
    "disclosure_portfolio_aggregation",
}


def _normalize_profile_type(proof_type: str) -> str:
    mapping = {
        "disclosure_yield_above": "yield_above",
        "disclosure_balance_above": "balance_above",
        "disclosure_risk_compliance": "risk_compliance",
        "disclosure_performance": "performance",
        "disclosure_kyc_eligibility": "kyc_eligibility",
        "disclosure_portfolio_aggregation": "portfolio_aggregation",
        "disclosure": "generic_disclosure",
    }
    return mapping.get(proof_type, proof_type)


def _is_verified_result(result: str) -> bool:
    value = (result or "").strip().lower()
    return value not in {"failed", "error", "unsafe", "non_compliant", "false", "rejected"}


class DepositRequest(BaseModel):
    user_address: str
    protocol_id: int = 0
    amount: int
    max_position: int = 0
    max_daily_yield_bps: int = 0
    min_withdraw_delay_seconds: int = 0


class WithdrawRequest(BaseModel):
    user_address: str
    protocol_id: int = 0
    amount: int
    max_position: int = 0
    max_daily_yield_bps: int = 0
    min_withdraw_delay_seconds: int = 0


class DisclosureRequest(BaseModel):
    user_address: str
    statement_type: str
    threshold: int
    result: str


class PrivateDepositRequest(BaseModel):
    user_address: str
    amount: int
    nonce: int | None = None


class PrivateWithdrawRequest(BaseModel):
    user_address: str
    commitment: str
    amount: int
    nonce: int | None = None


class RiskComplianceRequest(BaseModel):
    user_address: str
    max_risk_threshold: int
    risk_metric: str = "var"  # var, sharpe, max_drawdown


class PerformanceRequest(BaseModel):
    user_address: str
    min_apy: int  # basis points (1000 = 10%)
    period_days: int = 30


class KYCRequest(BaseModel):
    user_address: str
    min_balance: int


class AggregationRequest(BaseModel):
    user_address: str
    min_total_value: int
    protocol_ids: list[int] | None = None


class ShieldedDepositRequest(BaseModel):
    user_address: str
    pool_type: str  # "conservative", "neutral", "aggressive"
    amount: int
    nonce: int | None = None


class ShieldedWithdrawRequest(BaseModel):
    user_address: str
    commitment: str
    amount: int
    use_relayer: bool = False
    recipient: str | None = None
    nonce: int | None = None
    balance: int | None = None


@router.post("/deposit")
async def deposit(data: DepositRequest):
    """Proof-gated deposit: get proof from obsqra.fi and return calldata for deposit_with_proof."""
    try:
        svc = get_service()
        result = await svc.deposit_with_constraints(
            user_address=data.user_address,
            protocol_id=data.protocol_id,
            amount=data.amount,
            constraints={
                "max_position": data.max_position,
                "max_daily_yield_bps": data.max_daily_yield_bps,
                "min_withdraw_delay_seconds": data.min_withdraw_delay_seconds,
            },
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/withdraw")
async def withdraw(data: WithdrawRequest):
    """Proof-gated withdrawal: get proof from obsqra.fi and return calldata for withdraw_with_proof."""
    try:
        svc = get_service()
        result = await svc.withdraw_with_constraints(
            user_address=data.user_address,
            protocol_id=data.protocol_id,
            amount=data.amount,
            constraints={
                "max_position": data.max_position,
                "max_daily_yield_bps": data.max_daily_yield_bps,
                "min_withdraw_delay_seconds": data.min_withdraw_delay_seconds,
            },
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disclosure/generate")
async def generate_disclosure(data: DisclosureRequest):
    """Generate disclosure proof via obsqra.fi."""
    try:
        svc = get_service()
        result = await svc.generate_disclosure_proof(
            user_address=data.user_address,
            statement_type=data.statement_type,
            threshold=data.threshold,
            result=data.result,
        )
        get_receipt_service().append_proof_receipt(
            user_address=data.user_address,
            proof_type=f"disclosure_{data.statement_type}",
            threshold_or_model=str(data.threshold),
            result=data.result,
            fact_hash=result.get("proof_hash") or result.get("fact_hash"),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/position/{user_address}")
async def get_position(user_address: str, protocol_id: int = 0):
    """Get on-chain position for user and protocol."""
    try:
        svc = get_service()
        result = await svc.get_user_position(user_address=user_address, protocol_id=protocol_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/constraints/{user_address}")
async def get_constraints(user_address: str):
    """Get on-chain constraints for user."""
    try:
        svc = get_service()
        result = await svc.get_constraints(user_address=user_address)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/private_deposit")
async def private_deposit(data: PrivateDepositRequest):
    """Generate private deposit proof: commitment + proof_calldata for ConfidentialTransfer.private_deposit."""
    try:
        svc = get_service()
        result = svc.generate_private_deposit_proof(amount=data.amount, nonce=data.nonce)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== PRIVATE WITHDRAWALS ====================


@router.get("/private_commitments/{user_address}")
async def get_private_commitments(user_address: str):
    """Get all commitments with balances for a user."""
    try:
        svc = get_service()
        result = await svc.get_user_commitments(user_address=user_address)
        return {"user_address": user_address, "commitments": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/private_withdraw")
async def private_withdraw(data: PrivateWithdrawRequest):
    """Generate private withdrawal proof: nullifier + proof_calldata for ConfidentialTransfer.private_withdraw."""
    try:
        svc = get_service()
        result = svc.generate_private_withdraw_proof(
            commitment=data.commitment,
            amount=data.amount,
            nonce=data.nonce,
            user_address=data.user_address,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== ENHANCED SELECTIVE DISCLOSURE ====================


@router.post("/disclosure/risk_compliance")
async def generate_risk_compliance(data: RiskComplianceRequest):
    """Generate proof that portfolio risk is below threshold."""
    try:
        svc = get_service()
        result = await svc.generate_risk_compliance_proof(
            user_address=data.user_address,
            max_risk_threshold=data.max_risk_threshold,
            risk_metric=data.risk_metric,
        )
        get_receipt_service().append_proof_receipt(
            user_address=data.user_address,
            proof_type="disclosure_risk_compliance",
            threshold_or_model=str(data.max_risk_threshold),
            result=result.get("result", "unknown"),
            fact_hash=result.get("proof_hash") or result.get("fact_hash"),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disclosure/performance")
async def generate_performance(data: PerformanceRequest):
    """Generate proof that APY was above threshold for period."""
    try:
        svc = get_service()
        result = await svc.generate_performance_proof(
            user_address=data.user_address,
            min_apy=data.min_apy,
            period_days=data.period_days,
        )
        get_receipt_service().append_proof_receipt(
            user_address=data.user_address,
            proof_type="disclosure_performance",
            threshold_or_model=str(data.min_apy),
            result=result.get("result", "unknown"),
            fact_hash=result.get("proof_hash") or result.get("fact_hash"),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disclosure/kyc_eligibility")
async def generate_kyc_eligibility(data: KYCRequest):
    """Generate proof that balance is above threshold for KYC eligibility."""
    try:
        svc = get_service()
        result = await svc.generate_kyc_eligibility_proof(
            user_address=data.user_address,
            min_balance=data.min_balance,
        )
        get_receipt_service().append_proof_receipt(
            user_address=data.user_address,
            proof_type="disclosure_kyc_eligibility",
            threshold_or_model=str(data.min_balance),
            result=result.get("result", "unknown"),
            fact_hash=result.get("proof_hash") or result.get("fact_hash"),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== PRIVATE POSITION AGGREGATION ====================


@router.get("/position/aggregate/{user_address}")
async def get_aggregated_position(user_address: str):
    """Get aggregated position across all protocols without revealing breakdown."""
    try:
        svc = get_service()
        result = await svc.get_aggregated_position(user_address=user_address)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disclosure/aggregation")
async def generate_aggregation_proof(data: AggregationRequest):
    """Generate proof that total portfolio value >= threshold across protocols."""
    try:
        svc = get_service()
        result = await svc.generate_portfolio_aggregation_proof(
            user_address=data.user_address,
            min_total_value=data.min_total_value,
            protocol_ids=data.protocol_ids,
        )
        get_receipt_service().append_proof_receipt(
            user_address=data.user_address,
            proof_type="disclosure_portfolio_aggregation",
            threshold_or_model=str(data.min_total_value),
            result=result.get("result", "unknown"),
            fact_hash=result.get("proof_hash") or result.get("fact_hash"),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== SHIELDED POOLS (PRIVATE + OPTIONAL PROOF-GATING) ====================


@router.post("/shielded_deposit")
async def shielded_deposit(data: ShieldedDepositRequest):
    """
    Generate privacy proof for shielded pool deposit.
    Human-signed tx: Only privacy proof needed (signature = authorization).
    Returns commitment + proof_calldata for private_deposit.
    """
    try:
        svc = get_service()
        result = svc.generate_shielded_deposit_proof(
            user_address=data.user_address,
            pool_type=data.pool_type,
            amount=data.amount,
            nonce=data.nonce,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shielded_withdraw")
async def shielded_withdraw(data: ShieldedWithdrawRequest):
    """
    Generate privacy proof for shielded pool withdrawal.
    Human-signed tx: Only privacy proof needed (signature = authorization).
    Returns nullifier + commitment + proof_calldata for private_withdraw.
    """
    try:
        svc = get_service()
        result = svc.generate_shielded_withdraw_proof(
            user_address=data.user_address,
            commitment=data.commitment,
            amount=data.amount,
            nonce=data.nonce,
            use_relayer=data.use_relayer,
            recipient=data.recipient,
            balance=data.balance,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== COMPLIANCE PROFILES ====================


@router.get("/compliance/profiles/{user_address}")
async def get_compliance_profiles(user_address: str):
    """
    Get compliance profiles generated by a user.
    
    Returns a list of selective disclosure proofs the user has generated:
    - KYC Eligibility
    - Risk Compliance
    - Performance Proof
    - Portfolio Aggregation
    """
    enabled = os.getenv("COMPLIANCE_PROFILES_FROM_RECEIPTS", "true").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enabled:
        return []

    receipts = await get_receipt_service().get_user_receipts(user_address)
    profiles = []
    for receipt in receipts:
        proof_type = str(receipt.get("proof_type") or "").strip()
        if proof_type not in _COMPLIANCE_PROOF_TYPES:
            continue
        result = str(receipt.get("result") or "")
        profiles.append(
            {
                "receipt_id": receipt.get("receipt_id"),
                "profile_type": _normalize_profile_type(proof_type),
                "verified": _is_verified_result(result),
                "result": result,
                "tx_hash": receipt.get("tx_hash"),
                "proof_hash": receipt.get("fact_hash"),
                "snapshot_hash": receipt.get("snapshot_hash"),
                "created_at": receipt.get("timestamp"),
                "proof_type": proof_type,
            }
        )
    profiles.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return profiles


@router.get("/compliance/profile-types")
async def get_compliance_profile_types():
    """
    Get available compliance profile types.
    """
    return [
        {
            "type": "kyc",
            "name": "KYC Eligibility",
            "description": "Prove identity eligibility without revealing personal data."
        },
        {
            "type": "risk",
            "name": "Risk Compliance",
            "description": "Attest portfolio risk score is below threshold."
        },
        {
            "type": "performance",
            "name": "Performance Proof",
            "description": "Prove historical returns without revealing positions."
        },
        {
            "type": "aggregation",
            "name": "Portfolio Aggregation",
            "description": "Aggregate cross-chain positions with privacy."
        }
    ]
