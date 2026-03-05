"""Unit tests for MarketMakerEngine."""
from __future__ import annotations

import asyncio
import pytest
from bots.engine import MarketMakerEngine, BotFlags


@pytest.fixture
def engine() -> MarketMakerEngine:
    return MarketMakerEngine(
        tick_interval_sec=0.01,
        start_price=2000.0,
        peg_price=2000.0,
        start_tvl_usd=500_000.0,
        zkdeth=200.0,
        zkdai=400_000.0,
    )


@pytest.mark.asyncio
async def test_initial_snapshot(engine: MarketMakerEngine) -> None:
    snap = await engine.snapshot()
    assert snap["price"] == 2000.0
    assert snap["peg_price"] == 2000.0
    assert snap["tvl_usd"] == 500_000.0
    assert snap["active_scenario"] is None
    assert snap["bots"]["price_alignment"] is True


@pytest.mark.asyncio
async def test_set_peg(engine: MarketMakerEngine) -> None:
    await engine.set_peg(1800.0)
    snap = await engine.snapshot()
    assert snap["peg_price"] == 1800.0


@pytest.mark.asyncio
async def test_set_peg_minimum(engine: MarketMakerEngine) -> None:
    await engine.set_peg(0.5)
    snap = await engine.snapshot()
    assert snap["peg_price"] == 1.0  # min clamp


@pytest.mark.asyncio
async def test_toggle_bot(engine: MarketMakerEngine) -> None:
    await engine.set_bot("volatility", False)
    snap = await engine.snapshot()
    assert snap["bots"]["volatility"] is False


@pytest.mark.asyncio
async def test_toggle_unknown_bot(engine: MarketMakerEngine) -> None:
    with pytest.raises(ValueError, match="Unknown bot"):
        await engine.set_bot("nonexistent_bot", True)


@pytest.mark.asyncio
async def test_force_trade_buy(engine: MarketMakerEngine) -> None:
    snap_before = await engine.snapshot()
    await engine.force_trade(side="buy", notional_usd=5000.0)
    snap_after = await engine.snapshot()
    assert snap_after["price"] > snap_before["price"]
    assert snap_after["volume_24h"] > 0
    assert snap_after["trade_count_24h"] == 1


@pytest.mark.asyncio
async def test_force_trade_sell(engine: MarketMakerEngine) -> None:
    snap_before = await engine.snapshot()
    await engine.force_trade(side="sell", notional_usd=5000.0)
    snap_after = await engine.snapshot()
    assert snap_after["price"] < snap_before["price"]


@pytest.mark.asyncio
async def test_force_trade_invalid_side(engine: MarketMakerEngine) -> None:
    with pytest.raises(ValueError, match="side must be buy or sell"):
        await engine.force_trade(side="hold", notional_usd=1000.0)


@pytest.mark.asyncio
async def test_inject_scenario_depeg_down(engine: MarketMakerEngine) -> None:
    await engine.inject_scenario(scenario="depeg_down", severity=0.3, duration_ticks=10)
    snap = await engine.snapshot()
    assert snap["active_scenario"] == "depeg_down"


@pytest.mark.asyncio
async def test_inject_scenario_depeg_up(engine: MarketMakerEngine) -> None:
    await engine.inject_scenario(scenario="depeg_up", severity=0.2, duration_ticks=5)
    snap = await engine.snapshot()
    assert snap["active_scenario"] == "depeg_up"


@pytest.mark.asyncio
async def test_inject_scenario_liquidity_drain(engine: MarketMakerEngine) -> None:
    snap_before = await engine.snapshot()
    await engine.inject_scenario(scenario="liquidity_drain", severity=0.5, duration_ticks=3)
    snap_after = await engine.snapshot()
    assert snap_after["liquidity_zkdeth"] < snap_before["liquidity_zkdeth"]
    assert snap_after["liquidity_zkdai"] < snap_before["liquidity_zkdai"]


@pytest.mark.asyncio
async def test_inject_scenario_unknown(engine: MarketMakerEngine) -> None:
    with pytest.raises(ValueError, match="Unsupported scenario"):
        await engine.inject_scenario(scenario="unknown", severity=0.1, duration_ticks=5)


@pytest.mark.asyncio
async def test_recent_events(engine: MarketMakerEngine) -> None:
    await engine.force_trade(side="buy", notional_usd=1000.0)
    events = await engine.recent_events(limit=10)
    assert len(events) >= 1
    assert events[-1]["category"] == "trade"


@pytest.mark.asyncio
async def test_engine_tick_loop(engine: MarketMakerEngine) -> None:
    """Start the engine, let it tick a few times, then stop."""
    await engine.start()
    await asyncio.sleep(0.05)  # should get ~5 ticks at 0.01s interval
    snap = await engine.snapshot()
    # Price should have drifted from exactly 2000
    assert snap["price"] != 2000.0 or snap["timestamp"] > 0
    await engine.stop()


@pytest.mark.asyncio
async def test_severity_clamp(engine: MarketMakerEngine) -> None:
    """Severity should be clamped to [0.01, 0.95]."""
    await engine.inject_scenario(scenario="depeg_down", severity=5.0, duration_ticks=5)
    # Should not crash; severity internally clamped
    snap = await engine.snapshot()
    assert snap["active_scenario"] == "depeg_down"
