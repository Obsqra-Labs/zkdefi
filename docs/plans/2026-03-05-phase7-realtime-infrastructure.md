# Phase 7: Real-Time Infrastructure Implementation Plan

**Date:** 2026-03-05  
**Status:** In Progress  
**Phase:** Real-Time & Event-Driven Architecture  
**Estimated Time:** 10-15 hours

---

## Context

Phase 6 completed the execution loop (recommend → approve → execute → withdraw).

**Current limitation:** All communication is request/response. No push notifications, no real-time updates.

**Phase 7 Goal:** Add real-time infrastructure so frontend receives live updates without polling.

---

## Tasks

### Task 1: WebSocket Server (3 hours)

**Add FastAPI WebSocket support for real-time push updates.**

**Steps:**
1. Create `backend/app/websocket/manager.py` - Connection manager
   - `active_connections: dict[str, WebSocket]` - Map user address to websocket
   - `async connect(user_address, websocket)` - Accept and store connection
   - `async disconnect(user_address)` - Remove connection
   - `async send_to_user(user_address, data)` - Send data to specific user
   - `async broadcast(event_type, data)` - Broadcast to all connected users

2. Create `backend/app/websocket/events.py` - Event types
   - Define event schemas: `StrategyUpdate`, `MarketChange`, `AlertEvent`, `ProofComplete`
   - Each event has `type`, `data`, `timestamp`

3. Add WebSocket endpoint in `backend/app/main.py`
   - `@app.websocket("/ws/{user_address}")` 
   - Accept connection, keep alive, send pings
   - Handle disconnect gracefully

4. Wire workers to WebSocket manager
   - `market_poller.py`: Broadcast strategy updates
   - `position_monitor.py`: Send alerts to affected users
   - `proof_pipeline.py`: Notify when proof completes

**Verification:**
```bash
# Test WebSocket connection
wscat -c ws://localhost:8000/ws/0x123

# Should receive ping every 30s
# Trigger market poll, should receive strategy_update event
```

---

### Task 2: Frontend WebSocket Hook (2 hours)

**Add React hook to subscribe to WebSocket updates.**

**Steps:**
1. Create `frontend/src/hooks/useWebSocket.ts`
   - Connect to `ws://localhost:8000/ws/{address}`
   - Reconnect on disconnect (exponential backoff)
   - Parse incoming events
   - Expose `subscribe(eventType, callback)` API

2. Create `frontend/src/lib/websocket/types.ts`
   - TypeScript types for all event schemas
   - Match backend event types exactly

3. Update `OracleSignalsTab.tsx`
   - Subscribe to `strategy_update` events
   - Auto-refresh opportunities when received
   - Show toast notification on significant changes

4. Update `AgentDashboard.tsx`
   - Subscribe to `alert` events
   - Display real-time alerts in UI
   - Show notification badge

**Verification:**
```typescript
// In OracleSignalsTab
const { subscribe } = useWebSocket(address);

useEffect(() => {
  const unsubscribe = subscribe('strategy_update', (data) => {
    console.log('Strategy updated:', data);
    fetchOpportunities(); // Refresh
  });
  return unsubscribe;
}, []);
```

---

### Task 3: Event Bus Service (2 hours)

**Add internal event bus for service-to-service communication.**

**Steps:**
1. Create `backend/app/events/bus.py` - Simple pub/sub
   - `subscribers: dict[str, list[Callable]]` - Event name → callbacks
   - `def subscribe(event_name, callback)` - Register subscriber
   - `async def publish(event_name, data)` - Notify all subscribers
   - Thread-safe for concurrent access

2. Create `backend/app/events/events.py` - Event definitions
   - `StrategyCreatedEvent`, `StrategyUpdatedEvent`
   - `ProofGeneratedEvent`, `ProofVerifiedEvent`
   - `AlertTriggeredEvent`, `PositionOutOfRangeEvent`

3. Wire services to event bus
   - `strategy_intelligence_service.py`: Publish `StrategyUpdatedEvent`
   - `proof_pipeline.py`: Publish `ProofGeneratedEvent`
   - `position_monitor.py`: Publish `AlertTriggeredEvent`

4. Add event bus → WebSocket bridge
   - Subscribe to all events in event bus
   - Forward relevant events to WebSocket manager
   - Filter by user_address for targeted delivery

**Verification:**
```python
# In strategy_intelligence_service.py
from app.events.bus import get_event_bus

bus = get_event_bus()
await bus.publish('strategy.updated', {
    'strategy_id': strategy.strategy_id,
    'genome_composite': strategy.genome.composite_score,
})

# Should propagate to WebSocket and frontend
```

---

### Task 4: Background Job Queue (3 hours)

**Add Celery for long-running async tasks.**

**Steps:**
1. Install dependencies
   - Add to `backend/requirements.txt`: `celery[redis]`, `redis`
   - Requires Redis running (check if already available)

2. Create `backend/app/workers/celery_app.py`
   - Configure Celery with Redis broker
   - Set result backend
   - Auto-discover tasks

