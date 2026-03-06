"""
Confidential Amount Model

Represents amounts hidden via Groth16 commitment proofs (Garaga).
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ConfidentialAmount(BaseModel):
    """
    Represents a hidden amount via commitment + Groth16 proof.
    
    Pattern: 
    - amount = A (held off-chain, secret)
    - commitment = H(A) (on-chain, public)
    - proof = Groth16 proof that proves commitment valid without revealing A
    """
    
    # Commitment (public)
    commitment_hash: str = Field(..., description="Pedersen/Poseidon hash of the amount")
    
    # Proof (public, verifiable)
    groth16_proof: str = Field(..., description="Groth16 proof proving commitment validity")
    proof_public_inputs: str = Field(..., description="Public inputs to proof verifier")
    
    # Proof verification
    verifier_contract_address: str = Field(
        ...,
        description="Garaga verifier contract that verified this proof"
    )
    verified_at: Optional[datetime] = Field(default=None, description="Timestamp of on-chain verification")
    verification_tx_hash: Optional[str] = Field(default=None, description="Transaction hash of verification")
    
    # Metadata (for reconstruction if needed)
    currency: str = Field(default="wei", description="Unit of amount (wei, USDC, etc)")
    purpose: str = Field(..., description="Purpose of this amount (e.g., 'lp_token0', 'fees_earned')")
    
    # Off-chain secret (kept locally, never sent on-chain)
    # Note: In production, this should be stored in a secure enclave, not in plaintext
    amount_secret: Optional[str] = Field(default=None, description="[DEV ONLY] Secret amount for proof generation")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(datetime.timezone.utc))

    model_config = ConfigDict(
        use_enum_values=True,
        json_schema_extra={
            "example": {
                "commitment_hash": "0x1234...abcd",
                "groth16_proof": "0x5678...efgh",
                "proof_public_inputs": "[0x..., 0x...]",
                "verifier_contract_address": "0x9abc...ijkl",
                "currency": "wei",
                "purpose": "lp_token0",
                "verified_at": "2026-02-15T10:00:00",
            }
        }
    )


class ConfidentialAmountWithValue(BaseModel):
    """
    ConfidentialAmount + approximate off-chain valuation.
    Used for dashboard display (show USD value without revealing exact amount).
    """
    confidential: ConfidentialAmount
    approximate_usd_value: Optional[float] = Field(
        default=None,
        description="Approximate USD value (for display only, not linked to commitment)"
    )
    valuation_timestamp: Optional[datetime] = Field(default=None)
