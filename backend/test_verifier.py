#!/usr/bin/env python3
import asyncio
import sys
sys.path.insert(0, '/opt/obsqra.starknet/zkdefi/backend')

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.contract import Contract

async def main():
    # Read the test proof calldata
    with open('../circuits/build/test_garaga_calldata.txt') as f:
        content = f.read().strip()
    values = content.split()
    
    # Skip the first value (length) and convert rest to int
    calldata = [int(v) for v in values[1:]]
    
    print(f"✓ Proof calldata prepared: {len(calldata)} values")
    
    # Connect to RPC
    rpc_url = "https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7"
    client = FullNodeClient(node_url=rpc_url)
    
    # Garaga verifier address
    verifier_address = 0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
    
    print(f"✓ Connected to RPC")
    print(f"✓ Verifier: {hex(verifier_address)}")
    
    # Load contract
    contract = await Contract.from_address(
        address=verifier_address,
        provider=client
    )
    
    print(f"✓ Contract loaded")
    
    # Call verify function (read-only)
    try:
        result = await contract.functions["verify_groth16_proof_bn254"].call(
            full_proof_with_hints=calldata
        )
        print(f"\n✅ VERIFICATION SUCCEEDED!")
        print(f"   Result: {result}")
        return True
    except Exception as e:
        print(f"\n❌ VERIFICATION FAILED:")
        error_str = str(e)
        if 'Invalid proof' in error_str:
            print(f"   Error: Invalid proof (verifier rejected the proof)")
        else:
            print(f"   Error: {error_str[:500]}")
        return False

if __name__ == '__main__':
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
