"""
Garaga proof formatter using the `garaga` npm package (v1.0.1).
Generates full_proof_with_hints format required by Garaga verifier.

Replaces the previous Docker-based approach which was fragile due to VK file
sync issues.  The npm package runs the pairing check in WASM and produces
~2000 felt252 calldata entries that the on-chain Garaga verifier expects.
"""
import json
import logging
import subprocess
import tempfile
from pathlib import Path

_log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits"
GARAGA_SCRIPT = CIRCUITS_DIR / "garaga_calldata.mjs"


def format_proof_for_garaga(
    proof_json: dict,
    public_json: list,
    vk_path: Path,
) -> list[str]:
    """
    Format Groth16 proof with MSM hints for Garaga verifier.

    Uses the garaga npm package via a Node.js subprocess.  The script
    ``circuits/garaga_calldata.mjs`` converts snarkjs proof/public/vk JSON
    into the calldata array that ``verify_groth16_proof_bn254`` expects.

    Args:
        proof_json: snarkjs proof.json content
        public_json: snarkjs public.json content
        vk_path: Path to verification_key.json

    Returns:
        List of felt252 hex strings ready for Garaga verification
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Write proof and public inputs to temp files
        proof_file = tmp_path / "proof.json"
        public_file = tmp_path / "public.json"

        with open(proof_file, "w") as f:
            json.dump(proof_json, f)
        with open(public_file, "w") as f:
            json.dump(public_json, f)

        env = {
            "PATH": "/usr/bin:/usr/local/bin:/bin",
            "HOME": "/root",
            "NODE_PATH": str(CIRCUITS_DIR / "node_modules"),
        }
        result = subprocess.run(
            ["/usr/bin/node", str(GARAGA_SCRIPT), str(proof_file), str(public_file), str(vk_path)],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(CIRCUITS_DIR),
            env=env,
        )

        if result.returncode != 0:
            msg = result.stderr.strip() or result.stdout.strip()
            raise Exception(f"Garaga formatting failed: {msg}")

        # garaga_calldata.mjs outputs a JSON array of decimal strings
        content = result.stdout.strip()
        try:
            decimals = json.loads(content)
            if not isinstance(decimals, list) or len(decimals) < 3:
                raise ValueError(f"Unexpected calldata length: {len(decimals) if isinstance(decimals, list) else type(decimals)}")
            # garaga calldata (CLI + npm) includes a leading length. Drop it for Span<felt252>.
            if decimals:
                first = int(decimals[0])
                if first == len(decimals) - 1:
                    decimals = decimals[1:]
            _log.info(f"Garaga npm calldata: {len(decimals)} elements")
            return [hex(int(v)) for v in decimals]
        except json.JSONDecodeError as e:
            raise Exception(f"Failed to parse garaga output: {e}\nContent: {content[:200]}")
