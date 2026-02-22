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
