# Autonomous Yield Vault: Complete System Architecture

**Current Version:** MVP 1.0  
**Status:** Specification Complete, Ready for Implementation  
**Timeline:** 6-week sprint to launch

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE LAYER                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐ │
│  │  Deposit Card   │ │ Allocation View  │ │  Yield Dashboard        │ │
│  │                 │ │ (Pie Chart)      │ │  (Total + Breakdown)    │ │
│  │ Token + Amount  │ │ Shows: %age of   │ │ By Protocol + Decision  │ │
│  │ Risk Slider 1-10│ │ Nostra, zkLend,  │ │                         │ │
│  │ Est. APY        │ │ Ekubo            │ │                         │ │
│  │ [Deposit Button]│ │ Expected APY     │ │ [View Proof] buttons    │ │
│  └────────┬────────┘ └────────┬─────────┘ └──────────┬───────────────┘ │
│           │                   │                      │                  │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │            Audit Trail Component (Scrollable Timeline)              ││
│  │                                                                      ││
│  │  Decision 1: 2026-02-16 | 50/0/50 allocation | 8.5% APY            ││
│  │    ✓ Proof verified | Resulted in 15 STRK yield                    ││
│  │                                                                      ││
│  │  Decision 2: 2026-02-23 | 40/0/60 allocation | 9.2% APY            ││
│  │    ✓ Proof verified | Resulted in 27 STRK yield                    ││
│  │                                                                      ││
│  │  Rebalance: 2026-02-28 (triggered by volatility spike)             ││
│  │    New allocation: 60/0/40 | New decision hash: 0x789...           ││
│  │                                                                      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│           │                   │                      │                  │
└───────────┼───────────────────┼──────────────────────┼──────────────────┘
            │                   │                      │
          HTTP/REST API Calls (Next.js → FastAPI)
            │                   │                      │
            ▼                   ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND API LAYER (FastAPI)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ POST /vault/deposit                                              │  │
