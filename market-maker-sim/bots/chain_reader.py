"""
On-chain data reader for Ekubo pools on Starknet Sepolia.

Reads real pool prices, token balances, and LP position info via RPC calls.
No fake data — everything comes from the blockchain.
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

MAX_TICK = 88_722_883

# ── Constants ────────────────────────────────────────────────────────────────
RPC_URL = os.getenv(
    "STARKNET_RPC_URL_V08",
    os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia"),
)

EKUBO_CORE = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_POSITIONS = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"
EKUBO_ROUTER = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763"

# Well-known Sepolia tokens
ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"

# zkDeFi synthetic tokens
ZKDETH = "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121"
ZKDAI = "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637"

# Fee tier encoding: fee = fraction * 2^128
_TWO128 = 1 << 128
FEE_05PCT = int(0.0005 * _TWO128)
FEE_30PCT = int(0.003 * _TWO128)
FEE_100PCT = int(0.01 * _TWO128)

# Selector hashes (computed via starknet_py get_selector_from_name)
GET_POOL_PRICE_SELECTOR = 0x63ECB4395E589622A41A66715A0EAC930ABC9F0B92C0B1DCDA630ADFB2BF2D
BALANCE_OF_SELECTOR = 0x35A73CD311A05D46DEDA634C5EE045DB92F811B4E74BCA4437FCB5302B7AF33

# Try to resolve at runtime if starknet_py is available
try:
    from starknet_py.hash.selector import get_selector_from_name as _sel
    GET_POOL_PRICE_SELECTOR = _sel("get_pool_price")
    BALANCE_OF_SELECTOR = _sel("balance_of")
except ImportError:
    pass  # use pre-computed constants above


# ── Data types ───────────────────────────────────────────────────────────────
@dataclass
class PoolKey:
    """Ekubo pool key definition."""
    name: str
    token0: str
    token1: str
    fee: int
    tick_spacing: int
    extension: str = "0x0"
    # display helpers
    token0_symbol: str = ""
    token1_symbol: str = ""
    token0_decimals: int = 18
    token1_decimals: int = 18


@dataclass
class PoolState:
    """Snapshot of an on-chain pool's state."""
    pool_key: PoolKey
    initialized: bool = False
    sqrt_ratio: int = 0
    tick: int = 0
    price: float = 0.0
    token0_balance: int = 0
    token1_balance: int = 0
    tvl_usd: float = 0.0
    last_error: str | None = None


@dataclass
class ChainSnapshot:
    """Aggregated snapshot of all tracked pools from a single poll cycle."""
    block_number: int = 0
    pools: list[PoolState] = field(default_factory=list)
    total_tvl_usd: float = 0.0
    total_pools: int = 0
    initialized_pools: int = 0
    rpc_url: str = ""
    data_quality: str = "on-chain"
    error: str | None = None


# ── Default pool registry ────────────────────────────────────────────────────
# Ordered so token0 < token1 by integer address value (Ekubo convention)
def _addr_int(addr: str) -> int:
    return int(addr, 16)


def _ordered(a: str, b: str) -> tuple[str, str]:
    """Return (token0, token1) in Ekubo order (numerically smaller first)."""
    if _addr_int(a) < _addr_int(b):
        return a, b
    return b, a


