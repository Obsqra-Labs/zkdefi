"""Tests for SignalReport integration in ai_allocation."""

from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock

from app.services.ai_allocation import compute_allocation
from app.services.pool_metrics import PoolMetric
from app.services.risk_engine import RiskAssessment, AllocationBounds
from app.services.signal_report import SignalReport


def _pool(pool_id: str, apy: float = 15.0, tvl: float = 100_000.0, tier: str = "blue_chip") -> PoolMetric:
    return PoolMetric(
        pool_id=pool_id,
        protocol="Ekubo",
        pair="STRK/ETH",
        apy_pct=apy,
        tvl_usd=tvl,
        volume_24h_usd=50_000.0,
        fee_ratio=0.003,
        risk_tier=tier,
        raw={},
    )


def _assessment(label: str = "balanced", risk_level: int = 5) -> RiskAssessment:
    if label == "balanced":
        bounds = AllocationBounds(
            min_deposit_pct=0.30, max_deposit_pct=0.70,
            min_lp_pct=0.30, max_lp_pct=0.70,
        )
        max_single = 0.60
    elif label == "aggressive":
        bounds = AllocationBounds(
            min_deposit_pct=0.00, max_deposit_pct=0.40,
            min_lp_pct=0.60, max_lp_pct=1.00,
        )
        max_single = 0.50
    else:
        bounds = AllocationBounds(
            min_deposit_pct=0.70, max_deposit_pct=1.00,
            min_lp_pct=0.00, max_lp_pct=0.30,
        )
        max_single = 0.80

    return RiskAssessment(
        risk_level=risk_level,
        risk_score=risk_level / 10.0,
        label=label,
        bounds=bounds,
        safe_protocols=["ekubo_stable_lp", "ekubo_volatile_lp"],
        max_single_pool_pct=max_single,
        reasoning="test",
    )


@pytest.mark.asyncio
@patch("app.services.ai_allocation._try_llm", new_callable=AsyncMock, return_value=None)
async def test_compute_allocation_accepts_signal_reports(_mock_llm):
    pools = [_pool("pool_a"), _pool("pool_b")]
    signals = {
        "pool_a": SignalReport(pool_id="pool_a", gates_passed=2, gates_total=3, slippage_ok=True),
        "pool_b": SignalReport(pool_id="pool_b", gates_passed=1, gates_total=3, slippage_ok=True),
    }
    result = await compute_allocation(
        assessment=_assessment(),
        pools=pools,
        deposit_amount=10_000.0,
        signals=signals,
    )
    assert result.source == "deterministic"
    assert len(result.allocations) > 0
    assert result.deposit_amount == 10_000.0


@pytest.mark.asyncio
@patch("app.services.ai_allocation._try_llm", new_callable=AsyncMock, return_value=None)
async def test_deterministic_allocation_boosts_pools_with_passing_gates(_mock_llm):
    pool_good = _pool("pool_good", apy=20.0, tvl=200_000.0)
    pool_bad = _pool("pool_bad", apy=20.0, tvl=200_000.0)
    signals = {
        "pool_good": SignalReport(pool_id="pool_good", gates_passed=3, gates_total=3, slippage_ok=True),
        "pool_bad": SignalReport(pool_id="pool_bad", gates_passed=0, gates_total=3, slippage_ok=True),
    }
    result = await compute_allocation(
        assessment=_assessment("balanced"),
        pools=[pool_good, pool_bad],
        deposit_amount=10_000.0,
        signals=signals,
    )
    allocs = {a.pool_id: a.weight_pct for a in result.allocations}
    assert allocs.get("pool_good", 0) > allocs.get("pool_bad", 0)


@pytest.mark.asyncio
@patch("app.services.ai_allocation._try_llm", new_callable=AsyncMock, return_value=None)
async def test_deterministic_allocation_penalizes_slippage_failure(_mock_llm):
    pool_ok = _pool("pool_ok", apy=15.0, tvl=100_000.0)
    pool_slip = _pool("pool_slip", apy=15.0, tvl=100_000.0)
    signals = {
        "pool_ok": SignalReport(pool_id="pool_ok", gates_passed=2, gates_total=3, slippage_ok=True),
        "pool_slip": SignalReport(pool_id="pool_slip", gates_passed=2, gates_total=3, slippage_ok=False),
    }
    result = await compute_allocation(
        assessment=_assessment("balanced"),
        pools=[pool_ok, pool_slip],
        deposit_amount=10_000.0,
        signals=signals,
    )
    allocs = {a.pool_id: a.weight_pct for a in result.allocations}
    assert allocs.get("pool_ok", 0) > allocs.get("pool_slip", 0)
