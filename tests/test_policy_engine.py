#!/usr/bin/env python3
"""
Policy engine unit tests.

Asserts return shape of policy_engine.check (allowed, snapshot_hash, proof_calldata, etc.)
with mocked risk and anomaly services.
Run from repo root: python -m pytest tests/test_policy_engine.py -v
Or: cd backend && python -m pytest ../tests/test_policy_engine.py -v
"""
import sys
from pathlib import Path

backend = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend))

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services.policy_engine import check as policy_check


@pytest.mark.asyncio
async def test_policy_check_return_shape_rebalance():
    """policy_engine.check returns allowed (bool), snapshot_hash, proof_calldata, risk_result, anomaly_result, reason, missing."""
    user = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    payload = {
        "proposal_id": "abc12",
        "portfolio_features": [50, 50, 0, 0, 0, 0, 0, 0],
        "pool_id": "pool_1",
        "from_protocol": 0,
        "to_protocol": 1,
        "amount": 100,
        "reason": "test",
    }
    risk_result = {"is_compliant": True, "proof_calldata": []}
    anomaly_result = {"is_safe": True, "proof_calldata": []}

    async def mock_risk(*a, **k):
        return risk_result

    async def mock_anomaly(*a, **k):
        return anomaly_result

    with patch("app.services.policy_engine.get_risk_service") as g_risk:
        with patch("app.services.policy_engine.get_anomaly_service") as g_anom:
            with patch("app.services.policy_engine.get_oracle") as g_oracle:
                g_risk.return_value.generate_risk_proof = AsyncMock(side_effect=mock_risk)
                g_anom.return_value.analyze_pool_safety = AsyncMock(side_effect=mock_anomaly)
                oracle = g_oracle.return_value
                snapshot = type("Snapshot", (), {"snapshot_hash": "0xabc123"})()
                oracle.get_latest_snapshot.return_value = snapshot

                out = await policy_check(user, "rebalance", payload)

    assert "allowed" in out
    assert isinstance(out["allowed"], bool)
    assert out["allowed"] is True
    assert "snapshot_hash" in out
    assert out["snapshot_hash"] == "0xabc123"
    assert "proof_calldata" in out
    assert "risk_result" in out
    assert out["risk_result"] == risk_result
    assert "anomaly_result" in out
    assert out["anomaly_result"] == anomaly_result
    assert "reason" in out
    assert "missing" in out
    assert isinstance(out["missing"], list)
    assert "stress_result" in out
    assert isinstance(out["stress_result"], dict)
    assert out["stress_result"].get("stress_ok") is True


@pytest.mark.asyncio
async def test_policy_check_pool_stress_deny_when_volatility_high():
    """When oracle snapshot has volatility above threshold, policy denies with pool_stress in missing."""
    user = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    payload = {
        "proposal_id": "xyz",
        "portfolio_features": [50, 50, 0, 0, 0, 0, 0, 0],
        "pool_id": "pool_1",
        "from_protocol": 0,
        "to_protocol": 1,
        "amount": 100,
        "reason": "test",
    }
    risk_result = {"is_compliant": True, "proof_calldata": []}
    anomaly_result = {"is_safe": True, "proof_calldata": []}

    async def mock_risk(*a, **k):
        return risk_result

    async def mock_anomaly(*a, **k):
        return anomaly_result

    # Snapshot with high volatility (600 bps > 500 threshold) -> stress_ok False
    snapshot = type("Snapshot", (), {
        "snapshot_hash": "0xstress",
        "jediswap": {"volatility_bps": 600},
        "ekubo": {"volatility_bps": 100},
    })()

    with patch("app.services.policy_engine.get_risk_service") as g_risk:
        with patch("app.services.policy_engine.get_anomaly_service") as g_anom:
            with patch("app.services.policy_engine.get_oracle") as g_oracle:
                g_risk.return_value.generate_risk_proof = AsyncMock(side_effect=mock_risk)
                g_anom.return_value.analyze_pool_safety = AsyncMock(side_effect=mock_anomaly)
                g_oracle.return_value.get_latest_snapshot.return_value = snapshot

                out = await policy_check(user, "rebalance", payload)

    assert out["allowed"] is False
    assert "pool_stress" in out["missing"]
    assert "stress_result" in out
    assert out["stress_result"].get("stress_ok") is False
    assert "Pool stress" in out.get("reason", "")


@pytest.mark.asyncio
async def test_policy_check_unknown_action():
    """policy_engine.check returns allowed False for unknown action_type."""
    out = await policy_check("0x123", "unknown", {})
    assert out["allowed"] is False
    assert "reason" in out
    assert "Unknown action_type" in out.get("reason", "")
    assert "missing" in out
