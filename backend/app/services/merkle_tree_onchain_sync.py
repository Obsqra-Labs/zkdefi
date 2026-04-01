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
import json
import logging
import os
import re
from pathlib import Path

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


def _resolve_starkli_account_path(admin_addr: str) -> str | None:
    """Resolve a starkli account JSON path for the admin address."""
    try:
        admin_int = int(admin_addr, 16) if admin_addr.startswith("0x") else int(admin_addr)
    except Exception:
        admin_int = None

    env_path = os.getenv("STARKLI_ACCOUNT_PATH") or os.getenv("STARKNET_ACCOUNT")
    if env_path and os.path.exists(env_path):
        return env_path

    wallets_dir = Path("/root/.starkli-wallets")
    if not wallets_dir.exists():
        return None

    for filename in ("account.json", "account_fetched.json"):
        for path in wallets_dir.rglob(filename):
            try:
                data = json.loads(path.read_text())
            except Exception:
                continue
            addr = (
                data.get("address")
                or data.get("account_address")
                or (data.get("deployment") or {}).get("address")
            )
            if not addr:
                continue
            try:
                addr_int = int(addr, 16) if addr.startswith("0x") else int(addr)
            except Exception:
                continue
            if admin_int is not None and addr_int == admin_int:
                return str(path)
    return None


def _starkli_env(cfg: dict, account_path: str | None) -> dict:
    env = os.environ.copy()
    # Avoid conflicting signer sources inherited from the process environment.
    env.pop("STARKNET_KEYSTORE", None)
    env.pop("STARKNET_KEYSTORE_PASSWORD", None)
    env.pop("STARKNET_KEYSTORE_PASSWORD_FILE", None)
    if cfg.get("rpc"):
        env["STARKNET_RPC"] = cfg["rpc"]
    if account_path:
        env["STARKNET_ACCOUNT"] = account_path
    if cfg.get("key"):
        env["STARKNET_PRIVATE_KEY"] = cfg["key"]
    return env


def _extract_tx_hash(output: str) -> str | None:
    match = re.search(r"0x[0-9a-fA-F]{64}", output)
    return match.group(0) if match else None


async def _wait_for_tx(tx_hash: str, timeout_s: int = 600) -> bool:
    """Poll tx status via starknet.py until SUCCEEDED/ACCEPTED or timeout.
    Uses a 600s default (Sepolia can take 3-10 minutes to finalize).
    """
    if tx_hash == "pending":
        # tx already existed in mempool – rely on verify_root_on_chain check
        return True
    try:
        import warnings as _w
        _w.filterwarnings("ignore")
        from starknet_py.net.full_node_client import FullNodeClient as _FNC
    except ImportError:
        return False

    cfg = _get_config()
    rpc_url = cfg.get("rpc") or "https://api.cartridge.gg/x/starknet/sepolia"
    try:
        client = _FNC(node_url=rpc_url)
        tx_int = int(tx_hash, 16)
        deadline = asyncio.get_event_loop().time() + timeout_s
        while asyncio.get_event_loop().time() < deadline:
            try:
                status = await client.get_transaction_status(tx_int)
                s = str(status).lower()
                logger.debug("tx-status %s: %s", tx_hash[:20], s[:80])
                if "succeeded" in s or "accepted" in s:
                    return True
                if "rejected" in s or "reverted" in s or "error" in s:
                    logger.warning("add_known_root tx failed: %s", status)
                    return False
            except Exception as e:
                if "not found" not in str(e).lower():
                    logger.debug("tx poll error: %s", e)
            await asyncio.sleep(15)
        return False
    except Exception as e:
        logger.warning("_wait_for_tx error: %s", e)
        return False


