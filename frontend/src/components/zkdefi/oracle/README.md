# Oracle Components

Real-time strategy intelligence UI for Capital OS.

## Components

### OracleSignalsTab.tsx

**Displays:** Strategy opportunities + personalized recommendations

**Features:**
- Fetches opportunities from `/api/v1/strategies/opportunities`
- Fetches recommendations from `/api/v1/strategies/recommendations`
- **Approve button** - Executes vault allocation (Phase 6!)
- **Real-time updates** - WebSocket subscription to `strategy_update` events (Phase 7!)
- zkML intelligence display (risk score, flags, circuit details)

**Usage:**
```tsx
<OracleSignalsTab address={userAddress} />
```

**Approve Flow:**
1. User clicks "Approve" on recommendation
2. Confirms in modal
3. Calls `/api/v1/strategies/allocate` for AI allocation plan
4. Calls `/api/v1/vault/execute` to deploy capital
5. Shows deployment ID, positions, APY, proof hash
6. Auto-refreshes opportunities

**WebSocket Integration:**
```typescript
const { subscribe } = useWebSocket(address);

useEffect(() => {
  const unsubscribe = subscribe("strategy_update", (data) => {
    fetchOpportunities(); // Auto-refresh
  });
  return unsubscribe;
}, []);
```

### OracleGenomeTab.tsx

**Displays:** Strategy genome factors + zkML verification

**Features:**
- Shows genome bars (yield, risk, volatility, liquidity, efficiency)
- Composite score calculation
- zkML verification panel (proof hashes, circuit status)
- Strategy evolution (TODO: time-series charts)

### OracleRadarTab.tsx

**Displays:** Signal visualization radar chart

**Features:**
- Visual representation of opportunity signals
- Signal strength indicators
- Proof status badges

## Data Flow

```
Backend Workers (every 60s)
  ↓ Poll Ekubo market data
  ↓ Update strategies
  ↓ Publish to Event Bus
  ↓ Forward to WebSocket
Frontend (OracleSignalsTab)
  ↓ Receive strategy_update
  ↓ Auto-refresh opportunities
  ↓ User sees latest data
```

## Types

**OracleOpportunity:**
```typescript
interface OracleOpportunity {
  pair: string;
  estimated_apy_pct: number;
  risk_score: number;
  volatility: number;
  tvl_usd: number;
  confidence: string;
  proof_status: string;
  signal_strength: number;
  zkml_risk_score?: number;
  zkml_confidence?: number;
  zkml_flags?: string[];
  zkml_signals?: {
    il_acceptable: boolean;
    yield_near_optimal: boolean;
    slippage_ok: boolean;
    gates_passed: number;
    gates_total: number;
    proof_hash?: string;
  };
  genome_factors?: {
    yield_score: number;
    risk_score: number;
    volatility_score: number;
    liquidity_score: number;
    efficiency_score: number;
  };
}
```

**OracleRecommendation:**
```typescript
interface OracleRecommendation {
  label: string;
  strategyName: string;
  allocationPct: number;
}
```

## Testing

**With demo wallet:**
```typescript
const DEMO_ADDRESS = "0xdemo";

// Demo mode uses DEMO_OPPORTUNITIES and DEMO_RECOMMENDATIONS
<OracleSignalsTab address={DEMO_ADDRESS} />
```

**With real wallet:**
1. Connect wallet (ArgentX/Braavos)
2. Navigate to `/agent?v=oracle`
3. Should fetch real opportunities from backend
4. WebSocket should connect (see console: "WebSocket connected")
5. Click Approve to test execution

## Performance

**Before Phase 7:**
- Polled opportunities every 5-30s
- ~500 requests/hour per user

**After Phase 7:**
- ONE WebSocket connection
- Push updates only when data changes
- ~10-20 events/hour per user
- **50x traffic reduction**
