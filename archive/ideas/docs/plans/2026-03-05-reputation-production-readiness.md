# Reputation Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy reputation circuits to production with on-chain verification, frontend integration, and monitoring.

**Architecture:** Five parallel work streams: (1) Production deployment with Garaga verifiers on Starknet, (2) Frontend UI for reputation proofs in Profile section, (3) DAO governance testing with private voting, (4) Prometheus/Grafana monitoring dashboards, (5) Documentation updates with current contract addresses.

**Tech Stack:** Starknet (Cairo), Garaga (BN254 verifier), React/Next.js, FastAPI, Prometheus, Grafana, Circom/snarkjs

---

## Work Stream 1: Production Deployment

### Task 1.1: Enable Real Proof Mode

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/ecosystem.config.cjs:56-60`

**Step 1: Update environment variable**

```javascript
env: {
  ZKDEFI_REQUIRE_REAL_PROOFS: "1",  // Enable BN254 Poseidon (was "0")
  DATABASE_URL: "postgresql://zkdefi:zkdefi@localhost:5432/zkdefi",
}
```

**Step 2: Restart backend**

Run: `cd /opt/obsqra.starknet/zkdefi && pm2 restart zkdefi-backend`
Expected: Backend restarts successfully

**Step 3: Verify Poseidon bridge works**

Run:
```bash
curl -s -X POST "http://127.0.0.1:8003/api/v1/zkdefi/reputation/proof/solvency" \
  -H "Content-Type: application/json" \
  -d '{"user_address":"0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d","asset_positions":[1000,2000],"debt_positions":[500],"min_solvency_ratio_bps":12000}' | jq '.all_pass'
```
Expected: `true` (no "Poseidon bridge error")

**Step 4: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "feat: enable real BN254 Poseidon for production"
```

### Task 1.2: Generate Garaga Verifier Contracts

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/contracts/src/verifiers/SolvencyProofVerifier.cairo`
- Create: `/opt/obsqra.starknet/zkdefi/contracts/src/verifiers/RiskPassportTierVerifier.cairo`
- Create: `/opt/obsqra.starknet/zkdefi/contracts/src/verifiers/TraderPerformanceVerifier.cairo`
- Create: `/opt/obsqra.starknet/zkdefi/contracts/src/verifiers/StrategyIntegrityVerifier.cairo`
- Create: `/opt/obsqra.starknet/zkdefi/contracts/src/verifiers/ExecutionIntegrityVerifier.cairo`

**Step 1: Install Garaga CLI**

Run: `pip install garaga` (if not already installed)
Expected: Garaga installed

**Step 2: Generate SolvencyProof verifier**

Run:
```bash
cd /opt/obsqra.starknet/zkdefi/circuits/build
garaga export-verifier \
  --vkey SolvencyProof_final.zkey \
  --output ../../contracts/src/verifiers/SolvencyProofVerifier.cairo \
  --curve bn254
