#!/usr/bin/env python3
"""Deploy Garaga deposit verifier via starknet_py (same RPC as e2e; avoids starkli l1_data_gas issue)."""
import asyncio
import json
import os
from pathlib import Path

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract
from starknet_py.net.udc_deployer.deployer import Deployer

SCRIPT_DIR = Path(__file__).resolve().parent
CONTRACTS_DIR = SCRIPT_DIR / "src" / "garaga_verifier" / "target" / "dev"
CONTRACT_JSON = CONTRACTS_DIR / "garaga_verifier_Groth16VerifierBN254.contract_class.json"
CASM_JSON = CONTRACTS_DIR / "garaga_verifier_Groth16VerifierBN254.compiled_contract_class.json"
ACCOUNT_JSON = SCRIPT_DIR / "starkli_config" / "account.json"
KEY_FILE = SCRIPT_DIR / "starkli_config" / "private_key.txt"

# PublicNode RPC (confirmed working with starknet_py). Same Sepolia so e2e sees contract.
RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia-rpc.publicnode.com")


def main():
    if not CONTRACT_JSON.exists():
        print(f"Build verifier first: cd {SCRIPT_DIR}/src/garaga_verifier && scarb build")
        raise SystemExit(1)
    if not ACCOUNT_JSON.exists():
        print("Missing starkli_config/account.json")
        raise SystemExit(1)

    with open(ACCOUNT_JSON) as f:
        acc = json.load(f)
    address = int(acc["deployment"]["address"], 16)
    # Prefer server deployer key (~/.starkli-wallets/deployer_key.txt), then parent repo, then local
    deployer_key = Path("/root/.starkli-wallets/deployer_key.txt")
    parent_accounts = SCRIPT_DIR.parent.parent / "contracts" / "accounts.json"
    if deployer_key.exists():
        pk_hex = deployer_key.read_text().strip()
    elif parent_accounts.exists():
        with open(parent_accounts) as f:
            accounts = json.load(f)
        pk_hex = accounts.get("sepolia", {}).get("deployer", {}).get("private_key", "")
    else:
        pk_hex = ""
    if not pk_hex and KEY_FILE.exists():
        pk_hex = KEY_FILE.read_text().strip()
    if not pk_hex:
        print("Missing private key (starkli_config/private_key.txt or ../contracts/accounts.json)")
        raise SystemExit(1)
    if pk_hex.startswith("0x"):
        pk_hex = pk_hex[2:]
    private_key = int(pk_hex, 16)

    asyncio.run(deploy(address, private_key))


async def deploy(account_address: int, private_key: int):
    print("Garaga deposit verifier deploy (starknet_py, same RPC as e2e)")
    print(f"RPC: {RPC_URL}")

    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=account_address,
        client=client,
        key_pair=KeyPair.from_private_key(private_key),
        chain=StarknetChainId.SEPOLIA,
    )

    contract_class_str = CONTRACT_JSON.read_text()
    compiled_casm_str = CASM_JSON.read_text()

    print("Declaring...")
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=contract_class_str,
            compiled_contract_casm=compiled_casm_str,
            auto_estimate=True,
        )
        await declare_result.wait_for_acceptance()
        class_hash = declare_result.class_hash
        print(f"Class hash: {hex(class_hash)}")
    except Exception as e:
        err = str(e).lower()
        if "already declared" in err or "class_already_declared" in err:
            # Extract class hash from error or use computed
            class_hash = 0x008a61b74df97fce26292e29342196c3f8cb214272f73e36d78f63c71b6c845a
            print(f"Already declared, using: {hex(class_hash)}")
        else:
            raise

    print("Deploying...")
    deployer = Deployer()
    deploy_call, deploy_address = deployer.create_deployment_call(class_hash=class_hash, constructor_args=[])
    print(f"Will be deployed at: {hex(deploy_address)}")

    resp = await account.execute_v3(calls=deploy_call, max_fee=int(1e17))
    await account.client.wait_for_tx(resp.transaction_hash)
    addr_hex = hex(deploy_address)

    print(f"Deployed: {addr_hex}")
    print(f"Set GARAGA_VERIFIER_ADDRESS={addr_hex}")
    print(f"E2E: GARAGA_VERIFIER_ADDRESS={addr_hex} BACKEND_URL=http://localhost:8003 ./run_tests.sh --garaga-onchain-only")


if __name__ == "__main__":
    main()
