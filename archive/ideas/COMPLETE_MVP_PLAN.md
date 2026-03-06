# COMPLETE MVP PLAN: Scoped & Ready to Build

**Date:** February 16, 2026  
**Status:** ✅ Ready to Execute  
**Timeline:** 4 weeks to product-ready MVP

---

## Executive Summary

Instead of predefined allocations, users now:
1. **Select risk profile** (Conservative/Balanced/Aggressive) on deposit
2. **AI + zkML evaluate** all available pools against their criteria
3. **LLM recommends** optimal allocation with reasoning
4. **User confirms** before deployment (full transparency)
5. **Contract executes** across Ekubo, Vesu, (JediSwap, others if available)
6. **Yield tracked** with proofs showing which pool generated it

**Key improvement:** User controls risk profile. AI proves it evaluated options correctly. zkML flagsmissing liquidity in any DEX. LLM provides human-readable reasoning.

---

## Documentation Map

### Architecture & Specification
1. **RISK_PROFILE_ARCHITECTURE.md** (NEW)
   - Three risk profiles with specific characteristics
   - Pool evaluation criteria & risk scoring
   - Implementation checklist
   - Frontend/backend/contract updates needed

2. **ZKML_CIRCUIT_SPEC.md** (NEW)
   - How pool analysis generates verifiable proofs
   - Mock circuit for MVP, real zkML for Week 3+
   - On-chain verification
   - Audit trail integration

3. **LLM_DECISION_ENGINE.md** (NEW)
   - ChatGPT-mini integration for recommendations
   - Fallback logic if LLM unavailable
   - Fine-tuning path
   - Cost analysis ($1/month at scale)

4. **MULTI_DEX_INTEGRATION.md** (NEW)
   - Support for Ekubo, JediSwap, Vesu, (others)
   - Protocol status assessment
   - Risk flagging for insufficient liquidity
   - ProtocolConnector abstraction

5. **WEEK1_IMPLEMENTATION_PLAN.md** (NEW)
   - Day-by-day breakdown (5 days)
   - Specific code templates for each day
   - Success criteria per day
   - Known limitations

### Existing (Updated)
- **MVP_MASTER_INDEX.md** - Points to all new docs
- **MVP_SCOPE_VERIFIABLE_AI_YIELD.md** - Now risk-profile centered
- **MVP_WEEK_BY_WEEK_PLAN.md** - Updated with zkML + LLM timeline
- **MVP_SUMMARY_AND_PIVOT.md** - Including new flows

### Supporting
- **CAIRO_CONTRACT_TEMPLATES.md** - Ready-to-use contract code
- **CONTRACT_ADDRESSES_PHASE_4A.md** - Ekubo addresses verified

---

## System Architecture

### Data Flow
```
User Deposit (STRK/ETH)
    ↓
[Frontend] Risk Profile Selector (Conservative/Balanced/Aggressive)
    ↓
[API] POST /strategies/recommend
    ↓
[Backend] PoolAggregator
├─ EkuboConnector: Fetch STRK/ETH, STRK/USDC, ETH/USDC
├─ JediSwapConnector: Fetch if available (check status)
├─ VesuConnector: Fetch lending markets
└─ (Others): Only if meet liquidity threshold
    ↓
[Backend] Pool Risk Evaluation (zkML Circuit)
├─ Calculate risk score for each pool
├─ Generate flags (liquidity warning, volatility warning, etc.)
├─ Create proof commitment
└─ Filter by user's risk profile
    ↓
[Backend] LLM Decision Engine (ChatGPT-mini)
├─ Input: pools + user risk profile
├─ Process: "What's optimal allocation for this user?"
├─ Output: Recommended allocation with confidence & reasoning
└─ Fallback: Deterministic logic if LLM unavailable
    ↓
[Frontend] StrategyRecommendation Display
├─ Show recommendation with AI reasoning
├─ Show confidence score
├─ Show all pools analyzed with risk scores
├─ Allow manual adjustment of allocation %
└─ Display expected yield
    ↓
[User] Confirms Allocation
    ↓
[Smart Contract] VaultManager.route_capital()
├─ For each pool in allocation:
│  └─ Call appropriate strategy contract (Ekubo/Jedi/Vesu)
└─ Record decision in AuditTrail with proof
    ↓
[Smart Contract] StrategyContracts Execute
├─ EkuboStrategy: Create LP position via mint_and_deposit
├─ JediSwapStrategy: Add liquidity (if enabled)
├─ VesuStrategy: Supply for yield (approve + supply)
└─ Record position IDs
    ↓
[Smart Contract] AuditTrail Records
├─ Decision made (timestamp, allocation %)
├─ Proof hash (zkML evaluation)
├─ Execution (positions created, tx hashes)
├─ Yield accrual (daily)
└─ User can query: "Where did my yield come from?"
    ↓
[Frontend] Dashboard Display Yield
├─ Total yield earned
├─ Breakdown by protocol/pool/date
├─ Link to each earning tx
├─ Proof verification (click to check)
└─ APY vs AI prediction
```

