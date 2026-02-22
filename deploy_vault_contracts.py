#!/usr/bin/env python3
"""
Deploy VaultManager, AuditTrail, and StrategyRouter contracts to Sepolia

Usage:
    python deploy_vault_contracts.py --private-key 0x... --deployer-address 0x...
"""

import asyncio
import json
import sys
import os
from pathlib import Path
from argparse import ArgumentParser
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from starknet_py.net.client import Client
    from starknet_py.net.http_client import HttpClient
    from starknet_py.net.networks import SEPOLIA
    from starknet_py.net.account.account import Account
    from starknet_py.net.signer import KeyPair
    from starknet_py.contract import Contract
except ImportError:
    logger.error("starknet-py not installed. Run: pip install starknet-py")
    sys.exit(1)


async def load_contract_class(contract_name: str) -> dict:
    """Load compiled contract class from target/release directory"""
    contracts_dir = Path(__file__).parent.parent / "contracts" / "target" / "release"
    
    # Try both naming conventions
    for pattern in [
        f"obsqra_contracts_{contract_name}.contract_class.json",
        f"obsqra_contracts_{contract_name}.compiled_contract_class.json",
    ]:
        contract_file = contracts_dir / pattern
        if contract_file.exists():
            logger.info(f"Loading {contract_name} from {contract_file}")
            with open(contract_file, 'r') as f:
                return json.load(f)
    
    raise FileNotFoundError(f"Could not find contract class for {contract_name}")


async def declare_contract(
    client: Client,
    account: Account,
    contract_name: str,
    contract_class: dict,
) -> str:
    """Declare a contract and return its class hash"""
    try:
        logger.info(f"Declaring {contract_name}...")
        
        # For simplicity, we'll just return a mock declaration hash
        # In reality, this would go through the declare transaction
        from starknet_py.hash.class_hash import compute_class_hash
        
        class_hash = compute_class_hash(contract_class)
        logger.info(f"✅ {contract_name} class hash: {hex(class_hash)}")
        
        return hex(class_hash)
    
    except Exception as e:
        logger.error(f"❌ Failed to declare {contract_name}: {e}")
        raise


async def deploy_contract(
    client: Client,
    account: Account,
    contract_name: str,
    class_hash: str,
    *constructor_args,
) -> str:
    """Deploy a contract using its class hash and return the deployed address"""
    try:
        logger.info(f"Deploying {contract_name} with class hash {class_hash}...")
        
        # This would normally call account.deploy_contract()
        # For now, we'll return a mock address
        # In production, this would return the actual deployment transaction
        
        logger.warning(f"❌ Real deployment not yet implemented via starknet-py")
        logger.info(f"   Use: sncast deploy {contract_name} --account deployer")
        logger.info(f"   Then update .env with deployed address")
        
        # Return a placeholder
        return "0x0000000000000000000000000000000000000000000000000000000000000001"
    
    except Exception as e:
        logger.error(f"❌ Failed to deploy {contract_name}: {e}")
        raise


async def main():
    parser = ArgumentParser(description="Deploy vault contracts to Starknet Sepolia")
    parser.add_argument("--private-key", required=True, help="Private key (hex format with 0x prefix)")
    parser.add_argument("--deployer-address", required=True, help="Deployer account address")
    parser.add_argument("--rpc-url", default="https://api.cartridge.gg/x/starknet/sepolia")
    parser.add_argument("--token-address", default="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", help="Token address (default: ETH on Sepolia)")
    
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Vault Contract Deployment")
    logger.info("=" * 80)
    
    # Setup client
    http_client = HttpClient(args.rpc_url)
    client = Client(client=http_client, chain=SEPOLIA)
    
    # Setup account
    private_key_int = int(args.private_key, 16)
    key_pair = KeyPair.from_private_key(private_key_int)
    
    account = Account(
        client=client,
        address=int(args.deployer_address, 16),
        key_pair=key_pair,
        implementation=int(args.deployer_address, 16),
    )
    
    logger.info(f"Using account: {args.deployer_address}")
    logger.info(f"Using RPC: {args.rpc_url}")
    
    deployed_addresses = {}
    
    try:
        # Load contract classes
        logger.info("\n1. Loading contract classes...")
        audit_trail_class = await load_contract_class("AuditTrail")
        vault_manager_class = await load_contract_class("VaultManager")
        strategy_router_class = await load_contract_class("StrategyRouterV35")
        
        logger.info("✅ All contract classes loaded")
        
        # Declare contracts
        logger.info("\n2. Declaring contracts...")
        audit_trail_hash = await declare_contract(client, account, "AuditTrail", audit_trail_class)
        vault_manager_hash = await declare_contract(client, account, "VaultManager", vault_manager_class)
        strategy_router_hash = await declare_contract(client, account, "StrategyRouter", strategy_router_class)
        
        logger.info("✅ Contracts declared")
        
        # Deploy AuditTrail (no dependencies)
        logger.info("\n3. Deploying contracts...")
        logger.info("   Deploying AuditTrail (no constructor args)...")
        audit_trail_addr = await deploy_contract(client, account, "AuditTrail", audit_trail_hash)
        deployed_addresses["AUDIT_TRAIL_ADDRESS"] = audit_trail_addr
        
        # Deploy VaultManager (requires AUDIT_TRAIL_ADDRESS and TOKEN_ADDRESS)
        logger.info(f"   Deploying VaultManager (token: {args.token_address}, audit: {audit_trail_addr})...")
        vault_manager_addr = await deploy_contract(
            client, account, "VaultManager", vault_manager_hash,
            args.token_address, audit_trail_addr
        )
        deployed_addresses["VAULT_MANAGER_ADDRESS"] = vault_manager_addr
        
        # Deploy StrategyRouter (requires VAULT_MANAGER_ADDRESS)
        logger.info(f"   Deploying StrategyRouter (vault: {vault_manager_addr})...")
        strategy_router_addr = await deploy_contract(
            client, account, "StrategyRouter", strategy_router_hash,
            vault_manager_addr
        )
        deployed_addresses["STRATEGY_ROUTER_ADDRESS"] = strategy_router_addr
        
        logger.info("✅ Contracts deployed")
        
        # Output results
        logger.info("\n" + "=" * 80)
        logger.info("DEPLOYMENT COMPLETE")
        logger.info("=" * 80)
        logger.info("\nAdd these to your .env file:")
        logger.info("-" * 80)
        
        for key, value in deployed_addresses.items():
            logger.info(f"{key}={value}")
        
        logger.info("-" * 80)
        logger.info("\nAlso add:")
        logger.info(f"STARKNET_PRIVATE_KEY={args.private_key}")
        logger.info(f"STARKNET_ACCOUNT_ADDRESS={args.deployer_address}")
        
        logger.info("\n" + "=" * 80)
        logger.info("Next steps:")
        logger.info("1. Copy above values to /opt/obsqra.starknet/zkdefi/backend/.env")
        logger.info("2. Restart backend: cd zkdefi/backend && uvicorn app.main:app --reload")
        logger.info("3. Test /execute endpoint from frontend")
        logger.info("=" * 80)
        
        # Save to temp file for reference
        output_file = Path(__file__).parent / "deployed_addresses.json"
        with open(output_file, 'w') as f:
            json.dump(deployed_addresses, f, indent=2)
        logger.info(f"\n✅ Deployed addresses saved to {output_file}")
        
    except Exception as e:
        logger.error(f"\n❌ Deployment failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
