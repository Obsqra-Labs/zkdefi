"""
Strategy Intelligence Service — compute genome factors, rank strategies, track performance.
"""
from __future__ import annotations
import logging
from datetime import datetime
from typing import List, Optional

from app.models.strategy import Strategy, GenomeFactors, PerformanceSnapshot
from app.services.strategy_repository import get_strategy_repository, _generate_strategy_id

logger = logging.getLogger(__name__)


class StrategyIntelligenceService:
    """Compute genome factors, rank strategies, track performance."""
    
    def __init__(self):
        self.repo = get_strategy_repository()
    
    def compute_genome(
        self,
        apy: float,
        risk_score: float,
        tvl_usd: float,
        volatility_pct: float,
        volume_24h_usd: float,
    ) -> GenomeFactors:
        """Compute 0-100 genome factors from raw metrics.
        
        Args:
            apy: Annual percentage yield (0-100+)
            risk_score: zkML risk score (0-100)
            tvl_usd: Total value locked in USD
            volatility_pct: 24h price volatility percentage (0-100+)
            volume_24h_usd: 24h trading volume in USD
        
        Returns:
            GenomeFactors with normalized 0-100 scores
        """
        # Yield factor: Normalize APY to 0-100 (cap at 100% APY = score 100)
        yield_score = min(100, apy)
        
        # Risk factor: Use zkML risk score directly (already 0-100)
        risk_factor = risk_score
        
        # Volatility factor: Convert volatility % to score (higher vol = lower score)
        # 0% vol = 100 score, 50%+ vol = 0 score
        volatility_score = max(0, 100 - (volatility_pct * 2))
        
        # Liquidity factor: Log scale based on TVL
        # $10k = 0, $100k = 50, $1M = 75, $10M+ = 100
        if tvl_usd < 10_000:
            liquidity_score = 0
        elif tvl_usd < 100_000:
            liquidity_score = 20 + (tvl_usd - 10_000) / 90_000 * 30
        elif tvl_usd < 1_000_000:
            liquidity_score = 50 + (tvl_usd - 100_000) / 900_000 * 25
        else:
            liquidity_score = min(100, 75 + (tvl_usd - 1_000_000) / 9_000_000 * 25)
        
        # Efficiency factor: Risk-adjusted yield
        # High yield + low risk = high efficiency
        risk_penalty = risk_factor / 100  # 0-1
        efficiency_score = min(100, apy * (1 - risk_penalty * 0.5))
        
        return GenomeFactors(
            yield_score=yield_score,
            risk_score=risk_factor,
            volatility_score=volatility_score,
            liquidity_score=liquidity_score,
            efficiency_score=efficiency_score,
        )
    
    def create_or_update_strategy(
        self,
        pool_id: str,
        protocol: str,
        token0: str,
        token1: str,
        fee_tier: float,
        apy: float,
        tvl_usd: float,
        volume_24h_usd: float,
        confidence: str,
        zkml_risk_score: Optional[int] = None,
        zkml_flags: Optional[List[str]] = None,
        volatility_pct: float = 10.0,  # Default 10% if not provided
    ) -> Strategy:
        """Create new or update existing strategy with computed genome."""
        strategy_id = _generate_strategy_id(pool_id, protocol, token0, token1, fee_tier)
        
        # Compute genome
        genome = self.compute_genome(
            apy=apy,
            risk_score=zkml_risk_score if zkml_risk_score is not None else 50,
            tvl_usd=tvl_usd,
            volatility_pct=volatility_pct,
            volume_24h_usd=volume_24h_usd,
        )
        
        # Check if strategy exists
        existing = self.repo.get_strategy(strategy_id)
        now = datetime.now(timezone.utc)
        
        strategy = Strategy(
            strategy_id=strategy_id,
            pool_id=pool_id,
            protocol=protocol,
            token0=token0,
            token1=token1,
            fee_tier=fee_tier,
            apy=apy,
            tvl_usd=tvl_usd,
            volume_24h_usd=volume_24h_usd,
            confidence=confidence,
            genome=genome,
            zkml_risk_score=zkml_risk_score,
            zkml_flags=zkml_flags or [],
            created_at=existing.created_at if existing else now,
            updated_at=now,
            first_seen=existing.first_seen if existing else now,
        )
        
        self.repo.save_strategy(strategy)
        
        # Record performance snapshot
        snapshot = PerformanceSnapshot(
            strategy_id=strategy_id,
            timestamp=now,
            apy=apy,
            tvl_usd=tvl_usd,
            risk_score=float(zkml_risk_score) if zkml_risk_score else 50.0,
            price_change_pct=0.0,  # TODO: compute from price history
            volume_24h_usd=volume_24h_usd,
        )
        self.repo.record_performance(snapshot)
        
        return strategy
    
    def rank_strategies(
        self,
        user_profile: str = "BALANCED",
        min_tvl: float = 0,
        max_risk: float = 100,
        limit: int = 20,
    ) -> List[Strategy]:
        """Rank strategies by composite score with filters."""
        # Map risk profile to max risk threshold
        profile_risk = {"CONSERVATIVE": 40, "BALANCED": 65, "AGGRESSIVE": 100}
        effective_max_risk = min(max_risk, profile_risk.get(user_profile.upper(), 65))
        
        # Get all strategies
        strategies = self.repo.list_strategies({
            "min_tvl": min_tvl,
            "max_risk": effective_max_risk,
        })
        
        # Sort by composite score (descending)
        ranked = sorted(strategies, key=lambda s: s.genome.composite_score, reverse=True)
        
        return ranked[:limit]


_service: StrategyIntelligenceService | None = None

def get_strategy_intelligence_service() -> StrategyIntelligenceService:
    """Singleton accessor."""
    global _service
    if _service is None:
        _service = StrategyIntelligenceService()
    return _service
