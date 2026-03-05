"""Auth session API tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.auth_session as auth_session_routes
from app.services.linked_address_verification_service import LinkedAddressVerificationError

client = TestClient(app)


class _FakeSessionService:
    def __init__(self):
        self.last_complete = None

    def start(self, starknet_address: str, chain: str, evm_address: str):
        return {
            "nonce_id": "n1",
            "challenge": "challenge",
            "expires_at": 123456,
            "chain": chain,
            "address": evm_address,
        }

    def complete(
        self,
        starknet_address: str,
        chain: str,
        evm_address: str,
        nonce_id: str,
        signature: str,
        *,
        auth_provider: str | None = None,
        credentials: dict | None = None,
    ):
        self.last_complete = {
            "starknet_address": starknet_address,
            "chain": chain,
            "evm_address": evm_address,
            "nonce_id": nonce_id,
            "signature": signature,
            "auth_provider": auth_provider,
            "credentials": credentials,
        }
        return {
            "active": True,
            "status": "active",
            "session_id": "s1",
            "starknet_address": starknet_address,
            "chain": chain,
            "evm_address": evm_address,
            "expires_at": 123999,
            "auth_provider": auth_provider or "injected",
            "identity_binding": {
                "linked_chain_key": "eth",
                "linked_address": evm_address,
                "bound": True,
            },
            "history": [
                {
                    "at": "2026-03-03T00:00:00Z",
                    "action": "bind",
                    "status": "active",
                    "auth_provider": auth_provider or "injected",
                    "chain": chain,
                    "evm_address": evm_address,
                    "bound": True,
                }
            ],
        }

    def get(self, starknet_address: str):
        return {"active": True, "status": "active", "starknet_address": starknet_address}

    def revoke(self, starknet_address: str):
        return {"active": False, "status": "revoked", "starknet_address": starknet_address}


def _mock_service(monkeypatch):
    svc = _FakeSessionService()
    monkeypatch.setattr(auth_session_routes, "get_dual_wallet_session_service", lambda: svc)
    return svc


def test_auth_session_start(monkeypatch):
    _mock_service(monkeypatch)
    response = client.post(
        "/api/v1/zkdefi/auth/session/start",
        json={
            "starknet_address": "0xabc",
            "chain": "ethereum",
            "address": "0x123",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["purpose"] == "dual_wallet_session"
    assert payload["nonce_id"] == "n1"


def test_auth_session_complete(monkeypatch):
    svc = _mock_service(monkeypatch)
    response = client.post(
        "/api/v1/zkdefi/auth/session/complete",
        json={
            "starknet_address": "0xabc",
            "chain": "ethereum",
            "address": "0x123",
            "nonce_id": "n1",
            "signature": "0xsig",
            "auth_provider": "web3auth_siw",
            "credentials": {
                "mode": "web3auth_siw",
                "standard": "caip-74",
                "ethereum": {
                    "address": "0x123",
                    "signature": {"t": "eip191", "s": "0xevm"},
                },
                "starknet": {
                    "address": "0xabc",
                    "signature": ["0x1", "0x2"],
                },
            },
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["active"] is True
    assert payload["purpose"] == "dual_wallet_session"
    assert payload["identity_binding_enabled"] is True
    assert payload["identity_binding"]["bound"] is True
    assert payload["auth_provider"] == "web3auth_siw"
    assert payload["history"][0]["action"] == "bind"
    assert "not a legal identity verification" in payload["disclaimer"]
    assert svc.last_complete["auth_provider"] == "web3auth_siw"


def test_auth_session_get_and_revoke(monkeypatch):
    _mock_service(monkeypatch)
    get_res = client.get("/api/v1/zkdefi/auth/session/0xabc")
    assert get_res.status_code == 200
    assert get_res.json()["status"] == "active"

    del_res = client.delete("/api/v1/zkdefi/auth/session/0xabc")
    assert del_res.status_code == 200
    assert del_res.json()["revoked"] is True


def test_auth_session_error_maps_to_400(monkeypatch):
    class _BadService(_FakeSessionService):
        def start(self, starknet_address: str, chain: str, evm_address: str):
            raise LinkedAddressVerificationError("Unsupported chain for verification")

    monkeypatch.setattr(auth_session_routes, "get_dual_wallet_session_service", lambda: _BadService())
    response = client.post(
        "/api/v1/zkdefi/auth/session/start",
        json={
            "starknet_address": "0xabc",
            "chain": "badchain",
            "address": "0x123",
        },
    )
    assert response.status_code == 400
    assert "Unsupported chain" in response.json()["detail"]
