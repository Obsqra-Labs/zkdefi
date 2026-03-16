# TradeDesk Phase 2 & 3 Implementation Plan

**Date:** 2026-03-08  
**Status:** Planning (Phase 1 Complete)  
**Dependency:** Phase 1 complete - all data pipelines operational

---

## Phase 1 Status: ✅ COMPLETE

- ✅ Opportunities aggregation (5+ live opportunities)
- ✅ Market context with real volatility
- ✅ Signals endpoint with constitution reports
- ✅ Receipts integration with fallback
- ✅ Frontend oracle unified on signals endpoint
- ✅ E2E tested: backend → frontend → rendering

**Readiness:** TradeDesk UI is ready to display real data.

---

## Phase 2: Wire Real Prediction Models

### Goal
Populate the placeholder `predictions` fields in signals with actual model outputs.

### Timeline
**Est. 4-6 hours** (depends on model availability & performance)

### Tasks

#### **Task P2.1: Yield Forecaster Integration** (~2 hours)

**Current State:**
```json
"yieldForecast": {
  "model": "yield-predictor-v1",
  "predicted_apy": 3.15,  // Currently: currentYield * 1.05
  "confidence": 0.72,
  "horizon": "7d"
}
```

**What to implement:**
1. Check if `backend/app/services/yield_forecast.py` exists
   - If yes: Wire it up to signals endpoint
   - If no: Create basic forecaster (moving average + volatility adjustment)
2. Update signals.py `opportunity_to_signal()` to call real yield model
3. Pass lending pool utilization into yield prediction
4. Test: Yield forecast should reflect pool conditions

**Output:**
- Real APY predictions based on pool data
- Confidence scores (0.5-0.95 range based on data freshness)

#### **Task P2.2: Reputation Model Integration** (~1.5 hours)

**Current State:**
```json
"reputationScore": {
  "model": "reputation-v1",
  "score": 85,  // Currently: static 85 or 72
  "trustworthiness": "high"
}
```

**What to implement:**
1. Endpoint: `backend/app/api/routes/reputation.py` exists
2. Wire it into signals: fetch reputation for protocol/entity
3. Map score (0-100) to trustworthiness ("low" | "medium" | "high")
4. Cache reputation scores (1-hour TTL)

**Output:**
- Real reputation scores per protocol
- Trustworthiness tiers based on historical performance

#### **Task P2.3: Market Forecaster Integration** (~2 hours)

**Current State:**
```json
"marketForecaster": {
  "model": "forecaster-circuit-v1",
  "probability_up_5m": 0.62,   // Currently: static
  "probability_up_30m": 0.68,
  "probability_up_4h": 0.71,
  "calibration_score": 0.88
}
```

**What to implement:**
1. Endpoint: `backend/app/services/snapshot_forecaster.py` or similar
2. Already exists? Check `backend/data/snapshot_forecaster_*.json`
3. Wire forecaster into signals for each token pair
4. Map predictions to opportunities (especially DEX/swap types)
5. Include calibration score (model confidence)

**Output:**
- Real probability predictions for price movements
- Calibration tracking for model evaluation

#### **Task P2.4: Performance Testing** (~1 hour)

- Measure latency: opportunities → signals transformation with real models
- Target: `GET /api/v1/zkdefi/signals/top?limit=12` < 500ms
- If slower: Add caching layer or async model calls

---

## Phase 3: Oracle Gating Policies + Agent Execution

### Goal
Complete the oracle decision loop: signals → policy gates → agent execution.

### Timeline
**Est. 8-12 hours** (higher complexity)

### Architecture

```
Oracle Receives Signals
    ↓
Apply Gating Policies
    ├─ Reputation threshold? (e.g., only trust > 80)
    ├─ Risk tolerance? (e.g., max risk_score 50)
    ├─ Circuit verified? (e.g., require zkml_gated=true)
    └─ Privacy mode? (e.g., prefer shielded)
    ↓
Filter to Actionable Signals
    ↓
Agent Orchestration
    ├─ Map signal to contract call
    ├─ Generate execution parameters
    ├─ Submit to relayer
    └─ Track receipt
    ↓
Update Reputation (based on outcome)
```

### Tasks

#### **Task P3.1: Policy Definition & Storage** (~2 hours)

**Current State:**
- Constraints endpoint exists: `/api/v1/zkdefi/mc/constraints/{address}`
- Policies might already be stored

**What to implement:**
1. Check existing policy storage
2. Define policy schema:
   ```json
   {
     "id": "policy-001",
     "address": "0x...",
     "gateRules": {
       "minReputationScore": 75,
       "maxRiskScore": 50,
       "requireCircuitVerified": false,
       "preferPrivacyMode": "shielded"
     },
     "executionRules": {
       "maxAllocationPct": 20,
       "dailyLimitUSD": 10000,
       "autoExecute": true
     },
     "createdAt": "2026-03-08T...",
     "isActive": true
   }
   ```
