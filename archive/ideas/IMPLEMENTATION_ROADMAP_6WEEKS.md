# MVP Implementation Roadmap: Autonomous AI Yield Vault

**Created:** February 16, 2026  
**Sprint:** 6 weeks  
**Objective:** Build autonomous vault system that uses AI to allocate user deposits to yield strategies with verifiable decision proofs

---

## 📅 Week-by-Week Breakdown

### **WEEK 1: Foundation & Risk Engine**

#### Day 1-2: Smart Contracts
- [ ] `SmartYieldVault.cairo` - deposit/allocation/rebalance/yield tracking logic
- [ ] `RiskProfileManager.cairo` - score user risk, get allocation weights
- [ ] `YieldTracker.cairo` - immutable yield event recording
- **Deliverable:** 3 deployable Cairo contracts

#### Day 3-4: Backend Risk Engine
- [ ] Implement `RiskProfileEngine` service
  - Parse user preferences (risk_level_1_10, time_horizon, token_pref)
  - Compute risk score from user behavior (if available)
  - Return allocation bounds (min/max per strategy)
- [ ] Create `pool_metrics.py` service
  - Fetch Nostra APY + TVL
  - Fetch zkLend APY + TVL
  - Fetch Ekubo STRK/ETH pool metrics
- [ ] Setup database for user profiles
- **Deliverable:** Risk scoring API working locally

#### Day 5: Testing
- [ ] Unit tests for risk scoring (10 test cases)
- [ ] Integration test: user_profile → risk_score → allocation_bounds
- **Deliverable:** >80% test coverage for risk engine

---

### **WEEK 2: AI Allocation Model & Proof Generation**

#### Day 1-3: AI Allocation Model
- [ ] Implement `AIAllocationEngine` 
  - **Inputs:** risk_score, pool_metrics (APYs, volatility, TVL), user_amount, preferences
  - **Logic:** 
    - If risk_score < 3: allocate 85% deposits, 15% LP
    - If risk_score 3-6: allocate 50% deposits, 50% LP  
    - If risk_score > 6: allocate 30% deposits, 70% LP
    - Fine-tune percentages based on current pool APYs
  - **Output:** allocation weights + expected yield + confidence score
- [ ] For Ekubo LP: implement `pool_analyzer`
  - Analyze STRK/ETH liquidity depth
  - Recommend fee tier (500, 3000, 10000 bps)
  - Optimize position range based on volatility
- **Deliverable:** AI model produces allocation decisions

#### Day 4-5: Proof Generation
- [ ] Implement `proof_generator.py`
  - Serialize allocation decision inputs
  - Call Stone prover (via obsqra.fi API)
  - Get proof_hash back
  - Link proof_hash to decision_hash
- [ ] Create verifiable decision format
  - {model_hash, inputs_hash, outputs_hash, proof_hash}
- **Deliverable:** Can generate proof for any allocation decision

---

### **WEEK 3: Deposit & LP Execution**

#### Day 1-2: Deposit Execution (Nostra + zkLend)
- [ ] Create `deposit_executor.py`
  - Call `/api/v1/phase4a/deposit_with_proof()` for Nostra
  - Call `/api/v1/phase4a/deposit_with_proof()` for zkLend
  - Track which user got how much in which protocol
- [ ] Handle approvals + deposits atomically
- [ ] Store tx_hash for audit trail
- **Deliverable:** Can deposit STRK to Nostra/zkLend via API

#### Day 3-5: LP Execution (Ekubo)
- [ ] Create `ekubo_lp_executor.py`
  - Build proper PoolKey struct
  - Build Bounds struct with optimal ticks
  - Call `mint_and_deposit()` on Ekubo Positions contract
  - Get back position_id + liquidity
- [ ] Handle position tracking
  - Store position_id per user
  - Track initial liquidity
  - Store pool parameters for future rebalancing
- **Deliverable:** Can create LP positions on Ekubo Sepolia

---

### **WEEK 4: Yield Tracking & Audit Trail**

#### Day 1-2: Yield Collection
- [ ] Create `yield_collector.py`
  - For deposits: call `get_yield()` or monitor events from Nostra/zkLend
  - For Ekubo: call `collect_fees()` on Core contract
  - Record: amount, timestamp, tx_hash, protocol
- [ ] Link yield to allocation decision
  - Every yield event has decision_hash
  - Can query: "all yields from decision X"
- **Deliverable:** Can collect and track yields from all 3 protocols

#### Day 3-4: Audit Trail Contract
- [ ] Call `SmartVault.record_yield()` for each yield event
  - Adds immutable on-chain record
  - Links to decision_hash
