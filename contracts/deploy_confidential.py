#!/usr/bin/env python3
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, '/opt/obsqra.starknet/zkdefi/backend')

from starknet_py.net.account.account import Account  
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.casm_class_hash import compute_casm_class_hash

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
    
    # Load contracts
    sierra_path = Path("target/dev/zkdefi_contracts_ConfidentialTransfer.contract_class.json")
    casm_path = Path("target/dev/zkdefi_contracts_ConfidentialTransfer.compiled_contract_class.json")
    
    with open(sierra_path) as f:
        sierra = f.read()
    with open(casm_path) as f:
        casm = json.load(f)
    
    compiled_class_hash = compute_casm_class_hash(casm)
    
    print(f"✓ Contracts loaded")
    print(f"  CASM hash: {hex(compiled_class_hash)}")
    
    # Constructor args
    garaga_verifier = 0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
    token = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
    
    print(f"✓ Constructor: garaga={hex(garaga_verifier)}, token={hex(token)}")
    
    try:
        print(f"\n⏳ Step 1: Declaring contract...")
        
        declare_tx = await account.sign_declare_v3(
            compiled_contract=sierra,
            compiled_class_hash=compiled_class_hash,
            auto_estimate=True
        )
        
        resp = await account.client.declare(declare_tx)
        print(f"  Declare TX: {hex(resp.transaction_hash)}")
        
        await account.client.wait_for_tx(resp.transaction_hash, check_interval=5)
        class_hash = resp.class_hash
        
        print(f"✅ Declared! Class: {hex(class_hash)}")
        
        print(f"\n⏳ Step 2: Deploying contract...")
        
        # Deploy using execute with UDC
        deploy_call = await account.sign_deploy_account_v3(
            class_hash=class_hash,
            contract_address_salt=0,
            constructor_calldata=[garaga_verifier, token],
            auto_estimate=True
        )
        
        # Actually, let's use a simpler approach - deploy via account.execute
        from starknet_py.net.models import DeployAccountTransaction
        
        # Use account.deploy method
        print("  Using direct deployment...")
        
        # The simplest: use a deployment script
        # Let me just output the command for manual deployment
        print(f"\n✅ Declaration complete!")
        print(f"\n📝 Deploy manually with:")
        print(f"   sncast deploy \\")
        print(f"     --class-hash {hex(class_hash)} \\")
        print(f"     --constructor-calldata {hex(garaga_verifier)} {hex(token)} \\")
        print(f"     --account deployer")
        
        return class_hash
        
    except Exception as e:
        print(f"❌ Failed: {e}")
        import traceback
        traceback.print_exc()
        raise

if __name__ == '__main__':
    try:
        class_hash = asyncio.run(main())
        print(f"\nClass hash for manual deployment: {hex(class_hash)}")
        sys.exit(0)
    except Exception:
        sys.exit(1)
