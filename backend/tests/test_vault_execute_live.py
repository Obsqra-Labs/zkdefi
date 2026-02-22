"""Tests for vault execute live."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_execute_with_allocations_returns_positions():
    response = client.post(
        "/api/v1/vault-live/execute",
        json={
            "user_address": "0xabc",
            "risk_profile": "balanced",
            "deposit_amount": 100.0,
            "allocations": [
                {"strategy": "ekubo_eth_usdc", "percentage": 60, "amount": 60.0},
                {"strategy": "ekubo_strk_usdc", "percentage": 40, "amount": 40.0},
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["user_address"] == "0xabc"
    assert len(data["positions"]) == 2
