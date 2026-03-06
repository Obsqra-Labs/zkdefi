# Frontend Integration Guide: Orchestrated Endpoints

## Quick Start

The backend now provides **unified orchestrated endpoints** that handle complete workflows. Instead of calling multiple separate endpoints, frontend calls orchestrator endpoints that do everything.

---

## API Endpoints Reference

### 1. Create Position
**When:** User clicks "Create LP Position" button
**Endpoint:** `POST /orchestrated/position/create`
**Request:**
```json
{
  "user_address": "0x1234567890...",
  "token_a": "USDC",
  "token_b": "ETH",
  "amount": 10000.0,
  "fee_tier": 3000,
  "tx_hash": "0xabcdef123456..."
}
```
**Response:**
```json
{
  "status": "created_and_logged",
  "position_id": "pos_1_1771215038",
  "pair": "USDC/ETH",
  "amount": 10000,
  "fee_tier": 3000,
  "audit_recorded": true,
  "model_version": 0,
  "created_at": "2024-12-17T..."
}
```
**What it does:**
- ✅ Creates position
- ✅ Automatically records to audit trail
- ✅ Links to model version (v0)
- ✅ Verifies with transaction hash
- ✅ Returns confirmation

---

### 2. Evaluate Position for Rebalance
**When:** Frontend queries if position needs rebalancing
**Endpoint:** `POST /orchestrated/position/evaluate`
**Request:**
```json
{
  "position_id": "pos_1_1771215038",
  "current_apy": 3.5,
  "optimal_apy": 5.2,
  "optimal_fee_tier": 500,
  "pool_utilization": 0.78
}
```
**Response:**
```json
{
  "position_id": "pos_1_1771215038",
  "should_rebalance": true,
  "reason": "Fee tier spread: 2500 bps (threshold: 50 bps)",
  "metrics": {
    "apy_difference": 1.7,
    "fee_tier_spread": 2500,
    "pool_utilization": 78.0
  },
  "audit_recorded": true,
  "audit_entry_id": "dec_1_1771215038"
}
```
**What it does:**
- ✅ Evaluates if rebalance needed
- ✅ If triggered, automatically records decision to audit trail
- ✅ Returns decision with reason
- ✅ Includes audit entry ID if recorded

---

### 3. Get Position Status + Audit History
**When:** User opens position details page
**Endpoint:** `GET /orchestrated/position/{position_id}`
**Response:**
```json
{
  "position_id": "pos_1_1771215038",
  "user": "0x1234567890abcdef",
  "pair": "USDC/ETH",
  "amount": 10000.0,
  "fee_tier": 500,
  "current_apy": 3.5,
  "status": "rebalanced",
  "rebalance_count": 1,
  "total_fees_earned": 25.50,
  "created_at": "2024-12-17T...",
  "audit_history_entries": 2,
  "audit_decisions": [
    {
      "decision_id": "dec_1_1771215038",
      "type": "position_created",
      "timestamp": "2024-12-17T...",
      "reason": "Created USDC/ETH position"
    },
    {
      "decision_id": "dec_2_1771215038",
      "type": "rebalance_triggered",
      "timestamp": "2024-12-17T...",
      "reason": "Fee tier spread: 2500 bps (threshold: 50 bps)"
    }
  ]
}
```
**What it does:**
- ✅ Returns complete position data
- ✅ Returns full audit history (every decision made)
- ✅ Shows what triggered each decision
- ✅ Shows when each decision was made

---

### 4. Execute Transfer
**When:** User executes confidential transfer
**Endpoint:** `POST /orchestrated/transfer`
**Request:**
```json
{
  "from_address": "0x1234567890...",
  "to_address": "0x5678901234...",
  "amount_hidden": true
}
```
**Response:**
```json
{
  "transfer_id": "xfer_1771215038",
  "status": "executed",
  "audit_entry_id": "dec_3_1771215038",
  "amount_hidden": true,
  "from": "0x1234...",
  "to": "0x5678...",
  "model_version": 0,
  "audit_recorded": true
}
```
**What it does:**
- ✅ Executes transfer
- ✅ Automatically records to audit trail
- ✅ Links to model version
- ✅ Returns confirmation with audit ID

