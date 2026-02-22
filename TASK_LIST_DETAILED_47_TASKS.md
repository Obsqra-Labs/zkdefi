# Autonomous Yield Vault MVP: Detailed Task List

**Total Tasks:** 47  
**Estimated Effort:** 6 weeks (40 hrs/week = 240 hrs total)  
**Sprint Structure:** 2-3 day sprints

---

## WEEK 1: FOUNDATION

### Sprint 1.1: Smart Contracts (2 days)

**CONTRACT DEVELOPMENT**

- [ ] **T1.1.1** Create `SmartYieldVault.cairo`
  - Estimate: 4 hours
  - Requirements:
    - `deposit(token_amount, risk_level: u8)` → (vault_shares)
    - `execute_allocation(user, nostra_amt, zklend_amt, ekubo_amt, decision_hash, proof_hash)`
    - `record_yield(user, protocol, amount, decision_hash)`
    - `rebalance(user, new_allocation, decision_hash, proof_hash)`
    - Storage: user_deposits, allocations, yields, decision_hashes, proofs
    - Events: UserDeposited, AllocationExecuted, YieldRecorded, Rebalanced
  - Acceptance: Contract compiles, all functions exist, events emit

- [ ] **T1.1.2** Create `RiskProfileManager.cairo`
  - Estimate: 3 hours
  - Requirements:
    - `set_user_risk_profile(user, risk_level, time_horizon, token_pref)`
    - `get_allocation_bounds(risk_level) → (min_deposits%, max_lp%)`
    - `get_safe_protocols(risk_level) → [list of protocols]`
  - Acceptance: Can set and retrieve risk profiles, bounds are correct

- [ ] **T1.1.3** Create `YieldTracker.cairo`
  - Estimate: 2 hours
  - Requirements:
    - `record_yield(user, protocol, amount, source_tx, decision_hash)`
    - `get_user_total_yield(user) → amount`
    - `get_yield_by_protocol(user, protocol) → amount`
    - `get_yields_by_decision(decision_hash) → [yields]`
  - Acceptance: Yields recorded immutably, queries work correctly

**SETUP & DEPLOYMENT**

- [ ] **T1.1.4** Compile all 3 Cairo contracts
  - Estimate: 1 hour
  - Command: `scarb build`
  - Acceptance: No compilation errors

- [ ] **T1.1.5** Deploy contracts to Sepolia testnet
  - Estimate: 1 hour
  - Steps: Create account, get testnet STRK, deploy via starkli/script
  - Acceptance: Contract addresses recorded, deployment verified on StarkScan

---

### Sprint 1.2: Risk Engine (2.5 days)

**BACKEND SERVICES**

- [ ] **T1.2.1** Create `RiskProfileEngine` service class
  - Estimate: 3 hours
  - Location: `backend/app/services/risk_engine.py`
  - Methods:
    - `score_risk(risk_level: int, time_horizon: int, past_decisions: list) → score: float`
    - `get_allocation_bounds(risk_score) → {min_deposits: %, max_lp: %}`
    - `get_safe_protocols(risk_score) → [list]`
  - Logic:
    - risk_score = risk_level (1-10) + behavior_adjustment (if available)
    - bounds: conservative(3)→85/15, moderate(6)→50/50, aggressive(9)→30/70
  - Acceptance: Takes user prefs → returns risk_score + bounds

- [ ] **T1.2.2** Create `PoolMetrics` service
  - Estimate: 4 hours
  - Location: `backend/app/services/pool_metrics.py`
  - Methods:
    - `fetch_nostra_metrics() → {apy: %, tvl: $, rate: float}`
    - `fetch_zklend_metrics() → {apy: %, tvl: $, rate: float}`
    - `fetch_ekubo_metrics(pool_key) → {apy: %, tvl: $, volatility: float, liquidity_depth: {}}`
  - Data sources:
    - Use existing `/api/v1/phase4a/pool-stats` if available
    - Fallback: hardcoded APYs for MVP (Nostra 4%, zkLend 6%, Ekubo 12%)
  - Caching: 5-minute TTL
  - Acceptance: Returns realistic pool data