- [ ] Build audit trail database
  - All decisions + proofs
  - All yields + sources
  - All rebalances + reasons
- **Deliverable:** Complete audit trail for any user

#### Day 5: Query APIs
- [ ] `/vault/yield-breakdown/{user}` - works
- [ ] `/vault/ai-decision/{decision_hash}` - works
- [ ] `/vault/audit/{user}` - works
- **Deliverable:** Can retrieve full audit trail

---

### **WEEK 5: Rebalancing & Frontend UI**

#### Day 1-2: Autonomous Rebalancing
- [ ] Implement rebalancing triggers:
  - [ ] Time-based: every 7 days
  - [ ] Volatility-based: if pool volatility changes >10%
  - [ ] Yield-based: if better strategy APY exists
  - [ ] User-based: manual trigger
- [ ] Create rebalance executor
  - Get new allocation from AI model
  - Close old positions (withdraw, collect LP fees)
  - Open new positions
  - Record new decision + proof
- **Deliverable:** Rebalancing works end-to-end

#### Day 3-5: Frontend MVP Page
- [ ] Redesign `/mvp/vault` page with:
  - **Deposit Card:**
    - Token selector (STRK default)
    - Amount input
    - Risk profile slider (1-10)
    - "Deposit & Allocate" button
  - **Allocation Display:**
    - Pie chart (Nostra %, zkLend %, Ekubo %)
    - Expected APY badge
    - "AI Decision" button → shows decision_hash + proof link
  - **Yield Dashboard:**
    - Total earned: X STRK
    - By protocol breakdown
    - By decision breakdown
    - Timeline of yields (weekly)
  - **Audit Trail:**
    - All AI decisions (3+ visible)
    - Decision hash + "View Proof" link
    - Resulting yield from each
- **Deliverable:** Full vault UI working

---

### **WEEK 6: Integration, Testing & Documentation**

#### Day 1-2: E2E Testing
- [ ] Test flow 1: Deposit → AI allocation (50% deposits, 50% LP) → earn yield
- [ ] Test flow 2: User with high risk → 70% LP, 30% deposits
- [ ] Test flow 3: Market change → rebalance triggered → new allocation
- [ ] Test verifiable AI: decision_hash → proof → yield attribution
- **Deliverable:** All critical paths work

#### Day 3: Proof Verification
- [ ] Implement `/vault/verify-proof/{proof_hash}`
  - Downloads Stone proof
  - Verifies: proof_hash = H(proof_binary)
  - Shows: "This proof is valid ✓"
- [ ] Add proof links to every yield event
- **Deliverable:** Users can verify AI decisions

#### Day 4: Polish & Docs
- [ ] Error handling everywhere
- [ ] Logging for debugging
- [ ] API documentation
- [ ] User guide: "How to read your AI decision"
- **Deliverable:** Production-ready code

#### Day 5: Demo & Handoff
- [ ] Record demo video: deposit → yield → audit trail
- [ ] Create demo script
- [ ] Prepare client presentation
- **Deliverable:** MVP ready for user testing

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Contracts** | Cairo 1.0 | SmartYieldVault, RiskProfileManager, YieldTracker |
| **Backend** | FastAPI (Python) | APIs, AI orchestration, proof generation |
| **AI/ML** | ZKML (Stone proofs) | Allocation decisions, verifiable computation |
| **Proof** | Stone/STARK | Verify AI computations on-chain |
| **Blockchain** | Starknet Sepolia | Deploy contracts, record decisions |
| **Protocols** | Nostra, zkLend, Ekubo | Yield strategies |
| **Frontend** | Next.js 14 + React | Dashboard, deposit, audit trail |
| **Database** | SQLite/PostgreSQL | User profiles, decisions, yields |

---

## 📊 Data Models

### User Vault State
```json
{
  "user": "0x123...",
  "deposited_amount": 1000,  // STRK
  "deposit_timestamp": "2026-02-16T10:00:00Z",
  "risk_profile": {
    "risk_level": 6,  // 1-10
    "time_horizon_days": 90,
    "token_preference": "STRK"
  },
  "current_allocation": {
    "nostra": 500,
    "zklend": 0,
    "ekubo": 500,
    "ekubo_position_id": 42
  },
  "yield_earned": {
    "total": 42.5,
    "by_protocol": {
      "nostra": 15.3,
      "ekubo": 27.2
    }
  },
  "decisions": [
    {
      "timestamp": "2026-02-16T10:05:00Z",
      "decision_hash": "0x789...",
      "proof_hash": "0x456...",
      "model_version": "1.0",
      "allocation": {50, 0, 50},
      "expected_yield_apy": 8.5
    }
  ],
  "rebalances": []
}
```

