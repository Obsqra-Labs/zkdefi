"""
Real pool aggregator for Starknet Sepolia.

Current scope:
- Fetches live Ekubo pair data from `prod-api.ekubo.org`
- Normalizes it into a stable shape for strategy execution
- Computes an estimated fee APY from 24h volume and TVL
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

from app.services.ekubo_client import get_overview_pairs

logger = logging.getLogger(__name__)


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [p for p in payload if isinstance(p, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("pairs", "items", "data", "results", "topPairs", "top_pools"):
        value = payload.get(key)
        if isinstance(value, list):
            return [p for p in value if isinstance(p, dict)]
    # Fallback for unknown response shapes
    return []


# Known Sepolia/Mainnet token addresses → symbols
_TOKEN_SYMBOLS: dict[str, str] = {
    # Starknet Mainnet — core tokens
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
    "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": "USDC",
    "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8": "USDT",
    "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac": "WBTC",
    "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3": "DAI",
    "0x0124aeb495b947201f5fac96fd1138e326ad86195b98df6dec9009158a533b49": "LORDS",
    # Starknet Mainnet — LSTs / wrapped BTC variants
    "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb": "USDC.e",    # Bridged USDC on Starknet
    "0x042b8f0484674ca266ac5d08e4ac6a3fe65bd3129795def2dca5c34ecc5f96d2": "wstETH",    # Wrapped liquid staked Ether
    "0x057912720381af14b0e5c87aa4718ed5e527eab60b3801ebf702ab09139e38b": "wstETH",    # Wrapped Staked Ether (alt bridge)
    "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a": "xSTRK",     # Endur xSTRK
    "0x036834a40984312f7f7de8d31e3f6305b325389eaeea5b1c0664b2fb936461a4": "LBTC",      # Lombard Staked Bitcoin
    "0x04daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f": "tBTC",      # Threshold tBTC
    "0x0593e034dda23eea82d2ba9a30960ed42cf4a01502cc2351dc9b9881f9931a68": "SolvBTC",   # Solv BTC
    "0x06a567e68c805323525fe1649adb80b03cddf92c23d2629a6779f54192dffc13": "xWBTC",     # Endur xWBTC
    # Bridged L1 addresses (Ekubo API sometimes returns these)
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "WBTC",
    "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
    "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
    "0x514910771af9ca656af840dff83e8264ecf986ca": "LINK",
    "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": "UNI",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
    "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e": "crvUSD",
    "0x4c46e830bb56ce22735d5d8fc9cb90309317d0f": "NSTR",
    "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c": "EKUBO",
    "0x68749665ff8d2d112fa859aa293f07a622782f38": "zkLEND",
    "0x6440f144b7e50d6a8439336510312d2f54beb01d": "SSTR",
    "0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f": "GHO",
    "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": "USDe",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
    "0x1791f726b4103694969820be083196cc7c045ff": "ZKT",
    "0xd9fcd98c322942075a5c3860693e9f4f03aae07b": "EURe",
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC.e",
    "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "cbBTC",
    "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": "wstETH",
    "0xc93b16cb1d8691e629514fc98f02cbad340da3c": "xSTRK",
    # Sepolia / testnet
    "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": "USDC",
    "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": "fUSDC",
    "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121": "zkdETH",
    "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637": "zkdAI",
    "0x9b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121": "zkdETH",
    "0x50974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637": "zkdAI",
    # Zero-address = native ETH on some indexers
    "0x0": "ETH",
}


def _normalize_hex(h: str) -> str:
    """Strip leading zeros after 0x so 0x049d... and 0x49d... compare equal."""
    if h.startswith("0x"):
        return "0x" + (h[2:].lstrip("0") or "0")
    return h


_NORMALIZED_SYMBOLS: dict[str, str] = {_normalize_hex(k).lower(): v for k, v in _TOKEN_SYMBOLS.items()}


def _addr_to_symbol(addr: Any) -> str:
    if isinstance(addr, dict):
        return addr.get("symbol") or addr.get("name") or _addr_to_symbol(addr.get("address", ""))
    s = str(addr).strip().lower()
    hit = _NORMALIZED_SYMBOLS.get(_normalize_hex(s).lower())
    if hit:
        return hit
    if len(s) > 8:
        return s[-6:].upper()
    return s or "TOKEN"


def _pair_symbol(item: dict[str, Any]) -> str:
    sym0 = _addr_to_symbol(item.get("token0"))
    sym1 = _addr_to_symbol(item.get("token1"))
    return f"{sym0}/{sym1}"


# ── Token metadata: decimals + live USD price from oracle ─────────────
_TOKEN_DECIMALS: dict[str, int] = {
    "ETH": 18, "STRK": 18, "USDC": 6, "USDT": 6,
    "fUSDC": 6, "DAI": 18, "WBTC": 8, "LINK": 18,
    "zkdETH": 18, "zkdAI": 18,
}
# Stablecoin fallback prices (always $1); volatile tokens use live oracle.
_STABLE_PRICES: dict[str, float] = {
    "USDC": 1.0, "USDT": 1.0, "fUSDC": 1.0, "DAI": 1.0, "zkdAI": 1.0,
}
_FIXED_PRICES: dict[str, float] = {
    "zkdETH": 3500.0,
}
_DEFAULT_DECIMALS = 18
_DEFAULT_PRICE_USD = 0.0  # unknown tokens get $0 → filtered out

# Live price cache populated by refresh_live_prices()
_live_usd: dict[str, float] = {}


async def refresh_live_prices() -> None:
    """Pull STRK + ETH USD prices from oracle adapter and update cache."""
    try:
        from app.services.ekubo.oracle_adapter import get_live_prices
        prices = await get_live_prices()
        if prices.get("strk_usd"):
            _live_usd["STRK"] = float(prices["strk_usd"])
        if prices.get("eth_usd"):
            _live_usd["ETH"] = float(prices["eth_usd"])
            # Derive WBTC estimate (rough BTC/ETH ratio) — better than nothing
            if "WBTC" not in _live_usd:
                _live_usd["WBTC"] = float(prices["eth_usd"]) * 27  # ~27x ETH
    except Exception as exc:
        logger.warning("refresh_live_prices failed: %s — using stale cache", exc)


def _token_decimals(symbol: str) -> int:
    return _TOKEN_DECIMALS.get(symbol, _DEFAULT_DECIMALS)


def _token_price_usd(symbol: str) -> float:
    # 1. Stablecoin → always $1
    if symbol in _STABLE_PRICES:
        return _STABLE_PRICES[symbol]
    # 2. Live oracle price
    if symbol in _live_usd:
        return _live_usd[symbol]
    # 3. Fixed synthetic price (testnet wrappers)
    if symbol in _FIXED_PRICES:
        return _FIXED_PRICES[symbol]
    # 3. Fallback → $0 (filtered out downstream)
    return _DEFAULT_PRICE_USD


# Compatibility map used by yield_collector: symbol -> (decimals, usd_price)
_TOKEN_META: dict[str, tuple[int, float]] = {
    sym: (_token_decimals(sym), _token_price_usd(sym))
    for sym in {
        "ETH", "STRK", "USDC", "USDT", "fUSDC", "DAI", "WBTC", "LINK", "zkdETH", "zkdAI"
    }
}


def _raw_to_human(raw: float, symbol: str) -> float:
    """Convert raw integer amount to human-readable token amount."""
    return raw / (10 ** _token_decimals(symbol))


def _raw_to_usd(raw: float, symbol: str) -> float:
    """Convert raw integer amount to approximate USD."""
    return _raw_to_human(raw, symbol) * _token_price_usd(symbol)


def _pool_id(item: dict[str, Any], idx: int) -> str:
    for key in ("id", "pool_id", "pair_id", "address"):
        value = item.get(key)
        if value:
            return str(value)
    t0 = item.get("token0")
    t1 = item.get("token1")
    token0 = t0.get("address", "token0") if isinstance(t0, dict) else str(t0 or "token0")
    token1 = t1.get("address", "token1") if isinstance(t1, dict) else str(t1 or "token1")
    fee = item.get("fee") or item.get("fee_tier") or "na"
    return f"ekubo:{token0}:{token1}:{fee}:{idx}"


def _fee_pct(item: dict[str, Any]) -> float:
    raw = item.get("fee") or item.get("fee_tier")
    fee = _as_float(raw, default=0.003)
    # If API returns fee percent (e.g. 0.3), convert to ratio.
    if fee > 1:
        return fee / 100.0
    return fee


def _tvl_usd(item: dict[str, Any]) -> float:
    """TVL in approximate USD using per-token decimals + static prices."""
    for key in ("tvl_usd", "tvlUsd"):
        value = item.get(key)
        if value is not None:
            return _as_float(value, 0.0)
    sym0 = _addr_to_symbol(item.get("token0"))
    sym1 = _addr_to_symbol(item.get("token1"))
    tvl0 = _raw_to_usd(_as_float(item.get("tvl0_total"), 0.0), sym0)
    tvl1 = _raw_to_usd(_as_float(item.get("tvl1_total"), 0.0), sym1)
    return tvl0 + tvl1


def _volume_24h_usd(item: dict[str, Any]) -> float:
    """24h volume in approximate USD."""
    for key in ("volume_24h_usd", "volume24hUsd"):
        value = item.get(key)
        if value is not None:
            return _as_float(value, 0.0)
    sym0 = _addr_to_symbol(item.get("token0"))
    sym1 = _addr_to_symbol(item.get("token1"))
    v0 = _raw_to_usd(_as_float(item.get("volume0_24h"), 0.0), sym0)
    v1 = _raw_to_usd(_as_float(item.get("volume1_24h"), 0.0), sym1)
    return v0 + v1


def _estimated_fee_apy(item: dict[str, Any], tvl_usd: float) -> float:
    """Annualised fee APY from daily fees / TVL (both in USD)."""
    if tvl_usd <= 0:
        return 0.0
    # Direct fee data (preferred)
    sym0 = _addr_to_symbol(item.get("token0"))
    sym1 = _addr_to_symbol(item.get("token1"))
    f0 = _raw_to_usd(_as_float(item.get("fees0_24h"), 0.0), sym0)
    f1 = _raw_to_usd(_as_float(item.get("fees1_24h"), 0.0), sym1)
    daily_fees = f0 + f1
    if daily_fees > 0:
        return (daily_fees / tvl_usd) * 365.0 * 100.0
    # Fallback: volume * fee_ratio / tvl
    volume = _volume_24h_usd(item)
    fee_ratio = _fee_pct(item)
    if volume <= 0 or fee_ratio <= 0:
        return 0.0
    return (volume * fee_ratio * 365.0 / tvl_usd) * 100.0


@dataclass
class AggregatedPool:
    pool_id: str
    protocol: str
    pair: str
    tvl_usd: float
    volume_24h_usd: float
    fee_ratio: float
    estimated_fee_apy_pct: float
    raw: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "pool_id": self.pool_id,
            "protocol": self.protocol,
            "pair": self.pair,
            "tvl_usd": self.tvl_usd,
            "volume_24h_usd": self.volume_24h_usd,
            "fee_ratio": self.fee_ratio,
            "estimated_fee_apy_pct": self.estimated_fee_apy_pct,
            "raw": self.raw,
        }


class EkuboPoolAggregator:
    """
    Live Ekubo data source for strategy execution.

    Note: `rpc_url` is accepted for API compatibility with existing callers, but
    current implementation uses Ekubo's HTTP API for normalized pool discovery.
    """

    def __init__(self, rpc_url: str = "http://localhost:5050", chain_id: Optional[str] = "ENV"):
        self.rpc_url = rpc_url
        # chain_id="ENV" → read from env; chain_id=None → no chain filter (mainnet)
        if chain_id == "ENV":
            self.chain_id = os.getenv("EKUBO_CHAIN_ID")
        else:
            self.chain_id = chain_id

    async def fetch_pools(self, min_tvl_usd: float = 0.0, limit: int = 50) -> list[AggregatedPool]:
        from app.services.circuit_breaker import ekubo_breaker, retry_with_backoff, CircuitBreakerError

        # Refresh live oracle prices before computing TVLs
        try:
            await ekubo_breaker.call(refresh_live_prices)
        except CircuitBreakerError:
            logger.warning("Ekubo circuit breaker open - using stale prices")
        except Exception:
            logger.warning("Price refresh failed - continuing with cached prices")

        try:
            payload = await retry_with_backoff(
                get_overview_pairs, chain_id=self.chain_id, min_tvl_usd=min_tvl_usd,
                max_retries=2, base_delay=1.0,
            )
        except Exception as e:
            logger.error("Failed to fetch Ekubo pools after retries: %s", e)
            return []
        items = _extract_items(payload)
        pools: list[AggregatedPool] = []

        for idx, item in enumerate(items):
            tvl = _tvl_usd(item)
            volume = _volume_24h_usd(item)
            fee_ratio = _fee_pct(item)
            pools.append(
                AggregatedPool(
                    pool_id=_pool_id(item, idx),
                    protocol="Ekubo",
                    pair=_pair_symbol(item),
                    tvl_usd=tvl,
                    volume_24h_usd=volume,
                    fee_ratio=fee_ratio,
                    estimated_fee_apy_pct=_estimated_fee_apy(item, tvl),
                    raw=item,
                )
            )

        pools.sort(key=lambda p: p.tvl_usd, reverse=True)
        if limit > 0:
            pools = pools[:limit]
        return pools

    async def get_top_pools(self, min_tvl_usd: float = 1000.0, limit: int = 20) -> list[dict[str, Any]]:
        pools = await self.fetch_pools(min_tvl_usd=min_tvl_usd, limit=limit)
        return [p.to_dict() for p in pools]

    async def get_pool_by_pair(self, pair: str, min_tvl_usd: float = 0.0) -> Optional[dict[str, Any]]:
        needle = pair.strip().lower()
        pools = await self.fetch_pools(min_tvl_usd=min_tvl_usd, limit=200)
        for pool in pools:
            if pool.pair.lower() == needle:
                return pool.to_dict()
        return None

    async def aggregate_pools(self, risk_profile: str, deposit_amount: float) -> dict[str, Any]:
        """
        Backward-compatible shape used by legacy `vault_execute_live` route.
        """
        pools = await self.get_top_pools(min_tvl_usd=0.0, limit=20)
        if not pools:
            return {
                "status": "success",
                "total_pools_found": 0,
                "pools": [],
                "allocations": [],
                "total_expected_apy": 0.0,
            }

        profile = (risk_profile or "").strip().lower()
        if profile == "conservative":
            take = 1
        elif profile == "aggressive":
            take = min(3, len(pools))
        else:
            take = min(2, len(pools))

        selected = pools[:take]
        split = 1.0 / float(take)
        allocations: list[dict[str, Any]] = []
        weighted_apy = 0.0

        for pool in selected:
            apy = _as_float(pool.get("estimated_fee_apy_pct"), 0.0)
            amount = float(deposit_amount) * split
            weighted_apy += apy * split
            allocations.append(
                {
                    "pool": pool.get("pair", pool.get("pool_id")),
                    "pool_id": pool.get("pool_id"),
                    "protocol": "Ekubo",
                    "amount": amount,
                    "expected_apy_min": max(0.0, apy * 0.8),
                    "expected_apy_max": apy * 1.2,
                }
            )

        return {
            "status": "success",
            "total_pools_found": len(pools),
            "pools": selected,
            "allocations": allocations,
            "total_expected_apy": weighted_apy,
        }
