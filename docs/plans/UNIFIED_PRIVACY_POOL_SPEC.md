# Unified Privacy Pool Architecture — Planning Spec

> **Date:** 2026-03-09  
> **Status:** Planning — pre-implementation  
> **Goal:** Collapse the confused vault/dark-ledger/privacy-tier hierarchy into one clean mental model: **privacy pools are the product; agents navigate them; Madara settles proofs.**

---

## 1. The Problem — How We Got Confused

We have **three competing concepts** that all tried to be "the vault":

| Concept | What it became | What's wrong |
|---------|---------------|-------------|
| **Privacy Pools** (original) | 3 on-chain pools (`shielded_pool`, `fully_shielded_pool`, `hashed_withdraw_pool`) with Conservative/Neutral/Aggressive allocation mixes | Clean concept. But the UI buried pool selection — DepositPanel hardcodes `pool_type: "neutral"` |
| **Private Vault** (V1) | Backend ledger crediting an internal balance when you send STRK to an operator address | Custodial. Confusing. Competes with pool deposits for user attention |
| **Dark Ledger** (V2) | Double-entry accounting layer that shadow-records pool deposits for proof settlement on Madara L3 | Good for proof settlement. But the UI presents it as a *place to put money*, which it isn't |

The user sees: Vault balance, Dark Ledger notes, Shielded balance, Privacy pool commitments — **four representations of what should be one thing**.

### The Original Clean Line

```
User picks privacy tier → deposits into corresponding on-chain pool → done
Agent rebalances between pools via session key → proofs settle on Madara
```

That's the killer narrative. Everything else is implementation detail that leaked into the UI.

---

## 2. The Unified Model

### 2.1 Core Principle

> **Privacy pools are the product.** They are allocation buckets with built-in privacy. You deposit into a pool, the agent moves you between pools based on your risk profile. Madara settles proofs. The "vault" is just the bookkeeping layer — invisible to the user.

### 2.2 Architecture (Simplified)

