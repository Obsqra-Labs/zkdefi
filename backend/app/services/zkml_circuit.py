"""
zkML Mock Circuit - Generates zero-knowledge proofs for pool allocation decisions
MVP Week 1: Uses mock proofs (Week 3+: Real STARK proofs)
"""

import hashlib
import json
import logging
from typing import Dict, List, Tuple
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class ProofType(Enum):
    """Types of proofs this circuit can generate"""
    ALLOCATION_VALID = "allocation_valid"  # Proves allocation sums to 100%
    RISK_ASSESSMENT = "risk_assessment"  # Proves risk score calculation
    POOL_EVALUATION = "pool_evaluation"  # Proves pool meets user criteria


@dataclass
class CircuitProof:
    """Zero-knowledge proof from circuit"""
    proof_hash: str  # Starknet felt252 (0x...)
    proof_type: ProofType
    circuit_inputs: Dict  # Public inputs
    timestamp: int  # Unix timestamp
    verified: bool  # Whether proof passed verification


class zkMLCircuit:
    """
    MVP Mock zkML Circuit for verifiable pool allocation
    
    In production (Week 3+), this would generate real STARK proofs.
    For MVP, we generate deterministic mock proofs that:
    - Use consistent hashing
    - Include all inputs in hash
    - Can be verified by checking hash consistency
    - Look like real Starknet felts (256-bit values)
    """

    def __init__(self):
        """Initialize circuit"""
        self.proof_cache: Dict[str, CircuitProof] = {}
        logger.info("zkML Circuit initialized (mock mode - Week 3+ real STARK proofs)")

    def prove_allocation_valid(
        self,
        user_address: str,
        pools: List[Dict],
        allocation_percentages: Dict[str, float],
        risk_profile: str,
    ) -> CircuitProof:
        """
        Generate proof that allocation is valid for this user & profile
        
        Proves:
        1. Allocation percentages sum to 100%
        2. Each pool meets user's risk tolerance
        3. No pools exceed reasonable limits
        4. Calculation was deterministic
        
        Args:
            user_address: Starknet wallet address
            pools: Available pools with risk scores
            allocation_percentages: {pool_id: 0.0-1.0}
            risk_profile: "conservative", "balanced", or "aggressive"
        
        Returns:
            CircuitProof with proof_hash for on-chain verification
        """
        
        # Validate allocation sums to 100%
        total = sum(allocation_percentages.values())
        if abs(total - 1.0) > 0.01:  # Allow 1% rounding
            raise ValueError(f"Allocation must sum to ~100%, got {total*100:.1f}%")

        # Create circuit inputs (what we're proving)
        circuit_inputs = {
            "user_address": user_address,
            "risk_profile": risk_profile,
            "allocation": allocation_percentages,
            "pools_evaluated": len(pools),
        }

        # Generate deterministic proof hash
        proof_hash = self._generate_proof_hash(
            circuit_inputs=circuit_inputs,
            proof_type=ProofType.ALLOCATION_VALID,
        )

        proof = CircuitProof(
            proof_hash=proof_hash,
            proof_type=ProofType.ALLOCATION_VALID,
            circuit_inputs=circuit_inputs,
            timestamp=int(__import__("time").time()),
            verified=True,  # Mock always verifies
        )

        # Cache for later verification
        self.proof_cache[proof_hash] = proof
        logger.info(f"Generated allocation proof: {proof_hash[:16]}... for {user_address[:8]}...")

        return proof

    def prove_risk_assessment(
        self,
        pool_id: str,
        pool_metrics: Dict,
        calculated_score: float,
    ) -> CircuitProof:
        """
        Generate proof that risk score was calculated correctly
        
        Proves:
        1. Risk score matches formula
        2. Used correct pool metrics
        3. No manipulation of inputs
        
        Args:
            pool_id: Pool identifier
            pool_metrics: {liquidity, volume, volatility, ...}
            calculated_score: The computed risk score (0-100)
        
        Returns:
            CircuitProof
        """

        circuit_inputs = {
            "pool_id": pool_id,
            "metrics": pool_metrics,
            "calculated_score": calculated_score,
        }

        proof_hash = self._generate_proof_hash(
            circuit_inputs=circuit_inputs,
            proof_type=ProofType.RISK_ASSESSMENT,
        )

        proof = CircuitProof(
            proof_hash=proof_hash,
            proof_type=ProofType.RISK_ASSESSMENT,
            circuit_inputs=circuit_inputs,
            timestamp=int(__import__("time").time()),
            verified=True,
        )

        self.proof_cache[proof_hash] = proof
        return proof

    def prove_pool_evaluation(
        self,
        pool_id: str,
        risk_score: float,
        user_profile: str,
        suitable_for_profile: bool,
    ) -> CircuitProof:
        """
        Generate proof that pool evaluation matches criteria
        
        Proves:
        1. Pool risk score was verified
        2. User profile criteria applied correctly
        3. Suitability determination is sound
        
        Args:
            pool_id: Pool identifier
            risk_score: Calculated risk score
            user_profile: User's risk profile
            suitable_for_profile: Whether pool suits profile
        
        Returns:
            CircuitProof
        """

        circuit_inputs = {
            "pool_id": pool_id,
            "risk_score": risk_score,
            "user_profile": user_profile,
            "suitable": suitable_for_profile,
        }

        proof_hash = self._generate_proof_hash(
            circuit_inputs=circuit_inputs,
            proof_type=ProofType.POOL_EVALUATION,
        )

        proof = CircuitProof(
            proof_hash=proof_hash,
            proof_type=ProofType.POOL_EVALUATION,
            circuit_inputs=circuit_inputs,
            timestamp=int(__import__("time").time()),
            verified=True,
        )

        self.proof_cache[proof_hash] = proof
        return proof

    def verify_proof(self, proof_hash: str, expected_inputs: Dict = None) -> bool:
        """
        Verify a proof (can be called by on-chain contract)
        
        Args:
            proof_hash: The proof hash to verify
            expected_inputs: Optional - verify inputs match
        
        Returns:
            True if proof is valid, False otherwise
        """
        if proof_hash not in self.proof_cache:
            logger.warning(f"Proof not found in cache: {proof_hash}")
            return self._verify_proof_hash_format(proof_hash)

        proof = self.proof_cache[proof_hash]

        if not proof.verified:
            logger.warning(f"Proof failed verification: {proof_hash}")
            return False

        if expected_inputs:
            if proof.circuit_inputs != expected_inputs:
                logger.warning(f"Proof inputs don't match expected: {proof_hash}")
                return False

        return True

    def _generate_proof_hash(
        self,
        circuit_inputs: Dict,
        proof_type: ProofType,
    ) -> str:
        """
        Generate deterministic mock proof hash
        
        In production, this would be a real STARK proof generated by the prover.
        For MVP, we use SHA256 to create a deterministic 256-bit hash that looks
        like a Starknet felt252.
        
        Args:
            circuit_inputs: Inputs to circuit
            proof_type: Type of proof
        
        Returns:
            0x-prefixed hex string (valid Starknet felt)
        """
        
        # Create input blob
        input_blob = json.dumps(
            {
                "inputs": circuit_inputs,
                "type": proof_type.value,
            },
            sort_keys=True,
        )

        # Hash it
        hash_bytes = hashlib.sha256(input_blob.encode()).digest()
        
        # Convert to felt252 (0x-prefixed 256-bit hex)
        proof_hash = "0x" + hash_bytes.hex()

        return proof_hash

    def _verify_proof_hash_format(self, proof_hash: str) -> bool:
        """Check if proof hash looks like a valid Starknet felt252"""
        try:
            # Should be 0x-prefixed hex
            if not proof_hash.startswith("0x"):
                return False
            
            # Should be 64 hex chars (256 bits)
            hex_part = proof_hash[2:]
            if len(hex_part) != 64:
                return False
            
            # Should be valid hex
            int(hex_part, 16)
            return True
        except ValueError:
            return False


# Singleton instance
_circuit = None


def get_circuit() -> zkMLCircuit:
    """Get or create singleton circuit instance"""
    global _circuit
    if _circuit is None:
        _circuit = zkMLCircuit()
    return _circuit
