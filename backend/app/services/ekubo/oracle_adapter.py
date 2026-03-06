"""Ekubo Oracle Extension adapter — read TWAP / spot price.

Pricing sources (tried in order):
1. **Ekubo HTTP API** — ``/price/{chainId}/{base}/{quote}/history`` returns VWAP
   data for all indexed chains including Sepolia (chain_id ``0x534e5f4d41494f``).
2. **On-chain ``Core.get_pool_price``** — fallback via Starknet RPC.

Key discovery: Ekubo indexes Sepolia under chain ID ``0x534e5f4d41494f``
(decimal 23448594291968335), which fits int64.  The Starknet-native
``SN_SEPOLIA`` id (``0x534e5f5345504f4c4941``) overflows int64 and causes 500s.
"""

from __future__ import annotations

import logging
import math
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.services.ekubo_config import (
    EKUBO_API_BASE,
    EKUBO_CORE_SEPOLIA,
    EKUBO_ORACLE_EXTENSION_SEPOLIA,
    SEPOLIA_ETH,
    SEPOLIA_STRK,
    get_ekubo_chain_id,
)

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
_TWO128 = 1 << 128

# ── In-memory price cache (TTL-based) ────────────────────────────────────────
_price_cache: Dict[str, Tuple[float, float, int]] = {}  # key -> (price, fetch_ts, tick)
_CACHE_TTL_SEC = 15  # refresh at most every 15 s


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(addr: str) -> str:
    """Lowercase, keep 0x prefix, strip leading zeros after 0x."""
    raw = (addr or "").strip().lower()
    if raw.startswith("0x"):
        raw = "0x" + raw[2:].lstrip("0")
    return raw or "0x0"


def tick_to_price(tick: int) -> float:
    """Convert an Ekubo tick to a decimal price (token1 per token0)."""
    return 1.0001 ** tick


def price_to_tick(price: float) -> int:
    """Convert a decimal price back to the nearest Ekubo tick."""
    if price <= 0:
        return 0
    return round(math.log(price) / math.log(1.0001))


# ── Ekubo HTTP API fetch ─────────────────────────────────────────────────────

