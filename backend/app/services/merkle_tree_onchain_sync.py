"""
Register backend merkle root on the on-chain merkle tree via add_known_root()
so withdrawals with the backend's BN254 Poseidon root are accepted.

Why this is needed:
  - On-chain merkle tree uses Cairo-native Poseidon for internal hashing.
  - Backend uses circomlib BN254 Poseidon (for ZK circuit compatibility).
  - Same leaves -> different roots -> on-chain rejects backend root.
  - add_known_root() lets us register the backend root into the on-chain
    root history so is_known_root() succeeds during withdraw.

Architecture (after fix):
  - Registration is SYNCHRONOUS: register_commitment waits for on-chain confirmation.
  - Retries: transient starkli/RPC failures are retried with exponential backoff.
  - Env vars are read fresh each call (not cached at module import time).
  - Startup reconciliation: on backend start, all backend roots are checked and missing ones registered.

Uses sncast (CLI) to avoid nonce conflicts. sncast reads account config from
contracts/snfoundry.toml (deployer account).
"""

import asyncio
import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)

# Serialize all add_known_root calls to prevent nonce conflicts
# (startup reconciliation + deposit registration racing)
_registration_lock: asyncio.Lock | None = None


def _get_registration_lock() -> asyncio.Lock:
    """Lazily create the lock to avoid binding to the wrong event loop."""
    global _registration_lock
    if _registration_lock is None:
        _registration_lock = asyncio.Lock()
    return _registration_lock


def _get_config() -> dict:
    """
    Read merkle tree config fresh from env vars each call.
    NEVER cache at module level -- if backend restarts mid-process or
    .env wasn't loaded when the module was first imported, cached values
    would be permanently empty.
    """
    return {
        "rpc": os.getenv(
            "STARKNET_RPC_URL_V08",
            "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/EvhYN6geLrdvbYHVRgPJ7",
        ),
        "address": os.getenv("FULL_PRIVACY_MERKLE_TREE_ADDRESS", ""),
        "key": os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", ""),
        "admin": os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", ""),
    }


def _is_configured() -> bool:
    """Check if merkle tree admin is configured."""
    cfg = _get_config()
    return bool(cfg["address"] and cfg["key"] and cfg["admin"])


def _root_to_felt252(root: int) -> int:
    from .circomlib_poseidon import STARK_PRIME
    return root % STARK_PRIME


async def _starkli_add_known_root(root_felt: int) -> bool:
    """
    Single attempt to call add_known_root via sncast (avoids starkli nonce issues).
    Returns True if tx was submitted, False on error.
    """
    cfg = _get_config()
    sncast = shutil.which("sncast")
    if not sncast:
        logger.error("sncast not found in PATH")
        return False

    root_hex = hex(root_felt)
    
    # Use sncast from contracts dir with snfoundry.toml (has deployer account config)
    contracts_dir = os.path.join(os.path.dirname(__file__), "../../../contracts")
    if not os.path.exists(contracts_dir):
        logger.error("contracts dir not found: %s", contracts_dir)
        return False

    def _invoke():
        return subprocess.run(
            [
                sncast, "--profile", "sepolia",
                "invoke",
                "--contract-address", cfg["address"],
                "--function", "add_known_root",
                "--calldata", root_hex,
            ],
            capture_output=True, text=True, timeout=30,
            cwd=contracts_dir,
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _invoke)

        if result.returncode == 0:
            output = result.stdout.strip()
            logger.info("add_known_root tx submitted: %s (root=%s)", output, root_hex)
            return True
        else:
            stderr = result.stderr.strip()
            logger.warning("add_known_root failed (exit %d): %s", result.returncode, stderr)
            return False
    except Exception as e:
        logger.warning("add_known_root error: %s", e)
        return False


async def register_root_on_chain(root: int, max_retries: int = 5) -> bool:
    """
    Register a BN254 Poseidon root on-chain via add_known_root().

    Serialized with _registration_lock to prevent nonce conflicts between
    concurrent callers (e.g. startup reconciliation + deposit registration).
    Returns True on success, False on failure.
    """
    async with _get_registration_lock():
        return await _register_root_impl(root, max_retries)


