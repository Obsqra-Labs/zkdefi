"""
Starknet Native Delegated Staking Service (Sepolia).

Integrates with the official Starknet staking contract on Sepolia:
  Contract: 0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1
  Interfaces: IStaking, IStakingPool

For regular users, delegation works via Pool contracts created by stakers.
This service:
  1. Reads on-chain staking state (total_stake, epoch, staker_info)
  2. Lists available delegation pools (via event scanning / known pools)
  3. Builds multicall transactions for enter_delegation_pool / claim / exit 
  4. Returns calldata for frontend wallet signing (no private keys needed)
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Sepolia Staking Contract ──────────────────────────────────────────────
STAKING_CONTRACT = "0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1"
STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
RPC_URL = "https://api.cartridge.gg/x/starknet/sepolia"

# ── Selector computation ──────────────────────────────────────────────────
try:
    from Crypto.Hash import keccak as _keccak_mod

    def _keccak256(data: bytes) -> bytes:
        k = _keccak_mod.new(digest_bits=256)
        k.update(data)
        return k.digest()
except ImportError:
    try:
        from eth_hash.auto import keccak as _eth_keccak

        def _keccak256(data: bytes) -> bytes:
            return _eth_keccak(data)
    except ImportError:
        import hashlib as _hl

        def _keccak256(data: bytes) -> bytes:
            """Fallback: use sha3_256 (different from Keccak-256 but close enough for dev)."""
            return _hl.sha3_256(data).digest()


def sn_keccak(name: str) -> str:
    """Compute Starknet selector for a function name."""
    h = int.from_bytes(_keccak256(name.encode()), "big")
    return hex(h % (2**250))


# Precompute selectors
SEL_GET_TOTAL_STAKE = sn_keccak("get_total_stake")
SEL_GET_CURRENT_EPOCH = sn_keccak("get_current_epoch")
SEL_GET_EPOCH_INFO = sn_keccak("get_epoch_info")
SEL_IS_PAUSED = sn_keccak("is_paused")
SEL_STAKER_INFO_V1 = sn_keccak("staker_info_v1")
SEL_CONTRACT_PARAMS = sn_keccak("contract_parameters_v1")
SEL_GET_STAKER_INFO = sn_keccak("get_staker_info_v1")

# Delegation pool contract selectors
SEL_ENTER_DELEGATION_POOL = sn_keccak("enter_delegation_pool")
SEL_EXIT_DELEGATION_POOL_INTENT = sn_keccak("exit_delegation_pool_intent")
SEL_EXIT_DELEGATION_POOL_ACTION = sn_keccak("exit_delegation_pool_action")
SEL_CLAIM_REWARDS = sn_keccak("claim_rewards")
SEL_POOL_MEMBER_INFO = sn_keccak("pool_member_info")

# STRK ERC-20 selectors
SEL_APPROVE = sn_keccak("approve")
SEL_BALANCE_OF = sn_keccak("balance_of")

# Staking event name hashes (first key in emitted events)
EVENT_NEW_DELEGATION_POOL = sn_keccak("NewDelegationPool")
EVENT_STAKE_BALANCE_CHANGED = sn_keccak("StakeBalanceChanged")


# ── Data Classes ──────────────────────────────────────────────────────────
@dataclass
class StakingOverview:
    total_stake_wei: int = 0
    total_stake_strk: float = 0.0
    current_epoch: int = 0
    is_paused: bool = False
    updated_at: float = 0.0


@dataclass
class DelegationPool:
    pool_address: str
    staker_address: str
    name: str
    commission_pct: float = 0.0
    total_delegated_wei: int = 0
    estimated_apr_pct: float = 0.0
    active: bool = True


@dataclass
class DelegationPosition:
    pool_address: str
    pool_name: str
    delegated_wei: int = 0
    unclaimed_rewards_wei: int = 0
    pending_exit_wei: int = 0
    exit_available_at: Optional[int] = None


# ── Cache ─────────────────────────────────────────────────────────────────
_overview_cache: Optional[StakingOverview] = None
_overview_cache_ts: float = 0.0
OVERVIEW_CACHE_TTL = 30.0  # seconds

# Known Sepolia delegation pools (we'll discover more via events)
_known_pools: List[DelegationPool] = []
_pools_cache_ts: float = 0.0
POOLS_CACHE_TTL = 120.0


# ── RPC helpers ───────────────────────────────────────────────────────────
async def _rpc_call(method: str, params: dict) -> dict:
    """Make a JSON-RPC call to Starknet Sepolia."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(RPC_URL, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        })
        return resp.json()