- [ ] **T1.2.3** Create User Profile database models
  - Estimate: 2 hours
  - Location: `backend/models/user_profile.py` or update existing models
  - Fields: user_address, risk_level, time_horizon, token_pref, created_at, updated_at
  - Database: SQLite for MVP
  - Acceptance: Can create/update user profiles

- [ ] **T1.2.4** Create database schema and initialization
  - Estimate: 1 hour
  - Script: `backend/db/init.sql` or use SQLAlchemy models
  - Tables: UserProfile, RiskProfile, PoolMetrics (for caching)
  - Acceptance: Database creates without errors

---

### Sprint 1.3: Testing (1 day)

- [ ] **T1.3.1** Write unit tests for RiskProfileEngine
  - Estimate: 2 hours
  - Tests: 10 cases covering all risk levels (1, 3, 5, 6, 9, 10)
  - Verify: allocation_bounds, safe_protocols lists
  - Location: `backend/tests/test_risk_engine.py`

- [ ] **T1.3.2** Write integration test: user_profile → risk_score → allocation_bounds
  - Estimate: 1 hour
  - Test: Create user → set profile → get bounds → verify allocation
  - Acceptance: Full flow works

- [ ] **T1.3.3** Test PoolMetrics service
  - Estimate: 1 hour
  - Mock API calls if needed
  - Verify: Returns valid metrics, caching works

**Week 1 Summary:** Foundation ready (3 contracts deployed, risk engine working, DB initialized)

---

## WEEK 2: AI & PROOFS

### Sprint 2.1: AI Allocation Engine (2 days)

- [ ] **T2.1.1** Create `AIAllocationEngine` service
  - Estimate: 4 hours
  - Location: `backend/app/services/ai_allocation.py`
  - Input: risk_score, pool_metrics, user_amount
  - Logic:
    ```python
    if risk_score <= 3:
      allocation = [0.85, 0, 0.15]  # deposits, zklend, ekubo
    elif risk_score <= 6:
      allocation = [0.50, 0, 0.50]
    else:
      allocation = [0.30, 0, 0.70]
    
    # Fine-tune based on APYs
    if nostra_apy < zklend_apy:
      allocation[0] -= 0.10
      allocation[1] += 0.10
    
    expected_yield = sum(allocation[i] * apy[i] for i in range(3))
    ```
  - Return: allocation (list), expected_yield, confidence_score
  - Acceptance: Produces reasonable allocations

- [ ] **T2.1.2** Create Ekubo pool analyzer
  - Estimate: 3 hours
  - Location: `backend/app/services/ekubo_analyzer.py`
  - Methods:
    - `analyze_pool(pool_key) → {recommended_fee_tier, optimal_range, liquidity_depth}`
    - `optimize_position_range(current_price, volatility) → {lower_tick, upper_tick}`
  - Logic:
    - If volatility > 10%: wider range
    - If volatility < 2%: tight range
    - Fee tier: 3000 bps for moderate volatility (MVP default)
  - Acceptance: Recommends reasonable pool parameters

- [ ] **T2.1.3** Test AI allocation across different risk levels
  - Estimate: 1 hour
  - Tests: risk_level=2 → mostly deposits, risk_level=9 → mostly LP
  - Verify: allocation sums to 100%

---

### Sprint 2.2: Proof Generation (2 days)

- [ ] **T2.2.1** Create `ProofGenerator` service
  - Estimate: 4 hours
  - Location: `backend/app/services/proof_generator.py`
  - Methods:
    - `generate_allocation_proof(allocation_data) → {proof_hash, proof_binary, verified}`
  - Flow:
    1. Serialize: {model_version, inputs_hash, outputs_hash}
    2. Call Stone prover API: `POST /prove` with serialized data
    3. Get back: proof_hash, proof_binary
    4. Hash proof_binary → verify consistency
  - Integration points:
    - Obsqra.fi Stone prover API (URL TBD)
    - OR use hardcoded hashes for MVP testing
  - Acceptance: Can generate and return proofs

