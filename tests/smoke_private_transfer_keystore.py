#!/usr/bin/env python3
"""
Smoke test: private deposit and withdraw using backend API and keystore account.
Uses the same flow as the frontend: call backend for proof, then sign and submit with our key.
Run with backend up: BACKEND_URL=http://localhost:8003 python tests/smoke_private_transfer_keystore.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.client_models import Call

# Paths
ZKDEFI = Path(__file__).resolve().parent.parent
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8003")
STARKNET_RPC = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia-rpc.publicnode.com")

# Keystore: prefer deployer_key.txt, then deployer keystore
DEPLOYER_KEY_TXT = Path("/root/.starkli-wallets/deployer_key.txt")
KEYSTORE_JSON = Path("/root/.starkli-wallets/deployer/keystore.json")
ACCOUNT_JSON = Path("/root/.starkli-wallets/deployer/account.json")
STARKLI_ACCOUNT = ZKDEFI / "contracts" / "starkli_config" / "account.json"
STARKLI_KEY = ZKDEFI / "contracts" / "starkli_config" / "private_key.txt"
KEYSTORE_PASSWORD = os.getenv("STARKNET_KEYSTORE_PASSWORD")  # Required for keystore; set in env, do not commit

# Contracts (Starknet Sepolia)
CONFIDENTIAL_TRANSFER = "0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4"
ETH_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"


def load_account_and_key():
    """Load account address and KeyPair from keystore or private_key.txt."""
    # Account address
    for p in (ACCOUNT_JSON, STARKLI_ACCOUNT):
        if p.exists():
            with open(p) as f:
                acc = json.load(f)
            addr = acc.get("deployment", {}).get("address")
            if addr:
                address = int(addr, 16)
                break
    else:
        raise SystemExit("No account.json found (deployer or starkli_config)")

    # Private key: prefer deployer keystore (matches deployer account.json), then deployer_key.txt, then starkli
    if KEYSTORE_JSON.exists() and ACCOUNT_JSON.exists():
        if not KEYSTORE_PASSWORD:
            raise SystemExit("Set STARKNET_KEYSTORE_PASSWORD in env to use keystore (do not commit passwords)")
        try:
            key_pair = KeyPair.from_keystore(str(KEYSTORE_JSON), KEYSTORE_PASSWORD)
            return address, key_pair
        except Exception as e:
            print(f"  Keystore load failed: {e}, trying other key sources")
    if DEPLOYER_KEY_TXT.exists():
        pk_hex = DEPLOYER_KEY_TXT.read_text().strip()
    elif STARKLI_KEY.exists():
        pk_hex = STARKLI_KEY.read_text().strip()
    else:
        raise SystemExit("No private key (deployer/keystore.json, deployer_key.txt, or starkli_config/private_key.txt)")
    if pk_hex.startswith("0x"):
        pk_hex = pk_hex[2:]
    key_pair = KeyPair.from_private_key(int(pk_hex, 16))
    return address, key_pair


async def main():
    print("Smoke: Private Transfer (backend + keystore)")
    print(f"  Backend: {BACKEND_URL}")
    print(f"  RPC:     {STARKNET_RPC}")
    print()

    # Load account
    try:
        account_address, key_pair = load_account_and_key()
        user_address_hex = hex(account_address)
        print(f"  Account: {user_address_hex}")
    except SystemExit as e:
        print(f"  Error: {e}")
        sys.exit(1)

    # 1) Health check
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{BACKEND_URL.replace('/api/v1/zkdefi', '')}/health")
        if r.status_code != 200:
            print(f"  Backend health failed: {r.status_code}")
            sys.exit(1)
    print("  Backend: OK")

    amount_wei = 1000000000000000  # 0.001 ETH for smoke
    amount_wei_str = str(amount_wei)

    # 2) Private deposit proof
    async with httpx.AsyncClient(timeout=60) as client:
        dep = await client.post(
            f"{BACKEND_URL}/api/v1/zkdefi/private_deposit",
            json={"user_address": user_address_hex, "amount": amount_wei},
        )
    if dep.status_code != 200:
        print(f"  private_deposit API failed: {dep.status_code} {dep.text[:300]}")
        sys.exit(1)
    dep_data = dep.json()
    commitment = dep_data.get("commitment")
    commitment_felt = dep_data.get("commitment_felt") or commitment
    nonce = dep_data.get("nonce")
    amount_public = int(dep_data.get("amount_public", amount_wei))
    proof_calldata = dep_data.get("proof_calldata") or []
    if not commitment or not proof_calldata:
        print("  private_deposit missing commitment or proof_calldata")
        sys.exit(1)
    print(f"  private_deposit proof: commitment_felt={commitment_felt[:20]}... nonce={nonce}")

    # 3) Submit private_deposit tx
    client = FullNodeClient(node_url=STARKNET_RPC)
    account = Account(
        address=account_address,
        client=client,
        key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA,
    )
    amount_low = amount_public % (2**128)
    amount_high = amount_public // (2**128)
    cf_int = int(commitment_felt, 16) if isinstance(commitment_felt, str) and commitment_felt.startswith("0x") else int(commitment_felt)
    proof_ints = [int(p, 16) if isinstance(p, str) and p.startswith("0x") else int(p) for p in proof_calldata]
    deposit_calldata = [cf_int, amount_low, amount_high, len(proof_ints)] + proof_ints
    approve_call = Call(
        to_addr=int(ETH_TOKEN, 16),
        selector=get_selector_from_name("approve"),
        calldata=[int(CONFIDENTIAL_TRANSFER, 16), amount_low, amount_high],
    )
    deposit_call = Call(
        to_addr=int(CONFIDENTIAL_TRANSFER, 16),
        selector=get_selector_from_name("private_deposit"),
        calldata=deposit_calldata,
    )
    exec_dep = await account.execute_v1(calls=[approve_call, deposit_call], auto_estimate=True)
    print(f"  Deposit tx: {hex(exec_dep.transaction_hash)}")

    # 4) Private withdraw proof (same commitment, nonce)
    async with httpx.AsyncClient(timeout=60) as client:
        wd = await client.post(
            f"{BACKEND_URL}/api/v1/zkdefi/private_withdraw",
            json={
                "user_address": user_address_hex,
                "commitment": commitment if isinstance(commitment, str) else hex(commitment),
                "amount": amount_public,
                "nonce": nonce,
            },
        )
    if wd.status_code != 200:
        print(f"  private_withdraw API failed: {wd.status_code} {wd.text[:300]}")
        sys.exit(1)
    wd_data = wd.json()
    nullifier = wd_data.get("nullifier")
    wd_commitment_felt = wd_data.get("commitment_felt") or wd_data.get("commitment")
    wd_proof = wd_data.get("proof_calldata") or []
    if not nullifier or not wd_proof:
        print("  private_withdraw missing nullifier or proof_calldata")
        sys.exit(1)
    print(f"  private_withdraw proof: nullifier={str(nullifier)[:20]}... commitment_felt in response: {('commitment_felt' in wd_data)}")

    # 5) Submit private_withdraw tx
    nullifier_int = int(nullifier, 16) if isinstance(nullifier, str) else nullifier
    wd_commitment_int = int(wd_commitment_felt, 16) if isinstance(wd_commitment_felt, str) and wd_commitment_felt.startswith("0x") else int(wd_commitment_felt)
    wd_amount_low = amount_public % (2**128)
    wd_amount_high = amount_public // (2**128)
    withdraw_calldata = [
        nullifier_int,
        wd_commitment_int,
        wd_amount_low,
        wd_amount_high,
        len(wd_proof),
        *[int(p, 16) if isinstance(p, str) and p.startswith("0x") else int(p) for p in wd_proof],
        account_address,
    ]
    withdraw_call = Call(
        to_addr=int(CONFIDENTIAL_TRANSFER, 16),
        selector=get_selector_from_name("private_withdraw"),
        calldata=withdraw_calldata,
    )
    exec_wd = await account.execute_v1(calls=[withdraw_call], auto_estimate=True)
    print(f"  Withdraw tx: {hex(exec_wd.transaction_hash)}")

    print()
    print("  Smoke OK: private_deposit and private_withdraw submitted with keystore account.")


if __name__ == "__main__":
    asyncio.run(main())