│  │  Input: user, amount, risk_level                                 │  │
│  │  1. RiskProfileEngine.score() → risk_score                       │  │
│  │  2. PoolMetrics.fetch() → current APYs, volatility               │  │
│  │  3. AIAllocationEngine.allocate() → allocation + expected_yield  │  │
│  │  4. ProofGenerator.generate() → proof + decision_hash            │  │
│  │  5. DepositExecutor.execute() → tx_hashes (Nostra, zkLend)      │  │
│  │  6. EkuboLPExecutor.create_position() → position_id (for LP)    │  │
│  │  7. SmartVault.execute_allocation() → on-chain record           │  │
│  │  Output: {decision_hash, proof_hash, position_ids, allocation}  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ GET /vault/yield-breakdown/{user}                                │  │
│  │  1. YieldCollector.collect_all() → yields from all sources       │  │
│  │  2. Group by protocol: Nostra, zkLend, Ekubo                     │  │
│  │  3. Group by decision_hash: which decision led to what yield     │  │
│  │  Output: {total, by_protocol: {}, by_decision: {}}               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ GET /vault/ai-decision/{decision_hash}                           │  │
│  │  1. Query decision from database                                 │  │
│  │  2. Get inputs: risk_score, pool_metrics, model_version          │  │
│  │  3. Get outputs: allocation, expected_yield                      │  │
│  │  4. Get proof: proof_hash, proof_binary, verified                │  │
│  │  5. Get actual_results: yields from this decision_hash           │  │
│  │  Output: {decision, proof, actual_yield, causality_verified}    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ GET /vault/audit/{user}                                          │  │
│  │  1. Query all decisions for user                                 │  │
│  │  2. Query all yields for user                                    │  │
│  │  3. Query all rebalances for user                                │  │
│  │  4. Sort by timestamp                                            │  │
│  │  Output: chronological history of decisions → yields → rebalances│  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ POST /vault/rebalance                                            │  │
│  │  1. RebalanceTrigger.check() → is rebalancing needed?            │  │
│  │  2. (same as /deposit but closes old positions first)            │  │
│  │  3. DepositExecutor.withdraw() → from Nostra/zkLend              │  │
│  │  4. FeesCollector.claim() → LP fees from Ekubo                   │  │
│  │  5. EkuboLPExecutor.close_position() → close old LP              │  │
│  │  6. (then open new positions like /deposit)                      │  │
│  │  Output: {old_decision_hash, new_decision_hash}                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ GET /vault/verify-proof/{proof_hash}                             │  │
│  │  1. Fetch proof from storage (IPFS or centralized)               │  │
│  │  2. Hash proof_binary: hash(proof) == proof_hash?                │  │
│  │  Output: {verified: true/false, proof_type: "Stone/STARK"}      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────┬───────────────────────────────────────────────────────────────┘
           │
           │ Direct Contract Calls (Starknet RPC)
           │ Database Reads/Writes (SQLite)
           │ Async Tasks (APScheduler)
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     BLOCKCHAIN & SERVICE LAYER                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │              STARKNET CONTRACTS (Cairo)                         │  │
│  │                                                                  │  │
│  │  SmartYieldVault                                                │  │
│  │  ├─ deposit(amount, risk_level) → vault_shares                │  │
│  │  ├─ execute_allocation(user, alloc, decision_hash, proof)     │  │
│  │  ├─ record_yield(user, protocol, amount, decision_hash)       │  │
│  │  ├─ rebalance(user, new_alloc, decision_hash, proof)          │  │
│  │  ├─ get_user_allocation(user) → [nostra, zklend, ekubo]       │  │
│  │  ├─ get_user_yield(user) → total_yield                        │  │
│  │  ├─ get_user_decision(user) → latest_decision_hash            │  │
│  │  └─ Events: UserDeposited, AllocationExecuted, YieldRecorded  │  │
│  │                                                                  │  │
│  │  RiskProfileManager                                            │  │
│  │  ├─ set_user_profile(user, risk, horizon, pref)              │  │
│  │  ├─ get_allocation_bounds(risk) → (min_deposits, max_lp)    │  │
│  │  └─ get_safe_protocols(risk) → [list]                        │  │
│  │                                                                  │  │
│  │  YieldTracker                                                  │  │
│  │  ├─ record_yield(user, protocol, amount, tx_hash)            │  │
│  │  ├─ get_user_total_yield(user) → amount                      │  │
│  │  ├─ get_yield_by_protocol(user, protocol) → amount           │  │
│  │  └─ get_yields_by_decision(decision_hash) → [yields]         │  │
│  │                                                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                  │              │              │                       │
│           Calls to:      Calls to:      Calls to:                      │
│                  │              │              │                       │
│  ┌────────────────────────────────────────────────────────┐           │
│  │  EXTERNAL PROTOCOL CONTRACTS (Starknet Sepolia)        │           │
│  │                                                        │           │
│  │  Nostra Lending Protocol                              │           │
│  │  ├─ approve(token, amount)                            │           │
│  │  └─ deposit_with_proof(token, amount, proof)          │           │
│  │      → Returns: position_id, balance                  │           │
│  │                                                        │           │
│  │  zkLend Lending Protocol                              │           │
│  │  ├─ approve(token, amount)                            │           │
│  │  └─ deposit_with_proof(token, amount, proof)          │           │
│  │      → Returns: position_id, balance                  │           │
│  │                                                        │           │
│  │  Ekubo Positions Contract                             │           │
│  │  ├─ approve(token, amount)                            │           │
│  │  └─ mint_and_deposit(pool_key, bounds, amount)        │           │
│  │      → Returns: position_id, liquidity                │           │
│  │                                                        │           │
│  │  Ekubo Core Contract                                  │           │
│  │  └─ collect_fees(position_id)                         │           │
│  │      → Returns: fees_collected, tx_hash               │           │
│  │                                                        │           │
│  └────────────────────────────────────────────────────────┘           │
│                                                                        │
│  ┌────────────────────────────────────────────────────────┐           │
│  │  SERVICE LAYER (Python Classes)                        │           │
│  │                                                        │           │
│  │  RiskProfileEngine                                    │           │
│  │  ├─ score_risk(level, horizon, history)              │           │
│  │  └─ get_allocation_bounds(score)                      │           │
│  │                                                        │           │
│  │  PoolMetrics                                          │           │
│  │  ├─ fetch_nostra_metrics()                            │           │
│  │  ├─ fetch_zklend_metrics()                            │           │
│  │  └─ fetch_ekubo_metrics(pool_key)                    │           │
│  │                                                        │           │
│  │  AIAllocationEngine                                   │           │
│  │  ├─ allocate(risk_score, pool_metrics, amount)       │           │
│  │  └─ optimize_ekubo_position(volatility, price)       │           │
│  │                                                        │           │
│  │  ProofGenerator                                       │           │
│  │  ├─ generate_proof(allocation_data)                  │           │
│  │  └─ hash_decision(inputs, outputs)                   │           │
│  │                                                        │           │
│  │  DepositExecutor                                      │           │
│  │  ├─ execute_deposits(allocation, amounts)            │           │
│  │  └─ withdraw_deposits(user, protocol, amount)        │           │
│  │                                                        │           │
│  │  EkuboLPExecutor                                      │           │
│  │  ├─ create_lp_position(amount, bounds)               │           │
│  │  ├─ close_lp_position(position_id)                   │           │
│  │  └─ calculate_bounds(price, volatility)              │           │
│  │                                                        │           │
│  │  YieldCollector                                       │           │
│  │  ├─ collect_deposit_yield(user, protocol)            │           │
│  │  └─ collect_lp_fees(position_id)                     │           │
│  │                                                        │           │
│  │  RebalanceTrigger                                     │           │
│  │  ├─ check_time_trigger(user)                         │           │
│  │  ├─ check_volatility_trigger(user)                   │           │
│  │  └─ check_yield_trigger(user)                        │           │
│  │                                                        │           │
│  │  RebalanceExecutor                                    │           │
│  │  └─ execute_rebalance(user, new_allocation)          │           │
│  │                                                        │           │
│  │  AuditService                                         │           │
│  │  ├─ get_user_decisions(user)                         │           │
│  │  ├─ get_user_yields(user)                            │           │
│  │  ├─ get_yields_by_decision(decision_hash)            │           │
│  │  └─ get_user_rebalances(user)                        │           │
│  │                                                        │           │
│  └────────────────────────────────────────────────────────┘           │
│                                                                        │
│  ┌────────────────────────────────────────────────────────┐           │
│  │  EXTERNAL SERVICES                                     │           │
│  │                                                        │           │
│  │  Stone/STARK Prover (via obsqra.fi API)              │           │
│  │  ├─ POST /prove {serialized_allocation}              │           │
│  │  └─ Returns: proof_hash, proof_binary                │           │
│  │                                                        │           │
│  │  IPFS or Centralized Storage                         │           │
│  │  └─ Stores: Proofs, decision metadata               │           │
│  │                                                        │           │
│  │  Starknet RPC (Infura/Alchemy/local)                │           │
│  │  └─ Contract calls, event queries                   │           │
│  │                                                        │           │
│  └────────────────────────────────────────────────────────┘           │
│                                                                        │
│  ┌────────────────────────────────────────────────────────┐           │
│  │  LOCAL DATABASE (SQLite)                               │           │
│  │                                                        │           │
│  │  Tables:                                               │           │
│  │  ├─ UserProfile {user, risk_level, time_horizon}     │           │
│  │  ├─ Allocation {user, nostra, zklend, ekubo}         │           │
│  │  ├─ Decision {decision_hash, inputs, outputs, proof}│           │
│  │  ├─ YieldEvent {user, protocol, amount, hash}        │           │
│  │  ├─ Position {position_id, pool_key, bounds}        │           │
│  │  └─ Rebalance {user, old_alloc, new_alloc, time}    │           │
│  │                                                        │           │
│  └────────────────────────────────────────────────────────┘           │
│                                                                        │
│  ┌────────────────────────────────────────────────────────┐           │
│  │  SCHEDULER (APScheduler)                               │           │
│  │                                                        │           │
│  │  Hourly: Check rebalance triggers for all users       │           │
│  │  Daily: Collect yields from all sources               │           │
│  │  Weekly: Generate yield reports                       │           │
│  │                                                        │           │
│  └────────────────────────────────────────────────────────┘           │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: User Deposits