```
┌───────────────────────────────────────────────────────────────────┐
│                          USER SEES                                │
│                                                                   │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│   │ Conservative │  │   Neutral    │  │   Aggressive     │       │
│   │ Pool (80/20) │  │ Pool (50/50) │  │  Pool (20/80)    │       │
│   │ Low risk     │  │  Med risk    │  │  High risk       │       │
│   │ ~4.2% APY    │  │  ~8.7% APY   │  │  ~15.3% APY     │       │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘       │
│          │                 │                  │                    │
│   ┌──────┴─────────────────┴──────────────────┴───────────┐      │
│   │              Privacy Method (per deposit)              │      │
│   │  ○ Shield (Pedersen commitment — amount hidden)        │      │
│   │  ○ Full Privacy (Merkle tree — full anonymity set)     │      │
│   │  ○ Hashed Proof (hash-only withdraw — max unlinkable) │      │
│   └───────────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────┘

                    ON-CHAIN (where custody lives)

┌───────────────────────────────────────────────────────────────────┐
│  shielded_pool.cairo    fully_shielded_pool.cairo                 │
│  hashed_withdraw_pool.cairo                                       │
│  ─────────────────────────────────────────────────────            │
│  Funds are ON-CHAIN in the pool contracts.                        │
│  Commitments hide amounts. Nullifiers hide withdrawals.           │
│  Pool type determines the underlying Ekubo/JediSwap allocation.   │
└───────────────────────────┬───────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
   ┌─────────────┐  ┌──────────┐   ┌──────────────┐
   │  Ekubo LP   │  │ JediSwap │   │   Lending    │
   │  Positions  │  │    LP    │   │   Protocol   │
   └─────────────┘  └──────────┘   └──────────────┘

         AGENT LAYER (invisible to user)

┌───────────────────────────────────────────────────────────────────┐
│  AI Oracle (signals + strategy intelligence + risk engine)         │
│       ↕                                                           │
│  Agent Orchestrator → Session Key → agent_rebalance() on pool     │
│       ↕                                                           │
│  Rebalancer: drift detection → remove/add calldata                │
│       ↕                                                           │
│  Madara L3: proof settlement (facts, not funds)                   │
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 What Each Layer Does

| Layer | Responsibility | NOT responsible for |
|-------|---------------|-------------------|
| **Privacy Pools** (on-chain) | Hold funds. Enforce privacy via commitments/nullifiers. Execute agent rebalances via session keys. | UI, accounting, strategy selection |
| **Agent + Oracle** (backend) | Generate signals. Score risk. Compute allocation. Build calldata. Execute via relayer/session keys. | Holding funds. Privacy proofs. |
| **Madara L3** (settlement) | Register proof facts. Batch settle to L2. Provide verifiable audit trail. | Holding funds. User interaction. |
| **Bookkeeping** (V2 ledger) | Track deposits/withdrawals for analytics/receipts. Shadow-record for credit scoring. | Custody. User-facing display. |
| **Frontend** | Show pool balances. Let user pick pool + privacy method. Show agent recommendations. | Inventing new concepts. |

---

## 3. What Exists Today (Inventory)

### 3.1 Contracts — READY

| Contract | Status | Deployed | Purpose |
|----------|--------|----------|---------|
| `shielded_pool.cairo` | ✅ Complete (650 LOC) | Sepolia | Conservative/Neutral/Aggressive pools. Human + Agent flows. Garaga privacy proofs. Session key gating. Relayer support. |
| `fully_shielded_pool.cairo` | ✅ Complete (662 LOC) | Sepolia | Maximum privacy. Merkle tree commitments. BN254 Poseidon. Selective disclosure. |
| `hashed_withdraw_pool.cairo` | ✅ Complete (300 LOC) | Sepolia | Hash-only withdrawals. Payout via escrow. |
| `vault_controller.cairo` | ✅ Complete (560 LOC) | Sepolia | Adapter registry, circuit breaker, proposal commit/execute rebalancing. |
| `session_key_manager.cairo` | ✅ Complete (273 LOC) | Sepolia | Agent session keys with protocol bitmask + amount limits + expiry. |
| `ekubo_lp_adapter.cairo` | ✅ Complete (146 LOC) | Sepolia | Strategy adapter for Ekubo LP (mock on Sepolia). |
| `lending_adapter.cairo` | ✅ Complete (146 LOC) | Sepolia | Strategy adapter for lending. |
| `staking_adapter.cairo` | ✅ Complete (146 LOC) | Sepolia | Strategy adapter for staking. |
| `relayer.cairo` | ✅ Complete (445 LOC) | Sepolia | Tier-gated private withdrawals to fresh addresses. |
| `confidential_transfer.cairo` | ✅ Complete (266 LOC) | Sepolia | Garaga Groth16 verified private transfers. |
| `confidential_lp_position.cairo` | ⚠️ Disabled | — | Amount-hiding LP. Commented out (scarb 2.14 migration). |
| `proof_gated_lp_agent.cairo` | ⚠️ Disabled | — | Proof-gated LP agent with Garaga. Commented out. |

### 3.2 Backend Services — READY

| Service | Status | What it does |
|---------|--------|-------------|
| `risk_engine.py` | ✅ | Scores user risk 1-10 → Conservative/Balanced/Aggressive + allocation bounds |
| `ai_allocation.py` | ✅ | LLM + deterministic fallback → weighted pool allocations with attestation hash |
| `rebalancer.py` | ✅ | Drift detection → remove/add calldata for position rebalancing |
| `agent_orchestrator.py` | ✅ | Signal → ContractCall mapping, relayer submission |
| `ekubo_lp_service.py` | ✅ | Ekubo LP calldata generation, position tracking |
| `oracle_recommendation_service.py` | ✅ | Personalized "approve/modify" recommendations from strategy intelligence |
| `signals.py` (routes) | ✅ | Constitutional signals (contract, entity, asset, pool) + prediction integration |
| `vault_v2.py` (routes) | ✅ | Double-entry ledger, deposit intent/confirm, notes, sweep, receipts |
| `madara_settlement_service.py` | ✅ | register_fact(), verify_fact(), health_check() on Madara L3 |
| `vault_settlement_hook.py` | ✅ | SHA-256 hashed facts posted to Madara on deposit/withdraw/deploy events |

### 3.3 Frontend — NEEDS REWORK

| Component | Status | Problem |
|-----------|--------|---------|
| `DepositPanel.tsx` | ⚠️ Confused | Has 4 deposit paths (3 privacy methods + dark_ledger transfer). Hardcodes `pool_type: "neutral"`. No pool selection. |
| `WithdrawPanel.tsx` | ⚠️ Confused | 4 withdraw paths. Works but complex. |
| `FullPrivacyPoolPanel.tsx` | ✅ But isolated | Standalone panel with pool selection. Not integrated into the main flow. |
| `ShieldedPoolPanel.tsx` | ✅ But isolated | Standalone panel with pool selection. Not integrated into the main flow. |
| `CapitalLedger.tsx` | ⚠️ Confused | Shows vault balance, dark ledger notes, shielded balance, deployed positions — 4 views of the same capital |
| `VaultSurface.tsx` | ⚠️ Confused | Called "Dark Ledger" in the header. Tab layout mixes vault concerns. |
| `VaultTab.tsx` | ⚠️ Confused | TierSelector above deposit/withdraw, but TierSelector is about privacy method, not pool allocation |
| `TierSelector.tsx` | ✅ Clean | Good UI for picking privacy method. Keep this. |
| `AllocationPools.tsx` | ✅ Clean | Good UI for picking Conservative/Neutral/Aggressive. But not used in deposit flow. |
| `DeployToEkuboCard.tsx` | ✅ Clean | Backend-driven deployment to Ekubo. No pool confusion. |
| `AgentDashboard.tsx` | ✅ Clean | Session keys, rebalancer, compliance. |

---

## 4. The Hackathon MVP — What We Actually Need

### 4.1 The Pitch

> **"Privacy-preserving AI-managed DeFi portfolios on Starknet."**
>
> Deposit into a privacy pool. Pick your risk level. Our AI oracle provides signals, your agent allocates across Ekubo strategies — all while maintaining privacy through commitment-based pools. Proofs settle on a dedicated Madara L3 appchain.

### 4.2 User Flow (Clean)

```
1. Connect wallet
2. See your portfolio: 3 pools (Conservative / Neutral / Aggressive)
   with live APYs from Ekubo strategy data

