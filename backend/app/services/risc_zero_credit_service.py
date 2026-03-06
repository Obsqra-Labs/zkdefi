"""
RISC Zero Credit Scoring Service

Generates ZK proofs for cross-chain credit scoring using a neural network
running inside the RISC Zero zkVM.

Privacy guarantees:
- Chain histories (ETH, Starknet) are PRIVATE
- Only the credit tier (AAA/AA/A/B) is revealed
- The neural network inference is verifiable
"""

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
from pathlib import Path

logger = logging.getLogger(__name__)

# Path to the RISC Zero project
RISC_ZERO_PATH = Path(__file__).parent.parent.parent.parent / "credit-scoring"
RISC_ZERO_BIN = RISC_ZERO_PATH / "target" / "release" / "credit-scoring-host"


@dataclass
class ChainHistory:
    """Credit history from a single blockchain."""
    transaction_count: int = 0
    total_volume: int = 0
    first_tx_timestamp: int = 0
    successful_txns: int = 0
    failed_txns: int = 0
    protocol_count: int = 0
    avg_position_size: int = 0
    max_position_size: int = 0
    liquidation_count: int = 0
    repayment_rate: int = 100  # 0-100
    diversity_score: int = 50  # 0-100
    tenure_days: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "transaction_count": self.transaction_count,
            "total_volume": self.total_volume,
            "first_tx_timestamp": self.first_tx_timestamp,
            "successful_txns": self.successful_txns,
            "failed_txns": self.failed_txns,
            "protocol_count": self.protocol_count,
            "avg_position_size": self.avg_position_size,
            "max_position_size": self.max_position_size,
            "liquidation_count": self.liquidation_count,
            "repayment_rate": self.repayment_rate,
            "diversity_score": self.diversity_score,
            "tenure_days": self.tenure_days,
        }


@dataclass
class CreditProofResult:
    """Result from RISC Zero credit proof generation."""
    tier: str  # "AAA", "AA", "A", "B"
    score: int  # 300-850
    factors: List[str]
    proof: Optional[str] = None  # Hex-encoded proof
    public_inputs: Optional[str] = None  # Hex-encoded public inputs
    image_id: Optional[str] = None  # RISC Zero image ID