- [ ] **T2.2.2** Create verifiable decision format
  - Estimate: 2 hours
  - Location: `backend/models/decision.py`
  - Schema:
    ```json
    {
      "decision_hash": "0x...",
      "timestamp": "2026-02-16T10:05:00Z",
      "model_version": "1.0",
      "model_hash": "0x...",
      "inputs": {
        "inputs_hash": "0x...",
        "data": {...}
      },
      "outputs": {
        "outputs_hash": "0x...",
        "allocation": [0.5, 0, 0.5],
        "expected_yield": 8.5
      },
      "proof": {
        "proof_hash": "0x...",
        "proof_binary": "0x...",
        "verified": true
      }
    }
    ```
  - Acceptance: Decision can be serialized + hashed + verified

- [ ] **T2.2.3** Implement decision hashing algorithm
  - Estimate: 1 hour
  - Hash decision with: keccak256(model_hash + inputs_hash + outputs_hash)
  - Acceptance: Same inputs always produce same decision_hash

- [ ] **T2.2.4** Test proof generation end-to-end
  - Estimate: 1 hour
  - Test: allocation_data → proof → verify
  - Mock Stone API if needed for MVP

**Week 2 Summary:** AI model and proof generation working (can allocate based on risk + generate verifiable proofs)

---

## WEEK 3: EXECUTION LAYER

### Sprint 3.1: Deposit Execution (2 days)

- [ ] **T3.1.1** Create `DepositExecutor` service
  - Estimate: 4 hours
  - Location: `backend/app/services/deposit_executor.py`
  - Methods:
    - `execute_deposits(user, allocation, amounts) → {nostra_tx, zklend_tx, ekubo_tx}`
  - Flow:
    1. If allocation[0] > 0: call `/api/v1/phase4a/deposit_with_proof` for Nostra
       - Parameters: user, amount, proof
       - Get back: tx_hash, position_id
    2. If allocation[1] > 0: call similar endpoint for zkLend
    3. Store tx_hashes for user
  - Error handling: If one fails, rollback others (or mark for manual recovery)
  - Acceptance: Can deposit to Nostra/zkLend, tx_hashes returned

- [ ] **T3.1.2** Create deposit tracking database
  - Estimate: 1 hour
  - Table: DepositRecord {user, protocol, amount, tx_hash, timestamp, status}
  - Status enum: pending, completed, failed
  - Acceptance: Can query deposit history

- [ ] **T3.1.3** Create approval handler
  - Estimate: 2 hours
  - Method: `approve_token_for_deposit(token, spender, amount) → approval_tx`
  - Use existing Starknet SDK
  - Cache: Only approve if allowance < amount
  - Acceptance: Token approvals work

- [ ] **T3.1.4** Test deposit flow with mock protocols
  - Estimate: 1 hour
  - Test: 500 STRK → 250 Nostra + 250 zkLend
  - Verify: Both deposits recorded

---

### Sprint 3.2: LP Position Execution (2.5 days)

- [ ] **T3.2.1** Create `EkuboLPExecutor` service
  - Estimate: 5 hours
  - Location: `backend/app/services/ekubo_executor.py`
  - Methods:
    - `create_lp_position(user, amount, pool_key, bounds) → {position_id, liquidity, tx_hash}`
  - Flow:
    1. Ensure user has approved token to Ekubo
    2. Build PoolKey struct: {token0, token1, fee, extension}
    3. Build Bounds struct: {lower, upper} (ticks)
    4. Call Ekubo Positions contract: `mint_and_deposit`
    5. Parse return: position_id, liquidity
    6. Record position in database
  - Key challenges:
    - Build correct PoolKey (token addresses, fee tier)
    - Calculate ticks from price + volatility
    - Handle contract deployment (address TBD)
  - Acceptance: Can create Ekubo positions on Sepolia

