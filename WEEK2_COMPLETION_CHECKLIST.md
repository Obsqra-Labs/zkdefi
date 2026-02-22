# Week 2 (Feb 18-24) - Completion Checklist

**Status:** In Progress - Week 1 Almost Complete, Week 2 Starting  
**Updated:** Feb 18, 2026

---

## Summary

We're pivoting from "predefined allocations" to **"User Risk Profiles + zkML Pool Eval + LLM Decision"**.

User deposits → Selects risk → zkML evals pools → LLM recommends → Execute → Track yield

---

## Week 1 Completion Status

### ✅ COMPLETED

#### Frontend Components
- [x] RiskProfileSelector.tsx - 3 risk levels with descriptions
- [x] PoolAnalysisDisplay.tsx - Shows evaluated pools with flags
- [x] StrategyRecommendation.tsx - LLM recommendation display
- [x] PortfolioDisplay.tsx - Active positions view
- [x] RiskProfileForm.tsx - Form submission

#### Backend Services
- [x] zkml_pool_evaluator.py - Evaluates pool risk (0-100 score)
- [x] llm_decision_engine.py - Rule-based LLM fallback
- [x] pool_aggregator.py - Fetches pool data from DEXs
- [x] real_pool_aggregator.py - Real Ekubo/JediSwap data

#### API Routes
- [x] risk_profile.py - /risk/profiles, /risk/analyze, /risk/recommend
- [x] strategies.py - Strategy recommendation endpoints
- [x] pool_aggregator endpoints set up

