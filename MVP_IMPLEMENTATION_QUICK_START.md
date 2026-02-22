# MVP Implementation: Quick Start (4 Weeks)

## What You're Building

User deposits → Selects risk profile (Conservative/Balanced/Aggressive) → zkML evaluates pools → Small LLM recommends allocation → Contracts execute → Daily yield tracking with proof-of-source.

---

## Week 1: Risk Selection + Pool Analysis (Days 1-7)

### Day 1: Contract Setup
```bash
cd /opt/obsqra.starknet/contracts/src
touch vault_manager_v2.cairo strategy_router_v2.cairo audit_trail_v2.cairo
# Copy templates from CAIRO_CONTRACT_TEMPLATES.md
scarb build
```

### Day 2-3: Risk Profile UI
```bash
cd /opt/obsqra.starknet/zkdefi/frontend/src/app/mvp/components
# Create RiskProfileSelector.tsx (code in MVP_RISK_PROFILE_ZKML_LLM_PLAN.md)
# Test with hardcoded risk profiles
```

### Day 4-5: zkML Pool Evaluator
```bash
cd /opt/obsqra.starknet/zkdefi/backend/app/services/zkml
touch pool_evaluator.py pool_data_collector.py
# Implement PoolRiskEvaluator class (deterministic scoring)
# Test with mock data
```

### Day 6-7: Deploy VaultManager
```bash
# Deploy to Sepolia testnet
sncast declare --contract-name VaultManager
sncast deploy VaultManager <STRK_ADDRESS> <AUDIT_TRAIL_ADDRESS>
# Store address in ENV
```

**Deliverables:**
- ✅ Risk profile selector UI
- ✅ zkML circuit (deterministic pool scoring)
- ✅ VaultManager contract deployed
- ✅ Can accept deposits with risk profile

---

## Week 2: LLM + Strategy Analysis API (Days 8-14)

### Day 8: LLM Setup
```bash
# Install OpenAI API
pip install openai

# Create .env with API key
echo "OPENAI_API_KEY=sk-..." >> backend/.env
```

### Day 9-10: LLM Strategy Engine
```bash
cd /opt/obsqra.starknet/zkdefi/backend/app/services
touch llm_strategy_engine.py
# Implement LLMStrategyEngine class (code in plan)
# Test with mock pool data
# Fallback to deterministic logic if LLM unavailable
```

### Day 11-12: Analyze Strategy Endpoint
```bash
cd /opt/obsqra.starknet/zkdefi/backend/app/api/routes/strategies
touch analyze.py
# Create POST /strategies/analyze endpoint
# Test end-to-end: risk profile → pool eval → LLM → audit trail
```

### Day 13: Audit Trail Contract
```bash
# Deploy AuditTrail contract
sncast deploy AuditTrail
# Store address
```

### Day 14: Integration Test
```bash
# Test full flow:
1. User deposits via VaultManager
2. Frontend shows risk profile selector
3. User selects "Balanced"
4. Backend analyzes (60% Ekubo + 40% Vesu)
5. Result recorded in audit trail
6. User sees recommendation with confidence & reasoning
```

**Deliverables:**
- ✅ LLM integration working (with fallback)
- ✅ POST /strategies/analyze endpoint
- ✅ AuditTrail contract deployed
- ✅ Proof hashes recorded

---

## Week 3: Execution + Yield Tracking (Days 15-21)

### Day 15-16: EkuboStrategy Contract
```bash
# Deploy to Sepolia
sncast deploy EkuboStrategy <POSITIONS_ADDRESS> <CORE_ADDRESS>
# Test: Can create LP position at specific bounds
```

### Day 17: VersuStrategy Contract
```bash
# Deploy Vesu integration
sncast deploy VersuStrategy <VESU_POOL_ADDRESS>
# Test: Can deposit and accrue interest
```

### Day 18-19: Execution Endpoint
```bash
# Create POST /strategies/execute
# Logic: Route capital based on allocation
# Call EkuboStrategy OR VersuStrategy contracts
# Record execution TX in audit trail
```

### Day 20-21: Yield Tracking
```bash
# Create yield_tracker.py
# Daily scheduler: collect_ekubo_fees() + accrue_vesu_interest()
# Store in yield_records table with pool attribution
# Create GET /yield/history/{user} endpoint
```

