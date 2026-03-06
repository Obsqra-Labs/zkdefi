# Source Generated with Decompyle++
# File: merkle_tree_onchain_sync.cpython-312.pyc (Python 3.12)

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
_registration_lock: asyncio.Lock | None = None

def _get_registration_lock():
    '''Lazily create the lock to avoid binding to the wrong event loop.'''
    pass
# WARNING: Decompyle incomplete


def _get_config():
    """
    Read merkle tree config fresh from env vars each call.
    NEVER cache at module level -- if backend restarts mid-process or
    .env wasn't loaded when the module was first imported, cached values
    would be permanently empty.
    """
    return {
        'rpc': os.getenv('STARKNET_RPC_URL_V08', 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/EvhYN6geLrdvbYHVRgPJ7'),
        'address': os.getenv('FULL_PRIVACY_MERKLE_TREE_ADDRESS', ''),
        'key': os.getenv('FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY', ''),
        'admin': os.getenv('FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS', '') }


def _is_configured():
    '''Check if merkle tree admin is configured.'''
    cfg = _get_config()
    if cfg['address']:
        cfg['address']
        if cfg['key']:
            cfg['key']
    return bool(cfg['admin'])


def _root_to_felt252(root = None):
    STARK_PRIME = STARK_PRIME
    import circomlib_poseidon
    return root % STARK_PRIME


def _resolve_starkli_account_path(admin_addr = None):
    '''Resolve a starkli account JSON path for the admin address.'''
    admin_int = int(admin_addr, 16) if admin_addr.startswith('0x') else int(admin_addr)
    if not os.getenv('STARKLI_ACCOUNT_PATH'):
        os.getenv('STARKLI_ACCOUNT_PATH')
    env_path = os.getenv('STARKNET_ACCOUNT')
    if env_path and os.path.exists(env_path):
        return env_path
    wallets_dir = None('/root/.starkli-wallets')
    if not wallets_dir.exists():
        return None
# WARNING: Decompyle incomplete


def _starkli_env(cfg = None, account_path = None):
    env = os.environ.copy()
    env.pop('STARKNET_KEYSTORE', None)
    env.pop('STARKNET_KEYSTORE_PASSWORD', None)
    env.pop('STARKNET_KEYSTORE_PASSWORD_FILE', None)
    if cfg.get('rpc'):
        env['STARKNET_RPC'] = cfg['rpc']
    if account_path:
        env['STARKNET_ACCOUNT'] = account_path
    if cfg.get('key'):
        env['STARKNET_PRIVATE_KEY'] = cfg['key']
    return env


def _extract_tx_hash(output = None):
    match = re.search('0x[0-9a-fA-F]{64}', output)
    if match:
        return match.group(0)


async def _wait_for_tx(tx_hash = None, timeout_s = None):
    '''Poll tx status via starknet.py until SUCCEEDED/ACCEPTED or timeout.
    Uses a 600s default (Sepolia can take 3-10 minutes to finalize).
    '''
    pass
# WARNING: Decompyle incomplete


async def _starkli_add_known_root(root_felt = None):
    """
    Submit add_known_root via starknet.py (replaces sncast which had RPC
    version mismatches and 90-second timeouts that never survived Sepolia).
    Returns tx hash hex string, 'pending' if already in pool, or None on error.
    """
    pass
# WARNING: Decompyle incomplete


async def register_root_on_chain(root = None, max_retries = None):
    '''
    Register a BN254 Poseidon root on-chain via add_known_root().

    Serialized with _registration_lock to prevent nonce conflicts between
    concurrent callers (e.g. startup reconciliation + deposit registration).
    Returns True on success, False on failure.
    '''
    pass
# WARNING: Decompyle incomplete


async def _register_root_impl(root = None, max_retries = None):
    pass
# WARNING: Decompyle incomplete


async def verify_root_on_chain(root = None):
    '''
    Check if a root is registered on-chain via starknet.py (replaced sncast
    which had RPC version mismatch issues).
    Returns True if the root is known, False otherwise.
    '''
    pass
# WARNING: Decompyle incomplete


async def check_nullifier_used_on_chain(nullifier = None):
    '''
    Check if a nullifier is already used on-chain via starknet.py call_contract.
    Returns True if used, False otherwise.  Returns False on error (fail-open).
    '''
    pass
# WARNING: Decompyle incomplete


async def reconcile_all_roots():
    '''
    Compare ALL backend merkle tree roots against on-chain state.
    Register any missing roots. Returns stats dict.

    Called on startup and can be called manually via API.
    '''
    pass
# WARNING: Decompyle incomplete