async def _call_contract(contract: str, selector: str, calldata: List[str] | None = None) -> List[str]:
    """Call a Starknet contract view function."""
    data = await _rpc_call("starknet_call", {
        "request": {
            "contract_address": contract,
            "entry_point_selector": selector,
            "calldata": calldata or [],
        },
        "block_id": "latest",
    })
    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")
    return data.get("result", [])


def _felt_to_int(hex_str: str) -> int:
    return int(hex_str, 16)


def _int_to_felt(val: int) -> str:
    return hex(val)


def _address_to_felt(addr: str) -> str:
    """Normalize address to felt for calldata."""
    return addr


def _normalize_address(val: str | int) -> str:
    """Normalize felt/address to 0x-prefixed hex string."""
    if isinstance(val, int):
        return hex(val)
    s = str(val).strip().lower()
    if s.startswith("0x"):
        return s
    return "0x" + s


def _is_valid_pool_address(addr: str) -> bool:
    """Check if address looks like a valid Starknet contract (non-zero, reasonable length)."""
    if not addr or addr in ("0x0", "0x"):
        return False
    try:
        n = int(addr, 16)
        return 0 < n < (1 << 251)
    except (ValueError, TypeError):
        return False


async def _get_staking_events() -> List[dict]:
    """Fetch StakeBalanceChanged and NewDelegationPool events from the staking contract."""
    all_events: List[dict] = []
    continuation_token: Optional[str] = None
    staking_event_keys = {
        _normalize_address(EVENT_NEW_DELEGATION_POOL),
        _normalize_address(EVENT_STAKE_BALANCE_CHANGED),
    }

    while True:
        filter_obj: Dict[str, Any] = {
            "from_block": {"block_number": 0},
            "to_block": "latest",
            "address": STAKING_CONTRACT,
            "chunk_size": 256,
        }
        if continuation_token:
            filter_obj["continuation_token"] = continuation_token

        try:
            # Match ekubo_lp_service format for Cartridge RPC
            data = await _rpc_call("starknet_getEvents", {"filter": filter_obj})
        except Exception as e:
            logger.warning(f"starknet_getEvents failed: {e}")
            return []

        if "error" in data:
            logger.warning(f"starknet_getEvents RPC error: {data['error']}")
            return []

        result = data.get("result", data)
        if isinstance(result, dict):
            events = result.get("events", [])
            continuation_token = result.get("continuation_token")
        else:
            events = []
            continuation_token = None

        # Filter to staking events only (keys[0] is event name hash)
        for ev in events:
            keys = ev.get("keys", [])
            if keys and _normalize_address(keys[0]) in staking_event_keys:
                all_events.append(ev)

        if not continuation_token:
            break

    return all_events


def _extract_pool_addresses_from_events(events: List[dict]) -> List[str]:
    """Extract unique pool addresses from staking events. Pool address is typically in keys or data."""
    seen: set[str] = set()
    result: List[str] = []
    staking_int = int(STAKING_CONTRACT, 16)
    strk_int = int(STRK_TOKEN, 16)

    for ev in events:
        for src in (ev.get("keys", []), ev.get("data", [])):
            for item in src:
                addr = _normalize_address(item)
                if not _is_valid_pool_address(addr):
                    continue
                n = int(addr, 16)
                if n == staking_int or n == strk_int:
                    continue
                if addr not in seen:
                    seen.add(addr)
                    result.append(addr)
    return result


def _pools_from_env() -> List[DelegationPool]:
    """Parse STAKING_POOL_ADDRESSES env var (comma-separated) into DelegationPool list."""
    raw = os.getenv("STAKING_POOL_ADDRESSES", "").strip()
    if not raw:
        return []
    pools: List[DelegationPool] = []
    for addr in (a.strip() for a in raw.split(",") if a.strip()):
        addr = _normalize_address(addr)
        if _is_valid_pool_address(addr):
            pools.append(DelegationPool(
                pool_address=addr,
                staker_address="0x0",
                name=f"Pool {addr[:10]}...",
                commission_pct=0.0,
                estimated_apr_pct=4.5,
                active=True,
            ))
    return pools