**Deliverables:**
- ✅ EkuboStrategy deployed & tested
- ✅ VersuStrategy deployed & tested
- ✅ POST /strategies/execute working
- ✅ Daily yield collection running
- ✅ DB schema for yield tracking

---

## Week 4: Dashboard + Polish (Days 22-28)

### Day 22-23: Dashboard Components
```bash
cd /opt/obsqra.starknet/zkdefi/frontend/src/app/mvp/components
touch YieldBreakdown.tsx PoolAnalysisDisplay.tsx AuditTrailViewer.tsx
# Show allocation per pool
# Show yield by date and source
# Link to TX hashes
```

### Day 24-25: Proof Verification UI
```bash
# Component: ProofVerificationBadge
# Shows: Risk score ✅, Analysis hash ✅, LLM reasoning ✅
# Clickable to see full audit trail entry
```

### Day 26-27: End-to-End Testing
```bash
# Test complete user flow:
1. Deposit 1000 STRK
2. Select "Aggressive" risk
3. See: 70% Ekubo ETH/USDC, 30% Vesu USDC
4. Confirm allocation
5. Contracts execute
6. Dashboard shows positions
7. Wait 24h for fee collection
8. See yield breakdown with sources
9. Click proof to verify on-chain
```

### Day 28: Demo Prep
```bash
# Record screen: Full user flow
# Prepare presentation explaining:
# - Risk profiles & how they work
# - zkML pool evaluation results
# - LLM decision logic
# - Yield attribution proof
```

**Deliverables:**
- ✅ Complete frontend dashboard
- ✅ Proof verification working
- ✅ All contracts deployed & tested
- ✅ Demo ready for stakeholders

---

## File Checklist

### Smart Contracts (`contracts/src/`)
- [ ] `vault_manager_v2.cairo` - Accepts deposits with risk profile
- [ ] `strategy_router_v2.cairo` - Routes to strategies
- [ ] `ekubo_strategy.cairo` - LP position creation
- [ ] `vesu_strategy.cairo` - Lending deposits
- [ ] `audit_trail_v2.cairo` - Records decisions with proofs

### Backend (`backend/app/`)
- [ ] `services/zkml/pool_evaluator.py` - Pool risk scoring
- [ ] `services/pool_data_collector.py` - Fetch real pool metrics
- [ ] `services/llm_strategy_engine.py` - LLM recommendations
- [ ] `services/yield_tracker.py` - Daily yield collection
- [ ] `api/routes/strategies/analyze.py` - Analysis endpoint
- [ ] `api/routes/strategies/execute.py` - Execution endpoint
- [ ] `api/routes/yield/` - Yield tracking endpoints

### Frontend (`frontend/src/`)
- [ ] `app/mvp/components/RiskProfileSelector.tsx`
- [ ] `app/mvp/components/PoolAnalysisDisplay.tsx`
- [ ] `app/mvp/components/StrategyConfirmation.tsx`
- [ ] `app/mvp/components/YieldBreakdown.tsx`
- [ ] `app/mvp/components/AuditTrailViewer.tsx`
- [ ] `app/mvp/pages/Dashboard.tsx` - Main dashboard page

### Documentation
- [x] `MVP_RISK_PROFILE_ZKML_LLM_PLAN.md` - Complete implementation plan
- [x] `CAIRO_CONTRACT_TEMPLATES.md` - Contract code snippets
- [x] `MVP_SCOPE_VERIFIABLE_AI_YIELD.md` - Updated architecture
- [ ] `DEPLOYMENT_GUIDE.md` - How to deploy to mainnet

---

## Key Decision Points

### 1. Which LLM to Use?
- **Option A:** ChatGPT-mini ($0.15 per 1M tokens) - Fast, cheap, good enough
- **Option B:** Local fine-tuned model - More control, but slower
- **Option C:** Deterministic logic (no LLM) - For MVP testing
- **✅ Recommendation:** Start with ChatGPT-mini, fallback to deterministic

### 2. Which Pools on Which DEXs?
- **Ekubo (Sepolia):** ETH/USDC, STRK/USDC ✅
- **JediSwap (Sepolia):** ETH/USDC (check liquidity)
- **Vesu (Sepolia):** USDC lending ✅
- **✅ Recommendation:** Start with Ekubo ETH/USDC + Vesu, add JediSwap if TVL sufficient