async def _starkli_add_known_root(root_felt: int) -> str | None:
    """
    Submit add_known_root via starknet.py (replaces sncast which had RPC
    version mismatches and 90-second timeouts that never survived Sepolia).
    Returns tx hash hex string, 'pending' if already in pool, or None on error.
    """
    try:
        import warnings as _w
        _w.filterwarnings("ignore")
        from starknet_py.net.full_node_client import FullNodeClient as _FNC
        from starknet_py.net.account.account import Account as _Acct
        from starknet_py.net.models import StarknetChainId as _Chain
        from starknet_py.net.signer.stark_curve_signer import KeyPair as _KP
        from starknet_py.hash.selector import get_selector_from_name as _sel
        from starknet_py.net.client_models import Call as _Call, ResourceBoundsMapping as _RBM
    except ImportError:
        logger.error("starknet_py not installed; cannot submit add_known_root")
        return None

    cfg = _get_config()
    rpc_url = cfg.get("rpc") or "https://api.cartridge.gg/x/starknet/sepolia"
    try:
        admin_int = int(cfg["admin"], 16) if cfg["admin"].startswith("0x") else int(cfg["admin"])
        key_int   = int(cfg["key"],   16) if cfg["key"].startswith("0x")   else int(cfg["key"])
        tree_int  = int(cfg["address"], 16) if cfg["address"].startswith("0x") else int(cfg["address"])
    except Exception:
        logger.error("Invalid merkle sync config values")
        return None

    try:
        client  = _FNC(node_url=rpc_url)
        account = _Acct(
            address  = admin_int,
            client   = client,
            key_pair = _KP.from_private_key(key_int),
            chain    = _Chain.SEPOLIA,
        )
        # Pre-set cairo_version=1 to skip the get_class_at("pending") RPC call
        # that starknet_py makes by default — cartridge.gg rejects "pending" block.
        # All modern Starknet accounts (OZ ≥0.6, Argent ≥0.3) are Cairo 1.
        account._cairo_version = 1
        selector = _sel("add_known_root")
        call     = _Call(to_addr=tree_int, selector=selector, calldata=[root_felt])
        # Manually estimate fee with block_number="latest" to avoid cartridge.gg
        # rejecting the default "pending" block tag (code -32602). starknet_py 0.27+
        # uses resource_bounds (ResourceBoundsMapping with l1_data_gas).
        # Pre-set cairo_version=1 prevents get_class_at("pending") RPC call.
        # Get nonce with "latest" block so _prepare_invoke_v3 doesn't call get_nonce().
        # Retry with nonce refresh on stale-nonce errors (shared wallet scenario).
        for nonce_attempt in range(4):
            nonce    = await asyncio.wait_for(account.get_nonce(block_number="latest"), timeout=15.0)
            try:
                draft_tx = await asyncio.wait_for(
                    account._prepare_invoke_v3(
                        [call], resource_bounds=_RBM.init_with_zeros(), nonce=nonce
                    ),
                    timeout=15.0,
                )
                # Pass the unsigned draft to estimate_fee — it signs internally with QUERY version.
                estimated = await asyncio.wait_for(
                    account.estimate_fee(draft_tx, block_number="latest"),
                    timeout=15.0,
                )
                rbm       = estimated.to_resource_bounds()
                tx        = await asyncio.wait_for(
                    account.execute_v3(calls=call, resource_bounds=rbm, nonce=nonce),
                    timeout=15.0,
                )
                tx_hash  = hex(tx.transaction_hash)
                logger.info("add_known_root submitted via starknet.py: %s (root_felt=%s)", tx_hash, hex(root_felt))
                return tx_hash
            except Exception as inner_e:
                inner_err = str(inner_e).lower()
                if ("nonce" in inner_err or "invalid transaction" in inner_err) and nonce_attempt < 3:
                    wait = 15 * (nonce_attempt + 1)
                    logger.info("add_known_root nonce stale (attempt %d/4), waiting %ds...", nonce_attempt + 1, wait)
                    await asyncio.sleep(wait)
                    continue
                raise inner_e
    except Exception as e:
        err = str(e).lower()
        if "already exists" in err or "duplicate" in err or "transaction already" in err:
            # A tx for this root is already in the mempool (same nonce + same calldata)
            logger.info("add_known_root tx already pending in mempool for root_felt=%s", hex(root_felt))
            return "pending"
        logger.warning("add_known_root starknet.py error: %s", e)
        return None


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
        # Always check if root is already on-chain before submitting a new tx
        if await verify_root_on_chain(root):
            logger.info("Root already confirmed on-chain: %s", hex(root_felt))
            return True

        if attempt > 0:
            # Exponential backoff: 30s, 60s, 120s, 240s — giving Sepolia time
            wait = 30 * (2 ** (attempt - 1))
            logger.info("Retrying add_known_root (attempt %d/%d) after %ds...", attempt + 1, max_retries, wait)
            await asyncio.sleep(wait)

        tx_hash = await _starkli_add_known_root(root_felt)
        if tx_hash:
            # Poll both tx status AND is_known_root for up to 10 minutes.
            # cartridge.gg sometimes reports old confirmed txs as "not found",
            # so we always cross-check via verify_root_on_chain.
            accepted = await _wait_for_tx(tx_hash, timeout_s=600)
            # After waiting, check on-chain state directly
            for _ in range(10):
                is_confirmed = await verify_root_on_chain(root)
                if is_confirmed:
                    logger.info("Root confirmed on-chain: %s", hex(root_felt))
                    return True
                await asyncio.sleep(6)
            if accepted:
                logger.warning("Root NOT confirmed via is_known_root after tx accepted. Will retry. root=%s", hex(root_felt))
            else:
                logger.warning("Root tx status unclear / timed out. Will retry. tx=%s root=%s", tx_hash, hex(root_felt))


    logger.error(
        "FAILED to register root on-chain after %d retries. root=%s felt=%s",
        max_retries, hex(root), hex(root_felt),
    )
    return False


