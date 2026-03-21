"""
Real Prover Integrations for MVP

Connects to:
1. Garaga (Groth16 verification for amount-hiding)
2. Obsqra Stone Prover (zkML risk proofs)
3. Integrity Fact Registry (on-chain proof verification)
"""

import os
import json
import httpx
import logging
from typing import Optional, Dict, Any
from datetime import datetime
import hashlib

logger = logging.getLogger(__name__)

# Configuration
GARAGA_VERIFIER_URL = os.getenv("GARAGA_VERIFIER_URL", "http://localhost:5000")
OBSQRA_PROVER_URL = os.getenv("OBSQRA_PROVER_URL", "https://starknet.obsqra.fi/api/v1")
OBSQRA_API_KEY = os.getenv("OBSQRA_API_KEY", "")
OBSQRA_L2_VERIFICATION_POLICY = os.getenv("OBSQRA_L2_VERIFICATION_POLICY", "").strip().lower()
INTEGRITY_RPC = os.getenv("INTEGRITY_RPC", "https://starknet-sepolia.public.blastapi.io")


class GaragaProverClient:
    """Integration with Garaga for Groth16 verification."""
    
    def __init__(self, base_url: str = GARAGA_VERIFIER_URL):
        self.base_url = base_url
        self.timeout = 60
    
    async def verify_groth16_proof(
        self,
        proof_json: dict,
        public_inputs: list,
        vk_json: dict,
    ) -> Dict[str, Any]:
        """
        Verify a Groth16 proof via Garaga.
        
        Args:
            proof_json: Snarkjs proof format
            public_inputs: Public inputs
            vk_json: Verification key
        
        Returns:
            {"valid": bool, "error": str|None, "calldata": list[str]}
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/v1/verify",
                    json={
                        "proof": proof_json,
                        "public_inputs": public_inputs,
                        "vk": vk_json,
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "valid": data.get("valid", False),
                        "error": data.get("error"),
                        "calldata": data.get("calldata", []),
                    }
                else:
                    logger.error(f"Garaga verification failed: {response.text}")
                    return {
                        "valid": False,
                        "error": f"HTTP {response.status_code}",
                        "calldata": [],
                    }
        except Exception as e:
            logger.error(f"Garaga client error: {e}")
            return {
                "valid": False,
                "error": str(e),
                "calldata": [],
            }
    
    async def generate_groth16_proof(
        self,
        circuit_name: str,
        inputs: dict,
        wasm_path: Optional[str] = None,
        zkey_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate a Groth16 proof via Garaga.
        
        Args:
            circuit_name: Name of circuit (e.g., "confidential_amount")
            inputs: Circuit inputs
            wasm_path: Path to circuit WASM
            zkey_path: Path to ZK setup key
        
        Returns:
            {"valid": bool, "proof": dict, "public": list, "error": str|None}
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/v1/prove",
                    json={
                        "circuit": circuit_name,
                        "inputs": inputs,
                        "wasm": wasm_path,
                        "zkey": zkey_path,
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "valid": True,
                        "proof": data.get("proof"),
                        "public": data.get("public_inputs", []),
                        "error": None,
                    }
                else:
                    return {
                        "valid": False,
                        "proof": None,
                        "public": [],
                        "error": response.text,
                    }
        except Exception as e:
            logger.error(f"Garaga proof generation failed: {e}")
            return {
                "valid": False,
                "proof": None,
                "public": [],
                "error": str(e),
            }


class StoneProverClient:
    """Integration with Obsqra Stone Prover for zkML proofs."""
    
    def __init__(
        self,
        base_url: str = OBSQRA_PROVER_URL,
        api_key: str = OBSQRA_API_KEY,
        l2_verification_policy: str | None = OBSQRA_L2_VERIFICATION_POLICY or None,
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.l2_verification_policy = l2_verification_policy
        self.timeout = 300  # Stone proofs can take time

    @staticmethod
    def _to_int(value: Any, default: int) -> int:
        try:
            return int(float(value))
        except Exception:
            return default

    @classmethod
    def _proofs_generate_payload(cls, input_data: dict) -> dict:
        if isinstance(input_data.get("jediswap_metrics"), dict) and isinstance(input_data.get("ekubo_metrics"), dict):
            return {
                "jediswap_metrics": input_data["jediswap_metrics"],
                "ekubo_metrics": input_data["ekubo_metrics"],
            }

        risk = cls._to_int(input_data.get("risk_tolerance", input_data.get("risk", 50)), 50)
        util = risk * 100 if risk <= 100 else risk
        util = max(0, min(10000, util))
        return {
            "jediswap_metrics": {
                "utilization": util,
                "volatility": cls._to_int(input_data.get("volatility", 2800), 2800),
                "liquidity": max(1, cls._to_int(input_data.get("liquidity", 2), 2)),
                "audit_score": cls._to_int(input_data.get("audit_score", 85), 85),
                "age_days": cls._to_int(input_data.get("age_days", 240), 240),
            },
            "ekubo_metrics": {
                "utilization": min(10000, util + 700),
                "volatility": cls._to_int(input_data.get("volatility", 2300), 2300),
                "liquidity": max(1, cls._to_int(input_data.get("liquidity", 3), 3)),
                "audit_score": cls._to_int(input_data.get("audit_score", 90), 90),
                "age_days": cls._to_int(input_data.get("age_days", 320), 320),
            },
        }
    
    async def generate_zkml_proof(
        self,
        proof_type: str,
        input_data: dict,
        program_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate a STARK/zkML proof via Obsqra.
        
        Args:
            proof_type: Type of proof (e.g., "lp_risk", "rebalance_decision")
            input_data: Input data for the proof
            program_hash: Optional Cairo program hash
        
        Returns:
            {"valid": bool, "proof": dict, "fact_hash": str, "error": str|None}
        """
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Preferred public endpoint.
                response = await client.post(
                    f"{self.base_url}/proofs/generate",
                    json=self._proofs_generate_payload(input_data),
                    headers=headers,
                )
                if response.status_code == 404:
                    # Back-compat fallback for older stacks.
                    response = await client.post(
                        f"{self.base_url}/prove",
                        json={
                            "type": proof_type,
                            "input": input_data,
                            "program_hash": program_hash,
                        },
                        headers=headers,
                    )

                if response.status_code in [200, 201]:
                    data = response.json()
                    stark = data.get("stark") if isinstance(data.get("stark"), dict) else {}
                    return {
                        "valid": True,
                        "proof": data.get("proof") or stark or data,
                        "fact_hash": data.get("fact_hash") or stark.get("fact_hash"),
                        "error": None,
                    }

                logger.error(f"Stone prover error: {response.text}")
                return {
                    "valid": False,
                    "proof": None,
                    "fact_hash": None,
                    "error": response.text,
                }
        except Exception as e:
            logger.error(f"Stone prover client error: {e}")
            return {
                "valid": False,
                "proof": None,
                "fact_hash": None,
                "error": str(e),
            }
    
    async def verify_proof_on_chain(
        self,
        fact_hash: str,
        chain_id: str = "starknet-sepolia",
        verification_policy: str | None = None,
    ) -> Dict[str, Any]:
        """
        Check if a proof fact has been registered on the Integrity fact registry.
        
        Args:
            fact_hash: Fact hash from proof generation
            chain_id: Chain identifier (default: Starknet Sepolia)
        
        Returns:
            {"verified": bool, "chain": str, "block": int|None, "error": str|None}
        """
        try:
            resolved_policy = verification_policy or self.l2_verification_policy
            params = {
                "chain": chain_id,
                # Explicit for compatibility endpoints that can mirror
                # proven L3 facts into the L2 registry on demand.
                "mirror_from_l3": "true",
            }
            if resolved_policy:
                params["verification_policy"] = resolved_policy
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/verify/{fact_hash}",
                    params=params,
                )
                if response.status_code == 404:
                    return {
                        "verified": False,
                        "chain": chain_id,
                        "block": None,
                        "error": "L2 verification endpoint unavailable on OBSQRA API",
                        "tx_hash": None,
                        "verification_policy": resolved_policy,
                    }

                if response.status_code == 200:
                    data = response.json()
                    return {
                        "verified": bool(data.get("verified", False)),
                        "chain": data.get("chain") or chain_id,
                        "block": data.get("block_number", data.get("block")),
                        "error": data.get("error"),
                        "source": data.get("source"),
                        "tx_hash": data.get("tx_hash"),
                        "verification_policy": data.get("verification_policy"),
                        "verification_backend": data.get("verification_backend"),
                        "obsqra_verified": data.get("obsqra_verified"),
                        "integrity_verified": data.get("integrity_verified"),
                    }
                else:
                    return {
                        "verified": False,
                        "chain": chain_id,
                        "block": None,
                        "error": response.text,
                        "source": None,
                        "tx_hash": None,
                        "verification_policy": resolved_policy,
                        "verification_backend": None,
                        "obsqra_verified": None,
                        "integrity_verified": None,
                    }
        except Exception as e:
            logger.error(f"Proof verification check failed: {e}")
            return {
                "verified": False,
                "chain": chain_id,
                "block": None,
                "error": str(e),
                "source": None,
                "tx_hash": None,
                "verification_policy": verification_policy or self.l2_verification_policy,
                "verification_backend": None,
                "obsqra_verified": None,
                "integrity_verified": None,
            }


