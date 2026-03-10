"""
Credit Eligibility Proof Service

Generates Groth16 ZK proofs for credit eligibility using the
CreditEligibility.circom circuit compiled with snarkjs.

The proof demonstrates credit_score >= min AND collateral >= min
without revealing the exact values.
"""
from __future__ import annotations

import json
import logging
import os
import random
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

from app.services.circomlib_poseidon import poseidon_hash_many

CIRCUITS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "circuits"
BUILD_DIR = CIRCUITS_DIR / "build"
WASM_PATH = BUILD_DIR / "CreditEligibility_js" / "CreditEligibility.wasm"
ZKEY_PATH = BUILD_DIR / "CreditEligibility_final.zkey"
VKEY_PATH = BUILD_DIR / "CreditEligibility_verification_key.json"

SNARKJS = "npx"
GARAGA_CALLDATA = CIRCUITS_DIR / "garaga_calldata.mjs"


def _poseidon_hash_inputs(credit_score: int, collateral_wei: int, blinding: int) -> str:
    """
    Compute Poseidon(credit_score, collateral_wei, blinding) using shared worker.
    Returns the hash as a decimal string.
    """
    return str(poseidon_hash_many([int(credit_score), int(collateral_wei), int(blinding)]))


def generate_credit_eligibility_proof(
    credit_score: int,
    collateral_wei: int,
    min_credit_score: int,
    min_collateral: int,
) -> dict[str, Any]:
    """
    Generate a Groth16 proof for credit eligibility.

    Returns:
      - proof: the Groth16 proof object
      - public_signals: [eligible, min_credit_score, min_collateral, commitment_hash]
      - commitment_hash: Poseidon(credit_score, collateral_wei, blinding)
      - calldata: formatted for on-chain verification (Garaga)
    """
    if not WASM_PATH.exists():
        raise FileNotFoundError(
            f"CreditEligibility WASM not found at {WASM_PATH}. "
            "Run: cd circuits && bash build_private_circuits.sh"
        )
    if not ZKEY_PATH.exists():
        raise FileNotFoundError(
            f"CreditEligibility zkey not found at {ZKEY_PATH}. "
            "Run: cd circuits && bash build_private_circuits.sh"
        )

    blinding = random.randint(1, 2**128 - 1)

    commitment_hash = _poseidon_hash_inputs(credit_score, collateral_wei, blinding)

    input_data = {
        "credit_score": str(credit_score),
        "collateral_wei": str(collateral_wei),
        "blinding": str(blinding),
        "min_credit_score": str(min_credit_score),
        "min_collateral": str(min_collateral),
        "commitment_hash": commitment_hash,
    }

    input_path = BUILD_DIR / "credit_eligibility_input.json"
    proof_path = BUILD_DIR / "credit_eligibility_proof.json"
    public_path = BUILD_DIR / "credit_eligibility_public.json"

    input_path.write_text(json.dumps(input_data), encoding="utf-8")

    result = subprocess.run(
        [
            SNARKJS, "snarkjs", "groth16", "fullprove",
            str(input_path),
            str(WASM_PATH),
            str(ZKEY_PATH),
            str(proof_path),
            str(public_path),
        ],
        capture_output=True,
        text=True,
        cwd=str(CIRCUITS_DIR),
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(f"Proof generation failed: {result.stderr}")

    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    public_signals = json.loads(public_path.read_text(encoding="utf-8"))

    calldata = None
    if GARAGA_CALLDATA.exists():
        try:
            cd_result = subprocess.run(
                [
                    "node", str(GARAGA_CALLDATA),
                    str(proof_path),
                    str(public_path),
                ],
                capture_output=True,
                text=True,
                cwd=str(CIRCUITS_DIR),
                timeout=30,
            )
            if cd_result.returncode == 0:
                calldata = json.loads(cd_result.stdout.strip())
        except Exception as e:
            logger.warning("Garaga calldata formatting skipped: %s", e)

    verify_result = subprocess.run(
        [
            SNARKJS, "snarkjs", "groth16", "verify",
            str(VKEY_PATH),
            str(public_path),
            str(proof_path),
        ],
        capture_output=True,
        text=True,
        cwd=str(CIRCUITS_DIR),
        timeout=30,
    )
    verified = verify_result.returncode == 0 and "OK" in verify_result.stdout

    return {
        "proof": proof,
        "public_signals": public_signals,
        "commitment_hash": commitment_hash,
        "verified": verified,
        "calldata": calldata,
        "circuit": "CreditEligibility",
        "inputs": {
            "min_credit_score": min_credit_score,
            "min_collateral": min_collateral,
        },
    }


def verify_credit_eligibility_proof(
    proof_path: str,
    public_path: str,
) -> bool:
    """Verify a CreditEligibility proof offline."""
    result = subprocess.run(
        [
            SNARKJS, "snarkjs", "groth16", "verify",
            str(VKEY_PATH),
            public_path,
            proof_path,
        ],
        capture_output=True,
        text=True,
        cwd=str(CIRCUITS_DIR),
        timeout=30,
    )
    return result.returncode == 0 and "OK" in result.stdout
