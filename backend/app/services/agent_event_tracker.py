"""
Agent Event Tracking Service.

Logs agent execution events (signals, decisions, executions, errors) for:
- Debugging and monitoring
- User-facing activity feed
- System health dashboards
- Agent performance metrics
"""

import logging
from typing import Any, Optional
from datetime import datetime, timezone
from enum import Enum

from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    """Event types for agent telemetry."""
    SIGNAL_DISCOVERED = "signal:discovered"
    SIGNAL_EVALUATED = "signal:evaluated"
    SIGNAL_GATED = "signal:gated"
    EXECUTION_PREPARED = "execution:prepared"
    EXECUTION_SUBMITTED = "execution:submitted"
    EXECUTION_CONFIRMED = "execution:confirmed"
    EXECUTION_FAILED = "execution:failed"
    POLICY_UPDATED = "policy:updated"
    AGENT_ERROR = "agent:error"


class EventSeverity(str, Enum):
    """Event severity levels."""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class AgentEvent:
    """Represents a single agent event."""
    
    def __init__(
        self,
        event_type: EventType,
        address: str,
        data: dict[str, Any],
        severity: EventSeverity = EventSeverity.INFO,
        metadata: Optional[dict[str, Any]] = None,
    ):
        self.event_type = event_type
        self.address = address
        self.data = data
        self.severity = severity
        self.metadata = metadata or {}
        self.timestamp = datetime.now(timezone.utc).isoformat()
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for storage."""
        return {
            "event_type": self.event_type.value,
            "address": self.address,
            "data": self.data,
            "severity": self.severity.value,
            "metadata": self.metadata,
            "timestamp": self.timestamp,
        }


class AgentEventTracker:
    """Tracks and stores agent events."""
    
    def __init__(self):
        self._event_store = JsonStore("agent_events")
        self._metrics_store = JsonStore("agent_metrics")
    
    def track_event(self, event: AgentEvent) -> None:
        """Record an agent event."""
        try:
            event_dict = event.to_dict()
            event_key = f"{event.address}:{event.timestamp}"
            self._event_store.append("events", event_dict)
            logger.debug(f"Tracked event: {event.event_type.value} for {event.address}")
        except Exception as e:
            logger.error(f"Failed to track event: {e}")
    
    def track_signal_discovered(
        self,
        address: str,
        signal: dict[str, Any],
    ) -> None:
        """Track when a new signal is discovered."""
        event = AgentEvent(
            event_type=EventType.SIGNAL_DISCOVERED,
            address=address,
            data={
                "signal_id": signal.get("id"),
                "signal_type": signal.get("type"),
                "protocol": signal.get("protocol"),
                "yield_forecast": signal.get("yieldForecast"),
            },
            severity=EventSeverity.INFO,
        )
        self.track_event(event)
    
    def track_signal_gated(
        self,
        address: str,
        signal: dict[str, Any],
        gate_result: dict[str, Any],
    ) -> None:
        """Track signal gating decision."""
        event = AgentEvent(
            event_type=EventType.SIGNAL_GATED,
            address=address,
            data={
                "signal_id": signal.get("id"),
                "allowed": gate_result.get("allowed"),
                "reason": gate_result.get("reason"),
                "constraints": gate_result.get("constraints"),
            },
            severity=EventSeverity.INFO if gate_result.get("allowed") else EventSeverity.WARNING,
        )
        self.track_event(event)
    
    def track_execution_submitted(
        self,
        address: str,
        call_id: str,
        signal_id: str,
        submission: dict[str, Any],
    ) -> None:
        """Track execution submission."""
        event = AgentEvent(
            event_type=EventType.EXECUTION_SUBMITTED,
            address=address,
            data={
                "call_id": call_id,
                "signal_id": signal_id,
                "tx_hash": submission.get("tx_hash"),
                "status": submission.get("status"),
            },
            severity=EventSeverity.INFO,
        )
        self.track_event(event)
    
    def track_execution_failed(
        self,
        address: str,
        signal_id: str,
        error: str,
    ) -> None:
        """Track execution failure."""
        event = AgentEvent(
            event_type=EventType.EXECUTION_FAILED,
            address=address,
            data={
                "signal_id": signal_id,
                "error": error,
            },
            severity=EventSeverity.ERROR,
        )
        self.track_event(event)
    
    def track_policy_updated(
        self,
        address: str,
        old_policy: dict[str, Any],
        new_policy: dict[str, Any],
    ) -> None:
        """Track policy changes."""
        event = AgentEvent(
            event_type=EventType.POLICY_UPDATED,
            address=address,
            data={
                "old_policy": old_policy,
                "new_policy": new_policy,
                "changes": self._compute_policy_diff(old_policy, new_policy),
            },
            severity=EventSeverity.INFO,
        )
        self.track_event(event)
    
    def get_user_events(
        self,
        address: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get recent events for a user."""
        try:
            all_events = self._event_store.get("events", [])
            user_events = [e for e in all_events if e.get("address") == address]
            return user_events[-limit:]  # Latest N
        except Exception as e:
            logger.error(f"Failed to fetch user events for {address}: {e}")
            return []
    
    def get_metrics(self, address: str) -> dict[str, Any]:
        """Get aggregate metrics for a user's agent."""
        try:
            all_events = self._event_store.get("events", [])
            user_events = [e for e in all_events if e.get("address") == address]
            
            metrics = {
                "total_events": len(user_events),
                "signals_discovered": len([e for e in user_events if e.get("event_type") == EventType.SIGNAL_DISCOVERED.value]),
                "signals_gated": len([e for e in user_events if e.get("event_type") == EventType.SIGNAL_GATED.value]),
                "signals_allowed": len([e for e in user_events if e.get("event_type") == EventType.SIGNAL_GATED.value and e.get("data", {}).get("allowed")]),
                "executions_submitted": len([e for e in user_events if e.get("event_type") == EventType.EXECUTION_SUBMITTED.value]),
                "executions_failed": len([e for e in user_events if e.get("event_type") == EventType.EXECUTION_FAILED.value]),
                "errors": len([e for e in user_events if e.get("severity") == EventSeverity.ERROR.value]),
            }
            
            return metrics
        except Exception as e:
            logger.error(f"Failed to compute metrics for {address}: {e}")
            return {}
    
    @staticmethod
    def _compute_policy_diff(old: dict, new: dict) -> dict[str, Any]:
        """Compute what changed between two policies."""
        diff = {}
        all_keys = set(old.keys()) | set(new.keys())
        
        for key in all_keys:
            old_val = old.get(key)
            new_val = new.get(key)
            if old_val != new_val:
                diff[key] = {"from": old_val, "to": new_val}
        
        return diff


def get_event_tracker() -> AgentEventTracker:
    """Singleton getter for event tracker."""
    if not hasattr(get_event_tracker, "_tracker"):
        get_event_tracker._tracker = AgentEventTracker()
    return get_event_tracker._tracker
