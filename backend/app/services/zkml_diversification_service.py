"""
zkML Safety Diversification Service

Privacy-preserving safety diversification proof generation.
Proves portfolio diversification score >= threshold.
"""
import json
import subprocess
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"
DIVERSIFICATION_WASM = CIRCUITS_DIR / "SafetyDiversification_js" / "SafetyDiversification.wasm"
DIVERSIFICATION_ZKEY = CIRCUITS_DIR / "SafetyDiversification_final.zkey"
DIVERSIFICATION_WITNESS_GEN = CIRCUITS_DIR / "SafetyDiversification_js" / "generate_witness.js"

N_PROTOCOLS = 6

# Default safety scores for known protocols
DEFAULT_SAFETY_SCORES = [85, 90, 80, 75, 70, 50]  # JediSwap, Ekubo, zkLend, Nostra, Haiko, Other

PROTOCOL_INDEX = {
    "jediswap": 0, "JEDISWAP": 0,
    "ekubo": 1, "EKUBO": 1,
    "zklend": 2, "ZKLEND": 2,
    "nostra": 3, "NOSTRA": 3,
    "haiko": 4, "HAIKO": 4,
    "other": 5, "OTHER": 5,
}


class DiversificationModel:
    SCALE = 100
    
    @classmethod
    def compute_diversification_score(cls, allocations, safety_scores=None):
        if safety_scores is None:
            safety_scores = DEFAULT_SAFETY_SCORES
        if len(allocations) != N_PROTOCOLS:
            raise ValueError(f"Expected {N_PROTOCOLS} allocations, got {len(allocations)}")
        
        total_alloc = sum(allocations)
        if total_alloc == 0:
            return 0
        
        # Weighted safety score
        weighted_safety = sum(a * s for a, s in zip(allocations, safety_scores))
        score = weighted_safety // total_alloc
        
        return max(0, min(100, score))
    
    @classmethod
    def portfolio_to_allocations(cls, portfolio):
        allocations = [0] * N_PROTOCOLS
        for protocol, amount in portfolio.items():
            protocol_lower = protocol.lower()
            if protocol_lower in PROTOCOL_INDEX:
                allocations[PROTOCOL_INDEX[protocol_lower]] += int(amount)
            else:
                allocations[5] += int(amount)  # Other
        return allocations
    
    @classmethod
    def generate_witness_input(cls, allocations, threshold, user_address, commitment_hash, safety_scores=None, scale=100):
        if safety_scores is None:
            safety_scores = DEFAULT_SAFETY_SCORES
        actual_score = cls.compute_diversification_score(allocations, safety_scores)
        return {
            "allocations": [str(a) for a in allocations],
            "actual_score": str(actual_score),
            "safety_scores": [str(s) for s in safety_scores],
            "threshold": str(threshold),
            "scale": str(scale),
            "user_address": user_address,
            "commitment_hash": commitment_hash
        }


class ZkmlDiversificationService:
    def __init__(self):
        self.model = DiversificationModel()
        self.circuits_ready = self._check_circuits()
    
    def _check_circuits(self):
        return DIVERSIFICATION_WASM.exists() and DIVERSIFICATION_ZKEY.exists()
    
    async def generate_diversification_proof(self, user_address, portfolio, threshold=60, commitment_hash=None, safety_scores=None):
        if isinstance(portfolio, dict):
            allocations = self.model.portfolio_to_allocations(portfolio)
        else:
            allocations = list(portfolio)
        
        while len(allocations) < N_PROTOCOLS:
            allocations.append(0)
        
        if commitment_hash is None:
            import hashlib
            commitment_hash = "0x" + hashlib.sha256(f"{user_address}{threshold}{allocations}".encode()).hexdigest()[:32]
        
        actual_score = self.model.compute_diversification_score(allocations, safety_scores)
        is_compliant = actual_score >= threshold
        
        if not self.circuits_ready:
            raise RuntimeError("Diversification proof requires built circuits. Run: cd circuits && npm run build:diversification")
        
        witness_input = self.model.generate_witness_input(allocations, threshold, user_address, commitment_hash, safety_scores)
        proof_data = await self._generate_groth16_proof(witness_input)
        proof_calldata = self._format_for_garaga(proof_data)
        
        return {
            "proof_type": "safety_diversification",
            "is_compliant": is_compliant,
            "actual_score": actual_score,
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
            
            subprocess.run(["node", str(DIVERSIFICATION_WITNESS_GEN), str(DIVERSIFICATION_WASM), str(input_path), str(witness_path)], check=True, capture_output=True)
            subprocess.run(["snarkjs", "groth16", "prove", str(DIVERSIFICATION_ZKEY), str(witness_path), str(proof_path), str(public_path)], check=True, capture_output=True)
            
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
    
    def analyze_diversification(self, portfolio):
        allocations = self.model.portfolio_to_allocations(portfolio)
        score = self.model.compute_diversification_score(allocations)
        
        total = sum(allocations)
        if total == 0:
            return {"score": 0, "risk_level": "unknown", "message": "No allocations"}
        
        # Count protocols with meaningful allocation (>5%)
        active_protocols = sum(1 for a in allocations if a > total * 0.05)
        
        if active_protocols >= 3 and score >= 70:
            risk_level = "low"
            message = "Well diversified across safe protocols"
        elif active_protocols >= 2 and score >= 60:
            risk_level = "medium"
            message = "Moderate diversification"
        else:
            risk_level = "high"
            message = "Poor diversification or unsafe protocols"
        
        return {
            "diversification_score": score,
            "risk_level": risk_level,
            "message": message,
            "active_protocols": active_protocols,
            "allocations": allocations,
            "would_pass_threshold_60": score >= 60,
            "would_pass_threshold_70": score >= 70
        }


_diversification_service = None

def get_diversification_service():
    global _diversification_service
    if _diversification_service is None:
        _diversification_service = ZkmlDiversificationService()
    return _diversification_service