#### Infrastructure
- [x] PM2 process management (no more crashes)
- [x] Frontend build passing
- [x] API proxy routing (/api/* → backend)

---

## Week 2 Critical Path

### 🔴 IN PROGRESS - MUST COMPLETE THIS WEEK

#### 1. Smart Contracts (Blocking everything else)
**Status:** NOT STARTED (templates ready)  
**Priority:** 🔴 CRITICAL - Blocks contract execution

**Tasks:**
- [ ] Compile VaultManager.cairo (with risk_profile parameter)
- [ ] Compile StrategyRouter.cairo
- [ ] Compile AuditTrail.cairo
- [ ] Deploy all 3 to Sepolia testnet
- [ ] Verify contracts exist on chain

**Files to create/update:**
```
contracts/src/vault_manager_v2.cairo (NEW)
  - deposit(amount, risk_profile) 
  - get_user_deposit()
  - get_pending_deposits()

contracts/src/strategy_router_v4.cairo (NEW)
  - route_to_strategy(pool_evaluations, llm_recommendation)
  - execute_ekubo_lp()
  - execute_vesu_yield()

contracts/src/audit_trail_v2.cairo (NEW)
  - record_analysis(user, deposit_id, risk_profile, evaluation_hash, llm_hash)
  - mark_executed(record_id, tx_hash)
```

**DUE:** Tuesday Feb 20 EOD

---

#### 2. Backend Contract Executor
**Status:** PARTIAL (services exist, executor missing)  
**Priority:** 🔴 CRITICAL - Executes allocation

**Tasks:**
- [ ] Create `backend/app/services/contract_executor.py`
  - Connect to Starknet RPC
  - Call VaultManager.deposit()
  - Listen for DepositReceived event
  - Call StrategyRouter.route_to_strategy()
  - Log all TXs to audit trail

- [ ] Create `backend/app/api/routes/deposits.py`
  - POST /deposits/submit - Accept user deposit, call vault contract
  - GET /deposits/{user} - Get pending deposits
  - GET /deposits/{deposit_id} - Get deposit status

- [ ] Create `backend/app/services/allocation_executor.py`
  - Execute Ekubo LP position creation
  - Execute Vesu yield deposit
  - Handle TX retry/failure

**Files to create:**
```
backend/app/services/contract_executor.py (NEW - 100-150 lines)
backend/app/services/allocation_executor.py (NEW - 200-250 lines)
backend/app/api/routes/deposits.py (NEW - 150-200 lines)
backend/app/api/routes/allocations.py (NEW - 100-150 lines)
```

**DUE:** Wednesday Feb 21 EOD

---

#### 3. Frontend Integration
**Status:** PARTIAL (components exist, flow incomplete)  
**Priority:** 🔴 HIGH - User-facing flow

**Tasks:** Update `/frontend/src/app/mvp/page.tsx`
- [ ] Add "Deposit Amount" input field
- [ ] Wire RiskProfileSelector to /risk/analyze API call
- [ ] Show pool analysis results with flags
- [ ] Wire StrategyRecommendation to /risk/recommend API call
- [ ] Add "Confirm & Execute" button → /deposits/submit API call
- [ ] Show execution status (pending, confirmed, deployed)
- [ ] Show deployment success with TX hash link to StarkScan

**Files to update:**
```
frontend/src/app/mvp/page.tsx (200-300 lines of update needed)
```

**DUE:** Wednesday Feb 21 EOD

---

#### 4. Audit Trail Recording
**Status:** SERVICE INCOMPLETE (contract ready)  
**Priority:** 🟡 HIGH - Records all decisions

**Tasks:**
- [ ] Create `backend/app/services/audit_trail_service.py`
  - record_strategy_analysis() - Log pool evaluations + LLM decision
  - record_allocation_execution() - Log strategy execution
  - record_deposit() - Log initial deposit with risk profile
  - Generate proof hashes (SHA256 of analysis data)

- [ ] Create `backend/app/api/routes/audit_trail.py`
  - GET /audit/{audit_id} - Retrieve single audit entry
  - GET /audit/user/{user} - All audits for user
  - POST /audit/verify/{audit_id} - Verify proof hash

**Files to create:**
```
backend/app/services/audit_trail_service.py (NEW - 200+ lines)
backend/app/api/routes/audit_trail.py (NEW - 100+ lines)
```

**DUE:** Thursday Feb 22 EOD

---

### 🟡 IMPORTANT - NEEDED BY END OF WEEK

#### 5. Pool Data Freshness
**Status:** PARTIAL (static data, not live)  
**Priority:** 🟡 MEDIUM - Ensures latest APYs

**Tasks:**
- [ ] Set up hourly refresh of pool data from Ekubo RPC
- [ ] Cache pool metrics with timestamps
- [ ] Update zkML evaluator to use fresh data
- [ ] Add staleness check (warn if data > 2 hours old)

**DUE:** Friday Feb 23 EOD

---

#### 6. Testing & Validation
**Status:** NOT STARTED  
**Priority:** 🟡 MEDIUM - Needed before Week 3

**Tasks:**
- [ ] Test full flow: Deposit → Analyze → Recommend → Execute
- [ ] Verify contract events are logged
- [ ] Verify audit trail records are created
- [ ] Test with 3 different risk profiles
- [ ] Verify zkML risk scores are deterministic

**Test Script:** `backend/tests/test_week2_flow.py`

**DUE:** Friday Feb 23 EOD

---

## Week 3 Preview (What's Next)

Once Week 2 is done:
1. Deploy actual Ekubo LP positions (Week 3, Day 1-2)
2. Deploy actual Vesu yield deposits (Week 3, Day 2-3)
3. Collect real fees (Week 3, Day 3-4)
4. Build yield tracking dashboard (Week 3, Day 5)
5. Add proof verification to frontend (Week 4)

---

## Critical Files Reference

### Frontend
```
frontend/src/app/mvp/page.tsx          - Main flow (USER SEES THIS)
frontend/src/app/mvp/components/RiskProfileSelector.tsx
frontend/src/app/mvp/components/PoolAnalysisDisplay.tsx
frontend/src/app/mvp/components/StrategyRecommendation.tsx
```

### Backend Services
```
backend/app/services/zkml_pool_evaluator.py        - Risk scoring (DONE)
backend/app/services/llm_decision_engine.py        - Recommendations (DONE)
backend/app/services/pool_aggregator.py            - Pool data (PARTIAL)
backend/app/services/contract_executor.py          - EXECUTE CONTRACTS (TODO)
backend/app/services/allocation_executor.py        - EXECUTE STRATEGY (TODO)
backend/app/services/audit_trail_service.py        - AUDIT LOGGING (TODO)
```

### Backend Routes
```
backend/app/api/routes/risk_profile.py             - Risk analysis (PARTIAL)
backend/app/api/routes/strategies.py               - Strategy recommend (PARTIAL)
backend/app/api/routes/deposits.py                 - DEPOSITS (TODO)
backend/app/api/routes/allocations.py              - ALLOCATION EXEC (TODO)
backend/app/api/routes/audit_trail.py              - AUDIT TRAIL (TODO)
```

### Smart Contracts
```
contracts/src/vault_manager_v2.cairo               - COMPILE & DEPLOY (TODO)
contracts/src/strategy_router_v4.cairo             - COMPILE & DEPLOY (TODO)
contracts/src/audit_trail_v2.cairo                 - COMPILE & DEPLOY (TODO)
```

---

## Daily Standup Schedule

**Monday Feb 19:** Contract compilation & deployment
**Tuesday Feb 20:** Contract executor + allocation executor built
**Wednesday Feb 21:** Frontend integration complete, API flow working
**Thursday Feb 22:** Audit trail recording tested
**Friday Feb 23:** Full flow tested end-to-end

---

## Success Definition for Week 2

✅ **Minimum Viable:** User can:
1. ✅ Connect wallet
2. ✅ Select risk profile
3. ✅ See pool evaluations with risks
4. ✅ See LLM recommendations
5. 🔴 Execute deposit → contract receives funds
6. 🔴 See TX hash linking to audit trail
7. 🔴 View pending strategy execution

✅ **Ideal:** Everything above + 
8. 🔴 Strategy automatically executes to Ekubo/Vesu
9. 🔴 Fees start being collected daily
10. 🔴 Dashboard shows yield breakdown

---

## Known Blockers

1. **Contract Addresses** - Need deployed contract addresses to:
   - Call from backend
   - Link in frontend
   - Store in environment variables

2. **Starknet RPC** - Need reliable connection for:
   - Monitoring DepositReceived events
   - Calling LLM-recommended actions
   - Recording audit trail

3. **LLM API** - Currently using rule-based engine:
   - Can upgrade to real OpenAI API if desired
   - Current fallback is deterministic (good for testing)

---

## Resource Requirements

- **Developer Hours:** ~60 hours for Week 2
  - Contracts: 8 hours
  - Backend executor: 12 hours
  - Frontend integration: 10 hours
  - Audit trail: 8 hours
  - Testing: 12 hours
  - Deployment/troubleshooting: 12 hours

- **Cost:** 
  - Starknet testnet fees: Minimal (testnet)
  - OpenAI API (if using real LLM): ~$1-5 for week
  - No infrastructure costs (localhost/testnet)

---

## Go/No-Go Decision Points

**Go:** All Week 1 components working ✅  
**Go:** Contracts compile without errors ✅  
**Go:** Backend can connect to Starknet RPC ✅  
**Go:** At least 1 DEX pool data available ✅  

**No-Go:** Starknet RPC unstable → Use HTTP RPC instead  
**No-Go:** Contract compilation fails → Fix Cairo syntax  
**No-Go:** No pool data → Use mock data, proceed anyway  

---

## Handoff Checklist

Before moving to Week 3, ensure:
- [ ] All contracts deployed to Sepolia
- [ ] All backend APIs responding correctly
- [ ] Frontend flow works end-to-end
- [ ] At least 1 test deposit goes through full cycle
- [ ] Audit trail records created successfully
- [ ] Team understands contract addresses & how to interact

---

**Next Action:** 
1. Compile contracts (TODAY)
2. Deploy to Sepolia (TOMORROW) 
3. Wire frontend to execute (WED)
4. Test full flow (THU-FRI)

Let's build! 🚀