3. DEPOSIT:
   a. Pick a pool (Conservative / Neutral / Aggressive)   ← NEW: pool selector
   b. Pick privacy method (Shield / Full Privacy / Hashed) ← existing TierSelector
   c. Enter amount
   d. Approve + deposit to the corresponding on-chain pool contract
   e. Commitment saved locally. V2 ledger records fact (invisible).

4. AGENT MANAGES:
   - Oracle generates signals (market data, strategy intelligence)
   - Risk engine scores your profile
   - AI allocation computes target weights per pool
   - Session key + rebalancer moves funds between pools automatically
   - All done privately — agent uses agent_rebalance() on shielded_pool

5. WITHDRAW:
   a. See your commitments per pool
   b. Pick one, enter amount
   c. Withdraw (direct or via relayer for extra privacy)
   d. Nullifier consumed. Funds to your wallet (or fresh address via relayer).

6. SETTLEMENT (invisible):
   - Every deposit/withdraw/rebalance generates a proof
   - Proofs batch to Madara L3 (5s blocks, zero gas)
   - Madara settles state-diffs to Starknet L2
   - User can verify any fact on-chain
```

### 4.3 What Changes in the UI

#### Kill List (remove or hide)
- ❌ "Dark Ledger" as a user-facing concept — it's an implementation detail
- ❌ `dark_ledger` as a privacy method / deposit path — the operator-transfer flow is custodial and contradicts the thesis
- ❌ "Vault balance" vs "Shielded balance" vs "Dark Ledger notes" — one view of capital
- ❌ VaultSurface header "Dark Ledger" — rename to "Privacy Pools" or "Portfolio"
- ❌ The V2 vault as a *visible thing* — it's background bookkeeping

#### Keep List
- ✅ TierSelector (privacy method picker) — rename options to just "Shield / Full Privacy / Hashed Proof"
- ✅ Pool type selector (Conservative/Neutral/Aggressive) — promote into deposit flow
- ✅ CommitmentShield deposit path (existing, works)
- ✅ NullifierSet deposit path (existing, works)
- ✅ HashedProof deposit path (existing, works)
- ✅ AllocationPools component (shows JediSwap/Ekubo splits)
- ✅ Agent dashboard (session keys, rebalancer, compliance)
- ✅ DeployToEkuboCard (backend-driven deployment)
- ✅ V2 ledger as invisible bookkeeping (credit lines, receipts)
- ✅ Madara settlement (invisible, proof settlement)

#### Build/Modify List

| # | Change | Scope | Priority |
|---|--------|-------|----------|
| 1 | **Unified Deposit Flow**: Pool selector (Cons/Neut/Aggr) → Privacy method → Amount → Deposit | VaultTab + DepositPanel | P0 |
| 2 | **Rename VaultSurface** from "Dark Ledger" to "Privacy Pools" | VaultSurface.tsx | P0 |
| 3 | **Pool-centric CapitalLedger**: Show balances PER POOL (not per "tier"), with privacy method badge per commitment | CapitalLedger.tsx | P0 |
| 4 | **Remove dark_ledger deposit path**: Hide PrivacyMethod="dark_ledger" from TierSelector and DepositPanel | TierSelector, DepositPanel, usePrivacyVault | P0 |
| 5 | **Pool type passthrough**: DepositPanel sends actual pool_type (0/1/2) to contracts instead of hardcoded neutral | DepositPanel.tsx | P0 |
| 6 | **Agent Allocation View**: Show where the agent is putting your money (per pool, with Ekubo positions) | New component or modify PositionsOverview | P1 |
| 7 | **Oracle Recommendations Strip**: "AI suggests: Move 20% from Conservative → Aggressive (signal: ETH momentum)" | VaultTab or VaultSurface | P1 |
| 8 | **Credit Line as side panel**: Keep V2 credit data but show as "Borrowing Power" in a secondary panel, not in main flow | CapitalLedger sidebar | P2 |

---

## 5. Detailed Design — Unified Deposit Flow

### 5.1 New VaultTab Layout

```
┌─ Privacy Pools ──────────────────────────────────────────────────┐
│ [Oracle Strip: "ETH/STRK momentum high — Aggressive pool +15%"] │
│                                                                   │
│ ┌─ Pool Selector ──────────────────────────────────────────────┐ │
│ │ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐      │ │
│ │ │ Conservative │ │◉ Neutral     │ │   Aggressive     │      │ │
│ │ │ 80/20 JediEk │ │ 50/50        │ │ 20/80            │      │ │
│ │ │ ~4.2% APY    │ │ ~8.7% APY    │ │ ~15.3% APY       │      │ │
│ │ │ $1,240 dep.  │ │ $830 dep.    │ │ $0 dep.          │      │ │
│ │ └──────────────┘ └──────────────┘ └──────────────────┘      │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─ Privacy Method ─────────────────────────────────────────────┐ │
│ │ ○ Shield (amount hidden)  ◉ Full Privacy (full anon set)     │ │
│ │ ○ Hashed Proof (max unlinkable)                              │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─ Deposit ─────────────────┐ ┌─ Withdraw ──────────────────┐  │
│ │ Amount: [____] STRK ▾     │ │ Select commitment:          │  │
│ │ [Deposit to Neutral Pool] │ │ ▸ 500 STRK (Shield, Cons.)  │  │
│ │                            │ │ ▸ 300 STRK (Full, Neutral)  │  │
│ │ Allocation preview:        │ │ [Withdraw]                   │  │
│ │ Ekubo STRK/ETH 50%        │ │                              │  │
│ │ JediSwap STRK/USDC 50%    │ │ ☐ Use relayer (fresh addr)  │  │
│ └────────────────────────────┘ └──────────────────────────────┘  │
│                                                                   │
│ ┌─ Your Positions ─────────────────────────────────────────────┐ │
│ │ Conservative: 500 STRK (1 x Shield)          ~4.2% APY      │ │
│ │ Neutral:      830 STRK (2 x Full Privacy)    ~8.7% APY      │ │
│ │ Aggressive:   —                                               │ │
│ │ Total:        1,330 STRK                                      │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Deposit Flow (Contract Interaction)

