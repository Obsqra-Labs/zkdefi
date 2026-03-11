"""
Price Proxy — server-side relay for CoinGecko simple/price.

Avoids CORS errors from browser-direct calls to api.coingecko.com.
Caches for 30 s to stay within free-tier rate limits.
"""

import logging
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Query

router = APIRouter(tags=["price-proxy"])
logger = logging.getLogger(__name__)

# In-memory cache: { key: (timestamp, data) }
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 30  # seconds

CG_BASE = "https://api.coingecko.com/api/v3"


@router.get("/prices")
async def get_prices(
    ids: str = Query("ethereum,starknet,bitcoin,usd-coin,dai"),
    vs: str = Query("usd"),
):
    """
    Proxy for CoinGecko simple/price.
    GET /api/v1/zkdefi/prices?ids=ethereum,starknet&vs=usd
    """
    cache_key = f"{ids}|{vs}"
    now = time.time()

    # Return cached if fresh
    if cache_key in _cache:
        ts, data = _cache[cache_key]
        if now - ts < CACHE_TTL:
            return data

    url = f"{CG_BASE}/simple/price"
    params = {"ids": ids, "vs_currencies": vs}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            _cache[cache_key] = (now, data)
            return data
    except Exception as exc:
        logger.warning("CoinGecko proxy failed: %s", exc)
        # Return stale cache if available
        if cache_key in _cache:
            return _cache[cache_key][1]
        # Hardcoded fallback
        return {
            "ethereum": {"usd": 3800},
            "starknet": {"usd": 0.45},
            "bitcoin": {"usd": 95000},
            "usd-coin": {"usd": 1},
            "dai": {"usd": 1},
        }
