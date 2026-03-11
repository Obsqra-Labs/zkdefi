#!/usr/bin/env python3
"""
Phase 3 one-shot: create L1 keystore (if needed), generate EZKL Solidity verifier, try compile, deploy to Sepolia.

Run from repo root. Requires: L1_SEPOLIA_MNEMONIC, L1_SEPOLIA_KEYSTORE_PASSWORD, L1_SEPOLIA_RPC.
Optional: EZKL_MODEL_NAME (default: creditworthiness), EZKL_ARTIFACT_DIR (default: backend/app/data/ezkl_models).

Steps:
  1. Create backend/.l1-sepolia-keystore.json from mnemonic if missing.
  2. Generate contracts/l1_ezkl/EZKLVerifier.sol + ABI using ezkl.create_evm_verifier (creditworthiness vk/settings/srs).
  3. Run contracts/l1_ezkl/build_halo2_verifier.sh (tries default forge build, then via_ir=false + solc 0.8.24 if stack too deep).
  4. If artifact exists at out/EZKLVerifier.sol/Halo2Verifier.json, deploy to Sepolia and print L1_EZKL_VERIFIER_ADDRESS.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
KEYSTORE_PATH = REPO_ROOT / "backend" / ".l1-sepolia-keystore.json"
L1_EZKL_DIR = REPO_ROOT / "contracts" / "l1_ezkl"
ARTIFACT_JSON = L1_EZKL_DIR / "EZKLVerifier_artifact.json"
FORGE_ARTIFACT = L1_EZKL_DIR / "out" / "EZKLVerifier.sol" / "Halo2Verifier.json"


def ensure_keystore() -> bool:
    if KEYSTORE_PATH.exists():
        return True
    mnemonic = (os.getenv("L1_SEPOLIA_MNEMONIC") or "").strip()
    password = (os.getenv("L1_SEPOLIA_KEYSTORE_PASSWORD") or "").strip()
    if not mnemonic or not password:
        print("Set L1_SEPOLIA_MNEMONIC and L1_SEPOLIA_KEYSTORE_PASSWORD to create keystore.", file=sys.stderr)
        return False
    # Run the keystore script
    r = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "l1_sepolia_keystore_from_mnemonic.py")],
        env={**os.environ, "L1_SEPOLIA_MNEMONIC": mnemonic, "L1_SEPOLIA_KEYSTORE_PASSWORD": password},
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print(r.stderr or r.stdout, file=sys.stderr)
        return False
    print(r.stdout)
    return True


def generate_sol() -> bool:
    """Generate EZKLVerifier.sol and ABI via ezkl Python API (runs in event loop)."""
    return asyncio.run(_generate_sol_async())


async def _generate_sol_async() -> bool:
    model_name = os.getenv("EZKL_MODEL_NAME", "creditworthiness")
    base = REPO_ROOT / "backend" / "app" / "data" / "ezkl_models" / model_name
    vk = base / "vk.key"
    settings = base / "settings.json"
    srs = base / "kzg.srs"
    if not vk.exists() or not settings.exists() or not srs.exists():
        print(f"Missing EZKL artifacts for {model_name}: need vk.key, settings.json, kzg.srs", file=sys.stderr)
        return False
    L1_EZKL_DIR.mkdir(parents=True, exist_ok=True)
    sol_out = str(L1_EZKL_DIR / "EZKLVerifier.sol")
    abi_out = str(L1_EZKL_DIR / "EZKLVerifier_abi.json")

    import ezkl
    result = ezkl.create_evm_verifier(
        str(vk), str(settings), sol_out, abi_out,
        srs_path=str(srs), reusable=False,
    )
    if asyncio.isfuture(result):
        result = await result
    if not result:
        return False
    print(f"Generated {sol_out} and {abi_out}")
    return True


def try_compile() -> bool:
    """Run build_halo2_verifier.sh (tries default forge build, then via_ir=false + solc 0.8.24)."""
    build_script = L1_EZKL_DIR / "build_halo2_verifier.sh"
    if not build_script.exists():
        # Fallback: raw forge build
        if not (L1_EZKL_DIR / "foundry.toml").exists():
            return False
        r = subprocess.run(["forge", "build"], cwd=str(L1_EZKL_DIR), capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stderr or r.stdout)
            return False
    else:
        r = subprocess.run(["bash", str(build_script)], cwd=str(REPO_ROOT), capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stderr or r.stdout, file=sys.stderr)
            return False
        print(r.stdout)
    if not FORGE_ARTIFACT.exists():
        return False
    data = json.loads(FORGE_ARTIFACT.read_text())
    bytecode = data.get("bytecode", {}).get("object") or data.get("deployedBytecode", {}).get("object") or ""
    abi = data.get("abi") or []
    if not bytecode:
        return False
    artifact = {"abi": abi, "bytecode": "0x" + bytecode}
    ARTIFACT_JSON.write_text(json.dumps(artifact, indent=2))
    print("Compiled artifact written to", ARTIFACT_JSON)
    return True


def deploy() -> bool:
    """Run deploy_ezkl_verifier_l1_sepolia.py with ARTIFACT_JSON."""
    if not ARTIFACT_JSON.exists():
        print("No artifact at", ARTIFACT_JSON, "- skip deploy.", file=sys.stderr)
        return False
    r = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "deploy_ezkl_verifier_l1_sepolia.py"), "--artifact", str(ARTIFACT_JSON)],
        cwd=str(REPO_ROOT),
        env=os.environ,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print(r.stderr or r.stdout, file=sys.stderr)
        return False
    addr = (r.stdout or "").strip()
    if addr:
        print("Deployed L1 EZKL verifier:", addr)
        print("Set L1_EZKL_VERIFIER_ADDRESS=" + addr)
    return bool(addr)


def main() -> int:
    if not ensure_keystore():
        return 1
    if not generate_sol():
        return 1
    if not try_compile():
        # Continue anyway; user may compile manually and re-run deploy
        if ARTIFACT_JSON.exists():
            deploy()
        return 0
    if not deploy():
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