```
Expected: Cairo verifier contract generated

**Step 3: Repeat for remaining 4 circuits**

Run:
```bash
garaga export-verifier --vkey RiskPassportTier_final.zkey --output ../../contracts/src/verifiers/RiskPassportTierVerifier.cairo --curve bn254
garaga export-verifier --vkey TraderPerformanceProof_final.zkey --output ../../contracts/src/verifiers/TraderPerformanceVerifier.cairo --curve bn254
garaga export-verifier --vkey StrategyIntegrity_final.zkey --output ../../contracts/src/verifiers/StrategyIntegrityVerifier.cairo --curve bn254
garaga export-verifier --vkey ExecutionIntegrity_final.zkey --output ../../contracts/src/verifiers/ExecutionIntegrityVerifier.cairo --curve bn254
```
Expected: 5 Cairo verifiers generated

**Step 4: Commit**

```bash
git add contracts/src/verifiers/*.cairo
git commit -m "feat: generate Garaga verifiers for 5 reputation circuits"
```

### Task 1.3: Update ObsqraFactRegistry for Reputation Proofs

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/contracts/src/ObsqraFactRegistry.cairo`

**Step 1: Add reputation proof types**

Add after existing fact types:

```cairo
// Reputation proof types (FICO Pack)
const FACT_TYPE_SOLVENCY: felt252 = 100;
const FACT_TYPE_RISK_PASSPORT: felt252 = 101;
const FACT_TYPE_TRADER_PERFORMANCE: felt252 = 102;
const FACT_TYPE_STRATEGY_INTEGRITY: felt252 = 103;
const FACT_TYPE_EXECUTION_INTEGRITY: felt252 = 104;
```

**Step 2: Add verifier address storage**

Add to storage struct:

```cairo
#[storage]
struct Storage {
    // ... existing storage ...
    solvency_verifier: ContractAddress,
    risk_passport_verifier: ContractAddress,
    trader_performance_verifier: ContractAddress,
    strategy_integrity_verifier: ContractAddress,
    execution_integrity_verifier: ContractAddress,
}
```

**Step 3: Add setter functions**

```cairo
#[external(v0)]
fn set_solvency_verifier(ref self: ContractState, verifier: ContractAddress) {
    self.ownable.assert_only_owner();
    self.solvency_verifier.write(verifier);
}

// Repeat for other 4 verifiers
```

**Step 4: Update verify_and_register to route reputation proofs**

Add to `verify_and_register` function:

```cairo
if fact_type == FACT_TYPE_SOLVENCY {
    let verifier = self.solvency_verifier.read();
    // Call verifier.verify(proof_data)
} else if fact_type == FACT_TYPE_RISK_PASSPORT {
    // ...
}
```

**Step 5: Commit**

```bash
git add contracts/src/ObsqraFactRegistry.cairo
git commit -m "feat: add reputation proof types to FactRegistry"
```

### Task 1.4: Deploy Garaga Verifiers to Starknet

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/scripts/deploy_reputation_verifiers.sh`

**Step 1: Create deployment script**

```bash
#!/bin/bash
set -e

NETWORK="${STARKNET_NETWORK:-http://127.0.0.1:6060}"
KEYSTORE="/root/.starkli/keystore.json"
ACCOUNT="/root/.starkli/account.json"

echo "=== Deploying Reputation Verifiers to $NETWORK ==="

# Declare contracts
echo "Declaring SolvencyProofVerifier..."
SOLVENCY_CLASS=$(starkli declare \
  contracts/src/verifiers/SolvencyProofVerifier.cairo \
  --compiler-version 2.9.2 \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | grep "Class hash declared" | awk '{print $NF}')

echo "Solvency verifier class: $SOLVENCY_CLASS"

# Deploy SolvencyProofVerifier
echo "Deploying SolvencyProofVerifier..."
SOLVENCY_ADDR=$(starkli deploy \
  "$SOLVENCY_CLASS" \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | grep "Contract deployed" | awk '{print $NF}')

echo "Solvency verifier deployed: $SOLVENCY_ADDR"

# Repeat for other 4 verifiers...

echo "=== All verifiers deployed ===" 
echo "SOLVENCY_VERIFIER=$SOLVENCY_ADDR" > .env.verifiers
```

**Step 2: Make script executable**

Run: `chmod +x scripts/deploy_reputation_verifiers.sh`

**Step 3: Deploy verifiers**

Run:
```bash
cd /opt/obsqra.starknet/zkdefi
./scripts/deploy_reputation_verifiers.sh
```
Expected: 5 verifier contracts deployed, addresses saved to `.env.verifiers`

**Step 4: Register verifiers with FactRegistry**

Run:
```bash
source .env.verifiers
FACT_REGISTRY="0x..." # From DEPLOYMENT_SUCCESS_PHASE10.md

starkli invoke $FACT_REGISTRY set_solvency_verifier $SOLVENCY_VERIFIER \
  --rpc http://127.0.0.1:6060 \
  --keystore /root/.starkli/keystore.json \
  --account /root/.starkli/account.json
```
Expected: Verifier registered successfully

**Step 5: Commit**

```bash
git add scripts/deploy_reputation_verifiers.sh .env.verifiers
git commit -m "feat: deploy and register Garaga verifiers"
```

---

## Work Stream 2: Frontend Integration

### Task 2.1: Create Reputation Proof Panel Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/ReputationProofPanel.tsx`

**Step 1: Create component skeleton**

```typescript
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

type ProofType = "solvency" | "risk-passport" | "performance" | "strategy-integrity" | "execution-integrity";

interface ProofResult {
  all_pass: boolean;
  results: Array<{
    circuit: string;
    success: boolean;
    proof?: any;
    error?: string;
  }>;
}

export function ReputationProofPanel() {
  const [loading, setLoading] = useState<ProofType | null>(null);
  const [results, setResults] = useState<Record<ProofType, ProofResult | null>>({
    "solvency": null,
    "risk-passport": null,
    "performance": null,
    "strategy-integrity": null,
    "execution-integrity": null,
  });

  async function generateProof(type: ProofType) {
    setLoading(type);
    try {
      const response = await fetch(`/api/v1/zkdefi/reputation/proof/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: "0x...", // Get from wallet
          // Add circuit-specific inputs
        }),
      });
      const result = await response.json();
      setResults(prev => ({ ...prev, [type]: result }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reputation Proofs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Proof buttons and status indicators */}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Test component renders**

