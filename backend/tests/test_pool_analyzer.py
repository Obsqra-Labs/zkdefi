"""
Tests for pool_analyzer service
"""

import pytest
from app.services.pool_analyzer import (
    calculate_pool_risk_score,
    generate_pool_flags,
    PoolMetrics,
    PoolProtocol,
)


class TestRiskScoring:
    """Test risk score calculation"""

    def test_safe_pool_low_risk(self):
        """Stable pool should get low risk score"""
        pool = PoolMetrics(
            pool_id="test_safe",
            protocol=PoolProtocol.EKUBO,
            pair="ETH/USDC",
            total_liquidity_usd=1_000_000,  # High
            volume_24h=200_000,  # Good volume
            volatility_24h=0.02,  # Low volatility
            max_slippage_1pct=0.001,  # Low slippage
            impermanent_loss_risk=0.02,  # Low IL
            expected_apy=0.10,
        )

        score = calculate_pool_risk_score(pool)
        assert score < 20, f"Safe pool should have low risk score, got {score}"

    def test_risky_pool_high_risk(self):
        """Volatile pool with low liquidity should get high risk score"""
        pool = PoolMetrics(
            pool_id="test_risky",
            protocol=PoolProtocol.EKUBO,
            pair="STRK/ETH",
            total_liquidity_usd=30_000,  # Low
            volume_24h=2_000,  # Low volume
            volatility_24h=0.25,  # High volatility
            max_slippage_1pct=0.08,  # High slippage
            impermanent_loss_risk=0.25,  # High IL
            expected_apy=0.40,
        )

        score = calculate_pool_risk_score(pool)
        assert score > 70, f"Risky pool should have high risk score, got {score}"

    def test_lending_pool_low_risk(self):
        """Vesu lending should get low risk score"""
        pool = PoolMetrics(
            pool_id="vesu_usdc",
            protocol=PoolProtocol.VESU,
            pair="USDC Lending",
            total_liquidity_usd=1_000_000,
            volume_24h=0,  # Lending has no volume
            volatility_24h=0.0,
            max_slippage_1pct=0.0,
            impermanent_loss_risk=0.0,
            expected_apy=0.05,
        )

        score = calculate_pool_risk_score(pool)
        assert score < 5, f"Lending pool should be very safe, got {score}"

    def test_score_capped_at_100(self):
        """Risk score should never exceed 100"""
        pool = PoolMetrics(
            pool_id="test_extreme",
            protocol=PoolProtocol.OTHER,
            pair="XYZ/ABC",
            total_liquidity_usd=1_000,  # Very low
            volume_24h=10,  # Almost no volume
            volatility_24h=0.50,  # Extreme volatility
            max_slippage_1pct=0.50,  # Extreme slippage
            impermanent_loss_risk=0.50,  # Extreme IL
            expected_apy=1.0,
        )

        score = calculate_pool_risk_score(pool)
        assert score <= 100, f"Risk score should be capped at 100, got {score}"


class TestFlagGeneration:
    """Test risk flag generation"""

    def test_safe_pool_minimal_flags(self):
        """Safe pool should have minimal flags"""
        pool = PoolMetrics(
            pool_id="safe",
            protocol=PoolProtocol.VESU,
            pair="USDC",
            total_liquidity_usd=1_000_000,
            volume_24h=0,
            volatility_24h=0.0,
            max_slippage_1pct=0.0,
            impermanent_loss_risk=0.0,
            expected_apy=0.05,
            audit_status="verified",
        )

        flags = generate_pool_flags(pool, 1000)
        # Should have ok flag
        ok_flags = [f for f in flags if f.severity == "ok"]
        assert len(ok_flags) > 0, "Safe pool should have approval flags"

    def test_low_liquidity_flag(self):
        """Pool with low liquidity should be flagged"""
        pool = PoolMetrics(
            pool_id="low_liq",
            protocol=PoolProtocol.EKUBO,
            pair="TEST/PAIR",
            total_liquidity_usd=30_000,  # Low
            volume_24h=1_000,
            volatility_24h=0.05,
            max_slippage_1pct=0.01,
            impermanent_loss_risk=0.05,
            expected_apy=0.10,
        )

        flags = generate_pool_flags(pool, 1000)
        liquidity_flags = [f for f in flags if f.category == "liquidity"]
        assert len(liquidity_flags) > 0, "Low liquidity pool should have liquidity flags"

    def test_high_volatility_flag(self):
        """Pool with high volatility should be flagged"""
        pool = PoolMetrics(
            pool_id="volatile",
            protocol=PoolProtocol.EKUBO,
            pair="VOLATILE/PAIR",
            total_liquidity_usd=500_000,
            volume_24h=100_000,
            volatility_24h=0.25,  # High
            max_slippage_1pct=0.005,
            impermanent_loss_risk=0.10,
            expected_apy=0.30,
        )

        flags = generate_pool_flags(pool, 1000)
        vol_flags = [f for f in flags if f.category == "volatility"]
        assert len(vol_flags) > 0, "High volatility pool should have volatility flags"

    def test_unaudited_protocol_flag(self):
        """Unaudited protocol should be flagged"""
        pool = PoolMetrics(
            pool_id="beta",
            protocol=PoolProtocol.OTHER,
            pair="BETA/PAIR",
            total_liquidity_usd=500_000,
            volume_24h=100_000,
            volatility_24h=0.05,
            max_slippage_1pct=0.005,
            impermanent_loss_risk=0.05,
            expected_apy=0.15,
            audit_status="beta",
        )

        flags = generate_pool_flags(pool, 1000)
        audit_flags = [f for f in flags if f.category == "audit"]
        assert len(audit_flags) > 0, "Unaudited protocol should have audit flags"


class TestPoolSuitability:
    """Test if pools are suitable for different risk profiles"""

    @pytest.mark.asyncio
    async def test_conservative_gets_safe_pools(self):
        """Conservative users should get only safe pools"""
        from app.services.pool_analyzer import analyze_pools

        evals = await analyze_pools("conservative")

        for eval in evals:
            assert (
                eval.risk_score < 40
            ), f"Conservative pool should have risk < 40, got {eval.risk_score}"

    @pytest.mark.asyncio
    async def test_balanced_gets_mixed_pools(self):
        """Balanced users should get medium-risk pools"""
        from app.services.pool_analyzer import analyze_pools

        evals = await analyze_pools("balanced")

        for eval in evals:
            assert (
                eval.risk_score < 70
            ), f"Balanced pool should have risk < 70, got {eval.risk_score}"

    @pytest.mark.asyncio
    async def test_aggressive_gets_all_pools(self):
        """Aggressive users should get all pools"""
        from app.services.pool_analyzer import analyze_pools

        conservative = await analyze_pools("conservative")
        balanced = await analyze_pools("balanced")
        aggressive = await analyze_pools("aggressive")

        # Aggressive should have at least as many as balanced
        assert len(aggressive) >= len(balanced), "Aggressive should include balanced pools"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
