"""
zkML Correlation Risk Service

Privacy-preserving correlation risk proof generation.
Proves portfolio correlation_score <= threshold WITHOUT revealing actual positions.
"""
import json
import subprocess
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"
CORRELATION_WASM = CIRCUITS_DIR / "CorrelationRisk_js" / "CorrelationRisk.wasm"
CORRELATION_ZKEY = CIRCUITS_DIR / "CorrelationRisk_final.zkey"
CORRELATION_WITNESS_GEN = CIRCUITS_DIR / "CorrelationRisk_js" / "generate_witness.js"

N_ASSETS = 5

DEFAULT_CORR_MATRIX = [
    [100, 95, 10, 10, 80],
    [95, 100, 10, 10, 75],
    [10, 10, 100, 95, 5],
    [10, 10, 95, 100, 5],
    [80, 75, 5, 5, 100],
]

ASSET_INDEX = {
    "ETH": 0, "WETH": 0,
    "wstETH": 1, "stETH": 1,
    "USDC": 2, "USDT": 2,
    "DAI": 3,
    "WBTC": 4, "BTC": 4,
}


class CorrelationRiskModel:
    SCALE = 100
    
    @classmethod
    def compute_correlation_score(cls, positions, corr_matrix=None, scale=100):
        if corr_matrix is None:
            corr_matrix = DEFAULT_CORR_MATRIX
        if len(positions) != N_ASSETS:
            raise ValueError(f"Expected {N_ASSETS} positions, got {len(positions)}")
        
        total_weighted = 0
        for i in range(N_ASSETS):
            for j in range(N_ASSETS):
                total_weighted += positions[i] * positions[j] * corr_matrix[i][j]
        
        total_position = sum(positions)
        if total_position == 0:
            return 0
        
        total_pos_squared = total_position * total_position
        correlation = (total_weighted * scale) // (total_pos_squared * scale)
        return max(0, min(scale, correlation))
    
    @classmethod
    def portfolio_to_positions(cls, portfolio):
        positions = [0] * N_ASSETS
        for asset, weight in portfolio.items():
            asset_upper = asset.upper()
            if asset_upper in ASSET_INDEX:
                positions[ASSET_INDEX[asset_upper]] += int(weight)
        return positions
    
    @classmethod
    def generate_witness_input(cls, positions, threshold, user_address, commitment_hash, corr_matrix=None, scale=100):
        if corr_matrix is None:
            corr_matrix = DEFAULT_CORR_MATRIX
        actual_correlation = cls.compute_correlation_score(positions, corr_matrix, scale)
        return {
            "positions": [str(p) for p in positions],
            "corr_matrix": [[str(c) for c in row] for row in corr_matrix],
            "actual_correlation": str(actual_correlation),
            "threshold": str(threshold),
            "scale": str(scale),
            "user_address": user_address,
            "commitment_hash": commitment_hash
        }


class ZkmlCorrelationService:
    def __init__(self):
        self.model = CorrelationRiskModel()
        self.circuits_ready = self._check_circuits()
    
    def _check_circuits(self):
        return CORRELATION_WASM.exists() and CORRELATION_ZKEY.exists()
    
    async def generate_correlation_proof(self, user_address, portfolio, threshold=70, commitment_hash=None, corr_matrix=None):
        if isinstance(portfolio, dict):
            positions = self.model.portfolio_to_positions(portfolio)
        else:
            positions = list(portfolio)
        
        while len(positions) < N_ASSETS:
            positions.append(0)
        
        if commitment_hash is None:
            import hashlib
            commitment_hash = "0x" + hashlib.sha256(f"{user_address}{threshold}{positions}".encode()).hexdigest()[:32]
        
        actual_correlation = self.model.compute_correlation_score(positions, corr_matrix)
        is_compliant = actual_correlation <= threshold
        
        if not self.circuits_ready:
            raise RuntimeError("Correlation risk proof requires built circuits. Run: cd circuits && npm run build:correlation")
        
        witness_input = self.model.generate_witness_input(positions, threshold, user_address, commitment_hash, corr_matrix)
        proof_data = await self._generate_groth16_proof(witness_input)
        proof_calldata = self._format_for_garaga(proof_data)
        
        return {
            "proof_type": "correlation_risk",
            "is_compliant": is_compliant,
            "actual_correlation": actual_correlation,
            "threshold": threshold,
            "commitment_hash": commitment_hash,
            "proof_calldata": proof_calldata,
            "public_signals": proof_data.get("public_signals", [])
        }
    
    async def _generate_groth16_proof(self, witness_input):
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "input.json"
            witness_path = Path(tmpdir) / "witness.wtns"
            proof_path = Path(tmpdir) / "proof.json"
            public_path = Path(tmpdir) / "public.json"
            
            with open(input_path, "w") as f:
                json.dump(witness_input, f)
            
            subprocess.run(["node", str(CORRELATION_WITNESS_GEN), str(CORRELATION_WASM), str(input_path), str(witness_path)], check=True, capture_output=True)
            subprocess.run(["snarkjs", "groth16", "prove", str(CORRELATION_ZKEY), str(witness_path), str(proof_path), str(public_path)], check=True, capture_output=True)
            
            with open(proof_path) as f:
                proof = json.load(f)
            with open(public_path) as f:
                public_signals = json.load(f)
            
            return {"proof": proof, "public_signals": public_signals}
    
    def _format_for_garaga(self, proof_data):
        proof = proof_data["proof"]
        public_signals = proof_data["public_signals"]
        calldata = []
        calldata.extend(proof["pi_a"][:2])
        calldata.extend(proof["pi_b"][0][:2])
        calldata.extend(proof["pi_b"][1][:2])
        calldata.extend(proof["pi_c"][:2])
        calldata.extend(public_signals)
        return calldata
    
    def analyze_portfolio_correlation(self, portfolio):
        positions = self.model.portfolio_to_positions(portfolio)
        correlation = self.model.compute_correlation_score(positions)
        
        if correlation >= 90:
            risk_level, message = "critical", "Extremely high correlation"
        elif correlation >= 70:
            risk_level, message = "high", "High correlation - limited diversification"
        elif correlation >= 50:
            risk_level, message = "medium", "Moderate correlation"
        else:
            risk_level, message = "low", "Good diversification"
        
        return {
            "correlation_score": correlation,
            "risk_level": risk_level,
            "message": message,
            "positions": positions,
            "would_pass_threshold_70": correlation <= 70,
            "would_pass_threshold_50": correlation <= 50
        }


_correlation_service = None

def get_correlation_service():
    global _correlation_service
    if _correlation_service is None:
        _correlation_service = ZkmlCorrelationService()
    return _correlation_service