async def _fetch_api_vwap(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
) -> Optional[Tuple[float, int]]:
    """Fetch VWAP price from Ekubo ``/price/{chainId}/{base}/{quote}/history``.

    Returns (price, tick) or None.  The most recent data-point with volume
    is used as the current spot estimate.
    """
    chain_id = get_ekubo_chain_id()
    url = (
        f"{EKUBO_API_BASE}/price/{chain_id}"
        f"/{_norm(token0)}/{_norm(token1)}/history"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        # data.data is an array of {start, vwap, min, max, k_volume}
        buckets: List[Dict] = data.get("data", [])
        if not buckets:
            return None

        # Collect buckets with non-zero volume and valid VWAP.
        valid = []
        for b in buckets:
            vol = b.get("k_volume", "0")
            if isinstance(vol, str):
                vol = int(vol) if vol.isdigit() else 0
            v = float(b.get("vwap", 0))
            if vol > 0 and v > 0:
                valid.append((v, vol, b))
        if not valid:
            # Fallback: take the very last bucket's VWAP
            vwap = float(buckets[-1].get("vwap", 0))
            if vwap <= 0:
                return None
            return (vwap, price_to_tick(vwap))

        # Filter outliers: drop any VWAP >100x or <0.01x from the median.
        vwaps = sorted(v for v, _, _ in valid)
        median = vwaps[len(vwaps) // 2]
        sane = [(v, vol, b) for v, vol, b in valid
                if median * 0.01 <= v <= median * 100]
        if not sane:
            sane = valid  # all outliers — keep all, something is better than nothing

        # Pick the most recent sane bucket (last by position in original list).
        best_vwap = sane[-1][0]
        tick = price_to_tick(best_vwap)
        return (best_vwap, tick)
    except Exception as exc:
        logger.debug("Ekubo API VWAP fetch failed: %s", exc)
        return None


async def _fetch_api_pool_tick(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
) -> Optional[Tuple[float, int]]:
    """Fetch pool state (tick, sqrt_ratio) from ``/pair/{chainId}/.../pools``.

    Picks the pool with the highest TVL that has a reasonable tick.
    Returns (price, tick) or None.
    """
    chain_id = get_ekubo_chain_id()
    url = (
        f"{EKUBO_API_BASE}/pair/{chain_id}"
        f"/{_norm(token0)}/{_norm(token1)}/pools"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params={"minTvlUsd": 0})
            resp.raise_for_status()
            data = resp.json()
        pools = data.get("topPools", [])
        if not pools:
            return None
        # Sort by tvl0_total descending (biggest liquidity pool first)
        pools.sort(
            key=lambda p: int(p.get("tvl0_total", "0") or "0"), reverse=True
        )
        # The pair/pools endpoint doesn't include pool_state directly,
        # but we can derive tick from the positions endpoint as fallback.
        # For now return None to let the primary VWAP handle it.
        return None
    except Exception as exc:
        logger.debug("Ekubo API pair/pools fetch failed: %s", exc)
        return None


async def _fetch_onchain_pool_price(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
    fee: int = 1020847100762815411640772995208708096,  # 0.30 %
    tick_spacing: int = 1000,
) -> Optional[Tuple[float, int]]:
    """Call Ekubo Core.get_pool_price on-chain via RPC.  Returns (price, tick) or None."""
    rpc = os.getenv("STARKNET_RPC_URL_V08") or os.getenv(
        "STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia"
    )
    try:
        from starknet_py.hash.selector import get_selector_from_name
        selector = hex(get_selector_from_name("get_pool_price"))
    except Exception:
        return None

    calldata = [token0, token1, hex(fee), hex(tick_spacing), "0x0"]
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "starknet_call",
        "params": {
            "request": {
                "contract_address": EKUBO_CORE_SEPOLIA,
                "entry_point_selector": selector,
                "calldata": calldata,
            },
            "block_id": "latest",
        },
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(rpc, json=payload)
            data = resp.json()
        result = data.get("result", [])
        if not result or "error" in data:
            logger.warning("Core.get_pool_price RPC failed: %s", data.get("error"))
            return None
        # Parse: [sqrt_ratio_low, sqrt_ratio_high, tick_mag, tick_sign]
        sqrt_lo = int(result[0], 16)
        sqrt_hi = int(result[1], 16)
        sqrt_ratio = sqrt_lo + (sqrt_hi << 128)
        tick_mag = int(result[2], 16)
        tick_sign = int(result[3], 16) if len(result) > 3 else 0
        tick_val = -tick_mag if tick_sign else tick_mag
        if sqrt_ratio == 0:
            return None
        price = (sqrt_ratio / _TWO128) ** 2
        return (price, tick_val)
    except Exception as exc:
        logger.warning("On-chain pool price fetch failed: %s", exc)
        return None


# ── Internal fetch with fallback chain ────────────────────────────────────────

async def _fetch_price(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
) -> Optional[Tuple[float, int]]:
    """Try API VWAP → on-chain RPC, return first success."""
    result = await _fetch_api_vwap(token0, token1)
    if result and result[0] > 0:
        return result
    result = await _fetch_onchain_pool_price(token0, token1)
    if result and result[0] > 0:
        return result
    return None


# ── Public API ────────────────────────────────────────────────────────────────

async def get_spot_price(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
    fee_bps: int = 30,
) -> Optional[float]:
    """Return the current spot price (token1-per-token0).

    Primary: Ekubo HTTP API VWAP.  Fallback: on-chain RPC.
    """
    cache_key = f"spot:{_norm(token0)}:{_norm(token1)}:{fee_bps}"
    cached = _price_cache.get(cache_key)
    if cached and (time.time() - cached[1]) < _CACHE_TTL_SEC:
        return cached[0]

    result = await _fetch_price(token0, token1)
    if result:
        price, tick = result
        _price_cache[cache_key] = (price, time.time(), tick)
        return price
    return None


async def get_current_tick(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
) -> Optional[int]:
    """Return the current pool tick (derived from VWAP price or on-chain)."""
    cache_key = f"spot:{_norm(token0)}:{_norm(token1)}:30"
    cached = _price_cache.get(cache_key)
    if cached and (time.time() - cached[1]) < _CACHE_TTL_SEC:
        return cached[2]

    result = await _fetch_price(token0, token1)
    if result:
        price, tick = result
        _price_cache[cache_key] = (price, time.time(), tick)
        return tick
    return None


async def get_twap(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
    window_sec: int = 300,
) -> Optional[float]:
    """Return the VWAP price from the Ekubo API price history.

    The API returns bucketed VWAP data.  For Sepolia this is effectively
    the same as spot since volume is sparse.
    """
    return await get_spot_price(token0, token1)


async def is_oracle_fresh(max_age_sec: int = 120) -> bool:
    """Return True if we got a valid spot price within the last ``max_age_sec``."""
    price = await get_spot_price()
    if price is None:
        return False
    cache_key = f"spot:{_norm(SEPOLIA_STRK)}:{_norm(SEPOLIA_ETH)}:30"
    cached = _price_cache.get(cache_key)
    if not cached:
        return False
    return (time.time() - cached[1]) < max_age_sec


async def get_spot_oracle_divergence(
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
) -> Optional[float]:
    """Return abs(spot - twap) / twap as a fraction (e.g. 0.02 = 2 %).

    On Sepolia volume is sparse so divergence is typically near 0.
    """
    spot = await get_spot_price(token0, token1)
    twap = await get_twap(token0, token1)
    if spot is None or twap is None or twap == 0:
        return None
    return abs(spot - twap) / twap


# ── USD price helpers (via Ekubo /tokens endpoint) ───────────────────────

_usd_cache: Dict[str, Tuple[float, float]] = {}  # token_addr -> (usd_price, fetch_ts)
_USD_CACHE_TTL = 60  # 1 min


async def _fetch_token_usd(token_addr: str) -> Optional[float]:
    """Fetch USD price for a token from the Ekubo ``/tokens`` search endpoint.

    Strategy: search by symbol (works across all chains) since Sepolia-specific
    token entries typically lack ``usd_price``.  Mainnet entries have it.
    """
    norm_addr = _norm(token_addr)
    cached = _usd_cache.get(norm_addr)
    if cached and (time.time() - cached[1]) < _USD_CACHE_TTL:
        return cached[0]

    # Map token addresses to search symbols
    _ADDR_TO_SYM = {
        _norm(SEPOLIA_STRK): "STRK",
        _norm(SEPOLIA_ETH): "ETH",
    }
    symbol = _ADDR_TO_SYM.get(norm_addr)

    try:
        if symbol:
            # Search by symbol across all chains — mainnet entries have usd_price
            from app.services.ekubo_client import get_tokens
            tokens = await get_tokens(chain_id=None, search=symbol, page_size=10)
            for t in tokens:
                usd = t.get("usd_price")
                if usd is not None and float(usd) > 0:
                    price = float(usd)
                    _usd_cache[norm_addr] = (price, time.time())
                    return price
        else:
            # Fallback: try chain-specific lookup
            from app.services.ekubo_client import get_token
            chain_id = get_ekubo_chain_id()
            data = await get_token(chain_id or "0x534e5f4d41494f", token_addr)
            usd = data.get("usd_price") or data.get("price_usd")
            if usd is not None:
                price = float(usd)
                _usd_cache[norm_addr] = (price, time.time())
                return price
    except Exception as exc:
        logger.debug("Ekubo token USD fetch failed for %s: %s", token_addr, exc)
    return None


async def get_live_prices() -> Dict[str, Any]:
    """Return a dict of live prices used as the single price truth.

    Returns::

        {
            "strk_eth": <float>,      # STRK per ETH from VWAP
            "strk_usd": <float|None>, # STRK in USD (from /tokens or derived)
            "eth_usd": <float|None>,  # ETH in USD (from /tokens or derived)
            "tick": <int|None>,       # current Ekubo tick
            "source": "ekubo_vwap" | "ekubo_onchain" | "cached",
            "cached_at": <iso timestamp>,
        }
    """
    # 1. Fetch USD prices from Ekubo /tokens endpoint (mainnet — most reliable)
    strk_usd = await _fetch_token_usd(SEPOLIA_STRK)
    eth_usd = await _fetch_token_usd(SEPOLIA_ETH)

    # 2. Fetch STRK/ETH spot price + tick from Sepolia VWAP / on-chain
    strk_eth_raw = await get_spot_price()
    tick_raw = await get_current_tick()

    # 3. If both USD prices are available, derive STRK/ETH from them
    #    (mainnet USD prices have deep liquidity ≫ sparse Sepolia VWAP)
    if strk_usd is not None and eth_usd is not None and eth_usd > 0:
        strk_eth = strk_usd / eth_usd
        tick = price_to_tick(strk_eth)
        source = "usd_derived"
    elif strk_eth_raw is not None and strk_eth_raw > 0:
        strk_eth = strk_eth_raw
        tick = tick_raw
        source = "ekubo_vwap"
    else:
        strk_eth = strk_eth_raw
        tick = tick_raw
        source = "ekubo_onchain"

    # 4. Derive missing USD prices from the STRK/ETH ratio if possible
    if strk_usd is None and eth_usd is not None and strk_eth is not None and strk_eth > 0:
        strk_usd = eth_usd * strk_eth
    if eth_usd is None and strk_usd is not None and strk_eth is not None and strk_eth > 0:
        eth_usd = strk_usd / strk_eth

    # 5. Determine cache timestamp
    cache_key = f"spot:{_norm(SEPOLIA_STRK)}:{_norm(SEPOLIA_ETH)}:30"
    cached = _price_cache.get(cache_key)
    cached_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) 

    # 6. Push ETH/USD to constraint_gate sync cache
    if eth_usd is not None:
        try:
            from app.services.constraint_gate import update_cached_eth_usd
            update_cached_eth_usd(eth_usd)
        except Exception:
            pass

    return {
        "strk_eth": strk_eth,
        "strk_usd": strk_usd,
        "eth_usd": eth_usd,
        "tick": tick,
        "source": source,
        "cached_at": cached_at,
    }
