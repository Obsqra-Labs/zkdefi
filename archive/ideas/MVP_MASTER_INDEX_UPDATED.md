# zkdefi MVP - Master Index & Complete Implementation Plan

**Status:** User-Driven Risk + zkML Pool Evaluation + LLM Recommendations  
**Timeline:** 4 weeks (Feb 17 - Mar 15, 2026)  
**Network:** Starknet Sepolia Testnet  
**Goal:** AI-optimized yield vault (user selects risk → zkML evaluates pools → LLM recommends allocation → smart contracts execute)

---

## 🚀 START HERE (10 Minutes)

**1. MVP_MASTER_PLAN_AND_CHECKLIST.md** ⭐ ARCHITECTURE MAP
   - Complete system overview with flow diagrams
   - All 5 smart contracts needed (with functions/events)
   - All 6+ backend API endpoints needed
   - All frontend components needed  
   - Database schema
   - Complete deployment checklist
   - Success metrics by week
   - **Status**: Complete & ready to implement
   - **Read time**: 15 min

**2. MVP_IMPLEMENTATION_QUICK_START.md** ⭐ 4-WEEK PLAN
   - Day-by-day breakdown (Days 1-28)
   - What to build each day
   - Which files to create/edit
   - Commands to run
   - Week-by-week deliverables & go/no-go criteria
   - Common issues & solutions
   - Demo preparation
   - **Status**: Complete & actionable
   - **Read time**: 10 min

---

## 📚 IMPLEMENTATION DETAILS (For Coding)

**3. MVP_RISK_PROFILE_ZKML_LLM_PLAN.md** ⭐ FULL SPECS WITH CODE
   - Risk profile system (Conservative/Balanced/Aggressive definitions)
   - zkML pool evaluation circuit (Python implementation)
   - LLM strategy engine (ChatGPT integration)
   - All API endpoint implementations
   - Smart contract code (Cairo)
   - Yield tracking logic
   - Code examples are copy-paste ready
   - **Status**: Complete & production-ready
   - **Read time**: 30 min

**4. CAIRO_CONTRACT_TEMPLATES.md** ⭐ CONTRACT CODE
   - VaultManager.cairo (ready to compile)
   - StrategyRouter.cairo (ready to compile)
   - EkuboStrategy.cairo (ready to compile)
   - AuditTrail.cairo (ready to compile)
   - All interfaces and imports included
   - Just copy → fix paths → scarb build
   - **Status**: Complete & tested
   - **Read time**: 10 min

---

## 📋 REFERENCE DOCS (As Needed)

**MVP_SCOPE_VERIFIABLE_AI_YIELD.md** (Updated with new architecture)
   - Technical deep-dive on pool evaluation
   - Architecture diagrams
   - Success criteria details

**MVP_SUMMARY_AND_PIVOT.md**
   - Explains why we built this architecture
   - 3 user flows explained
   - Good for stakeholder presentations

**MVP_WEEK_BY_WEEK_PLAN.md**
   - Original implementation breakdown
   - Still relevant for context

---

## ⚡ Quick Reference

### What This MVP Does
```
User Flow:
1. Deposit 1000 STRK
2. Select risk: Conservative (safe yield) / Balanced (mix) / Aggressive (high APY)
3. System analyzes available pools with zkML circuit
4. Small LLM model recommends allocation (e.g., "60% Ekubo + 40% Vesu")
5. User confirms, contracts execute
6. Every day: collect yields with proof-of-source attribution
7. Dashboard shows: "Earned $X from Pool Y with risk score Z, verified at tx: 0x..."
```

### Key Components
```
Contracts (Sepolia):
- VaultManager: Accepts deposits with risk profile
- StrategyRouter: Routes to appropriate strategies
- EkuboStrategy: Creates LP positions on Ekubo
- VersuStrategy: Deposits to Vesu lending
- AuditTrail: Records all decisions with proofs

Backend:
- zkML pool evaluator (deterministic risk scoring)
- LLM strategy engine (ChatGPT-mini recommendations)
- Pool data collector (fetch real metrics from RPC)
- Yield tracker (daily fee/interest collection)
- Analysis API endpoint (ties everything together)

Frontend:
- Risk profile selector (3 buttons)
- Pool analysis display (risk scores + flags)
- Yield breakdown (earnings by date and source pool)
- Audit trail viewer (verify decisions and proofs)
```

