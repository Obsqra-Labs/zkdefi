"""
Performance Metrics Model

Tracks LP position earnings, APY, Sharpe ratio, drawdown, and rebalance history.
"""

from enum import Enum
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field
from datetime import timezone


class RebalanceReason(str, Enum):
    """Reason for autonomous rebalance"""
    FEE_THRESHOLD = "fee_threshold"  # Fees exceeded threshold
    PRICE_DRIFT = "price_drift"      # Price moved outside range
    LIQUIDITY_OPTIMIZED = "liquidity_optimized"  # Better fee tier available
    MANUAL_TRIGGER = "manual_trigger"  # User-initiated


class RebalanceEvent(BaseModel):
    """
    Records a single autonomous rebalance operation.
    """
    
    # Identity
    event_id: str = Field(..., description="Unique event identifier")
    position_id: str = Field(..., description="Position being rebalanced")
    
    # Trigger information
    reason: RebalanceReason = Field(..., description="Why rebalance was triggered")
    triggered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Old state (before rebalance)
    old_fee_tier: int = Field(..., description="Previous fee tier")
    old_lower_tick: int = Field(..., description="Previous lower tick")
    old_upper_tick: int = Field(..., description="Previous upper tick")
    
    # New state (after rebalance)
    new_fee_tier: int = Field(..., description="New fee tier")
    new_lower_tick: int = Field(..., description="New lower tick")
    new_upper_tick: int = Field(..., description="New upper tick")
    
    # Proof verification
    proof_hash: str = Field(..., description="Stone proof hash of zkML rebalance decision")
    proof_verified: bool = Field(default=False, description="Was proof verified on-chain?")
    proof_verified_at: Optional[datetime] = Field(default=None)
    
    # Execution
    session_key_used: str = Field(..., description="Session key that executed rebalance")
    tx_hash: Optional[str] = Field(default=None, description="Transaction hash of rebalance execution")
    executed_at: Optional[datetime] = Field(default=None)
    
    # Metrics at time of rebalance
    accumulated_fees_commitment: str = Field(..., description="Commitment hash of fees at rebalance time")
    accumulated_fees_usd_estimate: Optional[float] = Field(default=None)
    
    model_config = ConfigDict(use_enum_values=True)


class PerformanceMetrics(BaseModel):
    """
    Performance metrics for a liquidity position.
    Calculated from historical snapshots (events, on-chain state).
    """
    
    position_id: str = Field(..., description="Position identifier")
    
    # Earnings tracking
    total_fees_earned_commitment: str = Field(..., description="Commitment hash of total fees")
    total_fees_earned_usd_estimate: Optional[float] = Field(default=None)
    
    # APY calculation
    apy: Optional[float] = Field(
        default=None,
        description="Annual percentage yield (fees / TVL / days * 365)"
    )
    apy_30d: Optional[float] = Field(default=None, description="30-day APY")
    apy_7d: Optional[float] = Field(default=None, description="7-day APY")
    
    # Risk metrics
    sharpe_ratio: Optional[float] = Field(
        default=None,
        description="Sharpe ratio (return / volatility)"
    )
    max_drawdown: Optional[float] = Field(
        default=None,
        description="Maximum drawdown from peak"
    )
    volatility: Optional[float] = Field(
        default=None,
        description="Daily fee volatility"
    )
    
    # Rebalancing activity
    total_rebalances: int = Field(default=0, description="Total autonomous rebalances")
    rebalance_events: List[str] = Field(default_factory=list, description="List of RebalanceEvent IDs")
    last_rebalance_at: Optional[datetime] = Field(default=None)
    
    # Time period
    tracking_start: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    tracking_updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = ConfigDict(
        use_enum_values=True,
        json_schema_extra={
            "example": {
                "position_id": "0x1234...abcd",
                "total_fees_earned_commitment": "0x5678...efgh",
                "total_fees_earned_usd_estimate": 1234.56,
                "apy": 0.25,  # 25%
                "apy_30d": 0.22,
                "apy_7d": 0.28,
                "sharpe_ratio": 1.8,
                "max_drawdown": 0.05,
                "volatility": 0.02,
                "total_rebalances": 3,
                "last_rebalance_at": "2026-02-15T08:30:00",
            }
        }
    )


class PerformanceSummary(BaseModel):
    """
    User-facing summary of position performance.
    Combines position + metrics + current state.
    """
    position_id: str
    token_pair: str = Field(..., description="e.g., 'ETH-USDC'")
    
    # Value (approximate)
    current_value_usd: Optional[float] = Field(default=None)
    entry_value_usd: Optional[float] = Field(default=None)
    
    # Returns
    pnl_usd: Optional[float] = Field(default=None, description="Profit/loss in USD")
    pnl_percent: Optional[float] = Field(default=None, description="Profit/loss percentage")
    fees_earned_usd: Optional[float] = Field(default=None, description="Fees earned (estimate)")
    
    # Performance metrics
    apy: Optional[float] = Field(default=None)
    sharpe_ratio: Optional[float] = Field(default=None)
    max_drawdown: Optional[float] = Field(default=None)
    
    # Autonomy
    auto_rebalances_count: int = Field(default=0)
    last_action: Optional[datetime] = Field(default=None, description="Last rebalance or manual action")
    
    # Health
    is_in_range: bool = Field(default=True, description="Is current price within position range?")
    days_until_out_of_range: Optional[int] = Field(default=None)
