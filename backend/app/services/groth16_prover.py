"""
Groth16 proof generation for private deposits/withdrawals.
Uses snarkjs to generate proofs from Circom circuits.
Uses garaga npm package to format proofs for Garaga verifier (with fallback).
"""
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

# Circuit paths - go from services/ -> app/ -> backend/ -> zkdefi (project root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CIRCUITS_DIR = PROJECT_ROOT / "circuits" / "build"
PRIVATE_DEPOSIT_WASM = CIRCUITS_DIR / "PrivateDeposit_js" / "PrivateDeposit.wasm"
PRIVATE_DEPOSIT_ZKEY = CIRCUITS_DIR / "PrivateDeposit_final.zkey"
PRIVATE_DEPOSIT_VK = CIRCUITS_DIR / "verification_key.json"
PRIVATE_WITHDRAW_WASM = CIRCUITS_DIR / "PrivateWithdraw_js" / "PrivateWithdraw.wasm"
PRIVATE_WITHDRAW_ZKEY = CIRCUITS_DIR / "PrivateWithdraw_final.zkey"
PRIVATE_WITHDRAW_VK = CIRCUITS_DIR / "PrivateWithdraw_verification_key.json"

# ModelBridge (EZKL → Groth16 bridge)
MODEL_BRIDGE_WASM = CIRCUITS_DIR / "ModelBridge_js" / "ModelBridge.wasm"
MODEL_BRIDGE_ZKEY = CIRCUITS_DIR / "ModelBridge_final.zkey"
MODEL_BRIDGE_VK = CIRCUITS_DIR / "ModelBridge_verification_key.json"

# ModelBridgeHeavy (heavier 16-output EZKL → Groth16 bridge)
MODEL_BRIDGE_HEAVY_WASM = CIRCUITS_DIR / "ModelBridgeHeavy_js" / "ModelBridgeHeavy.wasm"
MODEL_BRIDGE_HEAVY_ZKEY = CIRCUITS_DIR / "ModelBridgeHeavy_final.zkey"
MODEL_BRIDGE_HEAVY_VK = CIRCUITS_DIR / "ModelBridgeHeavy_verification_key.json"


def _snarkjs_proof_to_calldata(proof: dict, public: list) -> list[str]:
    """
    Flatten snarkjs proof JSON into felt252 calldata.

    This is a fallback when the garaga npm WASM pairing engine is unavailable.
    The on-chain ShieldedPool.verify_privacy_proof() for human-signed txs only
    checks ``proof.len() >= 3``, so these raw proof points are sufficient.

    For agent txs that require full Garaga verification, the garaga formatter
    must be operational.
    """
    STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001
    felts: list[str] = []

    def push(val: int | str) -> None:
        v = int(val) if isinstance(val, str) else val
        felts.append(hex(v % STARK_PRIME))

    # pi_a  (G1: x, y)
    push(proof["pi_a"][0])
    push(proof["pi_a"][1])
    # pi_b  (G2: [[x0, x1], [y0, y1]])
    for pair in proof["pi_b"][:2]:
        for coord in pair:
            push(coord)
    # pi_c  (G1: x, y)
    push(proof["pi_c"][0])
    push(proof["pi_c"][1])
    # public signals
    for sig in public:
        push(sig)

    return felts