---

## Component Inventory

### Frontend Components (React)
```
RiskProfileForm
├─ Amount input
├─ Profile selector (Conservative/Balanced/Aggressive)
└─ Submit → Analyze

PoolAnalysisDisplay
├─ List of pools analyzed
├─ Risk score visualization (0-100 bar)
├─ APY display
├─ Risk flags (liquidity warning, volatility, etc.)
└─ Protocol badge (Ekubo/Jedi/Vesu)

StrategyRecommendation
├─ AI recommendation box
├─ Allocation breakdown with sliders
├─ Expected yield calculation
├─ Confidence indicator
└─ Confirm button

Dashboard
├─ Active positions
├─ Total yield earned
├─ Yield breakdown (by pool, by date)
├─ Links to earning transactions
└─ Proof verification UI
```

### Backend Services (Python)
```
pool_analyzer.py
├─ calculate_risk_score()
├─ generate_pool_flags()
└─ analyze_pools()

pool_aggregator.py
├─ ProtocolConnector (abstract)
├─ EkuboConnector
├─ JediSwapConnector
├─ VesuConnector
└─ PoolAggregator

zkml_circuit.py
├─ evaluate_pool_risk() [mock in Week 1]
├─ generate_proof_hash()
└─ (upgrade to real zkML Week 3)

llm_engine.py
├─ LLMEngine class
├─ recommend_allocation()
├─ _format_prompt()
├─ _validate_allocation()
└─ _fallback_recommendation()

audit_trail_service.py
├─ record_strategy_decision()
├─ record_pool_evaluation()
└─ record_yield_accrual()

routes/strategies.py
├─ POST /recommend (main endpoint)
├─ POST /execute
└─ GET /history
```

### Smart Contracts (Cairo)
```
VaultManager.cairo [UPDATED]
├─ deposit_with_profile()
├─ route_capital()
└─ get_pending_allocation()

StrategyRouter.cairo [UPDATED]
├─ evaluate_risk_profile()
├─ call_zkml_circuit()
├─ call_llm_logic()
└─ execute_allocation()

EkuboStrategy.cairo [UPDATED]
├─ create_position()
├─ collect_fees()
└─ (rebalance on volatility)

VesuStrategy.cairo [NEW]
├─ supply_for_yield()
├─ claim_interest()
└─ withdraw()

JediSwapStrategy.cairo [NEW - if Sepolia available]
├─ add_liquidity()
├─ remove_liquidity()
└─ collect_fees()

AuditTrail.cairo [UPDATED]
├─ record_decision()
├─ record_pool_evaluation()
└─ record_yield_accrual()
```

---

## Week-by-Week Timeline

### Week 1: Risk Profiles + AI Recommendations
**Goal:** User selects risk profile → Gets AI recommendation → Can confirm

**Daily Breakdown:**
- **Mon:** RiskProfileForm component + Pool analyzer service
- **Tue:** LLM engine integration + API endpoint
- **Wed:** Frontend integration + end-to-end test
- **Thu:** Contract updates for risk profile tracking
- **Fri:** Polish + full flow testing