```
User picks: Pool = Neutral, Privacy = Full Privacy, Amount = 500 STRK

Frontend:
  1. POST /v1/zkdefi/full_privacy/deposit/generate_commitment
     → { commitment_u256, secret, nonce, blinding }
  2. token.approve(fully_shielded_pool_address, 500e18)
  3. fully_shielded_pool.deposit_u256(commitment_u256, 500e18)
     → pool_type is embedded in the commitment metadata
  4. POST /v1/zkdefi/full_privacy/deposit/register_commitment
     → Merkle tree updated

  5. addCommitment({ method: "nullifier_set", pool_type: 1, ... })
     → localStorage for future withdrawal
  6. v2.recordDeposit(...)
     → Shadow-record in V2 ledger (background, best-effort)
  7. Madara settlement hook fires on backend
     → SHA-256 fact registered on L3
```

### 5.3 Agent Rebalance Flow (Automated)

```
Oracle detects: ETH momentum signal → aggressive allocation should increase

Agent (backend):
  1. risk_engine.score_risk(user_level=7) → aggressive profile
  2. ai_allocation.compute_allocation(pools, deposit_amount)
     → { conservative: 20%, neutral: 30%, aggressive: 50% }
  3. rebalancer.compute_rebalance_plan(owner, target_weights)
     → drift > 10% on aggressive pool → rebalance needed
  4. agent_orchestrator.prepare_execution(signal, user, params)
     → ContractCall: shielded_pool.agent_rebalance(
         session_id, commitment, from_pool=Neutral, to_pool=Aggressive,
         execution_proof_hash
       )
  5. Relayer submits tx with session key
  6. On-chain: shielded_pool verifies session + execution proof
  7. Funds move from Neutral → Aggressive allocation
  8. Settlement hook → Madara L3 fact registered
```

