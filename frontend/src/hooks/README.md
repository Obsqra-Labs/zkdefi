# React Hooks

Custom React hooks for zkde.fi frontend.

## Available Hooks

### useWebSocket.ts

**Purpose:** Connect to Capital OS real-time WebSocket updates.

**Usage:**
```typescript
import { useWebSocket } from "@/hooks/useWebSocket";

const { connected, subscribe, send } = useWebSocket(address);

// Subscribe to events
useEffect(() => {
  const unsubscribe = subscribe("strategy_update", (data) => {
    console.log("Strategy updated:", data);
  });
  return unsubscribe;
}, []);
```

**Features:**
- Auto-connect on mount with user address
- Exponential backoff reconnect (max 10 attempts)
- Subscribe to specific event types
- Wildcard subscriptions with `"*"`
- Graceful disconnect on unmount

**Event Types:**
- `strategy_update` - Strategy created/updated
- `market_change` - Market changes
- `alert` - Position alerts
- `proof_complete` - Proof done
- `position_update` - Position value changed
- `agent_status_change` - Agent status changed

**Options:**
```typescript
useWebSocket(address, {
  enabled: true,              // Enable/disable connection
  reconnect: true,            // Auto-reconnect on disconnect
  reconnectInterval: 1000,    // Initial reconnect delay (ms)
  maxReconnectAttempts: 10,   // Max reconnect attempts
});
```

### usePrivacyVault.ts

**Purpose:** Privacy vault deposit/withdraw operations.

**Features:**
- Commitment-based deposits
- Nullifier-based withdrawals
- Merkle proof generation
- Relayer integration

### useProfile.ts

**Purpose:** User profile and reputation data.

**Features:**
- Fetch user reputation tier
- Get proof count
- Check compliance gates
- Track onboarding status

## Creating New Hooks

**Template:**
```typescript
import { useState, useEffect, useCallback } from "react";

export function useMyFeature(param: string) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/my-feature/${param}`);
      const data = await res.json();
      setData(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [param]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
```

## Best Practices

1. **Use useCallback** - Memoize functions to avoid re-creating on every render
2. **Cleanup subscriptions** - Return cleanup function from useEffect
3. **Handle loading/error states** - Always show feedback to user
4. **AbortController** - Cancel requests on unmount
5. **Type safety** - Use TypeScript interfaces for all data

## Testing

**Mock hook:**
```typescript
jest.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    connected: true,
    subscribe: jest.fn(() => jest.fn()),
    send: jest.fn(),
  }),
}));
```