class ConfidentialAmountProver:
    """
    Prover for amount-hiding commitments via Garaga.
    
    Flow:
    1. Generate Groth16 proof that amount <= max_amount (range proof)
    2. Commit amount using Poseidon hash
    3. Return commitment + proof for on-chain verification
    """
    
    def __init__(self):
        self.garaga = GaragaProverClient()
    
    async def create_confidential_amount(
        self,
        amount: int,
        max_amount: int,
        salt: str,
    ) -> Dict[str, Any]:
        """
        Create a confidential amount proof.
        
        Args:
            amount: Actual amount
            max_amount: Maximum possible amount (for range proof)
            salt: Random salt for commitment
        
        Returns:
            {
                "commitment": hex_str,
                "proof": proof_json,
                "public_inputs": list,
                "error": str|None
            }
        """
        try:
            # Generate range proof (amount in [0, max_amount])
            proof_result = await self.garaga.generate_groth16_proof(
                circuit_name="range_proof",
                inputs={
                    "amount": str(amount),
                    "max_amount": str(max_amount),
                    "salt": salt,
                },
            )
            
            if not proof_result["valid"]:
                return {
                    "commitment": None,
                    "proof": None,
                    "public_inputs": [],
                    "error": proof_result.get("error"),
                }
            
            # Compute commitment: H(amount || salt)
            commitment_input = f"{amount:064x}{salt}".encode()
            commitment_hash = hashlib.poseidon(commitment_input).hexdigest()
            
            return {
                "commitment": f"0x{commitment_hash}",
                "proof": proof_result.get("proof"),
                "public_inputs": proof_result.get("public", []),
                "error": None,
            }
        except Exception as e:
            logger.error(f"Confidential amount creation failed: {e}")
            return {
                "commitment": None,
                "proof": None,
                "public_inputs": [],
                "error": str(e),
            }