```
┌─────────────┐
│  User      │
│  Deposits  │
│  1000 STRK │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  /vault/deposit endpoint                    │
│  Input: amount=1000, risk_level=6           │
└──────┬──────────────────────────────────────┘
       │
       ├─→ RiskProfileEngine.score(risk_level=6)
       │   └─→ risk_score = 6.0
       │
       ├─→ PoolMetrics.fetch_all()
       │   ├─→ Nostra: APY=4.2%, TVL=50M
       │   ├─→ zkLend: APY=6.1%, TVL=30M
       │   └─→ Ekubo STRK/ETH: APY=12%, volatility=8%
       │
       ├─→ AIAllocationEngine.allocate(risk_score=6, metrics, amount=1000)
       │   ├─→ Base allocation from risk bounds: [50%, 0%, 50%]
       │   ├─→ Fine-tune based on APYs: [45%, 0%, 55%]
       │   ├─→ Calculate allocation amounts: [450, 0, 550]
       │   ├─→ Calculate expected_yield: 8.3% APY
       │   └─→ confidence_score: 0.92
       │
       ├─→ ProofGenerator.generate(allocation_data)
       │   ├─→ Hash inputs: keccak256(risk=6, nostra_apy=4.2, zklend_apy=0, ekubo_apy=12)
       │   │   └─→ inputs_hash = 0xabc...
       │   ├─→ Hash outputs: keccak256([450, 0, 550], 8.3%, 0.92)
       │   │   └─→ outputs_hash = 0xdef...
       │   ├─→ Call Stone prover: /prove {inputs_hash, outputs_hash}
       │   │   └─→ proof_hash = 0x789..., proof_binary = 0x1234...
       │   ├─→ Hash decision: decision_hash = keccak256(model_v1 + inputs_hash + outputs_hash)
       │   │   └─→ decision_hash = 0x555...
       │   └─→ Return: {decision_hash: 0x555..., proof_hash: 0x789...}
       │
       ├─→ DepositExecutor.execute_deposits([450, 0, 550])
       │   ├─→ Check allowance & approve if needed
       │   ├─→ Call Nostra.deposit_with_proof(STRK, 450, proof_hash)
       │   │   └─→ tx_hash = 0xaaaa..., position_id = 42
       │   ├─→ zkLend: skip (allocation = 0)
       │   └─→ Return: {nostra_tx: 0xaaaa..., zklend_tx: None}
       │
       ├─→ EkuboLPExecutor.create_lp_position(550)
       │   ├─→ Calculate bounds: price=1000, volatility=8%
       │   │   ├─→ range = ±20%: lower=800, upper=1200
       │   │   ├─→ Convert to ticks
       │   │   └─→ bounds = {lower_tick, upper_tick}
       │   ├─→ Build pool_key: {STRK, ETH, fee_3000, ext=0}
       │   ├─→ Call Ekubo.mint_and_deposit(pool_key, bounds, 550)
       │   │   └─→ tx_hash = 0xbbbb..., position_id = 7, liquidity = 5000
       │   └─→ Return: {ekubo_tx: 0xbbbb..., position_id: 7}
       │
       ├─→ SmartVault.execute_allocation(
       │   │   user=0x123,
       │   │   nostra=450, zklend=0, ekubo=550,
       │   │   decision_hash=0x555...,
       │   │   proof_hash=0x789...
       │   └─→ On-chain record created, event emitted
       │
       ├─→ Database.store_decision({
       │       decision_hash: 0x555...,
       │       user: 0x123,
       │       inputs: {risk=6, apy_metrics},
       │       outputs: {alloc=[450,0,550], expected_yield=8.3},
       │       proof: {proof_hash: 0x789..., verified: true},
       │       timestamp: 2026-02-16T10:05:00Z
       │   })
       │
       ├─→ Database.store_allocation({
       │       user: 0x123,
       │       nostra: 450,
       │       zklend: 0,
       │       ekubo: 550,
       │       ekubo_position_id: 7,
       │       timestamp: 2026-02-16T10:05:00Z
       │   })
       │
       └─→ Return to user:
           {
             "decision_hash": "0x555...",
             "proof_hash": "0x789...",
             "allocation": [450, 0, 550],
             "allocation_tx_hashes": {
               "nostra": "0xaaaa...",
               "ekubo": "0xbbbb..."
             },
             "ekubo_position_id": 7,
             "expected_yield_apy": 8.3,
             "confidence": 0.92
           }

┌─────────────────────────────────────────────────┐
│  Result: User now has:                          │
│  ├─ 450 STRK deposited to Nostra                │
│  ├─ 550 STRK in Ekubo LP position (#7)          │
│  ├─ AI decision recorded on-chain               │
│  ├─ Verifiable proof linked to allocation       │
│  └─ All decision data queryable via audit trail │
└─────────────────────────────────────────────────┘
```

