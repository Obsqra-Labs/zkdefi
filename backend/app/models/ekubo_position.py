"""
Ekubo LP Position Model

Represents a liquidity provision position on Ekubo with privacy (hidden amounts),
autonomous management (rebalancing), and performance tracking.
"""

from enum import Enum
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field
from datetime import timezone


class PositionStatus(str, Enum):
    """Status of an LP position"""
    PENDING = "pending"  # Created, proof not yet verified
    ACTIVE = "active"    # On-chain, earning fees
    REBALANCING = "rebalancing"  # In process of rebalancing
    CLOSED = "closed"    # Position withdrawn


class EkuboPosition(BaseModel):
    """
    Represents a single liquidity position on Ekubo.
    
    Amounts are hidden (stored as commitments only).
    Performance tracked separately via events.
    """
    
    # Core identity
    position_id: str = Field(..., description="Unique position identifier (on-chain ID)")
    user_address: str = Field(..., description="Owner address")
    
    # Token pair
    token0: str = Field(..., description="Token A address")
    token1: str = Field(..., description="Token B address")
    fee_tier: int = Field(..., description="Fee tier in basis points (e.g., 500 = 0.05%)")
    
    # Position range (price-based)
    lower_tick: int = Field(..., description="Lower price boundary tick")
    upper_tick: int = Field(..., description="Upper price boundary tick")
    
    # Hidden amounts (privacy)
    amount0_commitment: str = Field(..., description="Commitment hash for token0 amount")
    amount1_commitment: str = Field(..., description="Commitment hash for token1 amount")
    amount0_commitment_proof: str = Field(..., description="Groth16 proof of amount0 commitment")
    amount1_commitment_proof: str = Field(..., description="Groth16 proof of amount1 commitment")
    
    # Status
    status: PositionStatus = Field(default=PositionStatus.PENDING)
    
    # Proof verification
    proof_hash: str = Field(..., description="Stone proof hash from prover")
    proof_verified_at: Optional[datetime] = Field(default=None, description="When proof was verified on-chain")
    
    # Ekubo integration
    ekubo_position_key: Optional[str] = Field(default=None, description="Ekubo internal position identifier")
    
    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Rebalancing history (references to RebalanceEvent IDs)
    rebalance_history: list[str] = Field(default_factory=list, description="List of rebalance event IDs")
    last_rebalance_at: Optional[datetime] = Field(default=None)
    
    # Autonomy configuration
    auto_rebalance_enabled: bool = Field(default=True)
    fee_threshold_for_rebalance: float = Field(
        default=0.005,  # 0.5%
        description="Trigger rebalance when fees earned reach this % of position value"
    )
    price_drift_threshold: float = Field(
        default=0.08,  # 8%
        description="Trigger rebalance when price moves this % away from range midpoint"
    )
    
    # Session key for autonomous execution
    session_key_address: Optional[str] = Field(default=None, description="Session key for autonomous rebalancing")
    session_key_expires_at: Optional[datetime] = Field(default=None)
    
    model_config = ConfigDict(
        use_enum_values=True,
        json_schema_extra={
            "example": {
                "position_id": "0x1234...abcd",
                "user_address": "0x5678...efgh",
                "token0": "0xETH",
                "token1": "0xUSDC",
                "fee_tier": 500,
                "lower_tick": -887200,
                "upper_tick": -887100,
                "amount0_commitment": "0x...",
                "amount1_commitment": "0x...",
                "amount0_commitment_proof": "0x...",
                "amount1_commitment_proof": "0x...",
                "status": "active",
                "auto_rebalance_enabled": True,
                "fee_threshold_for_rebalance": 0.005,
                "price_drift_threshold": 0.08,
            }
        }
    )


class PositionWithPerformance(BaseModel):
    """Extended position with current performance metrics"""
    position: EkuboPosition
    fees_earned_commitment: str = Field(..., description="Hidden commitment of fees earned")
    fees_earned_usd: Optional[float] = Field(default=None, description="Approximate USD value of fees")
    apy: Optional[float] = Field(default=None, description="Annual percentage yield")
    sharpe_ratio: Optional[float] = Field(default=None, description="Risk-adjusted return")
    max_drawdown: Optional[float] = Field(default=None, description="Maximum historical drawdown")
    num_rebalances: int = Field(default=0, description="Number of autonomous rebalances")