---

### 5. Get Dashboard Data
**When:** Dashboard component loads or refreshes
**Endpoint:** `GET /orchestrated/dashboard`
**Response:**
```json
{
  "positions_tracked": 3,
  "total_decisions_recorded": 7,
  "verified_decisions": 7,
  "rebalances_triggered": 2,
  "total_fees_earned": 150.25,
  "average_apy": 4.2,
  "compliance_status": "5/5 zkML verified",
  "decision_types": {
    "position_created": 3,
    "rebalance_triggered": 2,
    "transfer_executed": 2
  },
  "positions": [
    {
      "position_id": "pos_1_1771215038",
      "pair": "USDC/ETH",
      "apy": 3.5,
      "status": "rebalanced",
      "rebalances": 1
    },
    {
      "position_id": "pos_2_1771215039",
      "pair": "USDC/USDT",
      "apy": 4.1,
      "status": "active",
      "rebalances": 0
    },
    {
      "position_id": "pos_3_1771215040",
      "pair": "USDC/DAI",
      "apy": 3.9,
      "status": "rebalanced",
      "rebalances": 1
    }
  ],
  "recent_decisions": [
    {
      "decision_id": "dec_7_1771215039",
      "type": "transfer_executed",
      "timestamp": "2024-12-17T14:35:22Z",
      "reason": "User initiated confidential transfer"
    },
    {
      "decision_id": "dec_6_1771215038",
      "type": "rebalance_triggered",
      "timestamp": "2024-12-17T14:30:15Z",
      "reason": "Fee tier spread: 2500 bps"
    }
  ]
}
```
**What it does:**
- ✅ Returns ALL system metrics
- ✅ Returns all positions being tracked
- ✅ Returns recent decisions
- ✅ Returns compliance status
- ✅ Dashboard displays real system state (not dummy data)

---

## Frontend Component Updates

### MVPProofGatedLP.tsx
**Change from:** Calling contract directly
**Change to:** Call orchestrator endpoint
```typescript
async function handleCreatePosition(data) {
  const response = await fetch('/api/phase4a/orchestrated/position/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_address: userAddress,
      token_a: data.tokenA,
      token_b: data.tokenB,
      amount: parseFloat(data.amount),
      fee_tier: parseInt(data.feeTier),
      tx_hash: txHash
    })
  });
  const result = await response.json();
  console.log('Position created and logged:', result.position_id);
  // Show success with audit confirmation
  showNotification(`Position created! Audit trail entry: ${result.audit_recorded}`);
}
```

### MVPzkML5Dashboard.tsx
**Change from:** Empty audit trail display
**Change to:** Call orchestrator endpoint
```typescript
async function loadDashboardData() {
  const response = await fetch('/api/phase4a/orchestrated/dashboard');
  const dashboard = await response.json();
  
  setState({
    positionsTracked: dashboard.positions_tracked,
    decisionsRecorded: dashboard.total_decisions_recorded,
    positions: dashboard.positions,
    recentDecisions: dashboard.recent_decisions,
    complianceStatus: dashboard.compliance_status
  });
}
```

### MVPRebalancerWidget.tsx
**Change from:** Display static config
**Change to:** Show real dashboard data
```typescript
function RebalancerWidget() {
  const [dashboard, setDashboard] = useState(null);
  
  useEffect(() => {
    fetch('/api/phase4a/orchestrated/dashboard')
      .then(r => r.json())
      .then(d => setDashboard(d));
  }, []);
  
  return (
    <div>
      <h3>System Status</h3>
      <p>Positions Tracked: {dashboard?.positions_tracked || 0}</p>
      <p>Rebalances Triggered: {dashboard?.rebalances_triggered || 0}</p>
      <p>Average APY: {dashboard?.average_apy?.toFixed(2)}%</p>
    </div>
  );
}
```

---

## Example Flow: Complete User Journey

