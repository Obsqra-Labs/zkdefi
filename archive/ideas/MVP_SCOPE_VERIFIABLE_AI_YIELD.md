# zkdefi MVP: Verifiable AI-Driven Yield Generation
**Date:** February 16, 2026  
**Status:** Scoped & Ready to Build  
**Network:** Starknet Sepolia Testnet

---

## Risk Profile System (NEW)

### User Risk Levels
1. **Conservative** (Risk Tolerance: Low)
   - Allocation: 30% LP, 70% Yield
   - Max Pool Risk Score: 30/100
   - Example Pools: Vesu stable yields, Ekubo wide-range LP on ETH/USDC
   - Expected APY: 4-6%

2. **Balanced** (Risk Tolerance: Medium)
   - Allocation: 50% LP, 50% Yield
   - Max Pool Risk Score: 50/100
   - Example Pools: Mix of Ekubo medium-range LP, Vesu yields
   - Expected APY: 8-12%

3. **Aggressive** (Risk Tolerance: High)
   - Allocation: 70% LP, 30% Yield
   - Max Pool Risk Score: 75/100
   - Example Pools: Ekubo tight-range LP on volatile pairs, concentrated positions
   - Expected APY: 18-40%

### Risk Flagging Examples
- Pool liquidity < $100K → "LOW_LIQUIDITY" flag
- Price volatility > 20% 7-day → "HIGH_VOLATILITY" flag
- Slippage > 0.5% at user amount → "HIGH_SLIPPAGE" flag
- If risk_score > user tolerance → "EXCEEDS_USER_TOLERANCE" flag
- DEX not responding → "UNAVAILABLE" flag

---

## zkML Circuit System (NEW)

### Circuit: PoolRiskEvaluator
Evaluates every available pool's risk metrics in zero-knowledge:

```
Inputs (from DEX APIs):
  - Pool ID
  - Liquidity (USD)
  - 24h Volume
  - Implied Volatility
  - Slippage at user amount
  - Fee tier

Computation:
  risk_score = (volatility * 0.40) + (slippage * 0.30) + 
               ((100 - normalized_volume) * 0.20) + (fees * 0.10)
               
  where each component is normalized to 0-100

Output:
  - risk_score (0-100)
  - approved_for_conservative (bool)
  - approved_for_balanced (bool)
  - approved_for_aggressive (bool)
  - proof_commitment (Felt252)
```

### Proof Recording
When circuit evaluates a pool:
1. Input data hash stored (metrics used)
2. Output commitment stored (risk score approved)
3. Timestamp recorded
4. User can verify: "This pool was evaluated on X date with Y metrics, concluded Z risk"

---

## LLM Decision Logic System (NEW)

### LLM: ChatGPT-mini (gpt-3.5-turbo or gpt-4o-mini)

Purpose: **Rank pools by risk-adjusted APY for user's risk profile**

Input to LLM:
```json
{
  "user_risk_profile": "Balanced",
  "deposit_amount": 1000,
  "safe_pools": [
    {"dex": "Ekubo", "pair": "ETH/USDC", "risk_score": 35, "apy": 8.5},
    {"dex": "Vesu", "pair": "USDC", "risk_score": 15, "apy": 4.2},
    {"dex": "JediSwap", "pair": "STRK/USDC", "risk_score": 45, "apy": 12},
  ],
  "risky_pools_flagged": [
    {"dex": "Ekubo", "pair": "STRK/ETH", "risk_score": 72, "flags": ["HIGH_VOLATILITY"]}
  ]
}
```

LLM Logic:
```
User selected "Balanced" risk (tolerance: 50/100)
Safe pools: 3 available, all below tolerance
Risky pools: 1 available, above tolerance → exclude

Recommendation:
- 60% to Ekubo ETH/USDC (risk: 35, APY: 8.5%) → Medium safety, good yield
- 40% to Vesu USDC (risk: 15, APY: 4.2%) → High safety, baseline yield
- Total portfolio risk: ~28/100 (below user tolerance)
- Expected APY: 7.2%
- Confidence: 0.87
```