- [ ] **T3.2.2** Research Ekubo Sepolia deployment
  - Estimate: 1 hour
  - Find: Ekubo Positions contract address on Sepolia
  - Find: Core contract address for fee collection
  - Source: Ekubo Discord, GitHub, StarkScan
  - Document: /opt/obsqra.starknet/EKUBO_SEPOLIA_ADDRESSES.md
  - Note: Might need to use testnet address or fork

- [ ] **T3.2.3** Build PoolKey factory
  - Estimate: 2 hours
  - Method: `build_pool_key(token0, token1, fee, extension=0) → PoolKey struct`
  - Use: Ekubo SDK or manual struct building
  - Acceptance: Produces correct PoolKey format

- [ ] **T3.2.4** Build position range calculator
  - Estimate: 2 hours
  - Method: `calculate_bounds(current_price, volatility, range_percentage) → {lower_tick, upper_tick}`
  - Math: Current price = 2^(tick / 2^32), solve for tick
  - Default range: ±20% of current price (MVP conservative)
  - Acceptance: Bounds are mathematically correct

- [ ] **T3.2.5** Create LP position tracking database
  - Estimate: 1 hour
  - Table: LPPosition {user, position_id, pool_key, lower_tick, upper_tick, liquidity, tx_hash, status}
  - Acceptance: Can store and query positions

- [ ] **T3.2.6** Test Ekubo integration
  - Estimate: 1 hour
  - Test: Create position with 500 STRK on STRK/ETH pool
  - Verify: position_id returned, stored in DB

**Week 3 Summary:** Can execute both deposits and LP positions (full allocation execution ready)

---

## WEEK 4: YIELD TRACKING & AUDIT TRAIL

### Sprint 4.1: Yield Collection (2 days)

- [ ] **T4.1.1** Create `YieldCollector` service for deposits
  - Estimate: 3 hours
  - Location: `backend/app/services/yield_collector.py`
  - Methods:
    - `collect_deposit_yield(user, protocol) → {amount, source_tx}`
  - Flow for Nostra/zkLend:
    1. Call protocol's `get_user_balance()` or similar
    2. Compare to stored deposit amount
    3. Difference = yield
    4. Find source transaction (events or RPC query)
  - Alternative: Listen to protocol's YieldUpdated events
  - Acceptance: Can read yield earned from deposits

- [ ] **T4.1.2** Create `FeesCollector` service for LP
  - Estimate: 3 hours
  - Location: `backend/app/services/fees_collector.py`
  - Methods:
    - `collect_lp_fees(position_id) → {amount, source_tx}`
  - Flow:
    1. Find position_id in database
    2. Call Ekubo Core: `get_position_fees()` or `claim_fees()`
    3. Record amount claimed
    4. Extract tx_hash
  - Note: Ekubo might use automated fee collection (need to research)
  - Acceptance: Can claim/read LP fees

- [ ] **T4.1.3** Create yield event database
  - Estimate: 1 hour
  - Table: YieldEvent {user, protocol, amount, claimed_at, source_tx, decision_hash, verified}
  - Acceptance: Can store yield events with decision linkage

- [ ] **T4.1.4** Implement yield collection scheduler
  - Estimate: 2 hours
  - Use: APScheduler or similar
  - Schedule: Daily yield collection at 00:00 UTC
  - Or: Event-triggered when position collected
  - Acceptance: Yields collected automatically

---

### Sprint 4.2: Audit Trail Integration (1.5 days)

- [ ] **T4.2.1** Implement `SmartVault.record_yield()` caller
  - Estimate: 2 hours
  - Location: Integration point in `yield_collector.py`
  - Flow:
    1. After yield collected, get decision_hash from user's latest allocation
    2. Call smart contract: `SmartVault.record_yield(user, protocol, amount, decision_hash)`
    3. Wait for tx confirmation
  - Acceptance: Yields recorded on-chain with decision link