---

## Data Flow: Yield Collection & Tracking

```
┌──────────────────────────────────┐
│  Scheduler: Daily yield check    │
│  Time: 00:00 UTC                 │
└──────────────┬───────────────────┘
               │
               ├─→ For each user with deposits:
               │
               ├─→ YieldCollector.collect_deposits()
               │   ├─→ Call Nostra.get_position_balance(position_id=42)
               │   │   └─→ Current balance = 452 STRK (was 450)
               │   │       Yield earned = 2 STRK
               │   ├─→ Call zkLend: skip (no position)
               │   ├─→ Query blockchain events from last 24h
               │   │   └─→ Find yieldDistributed events
               │   └─→ Return: [{protocol: "nostra", amount: 2}]
               │
               ├─→ YieldCollector.collect_lp_fees()
               │   ├─→ Call Ekubo.collect_fees(position_id=7)
               │   │   └─→ fees = 5.2 STRK (from trading volume)
               │   ├─→ Wait for tx confirmation
               │   ├─→ Update position liquidity in database
               │   └─→ Return: [{protocol: "ekubo", amount: 5.2}]
               │
               ├─→ For each yield collected:
               │   ├─→ Get user's current decision_hash (0x555...)
               │   ├─→ Database.store_yield_event({
               │   │       user: 0x123,
               │   │       protocol: "nostra",
               │   │       amount: 2,
               │   │       decision_hash: 0x555...,
               │   │       source_tx: 0xcccc...,
               │   │       timestamp: 2026-02-20T14:23:00Z,
               │   │       verified: true
               │   │   })
               │   │
               │   └─→ SmartVault.record_yield(
               │           user=0x123,
               │           protocol="nostra",
               │           amount=2,
               │           decision_hash=0x555...
               │       )
               │       └─→ Immutable on-chain record created
               │
               └─→ YieldEvent created:
                   {
                     "protocol": "nostra",
                     "amount": 2,
                     "decision_hash": "0x555...",
                     "source_tx": "0xcccc...",
                     "timestamp": "2026-02-20T14:23:00Z",
                     "verified": true
                   }

┌──────────────────────────────────────────────────────┐
│  Query: GET /vault/yield-breakdown/0x123             │
├──────────────────────────────────────────────────────┤
│  Aggregates all yield events:                        │
│  ├─ Total earned: 7.2 STRK                          │
│  ├─ By protocol:                                     │
│  │  ├─ nostra: 2.0 STRK                             │
│  │  ├─ zklend: 0 STRK                               │
│  │  └─ ekubo: 5.2 STRK                              │
│  ├─ By decision:                                     │
│  │  └─ 0x555...: 7.2 STRK (from allocation 450/0/550) │
│  └─ Breakdown visible in UI with "View Proof" links │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Query: GET /vault/ai-decision/0x555...              │
├──────────────────────────────────────────────────────┤
│  Returns decision with results:                      │
│  {                                                   │
│    "decision_hash": "0x555...",                      │
│    "timestamp": "2026-02-16T10:05:00Z",             │
│    "model_version": "1.0",                          │
│    "inputs": {                                       │
│      "risk_score": 6,                               │
│      "nostra_apy": 4.2,                            │
│      "ekubo_apy": 12,                              │
│      "ekubo_volatility": 8                          │
│    },                                                │
│    "outputs": {                                      │
│      "allocation": [450, 0, 550],                   │
│      "expected_yield_apy": 8.3,                    │
│      "confidence": 0.92                             │
│    },                                                │
│    "proof": {                                        │
│      "proof_hash": "0x789...",                      │
│      "verified": true,                              │
│      "proof_type": "Stone/STARK"                    │
│    },                                                │
│    "actual_results": {                              │
│      "total_yield_30_days": 7.2,                   │
│      "actual_apy": 8.7,                            │
│      "breakdown": {                                 │
│        "nostra": 2.0,                              │
│        "ekubo": 5.2                                │
│      }                                              │
│    }                                                 │
│  }                                                   │
└──────────────────────────────────────────────────────┘
```

