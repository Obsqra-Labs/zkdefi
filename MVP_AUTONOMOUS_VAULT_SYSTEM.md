# MVP: Autonomous AI-Driven Yield Vault System

**Status:** Experimental Foundation (zkdefi MVP)  
**Date:** February 16, 2026  
**Vision:** User deposits generic token → AI analyzes risk → Allocates to deposits OR LP → Tracks verifiable yield

---

## 🎯 System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER DEPOSIT                              │
│                      (STRK/ETH Token)                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │   SMART VAULT CONTRACT          │
        │  (SmartYieldVault.cairo)        │
        │  - Custody tokens               │
        │  - Track allocations            │
        │  - Manage rebalancing           │
        └────────────────────┬────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
   ┌─────────────────┐              ┌────────────────────┐
   │  RISK ENGINE    │              │  AI MODEL (zkML)   │
   │  - Parse user   │              │  - Analyze pools   │
   │    preferences  │              │  - Predict yield   │
   │  - Score risk   │              │  - Recommend split │
   └────────┬────────┘              └─────────┬──────────┘
            │                                  │
            └──────────────┬───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  ALLOCATION │
                    │   DECISION  │
                    │ (with proof)│
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   ┌────────────┐  ┌────────────┐  ┌────────────────┐
   │  Nostra    │  │  zkLend    │  │   Ekubo LP     │
   │  (Deposits)│  │ (Deposits) │  │   (Positions)  │
   │            │  │            │  │                │
   │ APY: 3-8%  │  │ APY: 4-10% │  │ APY: 5-15%     │
   └────┬───────┘  └────┬───────┘  └────┬───────────┘
        │               │               │
        └───────────────┼───────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │   YIELD TRACKER + AUDIT      │
        │  - Fees earned (per strategy)│
        │  - AI decision hash          │
        │  - Proof of execution        │
        │  - Verifiable AI trail       │
        └──────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │   DASHBOARD (User View)      │
        │  - Deposit: X STRK (Risk: 3) │
        │  - Allocation: 40% deposit,  │
        │    60% LP                    │
        │  - Yield earned: Y STRK      │
        │  - AI decision: visible      │
        └──────────────────────────────┘
```

---

## 📋 MVP Scope: Two Complete Flows

### **FLOW 1: DEPOSIT STRATEGY (Safe Yield)**

```
STEP 1: User Deposits Token
├─ Amount: 1,000 STRK
├─ Risk Profile: Conservative (3/10)
└─ Timeframe: 6 months

STEP 2: Risk Engine Analyzes
├─ User risk score: 3/10 → SAFE
├─ Recommended allocation: 80% deposits, 20% LP
└─ Safe deposit protocols: Nostra, zkLend

STEP 3: AI Model Decision
├─ Input: pool data, APYs, user risk
├─ Model: ZKML (Stone proof)
├─ Output: [Nostra: 50%, zkLend: 30%, Ekubo: 20%]
├─ Decision hash: 0x123abc...
└─ Proof generated: execution_proof.bin

STEP 4: Execute Deposits
├─ Approve SmartVault
├─ Call: deposit_with_proof(protocol_id, amount)
├─ Nostra receives: 500 STRK → earns 4% APY
└─ zkLend receives: 300 STRK → earns 6% APY

STEP 5: Track Yield
├─ Month 1: Earned ~4 STRK (Nostra fees)
├─ Month 2: Earned ~2.4 STRK (zkLend fees)
├─ Audit entry: {decision_hash, yield, source}
└─ User sees: "AI allocated based on your conservative profile"

STEP 6: Rebalance (Optional)
├─ New market conditions detected
├─ AI model recommends shift
├─ Execute rebalance with new proof
└─ Update allocation percentages
```

**Time:** 30 seconds to deposit, then autonomous  
**Risk:** Low (protocol audits, diversified)  
**Yield:** Predictable 4-8% APY

---

### **FLOW 2: LP STRATEGY (Higher Yield)**

```
STEP 1: User Deposits Token
├─ Amount: 1,000 STRK
├─ Risk Profile: Moderate (6/10)
└─ Timeframe: 3 months

STEP 2: Risk Engine Analyzes
├─ User risk score: 6/10 → MODERATE
├─ Recommended allocation: 40% deposits, 60% LP
└─ LP pairs: STRK/ETH (primary), STRK/USDC (secondary)