async def _register_root_impl(root: int, max_retries: int) -> bool:
    if not _is_configured():
        logger.error(
            "CRITICAL: Merkle on-chain sync NOT configured! "
            "FULL_PRIVACY_MERKLE_TREE_ADDRESS=%s, KEY=%s, ADMIN=%s",
            bool(os.getenv("FULL_PRIVACY_MERKLE_TREE_ADDRESS")),
            bool(os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY")),
            bool(os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS")),
        )
        return False

    root_felt = _root_to_felt252(root)

    for attempt in range(max_retries):
        if attempt > 0:
            # Exponential backoff for nonce conflicts: 3s, 6s, 12s, 24s
            wait = 3 * (2 ** (attempt - 1))
            logger.info("Retrying add_known_root (attempt %d/%d) after %ds...", attempt + 1, max_retries, wait)
            await asyncio.sleep(wait)

        success = await _starkli_add_known_root(root_felt)
        if success:
            # Wait for block confirmation (Sepolia blocks ~6-12s).
            await asyncio.sleep(10)
            # Verify it actually landed on-chain (tx can fail due to nonce conflict
            # even though sncast returns exit 0)
            is_confirmed = await verify_root_on_chain(root)
            if is_confirmed:
                logger.info("Root confirmed on-chain: %s", hex(root_felt))
                return True
            else:
                logger.warning(
                    "Root NOT confirmed after submission (likely nonce conflict). "
                    "Will retry. root=%s", hex(root_felt),
                )

    logger.error(
        "FAILED to register root on-chain after %d retries. root=%s felt=%s",
        max_retries, hex(root), hex(root_felt),
    )
    return False


async def verify_root_on_chain(root: int) -> bool:
    """
    Check if a root is registered on-chain by calling is_known_root via sncast call.
    Returns True if the root is known, False otherwise.
    """
    cfg = _get_config()
    if not cfg["address"]:
        return False

    root_felt = _root_to_felt252(root)
    root_hex = hex(root_felt)

    sncast = shutil.which("sncast")
    if not sncast:
        logger.warning("sncast not found for verify_root_on_chain")
        return False

    contracts_dir = os.path.join(os.path.dirname(__file__), "../../../contracts")
    if not os.path.exists(contracts_dir):
        logger.error("contracts dir not found: %s", contracts_dir)
        return False

    def _call():
        return subprocess.run(
            [
                sncast, "--profile", "sepolia",
                "call",
                "--contract-address", cfg["address"],
                "--function", "is_known_root",
                "--calldata", root_hex,
            ],
            capture_output=True, text=True, timeout=15,
            cwd=contracts_dir,
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _call)

        if result.returncode == 0:
            output = result.stdout.strip()
            # sncast output: "Response:     true" and "Response Raw: [0x1]" for True
            # Parse strictly to avoid false positive (e.g. "0x1" in "0x10")
            if "Response Raw:" in output:
                raw = output.split("Response Raw:")[-1].strip()
                if raw == "[0x1]":
                    return True
                if raw == "[0x0]":
                    return False
            if output.lower().endswith("true"):
                return True
            if output.lower().endswith("false"):
                return False
            logger.warning("Could not parse is_known_root output: %s", output[:200])
            return False
        else:
            logger.warning("is_known_root call failed: %s", result.stderr.strip())
            return False
    except Exception as e:
        logger.warning("verify_root_on_chain error: %s", e)
        return False


async def check_nullifier_used_on_chain(nullifier: int) -> bool:
    """
    Check if a nullifier is already used on-chain by calling is_nullifier_used.
    Returns True if used, False otherwise. Returns False on error (fail-open).
    """
    cfg = _get_config()
    pool_address = os.getenv("FULL_PRIVACY_POOL_V2_ADDRESS", "")
    if not pool_address:
        logger.warning("FULL_PRIVACY_POOL_V2_ADDRESS not set, cannot check nullifier")
        return False

    from .circomlib_poseidon import STARK_PRIME
    nullifier_felt = nullifier % STARK_PRIME

    sncast = shutil.which("sncast")
    if not sncast:
        logger.warning("sncast not found for check_nullifier_used_on_chain")
        return False

    contracts_dir = os.path.join(os.path.dirname(__file__), "../../../contracts")
    if not os.path.exists(contracts_dir):
        return False

    def _call():
        return subprocess.run(
            [
                sncast, "--profile", "sepolia",
                "call",
                "--contract-address", pool_address,
                "--function", "is_nullifier_used",
                "--calldata", hex(nullifier_felt),
            ],
            capture_output=True, text=True, timeout=15,
            cwd=contracts_dir,
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _call)
        if result.returncode == 0:
            output = result.stdout.strip()
            if "0x1" in output or "true" in output.lower():
                logger.info("Nullifier %s IS used on-chain", hex(nullifier_felt)[:20])
                return True
            return False
        return False
    except Exception as e:
        logger.warning("check_nullifier_used error: %s", e)
        return False


async def reconcile_all_roots() -> dict:
    """
    Compare ALL backend merkle tree roots against on-chain state.
    Register any missing roots. Returns stats dict.

    Called on startup and can be called manually via API.
    """
    if not _is_configured():
        logger.warning("Merkle sync not configured, skipping reconciliation")
        return {"status": "skipped", "reason": "not_configured"}

    from .merkle_tree_service import get_merkle_tree

    tree = get_merkle_tree()
    all_roots = list(tree.roots)  # These are ints

    if not all_roots:
        return {"status": "ok", "total": 0, "missing": 0, "registered": 0}

    logger.info("Reconciling %d backend roots against on-chain state...", len(all_roots))

    missing = []
    checked = 0

    for root in all_roots:
        if root == 0:
            continue
        try:
            is_known = await verify_root_on_chain(root)
            checked += 1
            if not is_known:
                missing.append(root)
        except Exception as e:
            logger.warning("Error checking root %s: %s", hex(root), e)

    logger.info("Checked %d roots: %d missing", checked, len(missing))

    registered = 0
    for root in missing:
        logger.info("Registering missing root: %s", hex(root)[:30])
        success = await register_root_on_chain(root, max_retries=5)
        if success:
            registered += 1
        else:
            logger.error("Failed to register root: %s", hex(root)[:30])

    result = {
        "status": "ok",
        "total": len(all_roots),
        "checked": checked,
        "missing": len(missing),
        "registered": registered,
        "failed": len(missing) - registered,
    }
    logger.info("Reconciliation complete: %s", result)
    return result