- [ ] **T4.2.2** Create audit trail query service
  - Estimate: 2 hours
  - Location: `backend/app/services/audit_service.py`
  - Methods:
    - `get_user_decisions(user) → [decisions with proofs]`
    - `get_user_yields(user) → [yield events]`
    - `get_yields_by_decision(decision_hash) → [yields from this decision]`
    - `get_user_rebalances(user) → [rebalance events]`
  - Data source: SmartVault contract queries + local DB
  - Acceptance: Can retrieve full audit trail

- [ ] **T4.2.3** Test audit trail end-to-end
  - Estimate: 1 hour
  - Test: User deposits → allocates → earns yield → query → verify all linked
  - Acceptance: decision_hash → yield_hash link works

---

### Sprint 4.3: API Endpoints (1 day)

- [ ] **T4.3.1** Implement `/vault/yield-breakdown/{user}`
  - Estimate: 2 hours
  - Response: {total_yield, by_protocol: {}, by_decision: {}}
  - Logic: Sum yields by protocol, group by decision_hash
  - Acceptance: Returns accurate yield breakdown

- [ ] **T4.3.2** Implement `/vault/ai-decision/{decision_hash}`
  - Estimate: 1 hour
  - Response: decision with inputs, outputs, proof, and resulting yields
  - Acceptance: Shows complete decision with results

- [ ] **T4.3.3** Implement `/vault/audit/{user}`
  - Estimate: 1 hour
  - Response: All decisions + yields + rebalances in chronological order
  - Acceptance: Full history queryable

**Week 4 Summary:** Full yield tracking + audit trail working (can see where every yield came from)

---

## WEEK 5: REBALANCING & FRONTEND

### Sprint 5.1: Autonomous Rebalancing (2 days)

- [ ] **T5.1.1** Create `RebalanceTrigger` service
  - Estimate: 2 hours
  - Location: `backend/app/services/rebalance_triggers.py`
  - Methods:
    - `check_time_trigger(user) → should_rebalance`
    - `check_volatility_trigger(user) → should_rebalance`
    - `check_yield_trigger(user) → should_rebalance`
  - Triggers:
    - **Time**: Every 7 days since last rebalance
    - **Volatility**: If pool volatility changes >10%
    - **Yield**: If better strategy APY exists (diff > 2%)
  - Acceptance: Can identify when rebalancing needed

- [ ] **T5.1.2** Create `RebalanceExecutor` service
  - Estimate: 3 hours
  - Location: `backend/app/services/rebalance_executor.py`
  - Flow:
    1. Get user's current allocation
    2. Run AI model with current pool metrics → new allocation
    3. Close positions:
       - Withdraw from Nostra/zkLend
       - Claim fees + close LP position on Ekubo
    4. Open new positions with new allocation
    5. Record new decision + proof
    6. Emit Rebalanced event on-chain
  - Error handling: If new allocation fails, keep old allocation
  - Acceptance: Can rebalance both deposits and LP

- [ ] **T5.1.3** Implement `/vault/rebalance` endpoint
  - Estimate: 1 hour
  - Accepts: user, optional new_allocation
  - Logic: Calls RebalanceExecutor, returns new decision_hash
  - Acceptance: Endpoint working

- [ ] **T5.1.4** Setup rebalancing scheduler
  - Estimate: 1 hour
  - Check triggers hourly for all users
  - Automatically rebalance if triggered
  - Acceptance: Rebalancing happens automatically

---

### Sprint 5.2: Frontend MVP UI (2.5 days)

- [ ] **T5.2.1** Redesign `/mvp/vault` page layout
  - Estimate: 2 hours
  - Location: `frontend/app/pages/vault.tsx` or similar
  - Layout:
    - Left column: Deposit card + Allocation display (pie chart)
    - Right column: Yield dashboard + Audit trail
  - Acceptance: Page loads, layout is responsive