### 3. Risk Profile Weights?
- **Conservative:** 70% yield, 30% LP → ~6-10% blended APY
- **Balanced:** 50/50 → ~10-16% blended APY
- **Aggressive:** 30% yield, 70% LP → ~18-35% blended APY
- **✅ Recommendation:** These are reasonable starting points, adjust based on actual pool data

### 4. Verification Frequency?
- **Real-time:** Verify on every tx (expensive)
- **Daily:** Verify after fee collection (reasonable for MVP)
- **Weekly:** Slower feedback (acceptable for yield)
- **✅ Recommendation:** Daily for MVP, can upgrade on mainnet

---

## Testing Strategy

### Unit Tests
```bash
# Test pool evaluator
python -m pytest backend/app/services/zkml/test_pool_evaluator.py

# Test LLM engine
python -m pytest backend/app/services/test_llm_strategy_engine.py
```

### Integration Tests
```bash
# Test contracts
scarb test

# Test API endpoints
pytest backend/app/api/routes/systems/test_strategies.py
```

### End-to-End Tests
```bash
# Deposit 100 STRK → Get recommendation → Execute → Collect fees → Verify
# Should take ~2 hours with manual fee collection
```

---

## Performance Expectations

| Metric | Expected | Notes |
|--------|----------|-------|
| Pool evaluation | <500ms | Parallel evaluation of 10+ pools |
| LLM recommendation | 2-5 sec | API call to OpenAI |
| Total /analyze response | <10 sec | Including pool data fetch |
| Deployment gas | ~500K-1M STRK | For all contracts (~$50-100 in fees) |
| Daily yield collection | <1 min | Parallel fee collection |
| Proof verification | <100ms | On-chain reads |

---

## What to Show in Demo

1. **Risk Profile Selection**
   - Show all 3 profiles with descriptions
   - Highlight allocation percentages

2. **Pool Analysis**
   - Show zkML risk scores for multiple pools
   - Highlight why some pools are "safe" vs "risky"

3. **LLM Recommendation**
   - Show how LLM ranked pools
   - Share the reasoning (e.g., "ETH/USDC is stable (35/100 risk), good for balanced")

4. **Execution**
   - Show contract calls
   - Show audit trail entry created

5. **Yield Attribution**
   - Collect fees manually (can't wait 24h in demo)
   - Show: "$2.50 earned from Ekubo ETH/USDC on Feb 17, verified at 0x..."
   - Click link to see on StarkScan

6. **Risk Flags**
   - Show example: "Pool flagged high slippage (8%), reduced allocation"
   - Prove that circuit is working continuously

---

## Common Issues & Solutions

**Q: LLM API calls are slow**  
A: Use cache for identical inputs, fall back to deterministic logic

**Q: Not enough liquidity on test pools**  
A: Use STRK as deposit token (higher volume), or deploy mock liquidity

**Q: zkML proofs are complicated**  
A: For MVP, just hash the inputs/outputs. Real proofs can be added later.

**Q: Vesu not available on Sepolia**  
A: Fall back to pure Ekubo LP allocation, or find alternative yield protocol

---

## Go/No-Go Checklist

**Week 1 End:**
- [ ] Risk selector UI working
- [ ] Pool evaluator outputting risk scores
- [ ] VaultManager deployed & accepting deposits
- [ ] Audit trail contract deployed

**Week 2 End:**
- [ ] LLM returning recommendations
- [ ] /strategies/analyze endpoint working end-to-end
- [ ] Audit entry recorded on-chain
- [ ] All 4 strategy contracts deployed

**Week 3 End:**
- [ ] Yield collection running daily
- [ ] All strategy contracts executing correctly
- [ ] Yield records stored with pool attribution

**Week 4 End:**
- [ ] Dashboard showing all components
- [ ] Proof verification working
- [ ] Demo flows end-to-end without errors

---

## Next Immediate Steps

1. **Day 1 (Today):**
   - Copy Cairo templates and set up contracts/src
   - Create RiskProfileSelector.tsx component
   - Start pool_evaluator.py

2. **Day 2:**
   - Get first contract compiling
   - Get first pool evaluating (even with mock data)

3. **Day 3:**
   - Deploy VaultManager to Sepolia
   - Test deposit flow

**You've got this! Start with contracts, they're the hardest part. All the backend code is fairly straightforward once contracts are deployed.** 🚀