---

## Rebalancing Flow

```
┌────────────────────────────────────┐
│  Scheduler: Hourly rebalance check │
└──────────┬─────────────────────────┘
           │
           ├─→ For each user:
           │
           ├─→ RebalanceTrigger.check_all()
           │   ├─→ check_time_trigger(user)
           │   │   └─→ Last rebalance: 7 days ago → TRIGGERED
           │   ├─→ check_volatility_trigger(user)
           │   │   ├─→ Old volatility: 8%
           │   │   ├─→ Current volatility: 18%
           │   │   └─→ Change = 10% → TRIGGERED
           │   ├─→ check_yield_trigger(user)
           │   │   ├─→ Old expected yield: 8.3%
           │   │   ├─→ Current best yield: 10.5%
           │   │   └─→ Change = 2.2% → TRIGGERED
           │   └─→ Result: YES, rebalance needed
           │
           ├─→ RebalanceExecutor.execute_rebalance(user=0x123)
           │   │
           │   ├─→ Get current allocation: [450, 0, 550]
           │   ├─→ Get current positions: nostra_pos_42, ekubo_pos_7
           │   │
           │   ├─→ Close old positions:
           │   │   ├─→ Nostra.withdraw(position_42, amount=450)
           │   │   │   └─→ Receive: 450 + 2 (yield) = 452 STRK
           │   │   ├─→ Ekubo.close_position(position_7)
           │   │   │   ├─→ Claim remaining fees: 0.8 STRK
           │   │   │   └─→ Burn liquidity, receive: 550 + 5.2 (fees) = 555.2 STRK
           │   │   └─→ Total retrieved: 452 + 555.2 = 1007.2 STRK
           │   │
           │   ├─→ PoolMetrics.fetch_all() [again]
           │   │   ├─→ Nostra: APY=4.2% (unchanged)
           │   │   ├─→ zkLend: APY=6.5% (increased!)
           │   │   └─→ Ekubo: APY=10.5% (decreased due to high volatility)
           │   │
           │   ├─→ AIAllocationEngine.allocate(risk_score=6, new_metrics)
           │   │   ├─→ Old allocation: [45%, 0%, 55%]
           │   │   ├─→ New metrics favor zkLend: yield increased
           │   │   ├─→ Ekubo volatility too high: reduce allocation
           │   │   ├─→ New allocation: [40%, 25%, 35%]
           │   │   ├─→ New amounts: [406, 252, 349] (total 1007.2)
           │   │   └─→ New expected_yield: 8.1% (slightly lower but more stable)
           │   │
           │   ├─→ ProofGenerator.generate(new_allocation_data)
           │   │   ├─→ Hash new inputs/outputs
           │   │   ├─→ Call Stone prover
           │   │   └─→ new_decision_hash = 0x888...
           │   │       new_proof_hash = 0x999...
           │   │
           │   ├─→ Open new positions:
           │   │   ├─→ Nostra.deposit(406) → new position_id=43
           │   │   ├─→ zkLend.deposit(252) → new position_id=44
           │   │   └─→ Ekubo.create_position(349) → new position_id=8
           │   │
           │   ├─→ SmartVault.rebalance(
           │   │       user=0x123,
           │   │       old_allocation=[450, 0, 550],
           │   │       new_allocation=[406, 252, 349],
           │   │       old_decision_hash=0x555...,
           │   │       new_decision_hash=0x888...,
           │   │       new_proof_hash=0x999...
           │   │   )
           │   │   └─→ On-chain event: Rebalanced
           │   │
           │   └─→ Database updates:
           │       ├─ Store new decision with proof
           │       ├─ Update allocation record
           │       ├─ Update position_ids
           │       └─ Store rebalance event
           │
           └─→ User notification (optional):
               {
                 "rebalance_triggered": true,
                 "reason": ["time", "volatility"],
                 "old_allocation": [45, 0, 55],
                 "new_allocation": [40, 25, 35],
                 "new_decision_hash": "0x888...",
                 "new_expected_yield": 8.1,
                 "timestamp": "2026-02-23T09:15:00Z"
               }

┌────────────────────────────────────────────────────────┐
│  Yield attribution remains correct:                    │
│  ├─ Yields from old allocation (2026-02-16 to 2026-02-23) │
│  │  └─ Linked to old decision_hash: 0x555...          │
│  ├─ Yields from new allocation (2026-02-23 onward)    │
│  │  └─ Linked to new decision_hash: 0x888...          │
│  └─ Audit trail shows causality: each decision led to │
│     specific yields                                    │
└────────────────────────────────────────────────────────┘
```