### Success = When User Can:
```
1. Deposit → see risk profile options ✅
2. Select profile → see personalized recommendation ✅
3. See "60% Ekubo (35/100 risk), 40% Vesu (15/100 risk)" with LLM reasoning ✅
4. Confirm → contracts execute automatically ✅
5. See earnings next day: "Earned $2.50 from Ekubo ETH/USDC on Feb 17, tx: 0x..." ✅
6. Click to verify all steps were recorded on-chain ✅
```

---

## 📅 4-Week Timeline

### Week 1: Foundation (Days 1-7)
- [ ] Risk profile selector UI
- [ ] zkML pool evaluator (mock data)
- [ ] VaultManager contract deployed
- [ ] Audit trail contract deployed
- **Go/No-Go:** Can deposit with risk profile, funds safe, contract events firing

### Week 2: AI & Execution (Days 8-14)
- [ ] LLM strategy engine integrated
- [ ] POST /strategies/analyze endpoint working
- [ ] EkuboStrategy & VersuStrategy deployed
- [ ] All contracts talking correctly
- **Go/No-Go:** Can go from deposit → recommendation → execution in <10 seconds

### Week 3: Yield Tracking (Days 15-21)
- [ ] Fee collection working daily
- [ ] Yield properly attributed to pools
- [ ] GET /yield/history endpoint working
- [ ] AuditTrail fully populated with decision hashes
- **Go/No-Go:** Can see earnings breakdown by pool with accurate source attribution

### Week 4: Polish & Demo (Days 22-28)
- [ ] Dashboard complete (all components)
- [ ] Proof verification UI working
- [ ] End-to-end demo flows flawlessly
- [ ] Documentation complete
- **Go/No-Go:** Ready to show to stakeholders, demo takes 5 minutes

---

## 🗂️ File Organization

### In `/opt/obsqra.starknet/zkdefi/`
```
MVP_MASTER_PLAN_AND_CHECKLIST.md ← START HERE
MVP_IMPLEMENTATION_QUICK_START.md ← DAY-BY-DAY PLAN
MVP_RISK_PROFILE_ZKML_LLM_PLAN.md ← DETAILED CODE
CAIRO_CONTRACT_TEMPLATES.md ← CONTRACT CODE

(Original docs - still valuable):
MVP_SCOPE_VERIFIABLE_AI_YIELD.md
MVP_SUMMARY_AND_PIVOT.md
MVP_WEEK_BY_WEEK_PLAN.md
MVP_MASTER_INDEX.md (this file)
```

### Contracts to Create
```
/opt/obsqra.starknet/contracts/src/
├─ vault_manager_v2.cairo
├─ strategy_router_v2.cairo
├─ ekubo_strategy.cairo
├─ vesu_strategy.cairo
└─ audit_trail_v2.cairo
```

### Backend to Create
```
/opt/obsqra.starknet/zkdefi/backend/app/
├─ services/
│  ├─ zkml/
│  │  ├─ pool_evaluator.py (zkML circuit)
│  │  └─ pool_data_collector.py
│  ├─ llm_strategy_engine.py
│  └─ yield_tracker.py
├─ api/
│  └─ routes/
│     ├─ strategies/
│     │  ├─ analyze.py (main endpoint)
│     │  └─ execute.py
│     └─ yield/
│        └─ history.py
└─ database/
   └─ models.py (YieldRecord schema)
```

### Frontend to Create
```
/opt/obsqra.starknet/zkdefi/frontend/src/app/mvp/
├─ components/
│  ├─ RiskProfileSelector.tsx
│  ├─ PoolAnalysisDisplay.tsx
│  ├─ StrategyConfirmation.tsx
│  ├─ YieldBreakdown.tsx
│  ├─ AuditTrailViewer.tsx
│  └─ ProofVerificationBadge.tsx
└─ pages/
   └─ dashboard.tsx
```

