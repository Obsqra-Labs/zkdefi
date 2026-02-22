"""
zkML Proof Service

Generates and verifies zkML proofs for:
1. Risk validation (safe LP allocation?)
2. Anomaly detection (suspicious position?)
3. Rebalance decision (should we rebalance?)

Uses real Stone prover (Obsqra) + Integrity fact registry.
"""

import os
import json
from typing import Optional, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Import real prover integrations
try:
    from .prover_integrations import (
        ZkMLRiskProver,
        RebalanceDecisionProver,
        StoneProverClient,
    )
    HAS_REAL_PROVERS = True
except ImportError as e:
    logger.warning(f"Real provers not available: {e}, using mock mode")
    HAS_REAL_PROVERS = False


class ZkmlProofService:
    """
    Service for generating zkML proofs.
    
    Uses real Stone prover (Obsqra) when available.
    Falls back to mock mode with synthetic proof hashes for development.
    """
    
    def __init__(self):
        self.risk_prover = ZkMLRiskProver() if HAS_REAL_PROVERS else None
        self.rebalance_prover = RebalanceDecisionProver() if HAS_REAL_PROVERS else None
        self.stone = StoneProverClient() if HAS_REAL_PROVERS else None
    
    async def generate_lp_risk_proof(
        self,
        token_a: str,
        token_b: str,
        fee_tier: int,
        pool_volatility: float,
        volume_24h: float,
    ) -> dict[str, Any]:
        """
        Generate LP risk validation proof.
        
        Uses real Stone prover if available, falls back to mock.
        """
        if HAS_REAL_PROVERS and self.risk_prover:
            # Real proof
            result = await self.risk_prover.generate_lp_risk_proof(
                token_a=token_a,
                token_b=token_b,
                fee_tier=fee_tier,
                pool_volatility=pool_volatility,
                volume_24h=volume_24h,
            )
            return {
                "proof_hash": result.get("fact_hash", "0x0"),
                "proof": result.get("proof"),
                "risk_score": result.get("risk_score", 0.5),
                "approved": result.get("approved", True),
                "error": result.get("error"),
            }
        else:
            # Mock mode: synthetic proof hash
            import hashlib
            data = f"{token_a}-{token_b}-{fee_tier}-{pool_volatility}-{volume_24h}"
            proof_hash = "0x" + hashlib.sha256(data.encode()).hexdigest()[:16]
            
            logger.info(f"[MOCK] LP risk proof: {proof_hash}")
            return {
                "proof_hash": proof_hash,
                "proof": None,
                "risk_score": 0.3,
                "approved": True,
                "error": None,
            }
    
    async def generate_rebalance_decision_proof(
        self,
        position_id: str,
        current_fee_tier: int,
        pool_volatility: float,
        volume_24h: float,
    ) -> dict[str, Any]:
        """
        Generate rebalance decision proof.
        
        Uses real Stone prover if available, falls back to mock.
        """
        if HAS_REAL_PROVERS and self.rebalance_prover:
            # Real proof
            result = await self.rebalance_prover.generate_rebalance_decision_proof(
                position_id=position_id,
                current_fee_tier=current_fee_tier,
                price_drift_percent=5.0,  # Mock
                fee_accumulated_percent=0.3,  # Mock
                pool_volatility=pool_volatility,
            )
            return {
                "proof_hash": result.get("fact_hash", "0x0"),
                "proof": result.get("proof"),
                "recommended_fee_tier": result.get("recommended_fee_tier", current_fee_tier),
                "should_rebalance": result.get("should_rebalance", False),
                "error": result.get("error"),
            }
        else:
            # Mock mode
            import hashlib
            data = f"{position_id}-{current_fee_tier}-{pool_volatility}"
            proof_hash = "0x" + hashlib.sha256(data.encode()).hexdigest()[:16]
            
            logger.info(f"[MOCK] Rebalance decision proof: {proof_hash}")
            return {
                "proof_hash": proof_hash,
                "proof": None,
                "recommended_fee_tier": current_fee_tier,
                "should_rebalance": False,
                "error": None,
            }
