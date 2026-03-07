# ZKDEFI Trade Desk: Implementation Roadmap

**Status:** Architecture Finalized & Documented  
**Privacy Model:** Foundation-First, No Compromises  
**Governance:** DAO-Voted, Competitive Lending Market  
**Date:** 2026-03-07

---

## System Overview

**Trade Desk** is the unified execution layer for Capital OS. Users discover opportunities through intelligence streams, route through appropriate adapters (Ekubo, LP, DCA, Limit Orders, Lending), and maintain privacy at every step.

### Three Layers

```
┌─ INTELLIGENCE LAYER
│  ├─ Market data (zkGraph)
│  ├─ Agent reasoning (zkRAG)
│  └─ Risk profile (Risk Passport)
│
├─ EXECUTION LAYER
│  ├─ 8 modular adapters
│  ├─ Policy gating (circuits + DAO)
│  ├─ Reputation gating (tier-based access)
│  └─ Privacy routing (public/shielded/dark ledger)
│
└─ MONETIZATION LAYER
   ├─ Vault holders earn yield (strategies + lending)
   ├─ Borrowers access capital at DAO-voted rates
   ├─ DAOs compete on rates (market-driven)
   └─ Reputation ties directly to economic benefit
```

---

## Quick Reference: What's Designed

| Component | Status | Purpose |
|-----------|--------|---------|
| **MarketDataService** | ✅ Designed | Fetch opportunities without exposing portfolio |
| **AIRecommendationService** | ✅ Designed | Agent reasoning, stateless |
| **CircuitPolicyGate** | ✅ Designed | Local policy evaluation |
| **ReputationGatingService** | ✅ Designed | Map tier → borrowing power + rates |
| **VaultLendingGovernanceService** | ✅ Designed | DAO voting on lending terms |
| **EkuboAdapter** | ✅ Designed | Swaps + Dark Ledger privacy |
| **LPAdapter** | ✅ Designed | Liquidity with 3 risk profiles |
| **DCAAdapter** | ✅ Designed | Dollar-cost averaging |
| **LimitOrdersAdapter** | ✅ Designed | Ekubo limit orders |
| **LendingAdapter** | ✅ Designed | DAO-voted borrowing |
| **StakingAdapter** | ✅ Designed | Staking with yield routing |
| **DarkLedgerAdapter** | ✅ Designed | Shielded execution meta-adapter |
| **PrivacyPoolAdapter** | ✅ Designed | Pool management + idle allocation |
| **PoolLiquidityManager** | ✅ Designed | Idle capital tracking |
| **ReceiptService** | ✅ Designed | Privacy-aware memory lane |
| **TradeDesk.tsx** | ✅ Designed | Main component (integrates all) |
| **OpportunityList.tsx** | ✅ Designed | Discover opportunities |
| **ExecutionPanel.tsx** | ✅ Designed | 3 modes (Manual/Advisory/Terminal) |
| **VaultGovernancePanel.tsx** | ✅ Designed | Vote on lending terms |
| **LendingProposalForm.tsx** | ✅ Designed | Submit rate/LTV changes |
| **ActiveLoansDisplay.tsx** | ✅ Designed | Monitor vault loans |

**Total: 21 components designed, 45+ test cases specified**

---

## Documentation

All designs documented in git:

```
docs/
├─ TRADE_DESK_ARCHITECTURE.md (summary + reference)
├─ REPUTATION_GATED_LENDING_DAO_VOTING.md (lending governance details)
├─ plans/2026-03-07-trade-desk-design.md (foundation)
├─ plans/2026-03-07-trade-desk-adapters-implementation.md (implementation plan)
└─ (Plus existing: ARCHITECTURE_STRATEGIES_PROOFS_DATA_FLOW.md, etc.)
```

---

## Implementation Phases

### Phase 1: Services Foundation (Tasks 1-3)
**Goal:** Build reputation gating + governance service foundation

- Task 1: ReputationGatingService (tier mapping, rates)
- Task 2: LendingAdapter (enhanced with DAO-voted rates)
- Task 3: PoolLiquidityManager + VaultLendingGovernanceService

**Output:** Services layer ready, all tests passing

### Phase 2: Execution Adapters (Tasks 4-7)
**Goal:** Build modular adapter stack

- Task 4: PrivacyPoolAdapter (pool management)
- Task 5: LimitOrdersAdapter (limit order execution)
- Task 6: DCAAdapter (dollar-cost averaging)
- Task 7: LPAdapter (liquidity positions)

**Output:** 8 adapters complete, fully tested, privacy-enabled

### Phase 3: UI Components (Tasks 8-9)
**Goal:** Build execution interface

- Task 8: TradeDesk main + OpportunityList
- Task 9: ExecutionPanel (3 modes)

**Output:** Users can discover and execute opportunities

### Phase 4: Governance UI (Tasks 10-11)
**Goal:** Vault DAOs can manage their pool

- Task 10: VaultGovernancePanel (see current terms)
- Task 11: LendingProposalForm + ActiveLoansDisplay

**Output:** DAOs vote on rates, manage risk, monitor loans

