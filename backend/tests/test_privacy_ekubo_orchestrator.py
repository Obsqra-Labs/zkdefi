"""Tests for privacy → Ekubo orchestrator."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


_FAKE_POOLS = [
    {
        "pool_id": "ekubo_eth_usdc",
        "pair": "ETH/USDC",
        "token0": "0x1",
        "token1": "0x2",
        "tvl_usd": 500_000,
        "estimated_fee_apy_pct": 12.5,
        "fee": "0.003",
        "tick_spacing": 60,
    },
]


@pytest.mark.asyncio
async def test_orchestrate_deploy_returns_deployment_and_receipt():
    fake_agg = MagicMock()
    fake_agg.get_top_pools = AsyncMock(return_value=_FAKE_POOLS)

    with patch("app.services.privacy_ekubo_orchestrator._get_pool_aggregator", return_value=fake_agg), \
         patch("app.services.privacy_ekubo_orchestrator.execute_strategy_impl", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = {
            "deployment_id": "dep_1",
            "positions": [{"strategy": "ekubo_eth_usdc", "amount": 500.0, "status": "submitted"}],
        }
        from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
        result = await orchestrate_deploy(
            user_address="0xuser",
            deployable_amount=500.0,
            risk_profile="balanced",
        )
    assert "deployment_id" in result
    assert "positions" in result
    assert "receipt_id" in result
    assert result["target"] == "ekubo"