---

## Key Architecture Decisions

### 1. **Decentralized Decision Storage**
- **What:** Every allocation decision is hashed and stored on-chain
- **Why:** Create immutable audit trail, prevent tampering
- **How:** `SmartVault.execute_allocation()` records decision_hash + proof_hash
- **Benefit:** Users can prove AI decision was made and executed as claimed

### 2. **Verifiable AI via Proofs**
- **What:** Every allocation decision is wrapped in a Stone/STARK proof
- **Why:** Prove computation was done correctly without revealing model internals
- **How:** Allocate(inputs) → hash → Stone prover → proof_hash
- **Benefit:** Users can verify `proof_hash` matches expected computation

### 3. **Yield Attribution to Decisions**
- **What:** Every yield event is linked to the allocation decision that produced it
- **Why:** Answer "which AI decision led to how much yield?"
- **How:** `record_yield(amount, decision_hash)` links yield to prior allocation
- **Benefit:** Can audit "decision X produced Y yield" and verify correctness

### 4. **Autonomous Rebalancing with Verification**
- **What:** System automatically rebalances based on market conditions
- **Why:** Optimize yield in response to changing APYs and volatility
- **How:** Hourly trigger check → run AI model → new decision → close/open positions
- **Benefit:** User deposits "set and forget", system optimizes continuously

