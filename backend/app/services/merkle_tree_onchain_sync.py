"""
Register backend merkle root on the on-chain merkle tree via add_known_root()
so withdrawals with the backend's BN254 Poseidon root are accepted.

Why this is needed:
  - On-chain merkle tree uses Cairo-native Poseidon for internal hashing.
  - Backend uses circomlib BN254 Poseidon (for ZK circuit compatibility).
  - Same leaves → different roots → on-chain rejects backend root.
  - add_known_root() lets us register the backend root into the on-chain
    root history so is_known_root() succeeds during withdraw.

Uses starkli (CLI) because starknet_py 0.23 doesn't support the v3 tx format
required by current Starknet Sepolia RPCs (l1_data_gas field).
"""

import asyncio
import logging
import os
import shutil
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# RPC must be v0_8 for starkli 0.8.x (v3 transactions with l1_data_gas)
STARKNET_RPC_URL_V08 = os.getenv(
    "STARKNET_RPC_URL_V08",
    "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/EvhYN6geLrdvbYHVRgPJ7",
)
MERKLE_TREE_ADDRESS = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADDRESS")
MERKLE_TREE_ADMIN_PRIVATE_KEY = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY")
MERKLE_TREE_ADMIN_ADDRESS = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS")

# Cached account file path (fetched on first use)
_ACCOUNT_FILE = "/tmp/zkdefi_merkle_admin_account.json"
_account_fetched = False


def _root_to_felt252(root: int) -> int:
    from .circomlib_poseidon import STARK_PRIME
    return root % STARK_PRIME


def _ensure_account_file() -> bool:
    """Fetch account config from chain if not cached."""
    global _account_fetched
    if _account_fetched and os.path.exists(_ACCOUNT_FILE):
        return True
    if not MERKLE_TREE_ADMIN_ADDRESS:
        return False
    starkli = shutil.which("starkli")
    if not starkli:
        logger.warning("starkli not found in PATH — cannot sync merkle root on-chain")
        return False
    try:
        result = subprocess.run(
            [
                starkli, "account", "fetch",
                "--rpc", STARKNET_RPC_URL_V08,
                MERKLE_TREE_ADMIN_ADDRESS,
                "--output", _ACCOUNT_FILE,
            ],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0:
            _account_fetched = True
            return True
        # Account file may already exist from a previous fetch
        if os.path.exists(_ACCOUNT_FILE):
            _account_fetched = True
            return True
        logger.warning("starkli account fetch failed: %s", result.stderr)
        return False
    except Exception as e:
        logger.warning("starkli account fetch error: %s", e)
        return False


async def register_root_on_chain(root: int) -> bool:
    """
    Call add_known_root(root_felt) on the merkle tree contract via starkli.
    Returns True if the call was sent (or skipped because not configured), False on error.
    """
    if not MERKLE_TREE_ADDRESS or not MERKLE_TREE_ADMIN_PRIVATE_KEY or not MERKLE_TREE_ADMIN_ADDRESS:
        logger.debug("Merkle on-chain sync not configured — skipping add_known_root")
        return True

    starkli = shutil.which("starkli")
    if not starkli:
        logger.warning("starkli not found — cannot register root on-chain")
        return False

    if not _ensure_account_file():
        logger.warning("Could not obtain starkli account file — cannot register root on-chain")
        return False

    root_felt = _root_to_felt252(root)
    root_hex = hex(root_felt)

    try:
        # Run starkli invoke in a thread to avoid blocking the event loop
        def _invoke():
            result = subprocess.run(
                [
                    starkli, "invoke",
                    "--rpc", STARKNET_RPC_URL_V08,
                    "--private-key", MERKLE_TREE_ADMIN_PRIVATE_KEY,
                    "--account", _ACCOUNT_FILE,
                    MERKLE_TREE_ADDRESS,
                    "add_known_root",
                    root_hex,
                ],
                capture_output=True, text=True, timeout=30,
            )
            return result

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _invoke)

        if result.returncode == 0:
            # Parse tx hash from output
            output = result.stdout.strip()
            logger.info("add_known_root tx submitted: %s (root=%s)", output, root_hex)
            return True
        else:
            logger.warning("add_known_root failed (exit %d): %s", result.returncode, result.stderr.strip())
            return False
    except Exception as e:
        logger.warning("add_known_root error: %s", e)
        return False


def schedule_register_root_on_chain(root: int) -> None:
    """Fire-and-forget: schedule add_known_root in the event loop."""
    logger.info("schedule_register_root_on_chain called with root=%s", hex(root))
    if not MERKLE_TREE_ADDRESS or not MERKLE_TREE_ADMIN_PRIVATE_KEY or not MERKLE_TREE_ADMIN_ADDRESS:
        logger.info("Merkle on-chain sync not configured — skipping (ADDR=%s, KEY=%s, ADMIN=%s)",
                     bool(MERKLE_TREE_ADDRESS), bool(MERKLE_TREE_ADMIN_PRIVATE_KEY), bool(MERKLE_TREE_ADMIN_ADDRESS))
        return
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            logger.info("Creating async task for add_known_root")
            loop.create_task(register_root_on_chain(root))
        else:
            logger.info("Running add_known_root synchronously (no running loop)")
            asyncio.run(register_root_on_chain(root))
    except RuntimeError as e:
        logger.warning("Event loop error, running synchronously: %s", e)
        asyncio.run(register_root_on_chain(root))
