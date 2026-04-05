from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.api.routes.portfolio_auth as portfolio_auth_routes
import app.middleware.portfolio_session as portfolio_session_mod
import app.services.json_store as json_store_mod
import app.services.portfolio_auth_session_service as portfolio_auth_session_mod
import app.services.portfolio_auth_telemetry_service as portfolio_auth_telemetry_mod


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(portfolio_auth_routes.router, prefix="/api/v1")
    return TestClient(app)


class _FakeVerifier:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def verify_message_hash(self, *, starknet_address: str, message_hash: object, signature: object) -> None:
        self.calls.append(
            {
                "starknet_address": starknet_address,
                "message_hash": message_hash,
                "signature": signature,
            }
        )


class _FakeTypedData:
    @classmethod
    def from_dict(cls, payload):
        return cls(payload)

    def __init__(self, payload):
        self.payload = payload

    def message_hash(self, account_address: int) -> int:
        return account_address + 123


@pytest.fixture()
def _isolated_service(tmp_path, monkeypatch) -> _FakeVerifier:
    json_store_mod.DATA_DIR = tmp_path
    tmp_path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setitem(
        sys.modules,
        "starknet_py.utils.typed_data",
        types.SimpleNamespace(TypedData=_FakeTypedData),
    )
    verifier = _FakeVerifier()
    service = portfolio_auth_session_mod.PortfolioAuthSessionService()
    service._verifier = verifier
    monkeypatch.setattr(portfolio_auth_routes, "get_portfolio_auth_session_service", lambda: service)
    monkeypatch.setattr(portfolio_session_mod, "get_portfolio_auth_session_service", lambda: service)
    return verifier


def test_verify_session_requires_bearer_token():
    client = _client()
    response = client.get("/api/v1/portfolio/auth/session/verify")
    assert response.status_code == 401


def test_verify_session_returns_normalized_payload():
    client = _client()
    client.app.dependency_overrides[portfolio_session_mod.require_portfolio_session] = lambda: {
        "starknet_address": "0xabc",
        "chain_id": "0x534e5f4d41494e",
        "issued_at": 1,
        "expires_at": 2,
    }
    response = client.get("/api/v1/portfolio/auth/session/verify")
    assert response.status_code == 200
    payload = response.json()
    assert payload["active"] is True
    assert payload["starknet_address"] == "0xabc"
    assert payload["chain_id"] == "0x534e5f4d41494e"
    assert payload["issued_at"] == 1
    assert payload["expires_at"] == 2
    client.app.dependency_overrides.clear()


def test_portfolio_auth_start_complete_verify_route_flow(_isolated_service: _FakeVerifier):
    client = _client()
    start_response = client.post(
        "/api/v1/portfolio/auth/session/start",
        json={
            "starknet_address": "0xabc",
            "chain_id": portfolio_auth_session_mod.PORTFOLIO_MAINNET_CHAIN_ID,
        },
    )
    assert start_response.status_code == 200
    start_payload = start_response.json()
    assert start_payload["nonce_id"]
    assert start_payload["typed_data"]["primaryType"] == "PortfolioSession"

    complete_response = client.post(
        "/api/v1/portfolio/auth/session/complete",
        json={
            "starknet_address": "0xabc",
            "nonce_id": start_payload["nonce_id"],
            "signature": ["0x1", "0x2"],
        },
    )
    assert complete_response.status_code == 200
    complete_payload = complete_response.json()
    assert complete_payload["token"]
    assert complete_payload["scope"] == "portfolio_lane"
    assert _isolated_service.calls[-1]["signature"] == ["0x1", "0x2"]

    verify_response = client.get(
        "/api/v1/portfolio/auth/session/verify",
        headers={"Authorization": f"Bearer {complete_payload['token']}"},
    )
    assert verify_response.status_code == 200
    verify_payload = verify_response.json()
    assert verify_payload["active"] is True
    assert verify_payload["starknet_address"] == "0xabc"
    assert verify_payload["chain_id"] == portfolio_auth_session_mod.PORTFOLIO_MAINNET_CHAIN_ID