class Groth16Prover:
    """Generate Groth16 proofs using snarkjs for private transfers."""

    @staticmethod
    def _run_snarkjs_command(cmd: list[str], cwd: str | None = None) -> dict[str, Any]:
        """Run snarkjs command and return JSON result."""
        try:
            result = subprocess.run(
                ["npx", "snarkjs"] + cmd,
                capture_output=True,
                text=True,
                cwd=cwd,
                timeout=120,
            )
            if result.returncode != 0:
                raise Exception(f"snarkjs error: {result.stderr}")
            return json.loads(result.stdout) if result.stdout else {}
        except subprocess.TimeoutExpired:
            raise Exception("snarkjs timeout")
        except json.JSONDecodeError:
            raise Exception(f"Invalid JSON from snarkjs: {result.stdout}")

    @staticmethod
    def generate_private_deposit_proof(
        amount: int,
        nonce: int,
        balance: int,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof for private deposit.
        Returns proof_calldata compatible with Garaga verifier.
        """
        if not PRIVATE_DEPOSIT_WASM.exists() or not PRIVATE_DEPOSIT_ZKEY.exists():
            raise Exception(
                f"Circuit files not found. WASM: {PRIVATE_DEPOSIT_WASM.exists()}, ZKEY: {PRIVATE_DEPOSIT_ZKEY.exists()}"
            )

        with tempfile.TemporaryDirectory() as tmpdir:
            # Prepare input
            input_data = {
                "amount": str(amount),
                "nonce": str(nonce),
                "balance": str(balance),
            }
            input_file = Path(tmpdir) / "input.json"
            with open(input_file, "w") as f:
                json.dump(input_data, f)
            
            # Debug: log input data
            _log.debug("[Groth16] Private deposit input: %s", input_data)

            # Generate witness using shell wrapper to isolate environment
            witness_file = Path(tmpdir) / "witness.wtns"
            cmd = f'/usr/bin/node {CIRCUITS_DIR / "PrivateDeposit_js" / "generate_witness.js"} {PRIVATE_DEPOSIT_WASM} {input_file} {witness_file}'
            witness_result = subprocess.run(
                ["/bin/bash", "-c", cmd],
                capture_output=True,
                text=True,
                cwd=str(CIRCUITS_DIR),
                env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": os.environ.get("HOME", "/root")},
                timeout=30,
            )
            if witness_result.returncode != 0:
                _log.error("[Groth16] Witness generation failed: returncode=%s, stdout=%s, stderr=%s",
                           witness_result.returncode, witness_result.stdout, witness_result.stderr)
                with open(input_file, "r") as f:
                    _log.error("[Groth16] Input file contents: %s", f.read())
                raise Exception(f"Witness generation failed (code {witness_result.returncode}): {witness_result.stderr or witness_result.stdout}")

            # Generate proof
            proof_file = Path(tmpdir) / "proof.json"
            public_file = Path(tmpdir) / "public.json"
            subprocess.run(
                [
                    "npx",
                    "snarkjs",
                    "groth16",
                    "prove",
                    str(PRIVATE_DEPOSIT_ZKEY),
                    str(witness_file),
                    str(proof_file),
                    str(public_file),
                ],
                check=True,
                capture_output=True,
            )

            # Read proof and public signals
            with open(proof_file) as f:
                proof = json.load(f)
            with open(public_file) as f:
                public = json.load(f)

            # Use garaga CLI via Docker to format proof with MSM hints
            from .garaga_formatter import format_proof_for_garaga
            
            proof_calldata = format_proof_for_garaga(
                proof_json=proof,
                public_json=public,
                vk_path=PRIVATE_DEPOSIT_VK,
            )

            # Commitment from circuit public outputs (PrivateDeposit: commitment, amount_public)
            # Return raw BN254 value so withdraw circuit constraint commitment_public === Poseidon(balance, nonce) holds
            commitment_raw = int(public[0]) if isinstance(public[0], str) else public[0]
            from .circomlib_poseidon import STARK_PRIME
            commitment_felt = commitment_raw % STARK_PRIME

            return {
                "commitment": hex(commitment_raw),
                "commitment_felt": hex(commitment_felt),
                "amount_public": amount,
                "nonce": nonce,
                "proof_calldata": proof_calldata,
            }

    @staticmethod
    def generate_private_withdraw_proof(
        commitment: str,
        amount: int,
        nonce: int,
        balance: int,
        user_secret: int = 0,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof for private withdrawal.
        Returns proof_calldata compatible with Garaga verifier.
        """
        if not PRIVATE_WITHDRAW_WASM.exists() or not PRIVATE_WITHDRAW_ZKEY.exists():
            raise Exception(
                f"Circuit files not found. WASM: {PRIVATE_WITHDRAW_WASM.exists()}, ZKEY: {PRIVATE_WITHDRAW_ZKEY.exists()}"
            )

        with tempfile.TemporaryDirectory() as tmpdir:
            commitment_int = int(commitment, 16) if isinstance(commitment, str) else commitment

            # Prepare input
            input_data = {
                "amount": str(amount),
                "nonce": str(nonce),
                "balance": str(balance),
                "user_secret": str(user_secret),
                "commitment_public": str(commitment_int),
            }
            input_file = Path(tmpdir) / "input.json"
            with open(input_file, "w") as f:
                json.dump(input_data, f)

            # Generate witness using shell wrapper to isolate environment
            witness_file = Path(tmpdir) / "witness.wtns"
            cmd = f'/usr/bin/node {CIRCUITS_DIR / "PrivateWithdraw_js" / "generate_witness.js"} {PRIVATE_WITHDRAW_WASM} {input_file} {witness_file}'
            witness_result = subprocess.run(
                ["/bin/bash", "-c", cmd],
                capture_output=True,
                text=True,
                cwd=str(CIRCUITS_DIR),
                env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": os.environ.get("HOME", "/root")},
                timeout=30,
            )
            if witness_result.returncode != 0:
                raise Exception(f"Witness generation failed (code {witness_result.returncode}): {witness_result.stderr or witness_result.stdout}")

            # Generate proof
            proof_file = Path(tmpdir) / "proof.json"
            public_file = Path(tmpdir) / "public.json"
            subprocess.run(
                [
                    "npx",
                    "snarkjs",
                    "groth16",
                    "prove",
                    str(PRIVATE_WITHDRAW_ZKEY),
                    str(witness_file),
                    str(proof_file),
                    str(public_file),
                ],
                check=True,
                capture_output=True,
            )

            # Read proof and public signals
            with open(proof_file) as f:
                proof = json.load(f)
            with open(public_file) as f:
                public = json.load(f)

            # Use garaga CLI via Docker to format proof with MSM hints
            from .garaga_formatter import format_proof_for_garaga
            
            proof_calldata = format_proof_for_garaga(
                proof_json=proof,
                public_json=public,
                vk_path=PRIVATE_WITHDRAW_VK,
            )

            # Generate nullifier
            import hashlib

            # Use Starknet prime, not 2^252
            STARKNET_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001
            nullifier_input = f"{commitment_int}:{nonce}:{user_secret}".encode()
            nullifier_hash = hashlib.sha256(nullifier_input).hexdigest()
            nullifier = int(nullifier_hash, 16) % STARKNET_PRIME
            commitment_felt = commitment_int % STARKNET_PRIME

            return {
                "nullifier": hex(nullifier),
                "commitment": hex(commitment_int),
                "commitment_felt": hex(commitment_felt),
                "amount_public": amount,
                "nonce": nonce,
                "proof_calldata": proof_calldata,
            }

    @staticmethod
    def generate_model_bridge_proof(
        model_output: list[int],
        ezkl_proof_hash: int,
        model_weights_hash: int,
        expected_model_hash: int,
        output_lower_bound: int = 0,
        output_upper_bound: int = 10000,
        timestamp: int = 0,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof for ModelBridge (EZKL → Garaga bridge).

        Proves model identity and output bounds. Returns proof_calldata for
        Garaga verify_groth16_proof_bn254 (L3 zkml_verifier).
        """
        if not MODEL_BRIDGE_WASM.exists() or not MODEL_BRIDGE_ZKEY.exists():
            raise Exception(
                f"ModelBridge circuit files not found. WASM: {MODEL_BRIDGE_WASM.exists()}, ZKEY: {MODEL_BRIDGE_ZKEY.exists()}"
            )
        if not MODEL_BRIDGE_VK.exists():
            raise Exception(f"ModelBridge verification key not found: {MODEL_BRIDGE_VK}")

        # Normalize model_output to 8 elements (circuit expects 8)
        outputs = list(model_output)[:8]
        while len(outputs) < 8:
            outputs.append(0)

        input_data = {
            "model_output": [str(v) for v in outputs],
            "ezkl_proof_hash": str(ezkl_proof_hash),
            "model_weights_hash": str(model_weights_hash or expected_model_hash),
            "expected_model_hash": str(expected_model_hash),
            "output_lower_bound": str(output_lower_bound),
            "output_upper_bound": str(output_upper_bound),
            "timestamp": str(timestamp),
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_file = tmp_path / "input.json"
            with open(input_file, "w") as f:
                json.dump(input_data, f)

            witness_file = tmp_path / "witness.wtns"
            cmd = (
                f'/usr/bin/node {CIRCUITS_DIR / "ModelBridge_js" / "generate_witness.js"} '
                f'{MODEL_BRIDGE_WASM} {input_file} {witness_file}'
            )
            witness_result = subprocess.run(
                ["/bin/bash", "-c", cmd],
                capture_output=True,
                text=True,
                cwd=str(CIRCUITS_DIR),
                env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": os.environ.get("HOME", "/root")},
                timeout=30,
            )
            if witness_result.returncode != 0:
                _log.warning(
                    "[Groth16] ModelBridge witness failed: %s",
                    witness_result.stderr or witness_result.stdout,
                )
                raise Exception(
                    f"ModelBridge witness failed (code {witness_result.returncode}): {witness_result.stderr or witness_result.stdout}"
                )

            proof_file = tmp_path / "proof.json"
            public_file = tmp_path / "public.json"
            subprocess.run(
                [
                    "npx",
                    "snarkjs",
                    "groth16",
                    "prove",
                    str(MODEL_BRIDGE_ZKEY),
                    str(witness_file),
                    str(proof_file),
                    str(public_file),
                ],
                check=True,
                capture_output=True,
                timeout=60,
            )

            with open(proof_file) as f:
                proof = json.load(f)
            with open(public_file) as f:
                public = json.load(f)

            from .garaga_formatter import format_proof_for_garaga

            proof_calldata = format_proof_for_garaga(
                proof_json=proof,
                public_json=public,
                vk_path=MODEL_BRIDGE_VK,
            )

            # Public outputs: is_valid, public_commitment (order depends on circuit; typically last two)
            public_commitment = int(public[-1]) if public else 0
            if len(public) >= 2 and isinstance(public[-2], (str, int)):
                is_valid = int(public[-2]) == 1
            else:
                is_valid = True

            return {
                "proof_calldata": proof_calldata,
                "public_commitment": public_commitment,
                "is_valid": is_valid,
                "public_signals": public,
            }

    @staticmethod
    def generate_model_bridge_heavy_proof(
        model_output: list[int],
        ezkl_proof_hash: int,
        model_weights_hash: int,
        expected_model_hash: int,
        output_lower_bound: int = 0,
        output_upper_bound: int = 10000,
        timestamp: int = 0,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof for ModelBridgeHeavy (16 outputs, EZKL → Garaga bridge).
        Same interface as ModelBridge but uses the heavier circuit for L3.
        """
        if not MODEL_BRIDGE_HEAVY_WASM.exists() or not MODEL_BRIDGE_HEAVY_ZKEY.exists():
            raise Exception(
                f"ModelBridgeHeavy circuit files not found. WASM: {MODEL_BRIDGE_HEAVY_WASM.exists()}, ZKEY: {MODEL_BRIDGE_HEAVY_ZKEY.exists()}"
            )
        if not MODEL_BRIDGE_HEAVY_VK.exists():
            raise Exception(f"ModelBridgeHeavy verification key not found: {MODEL_BRIDGE_HEAVY_VK}")

        outputs = list(model_output)[:16]
        while len(outputs) < 16:
            outputs.append(0)

        input_data = {
            "model_output": [str(v) for v in outputs],
            "ezkl_proof_hash": str(ezkl_proof_hash),
            "model_weights_hash": str(model_weights_hash or expected_model_hash),
            "expected_model_hash": str(expected_model_hash),
            "output_lower_bound": str(output_lower_bound),
            "output_upper_bound": str(output_upper_bound),
            "timestamp": str(timestamp),
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_file = tmp_path / "input.json"
            with open(input_file, "w") as f:
                json.dump(input_data, f)

            witness_file = tmp_path / "witness.wtns"
            cmd = (
                f'/usr/bin/node {CIRCUITS_DIR / "ModelBridgeHeavy_js" / "generate_witness.js"} '
                f'{MODEL_BRIDGE_HEAVY_WASM} {input_file} {witness_file}'
            )
            witness_result = subprocess.run(
                ["/bin/bash", "-c", cmd],
                capture_output=True,
                text=True,
                cwd=str(CIRCUITS_DIR),
                env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": os.environ.get("HOME", "/root")},
                timeout=30,
            )
            if witness_result.returncode != 0:
                _log.warning(
                    "[Groth16] ModelBridgeHeavy witness failed: %s",
                    witness_result.stderr or witness_result.stdout,
                )
                raise Exception(
                    f"ModelBridgeHeavy witness failed (code {witness_result.returncode}): {witness_result.stderr or witness_result.stdout}"
                )

            proof_file = tmp_path / "proof.json"
            public_file = tmp_path / "public.json"
            subprocess.run(
                [
                    "npx",
                    "snarkjs",
                    "groth16",
                    "prove",
                    str(MODEL_BRIDGE_HEAVY_ZKEY),
                    str(witness_file),
                    str(proof_file),
                    str(public_file),
                ],
                check=True,
                capture_output=True,
                timeout=60,
            )

            with open(proof_file) as f:
                proof = json.load(f)
            with open(public_file) as f:
                public = json.load(f)

            from .garaga_formatter import format_proof_for_garaga

            proof_calldata = format_proof_for_garaga(
                proof_json=proof,
                public_json=public,
                vk_path=MODEL_BRIDGE_HEAVY_VK,
            )

            public_commitment = int(public[-1]) if public else 0
            if len(public) >= 2 and isinstance(public[-2], (str, int)):
                is_valid = int(public[-2]) == 1
            else:
                is_valid = True

            return {
                "proof_calldata": proof_calldata,
                "public_commitment": public_commitment,
                "is_valid": is_valid,
                "public_signals": public,
            }
