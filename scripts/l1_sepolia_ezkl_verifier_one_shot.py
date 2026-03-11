#!/usr/bin/env python3
"""
Phase 3 one-shot: create L1 keystore (if needed), generate EZKL Solidity verifier, try compile, deploy to Sepolia.

Run from repo root. Requires: L1_SEPOLIA_MNEMONIC, L1_SEPOLIA_KEYSTORE_PASSWORD, L1_SEPOLIA_RPC.
Optional: EZKL_MODEL_NAME (default: creditworthiness), EZKL_ARTIFACT_DIR (default: backend/app/data/ezkl_models).

Steps:
  1. Create backend/.l1-sepolia-keystore.json from mnemonic if missing.
  2. Generate contracts/l1_ezkl/EZKLVerifier.sol + ABI using ezkl.create_evm_verifier (creditworthiness vk/settings/srs).
  3. Try to compile with Foundry (forge build in contracts/l1_ezkl). If "stack too deep", print instructions.
  4. If artifact exists (out/ or EZKLVerifier_artifact.json), deploy with deploy_ezkl_verifier_l1_sepolia.py and print address.
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


async def _await_future(fut):
    return await fut


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
    """Generate EZKLVerifier.sol and ABI via ezkl Python API."""
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
        result = asyncio.run(_await_future(result))
    if not result:
        return False
    print(f"Generated {sol_out} and {abi_out}")
    return True


def try_compile() -> bool:
    """Run forge build; if success, write EZKLVerifier_artifact.json from out/."""
    if not (L1_EZKL_DIR / "foundry.toml").exists():
        return False
    r = subprocess.run(
        ["forge", "build", "--contracts", str(L1_EZKL_DIR)],
        cwd=str(L1_EZKL_DIR),
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print("Forge build failed (EZKL Halo2 verifier often hits 'stack too deep').")
        print("Compile manually with: cd contracts/l1_ezkl && forge build (via_ir=true in foundry.toml).")
        print("Or use Remix with optimizer + via-ir, then save bytecode+abi as EZKLVerifier_artifact.json.")
        print(r.stderr or r.stdout)
        return False
    # Forge writes out/EZKLVerifier.sol/Halo2Verifier.json
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