STEP 3: AI Model Decision (Pool Analysis)
├─ Analyze Ekubo STRK/ETH pool:
│  ├─ 24h volume: $50k
│  ├─ Current APY: 12%
│  ├─ Volatility: moderate (0.08)
│  └─ Concentration: Full range (-887200 to +887200)
├─ Model: ZKML analyzes:
│  ├─ Volatility vs APY (good trade-off)
│  ├─ Liquidity depth
│  ├─ Fee tier recommendations
│  └─ Range concentration optimization
├─ Output: {
│     "pool": "STRK/ETH (3000 bps fee)",
│     "amount0": 600,
│     "amount1": 400,
│     "range": "full",
│     "concentration": "0.8"
│   }
├─ Decision hash: 0x456def...
└─ Proof generated: allocation_proof.bin

STEP 4: Create Ekubo LP Position
├─ Call: mint_and_deposit()
│  ├─ pool_key: {STRK, ETH, 3000, 60, 0x0}
│  ├─ bounds: i129{lower: -887200, upper: +887200}
│  └─ liquidity: auto-calculated
├─ Returns: position_id = 42 (NFT token)
└─ Position created on-chain ✓

STEP 5: Monitor & Collect Fees
├─ Week 1: 2.5 STRK in fees (~12% APY realized)
├─ Week 2: 1.8 STRK in fees
├─ Week 3: 3.2 STRK in fees (high volume)
├─ Audit trail: each fee collection logged
└─ Proof: tx_hash tied to decision_hash

STEP 6: Autonomous Rebalancing
├─ Price moves +15% (out of optimal range)
├─ AI detects: volatility increased, range no longer optimal
├─ Recommends: concentrate range closer to current price
├─ Execute: withdraw position, mint new one
├─ New decision hash, new proof
└─ User sees: "AI rebalanced based on market conditions"

STEP 7: Dashboard View
├─ Deposited: 1,000 STRK
├─ Allocation: 40% Nostra (earning 4% APY)
│           + 60% Ekubo STRK/ETH (earning 12% APY)
├─ Current yield: 9.2 STRK (0.92%)
├─ Month projection: ~11 STRK (1.1%)
├─ AI decisions visible: 3 decisions, 3 proofs, all verifiable
└─ Breakdown by source:
   ├─ Nostra fees: 3.5 STRK
   └─ Ekubo fees: 8.7 STRK (from LP swaps)
```

**Time:** 1 minute to create position, then autonomous  
**Risk:** Medium (impermanent loss possible, but monitored)  
**Yield:** Variable 8-15% APY (based on volume)

---

## 🤖 AI/zkML Enhancement Points

### **1. Risk Profile Analysis**
```python
# Backend: risk_engine.py
class RiskProfile:
    - user_provided: (risk_tolerance_1_10, time_horizon, token_preference)
    - computed: (historical_volatility, portfolio_concentration, age)
    
    def allocate(self):
        if risk_score < 3:
            return {deposits: 0.85, lp: 0.15}  # Conservative
        elif risk_score < 6:
            return {deposits: 0.50, lp: 0.50}  # Moderate
        else:
            return {deposits: 0.30, lp: 0.70}  # Aggressive
```

### **2. Pool Analysis Model (ZKML)**
```
Input to AI model:
├─ Pool metrics: volume_24h, volatility, fee_tier
├─ Token metrics: liquidity_depth, price_stability
├─ Market metrics: general volatility, trading patterns
└─ User metrics: risk_score, available_capital

ZKML Model (Stone proof):
├─ Predict optimal fee tier for deposit vs LP
├─ Estimate APY with given parameters
├─ Recommend concentration range (Ekubo)
└─ Generate proof of computation

Output:
├─ allocation_decision: {protocol, amount, parameters}
├─ expected_yield: {min, expected, max}
├─ model_version: v1.2
└─ proof_hash: 0x789ghi...
```

### **3. Yield Attribution & Verifiable AI**
```
For each yield earned:
├─ Source: which protocol, which pool
├─ Quantity: exact amount earned
├─ Cause: AI decision that led to this yield
├─ Proof: decision_hash + execution_hash matches
└─ Audit: immutable on-chain record

