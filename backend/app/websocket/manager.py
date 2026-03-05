"""
WebSocket Connection Manager

Manages active WebSocket connections and broadcasts events to clients.
"""

import logging
import json
from typing import Dict, Any
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manage WebSocket connections for real-time updates."""
    
    def __init__(self):
        """Initialize connection manager."""
        self.active_connections: Dict[str, WebSocket] = {}
        self.connection_metadata: Dict[str, Dict[str, Any]] = {}
    
    async def connect(self, user_address: str, websocket: WebSocket):
        """
        Accept and store a new WebSocket connection.
        
        Args:
            user_address: User's wallet address
            websocket: WebSocket connection instance
        """
        await websocket.accept()
        
        # Close existing connection if user reconnects
        if user_address in self.active_connections:
            try:
                await self.active_connections[user_address].close()
            except Exception:
                pass
        
        self.active_connections[user_address] = websocket
        self.connection_metadata[user_address] = {
            "connected_at": datetime.utcnow().isoformat() + "Z",
            "last_ping": datetime.utcnow().isoformat() + "Z",
        }
        
        logger.info(f"WebSocket connected: {user_address}")
        
        # Send welcome message
        await self.send_to_user(user_address, {
            "type": "connected",
            "message": "Connected to Capital OS real-time updates",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    
    async def disconnect(self, user_address: str):
        """
        Remove a WebSocket connection.
        
        Args:
            user_address: User's wallet address
        """
        if user_address in self.active_connections:
            del self.active_connections[user_address]
        
        if user_address in self.connection_metadata:
            del self.connection_metadata[user_address]
        
        logger.info(f"WebSocket disconnected: {user_address}")
    
    async def send_to_user(self, user_address: str, data: Dict[str, Any]):
        """
        Send data to a specific user.
        
        Args:
            user_address: User's wallet address
            data: Data to send (will be JSON encoded)
        
        Returns:
            bool: True if sent successfully, False if user not connected
        """
        if user_address not in self.active_connections:
            return False
        
        try:
            websocket = self.active_connections[user_address]
            await websocket.send_json(data)
            return True
        
        except WebSocketDisconnect:
            logger.warning(f"User {user_address} disconnected during send")
            await self.disconnect(user_address)
            return False
        
        except Exception as e:
            logger.error(f"Failed to send to {user_address}: {e}")
            await self.disconnect(user_address)
            return False
    
    async def broadcast(self, event_type: str, data: Dict[str, Any], exclude: list[str] | None = None):
        """
        Broadcast data to all connected users.
        
        Args:
            event_type: Type of event (e.g., 'strategy_update', 'market_change')
            data: Event data
            exclude: Optional list of user addresses to exclude
        """
        exclude = exclude or []
        
        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        
        disconnected = []
        sent_count = 0
        
        for user_address, websocket in self.active_connections.items():
            if user_address in exclude:
                continue
            
            try:
                await websocket.send_json(message)
                sent_count += 1
            
            except (WebSocketDisconnect, Exception) as e:
                logger.warning(f"Failed to broadcast to {user_address}: {e}")
                disconnected.append(user_address)
        
        # Clean up disconnected users
        for user_address in disconnected:
            await self.disconnect(user_address)
        
        if sent_count > 0:
            logger.debug(f"Broadcast {event_type} to {sent_count} users")
    
    async def send_ping(self, user_address: str):
        """
        Send ping to keep connection alive.
        
        Args:
            user_address: User's wallet address
        """
        success = await self.send_to_user(user_address, {
            "type": "ping",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
        
        if success and user_address in self.connection_metadata:
            self.connection_metadata[user_address]["last_ping"] = datetime.utcnow().isoformat() + "Z"
    
    async def broadcast_ping(self):
        """Send ping to all connected users."""
        for user_address in list(self.active_connections.keys()):
            await self.send_ping(user_address)
    
    def get_connection_count(self) -> int:
        """Get number of active connections."""
        return len(self.active_connections)
    
    def get_connected_users(self) -> list[str]:
        """Get list of connected user addresses."""
        return list(self.active_connections.keys())
    
    def is_connected(self, user_address: str) -> bool:
        """Check if user is connected."""
        return user_address in self.active_connections


# Singleton instance
_manager: ConnectionManager | None = None


def get_connection_manager() -> ConnectionManager:
    """Get the singleton connection manager instance."""
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager
