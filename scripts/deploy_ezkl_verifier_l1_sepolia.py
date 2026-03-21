#!/usr/bin/env python3
"""
Deploy the EZKL Solidity verifier (or any contract) to Ethereum Sepolia using the L1 keystore.

Prerequisites:
  1. Create keystore: L1_SEPOLIA_MNEMONIC="..." L1_SEPOLIA_KEYSTORE_PASSWORD=... python scripts/l1_sepolia_keystore_from_mnemonic.py
  2. Set L1_SEPOLIA_RPC (Sepolia RPC URL) and L1_SEPOLIA_KEYSTORE_PASSWORD in env.
  3. Build the Solidity verifier (e.g. Foundry/Hardhat) and pass the artifact path.

Usage:
  L1_SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com \\
  L1_SEPOLIA_KEYSTORE_PASSWORD=secret \\
  python scripts/deploy_ezkl_verifier_l1_sepolia.py --artifact path/to/EZKLVerifier.json

Optional:
  --constructor-args  JSON array of constructor arguments (default: [])
  --keystore          Path to keystore (default: backend/.l1-sepolia-keystore.json)

Output:
  Prints deployed contract address. Set L1_EZKL_VERIFIER_ADDRESS in backend env to this value.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KEYSTORE = REPO_ROOT / "backend" / ".l1-sepolia-keystore.json"


def load_keystore_account(keystore_path: Path, password: str):
    from eth_account import Account
    raw = json.loads(keystore_path.read_text())
    key = Account.decrypt(raw, password)
    return Account.from_key(key)


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy EZKL verifier to L1 Sepolia using keystore")
    parser.add_argument("--artifact", required=True, help="Path to contract artifact JSON (bytecode + abi)")
    parser.add_argument("--constructor-args", default="[]", help="JSON array of constructor args")
    parser.add_argument("--keystore", type=Path, default=DEFAULT_KEYSTORE, help="Path to L1 keystore JSON")
    args = parser.parse_args()

    rpc = (os.getenv("L1_SEPOLIA_RPC") or "").strip()
    password = (os.getenv("L1_SEPOLIA_KEYSTORE_PASSWORD") or "").strip()

    if not rpc:
        print("Set L1_SEPOLIA_RPC (Sepolia RPC URL).", file=sys.stderr)
        return 1
    if not password:
        print("Set L1_SEPOLIA_KEYSTORE_PASSWORD.", file=sys.stderr)
        return 1
    if not args.keystore.exists():
        print(f"Keystore not found: {args.keystore}. Run l1_sepolia_keystore_from_mnemonic.py first.", file=sys.stderr)
        return 1

    artifact_path = Path(args.artifact)
    if not artifact_path.exists():
        print(f"Artifact not found: {artifact_path}", file=sys.stderr)
        return 1

    try:
        from web3 import Web3
    except ImportError:
        print("web3 required: pip install web3", file=sys.stderr)
        return 1

    artifact = json.loads(artifact_path.read_text())
    data = artifact.get("data") or {}
    raw_bc = artifact.get("bytecode") or artifact.get("deployedBytecode") or data.get("bytecode")
    if isinstance(raw_bc, dict):
        bytecode = raw_bc.get("object") or ""
    else:
        bytecode = raw_bc or ""
    if not bytecode or not isinstance(bytecode, str):
        print("Artifact must contain 'bytecode' or 'deployedBytecode' (or .object).", file=sys.stderr)
        return 1
    while bytecode.startswith("0x"):
        bytecode = bytecode[2:]
    bytecode = bytes.fromhex(bytecode)
    abi = artifact.get("abi") or artifact.get("data", {}).get("abi") or []

    account = load_keystore_account(args.keystore, password)
    w3 = Web3(Web3.HTTPProvider(rpc))
    if not w3.is_connected():
        print("Failed to connect to L1_SEPOLIA_RPC.", file=sys.stderr)
        return 1

    try:
        constructor_args = json.loads(args.constructor_args)
    except json.JSONDecodeError as e:
        print(f"Invalid --constructor-args JSON: {e}", file=sys.stderr)
        return 1

    contract = w3.eth.contract(bytecode=bytecode, abi=abi)
    tx = contract.constructor(*constructor_args).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 6_000_000,
        "chainId": 11155111,  # Sepolia
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    if not receipt.get("contractAddress"):
        print("Deploy failed: no contract address in receipt.", file=sys.stderr)
        return 1

    print(receipt["contractAddress"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
