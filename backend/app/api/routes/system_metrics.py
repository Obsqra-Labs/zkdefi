"""
System metrics for control-surface System tab.

GET /system/metrics returns TVL, profits, zkML status for the frontend System Monitor.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/system", tags=["system"])

_SIM_BASE = os.getenv("MM_SIM_URL", "http://localhost:8099")


class SystemMetricsResponse(BaseModel):
    """Control-surface system metrics (Phase 5)."""

    total_vault_tvl: float | None = Field(None, description="Total vault TVL (USD) from oracle if available")
    ai_pool_tvl: float | None = Field(None, description="AI pool TVL (USD) if available")
    profits_24h: float | None = Field(None, description="Profits last 24h (USD) if available")
    zkml_status: str = Field("ok", description="zkML model status: ok | unavailable")
    sim_price: float | None = Field(None, description="Current sim price (if available)")
    sim_tvl: float | None = Field(None, description="Current sim TVL (if available)")
    data_quality: str = Field("live", description="'live' or 'simulated'")
    timestamp: int = Field(..., description="Unix timestamp of snapshot")


def _get_tvl_from_oracle() -> tuple[float | None, float | None]:
    """Return (total_vault_tvl, ai_pool_tvl) from oracle snapshot if available."""
    try:
        from app.services.mainnet_oracle import get_oracle

        oracle = get_oracle()
        snapshot = oracle.get_latest_snapshot()
        if not snapshot:
            return None, None
        j = snapshot.jediswap or {}
        e = snapshot.ekubo or {}
        jedi_tvl = float(j.get("tvl", 0) or 0)
        ekubo_tvl = float(e.get("tvl", 0) or 0)
        total = jedi_tvl + ekubo_tvl
        return total if total > 0 else None, total if total > 0 else None
    except Exception:
        return None, None


async def _get_sim_snapshot() -> dict[str, Any] | None:
    """Fetch current sim state; return None on failure."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{_SIM_BASE}/public/state")
            if resp.status_code == 200:
                return resp.json()
    except Exception:
        pass
    return None


@router.get("/metrics", response_model=SystemMetricsResponse)
async def get_system_metrics() -> dict[str, Any]:
    """Return system metrics for the control-surface System tab.

    Enriches oracle TVL with sim price/tvl when available. When oracle
    returns nothing, falls back to sim data tagged as simulated."""
    total_tvl, ai_tvl = _get_tvl_from_oracle()
    sim = await _get_sim_snapshot()
    sim_price = sim.get("price") if sim else None
    sim_tvl = sim.get("tvl_usd") if sim else None
    profits = sim.get("fees_24h") if sim else None

    # Determine data quality
    quality = "live" if total_tvl is not None else ("simulated" if sim else "unavailable")
    # Fall back to sim TVL when oracle has nothing
    if total_tvl is None and sim_tvl is not None:
        total_tvl = sim_tvl
        ai_tvl = sim_tvl

    return {
        "total_vault_tvl": total_tvl,
        "ai_pool_tvl": ai_tvl,
        "profits_24h": profits,
        "zkml_status": "ok",
        "sim_price": sim_price,
        "sim_tvl": sim_tvl,
        "data_quality": quality,
        "timestamp": int(time.time()),
    }
