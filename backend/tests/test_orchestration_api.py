"""Tests for orchestration API."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_orchestrate_deploy_endpoint():
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
    positions = data.get("positions", [])
    assert len(positions) >= 1
    for pos in positions:
        has_calldata_or_hash_or_error = (
            pos.get("tx_hash") is not None
            or pos.get("tx_calldata") is not None
            or pos.get("tx_calldata_error") is not None
        )
        assert has_calldata_or_hash_or_error, f"Position should have tx_hash, tx_calldata, or tx_calldata_error: {pos}"


def test_confirm_receipt_endpoint():
    response = client.post(
        "/api/v1/zkdefi/orchestration/receipt/confirm",
        json={"receipt_id": "0x" + "a" * 64, "tx_hash": "0x" + "b" * 64},
    )
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "confirmed"
    assert data.get("tx_hash") == "0x" + "b" * 64