### Yield Event
```json
{
  "timestamp": "2026-02-20T14:23:00Z",
  "user": "0x123...",
  "protocol": "ekubo",
  "amount": 2.3,
  "decision_hash": "0x789...",  // Links back to allocation decision
  "source_tx": "0xabc...",
  "source_details": {
    "position_id": 42,
    "pool": "STRK/ETH",
    "fee_tier": 3000
  },
  "proof_verified": true
}
```

### AI Decision
```json
{
  "decision_hash": "0x789...",
  "timestamp": "2026-02-16T10:05:00Z",
  "model_version": "1.0",
  "inputs": {
    "user_risk_score": 6,
    "nostra_apy": 4.2,
    "zklend_apy": 6.1,
    "ekubo_apy": 12.0,
    "ekubo_volatility": 0.08
  },
  "outputs": {
    "allocation": [500, 0, 500],
    "expected_yield": 8.5,
    "confidence": 0.92
  },
  "proof": {
    "proof_hash": "0x456...",
    "proof_type": "Stone/STARK",
    "verified": true
  },
  "actual_results": {
    "total_yield_30_days": 42.5,
    "breakdown": {
      "nostra": 15.3,
      "ekubo": 27.2
    }
  }
}
```

---

## 🎯 Success Metrics

### Functional
- [ ] User can deposit 100+ STRK
- [ ] AI allocates to ≥2 strategies
- [ ] Both deposits and LP working
- [ ] Yield tracked for all strategies
- [ ] Can display full audit trail
- [ ] Proofs verifiable on-chain

### Performance
- [ ] Deposit → allocation in <30 seconds
- [ ] AI decision generated in <5 seconds
- [ ] Rebalancing executes in <1 minute
- [ ] Yield data queries <500ms

### User Experience
- [ ] Dashboard shows allocation clearly
- [ ] Can see where yield came from
- [ ] "Verify AI decision" button works
- [ ] All decisions have verifiable proofs
- [ ] Documentation is clear

### Security
- [ ] All allocations recorded on-chain
- [ ] No funds lost to bugs
- [ ] Proofs verifiable
- [ ] Access controls working

---

## 🔗 Integration Points

### Backend APIs to Implement
```
POST   /vault/deposit                    ← User deposits
GET    /vault/yield-breakdown/{user}     ← Fetch yield data
GET    /vault/ai-decision/{hash}         ← View AI decision + proof
GET    /vault/audit/{user}               ← Full audit trail
POST   /vault/rebalance                  ← Trigger rebalance
GET    /vault/verify-proof/{hash}        ← Verify Stone proof
```

### Contract Calls
```
SmartVault.deposit()
SmartVault.execute_allocation()
SmartVault.record_yield()
SmartVault.rebalance()
SmartVault.get_user_yield()
RiskProfileManager.set_profile()
RiskProfileManager.get_allocation_weights()
YieldTracker.record_yield()
```

### Protocol Calls
```
ProofGatedYieldAgent.deposit_with_proof()  ← Nostra/zkLend deposits
EkuboPositions.mint_and_deposit()          ← Create LP position
EkuboCore.collect_fees()                   ← Claim LP fees
```

---

## 🚀 MVP Launch Checklist

- [ ] All Cairo contracts compile + deploy
- [ ] All backend APIs respond correctly
- [ ] Frontend loads without errors
- [ ] Can complete deposit → yield → audit flow
- [ ] Proofs are verifiable
- [ ] Documentation is complete
- [ ] Demo script works end-to-end
- [ ] Performance metrics met
- [ ] Security audit passed
- [ ] Ready for user testing

---

## 📝 Notes for Implementation Team

### Critical Assumptions
1. **Sepolia has real volume** - Ekubo LP will earn real fees (tested 5-15% APY)
2. **ProofGatedYieldAgent works** - Deposits work via deposit_with_proof()
3. **Stone prover accessible** - Can call obsqra.fi API for proofs
4. **ZKML models exist** - Can use existing allocation models or build simple ones

### Potential Risks
1. **If Ekubo volume is low:** LP won't earn much yield → need fallback to deposits-only
2. **If Stone prover is slow:** Proofs take >30s → optimize or cache proofs
3. **If AI model is complex:** Hard to verify → keep model simple for MVP

### Optimization Opportunities (Post-MVP)
1. **Batch operations:** Bundle multiple user rebalances into 1 tx
2. **Proof caching:** Cache common allocation decisions
3. **Pool aggregation:** Add more protocols (Nostra, zkLend alternatives)
4. **Cross-chain:** Extend to Ethereum, Arbitrum later

