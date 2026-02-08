#!/usr/bin/env python3
"""
Deploy updated u256 contracts: MerkleTree and FullyShieldedPool
These contracts now support BN254 Poseidon output (u256 split storage)

Usage:
    cd /opt/obsqra.starknet/zkdefi/contracts
    python deploy_u256_contracts.py
"""
import asyncio
import json
from pathlib import Path

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract
from starknet_py.cairo.felt import encode_shortstring

# Configuration
RPC_URL = "https://starknet-sepolia-rpc.publicnode.com"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

# Load private key
ACCOUNTS_PATH = Path("/opt/obsqra.starknet/contracts/accounts.json")
if ACCOUNTS_PATH.exists():
    with open(ACCOUNTS_PATH) as f:
        accounts = json.load(f)
        PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)
else:
    # Fallback: try to find in zkdefi
    ACCOUNTS_PATH2 = Path("/opt/obsqra.starknet/zkdefi/accounts.json")
    if ACCOUNTS_PATH2.exists():
        with open(ACCOUNTS_PATH2) as f:
            accounts = json.load(f)
            PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)
    else:
        raise FileNotFoundError("No accounts.json found")

ADMIN_ADDRESS = int(ACCOUNT_ADDRESS, 16)

# Existing contract addresses (for reference)
STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
GARAGA_VERIFIER = "0x06f18b9a60dd6ae1d5e4186c12c44fa20e7a59e46bc7b96f57de2a47a87db90b"

# Contract source paths
CONTRACTS_DIR = Path("/opt/obsqra.starknet/zkdefi/contracts")
TARGET_DIR = CONTRACTS_DIR / "target" / "dev"


async def declare_contract(account, contract_name: str) -> int:
    """Declare a contract and return its class hash."""
    print(f"\n=== Declaring {contract_name} ===")
    
    sierra_path = TARGET_DIR / f"zkdefi_contracts_{contract_name}.contract_class.json"
    casm_path = TARGET_DIR / f"zkdefi_contracts_{contract_name}.compiled_contract_class.json"
    
    if not sierra_path.exists():
        raise FileNotFoundError(f"Sierra file not found: {sierra_path}")
    if not casm_path.exists():
        raise FileNotFoundError(f"CASM file not found: {casm_path}")
    
    with open(sierra_path) as f:
        sierra = json.load(f)
    with open(casm_path) as f:
        casm = json.load(f)
    
    # Check if already declared
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=sierra,
            compiled_class_hash=None,  # Will be computed
        )
        await declare_result.wait_for_acceptance()
        class_hash = declare_result.class_hash
        print(f"Declared class hash: {hex(class_hash)}")
        return class_hash
    except Exception as e:
        if "already declared" in str(e).lower() or "StarknetErrorCode.CLASS_ALREADY_DECLARED" in str(e):
            # Extract class hash from compiled contract
            from starknet_py.hash.class_hash import compute_class_hash
            class_hash = compute_class_hash(sierra)
            print(f"Already declared, class hash: {hex(class_hash)}")
            return class_hash
        raise


async def deploy_contract(account, class_hash: int, name: str, constructor_args: list) -> int:
    """Deploy a contract and return its address."""
    print(f"\n=== Deploying {name} ===")
    print(f"Class hash: {hex(class_hash)}")
    print(f"Constructor args: {constructor_args}")
    
    from starknet_py.net.udc_deployer.deployer import Deployer
    
    deployer = Deployer()
    deployment = deployer.create_contract_deployment(
        class_hash=class_hash,
        calldata=constructor_args
    )
    
    print(f"Expected address: {hex(deployment.address)}")
    
    try:
        resp = await account.execute_v3(calls=deployment.call, auto_estimate=True)
        print(f"TX submitted: {hex(resp.transaction_hash)}")
        
        await account.client.wait_for_tx(resp.transaction_hash)
        
        print(f"Deployed to: {hex(deployment.address)}")
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(resp.transaction_hash)}")
        
        return deployment.address
    except Exception as e:
        print(f"Error: {e}")
        raise


