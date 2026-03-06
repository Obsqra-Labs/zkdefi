#!/usr/bin/env python3
"""
Deploy zkML Marketplace Contracts: ModelRegistry, AgentComposer, AgentIdentity, ValidationProofRegistry
Using starknet_py with PublicNode RPC
"""
import asyncio
import json
from pathlib import Path

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract
from starknet_py.net.udc_deployer.deployer import Deployer

# Configuration - Using PublicNode RPC (confirmed working)
RPC_URL = "https://starknet-sepolia-rpc.publicnode.com"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
CONTRACT_DIR = Path("/opt/obsqra.starknet/zkdefi/contracts")

# Load private key from accounts.json
with open("/opt/obsqra.starknet/contracts/accounts.json") as f:
    accounts = json.load(f)
    PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)

print(f"Using account: {ACCOUNT_ADDRESS}")
print(f"Using RPC: {RPC_URL}")


async def declare_and_deploy(account, contract_name: str, constructor_args: list = None):
    """Declare and deploy a contract"""
    print(f"\n=== Deploying {contract_name} ===")
    
    contract_class_path = CONTRACT_DIR / f"target/dev/zkdefi_contracts_{contract_name}.contract_class.json"
    compiled_contract_path = CONTRACT_DIR / f"target/dev/zkdefi_contracts_{contract_name}.compiled_contract_class.json"
    
    if not contract_class_path.exists():
        print(f"ERROR: Contract class not found: {contract_class_path}")
        return None, None
    
    with open(contract_class_path) as f:
        contract_class = f.read()
    
    with open(compiled_contract_path) as f:
        compiled_contract = f.read()
    
    class_hash = None
    
    # Try to declare
    print(f"Declaring {contract_name}...")
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=contract_class,
            compiled_contract_casm=compiled_contract,
            auto_estimate=True
        )
        
        await declare_result.wait_for_acceptance()
        class_hash = declare_result.class_hash
        print(f"Declared! Class hash: {hex(class_hash)}")
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(declare_result.hash)}")
        
    except Exception as e:
        error_str = str(e)
        if "is already declared" in error_str or "already been declared" in error_str:
            # Extract class hash from error message
            import re
            match = re.search(r'0x[0-9a-fA-F]+', error_str)
            if match:
                class_hash = int(match.group(), 16)
            print(f"Contract already declared. Class hash: {hex(class_hash) if class_hash else 'unknown'}")
        else:
            print(f"Error declaring: {e}")
            return None, None
    
    if class_hash is None:
        print("ERROR: Could not get class hash")
        return None, None
    
    # Deploy
    print(f"\nDeploying {contract_name} instance...")
    deployer = Deployer()
    
    deploy_call, address = deployer.create_deployment_call(
        class_hash=class_hash,
        constructor_args=constructor_args or []
    )
    
    try:
        resp = await account.execute_v3(calls=deploy_call, auto_estimate=True)
        await account.client.wait_for_tx(resp.transaction_hash)
        
        print(f"Deployed! Address: {hex(address)}")
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(resp.transaction_hash)}")
        print(f"Contract: https://sepolia.starkscan.co/contract/{hex(address)}")
        
        return address, class_hash
    except Exception as e:
        print(f"Error deploying: {e}")
        return None, class_hash


async def main():
    print("="*80)
    print("ZKML MARKETPLACE CONTRACTS DEPLOYMENT")
    print("="*80)
    
    # Setup account
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    admin_address = int(ACCOUNT_ADDRESS, 16)
    results = {}
    
    # 1. Deploy ModelRegistry (admin only)
    model_registry_addr, model_registry_hash = await declare_and_deploy(
        account, "ModelRegistry", [admin_address]
    )
    results["ModelRegistry"] = (model_registry_addr, model_registry_hash)
    
    # 2. Deploy AgentComposer (admin, model_registry)
    if model_registry_addr:
        agent_composer_addr, agent_composer_hash = await declare_and_deploy(
            account, "AgentComposer", [admin_address, model_registry_addr]
        )
        results["AgentComposer"] = (agent_composer_addr, agent_composer_hash)
    
    # 3. Deploy AgentIdentity (admin)
    agent_identity_addr, agent_identity_hash = await declare_and_deploy(
        account, "AgentIdentity", [admin_address]
    )
    results["AgentIdentity"] = (agent_identity_addr, agent_identity_hash)
    
    # 4. Deploy ValidationProofRegistry (admin)
    validation_registry_addr, validation_registry_hash = await declare_and_deploy(
        account, "ValidationProofRegistry", [admin_address]
    )
    results["ValidationProofRegistry"] = (validation_registry_addr, validation_registry_hash)
    
    # Print summary
    print("\n" + "="*80)
    print("DEPLOYMENT SUMMARY")
    print("="*80)
    
    for name, (addr, hash_) in results.items():
        if addr:
            print(f"{name}:")
            print(f"  Address: {hex(addr)}")
            print(f"  Class Hash: {hex(hash_) if hash_ else 'N/A'}")
            print(f"  Explorer: https://sepolia.starkscan.co/contract/{hex(addr)}")
        else:
            print(f"{name}: FAILED")
    
    # Save to .env file format
    print("\n" + "-"*80)
    print("Add to backend/.env:")
    print("-"*80)
    if results.get("ModelRegistry", (None, None))[0]:
        print(f"MODEL_REGISTRY_ADDRESS={hex(results['ModelRegistry'][0])}")
    if results.get("AgentComposer", (None, None))[0]:
        print(f"AGENT_COMPOSER_ADDRESS={hex(results['AgentComposer'][0])}")
    if results.get("AgentIdentity", (None, None))[0]:
        print(f"AGENT_IDENTITY_ADDRESS={hex(results['AgentIdentity'][0])}")
    if results.get("ValidationProofRegistry", (None, None))[0]:
        print(f"VALIDATION_PROOF_REGISTRY_ADDRESS={hex(results['ValidationProofRegistry'][0])}")
    
    print("\n" + "-"*80)
    print("Add to frontend/.env.local:")
    print("-"*80)
    if results.get("ModelRegistry", (None, None))[0]:
        print(f"NEXT_PUBLIC_MODEL_REGISTRY_ADDRESS={hex(results['ModelRegistry'][0])}")
    if results.get("AgentComposer", (None, None))[0]:
        print(f"NEXT_PUBLIC_AGENT_COMPOSER_ADDRESS={hex(results['AgentComposer'][0])}")
    if results.get("AgentIdentity", (None, None))[0]:
        print(f"NEXT_PUBLIC_AGENT_IDENTITY_ADDRESS={hex(results['AgentIdentity'][0])}")
    if results.get("ValidationProofRegistry", (None, None))[0]:
        print(f"NEXT_PUBLIC_VALIDATION_PROOF_REGISTRY_ADDRESS={hex(results['ValidationProofRegistry'][0])}")
    
    print("="*80)
    
    # Save deployment info to file
    deployment_info = {
        "network": "sepolia",
        "timestamp": __import__("datetime").datetime.now().isoformat(),
        "contracts": {
            name: {"address": hex(addr) if addr else None, "class_hash": hex(hash_) if hash_ else None}
            for name, (addr, hash_) in results.items()
        }
    }
    
    with open(CONTRACT_DIR / ".marketplace_deployment.json", "w") as f:
        json.dump(deployment_info, f, indent=2)
    print(f"\nDeployment info saved to {CONTRACT_DIR / '.marketplace_deployment.json'}")


if __name__ == "__main__":
    asyncio.run(main())
