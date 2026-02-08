"""
Unified Proof Pipeline Service

Coordinates proof generation for both:
- zkML proofs (Garaga/Groth16) for privacy
- Execution proofs (Integrity/STARK) for constraints

Handles caching, optimization, and proof formatting.
"""
import hashlib
import os
from datetime import datetime
from typing import Any

from app.services.zkml_risk_service import get_risk_service
from app.services.zkml_anomaly_service import get_anomaly_service

OBSQRA_PROVER_URL = os.getenv("OBSQRA_PROVER_URL", "https://starknet.obsqra.fi/api/prover")


class ProofPipeline:
    """
    Unified proof generation pipeline.
    """
    
    def __init__(self):
        self.risk_service = get_risk_service()
        self.anomaly_service = get_anomaly_service()
        
        # Proof cache
        self._cache: dict[str, dict] = {}
        self._cache_ttl_seconds = 300  # 5 minutes
    
    async def generate_rebalancing_proofs(
        self,
        user_address: str,
        portfolio_features: list[int],
        pool_id: str,
        risk_threshold: int = 30,
        constraints: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """
        Generate all proofs needed for rebalancing.
        
        Returns:
        - zkml_proofs: Risk score + anomaly detection (Garaga)
        - execution_proof: Constraint satisfaction (Integrity)
        """
        # Generate shared commitment
        commitment_hash = self._generate_commitment(
            user_address, portfolio_features, pool_id
        )
        
        # Check cache
        cache_key = f"rebalance_{commitment_hash}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached
        
        # Generate zkML proofs (Garaga)
        risk_proof = await self.risk_service.generate_risk_proof(
            user_address=user_address,
            portfolio_features=portfolio_features,
            threshold=risk_threshold,
            commitment_hash=commitment_hash
        )
        
        anomaly_proof = await self.anomaly_service.analyze_pool_safety(
            pool_id=pool_id,
            user_address=user_address,
            commitment_hash=commitment_hash
        )
        
        # Generate execution proof (Integrity)
        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints or {},
            commitment_hash=commitment_hash
        )
        
        # Check if all proofs pass
        zkml_passed = risk_proof["is_compliant"] and anomaly_proof["is_safe"]
        execution_passed = execution_proof["is_valid"]
        can_execute = zkml_passed and execution_passed
        
        result = {
            "commitment_hash": commitment_hash,
            "zkml_proofs": {
                "risk": risk_proof,
                "anomaly": anomaly_proof,
                "passed": zkml_passed
            },
            "execution_proof": execution_proof,
            "can_execute": can_execute,
            "combined_calldata": {
                "zkml_calldata": risk_proof["proof_calldata"] + anomaly_proof["proof_calldata"],
                "execution_proof_hash": execution_proof["proof_hash"]
            },
            "generated_at": datetime.utcnow().isoformat()
        }
        
        # Cache result
        self._cache_result(cache_key, result)
        
        return result
    
    async def generate_deposit_proofs(
        self,
        user_address: str,
        amount: int,
        protocol_id: int,
        constraints: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Generate proofs for deposit action.
        """
        commitment_hash = self._generate_commitment(
            user_address, [amount, protocol_id], "deposit"
        )
        
        # For deposit, we need execution proof (constraints)
        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints,
            commitment_hash=commitment_hash,
            action_type="deposit",
            amount=amount
        )
        
        return {
            "commitment_hash": commitment_hash,
            "execution_proof": execution_proof,
            "can_execute": execution_proof["is_valid"],
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def generate_withdraw_proofs(
        self,
        user_address: str,
        amount: int,
        protocol_id: int,
        constraints: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Generate proofs for withdraw action.
        """
        commitment_hash = self._generate_commitment(
            user_address, [amount, protocol_id], "withdraw"
        )
        
        # For withdraw, we need execution proof
        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints,
            commitment_hash=commitment_hash,
            action_type="withdraw",
            amount=amount
        )
        
        return {
            "commitment_hash": commitment_hash,
            "execution_proof": execution_proof,
            "can_execute": execution_proof["is_valid"],
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _generate_execution_proof(
        self,
        user_address: str,
        constraints: dict[str, Any],
        commitment_hash: str,
        action_type: str = "rebalance",
        amount: int = 0
    ) -> dict[str, Any]:
        """
        Generate execution proof via obsqra.fi prover.
        
        Calls obsqra.fi Stone prover for STARK proofs.
        Fails if prover is unavailable - no fallback.
        """
        # TODO: Integrate with obsqra.fi Stone prover API
        # For now, raise an error - we don't support execution proofs yet
        raise RuntimeError(
            "Execution proof generation not yet implemented. "
            "Requires integration with obsqra.fi Stone prover."
        )
    
    def _generate_commitment(
        self,
        user_address: str,
        data: Any,
        context: str
    ) -> str:
        """Generate a commitment hash."""
        return "0x" + hashlib.sha256(
            f"{user_address}{data}{context}{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:32]
    
    def _get_cached(self, key: str) -> dict[str, Any] | None:
        """Get cached proof result."""
        if key not in self._cache:
            return None
        
        cached = self._cache[key]
        generated_at = datetime.fromisoformat(cached["generated_at"])
        age = (datetime.utcnow() - generated_at).total_seconds()
        
        if age > self._cache_ttl_seconds:
            del self._cache[key]
            return None
        
        return cached
    
    def _cache_result(self, key: str, result: dict[str, Any]) -> None:
        """Cache proof result."""
        self._cache[key] = result


# Singleton instance
_pipeline: ProofPipeline | None = None


def get_proof_pipeline() -> ProofPipeline:
    """Get or create the proof pipeline singleton."""
    global _pipeline
    if _pipeline is None:
        _pipeline = ProofPipeline()
    return _pipeline