Example audit entry:
{
    "user": "0xabc123...",
    "timestamp": 1708099200,
    "decision_hash": "0x456def...",
    "decision_type": "ai_allocation",
    "allocation": {
        "nostra": {"amount": 500, "yield": 2.1},
        "ekubo": {"position_id": 42, "yield": 4.5}
    },
    "total_yield": 6.6,
    "model_version": "1.2",
    "proof_status": "verified",
    "verifiable": true
}
```

### **4. Autonomous Rebalancing Trigger**
```
Monitor continuously:
├─ Market volatility changed significantly
├─ Pool APY shifted >5%
├─ User risk profile changed (new preference)
├─ Position out of optimal range (Ekubo LP)
├─ Yield opportunity mismatch detected
└─ Time-based rebalancing (monthly check)

When triggered:
├─ Call AI model with new pool data
├─ Get new allocation recommendation
├─ Generate new proof
├─ Execute new allocation
└─ Update audit trail with decision
```

---

## 🏗️ MVP Architecture

### **Smart Contracts (Cairo)**

```cairo
// 1. SmartYieldVault.cairo
contract SmartYieldVault {
    // User deposit/withdrawal
    fn deposit(token: ContractAddress, amount: u256) -> vault_share_id
    fn withdraw(vault_share_id: u256, amount: u256) -> token_amount
    
    // Execute AI allocation
    fn execute_allocation(user: Address, allocation_decision: AllocationDecision) 
    
    // Track yield per user
    fn get_user_yield_breakdown(user: Address) -> YieldBreakdown
    
    // Rebalance on AI trigger
    fn rebalance(user: Address, new_allocation: AllocationDecision)
}

// 2. RiskProfileManager.cairo
contract RiskProfileManager {
    fn set_user_risk_profile(user: Address, profile: RiskProfile)
    fn get_recommended_allocation(user: Address) -> AllocationWeights
    fn score_user_risk(user: Address) -> u8  // 0-10
}

// 3. YieldTracker.cairo
contract YieldTracker {
    fn record_yield(
        user: Address,
        protocol: ProtocolId,
        amount: u256,
        decision_hash: felt252,
        proof_hash: felt252
    )
    fn get_yield_audit_trail(user: Address) -> Array<YieldEvent>
}
```

### **Backend APIs**

```python
# 1. /api/v1/vault/deposit
POST /vault/deposit
├─ Input: {token_address, amount, risk_profile}
├─ Risk engine: score_user_risk()
├─ AI model: analyze_allocation()
├─ Execute: deposit_with_proof() to Nostra/zkLend
└─ Return: {vault_share_id, allocation, yield_estimate}

# 2. /api/v1/vault/create-lp
POST /vault/create-lp
├─ Input: {token_amount, pool_preference, risk_score}
├─ AI model: analyze_ekubo_pools()
├─ Execute: mint_and_deposit() on Ekubo
└─ Return: {position_id, expected_yield, decision_proof}

# 3. /api/v1/vault/yield-breakdown
GET /vault/yield-breakdown/{user}
├─ Query: all yield events for user
├─ Group by: protocol, time, decision
├─ Include: decision_hash, proof status, verifiable flag
└─ Return: {total_yield, by_protocol, by_decision, audit_trail}

# 4. /api/v1/vault/rebalance
POST /vault/rebalance/{user}
├─ Trigger: AI detects market change OR time-based
├─ Fetch: current allocation, market data, user risk
├─ AI model: recommend new allocation
├─ Execute: swap/rebalance
└─ Return: {new_allocation, decision_proof, execution_proof}

# 5. /api/v1/vault/ai-decision
GET /vault/ai-decision/{decision_hash}
├─ Retrieve: AI decision details
├─ Include: inputs (pools, volatility), model version, output
├─ Include: Stone proof of computation
├─ Include: actual yield that resulted
└─ Return: {inputs, outputs, proof, verifiable_yes_or_no}
```

### **Frontend (MVP Page)**

```typescript
// /mvp/vault page (complete redesign)

