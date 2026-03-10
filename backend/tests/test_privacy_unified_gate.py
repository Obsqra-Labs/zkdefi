from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.privacy_unified as privacy_unified_routes

client = TestClient(app)


class _FakeCompiler:
    def compile(self, _payload):
        return {
            "can_execute": True,
            "advisory_only": False,
            "execution_path": "shielded_pool",
            "required_proofs": ["shielded_balance_proof", "zkml_risk_proof"],
            "requires_relayer": False,
            "warnings": [],
            "blocking_reasons": [],
            "legacy_preset_label": "A",
            "effective_policy_hash": "0xpolicy",
        }


def _mock_compiler(monkeypatch):
    monkeypatch.setattr(
        privacy_unified_routes,
        "get_policy_compiler_service",
        lambda: _FakeCompiler(),
    )


WALLET_HEADER = {"X-Wallet-Address": "0xabc"}


def test_privacy_preview_reports_missing_proofs(monkeypatch):
    _mock_compiler(monkeypatch)

    response = client.post(
        "/api/v1/zkdefi/privacy/deposit",
        json={
            "user_address": "0xabc",
            "amount": "1000000000000000000",
            "token": "ETH",
            "execute_now": False,
        },
        headers=WALLET_HEADER,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["can_execute"] is True
    assert payload["proof_gate_passed"] is False
    assert payload["execution_ready"] is False
    assert payload["missing_required_proofs"] == ["shielded_balance_proof", "zkml_risk_proof"]


def test_privacy_execute_now_requires_required_proofs(monkeypatch):
    _mock_compiler(monkeypatch)

    response = client.post(
        "/api/v1/zkdefi/privacy/deposit",
        json={
            "user_address": "0xabc",
            "amount": "1000000000000000000",
            "token": "ETH",
            "execute_now": True,
            "execution_mode": "wallet",
            "wallet_connected": True,
        },
        headers=WALLET_HEADER,
    )
    assert response.status_code == 403
    detail = response.json()["detail"]
    assert detail["message"] == "proof gate failed"
    assert detail["missing_required_proofs"] == ["shielded_balance_proof", "zkml_risk_proof"]


def test_privacy_execute_now_passes_with_all_proofs(monkeypatch):
    _mock_compiler(monkeypatch)

    response = client.post(
        "/api/v1/zkdefi/privacy/deposit",
        json={
            "user_address": "0xabc",
            "amount": "1000000000000000000",
            "token": "ETH",
            "execute_now": True,
            "execution_mode": "orchestrated",
            "provided_proofs": {
                "shielded_balance_proof": "0xproof1",
                "zkml_risk_proof": "0xproof2",
            },
        },
        headers=WALLET_HEADER,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["proof_gate_passed"] is True
    assert payload["execution_ready"] is True
    assert payload["missing_required_proofs"] == []
