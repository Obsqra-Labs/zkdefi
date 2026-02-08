"""
zkML Anomaly Detection Service

Privacy-preserving anomaly detection proof generation.
Proves anomaly_flag == 0 (safe) WITHOUT revealing analysis details.

Uses Groth16 (snarkjs) → Garaga-compatible proof format.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any


# Circuit paths
# Circuit paths - go from services/ -> app/ -> backend/ -> zkdefi (project root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"
ANOMALY_WASM = CIRCUITS_DIR / "AnomalyDetector_js" / "AnomalyDetector.wasm"
ANOMALY_ZKEY = CIRCUITS_DIR / "AnomalyDetector_final.zkey"
ANOMALY_WITNESS_GEN = CIRCUITS_DIR / "AnomalyDetector_js" / "generate_witness.js"


class AnomalyDetectionModel:
    """
    Anomaly detection model for pool/protocol safety.
    Can be replaced with actual ML model (ONNX, scikit-learn).
    """
    
    # Default factor weights
    DEFAULT_WEIGHTS = [
        20,   # tvl_volatility weight
        15,   # liquidity_concentration weight
        25,   # price_impact_score weight
        10,   # deployer_age_days weight (inverted - older = safer)
        20,   # volume_anomaly weight
        10,   # contract_risk_score weight
    ]
    
    # Default thresholds (per factor)
    DEFAULT_THRESHOLDS = [
        500,   # tvl_volatility max (scaled 0-1000)
        70,    # liquidity_concentration max (%)
        300,   # price_impact_score max (scaled 0-1000)
        30,    # deployer_age_days min (inverted check)
        400,   # volume_anomaly max (scaled 0-1000)
        50,    # contract_risk_score max (0-100)
    ]
    
    # Max total anomaly score (sum of weighted penalties)
    DEFAULT_MAX_ANOMALY_SCORE = 30
    
    @classmethod
    def analyze_pool(
        cls,
        tvl_volatility: int,
        liquidity_concentration: int,
        price_impact_score: int,
        deployer_age_days: int,
        volume_anomaly: int,
        contract_risk_score: int,
        weights: list[int] | None = None,
        thresholds: list[int] | None = None,
        max_anomaly_score: int = 30
    ) -> tuple[bool, int]:
        """
        Analyze pool for anomalies.
        Returns (is_safe, anomaly_score).
        """
        if weights is None:
            weights = cls.DEFAULT_WEIGHTS
        if thresholds is None:
            thresholds = cls.DEFAULT_THRESHOLDS
        
        risk_factors = [
            tvl_volatility,
            liquidity_concentration,
            price_impact_score,
            deployer_age_days,
            volume_anomaly,
            contract_risk_score
        ]
        
        total_penalty = 0
        for factor, threshold, weight in zip(risk_factors, thresholds, weights):
            # Circuit uses: penalty if factor >= threshold
            if factor >= threshold:
                total_penalty += weight
        
        is_safe = total_penalty < max_anomaly_score
        return is_safe, total_penalty
    
    @classmethod
    def generate_witness_input(
        cls,
        tvl_volatility: int,
        liquidity_concentration: int,
        price_impact_score: int,
        deployer_age_days: int,
        volume_anomaly: int,
        contract_risk_score: int,
        pool_id: str,
        user_address: str,
        commitment_hash: str,
        weights: list[int] | None = None,
        thresholds: list[int] | None = None,
        max_anomaly_score: int = 30
    ) -> dict[str, Any]:
        """
        Generate witness input for the AnomalyDetector circuit.
        """
        if weights is None:
            weights = cls.DEFAULT_WEIGHTS
        if thresholds is None:
            thresholds = cls.DEFAULT_THRESHOLDS
        
        import hashlib
        
        # Convert string identifiers to numeric values for circuit
        pool_id_num = int(hashlib.sha256(pool_id.encode()).hexdigest()[:16], 16)
        user_addr_num = int(user_address, 16) if user_address.startswith("0x") else int(hashlib.sha256(user_address.encode()).hexdigest()[:16], 16)
        commitment_num = int(commitment_hash, 16) if commitment_hash.startswith("0x") else int(hashlib.sha256(commitment_hash.encode()).hexdigest()[:16], 16)
        
        return {
            "tvl_volatility": str(tvl_volatility),
            "liquidity_concentration": str(liquidity_concentration),
            "price_impact_score": str(price_impact_score),
            "deployer_age_days": str(deployer_age_days),
            "volume_anomaly": str(volume_anomaly),
            "contract_risk_score": str(contract_risk_score),
            "factor_weights": [str(w) for w in weights],
            "factor_thresholds": [str(t) for t in thresholds],
            "max_anomaly_score": str(max_anomaly_score),
            "pool_id": str(pool_id_num),
            "user_address": str(user_addr_num),
            "commitment_hash": str(commitment_num)
        }


class ZkmlAnomalyService:
    """
    Service for generating privacy-preserving anomaly detection proofs.
    """
    
    def __init__(self):
        self.model = AnomalyDetectionModel()
        self.circuits_ready = self._check_circuits()
    
    def _check_circuits(self) -> bool:
        """Check if circuits are compiled."""
        return ANOMALY_WASM.exists() and ANOMALY_ZKEY.exists()
    
    async def analyze_pool_safety(
        self,
        pool_id: str,
        user_address: str,
        tvl_volatility: int | None = None,
        liquidity_concentration: int | None = None,
        price_impact_score: int | None = None,
        deployer_age_days: int | None = None,
        volume_anomaly: int | None = None,
        contract_risk_score: int | None = None,
        commitment_hash: str | None = None
    ) -> dict[str, Any]:
        """
        Analyze pool safety and generate proof.
        
        If pool data not provided, fetches from on-chain sources.
        Returns Garaga-compatible proof calldata.
        """
        # Fetch pool data if not provided
        pool_data = await self._fetch_pool_data(
            pool_id=pool_id,
            tvl_volatility=tvl_volatility,
            liquidity_concentration=liquidity_concentration,
            price_impact_score=price_impact_score,
            deployer_age_days=deployer_age_days,
            volume_anomaly=volume_anomaly,
            contract_risk_score=contract_risk_score
        )
        
        # Generate commitment if not provided
        if commitment_hash is None:
            import hashlib
            commitment_hash = "0x" + hashlib.sha256(
                f"{pool_id}{user_address}{pool_data}".encode()
            ).hexdigest()[:32]
        
        # Analyze pool
        is_safe, anomaly_score = self.model.analyze_pool(**pool_data)
        
        if not self.circuits_ready:
            raise RuntimeError(
                "Anomaly detection proof requires built circuits (AnomalyDetector.wasm, AnomalyDetector_final.zkey). "
                "Run: cd circuits && npm run build:anomalydetector"
            )
        
        # Generate witness input
        witness_input = self.model.generate_witness_input(
            **pool_data,
            pool_id=pool_id,
            user_address=user_address,
            commitment_hash=commitment_hash
        )
        
        # Generate proof using snarkjs
        proof_data = await self._generate_groth16_proof(witness_input)
        
        # Format for Garaga
        proof_calldata = self._format_for_garaga(proof_data)
        
        return {
            "proof_type": "anomaly_detection",
            "pool_id": pool_id,
            "is_safe": is_safe,
            "anomaly_flag": 0 if is_safe else 1,
            "commitment_hash": commitment_hash,
            "proof_calldata": proof_calldata,
            "public_signals": proof_data.get("public_signals", [])
        }
    
    async def _fetch_pool_data(
        self,
        pool_id: str,
        tvl_volatility: int | None = None,
        liquidity_concentration: int | None = None,
        price_impact_score: int | None = None,
        deployer_age_days: int | None = None,
        volume_anomaly: int | None = None,
        contract_risk_score: int | None = None
    ) -> dict[str, int]:
        """
        Fetch pool data from on-chain sources.
        For now, returns defaults or provided values.
        """
        # TODO: Integrate with Ekubo/JediSwap APIs for real data
        return {
            "tvl_volatility": tvl_volatility if tvl_volatility is not None else 200,
            "liquidity_concentration": liquidity_concentration if liquidity_concentration is not None else 40,
            "price_impact_score": price_impact_score if price_impact_score is not None else 150,
            "deployer_age_days": deployer_age_days if deployer_age_days is not None else 365,
            "volume_anomaly": volume_anomaly if volume_anomaly is not None else 100,
            "contract_risk_score": contract_risk_score if contract_risk_score is not None else 20
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
            cmd = f'/usr/bin/node {ANOMALY_WITNESS_GEN} {ANOMALY_WASM} {input_path} {witness_path}'
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
                "npx", "snarkjs", "groth16", "prove",
                str(ANOMALY_ZKEY),
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
        """
        proof = proof_data["proof"]
        public_signals = proof_data["public_signals"]
        
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
_anomaly_service: ZkmlAnomalyService | None = None


def get_anomaly_service() -> ZkmlAnomalyService:
    """Get or create the anomaly service singleton."""
    global _anomaly_service
    if _anomaly_service is None:
        _anomaly_service = ZkmlAnomalyService()
    return _anomaly_service