Components:
├─ DepositCard
│  ├─ Token selector (STRK, ETH, USDC)
│  ├─ Amount input
│  ├─ Risk profile selector (Conservative-Aggressive)
│  └─ "Deposit & Let AI Allocate" button
│
├─ AllocationDisplay
│  ├─ Pie chart: Nostra 40% | zkLend 30% | Ekubo 30%
│  ├─ Expected yield: 7.2% APY
│  ├─ "AI Decision" badge with decision_hash link
│  └─ "View AI Reasoning" modal
│
├─ YieldDashboard
│  ├─ Total yield earned: 42.5 STRK
│  ├─ Breakdown by protocol:
│  │  ├─ Nostra: 12.3 STRK (deposits)
│  │  └─ Ekubo: 30.2 STRK (LP fees)
│  ├─ Timeline: earned per week with proof links
│  └─ "Verify Yield Sources" section
│
├─ AuditTrail
│  ├─ Decision history: 5 AI allocation decisions
│  ├─ Each entry shows:
│  │  ├─ Timestamp
│  │  ├─ Model version
│  │  ├─ Input parameters
│  │  ├─ Decision hash
│  │  ├─ Proof status (✓ verified)
│  │  └─ Resulting yield
│  └─ "Full proof" download link
│
└─ RebalanceIndicator
   ├─ Current status: "Optimized (3h ago)"
   ├─ Next rebalance: "In 4d 12h"
   └─ "Manually trigger" button
```

---

## 📊 Implementation Timeline

### **Week 1: Contracts & Risk Engine**
- [ ] SmartYieldVault contract (deposit/withdraw mechanics)
- [ ] RiskProfileManager (scoring, allocation weights)
- [ ] Tests with mock allocations

### **Week 2: AI Integration & Deposits**
- [ ] Nostra & zkLend deposit endpoints
- [ ] ZKML model for yield prediction
- [ ] Proof generation for allocation decisions

### **Week 3: LP Strategy & Ekubo**
- [ ] Ekubo position creation flow
- [ ] Pool analysis AI model
- [ ] Fee collection & tracking

### **Week 4: Yield Tracking & Audit**
- [ ] YieldTracker contract
- [ ] Audit trail with decision hashing
- [ ] Verifiable AI proof linking

### **Week 5: Frontend & UX**
- [ ] Vault deposit UI
- [ ] Allocation visualization
- [ ] Yield dashboard
- [ ] Audit trail explorer

### **Week 6: Testing & Polish**
- [ ] E2E testing (deposit → yield → rebalance)
- [ ] Proof verification UI
- [ ] Documentation & demo

---

## 🎓 How AI/zkML Improves This

| Aspect | Without AI | With ZKML AI |
|--------|-----------|-------------|
| **Risk Management** | Manual allocation | Data-driven scoring + proof of decision |
| **Yield Optimization** | Fixed strategy | Dynamic based on pool analysis + market signals |
| **User Trust** | "Trust us" | "Here's the AI decision, here's the proof" |
| **Rebalancing** | Manual trigger | Autonomous + verifiable decisions |
| **Yield Attribution** | Approximate | Exact: which decision led to which yield |
| **Compliance** | Opaque | Fully auditable AI decision trail |

---

## 🔐 Verifiable AI Stack

```
User Deposits 100 STRK
    ↓
Risk Engine scores: 5/10 (Moderate)
    ↓
ZKML Model receives:
├─ User risk score
├─ Pool data (volume, volatility, APY)
├─ Market conditions
└─ User preferences
    ↓
Model outputs: {allocation_weights, expected_yield, parameters}
    ↓
Stone prover generates: execution_proof.bin
    ↓
Proof hash: 0x789ghi...
    ↓
Execute allocation (Nostra + Ekubo)
    ↓
Month later: Yield earned
    ↓
Query: /vault/ai-decision/0x789ghi...
    ↓
Response: {
    "model_input": {...},
    "model_output": {...},
    "proof": "verified ✓",
    "decision_led_to": {
        "yield": 7.4,
        "breakdown": {...}
    },
    "this_is_verifiable_ai": true
}
```

---

## ✅ MVP Success Criteria

- [x] User can deposit token
- [x] Risk profile affects allocation
- [x] AI model makes allocation decision
- [x] Funds allocated to ≥2 strategies
- [x] Yield tracked per strategy
- [x] Decision hash visible to user
- [x] Proof links show AI reasoning
- [x] Rebalancing triggers (manual)
- [x] Complete audit trail
- [x] "Verifiable AI" badge on yield events

---

## 🚀 Future Phases

### Phase 2: Advanced AI
- Predictive volatility models
- Cross-protocol arbitrage detection
- User preference learning
- Portfolio optimization

### Phase 3: Full Automation
- Autonomous rebalancing 24/7
- Risk-aware position sizing
- Dynamic concentration in Ekubo
- Multi-chain support

### Phase 4: AI Marketplace
- Rent out "AI strategies" to other users
- Performance-based fees
- Leaderboards & reputation
- Composable strategies