### Phase 5: Integration & Testing (Tasks 12-13)
**Goal:** End-to-end workflow

- Task 12: Memory Lane integration (receipts + reputation impact)
- Task 13: Full e2e tests + verification

**Output:** Fully functional Trade Desk, ready for users

---

## Key Design Decisions

### 1. **DAO-Voted Lending (Not Free Access)**
Instead of giving Tier3 interest-free vault withdrawals, vault DAOs vote on:
- **Who** can borrow (reputation thresholds)
- **How much** (LTV limits)
- **At what rate** (competitive APR)

**Why:** Sustainable, incentive-aligned, economically sound.

### 2. **Dual Yield for Vault Holders**
Vault holders earn:
- Strategy execution yield (12-18% depending on pool)
- Lending interest yield (2-3% from borrowers)
= **Total vault APY: 12-21% depending on pool**

**Why:** Makes vault participation attractive, creates real lending market.

### 3. **Reputation as Economic Gate**
Reputation doesn't just show status—it unlocks:
- Access to borrowing (Tier1 cannot)
- Lower rates (Tier3 gets 4%, Tier2 gets 6%)
- Higher leverage (Tier3 gets 150% LTV, Tier2 gets 50%)

**Why:** Ties reputation directly to economic benefit.

### 4. **Privacy at Every Step**
- Opportunities fetched without portfolio
- Policies evaluated locally
- Execution routable through commitments
- Receipts hash sensitive data

**Why:** Privacy is foundation, not afterthought.

### 5. **Modular Adapters**
Each execution venue (Swap, LP, DCA, LimitOrders, Lending) is a separate module with:
- Independent tests
- Privacy support
- Consistent interface

**Why:** Easy to add more adapters later (Curve, Aave, etc.).

---

## Success Criteria (Verification Checklist)

### Architecture
- [ ] All 8 adapters implement ExecutionAdapter interface
- [ ] All adapters have privacy support (public/shielded/dark_ledger)
- [ ] Policy evaluation is local-only (no server exposure)
- [ ] Reputation gates are enforced at execution time

### Reputation Tiers
- [ ] Tier1 can deposit but not borrow
- [ ] Tier2 can borrow up to 50% LTV at DAO-voted rate
- [ ] Tier3 can borrow up to 150% LTV at DAO-voted rate

### DAO Governance
- [ ] DAOs can propose rate changes
- [ ] DAOs can propose LTV changes
- [ ] DAOs can vote on proposals
- [ ] Changes take effect after vote passes (70% majority, 60% quorum)

### Lending Market
- [ ] Multiple vaults compete on rates
- [ ] Rates are transparent (on-chain)
- [ ] Borrowers see all available rates
- [ ] DAO can adjust rates to stay competitive

### Privacy
- [ ] No user portfolio data exposed to recommendation engine
- [ ] All private loans use commitment-based execution
- [ ] Receipts hash sensitive data
- [ ] Idle capital aggregated (not per-user)

### Yield
- [ ] Strategy yields flow to vault
- [ ] Lending interest flows to vault
- [ ] Dual yield visible to vault holders
- [ ] Yield distributions appear in Memory Lane

---

## Implementation Commands (Ready to Execute)

When you're ready, choose execution approach:

**Option A: Subagent-Driven**
```
I dispatch fresh subagents per task, review between tasks
Start: Next message with "start implementation"
```

**Option B: Parallel Session**
```
Open new Cursor session with /execute-plan skill
Point to: docs/plans/2026-03-07-trade-desk-adapters-implementation.md
```

---

## References

**Architecture:**
- `docs/TRADE_DESK_ARCHITECTURE.md` - Complete system overview
- `docs/REPUTATION_GATED_LENDING_DAO_VOTING.md` - Lending governance details
- `docs/ARCHITECTURE_STRATEGIES_PROOFS_DATA_FLOW.md` - Backend proof flows

**Design:**
- `docs/plans/2026-03-07-trade-desk-design.md` - Foundation design
- `docs/plans/2026-03-07-trade-desk-adapters-implementation.md` - Implementation plan

**Capital OS Context:**
- `docs/plans/2026-03-06-mission-control-ux-refactor-design.md` - Overall UX design
- `docs/plans/2026-03-06-intelligence-surface-rewrite-design.md` - Intelligence streams

---

## Technical Stack

- **Frontend:** React 18, TypeScript, TanStack Query, Zustand, Framer Motion
- **Backend:** FastAPI, Uvicorn, Python
- **Blockchain:** Starknet (Sepolia), Madara L3
- **Protocols:** Ekubo (Swap + LP + Limit Orders), Starknet lending
- **Privacy:** Commitments (Pedersen hash), Dark Ledger shielding
- **ML:** EZKL circuit evaluation for policies

---

## Ready to Build

**All architecture finalized. All documentation complete. All tests designed.**

The system is **privacy-first, DAO-governed, and economically sound.**

Vault holders earn competitive yields. Borrowers get transparent, reputation-gated access. DAOs compete on rates. Privacy is maintained throughout.

**Ready when you are.**
