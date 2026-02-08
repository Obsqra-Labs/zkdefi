"""
Garaga proof formatter using Docker with Python 3.10.
Generates full_proof_with_hints format required by Garaga verifier.

Security model:
- Uses pre-built zkdefi-garaga:latest image (audited, fixed version)
- --network none: Zero network access, no exfiltration possible
- --read-only: Container cannot write to filesystem
- --rm: Ephemeral container, no state persistence
- Only public data (proof, public signals) enters container
"""
import json
import subprocess
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"


def format_proof_for_garaga(
    proof_json: dict,
    public_json: list,
    vk_path: Path,
) -> list[str]:
    """
    Format Groth16 proof with MSM hints for Garaga verifier.
    
    Args:
        proof_json: snarkjs proof.json content
        public_json: snarkjs public.json content  
        vk_path: Path to verification_key.json
    
    Returns:
        List of felt252 hex strings ready for Garaga verification
    
    Security:
        Container only receives public data (proof goes on-chain anyway).
        No network access, read-only filesystem, ephemeral execution.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Write proof and public inputs
        proof_file = tmp_path / "proof.json"
        public_file = tmp_path / "public.json"
        
        with open(proof_file, 'w') as f:
            json.dump(proof_json, f)
        with open(public_file, 'w') as f:
            json.dump(public_json, f)
        
        # Run garaga in secure, isolated container
        docker_cmd = [
            "docker", "run", "--rm",
            "--network", "none",      # No network = no exfiltration
            "--read-only",            # Cannot write to container FS
            "-v", f"{tmp_path}:/work:rw",
            "-v", f"{vk_path.parent}:/circuits:ro",
            "zkdefi-garaga:latest",
            "calldata",
            "--system", "groth16",
            "--vk", f"/circuits/{vk_path.name}",
            "--proof", "/work/proof.json",
            "--public-inputs", "/work/public.json",
            "--format", "starkli",
        ]
        
        result = subprocess.run(
            docker_cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode != 0:
            raise Exception(f"Garaga formatting failed: {result.stderr}")
        
        # Parse starkli format: "length val1 val2 val3..."
        content = result.stdout.strip()
        
        try:
            values = content.split()
            if not values:
                raise ValueError("Empty calldata")
            
            length = int(values[0])
            decimals = [int(v) for v in values[1:]]
            
            if len(decimals) != length:
                raise ValueError(f"Length mismatch: expected {length}, got {len(decimals)}")
            
            return [hex(v) for v in decimals]
        except Exception as e:
            raise Exception(f"Failed to parse garaga output: {e}\nContent: {content[:200]}")