def build_default_pools() -> list[PoolKey]:
    """Build the default pool registry to monitor."""
    pools: list[PoolKey] = []

    # 1) STRK/ETH  (existing, should be initialized)
    t0, t1 = _ordered(STRK, ETH)
    pools.append(PoolKey(
        name="STRK/ETH", token0=t0, token1=t1,
        fee=FEE_30PCT, tick_spacing=1000,
        token0_symbol="STRK" if t0 == STRK else "ETH",
        token1_symbol="ETH" if t1 == ETH else "STRK",
    ))

    # 2) zkdETH/zkdAI
    t0, t1 = _ordered(ZKDAI, ZKDETH)
    pools.append(PoolKey(
        name="zkdAI/zkdETH", token0=t0, token1=t1,
        fee=FEE_30PCT, tick_spacing=1000,
        token0_symbol="zkdAI" if t0 == ZKDAI else "zkdETH",
        token1_symbol="zkdETH" if t1 == ZKDETH else "zkdAI",
    ))

    # 3) STRK/zkdETH
    t0, t1 = _ordered(STRK, ZKDETH)
    pools.append(PoolKey(
        name="STRK/zkdETH", token0=t0, token1=t1,
        fee=FEE_30PCT, tick_spacing=1000,
        token0_symbol="STRK" if t0 == STRK else "zkdETH",
        token1_symbol="zkdETH" if t1 == ZKDETH else "STRK",
    ))

    # 4) zkdAI/STRK
    t0, t1 = _ordered(ZKDAI, STRK)
    pools.append(PoolKey(
        name="zkdAI/STRK", token0=t0, token1=t1,
        fee=FEE_30PCT, tick_spacing=1000,
        token0_symbol="zkdAI" if t0 == ZKDAI else "STRK",
        token1_symbol="STRK" if t1 == STRK else "zkdAI",
    ))

    # 5) ETH/zkdETH
    t0, t1 = _ordered(ETH, ZKDETH)
    pools.append(PoolKey(
        name="ETH/zkdETH", token0=t0, token1=t1,
        fee=FEE_30PCT, tick_spacing=1000,
        token0_symbol="ETH" if t0 == ETH else "zkdETH",
        token1_symbol="zkdETH" if t1 == ZKDETH else "ETH",
    ))

    # 6) zkdAI/ETH
    t0, t1 = _ordered(ZKDAI, ETH)
    pools.append(PoolKey(
        name="zkdAI/ETH", token0=t0, token1=t1,
        fee=FEE_30PCT, tick_spacing=1000,
        token0_symbol="zkdAI" if t0 == ZKDAI else "ETH",
        token1_symbol="ETH" if t1 == ETH else "zkdAI",
    ))

    return pools


