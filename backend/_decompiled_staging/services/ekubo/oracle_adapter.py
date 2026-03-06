# Source Generated with Decompyle++
# File: oracle_adapter.cpython-312.pyc (Python 3.12)

'''Ekubo Oracle Extension adapter — read TWAP / spot price.

Pricing sources (tried in order):
1. **Ekubo HTTP API** — ``/price/{chainId}/{base}/{quote}/history`` returns VWAP
   data for all indexed chains including Sepolia (chain_id ``0x534e5f4d41494f``).
2. **On-chain ``Core.get_pool_price``** — fallback via Starknet RPC.

Key discovery: Ekubo indexes Sepolia under chain ID ``0x534e5f4d41494f``
(decimal 23448594291968335), which fits int64.  The Starknet-native
``SN_SEPOLIA`` id (``0x534e5f5345504f4c4941``) overflows int64 and causes 500s.
'''
from __future__ import annotations
import logging
import math
import os
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.services.ekubo_config import EKUBO_API_BASE, EKUBO_CORE_SEPOLIA, EKUBO_ORACLE_EXTENSION_SEPOLIA, SEPOLIA_ETH, SEPOLIA_STRK, get_ekubo_chain_id
logger = logging.getLogger(__name__)
_TWO128 = 1 << 128
_price_cache: 'Dict[str, Tuple[float, float, int]]' = { }
_CACHE_TTL_SEC = 15

def _norm(addr = None):
    '''Lowercase, keep 0x prefix, strip leading zeros after 0x.'''
    if not addr:
        addr
    raw = ''.strip().lower()
    if raw.startswith('0x'):
        raw = '0x' + raw[2:].lstrip('0')
    if not raw:
        raw
    return '0x0'


def tick_to_price(tick = None):
    '''Convert an Ekubo tick to a decimal price (token1 per token0).'''
    return 1.0001 ** tick


def price_to_tick(price = None):
    '''Convert a decimal price back to the nearest Ekubo tick.'''
    if price <= 0:
        return 0
    return round(math.log(price) / math.log(1.0001))


async def _fetch_api_vwap(token0 = None, token1 = None):
    '''Fetch VWAP price from Ekubo ``/price/{chainId}/{base}/{quote}/history``.

    Returns (price, tick) or None.  The most recent data-point with volume
    is used as the current spot estimate.
    '''
    pass
# WARNING: Decompyle incomplete


async def _fetch_api_pool_tick(token0 = None, token1 = None):
    '''Fetch pool state (tick, sqrt_ratio) from ``/pair/{chainId}/.../pools``.

    Picks the pool with the highest TVL that has a reasonable tick.
    Returns (price, tick) or None.
    '''
    pass
# WARNING: Decompyle incomplete


async def _fetch_onchain_pool_price(token0 = None, token1 = None, fee = None, tick_spacing = (SEPOLIA_STRK, SEPOLIA_ETH, 0xC49BA5E353F7D00000000000000000, 1000)):
    '''Call Ekubo Core.get_pool_price on-chain via RPC.  Returns (price, tick) or None.'''
    pass
# WARNING: Decompyle incomplete


async def _fetch_price(token0 = None, token1 = None):
    '''Try API VWAP → on-chain RPC, return first success.'''
    pass
# WARNING: Decompyle incomplete


async def get_spot_price(token0 = None, token1 = None, fee_bps = None):
    '''Return the current spot price (token1-per-token0).

    Primary: Ekubo HTTP API VWAP.  Fallback: on-chain RPC.
    '''
    pass
# WARNING: Decompyle incomplete


async def get_current_tick(token0 = None, token1 = None):
    '''Return the current pool tick (derived from VWAP price or on-chain).'''
    pass
# WARNING: Decompyle incomplete


async def get_twap(token0 = None, token1 = None, window_sec = None):
    '''Return the VWAP price from the Ekubo API price history.

    The API returns bucketed VWAP data.  For Sepolia this is effectively
    the same as spot since volume is sparse.
    '''
    pass
# WARNING: Decompyle incomplete


async def is_oracle_fresh(max_age_sec = None):
    '''Return True if we got a valid spot price within the last ``max_age_sec``.'''
    pass
# WARNING: Decompyle incomplete


async def get_spot_oracle_divergence(token0 = None, token1 = None):
    '''Return abs(spot - twap) / twap as a fraction (e.g. 0.02 = 2 %).

    On Sepolia volume is sparse so divergence is typically near 0.
    '''
    pass
# WARNING: Decompyle incomplete

_usd_cache: 'Dict[str, Tuple[float, float]]' = { }
_USD_CACHE_TTL = 60

async def _fetch_token_usd(token_addr = None):
    '''Fetch USD price for a token from the Ekubo ``/tokens`` search endpoint.

    Strategy: search by symbol (works across all chains) since Sepolia-specific
    token entries typically lack ``usd_price``.  Mainnet entries have it.
    '''
    pass
# WARNING: Decompyle incomplete


async def get_live_prices():
    '''Return a dict of live prices used as the single price truth.

    Returns::

        {
            "strk_eth": <float>,      # STRK per ETH from VWAP
            "strk_usd": <float|None>, # STRK in USD (from /tokens or derived)
            "eth_usd": <float|None>,  # ETH in USD (from /tokens or derived)
            "tick": <int|None>,       # current Ekubo tick
            "source": "ekubo_vwap" | "ekubo_onchain" | "cached",
            "cached_at": <iso timestamp>,
        }
    '''
    pass
# WARNING: Decompyle incomplete

