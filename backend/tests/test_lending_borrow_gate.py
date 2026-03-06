"""Lending borrow gate API tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.lending as lending_routes

client = TestClient(app)


def test_borrow_requires_address():
    response = client.post(
        "/api/v1/zkdefi/lending/borrow",
        json={
            "amount_wei": 10**18,
            "attestation_hash": "0xatt",
        },
    )
    assert response.status_code == 400
    assert "address is required for borrow" in response.json()["detail"]


def test_borrow_blocked_by_risk_gate(monkeypatch):
    async def fake_gate(_address: str, _request):
        return {
            "mode": "block",
            "reason_codes": ["passport_letter_below_c", "no_credit_line"],
            "reason_hints": ["Increase reputation letter to C or higher for unsecured credit."],
            "limits": {"total_line_eth": 0},
            "disclaimer": "Eligibility signal only; not legal, tax, or financial advice.",
        }

    monkeypatch.setattr(lending_routes, "_get_lending_gate", fake_gate)

    response = client.post(
        "/api/v1/zkdefi/lending/borrow",
        json={
            "address": "0xabc",
            "amount_wei": 10**18,
            "attestation_hash": "0xatt",
        },
    )
    assert response.status_code == 403
    detail = response.json()["detail"]
    assert detail["code"] == "borrow_blocked_by_risk_gate"
    assert "passport_letter_below_c" in detail["reason_codes"]
    assert detail["limits"]["total_line_eth"] == 0


def test_borrow_advisory_mode_allows_call_build(monkeypatch):
    async def fake_gate(_address: str, _request):
        return {
            "mode": "advisory",
            "reason_codes": ["no_credit_line"],
            "reason_hints": ["Add collateral or improve reputation to unlock borrowing."],
            "limits": {"total_line_eth": 0},
            "disclaimer": "Eligibility signal only; not legal, tax, or financial advice.",
        }

    def fake_build(amount_wei: int, attestation_hash: str):
        return {
            "calls": [{
                "contractAddress": "0xpool",
                "entrypoint": "borrow",
                "calldata": [str(amount_wei), attestation_hash],
            }],
            "message": "ok",
        }

    monkeypatch.setattr(lending_routes, "_get_lending_gate", fake_gate)
    monkeypatch.setattr(lending_routes, "build_borrow_calldata", fake_build)

    response = client.post(
        "/api/v1/zkdefi/lending/borrow",
        json={
            "address": "0xabc",
            "amount_wei": 123,
            "attestation_hash": "0xatt",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["decision_context"]["mode"] == "advisory"
    assert payload["calls"][0]["entrypoint"] == "borrow"


def test_borrow_allow_mode_includes_decision_context(monkeypatch):
    async def fake_gate(_address: str, _request):
        return {
            "mode": "allow",
            "reason_codes": [],
            "reason_hints": [],
            "limits": {"total_line_eth": 1.5},
            "disclaimer": "Eligibility signal only; not legal, tax, or financial advice.",
        }

    monkeypatch.setattr(lending_routes, "_get_lending_gate", fake_gate)

    response = client.post(
        "/api/v1/zkdefi/lending/borrow",
        json={
            "address": "0xabc",
            "amount_wei": 1,
            "attestation_hash": "0xatt",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["decision_context"]["mode"] == "allow"
    assert payload["decision_context"]["limits"]["total_line_eth"] == 1.5

