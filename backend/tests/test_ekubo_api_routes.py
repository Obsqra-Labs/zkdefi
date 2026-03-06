"""Tests for canonical Ekubo API routes."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.ekubo as ekubo_routes

client = TestClient(app)


def test_ekubo_capabilities_available():
    response = client.get("/api/v1/zkdefi/ekubo/capabilities")
    assert response.status_code == 200
    data = response.json()
    assert "router_address" in data
    assert "positions_address" in data
    assert "lp_enabled" in data


def test_swap_quote_validation_422():
    response = client.post("/api/v1/zkdefi/ekubo/swap/quote", json={})
    assert response.status_code == 422


def test_lp_preview_validation_422():
    response = client.post("/api/v1/zkdefi/ekubo/lp/preview", json={})
    assert response.status_code == 422


def test_swap_build_auto_mode_wallet(monkeypatch):
    monkeypatch.setattr(ekubo_routes, "_require_chain_id", lambda: "0x534e5f5345504f4c4941")

    async def fake_build_swap_calldata(*args, **kwargs):
        return {
            "contract_address": "0xrouter",
            "entrypoint": "swap",
            "calldata": ["1", "2", "3"],
            "error": None,
        }

    async def fake_balance(*args, **kwargs):
        return 10_000

    monkeypatch.setattr(ekubo_routes, "build_swap_calldata", fake_build_swap_calldata)
    monkeypatch.setattr(ekubo_routes, "_read_erc20_balance", fake_balance)

    response = client.post(
        "/api/v1/zkdefi/ekubo/swap/build",
        json={
            "token_in": "0x1",
            "token_out": "0x2",
            "amount_in": "100",
            "wallet_connected": True,
            "execution_mode": "auto",
            "taker_address": "0x123",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["execution_mode"] == "wallet"
    assert data["approvals"][0]["token"] == "0x1"
    assert data["calls"][0]["entrypoint"] == "swap"


def test_swap_build_auto_mode_orchestrated(monkeypatch):
    monkeypatch.setattr(ekubo_routes, "_require_chain_id", lambda: "0x534e5f5345504f4c4941")

    async def fake_build_swap_calldata(*args, **kwargs):
        return {
            "contract_address": "0xrouter",
            "entrypoint": "swap",
            "calldata": ["1", "2", "3"],
            "error": None,
        }

    class FakeReceiptService:
        async def create_receipt(self, **kwargs):
            return {"receipt_id": "0xreceipt"}

    monkeypatch.setattr(ekubo_routes, "build_swap_calldata", fake_build_swap_calldata)
    monkeypatch.setattr(ekubo_routes, "get_receipt_service", lambda: FakeReceiptService())

    response = client.post(
        "/api/v1/zkdefi/ekubo/swap/build",
        json={
            "token_in": "0x1",
            "token_out": "0x2",
            "amount_in": "100",
            "wallet_connected": False,
            "execution_mode": "auto",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["execution_mode"] == "orchestrated"
    assert data["receipt_id"] == "0xreceipt"


def test_swap_build_wallet_balance_precheck(monkeypatch):
    monkeypatch.setattr(ekubo_routes, "_require_chain_id", lambda: "0x534e5f5345504f4c4941")

    async def fake_balance(*args, **kwargs):
        return 10

    monkeypatch.setattr(ekubo_routes, "_read_erc20_balance", fake_balance)

    response = client.post(
        "/api/v1/zkdefi/ekubo/swap/build",
        json={
            "token_in": "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
            "token_out": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
            "amount_in": "1000000",
            "wallet_connected": True,
            "execution_mode": "auto",
            "taker_address": "0x123",
        },
    )
    assert response.status_code == 400
    assert "Insufficient USDC balance" in response.json().get("detail", "")


def test_swap_build_wallet_requires_taker_address(monkeypatch):
    monkeypatch.setattr(ekubo_routes, "_require_chain_id", lambda: "0x534e5f5345504f4c4941")

    response = client.post(
        "/api/v1/zkdefi/ekubo/swap/build",
        json={
            "token_in": "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
            "token_out": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
            "amount_in": "1000000",
            "wallet_connected": True,
            "execution_mode": "auto",
        },
    )
    assert response.status_code == 400
    assert "requires taker_address" in response.json().get("detail", "")
