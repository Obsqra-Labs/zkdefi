"""
Tests for LLM Decision Engine
MVP Week 1: Tests fallback logic (no OpenAI key needed)
"""

import pytest
from app.services.llm_engine import LLMEngine, AllocationRecommendation


class TestLLMEngineFallback:
    """Test deterministic fallback allocation logic"""

    @pytest.fixture
    def engine(self):
        """Create LLM engine with fallback (no API key)"""
        return LLMEngine()

    @pytest.fixture
    def mock_pools(self):
        """Mock pool data matching pool_analyzer output"""
        return [
            {
                "pool_id": "ekubo_eth_usdc",
                "protocol": "Ekubo",
                "pair": "ETH/USDC",
                "risk_score": 20,
                "expected_apy": 0.12,
                "liquidity_usd": 500_000,
                "volume_24h": 2_000_000,
            },
            {
                "pool_id": "ekubo_strk_eth",
                "protocol": "Ekubo",
                "pair": "STRK/ETH",
                "risk_score": 45,
                "expected_apy": 0.28,
                "liquidity_usd": 250_000,
                "volume_24h": 1_500_000,
            },
            {
                "pool_id": "ekubo_strk_usdc",
                "protocol": "Ekubo",
                "pair": "STRK/USDC",
                "risk_score": 50,
                "expected_apy": 0.18,
                "liquidity_usd": 300_000,
                "volume_24h": 1_800_000,
            },
            {
                "pool_id": "vesu_usdc",
                "protocol": "Vesu",
                "pair": "USDC Lending",
                "risk_score": 10,
                "expected_apy": 0.05,
                "liquidity_usd": 1_000_000,
                "volume_24h": 500_000,
            },
            {
                "pool_id": "vesu_strk",
                "protocol": "Vesu",
                "pair": "STRK Lending",
                "risk_score": 15,
                "expected_apy": 0.06,
                "liquidity_usd": 500_000,
                "volume_24h": 300_000,
            },
        ]

    @pytest.mark.asyncio
    async def test_conservative_allocation(self, engine, mock_pools):
        """Conservative profile should prefer lending + stable LP"""
        rec = await engine.recommend_allocation(
            user_risk_profile="conservative",
            pools=mock_pools,
            user_amount=1000,
        )

        assert isinstance(rec, AllocationRecommendation)
        assert rec.allocation is not None
        assert len(rec.allocation) > 0
        assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)

        # Check allocation composition
        total_allocated = sum(rec.allocation.values())
        assert total_allocated == pytest.approx(1.0, rel=0.01)

        # For conservative, should have some lending (Vesu)
        assert any("vesu" in pool_id for pool_id in rec.allocation.keys())

        # Expected APY should be low
        assert rec.expected_apy < 0.12

        # Confidence should be reasonable
        assert 0.7 <= rec.confidence <= 1.0

        print(f"Conservative allocation: {rec.allocation}")
        print(f"Expected APY: {rec.expected_apy:.2%}")
        print(f"Reasoning: {rec.reasoning}")

    @pytest.mark.asyncio
    async def test_balanced_allocation(self, engine, mock_pools):
        """Balanced profile should split LP and lending"""
        rec = await engine.recommend_allocation(
            user_risk_profile="balanced",
            pools=mock_pools,
            user_amount=1000,
        )

        assert isinstance(rec, AllocationRecommendation)
        assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)

        # Should have multiple pools
        assert len(rec.allocation) >= 2

        # Should have mix of protocols
        has_ekubo = any("ekubo" in pool_id for pool_id in rec.allocation.keys())
        has_vesu = any("vesu" in pool_id for pool_id in rec.allocation.keys())
        assert has_ekubo or has_vesu

        # Expected APY should be moderate
        assert 0.10 <= rec.expected_apy <= 0.20

        # Risk assessment should mention moderate
        assert "oderate" in rec.risk_assessment or "Moderate" in rec.risk_assessment

        print(f"Balanced allocation: {rec.allocation}")
        print(f"Expected APY: {rec.expected_apy:.2%}")

    @pytest.mark.asyncio
    async def test_aggressive_allocation(self, engine, mock_pools):
        """Aggressive profile should favor high-yield LPs"""
        rec = await engine.recommend_allocation(
            user_risk_profile="aggressive",
            pools=mock_pools,
            user_amount=1000,
        )

        assert isinstance(rec, AllocationRecommendation)
        assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)

        # Should have LP pools (Ekubo)
        assert any("ekubo" in pool_id for pool_id in rec.allocation.keys())

        # Expected APY should be high
        assert rec.expected_apy > 0.20

        # Risk assessment should mention high risk
        assert "igh" in rec.risk_assessment.lower()

        print(f"Aggressive allocation: {rec.allocation}")
        print(f"Expected APY: {rec.expected_apy:.2%}")

    @pytest.mark.asyncio
    async def test_allocation_sums_to_100_percent(self, engine, mock_pools):
        """All allocations must sum to 100% (within 1% rounding)"""
        for profile in ["conservative", "balanced", "aggressive"]:
            rec = await engine.recommend_allocation(
                user_risk_profile=profile,
                pools=mock_pools,
                user_amount=1000,
            )
            assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)

    @pytest.mark.asyncio
    async def test_confidence_scores(self, engine, mock_pools):
        """Confidence should be between 0 and 1"""
        rec = await engine.recommend_allocation(
            user_risk_profile="balanced",
            pools=mock_pools,
            user_amount=1000,
        )
        assert 0.0 <= rec.confidence <= 1.0
        assert rec.confidence > 0.7  # Should be fairly confident

    @pytest.mark.asyncio
    async def test_reasoning_provided(self, engine, mock_pools):
        """Recommendation should include human-readable reasoning"""
        rec = await engine.recommend_allocation(
            user_risk_profile="conservative",
            pools=mock_pools,
            user_amount=1000,
        )
        assert rec.reasoning
        assert len(rec.reasoning) > 20
        assert "%" in rec.reasoning or "APY" in rec.reasoning

    @pytest.mark.asyncio
    async def test_single_pool_recommendation(self, engine):
        """Should handle case with only one available pool"""
        single_pool = [
            {
                "pool_id": "only_pool",
                "protocol": "Vesu",
                "pair": "USDC Lending",
                "risk_score": 10,
                "expected_apy": 0.05,
                "liquidity_usd": 1_000_000,
                "volume_24h": 500_000,
            }
        ]

        rec = await engine.recommend_allocation(
            user_risk_profile="conservative",
            pools=single_pool,
            user_amount=1000,
        )

        assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)
        assert rec.allocation.get("only_pool") == pytest.approx(1.0, rel=0.01)

    @pytest.mark.asyncio
    async def test_empty_pools(self, engine):
        """Should gracefully handle no pools"""
        rec = await engine.recommend_allocation(
            user_risk_profile="conservative",
            pools=[],
            user_amount=1000,
        )

        assert rec.allocation == {}
        assert rec.confidence == 0.0
        assert "Unable" in rec.risk_assessment or "no" in rec.risk_assessment.lower()

    @pytest.mark.asyncio
    async def test_different_amounts(self, engine, mock_pools):
        """Percentage allocations should be independent of amount"""
        rec_small = await engine.recommend_allocation(
            user_risk_profile="balanced",
            pools=mock_pools,
            user_amount=100,
        )
        rec_large = await engine.recommend_allocation(
            user_risk_profile="balanced",
            pools=mock_pools,
            user_amount=100_000,
        )

        # Allocations should be identical
        assert rec_small.allocation == rec_large.allocation
        assert rec_small.expected_apy == rec_large.expected_apy


