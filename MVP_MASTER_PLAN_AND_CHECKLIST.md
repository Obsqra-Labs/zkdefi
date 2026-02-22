# MVP Master Checklist & Architecture Summary

## 🎯 What We're Building

**Product:** AI-optimized yield vault where users deposit tokens, select risk profile, and AI automatically allocates across the best pools (with proofs)

**Key Features:**
1. User selects Conservative/Balanced/Aggressive risk profile
2. zkML circuit evaluates available pools (liquidity, volatility, slippage, fees)
3. Small LLM model recommends allocation across Ekubo LP + Vesu Yield
4. Smart contracts execute allocation on Starknet
5. Daily fee/interest collection with proof-of-source attribution
6. Dashboard shows earnings linked to specific pools + risk flags

**Timeline:** 4 weeks (MVP complete)

**Network:** Starknet Sepolia Testnet

---

## 📚 Complete Documentation Map

**Start Here:**
1. [MVP_RISK_PROFILE_ZKML_LLM_PLAN.md](MVP_RISK_PROFILE_ZKML_LLM_PLAN.md) - Full implementation specs (Week 1-4)
2. [MVP_IMPLEMENTATION_QUICK_START.md](MVP_IMPLEMENTATION_QUICK_START.md) - Day-by-day plan

**Technical Details:**
3. [CAIRO_CONTRACT_TEMPLATES.md](CAIRO_CONTRACT_TEMPLATES.md) - Copy-paste-ready contract code
4. [MVP_SCOPE_VERIFIABLE_AI_YIELD.md](MVP_SCOPE_VERIFIABLE_AI_YIELD.md) - Updated architecture diagram
5. [MVP_WEEK_BY_WEEK_PLAN.md](MVP_WEEK_BY_WEEK_PLAN.md) - Original implementation breakdown (still relevant)

---

## 🏗️ Architecture Overview

### User Flow
```
1. User deposits 1000 STRK
2. Selects risk: Conservative/Balanced/Aggressive
3. Frontend calls: POST /strategies/analyze
   ↓
4. Backend pipeline:
   a) Fetch pool data (Ekubo, JediSwap, Vesu)
   b) Run zkML pool evaluator → risk scores for each
   c) Rank pools by risk-adjusted APY
   d) Call LLM → get recommendation with reasoning
   e) Record in AuditTrail with proof hashes
   ↓
5. Frontend shows recommendation:
   "60% Ekubo ETH/USDC (risk: 35/100), 40% Vesu USDC (risk: 15/100)"
   "Expected blended APY: 12%, Confidence: 87%"
   "LLM reasoning: Stable pair, good volume, matches balanced profile"
   ↓
6. User confirms
   ↓
7. Contracts execute:
   - EkuboStrategy: Creates LP position with 60%
   - VersuStrategy: Deposits 40% for lending
   ↓
8. Daily:
   - Collect Ekubo fees
   - Accrue Vesu interest
   - Store with audit trail link
   ↓
9. Dashboard shows:
   "Week 1 yield: $2.50"
   "  → $1.50 from Ekubo ETH/USDC (pool risk: 35/100) on Feb 17, tx: 0x..."
   "  → $1.00 from Vesu USDC (pool risk: 15/100) on Feb 17, tx: 0x..."
```

---

## 📋 Smart Contracts Needed

### 1. VaultManager (Sepolia)
**File:** `contracts/src/vault_manager_v2.cairo`
**Purpose:** Receive deposits, store risk profile, emit events

**Functions:**
- `deposit(amount, risk_profile)` → deposit_id
- `get_user_deposit(user, deposit_id)` → (amount, risk_profile, status)
- `get_pending_deposits(user)` → [deposit_ids]

**Events:**
- `DepositReceived(user, deposit_id, amount, risk_profile)`

---

### 2. StrategyRouter (Sepolia)
**File:** `contracts/src/strategy_router_v2.cairo`
**Purpose:** Decide which strategy contracts to route to

**Functions:**
- `route_capital(user, amount, allocation)` → execution_params
- `execute_allocation(allocation)` → [tx_hashes]

---

### 3. EkuboStrategy (Sepolia)
**File:** `contracts/src/ekubo_strategy.cairo`
**Purpose:** Create LP positions on Ekubo

