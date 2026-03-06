# Source Generated with Decompyle++
# File: system_metrics.cpython-312.pyc (Python 3.12)

'''
System metrics for control-surface System tab.

GET /system/metrics returns TVL, profits, zkML status for the frontend System Monitor.
'''
from __future__ import annotations
import os
import time
from typing import Any
import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field
router = APIRouter(prefix = '/system', tags = [
    'system'])
_SIM_BASE = os.getenv('MM_SIM_URL', 'http://localhost:8099')

class SystemMetricsResponse(BaseModel):
    '''Control-surface system metrics (Phase 5).'''
    total_vault_tvl: 'float | None' = Field(None, description = 'Total vault TVL (USD) from oracle if available')
    ai_pool_tvl: 'float | None' = Field(None, description = 'AI pool TVL (USD) if available')
    profits_24h: 'float | None' = Field(None, description = 'Profits last 24h (USD) if available')
    zkml_status: 'str' = Field('ok', description = 'zkML model status: ok | unavailable')
    sim_price: 'float | None' = Field(None, description = 'Current sim price (if available)')
    sim_tvl: 'float | None' = Field(None, description = 'Current sim TVL (if available)')
    data_quality: 'str' = Field('live', description = "'live' or 'simulated'")
    timestamp: 'int' = Field(..., description = 'Unix timestamp of snapshot')


def _get_tvl_from_oracle():
    '''Return (total_vault_tvl, ai_pool_tvl) from oracle snapshot if available.'''
    get_oracle = get_oracle
    import app.services.mainnet_oracle
    oracle = get_oracle()
    snapshot = oracle.get_latest_snapshot()
    if not snapshot:
        return (None, None)
    if not snapshot.jediswap:
        snapshot.jediswap
    j = { }
    if not snapshot.ekubo:
        snapshot.ekubo
    e = { }
    if not j.get('tvl', 0):
        j.get('tvl', 0)
    jedi_tvl = float(0)
    if not e.get('tvl', 0):
        e.get('tvl', 0)
    ekubo_tvl = float(0)
    total = jedi_tvl + ekubo_tvl
    if total > 0:
        return (total if total > 0 else None, total)
    return (None, total if total > 0 else None)
# WARNING: Decompyle incomplete


async def _get_sim_snapshot():
    '''Fetch current sim state; return None on failure.'''
    pass
# WARNING: Decompyle incomplete

get_system_metrics = (lambda : pass# WARNING: Decompyle incomplete
)()