- [ ] **T5.2.2** Build Deposit Card component
  - Estimate: 3 hours
  - Features:
    - Token selector (defaulted to STRK)
    - Amount input (with "Max" button)
    - Risk profile slider (1-10)
    - "Deposit & Allocate" button
    - Shows estimated APY
  - Integration: Calls `POST /vault/deposit`
  - Acceptance: Can submit deposit request

- [ ] **T5.2.3** Build Allocation Display component
  - Estimate: 2 hours
  - Visual: Pie chart showing Nostra %, zkLend %, Ekubo %
  - Show: Expected APY, confidence score
  - Button: "View AI Decision" → opens modal with decision details
  - Acceptance: Shows allocation clearly

- [ ] **T5.2.4** Build Yield Dashboard component
  - Estimate: 2 hours
  - Displays:
    - Total earned (large number)
    - By protocol breakdown (3 bars or table)
    - By decision breakdown (grouped by timestamp)
    - Timeline (weekly yield chart)
  - Integration: Calls `GET /vault/yield-breakdown/{user}`
  - Acceptance: Shows yield data

- [ ] **T5.2.5** Build Audit Trail component
  - Estimate: 2 hours
  - Displays:
    - List of all decisions (newest first)
    - For each: timestamp, allocation, expected_yield, resulting_yield, proof status
    - Link to "View Proof" for each decision
    - Can expand decision to see inputs/outputs/proof_hash
  - Integration: Calls `GET /vault/audit/{user}`
  - Acceptance: Full audit trail visible

- [ ] **T5.2.6** Build Proof Verification modal
  - Estimate: 1 hour
  - Shows:
    - Decision hash
    - Proof hash
    - "Verify Proof" button → calls `/vault/verify-proof/{hash}`
    - Result: "✓ Valid" or "✗ Invalid"
    - Link to Stone proof details
  - Acceptance: Can verify proofs

- [ ] **T5.2.7** Add error handling and loading states
  - Estimate: 1 hour
  - Show spinners during API calls
  - Show error messages if failures
  - Allow retry
  - Acceptance: UI is responsive to user

**Week 5 Summary:** Rebalancing automated, full UI built (can interact with vault)

---

## WEEK 6: INTEGRATION, TESTING & LAUNCH

### Sprint 6.1: End-to-End Testing (1.5 days)

- [ ] **T6.1.1** Test Flow 1: Conservative User (Deposits-heavy)
  - Estimate: 1.5 hours
  - Steps:
    1. New user, risk_level = 2
    2. Deposit 1000 STRK
    3. AI allocates 85% deposits, 15% LP
    4. Verify: Nostra receives 850, Ekubo receives 150
    5. Wait for yield (mock if needed)
    6. Verify yields recorded with decision_hash
    7. Query audit trail → see all steps
  - Acceptance: Full flow works for conservative profile

- [ ] **T6.1.2** Test Flow 2: Aggressive User (LP-heavy)
  - Estimate: 1.5 hours
  - Steps:
    1. New user, risk_level = 9
    2. Deposit 1000 STRK
    3. AI allocates 30% deposits, 70% LP
    4. Verify: Both protocols receive correct amounts
    5. Verify Ekubo position created with correct parameters
    6. Verify yield from both sources
  - Acceptance: Full flow works for aggressive profile

- [ ] **T6.1.3** Test Flow 3: Rebalancing
  - Estimate: 1 hour
  - Steps:
    1. User with existing allocation
    2. Trigger rebalancing (manually or via volatility)
    3. Verify old positions closed
    4. Verify new positions created
    5. Verify new decision recorded with new decision_hash
    6. Verify yield from old decision still linked to old decision_hash
  - Acceptance: Rebalancing doesn't break audit trail