**Deliverable:** User can deposit, select risk, see AI recommendation with confidence score

**Success Criteria:**
- [ ] Risk profile form renders
- [ ] Backend analyzes pools
- [ ] LLM recommendation returned
- [ ] Frontend displays result
- [ ] User can confirm (execution deferred)

---

### Week 2: Execution + Real Pools
**Goal:** Deploy capital to actual Ekubo/Vesu pools, collect fees

**Milestones:**
- Deploy VaultManager & StrategyRouter contracts
- Connect to real Ekubo STRK/ETH pool
- Create actual LP positions
- Connect to Vesu (if available)
- Fee collection service

**Deliverable:** Capital deployed, fees being collected

**Success Criteria:**
- [ ] Contracts deployed to Sepolia
- [ ] Can create LP positions
- [ ] Fees collected daily
- [ ] Dashboard shows earned fees

---

### Week 3: zkML + Verification
**Goal:** Proofs that AI analysis was actually performed

**Milestones:**
- Upgrade mock zkML to real circuit (Giza or Verified.ai)
- Implement on-chain proof verification
- Update audit trail with real proofs
- Frontend proof verification UI

**Deliverable:** User can verify that AI actually evaluated pools

**Success Criteria:**
- [ ] Real zkML circuit running
- [ ] Proofs generated & recorded
- [ ] On-chain verification works
- [ ] Frontend shows proof ✅ badge

---

### Week 4: Multi-DEX + Polish
**Goal:** Support JediSwap & others, finalize MVP

**Milestones:**
- Add JediSwap support (if Sepolia available)
- Implement risk flagging for low-liquidity pools
- LLM fine-tuning on collected data
- Comprehensive testing
- Demo preparation

**Deliverable:** Production-ready MVP

**Success Criteria:**
- [ ] JediSwap integration (if available)
- [ ] All pools have risk flags
- [ ] End-to-end flow verified
- [ ] Demo can run start-to-finish

---

## Key Files to Create/Modify

### Create (New)
- [x] `RISK_PROFILE_ARCHITECTURE.md` - 500 lines
- [x] `ZKML_CIRCUIT_SPEC.md` - 400 lines
- [x] `LLM_DECISION_ENGINE.md` - 600 lines
- [x] `MULTI_DEX_INTEGRATION.md` - 400 lines
- [x] `WEEK1_IMPLEMENTATION_PLAN.md` - 500 lines

### Modify (Existing)
- `frontend/src/app/mvp/page.tsx`
- `frontend/src/app/mvp/components/` - Add 3 new components
- `backend/app/api/routes/` - Add strategies router
- `backend/app/services/` - Add 5 new services
- `contracts/src/` - Update 4 contracts

### Existing (Already Done)
- `MVP_MASTER_INDEX.md`
- `MVP_SCOPE_VERIFIABLE_AI_YIELD.md`
- `MVP_WEEK_BY_WEEK_PLAN.md`
- `MVP_SUMMARY_AND_PIVOT.md`
- `CAIRO_CONTRACT_TEMPLATES.md`
- `CONTRACT_ADDRESSES_PHASE_4A.md`

---

## Implementation Checklist: Ready?

### Prerequisites ✅
- [ ] Ekubo Sepolia addresses verified (0x0444... core, 0x06a2... positions)
- [ ] Test data for pools prepared
- [ ] OpenAI API key available (or will use mock)
- [ ] Cairo dev environment ready
- [ ] Frontend build working

### Week 1 (Start Mon)
- [ ] Create RiskProfileForm.tsx
- [ ] Create pool_analyzer.py
- [ ] Create llm_engine.py
- [ ] Create /api/strategies endpoint
- [ ] Wire frontend to backend
- [ ] Test end-to-end

### Week 2 (Start Mon)
- [ ] Deploy contracts
- [ ] Connect to real Ekubo
- [ ] Implement fee collection
- [ ] Test yield generation

### Week 3 (Start Mon)
- [ ] Integrate real zkML circuit
- [ ] On-chain verification
- [ ] Proof UI

### Week 4 (Start Mon)
- [ ] JediSwap support
- [ ] Risk flagging
- [ ] Final testing
- [ ] Demo ready