**Functions:**
- `create_position(amount, pool_key, bounds)` → position_id
- `collect_fees(position_id)` → (fee0, fee1)

**Contracts to interact with:**
- `0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5` (Ekubo Positions)
- `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` (Ekubo Core)

---

### 4. VersuStrategy (Sepolia)
**File:** `contracts/src/vesu_strategy.cairo`
**Purpose:** Deposit to Vesu lending pool

**Functions:**
- `deposit_for_yield(token, amount)` → deposit_id
- `claim_yield(deposit_id)` → amount

---

### 5. AuditTrail (Sepolia)
**File:** `contracts/src/audit_trail_v2.cairo`
**Purpose:** Store decision records with proof hashes

**Functions:**
- `record_analysis(user, deposit_id, risk_profile, pool_evaluations_hash, llm_reasoning_hash)` → record_id
- `mark_executed(record_id, execution_tx_hash)`
- `get_record(record_id)` → StrategyAnalysisRecord

**Events:**
- `AnalysisRecorded(record_id, user, risk_profile, timestamp)`

---

## 🖥️ Backend API Endpoints Needed

### Analysis Pipeline
**POST `/api/v1/strategies/analyze`**
```json
{
  "user_address": "0x...",
  "deposit_amount": 1000,
  "risk_profile": "balanced",
  "deposit_id": 123,
  "token": "STRK"
}
```
✨ Returns:
```json
{
  "recommendation": {
    "allocation": {"ekubo_eth_usdc": 0.60, "vesu_usdc": 0.40},
    "reasoning": "60% to stable ETH/USDC (35/100 risk), 40% to safe USDC yield...",
    "confidence": 0.87,
    "expected_apy_blended": 0.12,
    "risk_considerations": ["moderate_volatility", "good_liquidity"],
    "pool_analysis": [
      {
        "pool_id": "ekubo_eth_usdc",
        "risk_score": 35,
        "safety_level": "moderate",
        "current_apy": 0.18,
        "recommended_allocation_range": [50, 70]
      },
      ...
    ],
    "proof_hash": "0x..."
  },
  "audit_entry_id": 456,
  "timestamp": "2026-02-17T12:00:00Z"
}
```

---

### Execution
**POST `/api/v1/strategies/execute`**
```json
{
  "user_address": "0x...",
  "audit_entry_id": 456,
  "approved_allocation": {"ekubo_eth_usdc": 0.60, "vesu_usdc": 0.40}
}
```
✨ Returns:
```json
{
  "execution_status": "pending",
  "contracts_to_call": [
    {
      "contract": "EkuboStrategy",
      "function": "create_position",
      "amount": 600,
      "pool_key": {...}
    },
    {
      "contract": "VersuStrategy",
      "function": "deposit_for_yield",
      "amount": 400,
      "token": "USDC"
    }
  ],
  "tx_hashes": ["0x...", "0x..."],
  "audit_updated": true
}
```

---

### Yield Tracking
**GET `/api/v1/yield/history/{user}`**
✨ Returns:
```json
{
  "total_yield": 50.0,
  "currency": "USD",
  "by_pool": {
    "ekubo_eth_usdc_003": {
      "protocol": "ekubo",
      "pool_id": "ekubo_eth_usdc",
      "amount": 30.0,
      "token": "STRK",
      "transactions": [
        {
          "date": "2026-02-17T00:00:00Z",
          "amount": 1.50,
          "tx_hash": "0x...",
          "risk_flag": null
        },
        ...
      ]
    },
    "vesu_usdc": {
      "protocol": "vesu",
      "pool_id": "vesu_usdc",
      "amount": 20.0,
      "token": "USDC",
      "transactions": [...]
    }
  }
}
```

**GET `/api/v1/audit-trail/{entry_id}`**
✨ Returns:
```json
{
  "record_id": 456,
  "user": "0x...",
  "deposit_id": 123,
  "risk_profile": "balanced",
  "timestamp": 1707945600,
  "pool_evaluation_hash": "0x...",
  "llm_reasoning_hash": "0x...",
  "allocation_executed": true,
  "execution_tx_hash": "0x..."
}
```

---

## 🎨 Frontend Components Needed

