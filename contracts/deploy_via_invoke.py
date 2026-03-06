#!/usr/bin/env python3
"""
Deploy contracts using raw UDC invocation with compatible API
"""
import asyncio
import json
from pathlib import Path

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call
from starknet_py.hash.address import compute_address

# Configuration
RPC_URL = "https://starknet-sepolia-rpc.publicnode.com"
ACCOUNT_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

# UDC address on all Starknet networks
UDC_ADDRESS = 0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf

# Load private key
with open("/opt/obsqra.starknet/contracts/accounts.json") as f:
    accounts = json.load(f)
    PRIVATE_KEY = int(accounts["sepolia"]["deployer"]["private_key"], 16)

ADMIN_ADDRESS = int(ACCOUNT_ADDRESS, 16)

# Already declared class hashes - use from earlier attempts
AGENT_IDENTITY_HASH = 0x056bfddb434992e97170c4954e161b68f3077004567e5fa5e3c44e1c54805d99
VALIDATION_REGISTRY_HASH = 0x07ab6af3551f6b021191d5a66e1b520ef07cd83bf66b40ef1c633c340c6e6e5a


async def deploy_via_udc(account, name: str, class_hash: int, salt: int, constructor_args: list, unique: bool = True):
    """Deploy using raw UDC call"""
    print(f"\n=== Deploying {name} ===")
    print(f"Class hash: {hex(class_hash)}")
    
    # UDC deployContract signature:
    # fn deployContract(classHash: felt, salt: felt, unique: felt, calldata: Span<felt>) -> ContractAddress
    
    # Build calldata: [classHash, salt, unique, calldata_len, ...calldata]
    calldata = [
        class_hash,
        salt,
        1 if unique else 0,  # unique = 1 means address is derived from deployer
        len(constructor_args),
        *constructor_args
    ]
    
    # UDC deployContract selector
    DEPLOY_SELECTOR = 0x01987cbd17808b9a23693d4de7e246a443cfe37e6e7c3b3e0e172a58e24db78

    call = Call(
        to_addr=UDC_ADDRESS,
        selector=DEPLOY_SELECTOR,
        calldata=calldata
    )
    
    # Compute expected address
    # For unique=True, the address is computed with account address as part of the hash
    if unique:
        expected_addr = compute_address(
            class_hash=class_hash,
            constructor_calldata=constructor_args,
            salt=salt,
            deployer_address=ADMIN_ADDRESS
        )
    else:
        expected_addr = compute_address(
            class_hash=class_hash,
            constructor_calldata=constructor_args,
            salt=salt,
            deployer_address=0
        )
    
    print(f"Expected address: {hex(expected_addr)}")
    
    try:
        # Use execute instead of execute_v3 for older RPC compatibility
        resp = await account.execute_v1(
            calls=[call],
            max_fee=int(1e16)  # 0.01 ETH
        )
        print(f"TX submitted: {hex(resp.transaction_hash)}")
        
        await account.client.wait_for_tx(resp.transaction_hash)
        
        print(f"SUCCESS! Deployed to: {hex(expected_addr)}")
        print(f"TX: https://sepolia.starkscan.co/tx/{hex(resp.transaction_hash)}")
        
        return expected_addr
    except Exception as e:
        print(f"Error: {e}")
        return None


async def main():
    print("="*80)
    print("DEPLOYING VIA UDC RAW INVOKE")
    print("="*80)
    
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        address=ACCOUNT_ADDRESS,
        client=client,
        key_pair=KeyPair.from_private_key(PRIVATE_KEY),
        chain=StarknetChainId.SEPOLIA,
    )
    
    import random
    salt = random.randint(0, 2**32)  # Random salt
    
    # Deploy AgentIdentity
    addr1 = await deploy_via_udc(
        account, "AgentIdentity", AGENT_IDENTITY_HASH, 
        salt, [ADMIN_ADDRESS]
    )
    
    if not addr1:
        print("Trying with no constructor args...")
        addr1 = await deploy_via_udc(
            account, "AgentIdentity", AGENT_IDENTITY_HASH,
            salt + 1, []
        )
    
    # Deploy ValidationProofRegistry
    addr2 = await deploy_via_udc(
        account, "ValidationProofRegistry", VALIDATION_REGISTRY_HASH,
        salt + 2, [ADMIN_ADDRESS]
    )
    
    if not addr2:
        print("Trying with no constructor args...")
        addr2 = await deploy_via_udc(
            account, "ValidationProofRegistry", VALIDATION_REGISTRY_HASH,
            salt + 3, []
        )
    
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    if addr1:
        print(f"AGENT_IDENTITY_ADDRESS={hex(addr1)}")
    if addr2:
        print(f"VALIDATION_PROOF_REGISTRY_ADDRESS={hex(addr2)}")
    
    # Save to env-like format
    with open("/opt/obsqra.starknet/zkdefi/contracts/.new_deployments.env", "w") as f:
        if addr1:
            f.write(f"AGENT_IDENTITY_ADDRESS={hex(addr1)}\n")
        if addr2:
            f.write(f"VALIDATION_PROOF_REGISTRY_ADDRESS={hex(addr2)}\n")
    print("\nSaved to .new_deployments.env")


if __name__ == "__main__":
    asyncio.run(main())
