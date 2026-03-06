"""
Tests for strategies route — /api/v1/strategies/*
Covers Pydantic validation, /analyze, /recommend, /execute-advanced, /health
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import List

import pytest
from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.strategies as strategies_mod

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fake pool evaluator / collector stubs
# ---------------------------------------------------------------------------

@dataclass
class FakePoolEval:
    pool_id: str = "eth_usdc_500"
    pool_name: str = "ETH/USDC 0.05%"
    risk_score: int = 25
    safety_level: str = "safe"
    confidence: float = 0.92
    recommended_allocation_min: float = 0.2
    recommended_allocation_max: float = 0.4
    flags: list = field(default_factory=list)


class FakePoolCollector:
    """Stub for PoolDataCollector."""
    def __init__(self, pools=None, yields=None):
        self._pools = pools or [{"pool_id": "eth_usdc_500"}]
        self._yields = yields or {"eth_usdc_500": 0.12}

    def get_all_pools(self):
        return self._pools, self._yields


class FakePoolEvaluator:
    """Stub for PoolRiskEvaluator."""
    def evaluate_multiple(self, pools):
        return [FakePoolEval()]

    def rank_by_risk_adjusted_apy(self, evals, yield_map):
        return [(e, yield_map.get(e.pool_id, 0.1)) for e in evals]


# ---------------------------------------------------------------------------
# Pydantic validation tests (no HTTP, pure model)
# ---------------------------------------------------------------------------

class TestPoolAnalysisRequestValidation:
    def test_valid_profiles(self):
        for profile in ("CONSERVATIVE", "BALANCED", "AGGRESSIVE"):
            req = strategies_mod.PoolAnalysisRequest(
                deposit_amount=100, risk_profile=profile, user_address="0x1"
            )
            assert req.risk_profile == profile

    def test_invalid_profile_rejected(self):
        with pytest.raises(Exception):
            strategies_mod.PoolAnalysisRequest(
                deposit_amount=100, risk_profile="YOLO", user_address="0x1"
            )


class TestStrategyRecommendationRequestValidation:
    def test_valid_profiles(self):
        for profile in ("conservative", "balanced", "aggressive"):
            req = strategies_mod.StrategyRecommendationRequest(
                user_address="0x1", risk_profile=profile, amount=500
            )
            assert req.risk_profile == profile

    def test_amount_must_be_positive(self):
        with pytest.raises(Exception):
            strategies_mod.StrategyRecommendationRequest(
                user_address="0x1", risk_profile="balanced", amount=-1
            )

    def test_amount_max_cap(self):
        with pytest.raises(Exception):
            strategies_mod.StrategyRecommendationRequest(
                user_address="0x1", risk_profile="balanced", amount=2_000_000
            )


# ---------------------------------------------------------------------------
# /analyze endpoint (monkeypatched)
# ---------------------------------------------------------------------------

class TestAnalyzeEndpoint:
    def test_analyze_returns_recommendations(self, monkeypatch):
        monkeypatch.setattr(strategies_mod, "pool_collector", FakePoolCollector())
        monkeypatch.setattr(strategies_mod, "pool_evaluator", FakePoolEvaluator())

        resp = client.post(
            "/api/v1/strategies/analyze",
            json={
                "deposit_amount": 1_000_000_000,
                "risk_profile": "BALANCED",
                "user_address": "0xABCD",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["user_address"] == "0xABCD"
        assert body["risk_profile"] == "BALANCED"
        assert len(body["recommended_pools"]) >= 1
        assert body["primary_pool"] is not None
        assert body["confidence_score"] > 0

    def test_analyze_rejects_bad_profile(self):
        resp = client.post(
            "/api/v1/strategies/analyze",
            json={
                "deposit_amount": 100,
                "risk_profile": "UNKNOWN",
                "user_address": "0x1",
            },
        )
        assert resp.status_code == 422  # Pydantic validation error

    def test_analyze_no_pools_returns_500(self, monkeypatch):
        monkeypatch.setattr(
            strategies_mod, "pool_collector", FakePoolCollector(pools=[], yields={})
        )
        resp = client.post(
            "/api/v1/strategies/analyze",
            json={
                "deposit_amount": 100,
                "risk_profile": "BALANCED",
                "user_address": "0x1",
            },
        )
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# /health endpoint
# ---------------------------------------------------------------------------

class TestHealthEndpoint:
    def test_health_returns_status(self, monkeypatch):
        # pool_collector.get_all_pools is async in health but sync elsewhere —
        # stub to make the coroutine safe:
        async def _fake_get():
            return ([], {})

        monkeypatch.setattr(strategies_mod, "pool_collector", type("C", (), {"get_all_pools": _fake_get})())
        resp = client.get("/api/v1/strategies/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "healthy"
        assert "llm_available" in body


# ---------------------------------------------------------------------------
# _filter_by_profile helper
# ---------------------------------------------------------------------------

class TestFilterByProfile:
    def test_conservative_filters_high_risk(self):
        evals = [FakePoolEval(risk_score=10), FakePoolEval(risk_score=50)]
        result = strategies_mod._filter_by_profile(evals, "CONSERVATIVE")
        assert len(result) == 1
        assert result[0].risk_score == 10

    def test_balanced_allows_moderate(self):
        evals = [FakePoolEval(risk_score=10), FakePoolEval(risk_score=50), FakePoolEval(risk_score=80)]
        result = strategies_mod._filter_by_profile(evals, "BALANCED")
        assert len(result) == 2

    def test_aggressive_allows_all(self):
        evals = [FakePoolEval(risk_score=10), FakePoolEval(risk_score=90)]
        result = strategies_mod._filter_by_profile(evals, "AGGRESSIVE")
        assert len(result) == 2
