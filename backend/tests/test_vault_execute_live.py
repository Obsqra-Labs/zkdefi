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
    for pos in data["positions"]:
        assert pos["strategy"] in ("ekubo_eth_usdc", "ekubo_strk_usdc")
        assert "amount" in pos and "status" in pos
        has_calldata_or_hash_or_error = (
            pos.get("tx_hash") is not None
            or pos.get("tx_calldata") is not None
            or pos.get("tx_calldata_error") is not None
        )
        assert has_calldata_or_hash_or_error, f"Position should have tx_hash, tx_calldata, or tx_calldata_error: {pos}"
