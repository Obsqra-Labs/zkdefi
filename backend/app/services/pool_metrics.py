"""
Pool Metrics Service — live Ekubo pool data with TTL cache.

Single source of truth for APY / TVL / volume used by the AI allocation engine.
No mocks. Pulls from prod-api.ekubo.org via real_pool_aggregator.

Future: add Vesu / JediSwap by appending to _fetch_all().
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, asdict
from typing import Any

from app.services.real_pool_aggregator import EkuboPoolAggregator

logger = logging.getLogger(__name__)

_CACHE_TTL_S = 300  # 5 minutes


@dataclass
class PoolMetric:
    pool_id: str
    protocol: str           # "Ekubo"
    pair: str               # "STRK/ETH"
    apy_pct: float          # estimated annualised fee APY %
    tvl_usd: float
    volume_24h_usd: float
    fee_ratio: float        # e.g. 0.003
    risk_tier: str          # "stable" | "volatile" | "concentrated"
    raw: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── Risk tier classification ────────────────────────────────────────────

_STABLECOINS = {"USDC", "USDT", "DAI", "FUSDC"}
_VOLATILE_BASES = {"ETH", "STRK", "WBTC", "BTC", "LINK", "LORDS"}


def _classify_risk(pair: str, apy_pct: float) -> str:
    tokens = {t.strip().upper() for t in pair.split("/")}
    # Both tokens are stablecoins → stable
    if tokens <= _STABLECOINS:
        return "stable"
    # One side is stablecoin + one volatile → "blue_chip" (safer volatile)
    if tokens & _STABLECOINS and tokens & _VOLATILE_BASES:
        if apy_pct > 80:
            return "concentrated"
        return "blue_chip"
    # Pure volatile pair
    if tokens & _VOLATILE_BASES:
        if apy_pct > 50:
            return "concentrated"
        return "volatile"
    return "volatile"


# ── Cached fetcher ──────────────────────────────────────────────────────

_cache: dict[str, Any] = {"ts": 0, "pools": []}
# chain_id=None → no chainId param → mainnet data (Sepolia has no Ekubo liquidity API)
_aggregator = EkuboPoolAggregator(chain_id=None)


async def fetch_pool_metrics(
    min_tvl_usd: float = 0.0,
    limit: int = 30,
    force_refresh: bool = False,
) -> list[PoolMetric]:
    """
    Return live Ekubo pool metrics (cached for 5 min).

    Pulls from prod-api.ekubo.org, normalises into PoolMetric.
    """
    now = time.time()
    if not force_refresh and _cache["pools"] and (now - _cache["ts"]) < _CACHE_TTL_S:
        return _cache["pools"]

    try:
        raw_pools = await _aggregator.fetch_pools(min_tvl_usd=min_tvl_usd, limit=limit)
    except Exception as e:
        logger.warning("Pool metrics fetch failed: %s — returning stale cache", e)
        return _cache["pools"]

    metrics: list[PoolMetric] = []
    for p in raw_pools:
        m = PoolMetric(
            pool_id=p.pool_id,
            protocol=p.protocol,
            pair=p.pair,
            apy_pct=p.estimated_fee_apy_pct,
            tvl_usd=p.tvl_usd,
            volume_24h_usd=p.volume_24h_usd,
            fee_ratio=p.fee_ratio,
            risk_tier=_classify_risk(p.pair, p.estimated_fee_apy_pct),
            raw=p.raw,
        )
        metrics.append(m)

    _cache["ts"] = now
    _cache["pools"] = metrics
    logger.info("Pool metrics refreshed: %d pools", len(metrics))
    return metrics


async def get_metrics_summary() -> dict[str, Any]:
    """Quick summary for health endpoints."""
    pools = await fetch_pool_metrics()
    return {
        "pool_count": len(pools),
        "protocols": list({p.protocol for p in pools}),
        "avg_apy_pct": round(sum(p.apy_pct for p in pools) / max(len(pools), 1), 2),
        "total_tvl_usd": round(sum(p.tvl_usd for p in pools), 2),
        "cache_age_s": round(time.time() - _cache["ts"], 1),
    }
