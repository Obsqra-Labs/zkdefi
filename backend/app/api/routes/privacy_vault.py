"""
Privacy Vault API: Shielded deposits and withdrawals
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging

from app.services.privacy_vault_service import get_privacy_vault_service

router = APIRouter()
logger = logging.getLogger(__name__)


class ShieldedDepositRequest(BaseModel):
    user_address: str
    amount_wei: int
    nullifier: str  # 32-byte hex secret


class ShieldedDepositResponse(BaseModel):
    commitment: str
    tx_hash: str
    proof_hash: str
    receipt_id: str


class ShieldedWithdrawRequest(BaseModel):
    user_address: str
    nullifier: str
    amount_wei: int
    recipient: str


class ShieldedWithdrawResponse(BaseModel):
    tx_hash: str
    proof_hash: str
    receipt_id: str


@router.post("/shielded_deposit", response_model=ShieldedDepositResponse)
async def shielded_deposit(request: ShieldedDepositRequest):
    """
    Deposit funds through FullyShieldedPool with hidden amount.
    
    Privacy guarantee:
    - On-chain: Only Poseidon commitment is visible (no amount)
    - Off-chain: Nullifier stored encrypted with user's pubkey
    - Proof: Verifies commitment was computed correctly
    """
    try:
        privacy_svc = get_privacy_vault_service()
        
        result = await privacy_svc.shielded_deposit(
            user_address=request.user_address,
            amount_wei=request.amount_wei,
            nullifier=request.nullifier,
        )
        
        return ShieldedDepositResponse(**result)
        
    except Exception as e:
        logger.error(f"Shielded deposit failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shielded_withdraw", response_model=ShieldedWithdrawResponse)
async def shielded_withdraw(request: ShieldedWithdrawRequest):
    """
    Withdraw funds from FullyShieldedPool using zero-knowledge proof.
    
    Privacy guarantee:
    - Proof verifies ownership without revealing nullifier
    - No on-chain link between deposit and withdrawal addresses
    - Nullifier marked as spent to prevent double-spend
    """
    try:
        privacy_svc = get_privacy_vault_service()
        
        result = await privacy_svc.shielded_withdraw(
            user_address=request.user_address,
            nullifier=request.nullifier,
            amount_wei=request.amount_wei,
            recipient=request.recipient,
        )
        
        return ShieldedWithdrawResponse(**result)
        
    except Exception as e:
        logger.error(f"Shielded withdraw failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/commitments/{user_address}")
async def get_user_commitments(user_address: str):
    """
    Get user's unspent commitments (for withdrawal UI)
    """
    try:
        privacy_svc = get_privacy_vault_service()
        
        # Get all commitments for user
        user_store = privacy_svc.nullifier_store.get(user_address, {})
        
        commitments = []
        for commitment, data in user_store.items():
            if not data["spent"]:
                commitments.append({
                    "commitment": commitment,
                    "amount_wei": data["amount_wei"],
                    "can_withdraw": True,
                })
        
        return {
            "user_address": user_address,
            "commitments": commitments,
            "total_unspent": len(commitments),
        }
        
    except Exception as e:
        logger.error(f"Failed to get commitments for {user_address}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
