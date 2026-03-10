import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_orchestrate_deploy_calls_signal_pass_then_ai_allocation():
    """Verify orchestrate_deploy fetches pools, builds allocations, then executes."""
    call_order = []

    fake_pools = [
        {
            "pool_id": "p1",
            "pair": "ETH/USDC",
            "token0": "0xa",
            "token1": "0xb",
            "tvl_usd": 500_000,
            "estimated_fee_apy_pct": 10,
            "fee": "0.003",
            "tick_spacing": 60,
        }
    ]

    async def track_get_top_pools(*args, **kwargs):
        call_order.append("pools")
        return fake_pools

    async def track_execute(*args, **kwargs):
        call_order.append("execute")
        return {"deployment_id": "dep_1", "positions": []}

    fake_agg = MagicMock()
    fake_agg.get_top_pools = track_get_top_pools

    with patch("app.services.privacy_ekubo_orchestrator._get_pool_aggregator", return_value=fake_agg), \
         patch("app.services.privacy_ekubo_orchestrator.execute_strategy_impl", side_effect=track_execute):

        from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
        await orchestrate_deploy("0xuser", 1000.0, "balanced")

    assert call_order == ["pools", "execute"], f"Expected pools -> execute, got {call_order}"