3. Create endpoints:
   - `GET /api/v1/zkdefi/policies/{address}` - fetch user policy
   - `POST /api/v1/zkdefi/policies` - create/update policy
   - `GET /api/v1/zkdefi/policies/default` - fallback policy

#### **Task P3.2: Gating Engine** (~2 hours)

**What to implement:**
1. Create `backend/app/services/oracle_gating_engine.py`
2. Function: `apply_gates(signals: List[Signal], policy: Policy) -> List[Signal]`
   - Filter by reputation threshold
   - Filter by risk tolerance
   - Filter by circuit verification (when available)
   - Filter by privacy preferences
3. Endpoint: `GET /api/v1/zkdefi/oracle/gated-signals?address={addr}`
   - Returns only policy-compliant signals
4. Endpoint: `POST /api/v1/zkdefi/oracle/should-execute`
   - Input: signal + policy
   - Output: { allowed: bool, reason: string }

#### **Task P3.3: Agent Orchestration** (~3 hours)

**What to implement:**
1. Create `backend/app/services/agent_orchestrator.py`
2. Function: `prepare_execution(signal: Signal, params: ExecutionParams) -> ContractCall`
   - Map opportunity type to contract method
   - Generate calldata with parameters
3. Function: `submit_execution(call: ContractCall, address: str) -> TransactionHash`
   - Call relayer or submit directly
   - Track submission
4. Endpoints:
   - `POST /api/v1/zkdefi/oracle/execute` - submit execution
   - `GET /api/v1/zkdefi/oracle/execution/{tx_hash}` - track status

#### **Task P3.4: Reputation Feedback Loop** (~2 hours)

**What to implement:**
1. Create `backend/app/services/execution_outcomes_processor.py`
2. Function: `process_outcome(receipt: TradeReceipt)`
   - Success → reputation += 5
   - Failure → reputation -= 10
   - Exceptional yield → reputation += 15
3. Wire into receipt handler
4. Endpoint: `GET /api/v1/zkdefi/reputation/user/{address}/execution-history`

#### **Task P3.5: Frontend Oracle Command Center** (~2 hours)

**What to implement:**
1. Create `frontend/src/components/zkdefi/oracle/OracleCommandCenter.tsx`
   - Display active policy
   - Show gated signals (policy-compliant)
   - "Approve" / "Modify" / "Execute" buttons per signal
   - Execution history log
2. Wire to oracle endpoints
3. Show execution status in real-time

#### **Task P3.6: Integration Testing** (~1 hour)

- E2E test: Signal → Policy Gate → Execution → Receipt → Reputation
- Multiple policies (aggressive, moderate, conservative)
- Failure scenarios (slippage, insufficient liquidity)

---

## Prioritization

### If time-constrained, do Phase 2 first:
1. **Phase 2.1** (Yield) - highest impact on signal quality
2. **Phase 2.3** (Forecaster) - already partially built
3. **Phase 2.2** (Reputation) - improves gating
4. **Phase 3** - deferred for next cycle

### Must-have for Phase 2:
- Real yield predictions (currently static mock)
- Forecaster integration (market movement predictions)

### Nice-to-have for Phase 2:
- Reputation tied to real protocol track records
- Calibration tracking

---

## Success Criteria

### Phase 2 Complete ✅
- [ ] Yield forecaster predicts > 3 months ahead
- [ ] Forecaster calibration score > 0.85
- [ ] Reputation scores reflect protocol age/TVL
- [ ] `GET /api/v1/zkdefi/signals/top` latency < 500ms
- [ ] Frontend signals tab shows real predictions

### Phase 3 Complete ✅
- [ ] Policies can be created per address
- [ ] Gating engine filters signals correctly
- [ ] Agent executes sample transactions
- [ ] Reputation updates based on outcomes
- [ ] Oracle command center renders approved signals
- [ ] E2E test: signal → execution → receipt passes

---

## Current Blockers / Unknowns

1. **Yield Forecaster Model:** Does `yield_forecast.py` exist? Need to check service availability
2. **Market Forecaster:** Already built in snapshot_forecaster? Verify integration path
3. **Relayer:** Does execution path exist to submit transactions? Check agent_service.py
4. **Reputation Service:** Is it already live? Verify `/api/v1/zkdefi/reputation/*` endpoints

**Next Step:** Before starting Phase 2, verify which models/services are already available vs need building.

---

## Keeping Focus: TradeDesk vs Oracle

**TradeDesk displays:** Opportunities + Receipts  
**Oracle displays:** Signals + Gated Signals + Execution History

**This plan is for Oracle (signal processing → agent execution).**  
**TradeDesk E2E is already complete (real data flowing).**

Do not drift to UI redesign / color schemes / other features during this phase.

---

**Ready to start Phase 2 when you give the go-ahead.**
