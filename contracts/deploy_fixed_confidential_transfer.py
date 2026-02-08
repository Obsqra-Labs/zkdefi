#!/usr/bin/env python3
import asyncio
import json
import sys
import os
sys.path.insert(0, '/opt/obsqra.starknet/zkdefi/backend')
from pathlib import Path
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair

async def main():
    # Load account
    with open('/root/.starknet_accounts/starknet_open_zeppelin_accounts.json') as f:
        accounts = json.load(f)
    
    deployer = accounts['alpha-sepolia']['deployer']
    private_key = int(deployer['private_key'], 16)
    address = int(deployer['address'], 16)
    
    client = FullNodeClient(node_url="https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7")
    key_pair = KeyPair.from_private_key(private_key)
    account = Account(address=address, client=client, key_pair=key_pair, chain=StarknetChainId.SEPOLIA)
    
    print(f"✓ Account: {hex(address)}")
    
    # Load contract class
    contract_path = Path("target/dev/zkdefi_contracts_ConfidentialTransfer.contract_class.json")
    casm_path = Path("target/dev/zkdefi_contracts_ConfidentialTransfer.compiled_contract_class.json")
    
    with open(contract_path) as f:
        sierra = f.read()
    with open(casm_path) as f:
        casm = json.load(f)
    
    print(f"✓ Contract loaded")
    
    # Compute CASM hash (simple hash for now - starknet-py will compute it)
    # For now, use 0 and let starknet-py handle it
    try:
        # Get constructor args from .env
        garaga_verifier = int(os.getenv('GARAGA_VERIFIER_ADDRESS', '0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37'), 16)
        token_addr = int(os.getenv('ERC20_TOKEN_ADDRESS', '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'), 16)
        
        print(f"✓ Constructor args:")
        print(f"  Garaga verifier: {hex(garaga_verifier)}")
        print(f"  Token: {hex(token_addr)}")
        
        # Deploy using account.deploy_contract
        print(f"\n⏳ Deploying contract...")
        deployment = await account.deploy_contract_v3(
            class_hash=None,  # Will be computed
            compiled_contract=sierra,
            compiled_contract_casm=casm,
            constructor_args=[garaga_verifier, token_addr],
            auto_estimate=True
        )
        
        print(f"✅ Deployment submitted!")
        print(f"   TX: https://sepolia.starkscan.co/tx/{hex(deployment.transaction_hash)}")
        print(f"\n⏳ Waiting for deployment...")
        
        await deployment.wait_for_acceptance()
        
        print(f"\n🎉 SUCCESS!")
        print(f"   Contract address: {hex(deployment.deployed_contract_address)}")
        print(f"\n📝 Update .env:")
        print(f"   CONFIDENTIAL_TRANSFER_ADDRESS={hex(deployment.deployed_contract_address)}")
        
        return deployment.deployed_contract_address
        
    except Exception as e:
        print(f"❌ Failed: {e}")
        import traceback
        traceback.print_exc()
        raise

if __name__ == '__main__':
    try:
        addr = asyncio.run(main())
        sys.exit(0)
    except Exception:
        sys.exit(1)
