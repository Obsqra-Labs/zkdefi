# Source Generated with Decompyle++
# File: notifications.cpython-312.pyc (Python 3.12)

'''
Notification API Routes

Endpoints for managing user notifications.
'''
from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
router = APIRouter(tags = [
    'notifications'])

class NotificationResponse(BaseModel):
    read: bool = 'Notification response model.'


class NotificationsListResponse(BaseModel):
    unread_count: int = 'List of notifications response.'

get_notifications = (lambda user_address = None, limit = None, offset = router.get('', response_model = NotificationsListResponse), unread_only = (20, 0, False): pass# WARNING: Decompyle incomplete
)()
mark_notification_read = (lambda notification_id = None, user_address = None: pass# WARNING: Decompyle incomplete
)()
mark_all_read = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
clear_notifications = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
get_unread_count = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
