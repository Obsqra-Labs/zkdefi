"""
WebSocket Event Types

Defines the schema for all events sent over WebSocket.
"""

from typing import Dict, Any, Literal
from pydantic import BaseModel
from datetime import datetime


class BaseEvent(BaseModel):
    """Base event with common fields."""
    type: str
    timestamp: str
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() + "Z"
        }


class StrategyUpdateEvent(BaseEvent):
    """Strategy was created or updated."""
    type: Literal["strategy_update"] = "strategy_update"
    data: Dict[str, Any]
    
    @staticmethod
    def create(strategy_id: str, genome_composite: float, **kwargs):
        """Create a strategy update event."""
        return {
            "type": "strategy_update",
            "data": {
                "strategy_id": strategy_id,
                "genome_composite": genome_composite,
                **kwargs,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


class MarketChangeEvent(BaseEvent):
    """Significant market change detected."""
    type: Literal["market_change"] = "market_change"
    data: Dict[str, Any]
    
    @staticmethod
    def create(change_type: str, pool_id: str, old_value: float, new_value: float, **kwargs):
        """Create a market change event."""
        return {
            "type": "market_change",
            "data": {
                "change_type": change_type,  # 'apy_spike', 'tvl_drain', etc.
                "pool_id": pool_id,
                "old_value": old_value,
                "new_value": new_value,
                "change_pct": ((new_value - old_value) / old_value * 100) if old_value > 0 else 0,
                **kwargs,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


class AlertEvent(BaseEvent):
    """User alert (position out of range, high IL, etc.)."""
    type: Literal["alert"] = "alert"
    data: Dict[str, Any]
    
    @staticmethod
    def create(user_address: str, severity: str, alert_type: str, message: str, **kwargs):
        """Create an alert event."""
        return {
            "type": "alert",
            "data": {
                "user_address": user_address,
                "severity": severity,  # 'low', 'medium', 'high'
                "alert_type": alert_type,  # 'out_of_range', 'high_il', etc.
                "message": message,
                **kwargs,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


class ProofCompleteEvent(BaseEvent):
    """Proof generation completed."""
    type: Literal["proof_complete"] = "proof_complete"
    data: Dict[str, Any]
    
    @staticmethod
    def create(user_address: str, proof_type: str, proof_hash: str, success: bool, **kwargs):
        """Create a proof complete event."""
        return {
            "type": "proof_complete",
            "data": {
                "user_address": user_address,
                "proof_type": proof_type,  # 'deposit', 'withdraw', 'zkml', etc.
                "proof_hash": proof_hash,
                "success": success,
                **kwargs,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


class PositionUpdateEvent(BaseEvent):
    """Position value or status changed."""
    type: Literal["position_update"] = "position_update"
    data: Dict[str, Any]
    
    @staticmethod
    def create(user_address: str, position_id: str, current_value: float, **kwargs):
        """Create a position update event."""
        return {
            "type": "position_update",
            "data": {
                "user_address": user_address,
                "position_id": position_id,
                "current_value": current_value,
                **kwargs,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


class AgentStatusChangeEvent(BaseEvent):
    """Agent status changed (started, stopped, rebalanced)."""
    type: Literal["agent_status_change"] = "agent_status_change"
    data: Dict[str, Any]
    
    @staticmethod
    def create(user_address: str, agent_id: str, status: str, **kwargs):
        """Create an agent status change event."""
        return {
            "type": "agent_status_change",
            "data": {
                "user_address": user_address,
                "agent_id": agent_id,
                "status": status,  # 'active', 'paused', 'rebalancing', etc.
                **kwargs,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


# Event type registry for validation
EVENT_TYPES = {
    "strategy_update": StrategyUpdateEvent,
    "market_change": MarketChangeEvent,
    "alert": AlertEvent,
    "proof_complete": ProofCompleteEvent,
    "position_update": PositionUpdateEvent,
    "agent_status_change": AgentStatusChangeEvent,
}
