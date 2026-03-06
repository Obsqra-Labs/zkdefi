# Source Generated with Decompyle++
# File: pool_metrics.cpython-312.pyc (Python 3.12)

'''
Pool Metrics Service — live Ekubo pool data with TTL cache.

Single source of truth for APY / TVL / volume used by the AI allocation engine.
No mocks. Pulls from prod-api.ekubo.org via real_pool_aggregator.

Future: add Vesu / JediSwap by appending to _fetch_all().
'''
from __future__ import annotations
import logging
import time
from dataclasses import dataclass, asdict
from typing import Any
from app.services.real_pool_aggregator import EkuboPoolAggregator
logger = logging.getLogger(__name__)
_CACHE_TTL_S = 300
PoolMetric = <NODE:12>()
_STABLECOINS = {
    'DAI',
    'USDC',
    'USDT',
    'FUSDC'}
_VOLATILE_BASES = {
    'BTC',
    'ETH',
    'LINK',
    'STRK',
    'WBTC',
    'LORDS'}

def _classify_risk(pair = None, apy_pct = None):
    pass
# WARNING: Decompyle incomplete

_cache: 'dict[str, Any]' = {
    'ts': 0,
    'pools': [] }
_aggregator = EkuboPoolAggregator(chain_id = None)

async def fetch_pool_metrics(min_tvl_usd = None, limit = None, force_refresh = None):
    '''
    Return live Ekubo pool metrics (cached for 5 min).

    Pulls from prod-api.ekubo.org, normalises into PoolMetric.
    '''
    pass
# WARNING: Decompyle incomplete


async def get_metrics_summary():
    '''Quick summary for health endpoints.'''
    pass
# WARNING: Decompyle incomplete