---

## 6. Privacy Methods Mapped to Contracts

| Privacy Method | Contract | Deposit Entrypoint | Pool Selection | Privacy Level |
|---------------|----------|-------------------|----------------|---------------|
| Shield | `shielded_pool.cairo` | `private_deposit(commitment, pool_type, amount, proof)` | ✅ Conservative/Neutral/Aggressive | Amount hidden, address visible on tx |
| Full Privacy | `fully_shielded_pool.cairo` | `deposit_u256(commitment, amount)` | Embedded in commitment | Everything hidden, Merkle anonymity set |
| Hashed Proof | `hashed_withdraw_pool.cairo` | `deposit(commitment, amount)` | Single pool | Withdraw emits only hash — max unlinkable |

### What about the adapters?

The adapters (`ekubo_lp_adapter`, `lending_adapter`, `staking_adapter`) are **downstream of the pools**. The pools hold the aggregate capital; the VaultController deploys portions of that capital into adapters:

```
Pool (holds commitments) → VaultController → Adapters → Ekubo/JediSwap/Lending
```

Users don't interact with adapters directly. The agent does, via session keys.

---

## 7. What "Dark Ledger" Becomes

The V2 double-entry ledger continues to exist but becomes **entirely invisible**:

| Before (confused) | After (clean) |
|-------------------|---------------|
| "Dark Ledger" in page header | "Privacy Pools" |
| Dark Ledger balance shown in CapitalLedger | Not shown — pool balances are the source of truth |
| Dark Ledger notes listed in left rail | V2 receipts available in Activity tab (for power users) |
| "Sweep to Vault" / "Sweep to Ledger" buttons | Removed — no user-facing sweep concept |
| `dark_ledger` as a deposit privacy method | Removed — it was always the custodial path |
| V2 `recordDeposit` / `recordWithdrawal` | Still fires (background) for analytics + credit scoring |
| Madara settlement hooks | Still fires for proof registration — invisible |
| Credit line display | Moved to secondary "Borrowing Power" section |

---

## 8. Implementation Plan

### Phase A — Rename + Remove Confusion (2h)
1. VaultSurface: "Dark Ledger" → "Privacy Pools"
2. Remove `dark_ledger` from `PrivacyMethod` union type (or hide from UI)
3. Remove `dark_ledger` deposit path from DepositPanel
4. Remove Dark Ledger section from CapitalLedger  
5. Remove "Sweep to Vault" / "Sweep to Ledger" buttons
6. Hide V2 ledger details from main view (keep in Activity tab)