class RiscZeroCreditService:
    """
    Service for generating RISC Zero credit scoring proofs.
    
    Uses a neural network running inside the RISC Zero zkVM to compute
    credit scores from private on-chain history data.
    """
    
    def __init__(self):
        self._binary_ready = False
        self._check_binary()
    
    def _check_binary(self) -> bool:
        """Check if the RISC Zero binary is built."""
        if RISC_ZERO_BIN.exists():
            self._binary_ready = True
            return True
        
        # Check if we can at least find the project
        if not RISC_ZERO_PATH.exists():
            logger.warning(f"RISC Zero project not found at {RISC_ZERO_PATH}")
            return False
        
        cargo_toml = RISC_ZERO_PATH / "Cargo.toml"
        if cargo_toml.exists():
            logger.info(f"RISC Zero project found but not built. Run: cd {RISC_ZERO_PATH} && cargo build --release")
        
        return False
    
    @property
    def is_ready(self) -> bool:
        """Check if the service is ready to generate proofs."""
        return self._binary_ready
    
    async def generate_credit_proof(
        self,
        user_address: str,
        eth_history: Optional[Dict[str, Any]] = None,
        starknet_history: Optional[Dict[str, Any]] = None,
    ) -> CreditProofResult:
        """
        Generate a ZK proof of credit score.
        
        Args:
            user_address: User's address (for binding)
            eth_history: Ethereum chain history data
            starknet_history: Starknet chain history data
            
        Returns:
            CreditProofResult with tier, score, and proof
        """
        # Build ChainHistory objects
        eth = ChainHistory(**(eth_history or {}))
        starknet = ChainHistory(**(starknet_history or {}))
        
        if self._binary_ready:
            return await self._generate_real_proof(eth, starknet)
        else:
            # Fallback: compute score locally without proof
            return self._compute_score_locally(eth, starknet)
    
    async def _generate_real_proof(
        self,
        eth: ChainHistory,
        starknet: ChainHistory,
    ) -> CreditProofResult:
        """Generate a real RISC Zero proof."""
        try:
            # Prepare JSON inputs
            eth_json = json.dumps(eth.to_dict())
            starknet_json = json.dumps(starknet.to_dict())
            
            # Run the RISC Zero host program
            result = subprocess.run(
                [str(RISC_ZERO_BIN), eth_json, starknet_json],
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout for proof generation
                cwd=str(RISC_ZERO_PATH),
            )
            
            if result.returncode != 0:
                logger.error(f"RISC Zero proof generation failed: {result.stderr}")
                # Fallback to local computation
                return self._compute_score_locally(eth, starknet)
            
            # Parse JSON output
            output = json.loads(result.stdout)
            
            return CreditProofResult(
                tier=output["tier"],
                score=output["score"],
                factors=output["factors"],
                proof=output.get("proof"),
                public_inputs=output.get("public_inputs"),
                image_id=output.get("image_id"),
            )
            
        except subprocess.TimeoutExpired:
            logger.error("RISC Zero proof generation timed out")
            return self._compute_score_locally(eth, starknet)
        except Exception as e:
            logger.error(f"RISC Zero proof generation error: {e}")
            return self._compute_score_locally(eth, starknet)
    
    def _compute_score_locally(
        self,
        eth: ChainHistory,
        starknet: ChainHistory,
    ) -> CreditProofResult:
        """
        Compute credit score locally without ZK proof.
        
        This is a fallback when RISC Zero is not available.
        The score is still computed correctly, but there's no proof.
        """
        import math
        
        # Feature extraction (mirrors the guest program)
        total_volume = eth.total_volume + starknet.total_volume
        total_txns = eth.transaction_count + starknet.transaction_count
        total_success = eth.successful_txns + starknet.successful_txns
        total_failed = eth.failed_txns + starknet.failed_txns
        
        # Base score
        score = 300.0
        factors = []
        
        # Volume factor (up to +150 points)
        if total_volume > 0:
            volume_score = min(150, math.log(total_volume + 1) * 10)
            score += volume_score
            if volume_score > 100:
                factors.append("High transaction volume")
        
        # Transaction count factor (up to +100 points)
        txn_score = min(100, total_txns / 10)
        score += txn_score
        
        # Success rate factor (up to +100 points)
        total_all = total_success + total_failed
        if total_all > 0:
            success_rate = total_success / total_all
            success_score = success_rate * 100
            score += success_score
            if success_rate > 0.95:
                factors.append("Excellent success rate")
            elif success_rate < 0.8:
                factors.append("Transaction failures")
        
        # Protocol diversity (up to +50 points)
        protocol_count = eth.protocol_count + starknet.protocol_count
        diversity_score = min(50, protocol_count * 5)
        score += diversity_score
        if protocol_count > 5:
            factors.append("Strong protocol diversity")
        
        # Tenure factor (up to +100 points)
        max_tenure = max(eth.tenure_days, starknet.tenure_days)
        if max_tenure > 0:
            tenure_score = min(100, math.log(max_tenure + 1) * 20)
            score += tenure_score
            if max_tenure > 365:
                factors.append("Long tenure")
            elif max_tenure < 30:
                factors.append("Limited history")
        
        # Repayment rate (up to +50 points)
        avg_repayment = (eth.repayment_rate + starknet.repayment_rate) / 2
        repayment_score = avg_repayment / 2
        score += repayment_score
        if avg_repayment >= 95:
            factors.append("Perfect repayment history")
        
        # Liquidation penalty (up to -100 points)
        liquidations = eth.liquidation_count + starknet.liquidation_count
        if liquidations > 0:
            score -= min(100, liquidations * 20)
            factors.append("Liquidation history")
        
        # Cross-chain bonus (+50 points)
        if eth.transaction_count > 0 and starknet.transaction_count > 0:
            score += 50
            factors.append("Cross-chain activity")
        
        # Clamp to valid range
        score = max(300, min(850, score))
        
        # Determine tier
        if score >= 750:
            tier = "AAA"
        elif score >= 650:
            tier = "AA"
        elif score >= 550:
            tier = "A"
        else:
            tier = "B"
        
        if not factors:
            factors.append("Standard credit profile")
        
        return CreditProofResult(
            tier=tier,
            score=int(score),
            factors=factors,
            proof=None,  # No proof without RISC Zero
            public_inputs=None,
            image_id=None,
        )
    
    def tier_to_yield_bonus(self, tier: str) -> int:
        """
        Convert credit tier to yield bonus in basis points.
        
        AAA: +200 bps (+2% APY)
        AA:  +100 bps (+1% APY)
        A:   +50 bps  (+0.5% APY)
        B:   +0 bps
        """
        bonuses = {
            "AAA": 200,
            "AA": 100,
            "A": 50,
            "B": 0,
        }
        return bonuses.get(tier, 0)


# Singleton instance
_service: Optional[RiscZeroCreditService] = None


def get_risc_zero_credit_service() -> RiscZeroCreditService:
    """Get or create the RISC Zero credit service singleton."""
    global _service
    if _service is None:
        _service = RiscZeroCreditService()
    return _service
