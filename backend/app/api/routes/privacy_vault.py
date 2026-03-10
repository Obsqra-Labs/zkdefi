"""Privacy Vault API routes - Deposit/Withdraw shielded pools on Starknet."""

import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field, field_validator

from app.middleware.auth import WalletOwner

try:
    from app.services.privacy_vault_service import get_privacy_vault_service
    from app.api.validators import (
        validate_starknet_address, validate_hex_string,
        validate_token_symbol, validate_wei_amount,
    )
except ImportError:
    from backend.app.services.privacy_vault_service import get_privacy_vault_service
    from backend.app.api.validators import (
        validate_starknet_address, validate_hex_string,
        validate_token_symbol, validate_wei_amount,
    )

logger = logging.getLogger(__name__)
router = APIRouter(tags=["privacy-vault"])


class ShieldedDepositRequest(BaseModel):
    """Request to deposit into shielded pool."""
    user_address: str = Field(..., description="User's Starknet address")
    token: str = Field(..., description="Token symbol (ETH, USDC, STRK)")
    amount_wei: int = Field(..., ge=1, description="Amount in wei")
    commitment: str = Field(..., description="Merkle tree commitment for privacy")
    metadata: dict[str, Any] | None = None

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("token")
    @classmethod
    def check_token(cls, v: str) -> str:
        return validate_token_symbol(v)

    @field_validator("amount_wei")
    @classmethod
    def check_amount(cls, v: int) -> int:
        return validate_wei_amount(v)

    @field_validator("commitment")
    @classmethod
    def check_commitment(cls, v: str) -> str:
        return validate_hex_string(v)


class ShieldedWithdrawRequest(BaseModel):
    """Request to withdraw from shielded pool."""
    user_address: str = Field(..., description="User's Starknet address")
    commitment: str = Field(..., description="Original deposit commitment")
    nullifier: str = Field(..., description="Nullifier for the note")
    proof: str = Field(..., description="Zero-knowledge proof of ownership")
    recipient: str | None = None

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("commitment", "nullifier", "proof")
    @classmethod
    def check_hex(cls, v: str) -> str:
        return validate_hex_string(v)

    @field_validator("recipient")
    @classmethod
    def check_recipient(cls, v: str | None) -> str | None:
        if v is not None:
            return validate_starknet_address(v)
        return v


class DepositResponse(BaseModel):
    """Response from deposit operation."""
    status: str  # "pending" | "confirmed" | "failed"
    tx_hash: str | None
    commitment: str
    amount: int
    token: str


class WithdrawResponse(BaseModel):
    """Response from withdrawal operation."""
    status: str  # "pending" | "confirmed" | "failed"
    tx_hash: str | None
    recipient: str
    amount: int
    token: str


@router.post(
    "/privacy/vault/deposit",
    response_model=DepositResponse,
    summary="Deposit into shielded pool",
    description="Deposit tokens into a privacy pool with commitment-based shielding",
)
async def deposit_to_shielded_pool(request: ShieldedDepositRequest, _caller: str = WalletOwner) -> DepositResponse:
    """
    Deposit tokens into shielded pool.
    
    Flow:
    1. Create Merkle tree commitment for privacy
    2. Approve tokens via ERC20
    3. Call FullyShieldedPool.deposit with commitment
    4. Return tx_hash
    
    The commitment allows later withdrawal without revealing amount/token.
    """
    service = get_privacy_vault_service()
    
    try:
        tx_hash = await service.shielded_deposit(
            user_address=request.user_address,
            token=request.token,
            amount_wei=request.amount_wei,
            commitment=request.commitment,
        )
        
        if not tx_hash:
            return DepositResponse(
                status="failed",
                tx_hash=None,
                commitment=request.commitment,
                amount=request.amount_wei,
                token=request.token,
            )
        
        logger.info(
            f"Deposit initiated: user={request.user_address}, "
            f"token={request.token}, amount={request.amount_wei}, tx_hash={tx_hash}"
        )
        
        return DepositResponse(
            status="pending",
            tx_hash=tx_hash,
            commitment=request.commitment,
            amount=request.amount_wei,
            token=request.token,
        )
        
    except RuntimeError as e:
        logger.error(f"Deposit unavailable: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Deposit failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/privacy/vault/withdraw",
    response_model=WithdrawResponse,
    summary="Withdraw from shielded pool",
    description="Withdraw tokens from privacy pool using nullifier proof",
)
async def withdraw_from_shielded_pool(
    request: ShieldedWithdrawRequest,
    _caller: str = WalletOwner,
) -> WithdrawResponse:
    """
    Withdraw tokens from shielded pool.
    
    Flow:
    1. Verify nullifier proof (zk-SNARK)
    2. Check commitment exists in Merkle tree
    3. Mark commitment as spent
    4. Transfer tokens to recipient
    5. Return tx_hash
    
    The proof proves knowledge of the note without revealing it.
    """
    service = get_privacy_vault_service()
    recipient = request.recipient or request.user_address
    
    try:
        result = await service.shielded_withdraw(
            user_address=request.user_address,
            commitment=request.commitment,
            nullifier=request.nullifier,
            proof=request.proof,
            recipient=recipient,
        )
        
        if not result or not result.get("tx_hash"):
            raise HTTPException(status_code=400, detail="Withdrawal failed")
        
        logger.info(
            f"Withdrawal initiated: user={request.user_address}, "
            f"recipient={recipient}, tx_hash={result['tx_hash']}"
        )
        
        return WithdrawResponse(
            status="pending",
            tx_hash=result.get("tx_hash"),
            recipient=recipient,
            amount=result.get("amount", 0),
            token=result.get("token", "unknown"),
        )
        
    except HTTPException:
        raise
    except RuntimeError as e:
        logger.error(f"Withdrawal unavailable: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Withdrawal failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/privacy/vault/status/{commitment}",
    summary="Check deposit status",
    description="Check if a commitment has been spent or is available for withdrawal",
)
async def check_commitment_status(commitment: str) -> dict[str, Any]:
    """Check if commitment is spent or available."""
    service = get_privacy_vault_service()
    
    try:
        # This would check merkle tree inclusion and nullifier status
        # For now, return basic status
        return {
            "commitment": commitment,
            "status": "active",  # "active" | "spent" | "unknown"
            "available_for_withdrawal": True,
        }
    except Exception as e:
        logger.error(f"Status check failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/privacy/vault/balance/{address}",
    summary="Get shielded balance",
    description="Get total value locked in privacy pools for an address",
)
async def get_shielded_balance(address: str) -> dict[str, Any]:
    """Get user's total shielded balance across all pools."""
    service = get_privacy_vault_service()
    
    try:
        # Would aggregate across all commitments
        return {
            "address": address,
            "total_shielded_usd": 0,  # Placeholder
            "pools": [
                {
                    "token": "ETH",
                    "amount": 0,
                    "commitment_count": 0,
                }
            ],
        }
    except Exception as e:
        logger.error(f"Balance fetch failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