- [ ] **T6.1.4** Test verifiable AI end-to-end
  - Estimate: 1 hour
  - Steps:
    1. Make allocation decision
    2. Get decision_hash
    3. Get proof_hash
    4. Verify decision: hash(model + inputs + outputs) = decision_hash ✓
    5. Verify proof: hash(proof_binary) = proof_hash ✓
    6. Wait for yield
    7. Query: yields from this decision_hash
    8. Verify audit trail shows causality: AI decision → yielded X
  - Acceptance: Full verifiable chain works

---

### Sprint 6.2: Proof Verification (1 day)

- [ ] **T6.2.1** Implement `/vault/verify-proof/{proof_hash}` endpoint
  - Estimate: 2 hours
  - Logic:
    1. Download Stone proof from storage (IPFS or centralized)
    2. Hash proof_binary: hash(proof) = proof_hash?
    3. If yes: return {verified: true, proof_type: "Stone/STARK"}
    4. If no: return {verified: false, error: "proof mismatch"}
  - Acceptance: Can verify proofs on-demand

- [ ] **T6.2.2** Add proof links to all yield events in UI
  - Estimate: 1 hour
  - For each yield in dashboard: "View Proof" link
  - Link to `/vault/verify-proof/{decision_hash}`
  - Acceptance: All yields are verifiable

- [ ] **T6.2.3** Document proof verification for users
  - Estimate: 1 hour
  - Write: `/docs/PROOF_VERIFICATION_GUIDE.md`
  - Explain: How proofs are generated, what they prove, how to verify
  - Example: Walk through verifying a real decision
  - Acceptance: Users understand verifiable AI

---

### Sprint 6.3: Polish & Documentation (1.5 days)

- [ ] **T6.3.1** Add comprehensive error handling
  - Estimate: 2 hours
  - Check: Every endpoint has try/except
  - Log: All errors with context
  - Return: User-friendly error messages
  - Acceptance: No unhandled exceptions in production

- [ ] **T6.3.2** Add detailed logging
  - Estimate: 1 hour
  - Log: Every decision made, every yield collected, every rebalance
  - Format: timestamp, user, operation, amount, result
  - Location: `backend/logs/vault_operations.log`
  - Acceptance: Can debug production issues

- [ ] **T6.3.3** Create API documentation
  - Estimate: 2 hours
  - Tool: Swagger/OpenAPI
  - Document all 6 endpoints:
    - POST /vault/deposit
    - GET /vault/yield-breakdown/{user}
    - GET /vault/ai-decision/{decision_hash}
    - GET /vault/audit/{user}
    - POST /vault/rebalance
    - GET /vault/verify-proof/{proof_hash}
  - Include: Request/response examples, error codes
  - Acceptance: API fully documented

- [ ] **T6.3.4** Create user guide documentation
  - Estimate: 2 hours
  - Write: `/docs/USER_GUIDE.md`
  - Topics:
    - How to deposit to vault
    - What risk profiles mean
    - How AI allocates
    - How to read yield dashboard
    - How to verify AI decisions
    - What to expect from rebalancing
  - Acceptance: Non-technical user can follow guide

- [ ] **T6.3.5** Create deployment guide
  - Estimate: 1 hour
  - Write: `/docs/DEPLOYMENT.md`
  - Steps: Environment setup, contract deployment, API startup, frontend build
  - Acceptance: Can reproduce deployment from scratch

- [ ] **T6.3.6** Create demo script
  - Estimate: 1 hour
  - Location: `scripts/demo_vault.py` or similar
  - Steps:
    1. Create test user with risk_level = 5
    2. Deposit 1000 STRK
    3. Get AI decision
    4. Display allocation
    5. Check yields (or mock)
    6. Show audit trail
  - Can run: `python scripts/demo_vault.py`
  - Acceptance: Demo shows all major features

---

### Sprint 6.4: Launch Preparation (1 day)

- [ ] **T6.4.1** Performance testing
  - Estimate: 1 hour
  - Test: Deposit → allocation in <30 seconds
  - Test: AI decision generated in <5 seconds
  - Test: API queries return in <500ms
  - Acceptance: Performance meets requirements

