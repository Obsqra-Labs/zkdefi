"""
Notification API Routes

Endpoints for managing user notifications.
"""

from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

router = APIRouter(tags=["notifications"])


class NotificationResponse(BaseModel):
    """Notification response model."""
    id: str
    user_address: str
    type: str
    message: str
    severity: str
    metadata: dict
    timestamp: str
    read: bool


class NotificationsListResponse(BaseModel):
    """List of notifications response."""
    notifications: List[NotificationResponse]
    total_count: int
    unread_count: int


@router.get("", response_model=NotificationsListResponse)
async def get_notifications(
    user_address: str,
    limit: int = 20,
    offset: int = 0,
    unread_only: bool = False,
):
    """
    Get notifications for a user.
    
    Query parameters:
    - user_address: User's wallet address (required)
    - limit: Max notifications to return (default 20)
    - offset: Offset for pagination (default 0)
    - unread_only: Only return unread notifications (default false)
    """
    from app.services.notification_service import get_notification_service
    
    service = get_notification_service()
    
    notifications = service.get_notifications(
        user_address=user_address,
        limit=limit,
        offset=offset,
        unread_only=unread_only,
    )
    
    unread_count = service.get_unread_count(user_address)
    
    return NotificationsListResponse(
        notifications=[
            NotificationResponse(**n.to_dict())
            for n in notifications
        ],
        total_count=len(service.notifications.get(user_address, [])),
        unread_count=unread_count,
    )


@router.post("/{notification_id}/read")
async def mark_notification_read(notification_id: str, user_address: str):
    """Mark a notification as read."""
    from app.services.notification_service import get_notification_service
    
    service = get_notification_service()
    
    success = service.mark_as_read(notification_id, user_address)
    
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    return {"success": True}


@router.post("/read-all")
async def mark_all_read(user_address: str):
    """Mark all notifications as read for a user."""
    from app.services.notification_service import get_notification_service
    
    service = get_notification_service()
    
    count = service.mark_all_as_read(user_address)
    
    return {"success": True, "marked_count": count}


@router.delete("")
async def clear_notifications(user_address: str):
    """Clear all notifications for a user."""
    from app.services.notification_service import get_notification_service
    
    service = get_notification_service()
    
    count = service.clear_notifications(user_address)
    
    return {"success": True, "cleared_count": count}


@router.get("/unread-count")
async def get_unread_count(user_address: str):
    """Get count of unread notifications."""
    from app.services.notification_service import get_notification_service
    
    service = get_notification_service()
    
    count = service.get_unread_count(user_address)
    
    return {"unread_count": count}