async def verify_root_on_chain(root: int) -> bool:
    """
    Check if a root is registered on-chain via starknet.py (replaced sncast
    which had RPC version mismatch issues).
    Returns True if the root is known, False otherwise.
    """
    cfg = _get_config()
    if not cfg["address"]:
        return False

    root_felt = _root_to_felt252(root)
    try:
        import warnings as _w
        _w.filterwarnings("ignore")
        from starknet_py.net.full_node_client import FullNodeClient as _FNC
        from starknet_py.hash.selector import get_selector_from_name as _sel
        from starknet_py.net.client_models import Call as _Call
    except ImportError:
        logger.warning("starknet_py not installed, cannot verify root on-chain")
        return False

    rpc_url = cfg.get("rpc") or "https://api.cartridge.gg/x/starknet/sepolia"
    try:
        client = _FNC(node_url=rpc_url)
        tree_int = int(cfg["address"], 16) if cfg["address"].startswith("0x") else int(cfg["address"])
        result = await asyncio.wait_for(
            client.call_contract(
                _Call(
                    to_addr   = tree_int,
                    selector  = _sel("is_known_root"),
                    calldata  = [root_felt],
                ),
                block_number="latest",
            ),
            timeout=10.0,
        )
        # result is a list of ints; [1] = true, [0] = false
        return bool(result and result[0] == 1)
    except Exception as e:
        logger.warning("verify_root_on_chain error: %s", e)
        return False


async def check_nullifier_used_on_chain(nullifier: int) -> bool:
    """
    Check if a nullifier is already used on-chain via starknet.py call_contract.
    Returns True if used, False otherwise.  Returns False on error (fail-open).
    """
    cfg = _get_config()
    pool_address = os.getenv("FULL_PRIVACY_POOL_V2_ADDRESS", "")
    if not pool_address:
        logger.warning("FULL_PRIVACY_POOL_V2_ADDRESS not set, cannot check nullifier")
        return False

    from .circomlib_poseidon import STARK_PRIME
    nullifier_felt = nullifier % STARK_PRIME

    try:
        import warnings as _w
        _w.filterwarnings("ignore")
        from starknet_py.net.full_node_client import FullNodeClient as _FNC
        from starknet_py.hash.selector import get_selector_from_name as _sel
        from starknet_py.net.client_models import Call as _Call
    except ImportError:
        logger.warning("starknet_py not installed, cannot check nullifier on-chain")
        return False

    rpc_url = cfg.get("rpc") or "https://api.cartridge.gg/x/starknet/sepolia"
    try:
        pool_int = int(pool_address, 16) if pool_address.startswith("0x") else int(pool_address)
        client = _FNC(node_url=rpc_url)
        result = await client.call_contract(
            _Call(
                to_addr  = pool_int,
                selector = _sel("is_nullifier_used"),
                calldata = [nullifier_felt],
            ),
            block_number="latest",
        )
        used = bool(result and result[0] == 1)
        if used:
            logger.info("Nullifier %s IS used on-chain", hex(nullifier_felt)[:20])
        return used
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
