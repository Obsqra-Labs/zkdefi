"""
Strategy intelligence data models — persistent entities with computed genome factors.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class GenomeFactors(BaseModel):
    """Computed genome factors for a strategy (0-100 scores)."""
    yield_score: float  # 0-100, based on APY percentile
    risk_score: float   # 0-100, from zkML evaluator
    volatility_score: float  # 0-100, from price std dev
    liquidity_score: float   # 0-100, from TVL depth
    efficiency_score: float  # 0-100, risk-adjusted yield
    
    @property
    def composite_score(self) -> float:
        """Weighted average for ranking strategies."""
        return (
            self.yield_score * 0.3 +
            (100 - self.risk_score) * 0.25 +  # Lower risk = better
            (100 - self.volatility_score) * 0.15 +  # Lower vol = better
            self.liquidity_score * 0.2 +
            self.efficiency_score * 0.1
        )


class Strategy(BaseModel):
    """Persistent strategy entity with computed intelligence."""
    strategy_id: str  # Content-addressable hash
    pool_id: str      # e.g. "ETH/USDC"
    protocol: str     # "Ekubo", "JediSwap", etc.
    token0: str
    token1: str
    fee_tier: float
    
    # Current market data
    apy: float
    tvl_usd: float
    volume_24h_usd: float
    confidence: str
    
    # Computed intelligence
    genome: GenomeFactors
    zkml_risk_score: Optional[int] = None
    zkml_flags: list[str] = []
    
    # Metadata
    created_at: datetime
    updated_at: datetime
    first_seen: datetime  # When first discovered in market surface


class PerformanceSnapshot(BaseModel):
    """Historical performance record (append-only)."""
    strategy_id: str
    timestamp: datetime
    apy: float
    tvl_usd: float
    risk_score: float
    price_change_pct: float
    volume_24h_usd: float