def test_portfolio_auth_start_maps_service_errors_to_400(monkeypatch):
    class _BadService:
        def start(self, starknet_address: str, chain_id: str):
            raise portfolio_auth_session_mod.PortfolioAuthSessionError("bad start payload")

    monkeypatch.setattr(portfolio_auth_routes, "get_portfolio_auth_session_service", lambda: _BadService())
    client = _client()
    response = client.post(
        "/api/v1/portfolio/auth/session/start",
        json={
            "starknet_address": "0xabc",
            "chain_id": portfolio_auth_session_mod.PORTFOLIO_MAINNET_CHAIN_ID,
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "bad start payload"


def test_portfolio_auth_complete_maps_unauthorized_to_401(monkeypatch):
    class _BadService:
        def complete(self, starknet_address: str, nonce_id: str, signature):
            raise portfolio_auth_session_mod.PortfolioAuthSessionUnauthorizedError("invalid signature")

    monkeypatch.setattr(portfolio_auth_routes, "get_portfolio_auth_session_service", lambda: _BadService())
    client = _client()
    response = client.post(
        "/api/v1/portfolio/auth/session/complete",
        json={
            "starknet_address": "0xabc",
            "nonce_id": "nonce",
            "signature": ["0x1", "0x2"],
        },
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid signature"


def test_portfolio_auth_telemetry_summary_exposes_latency_breakdown(tmp_path, monkeypatch):
    json_store_mod.DATA_DIR = tmp_path
    tmp_path.mkdir(parents=True, exist_ok=True)
    telemetry_service = portfolio_auth_telemetry_mod.PortfolioAuthTelemetryService()
    monkeypatch.setattr(
        portfolio_auth_routes,
        "get_portfolio_auth_telemetry_service",
        lambda: telemetry_service,
    )
    client = _client()

    for payload in (
        {
            "outcome": "success",
            "starknet_address": "0xabc",
            "chain_id": portfolio_auth_session_mod.PORTFOLIO_MAINNET_CHAIN_ID,
            "total_ms": 500,
            "start_ms": 60,
            "sign_ms": 300,
            "complete_ms": 90,
        },
        {
            "outcome": "failure",
            "failure_stage": "wallet_signature",
            "starknet_address": "0xabc",
            "chain_id": portfolio_auth_session_mod.PORTFOLIO_MAINNET_CHAIN_ID,
            "total_ms": 950,
            "start_ms": 70,
            "sign_ms": 650,
            "api_status": 401,
            "error": "wallet timeout",
        },
        {
            "outcome": "success",
            "starknet_address": "0xabc",
            "chain_id": portfolio_auth_session_mod.PORTFOLIO_MAINNET_CHAIN_ID,
            "total_ms": 800,
            "start_ms": 80,
            "sign_ms": 500,
            "complete_ms": 130,
        },
    ):
        response = client.post("/api/v1/portfolio/auth/telemetry", json=payload)
        assert response.status_code == 200

    summary_response = client.get("/api/v1/portfolio/auth/telemetry/summary?window_sec=86400")
    assert summary_response.status_code == 200
    summary = summary_response.json()
    assert summary["totals"]["events"] == 3
    assert summary["totals"]["successes"] == 2
    assert summary["totals"]["failures"] == 1
    assert summary["latency_ms"]["total"]["samples"] == 3
    assert summary["latency_ms"]["sign"]["p95"] == 650.0
    assert summary["failures"]["by_stage"]["wallet_signature"] == 1
    assert summary["failures"]["by_status"]["401"] == 1


def test_portfolio_auth_telemetry_summary_reports_spike_alerts(tmp_path, monkeypatch):
    json_store_mod.DATA_DIR = tmp_path
    tmp_path.mkdir(parents=True, exist_ok=True)
    telemetry_service = portfolio_auth_telemetry_mod.PortfolioAuthTelemetryService()
    monkeypatch.setattr(
        portfolio_auth_routes,
        "get_portfolio_auth_telemetry_service",
        lambda: telemetry_service,
    )
    client = _client()

    for _ in range(4):
        response = client.post(
            "/api/v1/portfolio/auth/telemetry",
            json={
                "outcome": "failure",
                "failure_stage": "wallet_signature",
                "total_ms": 1200,
                "api_status": 401,
            },
        )
        assert response.status_code == 200

    summary_response = client.get("/api/v1/portfolio/auth/telemetry/summary?window_sec=3600")
    assert summary_response.status_code == 200
    summary = summary_response.json()
    alert_ids = {alert["id"] for alert in summary["alerts"]}
    assert "wallet_signature_spike" in alert_ids


def test_portfolio_auth_percentile_uses_tail_for_small_samples():
    assert portfolio_auth_telemetry_mod._percentile([100.0, 900.0], 0.95) == 900.0