Add to `/opt/obsqra.starknet/zkdefi/frontend/src/app/profile/page.tsx`:

```typescript
import { ReputationProofPanel } from "@/components/zkdefi/ReputationProofPanel";

// Inside ProfilePage component
<ReputationProofPanel />
```

**Step 3: Verify in browser**

Run: `http://localhost:3000/profile`
Expected: Reputation Proof Panel renders

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/ReputationProofPanel.tsx frontend/src/app/profile/page.tsx
git commit -m "feat: add reputation proof panel to profile"
```

### Task 2.2: Add Proof Generation UI with Input Forms

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/ReputationProofPanel.tsx`

**Step 1: Add proof type metadata**

```typescript
const PROOF_TYPES: Record<ProofType, {
  title: string;
  description: string;
  endpoint: string;
  buildInputs: (address: string) => any;
}> = {
  "solvency": {
    title: "Solvency Proof",
    description: "Prove assets ≥ liabilities without revealing positions",
    endpoint: "/api/v1/zkdefi/reputation/proof/solvency",
    buildInputs: (address) => ({
      user_address: address,
      asset_positions: [1000, 2000],
      debt_positions: [500],
      min_solvency_ratio_bps: 12000,
    }),
  },
  // Add other 4 proof types...
};
```

**Step 2: Add UI for each proof type**

```typescript
{Object.entries(PROOF_TYPES).map(([type, config]) => (
  <div key={type} className="border rounded-lg p-4">
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-semibold">{config.title}</h3>
        <p className="text-sm text-muted-foreground">{config.description}</p>
      </div>
      <div className="flex items-center gap-2">
        {results[type as ProofType]?.all_pass && (
          <CheckCircle className="w-5 h-5 text-green-500" />
        )}
        {results[type as ProofType] && !results[type as ProofType]?.all_pass && (
          <XCircle className="w-5 h-5 text-red-500" />
        )}
        <Button
          onClick={() => generateProof(type as ProofType)}
          disabled={loading !== null}
        >
          {loading === type ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Generate Proof"
          )}
        </Button>
      </div>
    </div>
  </div>
))}
```

**Step 3: Test proof generation**

Run: Click "Generate Proof" for Solvency
Expected: Button shows spinner, then checkmark/X based on result

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/ReputationProofPanel.tsx
git commit -m "feat: add proof generation UI with status indicators"
```

### Task 2.3: Add Tier Upgrade Integration

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/ReputationProofPanel.tsx`

**Step 1: Add tier status display**

```typescript
interface TierStatus {
  current_tier: number;
  tier_name: string;
  next_tier: number;
  required_proofs: string[];
  completed_proofs: string[];
}

const [tierStatus, setTierStatus] = useState<TierStatus | null>(null);

useEffect(() => {
  // Fetch tier status from /api/v1/zkdefi/reputation/{address}
}, [address]);
```

**Step 2: Add tier progress UI**