### 1. User Creates Position
```
User clicks "Create Position"
  ↓
Frontend form captures: USDC/ETH, amount 10000, fee tier 3000
  ↓
Frontend calls: POST /orchestrated/position/create
  ↓
Backend orchestrator:
  - Creates position
  - Records to audit trail with model hash
  - Verifies with tx_hash
  - Returns position_id
  ↓
Frontend: Shows "Position created! Audit trail recorded ✓"
Dashboard: Now shows new position
```

### 2. System Monitors Position
```
Backend background process (or API call):
  Fetches position current_apy from pool
  Fetches optimal_apy and optimal_fee_tier from data source
  Fetches pool_utilization
  ↓
Frontend calls (or scheduler calls): POST /orchestrated/position/evaluate
  ↓
Backend orchestrator:
  - Evaluates with rebalancer logic
  - current_apy: 3.5% vs optimal_apy: 5.2% → SHOULD REBALANCE
  - Automatically records decision to audit trail
  - Returns should_rebalance: true with reason
  ↓
Frontend: Shows "Rebalance triggered! Fee tier optimization available"
Dashboard: Shows rebalance_count: 1, new decision in recent_decisions
```

### 3. User Checks Audit History
```
User clicks "View Details" on position
  ↓
Frontend calls: GET /orchestrated/position/pos_1_1771215038
  ↓
Backend returns:
  - Position data (current APY, status, fee tier, etc.)
  - audit_decisions array with:
    - Decision 1: position_created at 14:20:15
    - Decision 2: rebalance_triggered at 14:30:22
  ↓
Frontend displays audit history showing every decision
User can see complete history of what happened to their position
```

### 4. Dashboard Shows Everything
```
Frontend loads dashboard
  ↓
Calls: GET /orchestrated/dashboard
  ↓
Backend returns aggregated data:
  - 3 positions being tracked
  - 7 total decisions recorded
  - 2 rebalances triggered
  - Recent decisions: transfer, rebalance, position created
  ↓
Dashboard displays:
  - Live position list
  - Live decision count
  - Live rebalance count
  - Recent activity feed
  ↓
Everything shows REAL system state (not dummy data)
```

---

## Error Handling

### Position Not Found
**Response:**
```json
{
  "error": "Position not found"
}
```
**Handle:** Show user message "Position not found"

### Invalid Request
**Response:** HTTP 400
```json
{
  "detail": "Invalid request data"
}
```
**Handle:** Show form validation error

### Server Error
**Response:** HTTP 500
```json
{
  "detail": "Error message"
}
```
**Handle:** Show "System error, please try again"

---

## Testing Your Integration

### Test 1: Create Position
```bash
curl -X POST http://localhost:8000/api/phase4a/orchestrated/position/create \
  -H "Content-Type: application/json" \
  -d '{
    "user_address": "0x1234567890abcdef",
    "token_a": "USDC",
    "token_b": "ETH",
    "amount": 10000.0,
    "fee_tier": 3000,
    "tx_hash": "0xaabbcc"
  }'
```
**Expected:** position_id, audit_recorded: true

### Test 2: Evaluate Position
```bash
curl -X POST http://localhost:8000/api/phase4a/orchestrated/position/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "position_id": "pos_1_...",
    "current_apy": 3.5,
    "optimal_apy": 5.2,
    "optimal_fee_tier": 500,
    "pool_utilization": 0.78
  }'
```
**Expected:** should_rebalance: true, audit_recorded: true

### Test 3: Get Dashboard
```bash
curl http://localhost:8000/api/phase4a/orchestrated/dashboard
```
**Expected:** positions_tracked > 0, total_decisions_recorded > 0

---

## Key Points

✅ **Single call does everything** - No need to call multiple endpoints
✅ **Audit trail automatic** - No need to manually record decisions
✅ **Model versioning automatic** - Every decision linked to model version
✅ **Dashboard shows reality** - Real data, not dummy data
✅ **Complete traceability** - Every decision has reason + timestamp + audit ID

---

## Support

For issues or questions:
1. Check response `error` or `detail` field
2. Verify request JSON format matches examples
3. Check backend logs for detailed error messages
4. Run E2E tests: `python3 -m pytest test_e2e_orchestrated.py -v`
