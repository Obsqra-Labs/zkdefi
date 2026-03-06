"""
Event Bus → WebSocket Bridge

Forwards events from internal event bus to WebSocket clients.
"""

import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def forward_to_websocket(event_data: Dict[str, Any]):
    """
    Forward event from event bus to WebSocket clients.
    
    Args:
        event_data: Event data from bus
    """
    try:
        from app.websocket.manager import get_connection_manager
        
        manager = get_connection_manager()
        event_type = event_data.get("event_type", "unknown")
        
        # Map internal event types to WebSocket event types
        ws_event_type = _map_event_type(event_type)
        
        if not ws_event_type:
            return
        
        # Forward to appropriate clients
        user_address = event_data.get("user_address")
        
        if user_address:
            # Send to specific user
            await manager.send_to_user(user_address, {
                "type": ws_event_type,
                "data": event_data,
                "timestamp": event_data.get("timestamp", ""),
            })
        else:
            # Broadcast to all users
            await manager.broadcast(ws_event_type, event_data)
        
        logger.debug(f"Forwarded event {event_type} to WebSocket as {ws_event_type}")
        
    except Exception as e:
        logger.error(f"Failed to forward event to WebSocket: {e}")


def _map_event_type(internal_type: str) -> str | None:
    """
    Map internal event type to WebSocket event type.
    
    Args:
        internal_type: Internal event name (e.g., 'strategy.updated')
    
    Returns:
        WebSocket event type or None if no mapping
    """
    mapping = {
        "strategy.created": "strategy_update",
        "strategy.updated": "strategy_update",
        "proof.generated": "proof_complete",
        "proof.verified": "proof_complete",
        "alert.triggered": "alert",
        "position.out_of_range": "alert",
        "position.il_threshold": "alert",
        "position.opened": "position_update",
        "position.closed": "position_update",
        "agent.status_changed": "agent_status_change",
        "agent.rebalanced": "agent_status_change",
        "market.updated": "market_change",
    }
    
    return mapping.get(internal_type)


async def setup_websocket_bridge():
    """
    Set up the event bus → WebSocket bridge.
    
    Subscribe to all events on the bus and forward to WebSocket.
    """
    from app.events.bus import get_event_bus
    
    bus = get_event_bus()
    
    # Subscribe to all events with wildcard
    await bus.subscribe("*", forward_to_websocket)
    
    logger.info("WebSocket bridge activated")
