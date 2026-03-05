#!/usr/bin/env python3
"""
Deploy VaultController + Strategy Adapters to Starknet Sepolia.

Deploys 4 contracts in dependency order:
  1. VaultController         (admin, zkml_verifier, min_cooldown_seconds, eth_token)
  2. EkuboLpAdapter          (vault_controller, admin)
  3. LendingAdapter           (vault_controller, admin)
  4. StakingAdapter            (vault_controller, admin)

Then registers each adapter in VaultController with max_allocation_bps.

Usage:
  python deploy_vault_controller_system.py

Reads deployer credentials from backend/.env.
Writes results to deploy_vault_controller_results.json.
"""

import asyncio
import json
import os
import sys
import time
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / "backend" / ".env")

PROJECT_ROOT = Path(__file__).parent
CONTRACTS_DEV = PROJECT_ROOT / "contracts" / "target" / "dev"
RESULTS_FILE = PROJECT_ROOT / "deploy_vault_controller_results.json"

# ── Config ───────────────────────────────────────────────────────────────────
RPC_URL = os.getenv("EXECUTOR_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia")
DEPLOYER_ADDRESS = os.getenv(
    "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS",
    "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
)
DEPLOYER_PRIVATE_KEY = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", "")

# Starknet Sepolia well-known addresses
ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"

# Use existing Garaga verifier or deployer as placeholder for zkml_verifier
ZKML_VERIFIER = os.getenv("GARAGA_VERIFIER_ADDRESS", "0x0")

# Cooldown: 1800 seconds (30 minutes) between rebalances
MIN_COOLDOWN_SECONDS = 1800

# Adapter max allocation (in basis points): 4000 = 40%
EKUBO_MAX_BPS = 4000
LENDING_MAX_BPS = 3000
STAKING_MAX_BPS = 3000


def load_contract(name: str) -> tuple[str, str]:
    """Load sierra + casm JSON for a compiled contract."""
    sierra = CONTRACTS_DEV / f"zkdefi_contracts_{name}.contract_class.json"
    casm = CONTRACTS_DEV / f"zkdefi_contracts_{name}.compiled_contract_class.json"
    if not sierra.exists():
        raise FileNotFoundError(f"Missing sierra: {sierra}")
    if not casm.exists():
        raise FileNotFoundError(f"Missing casm: {casm}")
    return sierra.read_text(), casm.read_text()


async def main():
    from starknet_py.net.full_node_client import FullNodeClient
    from starknet_py.net.account.account import Account
    from starknet_py.net.models import StarknetChainId
    from starknet_py.contract import Contract
    from starknet_py.net.signer.stark_curve_signer import KeyPair
    from starknet_py.net.client_errors import ClientError

    if not DEPLOYER_PRIVATE_KEY:
        logger.error("No deployer private key. Set FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY in backend/.env")
        sys.exit(1)

    client = FullNodeClient(node_url=RPC_URL)
    key_pair = KeyPair.from_private_key(int(DEPLOYER_PRIVATE_KEY, 16))
    account = Account(
        address=int(DEPLOYER_ADDRESS, 16),
        client=client,
        key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA,
    )

    logger.info(f"Deployer: {DEPLOYER_ADDRESS}")
    logger.info(f"RPC: {RPC_URL}")

    results: dict[str, dict] = {}
    if RESULTS_FILE.exists():
        try:
            results = json.loads(RESULTS_FILE.read_text())
            logger.info(f"Loaded {len(results)} previously deployed contracts")
        except Exception:
            pass

    admin = int(DEPLOYER_ADDRESS, 16)

    async def declare_and_deploy(contract_name: str, constructor_calldata: list[int]) -> str:
        """Declare then deploy. Returns hex address."""
        if contract_name in results and "address" in results[contract_name]:
            addr = results[contract_name]["address"]
            logger.info(f"Skipping {contract_name} — already at {addr}")
            return addr

        sierra_str, casm_str = load_contract(contract_name)

        logger.info(f"Declaring {contract_name}...")
        try:
            declare_result = await Contract.declare_v3(
                account=account,
                compiled_contract=sierra_str,
                compiled_contract_casm=casm_str,
                auto_estimate=True,
            )
            await declare_result.wait_for_acceptance()
            class_hash = declare_result.class_hash
        except ClientError as e:
            err_str = str(e)
            if "already declared" in err_str:
                import re as _re
                m = _re.search(r"0x[0-9a-fA-F]+", err_str)
                if m:
                    class_hash = int(m.group(), 16)
                    logger.info(f"  Already declared: {hex(class_hash)}")
                else:
                    raise RuntimeError(f"Could not extract class hash from: {err_str}")
            else:
                raise
        logger.info(f"  Class hash: {hex(class_hash)}")

        logger.info(f"Deploying {contract_name}...")
        deploy_result = await Contract.deploy_contract_v3(
            account=account,
            class_hash=class_hash,
            constructor_args=constructor_calldata,
            auto_estimate=True,
        )
        await deploy_result.wait_for_acceptance()
        address = deploy_result.deployed_contract.address
        addr_hex = hex(address)
        logger.info(f"  Deployed at: {addr_hex}")

        results[contract_name] = {
            "class_hash": hex(class_hash),
            "address": addr_hex,
            "deployed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        RESULTS_FILE.write_text(json.dumps(results, indent=2))
        return addr_hex

    try:
        # Resolve zkml_verifier — use admin as stand-in if 0x0
        zkml_int = int(ZKML_VERIFIER, 16) if ZKML_VERIFIER != "0x0" else admin

        # 1. Deploy VaultController
        #    constructor(admin, zkml_verifier, min_cooldown_seconds, eth_token)
        vc_addr = await declare_and_deploy("VaultController", [
            admin,
            zkml_int,
            MIN_COOLDOWN_SECONDS,
            int(ETH_TOKEN, 16),
        ])
        vc_int = int(vc_addr, 16)

        # 2. Deploy EkuboLpAdapter(vault_controller, admin)
        ekubo_addr = await declare_and_deploy("EkuboLpAdapter", [vc_int, admin])

        # 3. Deploy LendingAdapter(vault_controller, admin)
        lending_addr = await declare_and_deploy("LendingAdapter", [vc_int, admin])

        # 4. Deploy StakingAdapter(vault_controller, admin)
        staking_addr = await declare_and_deploy("StakingAdapter", [vc_int, admin])

        # 5. Register adapters in VaultController
        logger.info("Registering adapters in VaultController...")

        vc_sierra_str, _ = load_contract("VaultController")
        vc_contract = await Contract.from_address(
            address=vc_int,
            provider=account,
        )

        for adapter_name, adapter_addr, max_bps in [
            ("EkuboLpAdapter", ekubo_addr, EKUBO_MAX_BPS),
            ("LendingAdapter", lending_addr, LENDING_MAX_BPS),
            ("StakingAdapter", staking_addr, STAKING_MAX_BPS),
        ]:
            registration_key = f"{adapter_name}_registered"
            if registration_key in results:
                logger.info(f"  {adapter_name} already registered, skipping")
                continue

            logger.info(f"  Registering {adapter_name} at {adapter_addr} (max {max_bps} bps)...")
            try:
                call = vc_contract.functions["register_adapter"].prepare_invoke_v3(
                    adapter=int(adapter_addr, 16),
                    max_bps=max_bps,
                    auto_estimate=True,
                )
                tx = await account.execute_v3(calls=[call], auto_estimate=True)
                await account.client.wait_for_tx(tx.transaction_hash)
                results[registration_key] = {
                    "tx_hash": hex(tx.transaction_hash),
                    "adapter": adapter_addr,
                    "max_bps": max_bps,
                }
                RESULTS_FILE.write_text(json.dumps(results, indent=2))
                logger.info(f"    Registered! TX: {hex(tx.transaction_hash)}")
            except Exception as e:
                logger.warning(f"    Registration failed (may already be registered): {e}")

        logger.info("=" * 60)
        logger.info("VaultController System Deployment Complete!")
        logger.info(json.dumps(results, indent=2))

        # Update backend .env
        env_additions = [
            f"\n# VaultController System (deployed {time.strftime('%Y-%m-%d')})",
            f"VAULT_CONTROLLER_ADDRESS={vc_addr}",
            f"EKUBO_LP_ADAPTER_ADDRESS={ekubo_addr}",
            f"LENDING_ADAPTER_ADDRESS={lending_addr}",
            f"STAKING_ADAPTER_ADDRESS={staking_addr}",
        ]
        with open(PROJECT_ROOT / "backend" / ".env", "a") as f:
            f.write("\n".join(env_additions) + "\n")
        logger.info("Updated backend/.env with VaultController addresses")

        # Update frontend .env.local
        fe_env = PROJECT_ROOT / "frontend" / ".env.local"
        fe_additions = [
            f"\n# VaultController System (deployed {time.strftime('%Y-%m-%d')})",
            f"NEXT_PUBLIC_VAULT_CONTROLLER_ADDRESS={vc_addr}",
            f"NEXT_PUBLIC_EKUBO_LP_ADAPTER_ADDRESS={ekubo_addr}",
            f"NEXT_PUBLIC_LENDING_ADAPTER_ADDRESS={lending_addr}",
            f"NEXT_PUBLIC_STAKING_ADAPTER_ADDRESS={staking_addr}",
        ]
        with open(fe_env, "a") as f:
            f.write("\n".join(fe_additions) + "\n")
        logger.info("Updated frontend/.env.local with VaultController addresses")

    except Exception as exc:
        logger.error(f"Deployment failed: {exc}")
        if results:
            logger.info(f"Partial results saved to {RESULTS_FILE}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
