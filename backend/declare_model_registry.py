#!/usr/bin/env python3
"""
Declare ModelRegistry contract to Starknet Sepolia
"""

import asyncio
import json
import os
from pathlib import Path

async def declare_model_registry():
    """Declare ModelRegistry contract"""
    
    try:
        from starknet_py.contract import ContractClass
        from starknet_py.net.gateway_client import GatewayClient
        from starknet_py.net.models import Network
        from starknet_py.net.account.account import Account
        from starknet_py.net.signer import KeyPair
    except ImportError:
        print("⚠️  starknet.py not installed, will use alternative approach")
        return None
    
    # Load contract class
    contract_path = Path("/opt/obsqra.starknet/contracts/target/dev/obsqra_contracts_ModelRegistry.contract_class.json")
    
    if not contract_path.exists():
        print(f"❌ Contract file not found: {contract_path}")
        return None
    
    print(f"📋 Loading contract from: {contract_path}")
    with open(contract_path) as f:
        contract_json = json.load(f)
    
    print("✅ Contract loaded successfully")
    print(f"   ABI entries: {len(contract_json.get('abi', []))}")
    print(f"   Program size: {len(contract_json.get('sierra_program', []))} instructions")
    
    # For now, just verify the contract is valid
    return {
        "status": "ready",
        "message": "ModelRegistry contract is ready for declaration",
        "size": len(json.dumps(contract_json)),
        "path": str(contract_path)
    }

if __name__ == "__main__":
    result = asyncio.run(declare_model_registry())
    if result:
        print(f"\n✅ Contract Ready to Deploy")
        for key, value in result.items():
            if key != "path":
                print(f"   {key}: {value}")
        print(f"\nNext: Use Argent/Braavos account to deploy")