- [ ] **T6.4.2** Security review
  - Estimate: 1.5 hours
  - Check: No hardcoded private keys
  - Check: All inputs validated
  - Check: Access controls working
  - Check: Proofs are cryptographically sound
  - Acceptance: No critical security issues

- [ ] **T6.4.3** Prepare demo video
  - Estimate: 1 hour
  - Record: Full deposit → allocation → yield → audit flow
  - Length: 3-5 minutes
  - Show: UI, AI decision, proof verification
  - Acceptance: Video ready to share

- [ ] **T6.4.4** Prepare client presentation
  - Estimate: 1 hour
  - Slides: System architecture, features, MVP results, next steps
  - Include: Demo video, performance metrics, test results
  - Acceptance: Presentation ready for stakeholders

- [ ] **T6.4.5** Final checklist
  - Estimate: 1 hour
  - [ ] All contracts deployed
  - [ ] All APIs responding
  - [ ] Frontend loads without errors
  - [ ] Can complete deposit → yield → audit flow
  - [ ] Proofs are verifiable
  - [ ] Documentation is complete
  - [ ] Demo script works
  - [ ] Performance metrics met
  - [ ] Security review passed
  - Acceptance: MVP ready for launch

---

## 📊 EFFORT SUMMARY

| Week | Tasks | Hours | Status |
|------|-------|-------|--------|
| **1** | Foundation (3 contracts, risk engine, DB) | 22 | Design phase |
| **2** | AI allocation, proof generation | 20 | Design phase |
| **3** | Deposit + LP execution | 22 | Design phase |
| **4** | Yield tracking, audit trail, APIs | 19 | Design phase |
| **5** | Rebalancing, frontend UI | 22 | Design phase |
| **6** | Testing, docs, launch | 18 | Design phase |
| **TOTAL** | **47 tasks across 6 weeks** | **~123 hours** | **Ready to start** |

---

## 🎯 SUCCESS CRITERIA

Each task must meet these criteria to be marked complete:

1. **Code Quality**
   - Code compiles/passes linting
   - Follows project style guide
   - Has comments for complex logic

2. **Testing**
   - Unit tests exist and pass
   - Integration tests verify end-to-end flow
   - >80% code coverage

3. **Documentation**
   - Code has docstrings
   - Complex algorithms documented
   - Examples provided for usage

4. **Functionality**
   - Task requirements met
   - No critical bugs
   - Error handling in place

---

## 🚀 GETTING STARTED

1. **Week 1 Preparation:**
   - [ ] Clone repo, setup dev environment
   - [ ] Install Cairo compiler, Starknet tools
   - [ ] Setup Python environment (FastAPI, dependencies)
   - [ ] Setup Next.js frontend dev server
   - [ ] Create Sepolia testnet account, get test STRK

2. **Task Assignment:**
   - Assign 2-3 team members per sprint
   - Daily standups to unblock issues
   - Code reviews for every task

3. **Tracking:**
   - Mark tasks as "In Progress" when starting
   - Mark "Complete" when accepted
   - Track blockers and dependencies

---

## 📌 NOTES FOR IMPLEMENTATION

### Potential Blockers
1. **If Ekubo Sepolia deployment missing:** Use hardcoded position IDs for testing
2. **If Stone prover API unavailable:** Generate mock proof_hashes for MVP
3. **If protocol APIs unstable:** Use fallback hardcoded APYs
4. **If Cairo compilation slow:** Use precompiled contracts for testing

### Optimization Opportunities (Post-MVP)
1. Batch operations: multiple user rebalances in 1 tx
2. Proof caching: store common decision proofs
3. Pool aggregation: add more protocols (Nostra alternatives)
4. AI improvements: more sophisticated allocation model

### Risk Mitigation
1. **Daily backups** of contract state
2. **Graduated launch:** Start with small test deposits
3. **Manual override:** Admin can pause rebalancing if issues detected
4. **Proof verification:** Always verify before recording on-chain

