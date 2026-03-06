#!/usr/bin/env python3
"""
Manual deployment script for withdrawal verifier and updated ConfidentialTransfer.
Uses starknet_py which handles older RPC versions.
"""
import asyncio
import json
import os
from pathlib import Path

# Disable RPC version warnings
import warnings
warnings.filterwarnings('ignore')

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract

# Configuration
RPC_URL = "https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

# Load private key from accounts.json
with open("/opt/obsqra.starknet/contracts/accounts.json") as f:
    accounts = json.load(f)
    PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)

# Addresses
EXISTING_DEPOSIT_VERIFIER = "0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37"
TOKEN_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ADMIN_ADDRESS = ACCOUNT_ADDRESS

async def deploy_withdrawal_verifier(account):
    """Deploy withdrawal verifier"""
    print("\n=== Step 1: Deploying Withdrawal Verifier ===")
    
    contract_class_path = Path("target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json")
    compiled_contract_path = Path("target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.compiled_contract_class.json")
    
    with open(contract_class_path) as f:
        contract_class = f.read()
    
    with open(compiled_contract_path) as f:
        compiled_contract = f.read()
    
    print("Declaring...")
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=contract_class,
            compiled_contract_casm=compiled_contract,
            auto_estimate=True
        )
        
        await declare_result.wait_for_acceptance()
        class_hash = declare_result.class_hash
        print(f"✅ Declared! Class hash: {hex(class_hash)}")
        
        print("\nDeploying...")
        deploy_result = await declare_result.deploy_v3(auto_estimate=True)
        await deploy_result.wait_for_acceptance()
        
        contract_address = deploy_result.deployed_contract.address
        print(f"✅ Deployed! Address: {hex(contract_address)}")
        print(f"Explorer: https://sepolia.starkscan.co/contract/{hex(contract_address)}")
        
        return contract_address
    except Exception as e:
        if "is already declared" in str(e):
            # Already declared, get class hash
            print("Contract already declared, using class hash: 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2")
            class_hash = 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
            
            # Just deploy
            print("\nDeploying...")
            from starknet_py.net.udc_deployer.deployer import Deployer
            deployer = Deployer()
            deploy_call, address = deployer.create_deployment_call(class_hash=class_hash, constructor_args=[])
            
            resp = await account.execute_v3(calls=deploy_call, auto_estimate=True)
            await account.client.wait_for_tx(resp.transaction_hash)
            
            contract_address = address
            print(f"✅ Deployed! Address: {hex(contract_address)}")
            print(f"Explorer: https://sepolia.starkscan.co/contract/{hex(contract_address)}")
            
            return contract_address
        else:
            raise

async def deploy_confidential_transfer(account, withdrawal_verifier_address):
    """Deploy updated ConfidentialTransfer with two verifiers"""
    print("\n=== Step 2: Deploying ConfidentialTransfer ===")
    
    contract_class_path = Path("target/dev/zkdefi_contracts_ConfidentialTransfer.contract_class.json")
    compiled_contract_path = Path("target/dev/zkdefi_contracts_ConfidentialTransfer.compiled_contract_class.json")
    
    with open(contract_class_path) as f:
        contract_class = f.read()
    
    with open(compiled_contract_path) as f:
        compiled_contract = f.read()
    
    print("Declaring...")
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=contract_class,
            compiled_contract_casm=compiled_contract,
            auto_estimate=True
        )
        
        await declare_result.wait_for_acceptance()
        class_hash = declare_result.class_hash
        print(f"✅ Declared! Class hash: {hex(class_hash)}")
    except Exception as e:
        if "is already declared" in str(e):
            print("Contract already declared, using class hash: 0x015c6889ee864f9630b01b7a51040d556cb412358548914ca9c830f27893ccd9")
            class_hash = 0x015c6889ee864f9630b01b7a51040d556cb412358548914ca9c830f27893ccd9
        else:
            raise
    
    print("\nDeploying with constructor args:")
    print(f"  deposit_verifier:    {EXISTING_DEPOSIT_VERIFIER}")
    print(f"  withdrawal_verifier: {hex(withdrawal_verifier_address)}")
    print(f"  token:               {TOKEN_ADDRESS}")
    print(f"  admin:               {ADMIN_ADDRESS}")
    
    from starknet_py.net.udc_deployer.deployer import Deployer
    deployer = Deployer()
    deploy_call, address = deployer.create_deployment_call(
        class_hash=class_hash,
        constructor_args=[
            int(EXISTING_DEPOSIT_VERIFIER, 16),
            withdrawal_verifier_address,
            int(TOKEN_ADDRESS, 16),
            int(ADMIN_ADDRESS, 16)
        ]
    )
    
    resp = await account.execute_v3(calls=deploy_call, auto_estimate=True)
    await account.client.wait_for_tx(resp.transaction_hash)
    
    contract_address = deploy_result.deployed_contract.address
    print(f"\n✅ Deployed! Address: {hex(contract_address)}")
    print(f"Explorer: https://sepolia.starkscan.co/contract/{hex(contract_address)}")
    
    return contract_address

async def main():
    print("=== zkde.fi - Two Verifier Deployment ===")
    print(f"RPC: {RPC_URL}")
    print(f"Account: {ACCOUNT_ADDRESS}\n")
    
    client = FullNodeClient(node_url=RPC_URL)
    
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    # Step 1: Deploy withdrawal verifier
    withdrawal_verifier = await deploy_withdrawal_verifier(account)
    
    # Step 2: Deploy ConfidentialTransfer
    confidential_transfer = await deploy_confidential_transfer(account, withdrawal_verifier)
    
    # Print summary
    print("\n" + "="*60)
    print("DEPLOYMENT COMPLETE")
    print("="*60)
    print(f"Withdrawal Verifier:    {hex(withdrawal_verifier)}")
    print(f"ConfidentialTransfer:   {hex(confidential_transfer)}")
    print("\nUpdate environment variables:")
    print(f"  backend/.env:")
    print(f"    CONFIDENTIAL_TRANSFER_ADDRESS={hex(confidential_transfer)}")
    print(f"  frontend/.env.local:")
    print(f"    NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS={hex(confidential_transfer)}")
    print("="*60)

if __name__ == "__main__":
    asyncio.run(main())
