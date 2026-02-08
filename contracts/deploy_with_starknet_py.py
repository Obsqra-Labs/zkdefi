#!/usr/bin/env python3
"""
Deploy using starknet_py with private key directly (bypass keystore issues)
Using PublicNode RPC which is confirmed working
"""
import asyncio
import json
from pathlib import Path

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract

# Configuration - Using PublicNode RPC (confirmed working)
RPC_URL = "https://starknet-sepolia-rpc.publicnode.com"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

# Load private key from accounts.json
with open("/opt/obsqra.starknet/contracts/accounts.json") as f:
    accounts = json.load(f)
    PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)

print(f"Using account: {ACCOUNT_ADDRESS}")
print(f"Using RPC: {RPC_URL}")

async def deploy_withdrawal_verifier():
    """Deploy withdrawal verifier using starknet_py"""
    print("\n=== Step 1: Deploying Withdrawal Verifier ===")
    
    # Setup client and account
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    # Load contract artifacts
    contract_class_path = Path("/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw/target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json")
    compiled_contract_path = Path("/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw/target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.compiled_contract_class.json")
    
    with open(contract_class_path) as f:
        contract_class = f.read()
    
    with open(compiled_contract_path) as f:
        compiled_contract = f.read()
    
    print("Declaring withdrawal verifier...")
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
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(declare_result.hash)}")
        
        # Now deploy
        print("\nDeploying withdrawal verifier instance...")
        deploy_result = await declare_result.deploy_v3(max_fee=int(5e16))
        await deploy_result.wait_for_acceptance()
        
        address = deploy_result.deployed_contract.address
        print(f"✅ Deployed! Address: {hex(address)}")
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(deploy_result.hash)}")
        print(f"Contract: https://sepolia.starkscan.co/contract/{hex(address)}")
        
        return address, class_hash
        
    except Exception as e:
        error_str = str(e)
        if "is already declared" in error_str or "already been declared" in error_str:
            print("✅ Contract already declared!")
            # Extract class hash or use pre-computed one
            class_hash = 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
            print(f"Using class hash: {hex(class_hash)}")
            
            # Just deploy
            print("\nDeploying withdrawal verifier instance...")
            from starknet_py.net.udc_deployer.deployer import Deployer
            deployer = Deployer()
            
            deploy_call, address = deployer.create_deployment_call(
                class_hash=class_hash,
                constructor_args=[]
            )
            
            resp = await account.execute_v3(calls=deploy_call, auto_estimate=True)
            await account.client.wait_for_tx(resp.transaction_hash)
            
            print(f"✅ Deployed! Address: {hex(address)}")
            print(f"TX: https://sepolia.starkscan.co/tx/{hex(resp.transaction_hash)}")
            print(f"Contract: https://sepolia.starkscan.co/contract/{hex(address)}")
            
            return address, class_hash
        else:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
            raise

async def deploy_confidential_transfer(withdrawal_verifier_address):
    """Deploy updated ConfidentialTransfer"""
    print("\n=== Step 2: Deploying ConfidentialTransfer ===")
    
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    contract_class_path = Path("/opt/obsqra.starknet/zkdefi/contracts/target/dev/zkdefi_contracts_ConfidentialTransfer.contract_class.json")
    compiled_contract_path = Path("/opt/obsqra.starknet/zkdefi/contracts/target/dev/zkdefi_contracts_ConfidentialTransfer.compiled_contract_class.json")
    
    with open(contract_class_path) as f:
        contract_class = f.read()
    
    with open(compiled_contract_path) as f:
        compiled_contract = f.read()
    
    print("Declaring ConfidentialTransfer...")
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
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(declare_result.hash)}")
        
    except Exception as e:
        if "is already declared" in str(e):
            print("✅ Contract already declared!")
            class_hash = 0x015c6889ee864f9630b01b7a51040d556cb412358548914ca9c830f27893ccd9
            print(f"Using class hash: {hex(class_hash)}")
        else:
            import traceback
            traceback.print_exc()
            raise
    
    # Deploy with constructor args
    DEPOSIT_VERIFIER = 0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
    TOKEN = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
    ADMIN = int(ACCOUNT_ADDRESS, 16)
    
    print("\nDeploying ConfidentialTransfer with constructor:")
    print(f"  deposit_verifier:    {hex(DEPOSIT_VERIFIER)}")
    print(f"  withdrawal_verifier: {hex(withdrawal_verifier_address)}")
    print(f"  token:               {hex(TOKEN)}")
    print(f"  admin:               {hex(ADMIN)}")
    
    from starknet_py.net.udc_deployer.deployer import Deployer
    deployer = Deployer()
    
    deploy_call, address = deployer.create_deployment_call(
        class_hash=class_hash,
        constructor_args=[
            DEPOSIT_VERIFIER,
            withdrawal_verifier_address,
            TOKEN,
            ADMIN
        ]
    )
    
    resp = await account.execute_v3(calls=deploy_call, auto_estimate=True)
    await account.client.wait_for_tx(resp.transaction_hash)
    
    print(f"\n✅ Deployed! Address: {hex(address)}")
    print(f"TX: https://sepolia.starkscan.co/tx/{hex(resp.transaction_hash)}")
    print(f"Contract: https://sepolia.starkscan.co/contract/{hex(address)}")
    
    return address

async def main():
    print("="*80)
    print("VK MISMATCH FIX - DEPLOYMENT WITH PUBLICNODE RPC")
    print("="*80)
    
    # Step 1: Deploy withdrawal verifier
    withdrawal_verifier, withdraw_class_hash = await deploy_withdrawal_verifier()
    
    # Step 2: Deploy ConfidentialTransfer
    confidential_transfer = await deploy_confidential_transfer(withdrawal_verifier)
    
    # Print summary
    print("\n" + "="*80)
    print("DEPLOYMENT COMPLETE!")
    print("="*80)
    print(f"Withdrawal Verifier:  {hex(withdrawal_verifier)}")
    print(f"  Class Hash:         {hex(withdraw_class_hash)}")
    print(f"ConfidentialTransfer: {hex(confidential_transfer)}")
    print("\nNext steps:")
    print(f"  1. Update backend/.env:")
    print(f"     CONFIDENTIAL_TRANSFER_ADDRESS={hex(confidential_transfer)}")
    print(f"  2. Update frontend/.env.local:")
    print(f"     NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS={hex(confidential_transfer)}")
    print(f"  3. Restart backend and frontend")
    print(f"  4. Test withdrawal (should work now!)")
    print("="*80)

if __name__ == "__main__":
    asyncio.run(main())
