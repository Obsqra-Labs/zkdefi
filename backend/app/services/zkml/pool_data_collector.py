"""
Pool Data Collector — Live Starknet Mainnet pool aggregation.

Sources:
  • Ekubo  — DEX LP pools via prod-api.ekubo.org  (mainnet)
  • Vesu   — Lending markets via api.vesu.xyz       (mainnet)

The data is piped into the deterministic PoolRiskEvaluator for scoring,
then surfaced in the Capital-OS landing page demo.  No on-chain tx are sent;
execution stays on Sepolia.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
import logging

from app.services.zkml.pool_evaluator import PoolMetrics

logger = logging.getLogger(__name__)

# ─── Vesu API ────────────────────────────────────────────────────────────────

VESU_API_URL = "https://api.vesu.xyz/markets"
VESU_TIMEOUT = 12.0

# Only surface pools whose names contain these (avoids deprecated/exotic)
_VESU_POOL_ALLOWLIST = {
    "Prime",
    "Re7 USDC Core",
    "Re7 USDC Stable Core",
    "Re7 ETH",
    "Re7 STRK",
    "Re7 xBTC",
    "Clearstar USDC Reactor",
}

# Tokens we want to see from Vesu
_VESU_TOKEN_ALLOWLIST = {"USDC", "ETH", "STRK", "WBTC", "wstETH", "USDT", "DAI", "tBTC", "SolvBTC", "LBTC"}


def _vesu_parse_decimal(obj: Any) -> float:
    """Parse Vesu's {value, decimals} format into a float."""
    if not isinstance(obj, dict):
        return 0.0
    try:
        value = int(obj.get("value", 0))
        decimals = int(obj.get("decimals", 18))
        return value / (10 ** decimals) if decimals else 0.0
    except Exception:
        return 0.0


