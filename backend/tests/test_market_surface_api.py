"""Tests for market surface API route."""

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.market as market_routes

client = TestClient(app)


def test_market_surface_200(monkeypatch):
    monkeypatch.setattr(market_routes, "_market_surface_enabled", lambda: True)

    async def fake_surface(chain_id=None):
        return {
            "timestamp": 1,
            "updated_at": "2026-01-01T00:00:00Z",
            "source_timestamp": 1,
            "stale": False,
            "summary": {"best_pair": "ETH/USDC", "best_venue": "Ekubo", "top_spread_bps": 10, "opportunity_count": 1},
            "venues": [],
            "opportunities": [],
        }

    monkeypatch.setattr(market_routes, "get_market_surface", fake_surface)

    response = client.get("/api/v1/zkdefi/market/surface")
    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["best_venue"] == "Ekubo"
