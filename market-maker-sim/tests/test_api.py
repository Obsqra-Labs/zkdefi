"""Integration tests for the market-maker-sim FastAPI endpoints."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport


@pytest_asyncio.fixture
async def client():
    from api.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "market-maker-sim"


@pytest.mark.asyncio
async def test_public_state(client: AsyncClient) -> None:
    resp = await client.get("/public/state")
    assert resp.status_code == 200
    data = resp.json()
    assert "price" in data
    assert "peg_price" in data
    assert "tvl_usd" in data
    assert "bots" in data


@pytest.mark.asyncio
async def test_public_events(client: AsyncClient) -> None:
    resp = await client.get("/public/events?limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_public_contracts(client: AsyncClient) -> None:
    resp = await client.get("/public/contracts")
    assert resp.status_code == 200
    data = resp.json()
    # Either has zkdETH or has error key
    assert "zkdETH" in data or "error" in data


@pytest.mark.asyncio
async def test_public_scenarios(client: AsyncClient) -> None:
    resp = await client.get("/public/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert "scenarios" in data
    assert isinstance(data["scenarios"], list)


@pytest.mark.asyncio
async def test_admin_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/admin/state")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_state_with_key(client: AsyncClient) -> None:
    resp = await client.get("/admin/state", headers={"x-admin-key": "dev-admin-key"})
    assert resp.status_code == 200
    data = resp.json()
    assert "price" in data


@pytest.mark.asyncio
async def test_admin_set_peg(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/peg",
        json={"peg_price": 1900},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_admin_force_trade(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/trade",
        json={"side": "buy", "notional_usd": 2000},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_admin_toggle_bot(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/bots/volatility",
        json={"enabled": False},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_admin_trigger_scenario(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/scenarios/trigger",
        json={"scenario": "depeg_down", "severity": 0.2, "duration_ticks": 10},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_admin_trigger_preset(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/scenarios/preset",
        json={"name": "flash_crash"},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["preset"] == "flash_crash"


@pytest.mark.asyncio
async def test_admin_trigger_preset_not_found(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/scenarios/preset",
        json={"name": "nonexistent_scenario"},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 404
