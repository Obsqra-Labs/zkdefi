# Real-Time Updates

zkde.fi uses WebSocket connections for instant, push-based updates. No polling required.

## Architecture

```
Workers (market_poller, position_monitor)
  ↓ Every 60s / 5min
Event Bus (internal pub/sub)
  ↓ publish events
WebSocket Manager
  ↓ broadcast to clients
Frontend (useWebSocket hook)
  ↓ auto-refresh UI
```

## Connection

**Endpoint:** `ws://localhost:8000/ws/{user_address}` (dev) or `wss://api.zkde.fi/ws/{user_address}` (prod)

**Example:**
```javascript
import { useWebSocket } from "@/hooks/useWebSocket";

const { connected, subscribe } = useWebSocket(address);

useEffect(() => {
  const unsubscribe = subscribe("strategy_update", (data) => {
    console.log("Strategy updated:", data);
    // Auto-refresh your data
  });
  return unsubscribe;
}, []);
```

## Event Types

| Event Type | Description | Data |
|------------|-------------|------|
| `strategy_update` | Strategy created/updated | `strategy_id`, `genome_composite`, `pool_id`, `apy`, `risk_score` |
| `market_change` | Significant market change | `change_type`, `pool_id`, `old_value`, `new_value`, `change_pct` |
| `alert` | User position alert | `severity`, `alert_type`, `message`, `action` |
| `proof_complete` | Proof generation done | `proof_type`, `proof_hash`, `success` |
| `position_update` | Position value changed | `position_id`, `current_value` |
| `agent_status_change` | Agent status changed | `agent_id`, `status` |

## Features

- **Auto-reconnect:** Exponential backoff (max 10 attempts)
- **Keep-alive:** Ping/pong every 30 seconds
- **Selective subscriptions:** Subscribe to specific event types
- **Wildcard:** Subscribe to all events with `"*"`

## Performance

| Metric | Before (Polling) | After (WebSocket) |
|--------|------------------|-------------------|
| Requests/hour | 500-1000 | 10-20 events |
| Latency | 5-30s delay | Instant (0ms) |
| Traffic | Constant | Push on change |

**50x reduction in network traffic.**

## Testing

**Install wscat:**
```bash
npm install -g wscat
```

**Connect:**
```bash
wscat -c "ws://localhost:8000/ws/0x123456"
```

**Expected output:**
```json
{"type":"connected","message":"Connected to Capital OS..."}
{"type":"ping","timestamp":"2026-03-05T..."}
```

## Troubleshooting

**Connection fails:**
- Check backend is running on port 8000
- Verify WebSocket endpoint is accessible
- Check browser console for errors

**No events received:**
- Ensure workers are running (market_poller.py, position_monitor.py)
- Check worker logs for errors
- Verify Event Bus bridge is activated