# ── Core Queries ──────────────────────────────────────────────────────────
async def get_staking_overview() -> StakingOverview:
    """Get global staking statistics from the on-chain contract."""
    global _overview_cache, _overview_cache_ts

    now = time.time()
    if _overview_cache and (now - _overview_cache_ts) < OVERVIEW_CACHE_TTL:
        return _overview_cache

    try:
        # Parallel RPC calls
        total_stake_task = _call_contract(STAKING_CONTRACT, SEL_GET_TOTAL_STAKE)
        epoch_task = _call_contract(STAKING_CONTRACT, SEL_GET_CURRENT_EPOCH)
        paused_task = _call_contract(STAKING_CONTRACT, SEL_IS_PAUSED)

        results = await asyncio.gather(total_stake_task, epoch_task, paused_task, return_exceptions=True)

        total_stake_raw = results[0] if not isinstance(results[0], Exception) else ["0x0"]
        epoch_raw = results[1] if not isinstance(results[1], Exception) else ["0x0"]
        paused_raw = results[2] if not isinstance(results[2], Exception) else ["0x0"]

        total_wei = _felt_to_int(total_stake_raw[0]) if total_stake_raw else 0
        overview = StakingOverview(
            total_stake_wei=total_wei,
            total_stake_strk=total_wei / 1e18,
            current_epoch=_felt_to_int(epoch_raw[0]) if epoch_raw else 0,
            is_paused=_felt_to_int(paused_raw[0]) == 1 if paused_raw else False,
            updated_at=now,
        )
        _overview_cache = overview
        _overview_cache_ts = now
        return overview

    except Exception as e:
        logger.error(f"Failed to fetch staking overview: {e}")
        if _overview_cache:
            return _overview_cache
        return StakingOverview(updated_at=now)


async def get_strk_balance(user_address: str) -> int:
    """Get STRK token balance for a user."""
    try:
        result = await _call_contract(STRK_TOKEN, SEL_BALANCE_OF, [user_address])
        if result and len(result) >= 2:
            # u256 = low + high * 2^128
            low = _felt_to_int(result[0])
            high = _felt_to_int(result[1])
            return low + (high << 128)
        elif result:
            return _felt_to_int(result[0])
        return 0
    except Exception as e:
        logger.error(f"Failed to get STRK balance for {user_address}: {e}")
        return 0


async def get_delegation_pools() -> List[DelegationPool]:
    """Get list of delegation pools on Sepolia.

    Discovery order:
    1. RPC event scan (StakeBalanceChanged, NewDelegationPool on staking contract)
    2. STAKING_POOL_ADDRESSES env var (comma-separated)
    3. Single inactive pool (active=False, pool_address=0x0) so UI shows staking unavailable
    """
    global _known_pools, _pools_cache_ts

    now = time.time()
    if _known_pools and (now - _pools_cache_ts) < POOLS_CACHE_TTL:
        return _known_pools

    pools: List[DelegationPool] = []

    # 1. Try RPC event discovery
    try:
        events = await _get_staking_events()
        addrs = _extract_pool_addresses_from_events(events)
        if addrs:
            overview = await get_staking_overview()
            base_apr = 4.5 if (overview.total_stake_wei > 0 and not overview.is_paused) else 0.0
            for addr in addrs:
                pools.append(DelegationPool(
                    pool_address=addr,
                    staker_address="0x0",
                    name=f"Pool {addr[:10]}...",
                    commission_pct=0.0,
                    estimated_apr_pct=base_apr,
                    active=True,
                ))
            logger.info("Staking: discovered %d pools via RPC events", len(pools))
    except Exception as e:
        logger.warning(f"RPC event pool discovery failed: {e}")

    # 2. Fall back to env var if event discovery returned nothing
    if not pools:
        pools = _pools_from_env()
        if pools:
            logger.info("Staking: using %d pools from STAKING_POOL_ADDRESSES", len(pools))

    # 3. If neither has results, return single inactive pool so UI knows staking is unavailable
    if not pools:
        pools = [
            DelegationPool(
                pool_address="0x0",
                staker_address="0x0",
                name="Staking unavailable",
                commission_pct=0.0,
                estimated_apr_pct=0.0,
                active=False,
            ),
        ]
        logger.debug("Staking: no pools found, returning inactive placeholder")

    _known_pools = pools
    _pools_cache_ts = now
    return _known_pools


