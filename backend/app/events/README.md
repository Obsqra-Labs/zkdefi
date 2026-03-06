# Event Bus

Internal pub/sub system for service-to-service communication.

## Overview

The Event Bus provides async, in-process event publishing and subscription. Services can publish events without knowing who's listening, and subscribers react to events without coupling to publishers.

## Architecture

```
Service A                Service B                Service C
   ↓                        ↓                        ↓
   publish()                subscribe()              subscribe()
   ↓                        ↓                        ↓
              ┌──────────────────────────┐
              │       Event Bus          │
              │  (internal pub/sub)      │
              └──────────────────────────┘
                       ↓
              Notify all subscribers
```

## Components

### bus.py

**EventBus** - Core pub/sub implementation.

**Methods:**
- `subscribe(event_name, handler)` - Register async handler
- `unsubscribe(event_name, handler)` - Remove handler
- `publish(event_name, data)` - Notify all subscribers
- `get_subscriber_count(event_name)` - Count subscribers
- `get_event_names()` - List all subscribed events

**Usage:**
```python
from app.events.bus import get_event_bus

bus = get_event_bus()

# Subscribe
async def on_strategy_update(data):
    print(f"Strategy updated: {data['strategy_id']}")

await bus.subscribe("strategy.updated", on_strategy_update)

# Publish
await bus.publish("strategy.updated", {
    "strategy_id": "strategy_123",
    "genome_composite": 85.2,
})

# Unsubscribe
await bus.unsubscribe("strategy.updated", on_strategy_update)
```

### events.py

**Event Definitions** - Standard event names and helpers.

**Event Categories:**
- **Strategy:** `strategy.created`, `strategy.updated`, `strategy.deleted`
- **Proof:** `proof.generated`, `proof.verified`, `proof.failed`
- **Position:** `position.opened`, `position.closed`, `position.out_of_range`, `position.il_threshold`
- **Alert:** `alert.triggered`, `alert.resolved`
- **Market:** `market.updated`, `market.change_detected`
- **Agent:** `agent.created`, `agent.status_changed`, `agent.rebalanced`
- **Execution:** `execution.deposit`, `execution.withdraw`, `execution.allocation`

**Usage:**
```python
from app.events.events import Events, create_strategy_event

event = create_strategy_event(
    Events.STRATEGY_UPDATED,
    strategy_id="strategy_123",
    genome_composite=85.2,
)

await bus.publish(Events.STRATEGY_UPDATED, event)
```

### websocket_bridge.py

**WebSocket Bridge** - Forwards events from Event Bus to WebSocket clients.

**Setup** (in `app/main.py` lifespan):
```python
from app.events.websocket_bridge import setup_websocket_bridge

@asynccontextmanager
async def _lifespan(app):
    await setup_websocket_bridge()  # Subscribe to "*" (all events)
    yield
```

**Mapping:**
- Internal `strategy.updated` → WebSocket `strategy_update`
- Internal `alert.triggered` → WebSocket `alert`
- Internal `proof.generated` → WebSocket `proof_complete`

## Wildcard Subscriptions

Subscribe to **all events** with `"*"`:

```python
async def on_any_event(data):
    print(f"Event: {data.get('event_type')}")

await bus.subscribe("*", on_any_event)
```

## Integration Examples

### Service Publishing Events

**strategy_intelligence_service.py:**
```python
from app.events.bus import get_event_bus
from app.events.events import Events, create_strategy_event

def create_or_update_strategy(...):
    # ... update strategy logic ...
    
    # Publish event
    bus = get_event_bus()
    event = create_strategy_event(
        Events.STRATEGY_UPDATED,
        strategy_id=strategy.strategy_id,
        genome_composite=strategy.genome.composite_score,
    )
    asyncio.create_task(bus.publish(Events.STRATEGY_UPDATED, event))
```

### Worker Publishing Events

**market_poller.py:**
```python
from app.events.bus import get_event_bus
from app.events.events import Events

async def update_strategy(...):
    # ... update logic ...
    
    # Publish to Event Bus (gets forwarded to WebSocket)
    bus = get_event_bus()
    await bus.publish(Events.STRATEGY_UPDATED, {
        "strategy_id": strategy_id,
        "genome_composite": genome.composite_score,
    })
```

### Service Subscribing to Events

**notification_service.py:**
```python
from app.events.bus import get_event_bus
from app.services.notification_service import get_notification_service

async def on_alert(data):
    service = get_notification_service()
    service.create_notification(
        user_address=data["user_address"],
        notification_type="alert",
        message=data["message"],
        severity=data["severity"],
    )

bus = get_event_bus()
await bus.subscribe("alert.triggered", on_alert)
```

## Event Flow

```
1. Worker/Service performs action
2. Publishes event to Event Bus
3. Event Bus notifies all subscribers:
   a. WebSocket Bridge → forwards to clients
   b. Notification Service → creates notification
   c. Other services → react to event
4. Frontend receives WebSocket message
5. UI auto-updates
```

## Testing

**Publish test event:**
```python
from app.events.bus import get_event_bus
import asyncio

async def test():
    bus = get_event_bus()
    await bus.publish("strategy.updated", {
        "strategy_id": "test_123",
        "genome_composite": 85.2,
    })

asyncio.run(test())
```

**Subscribe and log:**
```python
async def logger(data):
    print(f"Event received: {data}")

await bus.subscribe("*", logger)  # Log all events
```

## Performance

| Metric | Value |
|--------|-------|
| Events/second | 10,000+ |
| Latency (publish → notify) | <1ms |
| Subscribers per event | Unlimited |
| Overhead | Minimal (in-memory) |

## Debugging

**Enable debug logging:**
```python
import logging
logging.getLogger("app.events.bus").setLevel(logging.DEBUG)
```

**Logs:**
```
[DEBUG] Subscribed to event: strategy.updated
[INFO] Publishing event: strategy.updated to 3 subscribers
[DEBUG] No subscribers for event: unknown.event
```

**Check subscribers:**
```python
bus = get_event_bus()
print(f"Total subscribers: {bus.get_subscriber_count()}")
print(f"Event names: {bus.get_event_names()}")
print(f"strategy.updated: {bus.get_subscriber_count('strategy.updated')} subscribers")
```

## Best Practices

1. **Use event constants:** `Events.STRATEGY_UPDATED` not `"strategy.updated"`
2. **Publish async:** Use `asyncio.create_task()` to avoid blocking
3. **Handle errors:** Subscribers should catch exceptions (bus swallows them)
4. **Keep handlers fast:** Long-running work should be offloaded to background tasks
5. **Document event schemas:** Use helper functions like `create_strategy_event()`

## Troubleshooting

**Events not reaching subscribers:**
- Check subscriber registered before publish
- Verify event name matches exactly
- Check handler is async function
- Enable debug logging

**Subscribers timing out:**
- Event Bus waits max 30s for all handlers
- Long-running handlers should spawn background tasks
- Check for deadlocks in handler logic

**Memory leaks:**
- Always unsubscribe when done
- Use weak references if holding long-lived subscriptions
- Monitor subscriber count over time
