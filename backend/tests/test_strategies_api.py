"""
Integration tests for strategy recommendation API
Tests the full flow: request → pool analysis → LLM decision → response
"""

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from app.main import app
from app.services.pool_analyzer import PoolMetrics, PoolProtocol, PoolEvaluation, PoolRiskFlag

# Create test client
client = TestClient(app)


class TestStrategyRecommendationAPI:
    """Test the strategy recommendation endpoint"""

    def test_health_check(self):
        """Test health check endpoint exists"""
        response = client.get("/api/v1/strategies/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
        assert "llm_available" in response.json()
        assert "fallback_available" in response.json()

    def test_recommend_strategy_conservative(self):
        """Test conservative profile recommendation"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0x1234567890abcdef",
                "risk_profile": "conservative",
                "amount": 1000,
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "user_address" in data
        assert data["user_address"] == "0x1234567890abcdef"
        assert data["risk_profile"] == "conservative"
        assert data["total_amount"] == 1000

        # Validate recommendation
        assert "recommended_pools" in data
        assert len(data["recommended_pools"]) > 0

        # Check allocations sum to 100%
        total_allocation = sum(
            pool["allocation_percent"] for pool in data["recommended_pools"]
        )
        assert total_allocation == pytest.approx(100.0, abs=1.0)

        # Check AI fields
        assert 0.0 <= data["ai_confidence"] <= 1.0
        assert 0.0 <= data["expected_portfolio_apy"] <= 1.0
        assert len(data["ai_reasoning"]) > 0
        assert len(data["portfolio_risk_assessment"]) > 0

        print(f"Conservative recommendation: {data}")

    def test_recommend_strategy_balanced(self):
        """Test balanced profile recommendation"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0xabcdef1234567890",
                "risk_profile": "balanced",
                "amount": 5000,
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert data["risk_profile"] == "balanced"
        assert data["total_amount"] == 5000
        assert len(data["recommended_pools"]) >= 2

        total_allocation = sum(
            pool["allocation_percent"] for pool in data["recommended_pools"]
        )
        assert total_allocation == pytest.approx(100.0, abs=1.0)

        print(f"Balanced recommendation: {data}")

    def test_recommend_strategy_aggressive(self):
        """Test aggressive profile recommendation"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0x9876543210fedcba",
                "risk_profile": "aggressive",
                "amount": 10000,
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert data["risk_profile"] == "aggressive"
        assert data["total_amount"] == 10000
        assert len(data["recommended_pools"]) > 0

        total_allocation = sum(
            pool["allocation_percent"] for pool in data["recommended_pools"]
        )
        assert total_allocation == pytest.approx(100.0, abs=1.0)

        # Aggressive should have higher APY
        assert data["expected_portfolio_apy"] > 0.15

        print(f"Aggressive recommendation: {data}")

    def test_recommend_strategy_invalid_profile(self):
        """Test invalid risk profile"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0x1234567890abcdef",
                "risk_profile": "invalid_profile",
                "amount": 1000,
            },
        )

        assert response.status_code == 422  # Validation error

    def test_recommend_strategy_zero_amount(self):
        """Test zero amount"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0x1234567890abcdef",
                "risk_profile": "conservative",
                "amount": 0,
            },
        )

        assert response.status_code == 422  # Validation error

    def test_recommend_strategy_too_large_amount(self):
        """Test amount exceeding maximum"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0x1234567890abcdef",
                "risk_profile": "conservative",
                "amount": 2_000_000,  # Max is 1M
            },
        )

        assert response.status_code == 422  # Validation error

    def test_pool_data_structure(self):
        """Test that recommended pools have all required fields"""
        response = client.post(
            "/api/v1/strategies/recommend",
            json={
                "user_address": "0xtest",
                "risk_profile": "balanced",
                "amount": 1000,
            },
        )

        assert response.status_code == 200
        data = response.json()

        for pool in data["recommended_pools"]:
            # Required fields
            assert "pool_id" in pool
            assert "protocol" in pool
            assert "pair" in pool
            assert "allocation_percent" in pool
            assert "allocation_amount" in pool
            assert "expected_apy" in pool
            assert "risk_score" in pool
            assert "risk_flags" in pool

            # Validate types
            assert isinstance(pool["pool_id"], str)
            assert isinstance(pool["protocol"], str)
            assert isinstance(pool["allocation_percent"], (int, float))
            assert isinstance(pool["allocation_amount"], (int, float))
            assert isinstance(pool["expected_apy"], (int, float))
            assert isinstance(pool["risk_score"], (int, float))
            assert isinstance(pool["risk_flags"], list)

            # Validate ranges
            assert 0 <= pool["allocation_percent"] <= 100
            assert 0 <= pool["expected_apy"] <= 1.0
            assert 0 <= pool["risk_score"] <= 100

    def test_recommendation_consistency(self):
        """Test that same profile produces consistent recommendations"""
        payload = {
            "user_address": "0xconsistent",
            "risk_profile": "conservative",
            "amount": 1000,
        }

        response1 = client.post("/api/v1/strategies/recommend", json=payload)
        response2 = client.post("/api/v1/strategies/recommend", json=payload)

        data1 = response1.json()
        data2 = response2.json()

        # Same profile should produce same allocation percentages
        pools1 = {p["pool_id"]: p["allocation_percent"] for p in data1["recommended_pools"]}
        pools2 = {p["pool_id"]: p["allocation_percent"] for p in data2["recommended_pools"]}

        assert pools1 == pools2
        print("Consistency check passed: Same inputs produce same recommendations")