### 5. **Dual Strategy Execution**
- **What:** Can allocate to BOTH deposits (safe) and LP (risky) simultaneously
- **Why:** Balance risk/reward based on user preference
- **How:** Single deposit → AI splits → execute both protocols → track both yields
- **Benefit:** User gets portfolio of strategies, not single bet

### 6. **Local Database + On-Chain Records**
- **What:** Backend database stores decisions/yields, blockchain stores hashes only
- **Why:** On-chain storage is expensive; hashes are sufficient for verification
- **How:** DB stores full decision; blockchain stores {decision_hash, proof_hash}
- **Benefit:** Scalable + verifiable (users can reconstruct/verify full decision)

---

## Security Considerations

### Access Control
- Only contract owner can deploy/update allocation logic
- Only authorized users can call deposit/rebalance
- No one can modify historical yield records

### Proof Verification
- Every proof is cryptographically signed
- `verify-proof` endpoint checks: hash(proof_binary) == proof_hash
- Invalid proofs are rejected immediately

### Fund Safety
- All deposits held in official protocol contracts (Nostra, zkLend, Ekubo)
- SmartVault has no custody of funds (only records)
- Users can always withdraw from underlying protocols if system fails

### Audit Trail Integrity
- All decisions recorded immutably on-chain
- All yields linked to decision hashes
- Any tampering would be immediately apparent

---

## MVP Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Functionality** | User can deposit → allocate → earn yield → track | Manual test, both flows |
| **Verifiability** | All decisions have valid proofs | `verify-proof` endpoint works |
| **Performance** | Deposit-to-execution <30 seconds | RPC response time <5s |
| **Security** | No fund loss to bugs | Security audit passes |
| **User Experience** | Dashboard shows all info clearly | UI usability test |

---

## Next Steps After MVP

1. **Scale Horizontally:** Add more protocols (Aave, Lido, others)
2. **Improve AI:** Use more sophisticated allocation models
3. **Cross-Chain:** Support Ethereum, Arbitrum, other chains
4. **Composability:** Let users combine vaults (meta-vault of vaults)
5. **Governance:** Let community vote on rebalance triggers
6. **Monetization:** Take % of yield as fee, reinvest in yield improvement research