### Phase B — Pool-Centric Deposit Flow (3h)
1. Add `AllocationPoolSelector` to VaultTab (above TierSelector)
2. DepositPanel accepts `poolType` prop, passes to contract calls
3. Update commitment_shield path: `private_deposit(commitment, poolType, amount, proof)`
4. Update nullifier_set path: embed pool_type in commitment generation
5. Update hashed_proof path: route to correct pool contract based on selection
6. Commitment metadata stores `pool_type` for display

### Phase C — Pool-Centric Portfolio View (2h)
1. CapitalLedger: group commitments by pool type (Conservative/Neutral/Aggressive)
2. Per-pool: show total deposited, number of commitments, blended APY
3. Per-commitment: show privacy method badge + age
4. Remove "vault balance", "shielded balance", "dark ledger notes" split

### Phase D — Agent Integration Display (2h)  
1. Oracle recommendations strip in VaultTab (from oracle_recommendation_service)
2. Show current agent allocation targets vs actual (drift indicator)
3. "Rebalance now" button (triggers manual rebalance via agent)
4. Session key status in portfolio view

### Phase E — Polish + Demo (1h)
1. Demo mode with realistic pool data
2. APY display from oracle/pool-apys endpoint
3. Clean up unused imports/components
4. Test full deposit → agent rebalance → withdraw flow

---

## 9. Contract Addresses (Sepolia — Current Deployments)

These need to be verified/updated but are referenced in the frontend config:

| Contract | Env Key | Status |
|----------|---------|--------|
| ShieldedPool | `NEXT_PUBLIC_SHIELDED_POOL_ADDRESS` | Deployed |
| FullyShieldedPool | `NEXT_PUBLIC_FULL_PRIVACY_POOL_ADDRESS` | Deployed |
| HashedWithdrawPool | — | Deployed |
| VaultController | `NEXT_PUBLIC_VAULT_CONTROLLER_ADDRESS` | Deployed |
| SessionKeyManager | `NEXT_PUBLIC_SESSION_KEY_MANAGER_ADDRESS` | Deployed |
| STRK Token | `NEXT_PUBLIC_STRK_TOKEN_ADDRESS` | Starknet native |
| FactRegistry | `NEXT_PUBLIC_FACT_REGISTRY_ADDRESS` | Deployed |
| Garaga Verifier | `NEXT_PUBLIC_GARAGA_VERIFIER_ADDRESS` | Deployed |
| Relayer | `NEXT_PUBLIC_RELAYER_ADDRESS` | Deployed |

---

## 10. Summary — The Hackathon Pitch

**What we have:**
- 3 privacy pools (Conservative/Neutral/Aggressive) on Starknet with real Ekubo LP strategies
- 3 privacy methods (Shield/Full Privacy/Hashed Proof) powered by Garaga Groth16 + Merkle trees
- AI oracle that generates signals → risk engine → allocation decisions with LLM + deterministic fallback
- Session-key-gated agents that rebalance between pools automatically
- Proof-gated execution: human signs → privacy proof verified; agent acts → privacy proof + execution proof verified
- Madara L3 appchain for near-instant proof settlement (5s blocks, zero gas)
- 48 Cairo contracts, 13+ backend services, full frontend

**What we're building now:**
- Clean pool-centric UI that matches the contract architecture
- Pool selector → Privacy method → Deposit flow (3 clicks to private DeFi)
- Agent allocation view showing where the AI is putting your money
- Oracle recommendation strip showing actionable intelligence
- Invisible bookkeeping — Madara settles proofs, V2 ledger tracks analytics, user sees pools

**The demo:**
1. Connect wallet → see 3 privacy pools with live APY
2. Pick Neutral pool, Full Privacy method → deposit 100 STRK
3. Watch agent rebalance: oracle detects ETH momentum → moves allocation to Aggressive
4. Withdraw from any pool, optionally via relayer to fresh address
5. Show proof settlement on Madara L3 — verifiable, private, fast
