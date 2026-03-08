"""
Ekubo API client for Starknet Sepolia (read-only + quote/swap data).

Uses prod-api.ekubo.org. chainId for Starknet Sepolia: set EKUBO_CHAIN_ID in env
or pass chain_id to methods. API accepts integer chainId in query/path.
"""
import os
from typing import Any

import httpx

EKUBO_API_BASE = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")
# Starknet Sepolia: set EKUBO_CHAIN_ID (e.g. hex 0x534e5f5345504f4c4941). Unset = pairs from all chains; quote/swap need it.
EKUBO_CHAIN_ID_SEPOLIA = os.getenv("EKUBO_CHAIN_ID")


def _chain_id_raw() -> str | None:
    """Raw chain id for API (hex or decimal string). Ekubo path/query accept hex."""
    if not EKUBO_CHAIN_ID_SEPOLIA:
        return None
    return EKUBO_CHAIN_ID_SEPOLIA.strip()


async def get_tokens(chain_id: str | None = None, search: str | None = None, page_size: int = 100) -> list[dict[str, Any]]:
    """GET /tokens - list tokens for chain. Pass None for all chains (query chainId not always accepted)."""
    cid = chain_id
    params: dict[str, Any] = {"pageSize": page_size}
    if cid is not None:
        params["chainId"] = cid
    if search:
        params["search"] = search
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/tokens", params=params)
        r.raise_for_status()
        return r.json()


async def get_token(chain_id: str, token_address: str) -> dict[str, Any]:
    """GET /tokens/{chainId}/{tokenAddress} - token metadata. chain_id as hex or decimal string."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/tokens/{chain_id}/{token_address}")
        r.raise_for_status()
        return r.json()


async def get_overview_pairs(chain_id: str | None = None, min_tvl_usd: float | None = 1000) -> dict[str, Any]:
    """GET /overview/pairs - top pairs. Pass None for all chains (query chainId=hex can return 500)."""
    cid = chain_id
    params: dict[str, Any] = {}
    if cid is not None:
        params["chainId"] = cid
    if min_tvl_usd is not None:
        params["minTvlUsd"] = min_tvl_usd
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/overview/pairs", params=params)
        r.raise_for_status()
        return r.json()


async def get_overview_tvl(chain_id: str | None = None) -> dict[str, Any]:
    """GET /overview/tvl - TVL stats. Pass None for all chains."""
    cid = chain_id
    params = {} if cid is None else {"chainId": cid}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/overview/tvl", params=params)
        r.raise_for_status()
        return r.json()


async def get_overview_volume(chain_id: str | None = None) -> dict[str, Any]:
    """GET /overview/volume - volume stats. Pass None for all chains."""
    cid = chain_id
    params = {} if cid is None else {"chainId": cid}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/overview/volume", params=params)
        r.raise_for_status()
        return r.json()


async def get_pair_pools(chain_id: str, token_a: str, token_b: str, min_tvl_usd: float | None = 0) -> dict[str, Any]:
    """GET /pair/{chainId}/{tokenA}/{tokenB}/pools - pools for a pair. chain_id as hex or decimal string."""
    params: dict[str, Any] = {}
    if min_tvl_usd is not None and min_tvl_usd > 0:
        params["minTvlUsd"] = min_tvl_usd
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            f"{EKUBO_API_BASE}/pair/{chain_id}/{token_a}/{token_b}/pools",
            params=params,
        )
        r.raise_for_status()
        return r.json()


async def get_pair_tvl(chain_id: str, token_a: str, token_b: str) -> dict[str, Any]:
    """GET /pair/{chainId}/{tokenA}/{tokenB}/tvl - pair TVL. chain_id as hex or decimal string."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/pair/{chain_id}/{token_a}/{token_b}/tvl")
        r.raise_for_status()
        return r.json()


async def get_pair_volume(chain_id: str, token_a: str, token_b: str) -> dict[str, Any]:
    """GET /pair/{chainId}/{tokenA}/{tokenB}/volume - pair volume. chain_id as hex or decimal string."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{EKUBO_API_BASE}/pair/{chain_id}/{token_a}/{token_b}/volume")
        r.raise_for_status()
        return r.json()


async def get_pair_positions(chain_id: str, token_a: str, token_b: str) -> dict[str, Any]:
    """
    Return pair positions/pools for swap discovery. Uses get_pair_pools and normalizes to
    { "data": [ { "pool_key": { "token0", "token1", "fee", "tick_spacing", "extension" }, "liquidity" } ] }
    for consumption by ekubo_execution_service.discover_pool_from_positions.
    """
    try:
        data = await get_pair_pools(chain_id, token_a, token_b)
    except Exception:
        return {"data": []}
    pools = data.get("pools") or data.get("data") or (data if isinstance(data, list) else [])
    if not isinstance(pools, list):
        return {"data": []}
    out: list[dict[str, Any]] = []
    for p in pools:
        if not isinstance(p, dict):
            continue
        pk = p.get("poolKey") or p.get("pool_key") or {}
        if not isinstance(pk, dict):
            continue
        token0 = pk.get("token0") or pk.get("tokenA") or ""
        token1 = pk.get("token1") or pk.get("tokenB") or ""
        if not token0 or not token1:
            continue
        out.append({
            "pool_key": {
                "token0": token0,
                "token1": token1,
                "fee": pk.get("fee"),
                "tick_spacing": pk.get("tick_spacing"),
                "extension": str(pk.get("extension") or "0"),
            },
            "liquidity": p.get("liquidity") or p.get("liquidityNet") or 0,
        })
    return {"data": out}


async def get_price_history(
    chain_id: str, base_token: str, quote_token: str, interval: int | None = None
) -> dict[str, Any]:
    """GET /price/{chainId}/{baseToken}/{quoteToken}/history - VWAP price history. chain_id as hex or decimal string."""
    params = {} if interval is None else {"interval": interval}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            f"{EKUBO_API_BASE}/price/{chain_id}/{base_token}/{quote_token}/history",
            params=params,
        )
        r.raise_for_status()
        return r.json()