class TestAllocationValidation:
    """Test recommendation validation logic"""

    @pytest.fixture
    def engine(self):
        return LLMEngine()

    def test_normalize_over_100_percent(self, engine):
        """Should normalize allocations that sum > 100%"""
        result = {
            "allocation": {"pool_a": 60, "pool_b": 60},  # Sum = 120%
            "reasoning": "test",
            "confidence": 0.8,
            "expected_apy": 0.15,
            "risk_assessment": "test",
        }
        pools = [
            {"pool_id": "pool_a", "risk_score": 20},
            {"pool_id": "pool_b", "risk_score": 30},
        ]

        rec = engine._validate_recommendation(result, pools)
        assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)

    def test_filter_invalid_pools(self, engine):
        """Should remove pools not in available pool list"""
        result = {
            "allocation": {"pool_a": 0.5, "pool_invalid": 0.5},
            "reasoning": "test",
            "confidence": 0.8,
            "expected_apy": 0.15,
            "risk_assessment": "test",
        }
        pools = [{"pool_id": "pool_a", "risk_score": 20}]

        rec = engine._validate_recommendation(result, pools)
        assert "pool_invalid" not in rec.allocation
        assert "pool_a" in rec.allocation
        assert sum(rec.allocation.values()) == pytest.approx(1.0, rel=0.01)

    def test_confidence_bounds(self, engine):
        """Should clamp confidence to 0-1"""
        result = {
            "allocation": {"pool_a": 1.0},
            "reasoning": "test",
            "confidence": 1.5,  # Invalid
            "expected_apy": 0.15,
            "risk_assessment": "test",
        }
        pools = [{"pool_id": "pool_a"}]

        rec = engine._validate_recommendation(result, pools)
        assert 0.0 <= rec.confidence <= 1.0

    def test_apy_bounds(self, engine):
        """Should clamp APY to 0-100%"""
        result = {
            "allocation": {"pool_a": 1.0},
            "reasoning": "test",
            "confidence": 0.8,
            "expected_apy": -0.5,  # Invalid
            "risk_assessment": "test",
        }
        pools = [{"pool_id": "pool_a"}]

        rec = engine._validate_recommendation(result, pools)
        assert 0.0 <= rec.expected_apy <= 1.0
