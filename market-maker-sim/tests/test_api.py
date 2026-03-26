"""HTTP contract tests for the market-maker-sim FastAPI app (on-chain engine)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


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
    assert data["service"] == "zkdefi-market-maker"


@pytest.mark.asyncio
async def test_public_state_shape(client: AsyncClient) -> None:
    resp = await client.get("/public/state")
    assert resp.status_code == 200
    data = resp.json()
    assert "pools" in data
    assert "bots" in data
    assert isinstance(data["pools"], list)
    assert isinstance(data["bots"], dict)


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
    assert "ekubo_core" in data
    assert data.get("network") in ("sepolia", "starknet-sepolia") or "network" in data


@pytest.mark.asyncio
async def test_public_pools(client: AsyncClient) -> None:
    resp = await client.get("/public/pools")
    assert resp.status_code == 200
    data = resp.json()
    assert "pools" in data
    assert isinstance(data["pools"], list)


@pytest.mark.asyncio
async def test_public_positions(client: AsyncClient) -> None:
    resp = await client.get("/public/positions")
    assert resp.status_code == 200
    data = resp.json()
    assert "positions" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_admin_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/admin/state")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_state_with_key(client: AsyncClient) -> None:
    resp = await client.get("/admin/state", headers={"x-admin-key": "dev-admin-key"})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("ok") is True
    assert "state" in data
    assert "controls" in data
    assert "pools" in data["state"]


@pytest.mark.asyncio
async def test_admin_toggle_swap_without_wallet_returns_400(client: AsyncClient) -> None:
    """No swap bot when BOT_* unset — engine rejects unknown/disabled bot."""
    resp = await client.post(
        "/admin/bots/swap",
        json={"enabled": False},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_set_peg(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/peg",
        json={"peg_price": 1900},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True


@pytest.mark.asyncio
async def test_admin_force_trade_display_override(client: AsyncClient) -> None:
    """Without swap_bot, manual trade falls back to pair volume overlay."""
    resp = await client.post(
        "/admin/trade",
        json={"side": "buy", "notional_usd": 2000},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    assert resp.json().get("ok") is True


@pytest.mark.asyncio
async def test_admin_trigger_scenario(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/scenarios/trigger",
        json={"scenario": "depeg_down", "severity": 0.2, "duration_ticks": 10},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 200
    assert resp.json().get("ok") is True


@pytest.mark.asyncio
async def test_admin_trigger_scenario_invalid(client: AsyncClient) -> None:
    resp = await client.post(
        "/admin/scenarios/trigger",
        json={"scenario": "not_a_real_scenario", "severity": 0.2, "duration_ticks": 10},
        headers={"x-admin-key": "dev-admin-key"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_openapi_docs_available(client: AsyncClient) -> None:
    resp = await client.get("/docs")
    assert resp.status_code == 200
