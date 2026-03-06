"""Execution-policy API tests: advisory check + compliance profiles."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.rebalancer as rebalancer_routes
from app.services.agent_rebalancer import get_rebalancer
from app.services.receipt_service import get_receipt_service

client = TestClient(app)


def test_advisory_check_is_non_mutating(monkeypatch):
    async def fake_policy_check(*args, **kwargs):
        return {
            "allowed": False,
            "risk_result": {"is_compliant": False},
            "anomaly_result": {"is_safe": True},
            "snapshot_hash": "0xsnapshot",
            "commitment_hash": "0xcommit",
            "reason": "Risk score too high",
        }

    monkeypatch.setattr(rebalancer_routes, "policy_check", fake_policy_check)

    user = "0xabc123"
    rebalancer = get_rebalancer()
    before = rebalancer.get_user_proposals(user)

    response = client.post(
        "/api/v1/zkdefi/rebalancer/advisory-check",
        json={
            "user_address": user,
            "action_type": "swap",
            "pool_id": "ekubo_swap_abc_def",
            "portfolio_features": [1, 2, 3, 4, 5, 6, 7, 8],
            "context": {"amount": "1000"},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["advisory_only"] is True
    assert payload["can_proceed"] is False
    assert payload["risk_passed"] is False
    assert payload["anomaly_passed"] is True

    after = rebalancer.get_user_proposals(user)
    assert before == after


def test_compliance_profiles_return_receipt_derived_rows():
    user = "0xdef456"
    receipt_service = get_receipt_service()
    receipt_service.append_proof_receipt(
        user_address=user,
        proof_type="disclosure_risk_compliance",
        threshold_or_model="20",
        result="compliant",
        fact_hash="0xproof",
    )

    response = client.get(f"/api/v1/zkdefi/compliance/profiles/{user}")
    assert response.status_code == 200
    rows = response.json()
    assert isinstance(rows, list)
    assert any(row.get("profile_type") == "risk_compliance" for row in rows)
    assert any(row.get("verified") is True for row in rows)
