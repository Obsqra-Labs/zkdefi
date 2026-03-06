# Oracle Execution

Execute capital allocations directly from Oracle recommendations with one click.

## Overview

The **Oracle** provides personalized strategy recommendations based on:
- AI-driven allocation planning
- zkML risk scoring (5-factor evaluation)
- Strategy intelligence ranking
- User risk profile

**New:** Click "Approve" to execute recommendations instantly.

## Flow

```
1. User views Oracle → Signals tab
2. Sees personalized recommendations (e.g., "Allocate 40% to STRK/ETH")
3. Clicks "Approve" button
4. System:
   a. Calls /api/v1/strategies/allocate (AI allocation plan)
   b. Calls /api/v1/vault/execute (deploy to Ekubo LP)
   c. Generates execution proof
   d. Creates receipt with proof hash
5. User sees: deployment_id, positions, APY, proof
6. Capital is now deployed and monitored
```

## API Endpoints

### 1. Get Recommendations

**GET** `/api/v1/strategies/recommendations`

**Query params:**
- `user_profile` - Risk profile (BALANCED, CONSERVATIVE, AGGRESSIVE)
- `limit` - Max recommendations (default 3)

**Response:**
```json
{
  "recommendations": [
    {
      "label": "Allocate 40% to STRK/ETH",
      "strategy_name": "STRK/ETH",
      "strategy_id": "strategy_abc123",
      "allocation_pct": 40,
      "reasoning": "High genome composite (85.2), high confidence",
      "confidence": "high",
      "genome_composite": 85.2
    }
  ]
}
```

### 2. Execute Allocation

**POST** `/api/v1/vault/execute`

**Body:**
```json
{
  "user_address": "0x123...",
  "risk_profile": "balanced",
  "deposit_amount": 100,
  "allocations": [
    {
      "strategy": "ekubo_lp",
      "percentage": 40,
      "amount": 40,
      "pool_id": "0xabc...",
      "pool_name": "STRK/ETH"
    }
  ]
}
```

**Response:**
```json
{
  "deployment_id": "deploy_abc123",
  "positions": [
    {
      "strategy": "ekubo_lp",
      "pool_id": "0xabc...",
      "amount": 40,
      "tx_hash": "0xdef...",
      "status": "deployed",
      "expected_apy": 22.5
    }
  ],
  "total_expected_apy": 22.5,
  "zkml_proof_hash": "0x789..."
}
```

## Frontend Integration

**OracleSignalsTab.tsx:**
```typescript
const handleApprove = async (rec: OracleRecommendation) => {
  // Step 1: Get allocation plan
  const allocRes = await fetch('/api/v1/strategies/allocate', {
    method: 'POST',
    body: JSON.stringify({
      user_address: address,
      risk_profile: 'balanced',
      deposit_amount: 100,
    })
  });
  const allocData = await allocRes.json();

  // Step 2: Execute allocation
  const execRes = await fetch('/api/v1/vault/execute', {
    method: 'POST',
    body: JSON.stringify({
      user_address: address,
      allocations: allocData.allocations
    })
  });
  const execData = await execRes.json();
  
  alert(`Deployed! ID: ${execData.deployment_id}`);
};
```

## Proof Generation

Every execution generates a **zkML proof** of the allocation decision:

1. **Deposit proof:** Validates user deposit constraints
2. **Risk proof:** Verifies risk assessment computation
3. **Execution proof:** Records allocation decision deterministically

Proofs are stored in receipts and can be verified on-chain.

## Monitoring

After execution, positions are monitored automatically by **position_monitor.py**:

- **Out of range:** LP position price outside bounds
- **High IL:** Impermanent loss exceeds threshold
- **APY drop:** Realized APY << expected
- **Low liquidity:** Pool TVL drains below safe minimum

Alerts are sent via WebSocket in real-time.

## Testing

**1. Navigate to Oracle:**
```
Frontend → Oracle tab → Signals
```

**2. View recommendations:**
- Should see 1-3 personalized recommendations
- Each with strategy name, allocation %, reasoning

**3. Click Approve:**
- Confirm in modal
- Wait ~5-10s for execution
- See success alert with deployment details

**4. Verify:**
```bash
# Check receipt was created
curl http://localhost:8000/api/v1/zkdefi/ledger/receipts?user_address=0x123

# Check position in ledger
curl http://localhost:8000/api/v1/vault/positions/0x123
```

## Withdrawal

**Coming soon:** Withdrawal UI in Vault tab.

**API available now:**
```bash
POST /api/v1/vault/withdraw
{
  "user_address": "0x123...",
  "amount": 50,
  "destination": "0x456..." # optional
}
```

Returns `withdrawal_id`, `tx_hash`, `receipt_id`, `zkml_proof_hash`.