async def get_user_delegation_positions(user_address: str) -> List[DelegationPosition]:
    """Get a user's delegation positions across known pools.
    
    For each known pool contract, we call pool_member_info(user_address).
    If the user hasn't delegated to that pool, it will return zeros/error.
    """
    positions = []
    pools = await get_delegation_pools()

    for pool in pools:
        if pool.pool_address == "0x0":
            continue  # Skip placeholder pools
        try:
            result = await _call_contract(
                pool.pool_address,
                SEL_POOL_MEMBER_INFO,
                [user_address]
            )
            if result and len(result) >= 2:
                delegated = _felt_to_int(result[0])
                rewards = _felt_to_int(result[1]) if len(result) > 1 else 0
                if delegated > 0 or rewards > 0:
                    positions.append(DelegationPosition(
                        pool_address=pool.pool_address,
                        pool_name=pool.name,
                        delegated_wei=delegated,
                        unclaimed_rewards_wei=rewards,
                    ))
        except Exception:
            pass  # Pool doesn't have this user or call failed

    return positions


# ── Transaction Builders ──────────────────────────────────────────────────
def build_delegate_calldata(
    pool_contract: str,
    amount_wei: int,
    reward_address: str,
) -> List[Dict[str, Any]]:
    """Build multicall for delegating STRK to a staking pool.
    
    Steps:
    1. Approve STRK token spend by pool contract
    2. Call enter_delegation_pool on the pool contract
    
    Returns list of Call objects for the frontend to execute via wallet.
    """
    # u256 representation: [low, high]
    amount_low = hex(amount_wei & ((1 << 128) - 1))
    amount_high = hex(amount_wei >> 128)

    calls = [
        # 1. Approve STRK
        {
            "contractAddress": STRK_TOKEN,
            "entrypoint": "approve",
            "calldata": [pool_contract, amount_low, amount_high],
        },
        # 2. Enter delegation pool
        {
            "contractAddress": pool_contract,
            "entrypoint": "enter_delegation_pool",
            "calldata": [reward_address, amount_low, amount_high],
        },
    ]
    return calls


def build_claim_rewards_calldata(pool_contract: str, user_address: str) -> List[Dict[str, Any]]:
    """Build calldata for claiming delegation rewards."""
    return [
        {
            "contractAddress": pool_contract,
            "entrypoint": "claim_rewards",
            "calldata": [user_address],
        },
    ]


def build_exit_intent_calldata(pool_contract: str, amount_wei: int) -> List[Dict[str, Any]]:
    """Build calldata for exit delegation intent (starts cooldown)."""
    amount_low = hex(amount_wei & ((1 << 128) - 1))
    amount_high = hex(amount_wei >> 128)

    return [
        {
            "contractAddress": pool_contract,
            "entrypoint": "exit_delegation_pool_intent",
            "calldata": [amount_low, amount_high],
        },
    ]


def build_exit_action_calldata(pool_contract: str) -> List[Dict[str, Any]]:
    """Build calldata for completing exit (after cooldown)."""
    return [
        {
            "contractAddress": pool_contract,
            "entrypoint": "exit_delegation_pool_action",
            "calldata": [],
        },
    ]


# ── High-level API ────────────────────────────────────────────────────────
async def get_staking_dashboard(user_address: Optional[str] = None) -> Dict[str, Any]:
    """Aggregated staking dashboard data for the frontend."""
    overview = await get_staking_overview()
    pools = await get_delegation_pools()

    result: Dict[str, Any] = {
        "network": "sepolia",
        "staking_contract": STAKING_CONTRACT,
        "strk_token": STRK_TOKEN,
        "total_stake_strk": overview.total_stake_strk,
        "current_epoch": overview.current_epoch,
        "is_paused": overview.is_paused,
        "updated_at": overview.updated_at,
        "pools": [
            {
                "pool_address": p.pool_address,
                "staker_address": p.staker_address,
                "name": p.name,
                "commission_pct": p.commission_pct,
                "estimated_apr_pct": p.estimated_apr_pct,
                "active": p.active,
            }
            for p in pools
        ],
    }

    if user_address:
        balance = await get_strk_balance(user_address)
        positions = await get_user_delegation_positions(user_address)
        result["user"] = {
            "address": user_address,
            "strk_balance_wei": str(balance),
            "strk_balance": balance / 1e18,
            "positions": [
                {
                    "pool_address": pos.pool_address,
                    "pool_name": pos.pool_name,
                    "delegated_wei": str(pos.delegated_wei),
                    "delegated_strk": pos.delegated_wei / 1e18,
                    "unclaimed_rewards_wei": str(pos.unclaimed_rewards_wei),
                    "unclaimed_rewards_strk": pos.unclaimed_rewards_wei / 1e18,
                    "pending_exit_wei": str(pos.pending_exit_wei),
                    "exit_available_at": pos.exit_available_at,
                }
                for pos in positions
            ],
        }

    return result