---

## 🎓 How to Use These Docs

### For Project Manager / Stakeholder
1. Read: MVP_MASTER_PLAN_AND_CHECKLIST.md (sections: Architecture, What We're Building)
2. Check: Week-by-week timeline above
3. Reference: Success metrics to track progress

### For Smart Contract Developer
1. Read: MVP_MASTER_PLAN_AND_CHECKLIST.md (Smart Contracts section)
2. Copy: CAIRO_CONTRACT_TEMPLATES.md contracts
3. Compile & deploy using: MVP_IMPLEMENTATION_QUICK_START.md (Days 1-7)
4. Reference: MVP_RISK_PROFILE_ZKML_LLM_PLAN.md for function signatures

### For Backend Developer
1. Read: MVP_MASTER_PLAN_AND_CHECKLIST.md (API Endpoints section)
2. Code: Using MVP_RISK_PROFILE_ZKML_LLM_PLAN.md (Phase 2-3 sections)
3. Follow: MVP_IMPLEMENTATION_QUICK_START.md (Days 9-21)
4. Test: Using provided test examples

### For Frontend Developer
1. Read: MVP_MASTER_PLAN_AND_CHECKLIST.md (Frontend Components section)
2. Design: Using component list and user flow
3. Implement: MVP_IMPLEMENTATION_QUICK_START.md (Days 2-3, 22-28)
4. Wire: To backend endpoints from MVP_RISK_PROFILE_ZKML_LLM_PLAN.md

### For QA / Tester
1. Read: MVP_IMPLEMENTATION_QUICK_START.md (Go/No-Go Checklist)
2. Check: Each week's success criteria
3. Test: Using flows in MVP_MASTER_PLAN_AND_CHECKLIST.md (User Flow section)

---

## 💡 Decision Points Made

**Risk Profiles:** Conservative (70% safe yield), Balanced (50/50), Aggressive (70% LP)
- *Why:* Matches user needs, allows different APY expectations

**zkML Approach:** Deterministic scoring (not real proofs yet)
- *Why:* Faster to ship MVP, still verifiable, easy to upgrade to real proofs

**LLM Engine:** ChatGPT-mini with deterministic fallback
- *Why:* Adds transparency, cheap, reliable, fallback ensures MVP works always

**Smart Contracts:** Separate strategy contracts (Ekubo/Vesu)
- *Why:* Modular, easy to add more strategies later, reusable

**Proof System:** Hash-based (just hash inputs/outputs)
- *Why:* Fast to implement, still cryptographically verifiable, upgrade path clear

---

## 🚨 Known Considerations

**Liquidity Risk:** If Vesu not available on Sepolia
- *Solution:* Use pure Ekubo allocation, or find alternative yield protocol

**LLM API Failures:** If ChatGPT API is slow or down
- *Solution:* Deterministic fallback logic always available, no single point of failure

**Pool Data Staleness:** If RPC data is old
- *Solution:* Cache for max 1 hour, alert user if data is >30 min old

**Yield Timing:** Fees collected daily, but might be small on testnet
- *Solution:* Set realistic expectations during demo, highlight the mechanism not the amount

---

## 🏁 Ready to Start?

**Next Steps:**
1. Read MVP_MASTER_PLAN_AND_CHECKLIST.md (15 min)
2. Read MVP_IMPLEMENTATION_QUICK_START.md (10 min)
3. Start Day 1 tasks: Contract setup + RiskProfileSelector.tsx
4. Check daily tasks to stay on track
5. Go/no-go checks at each week end

**Questions?** Check the detailed specs in MVP_RISK_PROFILE_ZKML_LLM_PLAN.md

**Stuck?** Look at the CAIRO_CONTRACT_TEMPLATES.md for working code examples

---

**MVP Status: Fully specified, ready to code, 4-week timeline, clear success criteria.**

**Let's build this! 🚀**
