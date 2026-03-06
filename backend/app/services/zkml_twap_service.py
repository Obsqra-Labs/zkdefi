"""
zkML TWAP Position Service - Privacy-preserving TWAP proof generation.
"""
import json
import subprocess
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"
TWAP_WASM = CIRCUITS_DIR / "TWAPPosition_js" / "TWAPPosition.wasm"
TWAP_ZKEY = CIRCUITS_DIR / "TWAPPosition_final.zkey"
TWAP_WITNESS_GEN = CIRCUITS_DIR / "TWAPPosition_js" / "generate_witness.js"

N_DAYS = 7


class TWAPModel:
    SCALE = 100
    
    @classmethod
    def compute_twap(cls, daily_positions):
        if len(daily_positions) != N_DAYS:
            raise ValueError(f"Expected {N_DAYS} positions")
        return sum(daily_positions) // N_DAYS
    
    @classmethod
    def generate_witness_input(cls, daily_positions, threshold, user_address, commitment_hash, scale=100):
        actual_twap = cls.compute_twap(daily_positions)
        return {
            "daily_positions": [str(p) for p in daily_positions],
            "actual_twap": str(actual_twap),
            "threshold": str(threshold),
            "scale": str(scale),
            "user_address": user_address,
            "commitment_hash": commitment_hash
        }


class ZkmlTWAPService:
    def __init__(self):
        self.model = TWAPModel()
        self.circuits_ready = self._check_circuits()
    
    def _check_circuits(self):
        return TWAP_WASM.exists() and TWAP_ZKEY.exists()
    
    async def generate_twap_proof(self, user_address, daily_positions, threshold, commitment_hash=None):
        while len(daily_positions) < N_DAYS:
            daily_positions.append(0)
        
        if commitment_hash is None:
            import hashlib
            commitment_hash = "0x" + hashlib.sha256(f"{user_address}{threshold}{daily_positions}".encode()).hexdigest()[:32]
        
        actual_twap = self.model.compute_twap(daily_positions)
        is_compliant = actual_twap <= threshold
        
        if not self.circuits_ready:
            raise RuntimeError("TWAP proof requires built circuits")
        
        witness_input = self.model.generate_witness_input(daily_positions, threshold, user_address, commitment_hash)
        proof_data = await self._generate_groth16_proof(witness_input)
        proof_calldata = self._format_for_garaga(proof_data)
        
        return {
            "proof_type": "twap_position",
            "is_compliant": is_compliant,
            "actual_twap": actual_twap,
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
            
            subprocess.run(["node", str(TWAP_WITNESS_GEN), str(TWAP_WASM), str(input_path), str(witness_path)], check=True, capture_output=True)
            subprocess.run(["snarkjs", "groth16", "prove", str(TWAP_ZKEY), str(witness_path), str(proof_path), str(public_path)], check=True, capture_output=True)
            
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
    
    def analyze_twap(self, daily_positions):
        actual_twap = self.model.compute_twap(daily_positions)
        variance = sum((p - actual_twap) ** 2 for p in daily_positions) / N_DAYS
        pattern = "volatile" if variance > actual_twap * 0.5 else "stable"
        return {"twap": actual_twap, "variance": variance, "pattern": pattern}


_twap_service = None

def get_twap_service():
    global _twap_service
    if _twap_service is None:
        _twap_service = ZkmlTWAPService()
    return _twap_service
