"""Tests for strategy recommendation service."""
import pytest


@pytest.mark.asyncio
async def test_get_recommendation_returns_ekubo_pools():
    from app.services.strategy_recommendation_service import get_recommendation
    result = await get_recommendation(
        user_address="0xabc",
        amount=1000.0,
        risk_profile="balanced",
    )
    assert result["user_address"] == "0xabc"
    assert result["risk_profile"] == "balanced"
    assert result["total_amount"] == 1000.0
    assert "recommended_pools" in result
    assert len(result["recommended_pools"]) >= 1
    for p in result["recommended_pools"]:
        assert p.get("protocol", "").lower() == "ekubo"