---

## Risk Management

### What Could Go Wrong?

**Ekubo pools unavailable on Sepolia**
- Mitigation: Use mock pool data for MVP
- Fallback: Only Vesu available
- Recovery: Switch to mainnet early

**LLM API limits/costs**
- Mitigation: Use fallback logic
- Fallback: Deterministic allocation rules
- Recovery: Switch to local model in Week 3

**zkML circuit too complex for testnet**
- Mitigation: Use mock circuit in Week 1
- Fallback: Just record hashes, no proofs
- Recovery: Implement real circuit Week 3

**User gets confused by risk profiles**
- Mitigation: Simple 3-option choice
- Fallback: Show real examples with APYs
- Recovery: Simplify or hide advanced options

---

## Success Metrics

### Week 1 End
- ✅ User can deposit with risk profile
- ✅ AI recommends allocation with >80% confidence
- ✅ Allocation sums to 100%
- ✅ End-to-end flow completes

### Week 2 End
- ✅ Capital deployed to protocols
- ✅ LP positions created
- ✅ Fees collected
- ✅ Dashboard shows yield

### Week 3 End
- ✅ Proofs generated
- ✅ Proofs verifiable on-chain
- ✅ User can click "verify" and see proof ✅

### Week 4 End (MVP Complete)
- ✅ Multiple DEXs supported
- ✅ All risks flagged
- ✅ Demo runs without errors
- ✅ Ready for user onboarding

---

## Mainnet Readiness (After MVP)

Once MVP works on Sepolia:
1. Deploy same contracts to mainnet
2. Point to real Nostra, Ekubo mainnet
3. Increase transaction sizes (real capital)
4. Full audit of smart contracts
5. Insurance/safety mechanisms
6. Marketing & user acquisition

**Timeline:** 2-4 weeks post-MVP

---

## What's Different from Original Scope?

### Original
- User could only create LP positions (hardcoded Ekubo)
- Lost capital in yield deposits (Vesu)
- No AI analysis
- No risk selection
- No verifiable proofs

### New (This Plan)
- ✅ User selects risk profile
- ✅ AI analyzes all pools
- ✅ zkML proves the analysis
- ✅ LLM recommends allocation
- ✅ Supports multiple DEXs
- ✅ Flags unsafe options
- ✅ User confirms before execution
- ✅ Proves where yield came from

**Result:** From "test LP creation" to "AI-driven yield optimization platform"

---

## Next Steps

### Starting Monday (Day 1)

1. **Review this plan**
   - Read RISK_PROFILE_ARCHITECTURE.md (15 min)
   - Read WEEK1_IMPLEMENTATION_PLAN.md (20 min)
   - Verify Ekubo addresses (5 min)

2. **Set up environment**
   - OpenAI API key in .env (optional but recommended)
   - Cairo compiler ready
   - Frontend build clean

3. **Start Day 1**
   - Create RiskProfileForm.tsx
   - Create pool_analyzer.py
   - Both should compile/run

4. **Daily standup**
   - What completed yesterday?
   - What's today's goal?
   - Any blockers?

---

## Contact/Support

Questions on specific components?
- RISK_PROFILE_ARCHITECTURE.md for risk scoring
- ZKML_CIRCUIT_SPEC.md for proofs
- LLM_DECISION_ENGINE.md for recommendations
- MULTI_DEX_INTEGRATION.md for protocol support
- WEEK1_IMPLEMENTATION_PLAN.md for daily details

All code templates are in respective docs.

---

## Final Status

✅ **Architecture:** Fully designed  
✅ **Documentation:** Complete (5 new specs)  
✅ **Code templates:** Provided for all components  
✅ **Timeline:** 4 weeks realistic  
✅ **Success criteria:** Defined  
✅ **Risk management:** Covered  

🚀 **Ready to build!**

Start Monday with Day 1 of WEEK1_IMPLEMENTATION_PLAN.md

---

**Created:** February 16, 2026  
**Status:** Ready for Development  
**Next Review:** Friday (Day 5)
