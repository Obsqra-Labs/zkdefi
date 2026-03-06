#!/usr/bin/env python3
"""Deploy withdrawal verifier to Sepolia"""
import asyncio
import json
import os
from pathlib import Path
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract

RPC_URL = "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY", "0x1")  # Will load from env

async def main():
    print("=== Deploying Withdrawal Verifier ===\n")
    
    client = FullNodeClient(node_url=RPC_URL)
    
    # Load account
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(int(PRIVATE_KEY, 16)),
        chain=StarknetChainId.SEPOLIA,
    )
    
    # Load contract class
    contract_class_path = Path("target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json")
    compiled_contract_path = Path("target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.compiled_contract_class.json")
    
    with open(contract_class_path) as f:
        contract_class = json.load(f)
    
    with open(compiled_contract_path) as f:
        compiled_contract = json.load(f)
    
    print("Step 1: Declaring contract...")
    declare_result = await Contract.declare_v3(
        account=account,
        compiled_contract=contract_class,
        compiled_contract_casm=compiled_contract,
        auto_estimate=True
    )
    
    await declare_result.wait_for_acceptance()
    class_hash = declare_result.class_hash
    print(f"✅ Declared! Class hash: {hex(class_hash)}")
    
    print("\nStep 2: Deploying contract...")
    deploy_result = await declare_result.deploy_v3(auto_estimate=True)
    await deploy_result.wait_for_acceptance()
    
    contract_address = deploy_result.deployed_contract.address
    print(f"✅ Deployed! Address: {hex(contract_address)}")
    print(f"\nExplorer: https://sepolia.starkscan.co/contract/{hex(contract_address)}")
    
    return contract_address

if __name__ == "__main__":
    address = asyncio.run(main())
