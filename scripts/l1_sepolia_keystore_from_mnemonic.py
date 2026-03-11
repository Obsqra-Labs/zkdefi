#!/usr/bin/env python3
"""
Create an Ethereum (L1) Sepolia keystore from a BIP39 mnemonic.

Usage:
  L1_SEPOLIA_MNEMONIC="word1 word2 ..." L1_SEPOLIA_KEYSTORE_PASSWORD=secret python scripts/l1_sepolia_keystore_from_mnemonic.py

Output:
  Writes backend/.l1-sepolia-keystore.json (gitignored). Use this path and
  L1_SEPOLIA_KEYSTORE_PASSWORD for deploy and L1 verify flows.

Never commit the mnemonic or the keystore file. Use only for testnet.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
KEYSTORE_PATH = REPO_ROOT / "backend" / ".l1-sepolia-keystore.json"


def main() -> None:
    mnemonic = (os.getenv("L1_SEPOLIA_MNEMONIC") or "").strip()
    password = (os.getenv("L1_SEPOLIA_KEYSTORE_PASSWORD") or "").strip()

    if not mnemonic:
        print("Set L1_SEPOLIA_MNEMONIC in env (BIP39 mnemonic, 12/24 words). Do not commit.", file=sys.stderr)
        sys.exit(1)
    if not password:
        print("Set L1_SEPOLIA_KEYSTORE_PASSWORD in env to encrypt the keystore. Do not commit.", file=sys.stderr)
        sys.exit(1)

    try:
        from eth_account import Account
    except ImportError:
        print("eth_account required: pip install eth-account", file=sys.stderr)
        sys.exit(1)

    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(mnemonic)
    key_bytes = account.key
    keystore = Account.encrypt(key_bytes, password)

    KEYSTORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    KEYSTORE_PATH.write_text(json.dumps(keystore, indent=2))
    print(f"Keystore written to {KEYSTORE_PATH}")
    print(f"Address (Sepolia deployer): {account.address}")
    print("Use L1_SEPOLIA_KEYSTORE_PASSWORD when deploying or when l1_ezkl_bridge_service signs txs.")


if __name__ == "__main__":
    main()
