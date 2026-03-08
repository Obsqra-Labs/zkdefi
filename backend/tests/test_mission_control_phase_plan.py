from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.dao_governance as dao_routes
import app.api.routes.mission_control as mc_routes

client = TestClient(app)


def _rank_key(row: dict) -> tuple[int, float]:
    return (
        mc_routes._SIGNAL_PRIORITY.get(str(row.get("signal", "stable")), 9),
        -float(row.get("signal_score", 0) or 0),
    )


def test_signal_assignment_includes_features_and_diversity():
    opps = [
        {"id": "1", "venue": "ekubo", "pair": "ETH/USDC", "apy_bps": 1600, "tvl": 2_000_000, "volume_24h": 400_000, "risk_level": "low", "source": "ekubo_live", "snapshot_ts": "2026-03-07T00:00:00Z"},
        {"id": "2", "venue": "ekubo", "pair": "STRK/USDC", "apy_bps": 1400, "tvl": 1_800_000, "volume_24h": 320_000, "risk_level": "medium", "source": "ekubo_live", "snapshot_ts": "2026-03-07T00:01:00Z"},
        {"id": "3", "venue": "ekubo", "pair": "ETH/USDC", "apy_bps": 1300, "tvl": 1_100_000, "volume_24h": 250_000, "risk_level": "medium", "source": "ekubo_live", "snapshot_ts": "2026-03-07T00:02:00Z"},
        {"id": "4", "venue": "lending", "pair": "STRK/DAI", "apy_bps": 900, "tvl": 2_400_000, "volume_24h": 110_000, "risk_level": "low", "source": "lending_oracle", "snapshot_ts": "2026-03-07T00:03:00Z"},
        {"id": "5", "venue": "staking", "pair": "STRK/ETH", "apy_bps": 700, "tvl": 1_700_000, "volume_24h": 95_000, "risk_level": "low", "source": "native_staking", "snapshot_ts": "2026-03-07T00:04:00Z"},
        {"id": "6", "venue": "zkd_lp", "pair": "ZKDAI/ZKDETH", "apy_bps": 1100, "tvl": 900_000, "volume_24h": 300_000, "risk_level": "medium", "source": "mm_sim", "snapshot_ts": "2026-03-07T00:05:00Z"},
        {"id": "7", "venue": "lending", "pair": "WBTC/USDC", "apy_bps": 1000, "tvl": 2_100_000, "volume_24h": 135_000, "risk_level": "medium", "source": "lending_oracle", "snapshot_ts": "2026-03-07T00:06:00Z"},
        {"id": "8", "venue": "staking", "pair": "ETH/DAI", "apy_bps": 800, "tvl": 1_600_000, "volume_24h": 90_000, "risk_level": "low", "source": "native_staking", "snapshot_ts": "2026-03-07T00:07:00Z"},
        {"id": "9", "venue": "ekubo", "pair": "UNKNOWN/USDC", "apy_bps": 400, "tvl": 0, "volume_24h": 0, "risk_level": "medium", "source": "ekubo_live", "snapshot_ts": "2026-03-07T00:08:00Z"},
    ]
    metrics = mc_routes._assign_signal_labels(opps)

    for row in opps:
        assert "signal" in row
        assert "signal_strength" in row
        assert "signal_reason" in row
        assert "signal_features" in row

    assert "signal_distribution" in metrics
    assert "top6_unique_venues" in metrics
    assert metrics["top6_unique_venues"] >= 3
    assert "reason_populated_pct" in metrics
    assert "stale_signal_rate_pct" in metrics


def test_signal_top_api_exposes_reason_strength_and_features(monkeypatch):
    async def fake_fetch(limit: int = 15):
        return [
            {
                "id": "demo-1",
                "pair": "ETH/USDC",
                "venue": "ekubo",
                "apy_bps": 1200,
                "risk_level": "low",
                "tvl": 1_000_000,
                "volume_24h": 250_000,
                "composite_score": 12.5,
                "signal": "top_pick",
                "signal_strength": 98,
                "signal_reason": "Driven by edge and liquidity quality.",
                "signal_features": {"edge": 90},
            }
        ]

    monkeypatch.setattr(mc_routes, "_fetch_live_opportunities", fake_fetch)
    monkeypatch.setattr(mc_routes, "_last_signal_metrics", {"signal_distribution": {"top_pick": 1}})

    res = client.get("/api/v1/zkdefi/mc/signal/top?limit=5")
    assert res.status_code == 200
    payload = res.json()
    assert payload["count"] == 1
    assert "signal_metrics" in payload
    opp = payload["opportunities"][0]
    assert opp["signal"] == "top_pick"
    assert opp["signal_strength"] == 98
    assert "signal_reason" in opp
    assert "signal_features" in opp


def test_vault_alias_matches_mc_constraints():
    address = "0xabc123"
    mc_res = client.get(f"/api/v1/zkdefi/mc/constraints/{address}")
    vault_res = client.get(f"/api/v1/vault/constraints/{address}")
    assert mc_res.status_code == 200
    assert vault_res.status_code == 200
    assert mc_res.json()["address"] == vault_res.json()["address"]
    assert mc_res.json()["risk_tolerance"] == vault_res.json()["risk_tolerance"]


def test_voting_power_endpoint_returns_breakdown(monkeypatch):
    async def fake_capital(_address: str):
        return (6400.0, 900.0, 100.0)

    monkeypatch.setattr(dao_routes, "_compute_capital_breakdown", fake_capital)
    monkeypatch.setattr(dao_routes, "_tier_info_for_user", lambda _addr: (1, "Standard", 1.5))

    res = client.get("/api/v1/dao/voting_power/0xabc")
    assert res.status_code == 200
    data = res.json()
    assert "voting_power" in data
    assert data["lp_usd"] == 6400.0
    assert data["lending_usd"] == 900.0
    assert data["staking_usd"] == 100.0
    assert data["tier"] == 1
    assert data["tier_multiplier"] == 1.5
    assert data["formula_version"] == "vp_v2_sqrt_capital_tier_multiplier"


def test_vault_proposals_prefix_not_doubled():
    good = client.post("/api/v1/zkdefi/vault/proposals/commit", json={"adapters": [], "amounts": [], "params": []})
    assert good.status_code in (200, 422)

    bad = client.post(
        "/api/v1/zkdefi/vault/proposals/api/v1/zkdefi/vault/proposals/commit",
        json={"adapters": [], "amounts": [], "params": []},
    )
    assert bad.status_code == 404
