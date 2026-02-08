#!/usr/bin/env python3
import asyncio
import json
from pathlib import Path
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.casm_class_hash import compute_casm_class_hash

async def main():
    # Load account details
    with open('/root/.starknet_accounts/starknet_open_zeppelin_accounts.json') as f:
        accounts = json.load(f)
    
    deployer = accounts['alpha-sepolia']['deployer']
    private_key = int(deployer['private_key'], 16)
    address = int(deployer['address'], 16)
    
    # Setup client and account
    client = FullNodeClient(node_url="https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7")
    
    key_pair = KeyPair.from_private_key(private_key)
    account = Account(
        address=address,
        client=client,
        key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA,
    )
    
    print(f"✓ Account loaded: {hex(address)}")
    
    # Load contract class (Sierra)
    contract_path = Path("../circuits/contracts/src/garaga_verifier_new/target/dev/garaga_verifier_new_Groth16VerifierBN254.contract_class.json")
    with open(contract_path) as f:
        compiled_contract = f.read()
    
    print(f"✓ Contract class loaded")
    
    # Load CASM and compute hash
    casm_path = Path("../circuits/contracts/src/garaga_verifier_new/target/dev/garaga_verifier_new_Groth16VerifierBN254.compiled_contract_class.json")
    with open(casm_path) as f:
        casm_class = json.load(f)
    
    compiled_class_hash = compute_casm_class_hash(casm_class)
    print(f"✓ Computed CASM class hash: {hex(compiled_class_hash)}")
    
    # Declare the contract
    try:
        declare_result = await account.sign_declare_v3(
            compiled_contract=compiled_contract,
            compiled_class_hash=compiled_class_hash,
            auto_estimate=True,
        )
        
        print(f"✓ Declare transaction created")
        print(f"  Class hash: {hex(declare_result.class_hash)}")
        print(f"  Transaction hash: {hex(declare_result.transaction_hash)}")
        
        # Send the transaction
        resp = await account.client.declare(declare_result)
        
        print(f"\n✅ Declaration submitted!")
        print(f"   Class hash: {hex(resp.class_hash)}")
        print(f"   TX: https://sepolia.starkscan.co/tx/{hex(resp.transaction_hash)}")
        
        # Wait for acceptance
        print(f"\n⏳ Waiting for transaction acceptance...")
        result = await account.client.wait_for_tx(resp.transaction_hash, check_interval=5)
        
        print(f"✅ Declaration accepted! Status: {result.finality_status}")
        
        return resp.class_hash
        
    except Exception as e:
        print(f"❌ Declaration failed: {e}")
        import traceback
        traceback.print_exc()
        raise

if __name__ == '__main__':
    try:
        class_hash = asyncio.run(main())
        print(f"\n🎉 SUCCESS! Class hash: {hex(class_hash)}")
        print(f"\n📝 Now deploy with:")
        print(f"   sncast deploy --class-hash {hex(class_hash)}")
    except Exception:
        print("\n💥 Deployment failed")
