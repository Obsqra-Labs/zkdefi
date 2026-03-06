#!/usr/bin/env python3
"""
Deploy new contracts: AgentIdentity and ValidationProofRegistry
Using starknet_py with class hashes that were already declared
"""
import asyncio
import json
from pathlib import Path

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.udc_deployer.deployer import Deployer

# Configuration
RPC_URL = "https://starknet-sepolia-rpc.publicnode.com"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

# Load private key
with open("/opt/obsqra.starknet/contracts/accounts.json") as f:
    accounts = json.load(f)
    PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)

ADMIN_ADDRESS = int(ACCOUNT_ADDRESS, 16)

# Already declared class hashes
AGENT_IDENTITY_HASH = 0x056bfddb434992e97170c4954e161b68f3077004567e5fa5e3c44e1c54805d99
VALIDATION_REGISTRY_HASH = 0x07ab6af3551f6b021191d5a66e1b520ef07cd83bf66b40ef1c633c340c6e6e5a


async def deploy_with_class_hash(account, name: str, class_hash: int, constructor_args: list):
    """Deploy a contract using an already declared class hash"""
    print(f"\n=== Deploying {name} ===")
    print(f"Class hash: {hex(class_hash)}")
    print(f"Constructor args: {constructor_args}")
    
    deployer = Deployer()
    
    # Use the new API
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
        return None


async def main():
    print("="*80)
    print("DEPLOYING NEW CONTRACTS")
    print("="*80)
    
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    # Try deploying AgentIdentity with various constructor arg combinations
    # The error message is confusing, so let's try multiple approaches
    
    print("\n--- Attempting deployment with admin arg ---")
    addr1 = await deploy_with_class_hash(
        account, "AgentIdentity", AGENT_IDENTITY_HASH, [ADMIN_ADDRESS]
    )
    
    if not addr1:
        print("\n--- Attempting deployment with NO args ---")
        addr1 = await deploy_with_class_hash(
            account, "AgentIdentity", AGENT_IDENTITY_HASH, []
        )
    
    print("\n" + "="*80)
    
    addr2 = await deploy_with_class_hash(
        account, "ValidationProofRegistry", VALIDATION_REGISTRY_HASH, [ADMIN_ADDRESS]
    )
    
    if not addr2:
        print("\n--- Attempting deployment with NO args ---")
        addr2 = await deploy_with_class_hash(
            account, "ValidationProofRegistry", VALIDATION_REGISTRY_HASH, []
        )
    
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    if addr1:
        print(f"AGENT_IDENTITY_ADDRESS={hex(addr1)}")
    if addr2:
        print(f"VALIDATION_PROOF_REGISTRY_ADDRESS={hex(addr2)}")


if __name__ == "__main__":
    asyncio.run(main())