Output from LLM:
```json
{
  "allocations": [
    {"dex": "Ekubo", "pair": "ETH/USDC", "amount": 600, "reason": "..."},
    {"dex": "Vesu", "pair": "USDC", "amount": 400, "reason": "..."}
  ],
  "total_expected_apy": "7.2%",
  "confidence": 0.87,
  "reasoning": "Balanced user with risk 28/100, within tolerance..."
}
```

### LLM Proof Recording
- Input hash: hash(safe_pools + user_risk)
- Output hash: hash(allocations + apy + reasoning)
- Timestamp
- Model version (gpt-3.5-turbo)
- User can verify: "Same inputs → Same output"

---

## Multi-DEX Support (NEW)

### Pools Available on Sepolia

**Ekubo:**
- ETH/USDC (0.3% fee) - Risk: 35/100
- STRK/USDC (1% fee) - Risk: 45/100
- STRK/ETH (0.3% fee) - Risk: 72/100

**JediSwap:**
- ETH/USDC - Risk: TBD (to be evaluated)
- STRK/USDC - Risk: TBD
- Status: Check availability during Week 1

**Vesu (Lending):**
- Supply STRK - Risk: 18/100, APY: 3-5%
- Supply USDC - Risk: 12/100, APY: 3-4%
- Supply ETH - Risk: 20/100, APY: 4-6%

**Others (if available):**
- Any new DEX on Sepolia goes through the same evaluation circuit
- Automatically added to pool list if liquidity > $50K

---

## Complete User Flow

---

## 📊 MVP Architecture: User Risk → zkML Pool Eval → LLM Recommendation → Deploy

```
User Deposits & Selects Risk Profile
        ↓
┌────────────────────────────────────┐
│  Conservative (30% LP, 70% Yield)  │
│  Balanced (50/50 LP & Yield)       │
│  Aggressive (70% LP, 30% Yield)    │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────────────┐
│  zkML Circuit: Pool Risk Evaluation        │
│  Analyze each available pool:              │
│  - Liquidity (USD)                         │
│  - 24h volume & volatility                 │
│  - Slippage at user's amount               │
│  - Fee structure                           │
│  Output: Risk Score (0-100) + Flags       │
│  Example: Ekubo ETH/USDC → Risk: 35/100   │
│           JediSwap STRK → Risk: 55/100    │
└────────────────────────────────────────────┘
        ↓
┌────────────────────────────────────────────┐
│  LLM Decision Logic (ChatGPT-mini)         │
│  Input: Risk profile + Pool analysis       │
│  Logic: Match pools to user risk level     │
│  Output: Recommendations with APY ranking │
│  Example: "60% Ekubo (35 risk), 40% Vesu" │
│  Proof: Record reasoning + reasoning hash  │
└────────────────────────────────────────────┘
        ↓
    User Reviews & Confirms
        ↓
    ┌─────────────────────┬──────────────────────┐
    ↓                     ↓
┌──────────────────────┐  ┌──────────────────────┐
│ EkuboStrategy        │  │ VersuStrategy        │
│ mint_and_deposit()   │  │ deposit_for_yield()  │
│ Risk: 35/100 ✅      │  │ Risk: 15/100 ✅      │
│ Pool: ETH/USDC       │  │ Token: USDC          │
│ Expected APY: 8%     │  │ Expected APY: 4%     │
└──────────────────────┘  └──────────────────────┘
    ↓                     ↓
┌────────────────────────────────────────────┐
│  AuditTrail: Record Everything             │
│  - zkML pool analysis results              │
│  - LLM recommendation & reasoning          │
│  - User's risk profile selected            │
│  - Execution parameters & TX hashes        │
│  - Proof commitments                       │
│  Queryable: audit_trail/entry_id           │
└────────────────────────────────────────────┘
        ↓
┌────────────────────────────────────────────┐
│  Yield Tracking & Attribution              │
│  - Collect fees daily from Ekubo           │
│  - Collect interest from Vesu              │
│  - Link each $ earned to source pool/date  │
│  - Store with pool risk flag               │
│  - Display: "Earned $X from Pool Y (Risk  │
│             flagged: low slippage Feb 17)" │
└────────────────────────────────────────────┘
```

---

## 🏗️ MVP Build Scope (3-4 weeks)

### Phase 1: Infrastructure (Week 1)
**Goal:** Deploy vault and routing contracts