### Pages
- **MVP Dashboard:** Shows deposits, active allocations, yield breakdown
- **Strategy Analysis:** Shows pool evaluations, LLM recommendation, confidence score

### Components
- **RiskProfileSelector:** 3 cards (Conservative/Balanced/Aggressive)
- **PoolAnalysisDisplay:** Risk scores, flags, APY for each pool
- **StrategyConfirmation:** "60% to X, 40% to Y, expected 12% APY"
- **AllocationExecution:** Shows contract calls in progress
- **YieldBreakdown:** Earnings by date, pool, source TX
- **AuditTrailViewer:** Click to see decision details and proofs
- **ProofVerificationBadge:** ✅ Risk Score Safe, ✅ Analysis Verified, ✅ Execution Recorded

---

## 🛠️ Backend Services Needed

### `services/zkml/pool_evaluator.py`
```python
class PoolRiskEvaluator:
    def evaluate_pool(metrics: PoolMetrics) -> PoolRiskEvaluation
    def evaluate_multiple(metrics_list) -> List[PoolRiskEvaluation]
    def rank_by_risk_adjusted_apy(evaluations, apy_by_pool) -> rankings
```
- Scores pools 0-100 on risk (liquidity, volatility, slippage, volume)
- Deterministic (can generate proofs)
- No randomness, same inputs = same output

### `services/pool_data_collector.py`
```python
class PoolDataCollector:
    async def get_ekubo_pools() -> List[PoolMetrics]
    async def get_jediswap_pools() -> List[PoolMetrics]
    async def get_vesu_rates() -> dict
```
- Queries Starknet RPC for pool data
- Calculates volatility from price history
- Calculates slippage for user's deposit amount

### `services/llm_strategy_engine.py`
```python
class LLMStrategyEngine:
    def generate_recommendation(
        user_risk_profile,
        deposit_amount,
        pool_evaluations,
        apy_by_pool
    ) -> dict
```
- Calls ChatGPT-mini (or local LLM)
- Generates JSON output: allocation %, reasoning, confidence
- Includes fallback deterministic logic if API fails

### `services/yield_tracker.py`
```python
class YieldTracker:
    async def accrue_ekubo_fees() -> None
    async def accrue_vesu_interest() -> None
    async def get_yield_history(user, days) -> List[YieldRecord]
    async def get_yield_breakdown(user) -> dict
```
- Daily scheduler (DAG task or cron)
- Collects fees from Ekubo, interest from Vesu
- Stores in `yield_records` table with pool_id, date, tx_hash

---

## 📊 Database Schema

### `vault_deposits`
```sql
CREATE TABLE vault_deposits (
  id BIGINT PRIMARY KEY,
  user VARCHAR(255),
  deposit_id BIGINT,
  amount NUMERIC,
  risk_profile VARCHAR(50),  -- conservative/balanced/aggressive
  status VARCHAR(50),  -- pending/allocated/executing/completed
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### `strategy_analyses`
```sql
CREATE TABLE strategy_analyses (
  id BIGINT PRIMARY KEY,
  user VARCHAR(255),
  deposit_id BIGINT,
  pool_evaluations_hash VARCHAR(255),
  llm_reasoning_hash VARCHAR(255),
  allocation JSON,  -- {ekubo: 0.6, vesu: 0.4}
  recommendation_json JSON,
  confidence FLOAT,
  expected_apy FLOAT,
  audit_entry_id BIGINT,
  created_at TIMESTAMP
);
```

### `yield_records`
```sql
CREATE TABLE yield_records (
  id BIGINT PRIMARY KEY,
  user VARCHAR(255),
  strategy_allocation_id BIGINT,
  pool_id VARCHAR(255),
  protocol VARCHAR(50),  -- ekubo/vesu
  amount NUMERIC,
  token VARCHAR(50),  -- STRK/USDC/etc
  source_tx_hash VARCHAR(255),
  risk_flag VARCHAR(255),  -- null or "high_slippage" etc
  recorded_at TIMESTAMP
);
```

---

## 🔐 Proof System

### What Gets Hashed
1. **Pool Evaluations:** `hash(pool_metrics + risk_scores + flags)`
2. **LLM Reasoning:** `hash(model_version + input_features + llm_response)`
3. **Allocation:** `hash(allocation percentages + execution params)`

### Verification
User can verify:
- Pool analysis was performed (hash matches on-chain)
- LLM model version was V1.0 (can rebuild hash)
- Execution matched recommendation (TX hash in audit trail)

### Future: Real zkML Proofs
- Generate STARK proofs for pool evaluations
- Generate STARK proofs for LLM decisions
- Verify on-chain (contract checks proof)
- User can prove position APY matches prediction

---

## 🎯 Success Metrics

### Week 1
- [ ] Risk selector UI works
- [ ] Pool evaluator generates risk scores
- [ ] VaultManager deployed & receives deposits
- [ ] Audit trail contract deployed

### Week 2
- [ ] LLM returns recommendations with >80% uptime
- [ ] /strategies/analyze working end-to-end
- [ ] All 4 strategy contracts deployed
- [ ] Can execute Ekubo LP and Vesu deposits

### Week 3
- [ ] Yield collection running daily
- [ ] Yield properly attributed to pools
- [ ] Dashboard shows earnings breakdown
- [ ] Audit trail fully populated

### Week 4
- [ ] Dashboard complete with all features
- [ ] Proof verification UI working
- [ ] Demo runs end-to-end without errors
- [ ] Ready to show to stakeholders

---

## 🚀 Deployment Checklist

### Contract Deployment
```bash
# Week 1
sncast declare --contract-name VaultManager
sncast deploy VaultManager <STRK> <AUDIT_TRAIL>