async def main():
    print("=" * 80)
    print("DEPLOYING U256 CONTRACTS (BN254 POSEIDON COMPATIBLE)")
    print("=" * 80)
    
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    print(f"Account: {ACCOUNT_ADDRESS}")
    print(f"RPC: {RPC_URL}")
    
    # 1. Declare MerkleTree
    print("\n" + "-" * 40)
    print("Step 1: Declare MerkleTree")
    print("-" * 40)
    
    try:
        merkle_class_hash = await declare_contract(account, "MerkleTree")
    except Exception as e:
        print(f"Failed to declare MerkleTree: {e}")
        # Try to use existing class hash
        merkle_class_hash = None
    
    # 2. Deploy MerkleTree
    print("\n" + "-" * 40)
    print("Step 2: Deploy MerkleTree")
    print("-" * 40)
    
    if merkle_class_hash:
        merkle_address = await deploy_contract(
            account,
            merkle_class_hash,
            "MerkleTree",
            [ADMIN_ADDRESS]  # admin
        )
        print(f"\nMerkleTree deployed at: {hex(merkle_address)}")
    else:
        print("Skipping MerkleTree deployment (no class hash)")
        merkle_address = None
    
    # 3. Declare FullyShieldedPool
    print("\n" + "-" * 40)
    print("Step 3: Declare FullyShieldedPool")
    print("-" * 40)
    
    try:
        pool_class_hash = await declare_contract(account, "FullyShieldedPool")
    except Exception as e:
        print(f"Failed to declare FullyShieldedPool: {e}")
        pool_class_hash = None
    
    # 4. Deploy FullyShieldedPool
    print("\n" + "-" * 40)
    print("Step 4: Deploy FullyShieldedPool")
    print("-" * 40)
    
    if pool_class_hash and merkle_address:
        # Constructor: merkle_tree, withdraw_verifier, token, admin
        pool_address = await deploy_contract(
            account,
            pool_class_hash,
            "FullyShieldedPool",
            [
                merkle_address,  # merkle_tree
                int(GARAGA_VERIFIER, 16),  # withdraw_verifier
                int(STRK_TOKEN, 16),  # token (STRK)
                ADMIN_ADDRESS,  # admin
            ]
        )
        print(f"\nFullyShieldedPool deployed at: {hex(pool_address)}")
    else:
        print("Skipping FullyShieldedPool deployment")
        pool_address = None
    
    # 5. Declare ConfidentialTransfer
    print("\n" + "-" * 40)
    print("Step 5: Declare ConfidentialTransfer")
    print("-" * 40)
    
    try:
        ct_class_hash = await declare_contract(account, "ConfidentialTransfer")
    except Exception as e:
        print(f"Failed to declare ConfidentialTransfer: {e}")
        ct_class_hash = None
    
    # 6. Deploy ConfidentialTransfer
    print("\n" + "-" * 40)
    print("Step 6: Deploy ConfidentialTransfer")
    print("-" * 40)
    
    if ct_class_hash:
        # Constructor: garaga_verifier_deposit, garaga_verifier_withdraw, token, admin
        ct_address = await deploy_contract(
            account,
            ct_class_hash,
            "ConfidentialTransfer",
            [
                int(GARAGA_VERIFIER, 16),  # garaga_verifier_deposit
                int(GARAGA_VERIFIER, 16),  # garaga_verifier_withdraw
                int(STRK_TOKEN, 16),  # token (STRK)
                ADMIN_ADDRESS,  # admin
            ]
        )
        print(f"\nConfidentialTransfer deployed at: {hex(ct_address)}")
    else:
        ct_address = None
    
    # 7. Add FullyShieldedPool as inserter to MerkleTree
    if merkle_address and pool_address:
        print("\n" + "-" * 40)
        print("Step 7: Add FullyShieldedPool as MerkleTree inserter")
        print("-" * 40)
        
        try:
            merkle_contract = await Contract.from_address(
                address=merkle_address,
                provider=account,
            )
            
            call = merkle_contract.functions["add_inserter"].prepare_invoke_v3(
                inserter=pool_address
            )
            resp = await account.execute_v3(calls=call, auto_estimate=True)
            await account.client.wait_for_tx(resp.transaction_hash)
            print(f"Added FullyShieldedPool as inserter: {hex(resp.transaction_hash)}")
        except Exception as e:
            print(f"Failed to add inserter: {e}")
    
    # Summary
    print("\n" + "=" * 80)
    print("DEPLOYMENT SUMMARY")
    print("=" * 80)
    print(f"MerkleTree:        {hex(merkle_address) if merkle_address else 'NOT DEPLOYED'}")
    print(f"FullyShieldedPool: {hex(pool_address) if pool_address else 'NOT DEPLOYED'}")
    print(f"ConfidentialTransfer: {hex(ct_address) if ct_address else 'NOT DEPLOYED'}")
    
    # Save addresses
    addresses = {
        "merkle_tree": hex(merkle_address) if merkle_address else None,
        "fully_shielded_pool": hex(pool_address) if pool_address else None,
        "confidential_transfer": hex(ct_address) if ct_address else None,
    }
    
    output_path = CONTRACTS_DIR / "deployed_u256_addresses.json"
    with open(output_path, "w") as f:
        json.dump(addresses, f, indent=2)
    print(f"\nSaved addresses to: {output_path}")
    
    # Print env updates
    print("\n" + "=" * 80)
    print("UPDATE YOUR .env FILES:")
    print("=" * 80)
    if merkle_address:
        print(f"NEXT_PUBLIC_MERKLE_TREE_ADDRESS={hex(merkle_address)}")
    if pool_address:
        print(f"NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS={hex(pool_address)}")
    if ct_address:
        print(f"NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS={hex(ct_address)}")


if __name__ == "__main__":
    asyncio.run(main())