3. Create `backend/app/tasks/proof_tasks.py`
   - `@app.task async def generate_proof_async(user_address, action_type, params)`
   - Run proof generation in background
   - Store result in Redis
   - Publish `ProofGeneratedEvent` when complete

4. Update `proof_pipeline.py`
   - Offer async mode: `generate_deposit_proofs(..., async_mode=True)`
   - If async, queue task and return immediately with task_id
   - Client can poll `/api/v1/proofs/status/{task_id}` for result

5. Add Celery worker to PM2 config
   - `ecosystem.config.cjs`: Add celery worker process

**Verification:**
```python
# Queue proof generation
from app.tasks.proof_tasks import generate_proof_async

task = generate_proof_async.delay(
    user_address="0x123",
    action_type="deposit",
    params={"amount": 100}
)

# Check status
result = task.get(timeout=30)  # Wait for completion
```

---

### Task 5: Notification Service (2 hours)

**Add user notification system for alerts.**

**Steps:**
1. Create `backend/app/services/notification_service.py`
   - Store notifications in-memory (dict keyed by user_address)
   - `create_notification(user_address, type, message, severity, metadata)`
   - `get_notifications(user_address, limit, offset)` - Paginated
   - `mark_as_read(notification_id)`
   - `clear_notifications(user_address)`

2. Wire notification service to events
   - Subscribe to `AlertTriggeredEvent` → create notification
   - Subscribe to `ProofGeneratedEvent` → create notification
   - Subscribe to `StrategyUpdatedEvent` (if significant) → create notification

3. Add API endpoints in `backend/app/api/routes/notifications.py`
   - `GET /api/v1/notifications` - List user's notifications
   - `POST /api/v1/notifications/{id}/read` - Mark as read
   - `DELETE /api/v1/notifications` - Clear all

4. Create frontend component `NotificationCenter.tsx`
   - Bell icon with unread count badge
   - Dropdown with notification list
   - Real-time updates via WebSocket

**Verification:**
```bash
# Create test notification
curl -X POST http://localhost:8000/api/v1/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"user_address": "0x123", "message": "Test alert"}'

# List notifications
curl http://localhost:8000/api/v1/notifications?user_address=0x123

# Should appear in frontend notification center
```

---

### Task 6: Frontend Polling Removal (1 hour)

**Remove manual polling from components, use WebSocket instead.**

**Steps:**
1. Update `OracleSignalsTab.tsx`
   - Remove `setInterval` polling
   - Subscribe to WebSocket `strategy_update` events
   - Keep manual "Refresh" button for user-triggered updates

2. Update `AgentDashboard.tsx`
   - Remove status polling
   - Subscribe to `agent_status_change` events

3. Update `PositionsOverview.tsx`
   - Remove position value polling
   - Subscribe to `position_update` events

4. Add global `AppContext` for WebSocket
   - Provide WebSocket connection to all components
   - Single connection per user, not one per component

**Verification:**
- Open DevTools Network tab
- Navigate to Oracle, Agent, Vault tabs
- Should see NO polling requests (was every 5-30s before)
- Should see ONE WebSocket connection
- Trigger market poll manually, UI should update instantly

---

## Integration Points

### Workers → Event Bus → WebSocket → Frontend

```
market_poller.py (every 60s)
  ↓ publish('strategy.updated')
event_bus.py
  ↓ forward to WebSocket
websocket/manager.py
  ↓ broadcast to all users
frontend/useWebSocket.ts
  ↓ notify subscribers
OracleSignalsTab.tsx
  ↓ auto-refresh opportunities
```

### Services → Celery → Event Bus

```
proof_pipeline.py
  ↓ generate_proof_async.delay()
celery worker
  ↓ run proof generation
  ↓ publish('proof.generated')
event_bus.py
  ↓ forward to WebSocket
frontend
  ↓ show "Proof complete" toast
```

---

## Success Criteria

- [ ] WebSocket connection established on frontend load
- [ ] Market updates push to frontend within 5s of poll
- [ ] Position alerts delivered instantly (not on next page refresh)
- [ ] Proof generation doesn't block HTTP request
- [ ] Notification center shows real-time alerts
- [ ] Zero polling requests in DevTools Network tab
- [ ] WebSocket reconnects automatically on disconnect

---

## Rollback Plan

If WebSocket causes issues:
1. Keep WebSocket optional (feature flag)
2. Fall back to polling if WS unavailable
3. Don't break existing functionality

---

## Performance Impact

**Before:**
- Frontend polls 3-5 endpoints every 5-30s
- ~500-1000 requests/hour per user
- Backend handles constant polling load

**After:**
- ONE WebSocket connection per user
- Push updates only when data changes
- ~10-20 events/hour per user
- 50x reduction in network traffic

---

## Next Steps After Phase 7

**Phase 8: Production Readiness**
- PostgreSQL migration
- Authentication
- Rate limiting
- CI/CD
- Monitoring

**Phase 9: Feature Completeness**
- DCA scheduling
- Limit orders
- strkBTC integration
- Performance charts
