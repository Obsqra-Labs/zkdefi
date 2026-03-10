"""Tests for orchestration API."""
import os
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

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


def test_orchestrate_deploy_endpoint():
    fake_agg = MagicMock()
    fake_agg.get_top_pools = AsyncMock(return_value=_FAKE_POOLS)

    with patch("app.services.privacy_ekubo_orchestrator._get_pool_aggregator", return_value=fake_agg), \
         patch("app.services.privacy_ekubo_orchestrator.execute_strategy_impl", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = {
            "deployment_id": "dep_1",
            "positions": [{"strategy": "ekubo_eth_usdc", "amount": 100.0, "status": "submitted"}],
        }
        response = client.post(
            "/api/v1/zkdefi/orchestration/deploy",
            json={
                "user_address": "0xuser",
                "deployable_amount": 100.0,
                "risk_profile": "balanced",
            },
        )
    assert response.status_code == 200
    data = response.json()
    assert "deployment_id" in data
    assert data["target"] == "ekubo"
    assert "receipt_id" in data


def test_confirm_receipt_endpoint():
    response = client.post(
        "/api/v1/zkdefi/orchestration/receipt/confirm",
        json={"receipt_id": "0x" + "a" * 64, "tx_hash": "0x" + "b" * 64},
    )
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "confirmed"
    assert data.get("tx_hash") == "0x" + "b" * 64