class ZkMLRiskProver:
    """
    Prover for zkML risk validation proofs.
    
    Flow:
    1. Load position metrics (volatility, fee tier, volume)
    2. Run risk scoring model
    3. Generate STARK proof via Stone
    4. Return proof + fact hash
    """
    
    def __init__(self):
        self.stone = StoneProverClient()
    
    async def generate_lp_risk_proof(
        self,
        token_a: str,
        token_b: str,
        fee_tier: int,
        pool_volatility: float,
        volume_24h: float,
    ) -> Dict[str, Any]:
        """
        Generate a risk validation proof for LP position.
        
        Args:
            token_a: Token A
            token_b: Token B
            fee_tier: Fee tier
            pool_volatility: Pool volatility (0-1)
            volume_24h: 24h trading volume
        
        Returns:
            {
                "proof": proof_object,
                "fact_hash": str,
                "risk_score": float,
                "approved": bool,
                "error": str|None
            }
        """
        try:
            # ML risk scoring (locally)
            risk_score = self._calculate_risk_score(
                fee_tier, pool_volatility, volume_24h
            )
            
            # Generate STARK proof
            proof_result = await self.stone.generate_zkml_proof(
                proof_type="lp_risk",
                input_data={
                    "token_a": token_a,
                    "token_b": token_b,
                    "fee_tier": fee_tier,
                    "volatility": pool_volatility,
                    "volume": volume_24h,
                    "risk_score": risk_score,
                },
            )
            
            if not proof_result["valid"]:
                return {
                    "proof": None,
                    "fact_hash": None,
                    "risk_score": risk_score,
                    "approved": False,
                    "error": proof_result.get("error"),
                }
            
            # Risk approved if score < 0.7 (70%)
            approved = risk_score < 0.7
            
            return {
                "proof": proof_result.get("proof"),
                "fact_hash": proof_result.get("fact_hash"),
                "risk_score": risk_score,
                "approved": approved,
                "error": None,
            }
        except Exception as e:
            logger.error(f"LP risk proof generation failed: {e}")
            return {
                "proof": None,
                "fact_hash": None,
                "risk_score": 1.0,
                "approved": False,
                "error": str(e),
            }
    
    def _calculate_risk_score(
        self, fee_tier: int, volatility: float, volume_24h: float
    ) -> float:
        """
        Calculate risk score (0-1, lower is better).
        
        Factors:
        - High volatility = higher risk
        - Low volume = higher risk
        - Extreme fee tiers = higher risk
        """
        # Base risk from volatility
        vol_risk = min(volatility, 1.0)
        
        # Volume risk (low volume = high risk)
        volume_risk = 0.0 if volume_24h > 1_000_000 else 0.3
        
        # Fee tier risk (optimal: 500-3000)
        fee_risk = 0.0
        if fee_tier < 100 or fee_tier > 10000:
            fee_risk = 0.3
        elif fee_tier > 5000:
            fee_risk = 0.1
        
        # Weighted combination
        risk = (vol_risk * 0.5) + (volume_risk * 0.3) + (fee_risk * 0.2)
        
        return min(risk, 1.0)