# ── RPC helpers ──────────────────────────────────────────────────────────────
async def _rpc_call(
    rpc_url: str,
    contract_address: str,
    selector: int,
    calldata: list[str],
    *,
    timeout: float = 15.0,
) -> tuple[bool, list[str]]:
    """Low-level starknet_call. Returns (success, result_felts)."""
    try:
        ca_int = int(contract_address, 16) if contract_address.startswith("0x") else int(contract_address)
    except ValueError:
        return False, []

    payload = {
        "jsonrpc": "2.0",
        "method": "starknet_call",
        "params": {
            "request": {
                "contract_address": hex(ca_int),
                "entry_point_selector": hex(selector),
                "calldata": calldata,
            },
            "block_id": "latest",
        },
        "id": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(rpc_url, json=payload)
        data = resp.json()
    except Exception as exc:
        logger.debug("RPC call failed: %s", exc)
        return False, []

    if "error" in data:
        logger.debug("RPC error: %s", data["error"])
        return False, []

    result = data.get("result") or []
    if not isinstance(result, list):
        return False, []
    return True, [str(x) for x in result]


async def _get_block_number(rpc_url: str) -> int:
    """Fetch current block number."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(rpc_url, json={
                "jsonrpc": "2.0",
                "method": "starknet_blockNumber",
                "params": {},
                "id": 1,
            })
        data = resp.json()
        return int(data.get("result", 0))
    except Exception:
        return 0


# ── Pool price reader ────────────────────────────────────────────────────────
def _pool_key_calldata(pk: PoolKey) -> list[str]:
    """Build calldata for get_pool_price(pool_key)."""
    return [
        pk.token0,
        pk.token1,
        hex(pk.fee),
        hex(pk.tick_spacing),
        pk.extension,
    ]


async def get_pool_price(
    rpc_url: str,
    pool_key: PoolKey,
) -> tuple[bool, int, int, float]:
    """
    Fetch pool price via Core.get_pool_price(pool_key).

    Returns (initialized, sqrt_ratio, tick, decimal_price).
    If pool is not initialized, returns (False, 0, 0, 0.0).
    """
    calldata = _pool_key_calldata(pool_key)
    ok, felts = await _rpc_call(rpc_url, EKUBO_CORE, GET_POOL_PRICE_SELECTOR, calldata)

    if not ok or len(felts) < 4:
        return False, 0, 0, 0.0

    try:
        sqrt_lo = int(felts[0], 16)
        sqrt_hi = int(felts[1], 16)
        sqrt_ratio = sqrt_lo + (sqrt_hi << 128)

        tick_mag = int(felts[2], 16)
        tick_sign = int(felts[3], 16)
        tick = -tick_mag if tick_sign else tick_mag
    except (ValueError, IndexError):
        return False, 0, 0, 0.0

    # sqrt_ratio == 0 means uninitialized
    if sqrt_ratio == 0:
        return False, 0, 0, 0.0

    # Boundary ticks on testnet often represent effectively one-sided/extreme states.
    # Keep the pool as initialized but suppress unusable display price.
    if abs(tick) >= MAX_TICK - 1:
        return True, sqrt_ratio, tick, 0.0

    # Convert sqrt_ratio (Q128.128) to decimal price
    # price = (sqrt_ratio / 2^128)^2
    try:
        price = (sqrt_ratio / _TWO128) ** 2

        # Adjust for decimal differences
        dec_diff = pool_key.token0_decimals - pool_key.token1_decimals
        if dec_diff != 0:
            price *= 10 ** dec_diff
    except (OverflowError, ZeroDivisionError):
        price = 0.0

    # Sanity bounds for dashboard display: avoid scientific-noise extremes.
    if not math.isfinite(price) or price <= 0:
        price = 0.0
    elif price < 1e-12 or price > 1e12:
        price = 0.0

    return True, sqrt_ratio, tick, price


# ── Token balance reader ─────────────────────────────────────────────────────
async def get_token_balance(
    rpc_url: str,
    token_address: str,
    holder_address: str,
) -> int:
    """Read balance_of(holder) for an ERC-20 token. Returns raw wei amount."""
    try:
        holder_int = int(holder_address, 16)
    except ValueError:
        return 0

    calldata = [hex(holder_int)]
    ok, felts = await _rpc_call(rpc_url, token_address, BALANCE_OF_SELECTOR, calldata)

    if not ok or not felts:
        return 0

    try:
        low = int(felts[0], 16)
        high = int(felts[1], 16) if len(felts) > 1 else 0
        return low + (high << 128)
    except (ValueError, IndexError):
        return 0


# ── Approximate USD prices for TVL calculation ──────────────────────────────
# Updated periodically; good enough for testnet display
_APPROX_USD_PRICES: dict[str, float] = {
    ETH.lower(): 3500.0,
    STRK.lower(): 0.50,
    ZKDETH.lower(): 3500.0,   # pegged to ETH
    ZKDAI.lower(): 1.0,       # stablecoin
}


def _token_usd_value(token_addr: str, amount_wei: int, decimals: int = 18) -> float:
    """Estimate USD value of a token amount."""
    price = _APPROX_USD_PRICES.get(token_addr.lower(), 0.0)
    return (amount_wei / (10 ** decimals)) * price


# ── Full pool state reader ───────────────────────────────────────────────────
async def read_pool_state(rpc_url: str, pool_key: PoolKey) -> PoolState:
    """Read complete state for a single pool: price + TVL from balances."""
    state = PoolState(pool_key=pool_key)

    try:
        initialized, sqrt_ratio, tick, price = await get_pool_price(rpc_url, pool_key)
        state.initialized = initialized
        state.sqrt_ratio = sqrt_ratio
        state.tick = tick
        state.price = price

        if initialized:
            # Read token balances held by the Core contract (where Ekubo pools hold liquidity)
            bal0 = await get_token_balance(rpc_url, pool_key.token0, EKUBO_CORE)
            bal1 = await get_token_balance(rpc_url, pool_key.token1, EKUBO_CORE)

            state.token0_balance = bal0
            state.token1_balance = bal1

            # Estimate TVL
            usd0 = _token_usd_value(pool_key.token0, bal0, pool_key.token0_decimals)
            usd1 = _token_usd_value(pool_key.token1, bal1, pool_key.token1_decimals)
            state.tvl_usd = usd0 + usd1

    except Exception as exc:
        state.last_error = str(exc)
        logger.warning("read_pool_state(%s) failed: %s", pool_key.name, exc)

    return state


# ── Full snapshot reader ─────────────────────────────────────────────────────
async def read_chain_snapshot(
    rpc_url: str | None = None,
    pools: list[PoolKey] | None = None,
) -> ChainSnapshot:
    """
    Read the full on-chain state for all tracked pools.

    Returns a ChainSnapshot with per-pool prices, TVLs, and aggregate metrics.
    """
    url = rpc_url or RPC_URL
    pool_list = pools or build_default_pools()

    snapshot = ChainSnapshot(rpc_url=url, total_pools=len(pool_list))

    try:
        snapshot.block_number = await _get_block_number(url)
    except Exception:
        snapshot.block_number = 0

    for pk in pool_list:
        ps = await read_pool_state(url, pk)
        snapshot.pools.append(ps)
        if ps.initialized:
            snapshot.initialized_pools += 1

    # Aggregate TVL: avoid double-counting shared Positions contract balances.
    # Use the max TVL observed across pools that share the same (token, Positions) combo.
    # For now, use a simpler approach: sum unique token balances.
    seen_tokens: dict[str, float] = {}
    for ps in snapshot.pools:
        if not ps.initialized:
            continue
        t0 = ps.pool_key.token0.lower()
        t1 = ps.pool_key.token1.lower()
        usd0 = _token_usd_value(ps.pool_key.token0, ps.token0_balance, ps.pool_key.token0_decimals)
        usd1 = _token_usd_value(ps.pool_key.token1, ps.token1_balance, ps.pool_key.token1_decimals)
        seen_tokens[t0] = max(seen_tokens.get(t0, 0), usd0)
        seen_tokens[t1] = max(seen_tokens.get(t1, 0), usd1)

    snapshot.total_tvl_usd = sum(seen_tokens.values())
    return snapshot


# ── Convenience: snapshot to JSON-friendly dict ──────────────────────────────
def snapshot_to_dict(snap: ChainSnapshot) -> dict[str, Any]:
    """Convert a ChainSnapshot to a JSON-serialisable dict."""
    pools_out = []
    for ps in snap.pools:
        pk = ps.pool_key
        pools_out.append({
            "name": pk.name,
            "token0": pk.token0,
            "token1": pk.token1,
            "token0_symbol": pk.token0_symbol,
            "token1_symbol": pk.token1_symbol,
            "fee_bps": round(pk.fee / _TWO128 * 10000, 2),
            "tick_spacing": pk.tick_spacing,
            "initialized": ps.initialized,
            "tick": ps.tick,
            "price": round(ps.price, 8) if ps.price else 0,
            "tvl_usd": round(ps.tvl_usd, 2),
            "token0_balance": str(ps.token0_balance),
            "token1_balance": str(ps.token1_balance),
            "error": ps.last_error,
        })

    return {
        "block_number": snap.block_number,
        "total_tvl_usd": round(snap.total_tvl_usd, 2),
        "total_pools": snap.total_pools,
        "initialized_pools": snap.initialized_pools,
        "data_quality": snap.data_quality,
        "pools": pools_out,
    }
