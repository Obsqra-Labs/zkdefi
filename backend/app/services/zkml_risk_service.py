"""
zkML Risk Score Service

Privacy-preserving risk score proof generation.
Proves risk_score <= threshold WITHOUT revealing the actual score.

Uses Groth16 (snarkjs) → Garaga-compatible proof format.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any


# Circuit paths - go from services/ -> app/ -> backend/ -> zkdefi (project root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"
RISK_WASM = CIRCUITS_DIR / "RiskScore_js" / "RiskScore.wasm"
RISK_ZKEY = CIRCUITS_DIR / "RiskScore_final.zkey"
RISK_WITNESS_GEN = CIRCUITS_DIR / "RiskScore_js" / "generate_witness.js"


class RiskScoreModel:
    """
    Simple risk scoring model.
    Can be replaced with actual ML model (ONNX, scikit-learn).
    """
    
    # Default model weights (normalized)
    DEFAULT_WEIGHTS = [
        10,   # total_balance weight
        15,   # position_concentration weight
        10,   # protocol_diversity weight (negative = good)
        20,   # volatility_exposure weight
        5,    # liquidity_depth weight (negative = good)
        5,    # time_in_position weight (negative = good)
        25,   # recent_drawdown weight
        10,   # correlation_risk weight
    ]
    
    DEFAULT_BIAS = 0
    SCALE = 100  # Score scaled 0-100
    
    @classmethod
    def compute_risk_score(
        cls,
        portfolio_features: list[int],
        weights: list[int] | None = None,
        bias: int = 0,
        scale: int = 100
    ) -> int:
        """
        Compute risk score from portfolio features.
        MUST match circuit computation: actual_score = weighted_sum // scale
        """
        if weights is None:
            weights = cls.DEFAULT_WEIGHTS
        
        if len(portfolio_features) != len(weights):
            raise ValueError(f"Expected {len(weights)} features, got {len(portfolio_features)}")
        
        # Compute weighted sum (same as circuit)
        weighted_sum = bias
        for feature, weight in zip(portfolio_features, weights):
            weighted_sum += feature * weight
        
        # Circuit expects: actual_score = weighted_sum // scale
        return weighted_sum // scale
    
    @classmethod
    def generate_witness_input(
        cls,
        portfolio_features: list[int],
        threshold: int,
        user_address: str,
        commitment_hash: str,
        weights: list[int] | None = None,
        bias: int = 0,
        scale: int = 100
    ) -> dict[str, Any]:
        """
        Generate witness input for the RiskScore circuit.
        """
        if weights is None:
            weights = cls.DEFAULT_WEIGHTS
        
        actual_score = cls.compute_risk_score(portfolio_features, weights, bias, scale)
        
        # Convert user_address and commitment_hash to integers
        if isinstance(user_address, str):
            user_address_int = int(user_address, 16) if user_address.startswith("0x") else int(user_address)
        else:
            user_address_int = int(user_address)
        
        if isinstance(commitment_hash, str):
            commitment_int = int(commitment_hash, 16) if commitment_hash.startswith("0x") else int(commitment_hash)
        else:
            commitment_int = int(commitment_hash)
        
        return {
            "portfolio_features": [str(f) for f in portfolio_features],
            "model_weights": [str(w) for w in weights],
            "model_bias": str(bias),
            "actual_score": str(actual_score),
            "threshold": str(threshold),
            "scale": str(scale),
            "user_address": str(user_address_int),
            "commitment_hash": str(commitment_int)
        }


class ZkmlRiskService:
    """
    Service for generating privacy-preserving risk score proofs.
    """
    
    def __init__(self):
        self.model = RiskScoreModel()
        self.circuits_ready = self._check_circuits()
    
    def _check_circuits(self) -> bool:
        """Check if circuits are compiled."""
        return RISK_WASM.exists() and RISK_ZKEY.exists()
    
    async def generate_risk_proof(
        self,
        user_address: str,
        portfolio_features: list[int],
        threshold: int,
        commitment_hash: str | None = None,
        snapshot_hash: str | None = None,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof that risk_score <= threshold.
        
        Returns Garaga-compatible proof calldata.
        """
        # Generate commitment if not provided
        if commitment_hash is None:
            import hashlib
            commitment_hash = "0x" + hashlib.sha256(
                f"{user_address}{threshold}{portfolio_features}".encode()
            ).hexdigest()[:32]
        
        # Compute actual risk score (private - for witness only)
        actual_score = self.model.compute_risk_score(portfolio_features)
        
        # Check if compliant before generating proof
        is_compliant = actual_score <= threshold
        
        if not self.circuits_ready:
            raise RuntimeError(
                "Risk score proof requires built circuits (RiskScore.wasm, RiskScore_final.zkey). "
                "Run: cd circuits && npm run build:riskscore"
            )

        # Generate witness input
        witness_input = self.model.generate_witness_input(
            portfolio_features=portfolio_features,
            threshold=threshold,
            user_address=user_address,
            commitment_hash=commitment_hash
        )
        
        # Generate proof using snarkjs
        proof_data = await self._generate_groth16_proof(witness_input)
        
        # Format for Garaga
        proof_calldata = self._format_for_garaga(proof_data)
        
        return {
            "proof_type": "risk_score",
            "is_compliant": is_compliant,
            "threshold": threshold,
            "commitment_hash": commitment_hash,
            "proof_calldata": proof_calldata,
            "public_signals": proof_data.get("public_signals", [])
        }
    
    async def _generate_groth16_proof(self, witness_input: dict) -> dict[str, Any]:
        """
        Generate Groth16 proof using snarkjs.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "input.json"
            witness_path = Path(tmpdir) / "witness.wtns"
            proof_path = Path(tmpdir) / "proof.json"
            public_path = Path(tmpdir) / "public.json"
            
            # Write input
            with open(input_path, "w") as f:
                json.dump(witness_input, f)
            
            # Generate witness using shell wrapper to isolate environment
            cmd = f'/usr/bin/node {RISK_WITNESS_GEN} {RISK_WASM} {input_path} {witness_path}'
            witness_result = subprocess.run(
                ["/bin/bash", "-c", cmd],
                capture_output=True,
                text=True,
                cwd=str(CIRCUITS_DIR),
                env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": os.environ.get("HOME", "/root")},
                timeout=30,
            )
            if witness_result.returncode != 0:
                raise Exception(f"Witness generation failed: {witness_result.stderr or witness_result.stdout}")
            
            # Generate proof
            subprocess.run([
                "/usr/bin/snarkjs", "groth16", "prove",
                str(RISK_ZKEY),
                str(witness_path),
                str(proof_path),
                str(public_path)
            ], check=True, capture_output=True)
            
            # Read proof
            with open(proof_path) as f:
                proof = json.load(f)
            with open(public_path) as f:
                public_signals = json.load(f)
            
            return {
                "proof": proof,
                "public_signals": public_signals
            }
    
    def _format_for_garaga(self, proof_data: dict) -> list[str]:
        """
        Format Groth16 proof for Garaga verifier.
        Converts proof to felt252 array format.
        """
        proof = proof_data["proof"]
        public_signals = proof_data["public_signals"]
        
        # Garaga expects: [pi_a, pi_b, pi_c, public_inputs...]
        # pi_a: 2 field elements
        # pi_b: 2x2 field elements (flattened)
        # pi_c: 2 field elements
        
        calldata = []
        
        # pi_a (2 elements)
        calldata.extend(proof["pi_a"][:2])
        
        # pi_b (2x2 elements, row-major)
        calldata.extend(proof["pi_b"][0][:2])
        calldata.extend(proof["pi_b"][1][:2])
        
        # pi_c (2 elements)
        calldata.extend(proof["pi_c"][:2])
        
        # Public signals
        calldata.extend(public_signals)
        
        return calldata


# Singleton instance
_risk_service: ZkmlRiskService | None = None


def get_risk_service() -> ZkmlRiskService:
    """Get or create the risk service singleton."""
    global _risk_service
    if _risk_service is None:
        _risk_service = ZkmlRiskService()
    return _risk_service