class RebalanceDecisionProver:
    """
    Prover for autonomous rebalance decision proofs.
    
    Flow:
    1. Analyze position drift (price, fees)
    2. Run decision model
    3. Generate STARK proof via Stone
    4. Return proof + recommended fee tier
    """
    
    def __init__(self):
        self.stone = StoneProverClient()
    
    async def generate_rebalance_decision_proof(
        self,
        position_id: str,
        current_fee_tier: int,
        price_drift_percent: float,
        fee_accumulated_percent: float,
        pool_volatility: float,
    ) -> Dict[str, Any]:
        """
        Generate a rebalance decision proof.
        
        Args:
            position_id: Position ID
            current_fee_tier: Current fee tier
            price_drift_percent: Price drift percentage
            fee_accumulated_percent: Fee accumulated (%)
            pool_volatility: Pool volatility
        
        Returns:
            {
                "proof": proof_object,
                "fact_hash": str,
                "recommended_fee_tier": int,
                "should_rebalance": bool,
                "error": str|None
            }
        """
        try:
            # Decision model (locally)
            should_rebalance = (
                abs(price_drift_percent) > 8.0 or fee_accumulated_percent > 0.5
            )
            recommended_fee_tier = self._calculate_optimal_fee_tier(
                pool_volatility, fee_accumulated_percent
            )
            
            # Generate STARK proof
            proof_result = await self.stone.generate_zkml_proof(
                proof_type="rebalance_decision",
                input_data={
                    "position_id": position_id,
                    "current_fee_tier": current_fee_tier,
                    "recommended_fee_tier": recommended_fee_tier,
                    "price_drift": price_drift_percent,
                    "fee_accumulated": fee_accumulated_percent,
                    "volatility": pool_volatility,
                    "should_rebalance": should_rebalance,
                },
            )
            
            return {
                "proof": proof_result.get("proof"),
                "fact_hash": proof_result.get("fact_hash"),
                "recommended_fee_tier": recommended_fee_tier,
                "should_rebalance": should_rebalance,
                "error": proof_result.get("error") if not proof_result["valid"] else None,
            }
        except Exception as e:
            logger.error(f"Rebalance decision proof generation failed: {e}")
            return {
                "proof": None,
                "fact_hash": None,
                "recommended_fee_tier": current_fee_tier,
                "should_rebalance": False,
                "error": str(e),
            }
    
    def _calculate_optimal_fee_tier(
        self, volatility: float, fee_accumulated_percent: float
    ) -> int:
        """
        Calculate optimal fee tier based on conditions.
        
        Logic:
        - High volatility + high fees → increase fee tier
        - Low volatility + low fees → decrease fee tier
        """
        if fee_accumulated_percent > 0.7:
            # Move to higher fee tier
            return 3000
        elif fee_accumulated_percent > 0.3:
            return 1000
        elif volatility > 0.3:
            return 500
        else:
            return 100
