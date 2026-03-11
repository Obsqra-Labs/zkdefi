#!/usr/bin/env python3
"""
Deploy L1EzklBridgeSender (Sepolia).

The sender contract calls EZKL verifier `verifyProof(...)`, then forwards
`on_l1_message` payload to Starknet core `sendMessageToL2(...)`.

Signer sources (in priority order):
1) L1_SEPOLIA_PRIVATE_KEY
2) L1_SEPOLIA_MNEMONIC
3) L1_SEPOLIA_KEYSTORE_PATH + L1_SEPOLIA_KEYSTORE_PASSWORD
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ARTIFACT = REPO_ROOT / "contracts" / "l1_ezkl" / "out" / "L1EzklBridgeSender.sol" / "L1EzklBridgeSender.json"
DEFAULT_OUTFILE = REPO_ROOT / ".l1_ezkl_bridge_sender.deployed"
DEFAULT_STARKNET_CORE_SEPOLIA = "0xE2Bb56ee93665bF7d7B6E0fFB92E2045d53C5aA0"
DEFAULT_RECEIVER_SELECTOR = "0x035b18ea40fc0fe052a663bca34b1c66f25e888f6d54d0c518b9c68f451c65ea"


def _to_int(value: str) -> int:
    value = value.strip()
    if value.startswith(("0x", "0X")):
        return int(value, 16)
    return int(value)


def _load_account():
    from eth_account import Account

    private_key = (os.getenv("L1_SEPOLIA_PRIVATE_KEY") or "").strip()
    if private_key:
        return Account.from_key(private_key)

    mnemonic = (os.getenv("L1_SEPOLIA_MNEMONIC") or "").strip()
    if mnemonic:
        Account.enable_unaudited_hdwallet_features()
        return Account.from_mnemonic(mnemonic)

    password = (os.getenv("L1_SEPOLIA_KEYSTORE_PASSWORD") or "").strip()
    keystore_path_raw = (os.getenv("L1_SEPOLIA_KEYSTORE_PATH") or "").strip()
    if not keystore_path_raw:
        keystore_path_raw = str(REPO_ROOT / "backend" / ".l1-sepolia-keystore.json")
    keystore_path = Path(keystore_path_raw).expanduser().resolve()
    if keystore_path.exists() and password:
        raw = json.loads(keystore_path.read_text())
        key = Account.decrypt(raw, password)
        return Account.from_key(key)

    raise RuntimeError(
        "No L1 signer configured. Set L1_SEPOLIA_PRIVATE_KEY or L1_SEPOLIA_MNEMONIC or "
        "(L1_SEPOLIA_KEYSTORE_PATH + L1_SEPOLIA_KEYSTORE_PASSWORD)."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy L1EzklBridgeSender to Ethereum Sepolia")
    parser.add_argument("--artifact", default=str(DEFAULT_ARTIFACT), help="Foundry artifact JSON path")
    parser.add_argument("--rpc", default=(os.getenv("L1_SEPOLIA_RPC") or "").strip(), help="Sepolia RPC URL")
    parser.add_argument("--verifier", required=True, help="Deployed EZKL verifier address (L1)")
    parser.add_argument(
        "--starknet-core",
        default=DEFAULT_STARKNET_CORE_SEPOLIA,
        help=f"Starknet core L1 contract (default: {DEFAULT_STARKNET_CORE_SEPOLIA})",
    )
    parser.add_argument("--receiver", required=True, help="Starknet receiver contract address (felt hex)")
    parser.add_argument(
        "--selector",
        default=DEFAULT_RECEIVER_SELECTOR,
        help=f"L1 handler selector for receiver (default: {DEFAULT_RECEIVER_SELECTOR})",
    )
    parser.add_argument("--gas-limit", type=int, default=900000, help="Legacy gas limit")
    parser.add_argument("--out", default=str(DEFAULT_OUTFILE), help="Output deployment marker file")
    args = parser.parse_args()

    if not args.rpc:
        print("Set --rpc or L1_SEPOLIA_RPC.", file=sys.stderr)
        return 1

    artifact_path = Path(args.artifact).expanduser().resolve()
    if not artifact_path.exists():
        print(f"Artifact not found: {artifact_path}", file=sys.stderr)
        return 1

    try:
        from web3 import Web3
    except Exception as exc:  # pragma: no cover
        print(f"web3 is required: {exc}", file=sys.stderr)
        return 1

    account = _load_account()
    w3 = Web3(Web3.HTTPProvider(args.rpc))
    if not w3.is_connected():
        print(f"Failed to connect to RPC: {args.rpc}", file=sys.stderr)
        return 1

    artifact = json.loads(artifact_path.read_text())
    abi = artifact.get("abi") or []
    bytecode_obj = (artifact.get("bytecode") or {}).get("object") if isinstance(artifact.get("bytecode"), dict) else ""
    bytecode = bytecode_obj or artifact.get("bytecode") or ""
    if not bytecode:
        print("Artifact missing bytecode.", file=sys.stderr)
        return 1
    if bytecode.startswith("0x"):
        bytecode = bytecode[2:]

    contract = w3.eth.contract(abi=abi, bytecode=bytes.fromhex(bytecode))
    constructor_args = (
        Web3.to_checksum_address(args.verifier),
        Web3.to_checksum_address(args.starknet_core),
        _to_int(args.receiver),
        _to_int(args.selector),
    )

    nonce = w3.eth.get_transaction_count(account.address, "pending")
    gas_price = int(w3.eth.gas_price)
    chain_id = int(w3.eth.chain_id)
    tx = contract.constructor(*constructor_args).build_transaction(
        {
            "from": account.address,
            "nonce": nonce,
            "gas": int(args.gas_limit),
            "gasPrice": gas_price,
            "chainId": chain_id,
            "value": 0,
        }
    )

    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    deployed = receipt.get("contractAddress")
    if not deployed:
        print(f"Deploy failed; tx={tx_hash}", file=sys.stderr)
        return 1

    out_path = Path(args.out).expanduser().resolve()
    out_path.write_text(
        "\n".join(
            [
                f"L1_EZKL_BRIDGE_SENDER_ADDRESS={deployed}",
                f"L1_EZKL_BRIDGE_SENDER_TX={tx_hash}",
                f"L1_EZKL_VERIFIER_ADDRESS={args.verifier}",
                f"STARKNET_CORE_SEPOLIA_ADDRESS={args.starknet_core}",
                f"L1_BRIDGE_RECEIVER_ADDRESS={args.receiver}",
                f"L1_BRIDGE_RECEIVER_SELECTOR={args.selector}",
                f"DEPLOYER_ADDRESS={account.address}",
            ]
        )
        + "\n"
    )

    print(f"Sender deployed: {deployed}")
    print(f"Tx hash: {tx_hash}")
    print(f"Saved: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