async def _fetch_vesu_markets(client: httpx.AsyncClient) -> List[PoolMetrics]:
    """Fetch live Vesu lending markets from mainnet API."""
    try:
        resp = await client.get(VESU_API_URL, timeout=VESU_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Vesu API fetch failed: %s", exc)
        return []

    markets = data.get("data", [])
    pools: List[PoolMetrics] = []

    for m in markets:
        pool_info = m.get("pool", {})
        if pool_info.get("isDeprecated"):
            continue

        pool_name = pool_info.get("name", "")
        symbol = m.get("symbol", "")

        # Filter to known good pools + tokens
        if pool_name not in _VESU_POOL_ALLOWLIST:
            continue
        if symbol not in _VESU_TOKEN_ALLOWLIST:
            continue

        stats = m.get("stats") or {}
        supply_apy = _vesu_parse_decimal(stats.get("supplyApy"))
        total_supplied = _vesu_parse_decimal(stats.get("totalSupplied"))
        price_usd = _vesu_parse_decimal(m.get("usdPrice"))
        tvl_usd = total_supplied * price_usd

        if tvl_usd < 5_000 or supply_apy <= 0:
            continue

        # Unique pool id
        pool_id_suffix = pool_info.get("id", "")[:16]
        pool_id = f"vesu_{symbol.lower()}_{pool_id_suffix}"

        display_name = f"Vesu {symbol} · {pool_name}"

        pools.append(
            PoolMetrics(
                pool_id=pool_id,
                name=display_name,
                protocol="vesu",
                liquidity_usd=tvl_usd,
                volume_24h_usd=tvl_usd * 0.05,  # lending doesn't have trade volume
                fee_tier=0.0,
                price_std_dev_24h=0.02,  # lending: very stable
                slippage_at_1000usd=0.0,  # no slippage on lending
                token0=symbol,
                token1="USD",
                current_apy=supply_apy,
                timestamp=datetime.now(),
            )
        )

    pools.sort(key=lambda p: p.liquidity_usd, reverse=True)
    logger.info("Vesu: fetched %d live mainnet lending markets", len(pools))
    return pools


# ─── Ekubo (delegate to real_pool_aggregator) ────────────────────────────────

async def _fetch_ekubo_pools() -> List[PoolMetrics]:
    """Use the existing EkuboPoolAggregator to get live mainnet pools,
    then convert AggregatedPool → PoolMetrics for the evaluator."""
    from app.services.real_pool_aggregator import EkuboPoolAggregator

    agg = EkuboPoolAggregator()  # reads EKUBO_CHAIN_ID from env (SN_MAIN)
    try:
        raw_pools = await agg.fetch_pools(min_tvl_usd=5_000, limit=25)
    except Exception as exc:
        logger.warning("Ekubo mainnet fetch failed: %s", exc)
        return []

    pools: List[PoolMetrics] = []
    for rp in raw_pools:
        pair = rp.pair  # e.g. "ETH/USDC"
        parts = pair.split("/")
        token0 = parts[0] if len(parts) > 0 else "?"
        token1 = parts[1] if len(parts) > 1 else "?"

        # Estimate volatility from fee tier (higher fee ≈ volatile pair)
        vol_estimate = min(0.30, max(0.04, rp.fee_ratio * 20))
        # Slippage estimate from TVL
        slip_estimate = min(0.10, max(0.001, 1000.0 / max(rp.tvl_usd, 1)))

        pools.append(
            PoolMetrics(
                pool_id=rp.pool_id,
                name=f"Ekubo {pair} {rp.fee_ratio*100:.2f}%",
                protocol="ekubo",
                liquidity_usd=rp.tvl_usd,
                volume_24h_usd=rp.volume_24h_usd,
                fee_tier=rp.fee_ratio,
                price_std_dev_24h=vol_estimate,
                slippage_at_1000usd=slip_estimate,
                token0=token0,
                token1=token1,
                current_apy=rp.estimated_fee_apy_pct / 100.0,  # pct → ratio
                timestamp=datetime.now(),
            )
        )

    logger.info("Ekubo: fetched %d live mainnet LP pools", len(pools))
    return pools


# ─── Collector class ─────────────────────────────────────────────────────────


class PoolDataCollector:
    """
    Aggregates live Starknet Mainnet opportunities across protocols:
     • Ekubo concentrated-liquidity DEX pools
     • Vesu lending markets

    Falls back to mock data only if live sources are completely unreachable.
    """

    def __init__(self, rpc_url: str = "unused"):
        self._http = httpx.AsyncClient(timeout=15.0)

    # ── Live fetchers ────────────────────────────────────────────────────

    async def get_ekubo_pools(self) -> List[PoolMetrics]:
        return await _fetch_ekubo_pools()

    async def get_vesu_pools(self) -> List[PoolMetrics]:
        return await _fetch_vesu_markets(self._http)

    async def get_vesu_rates(self) -> dict:
        """Legacy dict format expected by some callers."""
        vesu_pools = await self.get_vesu_pools()
        rates: Dict[str, dict] = {}
        for p in vesu_pools:
            key = p.token0.lower()
            # Keep highest-TVL entry per token
            if key in rates and rates[key]["liquidity_usd"] >= p.liquidity_usd:
                continue
            rates[key] = {
                "pool_id": p.pool_id,
                "name": p.name,
                "protocol": "vesu",
                "apy": p.current_apy,
                "liquidity_usd": p.liquidity_usd,
                "risk_score": 15 if p.current_apy < 0.03 else 25,
            }
        return rates

    # ── Main entry point ─────────────────────────────────────────────────

    async def get_all_pools(self) -> tuple[List[PoolMetrics], dict]:
        """
        Fetch all available pools and rates from live Starknet Mainnet sources.
        Returns: (all_pool_metrics, vesu_rates_dict)
        """
        import asyncio

        ekubo_task = asyncio.create_task(self.get_ekubo_pools())
        vesu_task = asyncio.create_task(self.get_vesu_pools())

        ekubo_pools: List[PoolMetrics] = []
        vesu_pools: List[PoolMetrics] = []

        try:
            ekubo_pools = await ekubo_task
        except Exception as e:
            logger.error("Ekubo live fetch failed: %s", e)

        try:
            vesu_pools = await vesu_task
        except Exception as e:
            logger.error("Vesu live fetch failed: %s", e)

        all_pools = ekubo_pools + vesu_pools

        if not all_pools:
            logger.warning("All live sources failed — returning empty")
            return [], {}

        # Build legacy vesu rates dict
        vesu_rates: Dict[str, dict] = {}
        for p in vesu_pools:
            key = p.token0.lower()
            if key in vesu_rates and vesu_rates[key]["liquidity_usd"] >= p.liquidity_usd:
                continue
            vesu_rates[key] = {
                "pool_id": p.pool_id,
                "name": p.name,
                "protocol": "vesu",
                "apy": p.current_apy,
                "liquidity_usd": p.liquidity_usd,
                "risk_score": 15 if p.current_apy < 0.03 else 25,
            }

        logger.info(
            "Pool collector: %d Ekubo + %d Vesu = %d total mainnet opportunities",
            len(ekubo_pools),
            len(vesu_pools),
            len(all_pools),
        )
        return all_pools, vesu_rates

    async def get_pool_metrics_by_amount(
        self,
        pool_id: str,
        amount: float,
    ) -> Optional[dict]:
        """Slippage estimate for a given amount in a pool."""
        # Simple model: slippage scales with amount relative to pool TVL
        return {
            "pool_id": pool_id,
            "amount": amount,
            "expected_out": amount * 0.99,
            "slippage": 0.01,
        }


async def test_pool_collector():
    """Test the live collector."""
    collector = PoolDataCollector()

    pools, vesu_rates = await collector.get_all_pools()

    print(f"Total pools found: {len(pools)}")
    for pool in pools:
        proto = pool.protocol.upper()
        print(f"  [{proto:6s}] {pool.name:40s} TVL: ${pool.liquidity_usd:>12,.0f}  APY: {pool.current_apy:.2%}")

    print(f"\nVesu rates ({len(vesu_rates)} assets):")
    for asset, rate in vesu_rates.items():
        print(f"  - {asset}: {rate['apy']:.2%}  TVL: ${rate['liquidity_usd']:,.0f}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(test_pool_collector())