**Smart Contracts:**
- `VaultManager.cairo` - Receives deposits, holds funds
- `StrategyRouter.cairo` - Routes to LP or Yield based on AI decision
- `EkuboStrategy.cairo` - LP position creation & fee collection
- `VesuStrategy.cairo` - Lending protocol integration

**Backend:**
- `/api/v1/vault/deposit` - Accept user deposits
- `/api/v1/strategies/analyze` - AI analysis endpoint
- `/api/v1/strategies/execute` - Execute chosen strategy
- `/api/v1/yield/track` - Query current yield

**Contracts to Use:**
```
Ekubo (Sepolia):
- Core: 0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
- Positions: 0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5

Vesu (Sepolia):
- Lending Pool: [TBD - verify on deployment]

STRK Token (Sepolia): Native
ETH Token (Sepolia): 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7
USDC (Sepolia): [As available]
```

---

### Phase 2: AI Decision Engine (Week 1-2)
**Goal:** Implement verifiable AI strategy selection

**zkML Model:**
```
Input Features:
- User risk profile (0-100)
- Total asset balance
- Portfolio volatility (if any history)
- Current market conditions
  - Ekubo pool liquidity (STRK/ETH, STRK/USDC)
  - Ekubo implied APY (fee-based)
  - Vesu lending rates
  - Historical 7-day volatility

Model Decision:
IF risk_profile < 40:
  -> 80% to Vesu (safe yield), 20% to Ekubo tight-range LP
  -> Conservative APY target: 4-6%
ELIF risk_profile < 70:
  -> 50% to Ekubo medium-range LP, 50% to Vesu
  -> Balanced APY target: 12-18%
ELSE:
  -> 80% to Ekubo aggressive LP, 20% to Vesu
  -> Growth APY target: 25-40%

Output:
- Strategy choice: LP_CONSERVATIVE | BALANCED | LP_AGGRESSIVE | YIELD_SAFE
- Expected APY range
- Proof commitment hash
- Recommended pool/pair
```

**Audit Trail Recording:**
```python
decision_record = {
    "user_address": "0x...",
    "deposit_amount": 1000,
    "deposit_token": "STRK",
    "risk_profile": 65,
    "model_version": "v1.0",
    "model_hash": "0x...",  # Hash of model weights
    "decision": "BALANCED",
    "chosen_pool": "STRK/ETH",
    "expected_apy": "15%",
    "confidence": 0.92,
    "proof_commitment": "0x...",  # zkML proof hash
    "timestamp": 1707945600,
    "tx_hash": "0x...",  # When executed
}
```

**Backend Implementation:**
```python
@router.post("/strategies/analyze")
async def analyze_strategy(request: DepositRequest):
    # 1. Get user risk profile
    risk_score = get_user_risk_profile(request.user_address)
    
    # 2. Query current protocol data
    ekubo_pools = await fetch_ekubo_pools()  # Get STRK/ETH liquidity & fee stats
    vesu_rates = await fetch_vesu_rates()     # Get lending APY
    
    # 3. Run AI model
    decision = ml_model.predict(
        risk_score=risk_score,
        amount=request.amount,
        ekubo_data=ekubo_pools,
        vesu_data=vesu_rates,
    )
    
    # 4. Generate zkML proof
    proof = await generate_stark_proof(
        model_weights_hash,
        decision_inputs,
        decision_output
    )
    
    # 5. Record decision in audit trail
    audit_entry = audit_trail.record_strategy_decision(
        user=request.user_address,
        decision=decision,
        proof_hash=proof.hash,
    )
    
    return {
        "strategy": decision.strategy,
        "expected_apy": decision.apy_range,
        "confidence": decision.confidence,
        "proof_hash": proof.hash,
        "audit_entry_id": audit_entry.id,
    }
```

---

### Phase 3: Execution & Tracking (Week 2-3)
**Goal:** Execute strategies and track real yield