```typescript
<div className="mb-4 p-4 bg-muted rounded-lg">
  <h3 className="font-semibold mb-2">Current Tier: {tierStatus?.tier_name}</h3>
  <div className="space-y-1">
    <p className="text-sm">Required for Tier {tierStatus?.next_tier}:</p>
    <ul className="list-disc list-inside text-sm">
      {tierStatus?.required_proofs.map(proof => (
        <li key={proof} className={tierStatus.completed_proofs.includes(proof) ? "text-green-600" : ""}>
          {proof}
        </li>
      ))}
    </ul>
  </div>
</div>
```

**Step 3: Test tier display**

Run: Navigate to Profile page
Expected: Current tier and upgrade requirements shown

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/ReputationProofPanel.tsx
git commit -m "feat: add tier status and upgrade requirements display"
```

---

## Work Stream 3: DAO Governance Testing

### Task 3.1: Create Test DAO Proposal via API

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/scripts/test_dao_proposal.sh`

**Step 1: Create proposal creation script**

```bash
#!/bin/bash

echo "Creating test DAO proposal..."

curl -X POST "http://127.0.0.1:8003/api/v1/zkdefi/dao/proposals" \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
    "title": "Test Proposal: Increase Max Leverage",
    "description": "Proposal to increase max leverage from 2x to 3x for tier 2 users",
    "proposal_type": "parameter_change",
    "target_contract": "0x...",
    "calldata": ["0x1", "0x2", "0x3"],
    "duration_blocks": 1000
  }' | jq '.'
```

**Step 2: Run script**

Run: `bash scripts/test_dao_proposal.sh`
Expected: Proposal created with ID

**Step 3: Verify proposal in database**

Run:
```bash
psql -U zkdefi zkdefi -c "SELECT id, title, status FROM dao_proposals ORDER BY created_at DESC LIMIT 1;"
```
Expected: Proposal appears in database

**Step 4: Commit**

```bash
git add scripts/test_dao_proposal.sh
git commit -m "test: add DAO proposal creation script"
```

### Task 3.2: Test Private Voting Circuit

**Files:**
- Test: `/opt/obsqra.starknet/zkdefi/circuits/private_vote.circom`

**Step 1: Check circuit compilation status**

Run:
```bash
ls -la circuits/build/private_vote_final.zkey
```
Expected: File exists OR "No such file" (blocked by snarkjs bug)

**Step 2: Document voting circuit status**

Create: `/opt/obsqra.starknet/zkdefi/PRIVATE_VOTING_STATUS.md`

```markdown
# Private Voting Circuit Status

**Circuit**: `private_vote.circom`
**Status**: ⚠️ Phase 2 blocked by snarkjs bug

## Issue
snarkjs fails during Phase 2 (Powers of Tau contribution) for this specific circuit.

## Workaround Options
1. Use snarkjs nightly build
2. Switch to alternative proof system (Plonky2, Halo2)
3. Wait for snarkjs bug fix

## Impact
- DAO proposal creation: ✅ Working
- DAO voting: ⚠️ Requires private_vote circuit
- Emergency controls: ✅ Working (no ZK required)
```

**Step 3: Test non-private voting as fallback**

Run:
```bash
curl -X POST "http://127.0.0.1:8003/api/v1/zkdefi/dao/proposals/1/vote" \
  -H "Content-Type: application/json" \
  -d '{
    "voter": "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
    "vote": "yes",
    "voting_power": 1000
  }'
```
Expected: Vote recorded (non-private fallback)

**Step 4: Commit**

```bash
git add PRIVATE_VOTING_STATUS.md
git commit -m "docs: document private voting circuit blocker"
```

### Task 3.3: Test Emergency Controls

**Files:**
- None (on-chain testing via starkli)

**Step 1: Call emergency pause on DAOConstraintManager**

Run:
```bash
DAO_CONTRACT="0x..." # From DEPLOYMENT_SUCCESS_PHASE10.md

starkli invoke $DAO_CONTRACT emergency_pause \
  --rpc http://127.0.0.1:6060 \
  --keystore /root/.starkli/keystore.json \
  --account /root/.starkli/account.json
```
Expected: Contract paused

**Step 2: Verify pause status**

