"""
Notification Service

In-memory notification system for user alerts.
Notifications are created by events and displayed in frontend notification center.
"""

import logging
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime
from collections import defaultdict

logger = logging.getLogger(__name__)


class Notification:
    """User notification."""
    
    def __init__(
        self,
        notification_id: str,
        user_address: str,
        notification_type: str,
        message: str,
        severity: str,
        metadata: Dict[str, Any],
        timestamp: str,
        read: bool = False,
    ):
        self.id = notification_id
        self.user_address = user_address
        self.type = notification_type
        self.message = message
        self.severity = severity
        self.metadata = metadata
        self.timestamp = timestamp
        self.read = read
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "user_address": self.user_address,
            "type": self.type,
            "message": self.message,
            "severity": self.severity,
            "metadata": self.metadata,
            "timestamp": self.timestamp,
            "read": self.read,
        }


class NotificationService:
    """Manage user notifications."""
    
    def __init__(self):
        """Initialize notification service."""
        # Store: user_address -> list of notifications
        self.notifications: Dict[str, List[Notification]] = defaultdict(list)
        self.max_per_user = 100  # Keep last 100 per user
    
    def create_notification(
        self,
        user_address: str,
        notification_type: str,
        message: str,
        severity: str = "info",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Notification:
        """
        Create a new notification.
        
        Args:
            user_address: User's wallet address
            notification_type: Type of notification (e.g., 'alert', 'proof_complete', 'strategy_update')
            message: Human-readable message
            severity: Severity level ('info', 'warning', 'error', 'success')
            metadata: Additional data
        
        Returns:
            Created notification
        """
        notification = Notification(
            notification_id=str(uuid.uuid4()),
            user_address=user_address,
            notification_type=notification_type,
            message=message,
            severity=severity,
            metadata=metadata or {},
            timestamp=datetime.utcnow().isoformat() + "Z",
            read=False,
        )
        
        self.notifications[user_address].append(notification)
        
        # Keep only last N notifications per user
        if len(self.notifications[user_address]) > self.max_per_user:
            self.notifications[user_address] = self.notifications[user_address][-self.max_per_user:]
        
        logger.info(f"Created notification for {user_address}: {message}")
        
        return notification
    
    def get_notifications(
        self,
        user_address: str,
        limit: int = 20,
        offset: int = 0,
        unread_only: bool = False,
    ) -> List[Notification]:
        """
        Get notifications for a user.
        
        Args:
            user_address: User's wallet address
            limit: Max notifications to return
            offset: Offset for pagination
            unread_only: If True, only return unread notifications
        
        Returns:
            List of notifications (newest first)
        """
        user_notifications = self.notifications.get(user_address, [])
        
        if unread_only:
            user_notifications = [n for n in user_notifications if not n.read]
        
        # Sort by timestamp descending (newest first)
        user_notifications = sorted(
            user_notifications,
            key=lambda n: n.timestamp,
            reverse=True,
        )
        
        return user_notifications[offset:offset + limit]
    
    def mark_as_read(self, notification_id: str, user_address: str) -> bool:
        """
        Mark a notification as read.
        
        Args:
            notification_id: Notification ID
            user_address: User's wallet address
        
        Returns:
            True if marked, False if not found
        """
        for notification in self.notifications.get(user_address, []):
            if notification.id == notification_id:
                notification.read = True
                logger.debug(f"Marked notification {notification_id} as read")
                return True
        
        return False
    
    def mark_all_as_read(self, user_address: str) -> int:
        """
        Mark all notifications as read for a user.
        
        Args:
            user_address: User's wallet address
        
        Returns:
            Number of notifications marked as read
        """
        count = 0
        for notification in self.notifications.get(user_address, []):
            if not notification.read:
                notification.read = True
                count += 1
        
        logger.info(f"Marked {count} notifications as read for {user_address}")
        return count
    
    def clear_notifications(self, user_address: str) -> int:
        """
        Clear all notifications for a user.
        
        Args:
            user_address: User's wallet address
        
        Returns:
            Number of notifications cleared
        """
        count = len(self.notifications.get(user_address, []))
        self.notifications[user_address] = []
        
        logger.info(f"Cleared {count} notifications for {user_address}")
        return count
    
    def get_unread_count(self, user_address: str) -> int:
        """
        Get count of unread notifications.
        
        Args:
            user_address: User's wallet address
        
        Returns:
            Count of unread notifications
        """
        return sum(
            1 for n in self.notifications.get(user_address, [])
            if not n.read
        )


# Singleton instance
_service: NotificationService | None = None


def get_notification_service() -> NotificationService:
    """Get the singleton notification service instance."""
    global _service
    if _service is None:
        _service = NotificationService()
    return _service
