#!/usr/bin/env python3
"""
Deploy Agent System Contracts to Starknet Sepolia.

Deploys 7 contracts in dependency order:
  1. ValidationProofRegistry  (no deps)
  2. ConstraintReceipt        (no deps)
  3. AllocationRouter          (needs: token)
  4. ReputationRegistry        (needs: fact_registry, token, admin, min_collateral)
  5. BatchVerifier             (needs: reputation_registry, fact_registry, admin, slash)
  6. AgentIdentity             (needs: admin, reputation_registry)
  7. TieredAgentController     (needs: reputation, allocation, batch, fact, garaga, perceptron, admin)

Usage:
  python deploy_agent_system.py

Reads deployer credentials from backend/.env.
Writes results to deploy_agent_system_results.json.
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

# Load .env
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / "backend" / ".env")

PROJECT_ROOT = Path(__file__).parent
CONTRACTS_DEV = PROJECT_ROOT / "contracts" / "target" / "dev"
RESULTS_FILE = PROJECT_ROOT / "deploy_agent_system_results.json"

# ── Config ───────────────────────────────────────────────────────────────────
RPC_URL = os.getenv("STARKNET_RPC_URL_V08", "https://api.cartridge.gg/x/starknet/sepolia")
DEPLOYER_ADDRESS = os.getenv(
    "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS",
    "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
)
DEPLOYER_PRIVATE_KEY = os.getenv(
    "FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY",
    "",
)
# Known Sepolia addresses
ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
# Use the existing obsqra fact registry or mock; 0x0 = mock for now
FACT_REGISTRY = os.getenv("FACT_REGISTRY_ADDRESS", "0x0")
# Existing Garaga verifier
GARAGA_VERIFIER = os.getenv(
    "GARAGA_VERIFIER_ADDRESS",
    "0x0",  # will read from frontend env if set
)
# Cairo Perceptron
CAIRO_PERCEPTRON = "0x0"  # will be filled from frontend .env if available


def load_frontend_env():
    """Try to load additional addresses from frontend .env.local."""
    global GARAGA_VERIFIER, CAIRO_PERCEPTRON
    fe_env = PROJECT_ROOT / "frontend" / ".env.local"
    if fe_env.exists():
        for line in fe_env.read_text().splitlines():
            if line.startswith("NEXT_PUBLIC_CAIRO_PERCEPTRON_ADDRESS="):
                CAIRO_PERCEPTRON = line.split("=", 1)[1].strip()
            if line.startswith("NEXT_PUBLIC_GARAGA_VERIFIER_ADDRESS="):
                GARAGA_VERIFIER = line.split("=", 1)[1].strip()


def load_contract(name: str) -> tuple[str, str]:
    """Load sierra + casm JSON for a compiled contract.  Returns (sierra_str, casm_str)."""
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

    load_frontend_env()

    if not DEPLOYER_PRIVATE_KEY:
        logger.error("No deployer private key found. Set FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY in backend/.env")
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
    # Resume support: load partial results from previous run
    if RESULTS_FILE.exists():
        try:
            results = json.loads(RESULTS_FILE.read_text())
            logger.info(f"Loaded {len(results)} previously deployed contracts from {RESULTS_FILE}")
        except Exception:
            pass
    admin = int(DEPLOYER_ADDRESS, 16)

    # Helper to declare + deploy
    async def declare_and_deploy(
        contract_name: str,
        constructor_calldata: list[int],
    ) -> str:
        """Declare a contract class, then deploy with UDC. Returns deployed address hex."""
        # Skip if already deployed
        if contract_name in results and "address" in results[contract_name]:
            addr = results[contract_name]["address"]
            logger.info(f"Skipping {contract_name} — already deployed at {addr}")
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
                # Extract class hash from error: "Class with hash 0x... is already declared."
                import re as _re
                m = _re.search(r"0x[0-9a-fA-F]+", err_str)
                if m:
                    class_hash = int(m.group(), 16)
                    logger.info(f"  Class already declared, using hash: {hex(class_hash)}")
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
        }
        # Save incrementally
        RESULTS_FILE.write_text(json.dumps(results, indent=2))
        return addr_hex

    try:
        # 1. ValidationProofRegistry (admin)
        vpr_addr = await declare_and_deploy("ValidationProofRegistry", [admin])

        # 2. ConstraintReceipt (admin)
        cr_addr = await declare_and_deploy("ConstraintReceipt", [admin])

        # 3. AllocationRouter (admin, token)
        ar_addr = await declare_and_deploy("AllocationRouter", [admin, int(ETH_TOKEN, 16)])

        # 4. ReputationRegistry (fact_registry, collateral_token, admin, min_collateral)
        #    min_collateral = 0.001 ETH = 1e15 wei;  u256 = (low, high)
        min_collateral_low = int(1e15)
        min_collateral_high = 0
        fact_reg = int(FACT_REGISTRY, 16) if FACT_REGISTRY != "0x0" else admin  # use admin as placeholder
        rr_addr = await declare_and_deploy("ReputationRegistry", [
            fact_reg, int(ETH_TOKEN, 16), admin, min_collateral_low, min_collateral_high
        ])

        # 5. BatchVerifier (reputation_registry, fact_registry, admin, slash_amount)
        #    slash_amount = 0.0005 ETH = 5e14
        slash_low = int(5e14)
        slash_high = 0
        bv_addr = await declare_and_deploy("BatchVerifier", [
            int(rr_addr, 16), fact_reg, admin, slash_low, slash_high
        ])

        # 6. AgentIdentity (admin, reputation_registry)
        ai_addr = await declare_and_deploy("AgentIdentity", [admin, int(rr_addr, 16)])

        # 7. TieredAgentController (reputation, allocation, batch, fact, garaga, perceptron, admin)
        garaga_int = int(GARAGA_VERIFIER, 16) if GARAGA_VERIFIER != "0x0" else admin
        perceptron_int = int(CAIRO_PERCEPTRON, 16) if CAIRO_PERCEPTRON != "0x0" else admin
        tac_addr = await declare_and_deploy("TieredAgentController", [
            int(rr_addr, 16),
            int(ar_addr, 16),
            int(bv_addr, 16),
            fact_reg,
            garaga_int,
            perceptron_int,
            admin,
        ])

        logger.info("=" * 60)
        logger.info("Deployment complete!")
        logger.info(json.dumps(results, indent=2))
        logger.info(f"Results saved to {RESULTS_FILE}")

        # Append to backend/.env
        env_lines = [
            f"\n# Agent System Contracts (deployed {time.strftime('%Y-%m-%d')})",
            f"VALIDATION_PROOF_REGISTRY_ADDRESS={vpr_addr}",
            f"CONSTRAINT_RECEIPT_ADDRESS={cr_addr}",
            f"ALLOCATION_ROUTER_ADDRESS={ar_addr}",
            f"REPUTATION_REGISTRY_ADDRESS={rr_addr}",
            f"BATCH_VERIFIER_ADDRESS={bv_addr}",
            f"AGENT_IDENTITY_ADDRESS={ai_addr}",
            f"TIERED_AGENT_CONTROLLER_ADDRESS={tac_addr}",
        ]
        with open(PROJECT_ROOT / "backend" / ".env", "a") as f:
            f.write("\n".join(env_lines) + "\n")
        logger.info("Updated backend/.env with new addresses")

    except Exception as exc:
        logger.error(f"Deployment failed: {exc}")
        if results:
            logger.info(f"Partial results saved to {RESULTS_FILE}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
