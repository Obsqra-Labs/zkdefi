"""
Event Definitions

Standard event types published by services.
"""

from typing import Dict, Any
from datetime import datetime


class Events:
    """Event name constants."""
    
    # Strategy events
    STRATEGY_CREATED = "strategy.created"
    STRATEGY_UPDATED = "strategy.updated"
    STRATEGY_DELETED = "strategy.deleted"
    
    # Proof events
    PROOF_GENERATED = "proof.generated"
    PROOF_VERIFIED = "proof.verified"
    PROOF_FAILED = "proof.failed"
    
    # Position events
    POSITION_OPENED = "position.opened"
    POSITION_CLOSED = "position.closed"
    POSITION_OUT_OF_RANGE = "position.out_of_range"
    POSITION_IL_THRESHOLD = "position.il_threshold"
    
    # Alert events
    ALERT_TRIGGERED = "alert.triggered"
    ALERT_RESOLVED = "alert.resolved"
    
    # Market events
    MARKET_UPDATED = "market.updated"
    MARKET_CHANGE_DETECTED = "market.change_detected"
    
    # Agent events
    AGENT_CREATED = "agent.created"
    AGENT_STATUS_CHANGED = "agent.status_changed"
    AGENT_REBALANCED = "agent.rebalanced"
    
    # Execution events
    DEPOSIT_EXECUTED = "execution.deposit"
    WITHDRAW_EXECUTED = "execution.withdraw"
    ALLOCATION_EXECUTED = "execution.allocation"


def create_strategy_event(event_type: str, strategy_id: str, **kwargs) -> Dict[str, Any]:
    """Create a strategy event."""
    return {
        "event_type": event_type,
        "strategy_id": strategy_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        **kwargs,
    }


def create_proof_event(event_type: str, proof_hash: str, proof_type: str, **kwargs) -> Dict[str, Any]:
    """Create a proof event."""
    return {
        "event_type": event_type,
        "proof_hash": proof_hash,
        "proof_type": proof_type,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        **kwargs,
    }


def create_position_event(event_type: str, user_address: str, position_id: str, **kwargs) -> Dict[str, Any]:
    """Create a position event."""
    return {
        "event_type": event_type,
        "user_address": user_address,
        "position_id": position_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        **kwargs,
    }


def create_alert_event(event_type: str, user_address: str, severity: str, message: str, **kwargs) -> Dict[str, Any]:
    """Create an alert event."""
    return {
        "event_type": event_type,
        "user_address": user_address,
        "severity": severity,
        "message": message,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        **kwargs,
    }
