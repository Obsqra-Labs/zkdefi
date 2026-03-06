from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

_CIRCUIT_OK = {
    "success": True,
    "is_compliant": True,
    "public_signals": ["1", "0x123"],
    "proof_hash": "abc",
}

_POOL = {
    "pool_id": "pool_a",
    "pair": "ETH/USDC",
    "token0": "0xaaa",
    "token1": "0xbbb",
    "apy_pct": 12.5,
    "tvl_usd": 500_000,
    "liquidity_usd": 500_000,
}


@pytest.mark.asyncio
async def test_compute_signals_returns_typed_reports():
    with patch(
        "app.services.signal_pass_service._run_circuit_with_timeout",
        new_callable=AsyncMock,
        return_value=_CIRCUIT_OK,
    ), patch(
        "app.services.signal_pass_service._get_spot_price",
        new_callable=AsyncMock,
        return_value=2500.0,
    ):
        from app.services.signal_pass_service import compute_signals

        result = await compute_signals([_POOL], amount_wei=10_000 * 10**18, token_decimals=18)

    assert "pool_a" in result
    report = result["pool_a"]
    from app.services.signal_report import SignalReport

    assert isinstance(report, SignalReport)
    assert isinstance(report.slippage_ok, bool)
    assert isinstance(report.yield_near_optimal, bool)
    assert report.gates_passed >= 1
    assert report.gates_total >= 1


@pytest.mark.asyncio
async def test_compute_signals_circuit_failure_produces_none():
    with patch(
        "app.services.signal_pass_service._run_circuit_with_timeout",
        new_callable=AsyncMock,
        return_value=None,
    ), patch(
        "app.services.signal_pass_service._get_spot_price",
        new_callable=AsyncMock,
        return_value=None,
    ):
        from app.services.signal_pass_service import compute_signals

        result = await compute_signals([_POOL], amount_wei=10_000 * 10**18, token_decimals=18)

    report = result["pool_a"]
    assert report.il_acceptable is None
    assert report.yield_near_optimal is None
    assert report.slippage_ok is None
    assert report.gates_passed == 0
    assert report.gates_total == 0


@pytest.mark.asyncio
async def test_compute_signals_skips_il_when_no_spot_price():
    with patch(
        "app.services.signal_pass_service._run_circuit_with_timeout",
        new_callable=AsyncMock,
        return_value=_CIRCUIT_OK,
    ), patch(
        "app.services.signal_pass_service._get_spot_price",
        new_callable=AsyncMock,
        return_value=None,
    ):
        from app.services.signal_pass_service import compute_signals

        result = await compute_signals([_POOL], amount_wei=10_000 * 10**18, token_decimals=18)

    report = result["pool_a"]
    assert report.il_acceptable is None
    assert report.yield_near_optimal is True
    assert report.slippage_ok is True


@pytest.mark.asyncio
async def test_compute_signals_empty_pools():
    from app.services.signal_pass_service import compute_signals

    result = await compute_signals([], amount_wei=10_000 * 10**18)
    assert result == {}


@pytest.mark.asyncio
async def test_compute_signals_handles_gather_exception():
    with patch(
        "app.services.signal_pass_service._run_circuit_with_timeout",
        new_callable=AsyncMock,
        side_effect=RuntimeError("boom"),
    ), patch(
        "app.services.signal_pass_service._get_spot_price",
        new_callable=AsyncMock,
        return_value=2500.0,
    ):
        from app.services.signal_pass_service import compute_signals

        result = await compute_signals([_POOL], amount_wei=10_000 * 10**18, token_decimals=18)

    report = result["pool_a"]
    assert report.il_acceptable is None
    assert report.slippage_ok is None
    assert report.gates_passed == 0