**Ekubo LP Strategy:**
```cairo
// Create LP position via Positions contract
let pool_key = PoolKey {
    token0: STRK,
    token1: ETH,
    fee: 3000,  // 0.3% fee tier
    tick_spacing: 60,
    extension: 0,
};

// Full range for Conservative, Medium range for Balanced, Tight for Aggressive
let bounds = match risk_level {
    Conservative => (-887200, 887200),  // Full range
    Balanced => (-10000, 10000),        // Medium range
    Aggressive => (-1000, 1000),        // Tight range
};

// mint_and_deposit returns (token_id, liquidity)
let (position_id, liquidity) = positions.mint_and_deposit(
    pool_key,
    bounds,
    min_liquidity: 0,
);

// Store position mapping
vault.positions[user][strategy_id] = position_id;
```

**Fee Collection:**
```python
@router.post("/yield/accrue")
async def accrue_yields():
    """Called daily to collect earned fees"""
    
    for position in active_ekubo_positions:
        # Collect fees from Ekubo
        fees = ekubo_core.collect_fees(
            pool_key=position.pool_key,
            bounds=position.bounds,
        )
        
        # Record in audit trail with proof
        audit_trail.record_fee_accrual(
            user=position.user,
            strategy=position.strategy,
            amount_token0=fees.amount0,
            amount_token1=fees.amount1,
            tx_hash=tx.hash,
            timestamp=now(),
        )
        
    for position in active_vesu_positions:
        # Query accrued interest from Vesu
        accrued = vesu_pool.get_accrued_interest(position.user)
        
        audit_trail.record_interest_accrual(
            user=position.user,
            strategy="YIELD_SAFE",
            amount=accrued,
            timestamp=now(),
        )
```

---

### Phase 4: Frontend & Display (Week 3-4)
**Goal:** Show yield with proof of source

**Frontend Components:**
```tsx
// 1. Deposit Form
<VaultDeposit 
  onAnalyze={(amount) => {
    // Call /strategies/analyze
    // Show: Expected APY, Risk Level, Strategy Choice
    // Show: Proof Hash (clickable to verify)
  }}
/>

// 2. Active Positions
<ActivePositions
  position={{
    strategy: "BALANCED",
    deposited: 1000,
    current_value: 1050,
    yield_earned: 50,
    yield_source: {
      protocol: "Ekubo",
      pool: "STRK/ETH 0.3%",
      date_created: "2026-02-16",
      fees_collected: [
        { date: "2026-02-17", amount: 2.5, tx: "0x..." },
        { date: "2026-02-18", amount: 3.2, tx: "0x..." },
      ]
    },
    apy_realized: "18%",
    proof: {
      ai_decision_hash: "0x...",
      audit_trail_id: "aud_123",
      clickable: true,
    }
  }}
/>

// 3. Yield Breakdown (Verifiable)
<YieldBreakdown
  total_yield={50}
  sources={[
    {
      date: "2026-02-17",
      type: "LP Fee",
      amount: 2.5,
      source_pool: "STRK/ETH (Ekubo)",
      from_tx: "0x...",
      verified: true,
    },
    {
      date: "2026-02-18", 
      type: "LP Fee",
      amount: 3.2,
      source_pool: "STRK/ETH (Ekubo)",
      from_tx: "0x...",
      verified: true,
    },
  ]}
/>
```

---

## 🤖 How AI & zkML Improve This

### 1. **Risk-Aware Allocation** ✅
- AI learns user risk tolerance from behavior/profile
- zkML **proves** the model analyzed all available options
- User can see: "AI compared 5 pools, chose this based on your risk=65"

### 2. **Optimal Strategy Selection** ✅
- Model considers: liquidity, volatility, fee structure, historical APY
- zkML **proves** calculation was correct
- User trusts: "Model decision was mathematically verified"

### 3. **Verifiable Yield Tracking** ✅
- Audit trail links every yield $ to source tx
- AI predicted 15-18% APY, actual was 16.5%
- zkML **proves**: "AI prediction was within 1%, yield delivered as expected"

### 4. **Autonomous Rebalancing** ✅
- AI monitors positions, detects when to rebalance
- zkML **proves** trigger conditions were met
- User sees: "Rebalanced on 2026-02-18 due to price drift 8.2%, proof: 0x..."

### 5. **Transparent Decision History** ✅
- Every decision stored with proof
- User can audit: "On day 5, AI recommended moving 20% to Vesu due to vol spike"
- Verifiable ledger of AI reasoning