sncast declare --contract-name AuditTrail
sncast deploy AuditTrail

# Week 2
sncast declare --contract-name EkuboStrategy
sncast deploy EkuboStrategy <EKUBO_POS> <EKUBO_CORE>

sncast declare --contract-name VersuStrategy
sncast deploy VersuStrategy <VESU_POOL>

# Week 3
sncast declare --contract-name StrategyRouter
sncast deploy StrategyRouter <VAULT> <EKUBO> <VESU> <AUDIT>
```

### Backend Deployment
```bash
# Week 1
pip install -r requirements.txt
python -m pytest backend/app/services/zkml/test_pool_evaluator.py

# Week 2
export OPENAI_API_KEY=sk-...
python -m pytest backend/app/services/test_llm_strategy_engine.py

# Week 3
python -m pytest backend/app/api/routes/test_strategies.py

# Week 4
# Set up daily scheduler for yield collection
# Can be: APScheduler, Celery, or native FastAPI Background Tasks
```

### Frontend Deployment
```bash
# Week 2-3
npm install
npm run build

# Week 4
# Deploy to Vercel/Netlify with:
# - NEXT_PUBLIC_VAULT_ADDRESS=0x...
# - NEXT_PUBLIC_BACKEND_URL=https://api.obsqra.xyz
```

---

## 💡 Decision Log

### Risk Profile Allocations
**Decided:** Conservative (70% yield, 30% LP), Balanced (50/50), Aggressive (30% yield, 70% LP)
**Rationale:** Conservative users want safety, Aggressive want returns, Balanced want both

### LLM vs Deterministic
**Decided:** LLM with deterministic fallback
**Rationale:** LLM adds transparency (user sees reasoning), fallback ensures MVP works even if API fails

### Which Pools to Start With
**Decided:** Ekubo ETH/USDC + Vesu USDC on Sepolia
**Rationale:** Highest liquidity, lowest risk on testnet

### Proof System
**Decided:** Hash-based for MVP, upgrade to STARK proofs later
**Rationale:** Faster to ship, still verifiable, easier to upgrade

---

## 📞 Support & Questions

**Blockers:**
- No Vesu on Sepolia? → Fall back to pure Ekubo or add another yield protocol
- LLM API too slow? → Cache results, use smaller model
- Pool liquidity insufficient? → Reduce deposit amounts, add test liquidity

**Performance Tuning:**
- Pool evaluations slow? → Cache for 1 hour
- LLM slow? → Use GPT-4-turbo instead of GPT-4, increase temperature for consistency
- Yield collection slow? → Parallelize fee collection across positions

---

**Status: Ready to implement! Start with contracts (they're the hardest), then backend, then frontend.**

**Questions? Check the detailed docs above. Stuck? Start with the Quick Start guide and Day-1 steps.**

🚀 **Let's ship this MVP!**
