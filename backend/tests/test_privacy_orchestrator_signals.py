import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_orchestrate_deploy_calls_signal_pass_then_ai_allocation():
    call_order = []

    async def track_signals(*args, **kwargs):
        call_order.append("signals")
        from app.services.signal_report import SignalReport
        return {"p1": SignalReport(pool_id="p1", gates_passed=2, gates_total=3, slippage_ok=True)}

    async def track_allocation(*args, **kwargs):
        call_order.append("allocation")
        return MagicMock(
            allocations=[{"pool_id": "p1", "allocation_pct": 80, "expected_apy": 10}],
            reserve_pct=20, blended_apy_pct=8.0, reasoning="signal-informed",
            confidence=0.8, source="deterministic", attestation_hash="0xabc"
        )

    with patch("app.services.privacy_ekubo_orchestrator.compute_signals", side_effect=track_signals), \
         patch("app.services.privacy_ekubo_orchestrator.compute_allocation", side_effect=track_allocation), \
         patch("app.services.privacy_ekubo_orchestrator.fetch_pool_metrics", new_callable=AsyncMock) as mock_pm, \
         patch("app.services.privacy_ekubo_orchestrator.score_risk") as mock_risk, \
         patch("app.services.privacy_ekubo_orchestrator.execution_guard") as mock_guard, \
         patch("app.services.privacy_ekubo_orchestrator.execute_strategy_impl", new_callable=AsyncMock) as mock_exec:

        mock_guard.check.return_value = MagicMock(allowed=True)
        mock_pm.return_value = [MagicMock(pool_id="p1", pair="ETH/USDC", apy_pct=10,
                                          tvl_usd=500_000, risk_tier="low", token0="0xa", token1="0xb", liquidity_usd=500_000)]
        mock_risk.return_value = MagicMock(risk_level=5, bounds={}, label="moderate", max_single_pool_pct=40)
        mock_exec.return_value = {"deployment_id": "dep_1", "positions": []}

        from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
        await orchestrate_deploy("0xuser", 1000.0, "balanced")

    assert call_order == ["signals", "allocation"], f"Expected signals -> allocation, got {call_order}"
