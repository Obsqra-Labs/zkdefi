"""
Tests for onboarding route — /api/v1/zkdefi/onboarding/*
Covers generate_authorization (with mocked Stone prover), submit_agent, status.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.onboarding as onboarding_mod

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeHttpxResponse:
    """Minimal httpx.Response stub for monkeypatch."""
    def __init__(self, json_data, status_code=200):
        self._json = json_data
        self.status_code = status_code
        self.text = json.dumps(json_data)

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError(
                message=f"HTTP {self.status_code}",
                request=httpx.Request("POST", "http://fake"),
                response=self,
            )


def _clear_state():
    """Reset in-memory state between tests."""
    onboarding_mod._user_onboarding_state.clear()


# ---------------------------------------------------------------------------
# generate_authorization
# ---------------------------------------------------------------------------

class TestGenerateAuthorization:
    def setup_method(self):
        _clear_state()

    def test_returns_fact_hash_when_prover_succeeds(self, monkeypatch):
        """When Stone prover responds, we get its fact_hash."""
        import httpx as real_httpx

        class FakeAsyncClient:
            def __init__(self, **kw):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                pass
            async def post(self, url, json=None, headers=None):
                return FakeHttpxResponse({
                    "fact_hash": "0xFACT_FROM_PROVER",
                    "tx_hash": "0xTX_FROM_PROVER",
                })

        monkeypatch.setattr(real_httpx, "AsyncClient", FakeAsyncClient)

        resp = client.post(
            "/api/v1/zkdefi/onboarding/generate_authorization",
            headers={"X-Wallet-Address": "0xAlice"},
            json={
                "user_address": "0xAlice",
                "constraints": {
                    "max_position": "100000",
                    "risk_tolerance": 50,
                    "session_duration": 24,
                },
                "claims": ["compliance", "tenure"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["fact_hash"] == "0xFACT_FROM_PROVER"
        assert body["proof_registered"] is True
        assert body["identity_commitment"].startswith("0x")

    def test_fallback_on_prover_unavailable(self, monkeypatch):
        """When prover is unreachable, fallback to deterministic hash."""
        import httpx as real_httpx

        class FakeAsyncClient:
            def __init__(self, **kw):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                pass
            async def post(self, url, json=None, headers=None):
                raise ConnectionError("prover down")

        monkeypatch.setattr(real_httpx, "AsyncClient", FakeAsyncClient)

        resp = client.post(
            "/api/v1/zkdefi/onboarding/generate_authorization",
            headers={"X-Wallet-Address": "0xAlice"},
            json={
                "user_address": "0xAlice",
                "constraints": {"max_position": "100", "risk_tolerance": 30, "session_duration": 1},
                "claims": [],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["proof_registered"] is False
        assert body["fact_hash"].startswith("0x")
        assert "unavailable" in body["message"].lower() or "deterministic" in body["message"].lower()

    def test_validation_rejects_missing_constraints(self):
        resp = client.post(
            "/api/v1/zkdefi/onboarding/generate_authorization",
            headers={"X-Wallet-Address": "0x1"},
            json={"user_address": "0x1", "claims": []},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# submit_agent
# ---------------------------------------------------------------------------

class TestSubmitAgent:
    def setup_method(self):
        _clear_state()

    def test_submit_stores_state_and_returns_calldata(self):
        # Use valid hex values — _prepare_*_calldata does int(value, 16)
        resp = client.post(
            "/api/v1/zkdefi/onboarding/submit_agent",
            headers={"X-Wallet-Address": "0x0123456789abcdef"},
            json={
                "user_address": "0x0123456789abcdef",
                "fact_hash": "0xaaaa",
                "identity_commitment": "0xbbbb",
                "risk_signature": {"r": "0xcccc", "s": "0xdddd"},
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["agent_initialized"] is True
        # State persisted in-memory
        assert "0x0123456789abcdef" in onboarding_mod._user_onboarding_state

    def test_bad_signature_returns_400(self):
        resp = client.post(
            "/api/v1/zkdefi/onboarding/submit_agent",
            headers={"X-Wallet-Address": "0xAlice"},
            json={
                "user_address": "0xAlice",
                "fact_hash": "0xFACT",
                "identity_commitment": "0xIDENTITY",
                "risk_signature": {},  # missing r/s
            },
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# status/{user_address}
# ---------------------------------------------------------------------------

class TestOnboardingStatus:
    def setup_method(self):
        _clear_state()

    def test_status_returns_not_found_when_no_state(self, monkeypatch):
        # Stub the on-chain query to avoid real network call
        async def _stub_query(addr):
            return {"has_constraints": False}
        monkeypatch.setattr(onboarding_mod, "_query_onchain_constraints", _stub_query)

        resp = client.get("/api/v1/zkdefi/onboarding/status/0xAlice")
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_agent"] is False
        assert body["fact_hash"] is None

    def test_status_returns_existing_state(self, monkeypatch):
        async def _stub_query(addr):
            return {"has_constraints": True, "max_position": 1000}
        monkeypatch.setattr(onboarding_mod, "_query_onchain_constraints", _stub_query)

        # Pre-populate state
        onboarding_mod._user_onboarding_state["0xalice"] = {
            "fact_hash": "0xFACT",
            "identity_commitment": "0xIC",
            "timestamp": 123456,
            "agent_initialized": True,
        }
        resp = client.get("/api/v1/zkdefi/onboarding/status/0xAlice")
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_agent"] is True
        assert body["fact_hash"] == "0xFACT"
