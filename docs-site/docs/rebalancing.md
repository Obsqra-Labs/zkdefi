# Autonomous Rebalancing

zkde.fi's agent can autonomously rebalance your portfolio, gated by zkML proofs.

## Overview

The rebalancing flow:
1. Agent analyzes portfolio
2. Agent proposes rebalance
3. zkML models check (risk + anomaly)
4. Execution proofs generated
5. Combined verification on-chain
6. Execute

## zkML Gating

Both models must pass for rebalancing to proceed:

| Model | Check | Failure Action |
|-------|-------|----------------|
| Risk Score | `risk_score <= threshold` | Block: "Risk too high" |
| Anomaly Detector | `anomaly_flag == 0` | Block: "Pool anomaly" |

## API Flow

### 1. Propose Rebalance

```bash
POST /api/v1/zkdefi/rebalancer/propose
```

```json
{
  "user_address": "0x...",
  "from_protocol": 0,
  "to_protocol": 1,
  "amount": 1000,
  "reason": "Risk optimization"
}
```

### 2. Run zkML Checks

```bash
POST /api/v1/zkdefi/rebalancer/check
```

```json
{
  "proposal_id": "abc123",
  "portfolio_features": [50, 30, 20, 20, 50, 30, 10, 20],
  "pool_id": "pool_1"
}
```

**Response:**
```json
{
  "can_proceed": true,
  "risk_passed": true,
  "anomaly_passed": true,
  "risk_proof": { ... },
  "anomaly_proof": { ... }
}
```

### 3. Prepare Execution

```bash
POST /api/v1/zkdefi/rebalancer/prepare
```

```json
{
  "proposal_id": "abc123",
  "session_id": "0x..."
}
```

### 4. Execute

```bash
POST /api/v1/zkdefi/rebalancer/execute
```

```json
{
  "proposal_id": "abc123",
  "session_id": "0x..."
}
```

## On-Chain Execution

The contract verifies:
1. zkML proofs via Garaga
2. Execution proof via Integrity
3. Intent commitment (replay-safety)
4. Session key constraints

```cairo
fn execute_with_proofs(
    protocol_id: u8,
    amount: u256,
    action_type: felt252,
    zkml_proof_calldata: Span<felt252>,
    execution_proof_hash: felt252,
    intent_commitment: felt252
)
```

## Frontend Component

```tsx
import { AgentRebalancer } from "@/components/zkdefi/AgentRebalancer";

<AgentRebalancer 
  userAddress={address}
  sessionId={activeSessionId}
  positions={positions}
/>
```

## Privacy Guarantees

During rebalancing:
- Intent hidden until execution
- Actual risk score private
- Pool analysis private
- Only compliance visible on-chain
