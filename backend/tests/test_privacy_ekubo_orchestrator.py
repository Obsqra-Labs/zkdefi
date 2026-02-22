"""Tests for privacy → Ekubo orchestrator."""
import pytest


@pytest.mark.asyncio
async def test_orchestrate_deploy_returns_deployment_and_receipt():
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
