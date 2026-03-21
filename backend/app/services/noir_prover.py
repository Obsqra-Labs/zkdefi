"""
Noir EZKL-bridge proof generation for Garaga HONK verification.

Requires nargo, bb (Barretenberg), garaga CLI. Used when bridge_circuit is NoirEzklBridge.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_ZKDEFI_ROOT = Path(__file__).resolve().parent.parent.parent.parent
NOIR_PKG = _ZKDEFI_ROOT / "circuits" / "noir_ezkl_bridge"
NOIR_PKG_V2 = _ZKDEFI_ROOT / "circuits" / "noir_ezkl_bridge_v2"
BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617


def _has_nargo() -> bool:
    try:
        subprocess.run(["nargo", "--version"], capture_output=True, check=True, timeout=5)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _has_bb() -> bool:
    try:
        subprocess.run(["bb", "--version"], capture_output=True, check=True, timeout=5)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _has_garaga() -> bool:
    try:
        subprocess.run(["garaga", "--help"], capture_output=True, check=True, timeout=5)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _generate_noir_proof_once(*, package_path: Path, package_slug: str, prover_toml_body: str) -> dict:
    """
    Generate Noir proof and Garaga HONK calldata for a Noir bridge package.
    Returns {"proof_calldata": list[int], "public_inputs": list, "success": True}.
    Raises RuntimeError if nargo/bb/garaga or Noir package missing.
    """
    if not _has_nargo():
        raise RuntimeError("Noir prover requires nargo on PATH (noirup)")
    if not _has_bb():
        raise RuntimeError("Noir HONK requires bb on PATH (bbup)")
    if not _has_garaga():
        raise RuntimeError("Noir HONK calldata requires garaga CLI (pip install garaga==1.0.1)")
    if not package_path.is_dir():
        raise RuntimeError(f"Noir package not found: {package_path}")

    with tempfile.TemporaryDirectory(prefix=f"{package_slug}_") as tmpdir:
        pkg_dir = Path(tmpdir) / package_slug
        shutil.copytree(
            package_path,
            pkg_dir,
            ignore=shutil.ignore_patterns("target", "proof_calldata.txt", "Prover.toml"),
        )
        target_dir = pkg_dir / "target"
        prover_toml = pkg_dir / "Prover.toml"
        prover_toml.write_text(prover_toml_body, encoding="utf-8")
        cwd = str(pkg_dir)
        env = os.environ.copy()

        r = subprocess.run(["nargo", "compile"], cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(f"nargo compile failed: {r.stderr or r.stdout}")

        compiled_jsons = [p for p in (target_dir.glob("*.json") if target_dir.exists() else []) if "package_data" not in p.name]
        if not compiled_jsons:
            raise RuntimeError("nargo compile did not produce circuit JSON in target/")
        circuit_json = str(compiled_jsons[0])

        r = subprocess.run(["nargo", "execute", "witness"], cwd=cwd, env=env, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise RuntimeError(f"nargo execute witness failed: {r.stderr or r.stdout}")
        witness_path = target_dir / "witness.gz"
        if not witness_path.exists():
            raise RuntimeError("nargo execute witness did not produce target/witness.gz")

        vk_dir = target_dir / "vk"
        vk_path = vk_dir / "vk"
        r = subprocess.run(
            ["bb", "write_vk", "-s", "ultra_honk", "--oracle_hash", "keccak", "-b", circuit_json, "-o", str(vk_dir)],
            cwd=cwd, env=env, capture_output=True, text=True, timeout=60,
        )
        if r.returncode != 0:
            raise RuntimeError(f"bb write_vk failed: {r.stderr or r.stdout}")
        if not vk_path.exists():
            raise RuntimeError("bb write_vk did not produce target/vk/vk")

        r = subprocess.run(
            ["bb", "prove", "-s", "ultra_honk", "--oracle_hash", "keccak", "-b", circuit_json, "-w", str(witness_path), "-o", str(target_dir)],
            cwd=cwd, env=env, capture_output=True, text=True, timeout=300,
        )
        if r.returncode != 0:
            raise RuntimeError(f"bb prove failed: {r.stderr or r.stdout}")
        proof_path = target_dir / "proof"
        public_inputs_path = target_dir / "public_inputs"
        if not proof_path.exists() or not public_inputs_path.exists():
            raise RuntimeError("bb prove did not produce target/proof and target/public_inputs")

        r = subprocess.run(
            [
                "garaga",
                "calldata",
                "--system",
                "ultra_keccak_zk_honk",
                "--proof",
                str(proof_path),
                "--vk",
                str(vk_path),
                "--public-inputs",
                str(public_inputs_path),
                "--format",
                "starkli",
            ],
            cwd=cwd, env=env, capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            raise RuntimeError(f"garaga calldata failed: {r.stderr or r.stdout}")

        calldata_int: list[int] = []
        for tok in re.findall(r"0x[0-9a-fA-F]+|\d+", r.stdout or ""):
            try:
                calldata_int.append(int(tok, 16) if tok.startswith("0x") else int(tok))
            except ValueError:
                continue
        if not calldata_int:
            stdout_sample = (r.stdout or "")[:240]
            raise RuntimeError(f"garaga calldata produced no felts (stdout={stdout_sample!r})")

        return {"proof_calldata": calldata_int, "public_inputs": [], "success": True}


def _generate_noir_ezkl_bridge_proof_once(
    expected_model_hash: int,
    output_lower_bound: int,
    output_upper_bound: int,
    model_output: int,
) -> dict:
    """
    Generate Noir proof and Garaga HONK calldata for noir_ezkl_bridge circuit.
    Returns {"proof_calldata": list[int], "public_inputs": list, "success": True}.
    """
    expected_model_hash_felt = int(expected_model_hash) % BN254_SCALAR_FIELD
    output_lower_bound_u128 = max(0, int(output_lower_bound))
    output_upper_bound_u128 = max(0, int(output_upper_bound))
    model_output_u128 = max(0, int(model_output))
    prover_toml_body = (
        f'expected_model_hash = "{expected_model_hash_felt}"\n'
        f'output_lower_bound = "{output_lower_bound_u128}"\n'
        f'output_upper_bound = "{output_upper_bound_u128}"\n'
        f'model_output = "{model_output_u128}"\n'
    )
    return _generate_noir_proof_once(
        package_path=NOIR_PKG,
        package_slug="noir_ezkl_bridge",
        prover_toml_body=prover_toml_body,
    )


def generate_noir_ezkl_bridge_proof(
    expected_model_hash: int,
    output_lower_bound: int,
    output_upper_bound: int,
    model_output: int,
) -> dict:
    """
    Generate Noir proof and Garaga HONK calldata for noir_ezkl_bridge circuit.

    The Noir/bb/garaga toolchain occasionally flakes under load even when the
    very next attempt succeeds. Retry a small number of times before surfacing
    a fallback to the bridge pipeline.
    """
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            return _generate_noir_ezkl_bridge_proof_once(
                expected_model_hash=expected_model_hash,
                output_lower_bound=output_lower_bound,
                output_upper_bound=output_upper_bound,
                model_output=model_output,
            )
        except Exception as exc:
            last_error = exc
            if attempt >= 3:
                break
            logger.warning(
                "NoirEzklBridge attempt %s/3 failed, retrying: %s",
                attempt,
                exc,
            )
            time.sleep(0.75 * attempt)
    assert last_error is not None
    raise last_error


def generate_noir_ezkl_bridge_v2_proof(
    *,
    expected_model_hash: int,
    output_lower_bound: int,
    output_upper_bound: int,
    timestamp: int,
    ezkl_proof_hash: int,
    model_output: list[int],
    model_weights_hash: int,
) -> dict:
    """
    Generate Noir proof and Garaga HONK calldata for the versioned Path A v2 package.

    V2 is not wired into the live verifier lane yet. It exists so the stronger
    Path A semantics can be built and tested without breaking the currently
    deployed Noir verifier.
    """
    expected_model_hash_felt = int(expected_model_hash) % BN254_SCALAR_FIELD
    output_lower_bound_u128 = max(0, int(output_lower_bound))
    output_upper_bound_u128 = max(0, int(output_upper_bound))
    timestamp_felt = int(timestamp) % BN254_SCALAR_FIELD
    ezkl_proof_hash_felt = int(ezkl_proof_hash) % BN254_SCALAR_FIELD
    model_weights_hash_felt = int(model_weights_hash) % BN254_SCALAR_FIELD
    outputs = [max(0, int(v)) for v in list(model_output or [])[:8]]
    while len(outputs) < 8:
        outputs.append(0)
    outputs_literal = ", ".join(f'"{value}"' for value in outputs)
    prover_toml_body = (
        f'expected_model_hash = "{expected_model_hash_felt}"\n'
        f'output_lower_bound = "{output_lower_bound_u128}"\n'
        f'output_upper_bound = "{output_upper_bound_u128}"\n'
        f'timestamp = "{timestamp_felt}"\n'
        f'ezkl_proof_hash = "{ezkl_proof_hash_felt}"\n'
        f'model_weights_hash = "{model_weights_hash_felt}"\n'
        f'model_output = [{outputs_literal}]\n'
    )
    return _generate_noir_proof_once(
        package_path=NOIR_PKG_V2,
        package_slug="noir_ezkl_bridge_v2",
        prover_toml_body=prover_toml_body,
    )


def noir_honk_available() -> bool:
    return _has_nargo() and _has_bb() and _has_garaga() and NOIR_PKG.is_dir()


def noir_honk_v2_available() -> bool:
    return _has_nargo() and _has_bb() and _has_garaga() and NOIR_PKG_V2.is_dir()


"""Noir EZKL-bridge prover."""