---

## 📋 MVP Checklist

### Smart Contracts
- [ ] VaultManager (deposit, withdraw, balance tracking)
- [ ] StrategyRouter (route to LP or Yield)
- [ ] EkuboStrategy (mint_and_deposit, collect_fees)
- [ ] VesuStrategy (lend, claim interest)
- [ ] AuditTrail (record decisions with proofs)

### Backend APIs
- [ ] POST /vault/deposit
- [ ] POST /strategies/analyze (AI model inference)
- [ ] POST /strategies/execute
- [ ] GET /yield/positions
- [ ] POST /yield/accrue (daily fee collection)
- [ ] GET /yield/history/{user}
- [ ] GET /audit-trail/{entry_id} (verify proof)

### Frontend
- [ ] Deposit form
- [ ] Risk profile selector
- [ ] Strategy recommendation display (with proof)
- [ ] Active positions panel
- [ ] Yield breakdown with source verification
- [ ] Audit trail viewer

### zkML Integration
- [ ] Model training/validation script
- [ ] Model-to-proof conversion
- [ ] Proof verification frontend

---

## 🚀 Success Criteria

### Week 1 End:
- Vault contract accepts deposits ✅
- Router compiles and deploys ✅

### Week 2 End:
- AI model makes decisions with 90%+ confidence ✅
- Audit trail records all decisions ✅
- One strategy (Ekubo LP) works end-to-end ✅

### Week 3 End:
- Fee collection working ✅
- Frontend shows yield breakdown ✅
- Proof verification on frontend ✅

### Week 4 End:
- Second strategy (Vesu) fully integrated ✅
- Comprehensive audit trail with proofs ✅
- User can verify yield source ✅

---

## 📊 Realistic Performance Expectations

### Ekubo LP (Sepolia)
- **Strategy:** STRK/ETH 0.3% fee tier
- **Range:** Tight to medium range (user risk dependent)
- **Expected APY:** 15-40% (high on Sepolia due to volatility)
- **Actual variance:** ±5% depending on volume

### Vesu Lending (Sepolia)
- **Strategy:** Supply STRK/USDC
- **Expected APY:** 3-6%
- **Actual variance:** ±1%

### Blended (Recommended)
- **Conservative:** 70% Vesu, 30% Ekubo → 6-10% APY
- **Balanced:** 50% each → 12-18% APY
- **Aggressive:** 30% Vesu, 70% Ekubo → 20-30% APY

---

## 🎓 What This Proves for Mainnet

This MVP demonstrates:
1. ✅ AI can allocate capital intelligently across protocols
2. ✅ Yield generation is verifiable and auditable
3. ✅ Users can see exactly where their returns come from
4. ✅ zkML proofs ensure AI isn't lying about its decisions
5. ✅ Sepolia testnet is viable for yielding concepts

For mainnet, we upgrade to:
- Real protocols: Nostra Finance, zkLend (if recovered), Ekubo mainnet
- Larger APYs: 3-15% realistic range
- Real TVL: Billions in liquidity
- Full compliance: All proofs verifiable on-chain

---

## 🔧 Technical Notes

**Why Sepolia Even Though Testnet?**
- Ekubo is fully functional on Sepolia
- Has actual trading volume (test community)
- Fee collection actually works
- Proves concept before mainnet risk

**What to Do When Mainnet Ready:**
1. Deploy vault contracts to mainnet
2. Integrate real Nostra/other protocols
3. Increase transaction sizes (real STRK, not test)
4. Keep all audit trail logic identical
5. Results will be production-grade

---

## 📝 Next Steps (Immediate)

1. **Create smart contracts** (Day 1-2)
   - Use existing interfaces (ekubo.cairo)
   - Deploy to Sepolia testnet

2. **Build AI model** (Day 2-3)
   - Load real pool data from Ekubo Sepolia
   - Train on synthetic data + real metrics
   - Generate proofs

3. **Connect frontend** (Day 4-5)
   - Wire deposit form to API
   - Show strategy recommendations
   - Display yield breakdown

4. **Launch demo** (Day 6-7)
   - Test full user flow
   - Verify proof chain
   - Demonstrate to stakeholders

---

**Status:** Ready to start coding 🚀