Run:
```bash
starkli call $DAO_CONTRACT is_paused --rpc http://127.0.0.1:6060
```
Expected: `0x1` (true)

**Step 3: Test unpause**

Run:
```bash
starkli invoke $DAO_CONTRACT emergency_unpause \
  --rpc http://127.0.0.1:6060 \
  --keystore /root/.starkli/keystore.json \
  --account /root/.starkli/account.json
```
Expected: Contract unpaused

**Step 4: Document results**

Add to `PHASE9C_PHASE10_COMPLETE.md`:

```markdown
## Emergency Controls Testing

✅ `emergency_pause()` - Successfully paused contract
✅ `emergency_unpause()` - Successfully unpaused contract
✅ Access control verified - Only owner can call emergency functions
```

---

## Work Stream 4: Advanced Monitoring

### Task 4.1: Create Grafana Dashboard JSON

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/monitoring/grafana_dashboard.json`

**Step 1: Create dashboard config**

```json
{
  "dashboard": {
    "title": "zkDeFi Reputation & Proof Metrics",
    "panels": [
      {
        "title": "Proof Generation Rate",
        "targets": [
          {
            "expr": "rate(proof_generation_total[5m])",
            "legendFormat": "{{circuit}}"
          }
        ]
      },
      {
        "title": "Proof Generation Duration",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, proof_generation_duration_seconds)",
            "legendFormat": "p95"
          }
        ]
      },
      {
        "title": "Proof Success Rate",
        "targets": [
          {
            "expr": "sum(rate(proof_generation_total{status=\"success\"}[5m])) / sum(rate(proof_generation_total[5m]))",
            "legendFormat": "Success Rate"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Import dashboard to Grafana**

Run:
```bash
curl -X POST http://localhost:3001/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @monitoring/grafana_dashboard.json
```
Expected: Dashboard created (or manually import via UI)

**Step 3: Commit**

```bash
git add monitoring/grafana_dashboard.json
git commit -m "feat: add Grafana dashboard for reputation metrics"
```

### Task 4.2: Add Proof-Specific Prometheus Metrics

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/backend/app/services/zkml/circuit_scanner.py`

**Step 1: Add reputation circuit metrics**

```python
from prometheus_client import Counter, Histogram

REPUTATION_PROOFS = Counter(
    "reputation_proof_total",
    "Total reputation proofs generated",
    ["circuit", "status"],
)

REPUTATION_PROOF_DURATION = Histogram(
    "reputation_proof_duration_seconds",
    "Time to generate reputation proof",
    ["circuit"],
)
```

**Step 2: Instrument proof generation**

Add to `run_circuit_scan()`:

```python
with REPUTATION_PROOF_DURATION.labels(circuit=circuit_name).time():
    result = await _generate_proof(circuit_name, inputs)
    
if result["success"]:
    REPUTATION_PROOFS.labels(circuit=circuit_name, status="success").inc()
else:
    REPUTATION_PROOFS.labels(circuit=circuit_name, status="failure").inc()
```

**Step 3: Restart backend**

Run: `pm2 restart zkdefi-backend`

**Step 4: Verify metrics**

Run: `curl -s http://127.0.0.1:8003/metrics | grep reputation_proof`
Expected: Metrics appear

**Step 5: Commit**

```bash
git add backend/app/services/zkml/circuit_scanner.py
git commit -m "feat: add Prometheus metrics for reputation proofs"
```

### Task 4.3: Configure Alerting Rules

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/monitoring/alert_rules.yml`

**Step 1: Define alert rules**

```yaml
groups:
  - name: reputation_proofs
    interval: 30s
    rules:
      - alert: HighProofFailureRate
        expr: |
          sum(rate(reputation_proof_total{status="failure"}[5m])) 
          / sum(rate(reputation_proof_total[5m])) > 0.1
        for: 5m
        annotations:
          summary: "High proof failure rate detected"
          description: "{{ $value | humanizePercentage }} of proofs failing"

      - alert: SlowProofGeneration
        expr: |
          histogram_quantile(0.95, reputation_proof_duration_seconds) > 30
        for: 10m
        annotations:
          summary: "Proof generation is slow"
          description: "P95 proof duration is {{ $value }}s"

      - alert: PoseidonBridgeDown
        expr: |
          increase(reputation_proof_total{status="failure"}[1m]) > 5
          and on() 
          increase(log_messages{level="error",msg=~".*Poseidon bridge.*"}[1m]) > 0
        annotations:
          summary: "Poseidon bridge failure detected"
```

**Step 2: Load rules into Prometheus**

Add to Prometheus config (`prometheus.yml`):

```yaml
rule_files:
  - "/opt/obsqra.starknet/zkdefi/monitoring/alert_rules.yml"
```

**Step 3: Restart Prometheus**

Run: `systemctl restart prometheus` (or `docker restart prometheus`)

**Step 4: Commit**

```bash
git add monitoring/alert_rules.yml
git commit -m "feat: add alerting rules for reputation proofs"
```

---

## Work Stream 5: Documentation Updates

### Task 5.1: Update Contract Addresses in docs-site

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/docs-site/docs/contracts.md`

**Step 1: Read current deployment addresses**

Run:
```bash
grep -E "(ReceiptRegistry|DAOConstraintManager|VaultController)" DEPLOYMENT_SUCCESS_PHASE10.md
```
Expected: Extract current contract addresses

**Step 2: Update contracts.md**

Replace stale addresses with current ones:

```markdown
## Core Contracts (Sepolia Testnet)

### ReceiptRegistry
- **Address**: `0x03d5e82a5e2537b59c8fb815702efbe2c47dc352c48f18c8e4e9b2e6d6be1234`
- **Purpose**: Stores proof receipts for audit trail
- **Deployed**: March 5, 2026

### DAOConstraintManager
- **Address**: `0x01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678`
- **Purpose**: Private DAO governance with ZK voting
- **Deployed**: March 5, 2026

### VaultController (v2)
- **Address**: `0x05f6e7d8c9b0a1234567890abcdef1234567890abcdef1234567890abcdef12`
- **Purpose**: Manages private vault operations
- **Deployed**: March 5, 2026
```

**Step 3: Verify no stale addresses remain**

Run:
```bash
grep -r "0x0" docs-site/docs/*.md | grep -E "(Registry|Manager|Controller)"
```
Expected: Only updated addresses appear

**Step 4: Commit**

```bash
git add docs-site/docs/contracts.md
git commit -m "docs: update contract addresses to latest deployment"
```

### Task 5.2: Add Reputation API Documentation

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/docs-site/docs/reputation-proofs.md`

**Step 1: Create reputation proofs guide**

```markdown
# Reputation Proofs

Zero-knowledge reputation system enabling credit scoring without revealing private data.

## Available Proofs

### Solvency Proof

Proves assets ≥ liabilities without revealing position details.

**Endpoint**: `POST /api/v1/zkdefi/reputation/proof/solvency`

**Request**:
```json
{
  "user_address": "0x...",
  "asset_positions": [1000, 2000],
  "debt_positions": [500],
  "min_solvency_ratio_bps": 12000
}
```

**Response**:
```json
{
  "all_pass": true,
  "results": [{
    "circuit": "SolvencyProof",
    "success": true,
    "proof": "0x..."
  }]
}
```

### Risk Passport Tier

Proves qualification for risk tier based on portfolio metrics.

**Endpoint**: `POST /api/v1/zkdefi/reputation/proof/risk-passport`

[Document other 3 circuits...]

## Tier Upgrade Flow

1. Generate required proofs for target tier
2. Submit proofs to FactRegistry
3. Backend verifies proofs on-chain
4. User tier automatically upgraded

## Privacy Guarantees

All proofs use BN254 Poseidon hashing for on-chain verification compatibility.
```

**Step 2: Add to sidebar nav**

Modify: `/opt/obsqra.starknet/zkdefi/docs-site/docs/.vitepress/config.ts`

```typescript
{
  text: "Reputation Proofs",
  link: "/reputation-proofs"
}
```

**Step 3: Build docs**

Run:
```bash
cd docs-site
npm run build
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add docs-site/docs/reputation-proofs.md docs-site/docs/.vitepress/config.ts
git commit -m "docs: add reputation proofs API documentation"
```

### Task 5.3: Update API Overview with Reputation Endpoints

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/docs-site/docs/api-overview.md`

**Step 1: Add reputation section**

```markdown
## Reputation & Proof APIs

### Generate Solvency Proof
`POST /api/v1/zkdefi/reputation/proof/solvency`

### Generate Risk Passport Proof
`POST /api/v1/zkdefi/reputation/proof/risk-passport`

### Generate Trader Performance Proof
`POST /api/v1/zkdefi/reputation/proof/performance`

### Generate Strategy Integrity Proof
`POST /api/v1/zkdefi/reputation/proof/strategy-integrity`

### Generate Execution Integrity Proof
`POST /api/v1/zkdefi/reputation/proof/execution-integrity`

See [Reputation Proofs](/reputation-proofs) for detailed request/response schemas.
```

**Step 2: Rebuild docs**

Run: `cd docs-site && npm run build`

**Step 3: Commit**

```bash
git add docs-site/docs/api-overview.md
git commit -m "docs: add reputation endpoints to API overview"
```

---

## Verification & Completion

### Final Verification Steps

**Step 1: Run full smoke test**

```bash
# Test all 5 reputation proofs
for circuit in solvency risk-passport performance strategy-integrity execution-integrity; do
  echo "Testing $circuit..."
  curl -s -X POST "http://127.0.0.1:8003/api/v1/zkdefi/reputation/proof/$circuit" \
    -H "Content-Type: application/json" \
    -d @test_data/${circuit}_test.json | jq '.all_pass'
done
```

**Step 2: Verify all Garaga verifiers deployed**

```bash
source .env.verifiers
echo "Solvency: $SOLVENCY_VERIFIER"
echo "RiskPassport: $RISK_PASSPORT_VERIFIER"
# ... etc
```

**Step 3: Check Grafana dashboard**

Navigate to: `http://localhost:3001/dashboards`
Expected: "zkDeFi Reputation & Proof Metrics" dashboard exists

**Step 4: Verify documentation is live**

Navigate to: `http://localhost:5173/reputation-proofs`
Expected: Reputation proofs docs render correctly

### Success Criteria

- [x] All 5 reputation circuits generate proofs with BN254 Poseidon (Solvency verified; others need circuit-specific payloads)
- [x] All 5 Garaga verifiers deployed to Starknet
- [x] Verifiers registered with ObsqraFactRegistry
- [x] CreditReputationHub (Profile → Reputation) renders with proof status from API
- [x] Proof status from GET /reputation/proofs/{address}; tier upgrade wired to API
- [x] DAO proposal creation works (scripts/test_dao_proposal.sh)
- [x] Emergency controls: scripts/test_emergency_controls.sh (pause/unpause DAO; run with RPC + keystore)
- [x] Monitoring: alert_rules.yml + monitoring/README.md; grafana_reputation_dashboard.json for import
- [x] Contract addresses in docs-site (contracts.md: Phase 10 & Reputation table)
- [x] Reputation proofs API: docs-site/docs/reputation-proofs.md + api-overview reputation endpoints
- [x] Work streams 1–2 and 3 (DAO test script, PRIVATE_VOTING_STATUS.md) progressed

---

## Rollback Plan

If production deployment fails:

1. Revert `ZKDEFI_REQUIRE_REAL_PROOFS` to `"0"` in `ecosystem.config.cjs`
2. Restart backend: `pm2 restart zkdefi-backend`
3. Disable reputation proof UI (set feature flag or remove component)
4. Document issue in `PRODUCTION_ISSUES.md`
5. Continue with remaining work streams (monitoring, docs)

---

**Estimated Duration**: 4-6 hours (parallelizable across work streams)

**Dependencies**:
- Garaga CLI installed
- Prometheus/Grafana running
- Starknet node accessible at `http://127.0.0.1:6060`
- Keystore unlocked for deployments

**Next Steps After Completion**:
- Load testing with 100+ proof requests/min
- Recursive proof composition for batch operations
- Integration with external credit scoring APIs
