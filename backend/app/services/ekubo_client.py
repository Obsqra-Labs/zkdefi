"""
Ekubo API client for Starknet Sepolia (read-only + quote/swap data).

Uses prod-api.ekubo.org. chainId for Starknet Sepolia: set EKUBO_CHAIN_ID in env
or pass chain_id to methods. API accepts integer chainId in query/path.
"""
import os
from typing import Any

import httpx

EKUBO_API_BASE = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")
# Starknet Sepolia: Ekubo API currently serves testnet pools under chain id 0x534e5f4d41494f.
# We still accept SN_SEPOLIA value from env and transparently retry with Ekubo's alias.
EKUBO_CHAIN_ID_SEPOLIA = os.getenv("EKUBO_CHAIN_ID")
_EKUBO_API_CHAIN_ID_ALIAS = "0x534e5f4d41494f"
_SN_SEPOLIA_CHAIN_ID = "0x534e5f5345504f4c4941"
_SN_SEPOLIA_CHAIN_ID_DEC = "393402133025997798000961"
_EKUBO_CHAIN_ID_ALIAS_DEC = "23448594291968335"


def _chain_id_raw() -> str | None:
    """Raw chain id for API (hex or decimal string). Ekubo path/query accept hex."""
    if not EKUBO_CHAIN_ID_SEPOLIA:
        return None
    return EKUBO_CHAIN_ID_SEPOLIA.strip()


def _chain_id_candidates(chain_id: str | None) -> list[str]:
    """
    Return candidate chain ids to try with Ekubo API.
    Ekubo testnet data can live under 0x534e5f4d41494f while app env may use SN_SEPOLIA.
    """
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: str | None) -> None:
        if not raw:
            return
        value = raw.strip()
        if not value:
            return
        key = value.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(value)

    add(chain_id)

    normalized = (chain_id or "").strip().lower()
    if normalized in {
        _SN_SEPOLIA_CHAIN_ID.lower(),
        _SN_SEPOLIA_CHAIN_ID_DEC,
    }:
        add(_EKUBO_API_CHAIN_ID_ALIAS)
        add(_EKUBO_CHAIN_ID_ALIAS_DEC)
    elif normalized in {
        _EKUBO_API_CHAIN_ID_ALIAS.lower(),
        _EKUBO_CHAIN_ID_ALIAS_DEC,
    }:
        add(_SN_SEPOLIA_CHAIN_ID)
        add(_SN_SEPOLIA_CHAIN_ID_DEC)

    return out


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
    last_error: httpx.HTTPStatusError | None = None
    candidates = _chain_id_candidates(chain_id)
    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, cid in enumerate(candidates):
            r = await client.get(f"{EKUBO_API_BASE}/tokens/{cid}/{token_address}")
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {}


async def get_overview_pairs(chain_id: str | None = None, min_tvl_usd: float | None = 1000) -> dict[str, Any]:
    """GET /overview/pairs - top pairs. Pass None for all chains (query chainId=hex can return 500)."""
    cid = chain_id
    base_params: dict[str, Any] = {}
    if min_tvl_usd is not None:
        base_params["minTvlUsd"] = min_tvl_usd

    candidates = [None] if cid is None else _chain_id_candidates(cid)
    last_error: httpx.HTTPStatusError | None = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, candidate in enumerate(candidates):
            params = dict(base_params)
            if candidate is not None:
                params["chainId"] = candidate
            r = await client.get(f"{EKUBO_API_BASE}/overview/pairs", params=params)
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {"topPairs": []}


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
    candidates = _chain_id_candidates(chain_id)
    last_error: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, cid in enumerate(candidates):
            r = await client.get(
                f"{EKUBO_API_BASE}/pair/{cid}/{token_a}/{token_b}/pools",
                params=params,
            )
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {"topPools": []}


async def get_pair_tvl(chain_id: str, token_a: str, token_b: str) -> dict[str, Any]:
    """GET /pair/{chainId}/{tokenA}/{tokenB}/tvl - pair TVL. chain_id as hex or decimal string."""
    candidates = _chain_id_candidates(chain_id)
    last_error: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, cid in enumerate(candidates):
            r = await client.get(f"{EKUBO_API_BASE}/pair/{cid}/{token_a}/{token_b}/tvl")
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {}


async def get_pair_volume(chain_id: str, token_a: str, token_b: str) -> dict[str, Any]:
    """GET /pair/{chainId}/{tokenA}/{tokenB}/volume - pair volume. chain_id as hex or decimal string."""
    candidates = _chain_id_candidates(chain_id)
    last_error: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, cid in enumerate(candidates):
            r = await client.get(f"{EKUBO_API_BASE}/pair/{cid}/{token_a}/{token_b}/volume")
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {}


async def get_pair_positions(chain_id: str, token_a: str, token_b: str) -> dict[str, Any]:
    """GET /pair/{chainId}/{tokenA}/{tokenB}/positions - top LP positions for a pair."""
    candidates = _chain_id_candidates(chain_id)
    last_error: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, cid in enumerate(candidates):
            r = await client.get(f"{EKUBO_API_BASE}/pair/{cid}/{token_a}/{token_b}/positions")
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {"data": []}


async def get_price_history(
    chain_id: str, base_token: str, quote_token: str, interval: int | None = None
) -> dict[str, Any]:
    """GET /price/{chainId}/{baseToken}/{quoteToken}/history - VWAP price history. chain_id as hex or decimal string."""
    params = {} if interval is None else {"interval": interval}
    candidates = _chain_id_candidates(chain_id)
    last_error: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, cid in enumerate(candidates):
            r = await client.get(
                f"{EKUBO_API_BASE}/price/{cid}/{base_token}/{quote_token}/history",
                params=params,
            )
            try:
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as err:
                last_error = err
                should_retry = idx < (len(candidates) - 1)
                if should_retry and err.response.status_code >= 500:
                    continue
                raise
    if last_error is not None:
        raise last_error
    return {}
