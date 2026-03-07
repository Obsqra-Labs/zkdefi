# Trade Desk: Complete Execution Architecture Summary

**Date:** 2026-03-07  
**Status:** Ready for Implementation  
**Privacy Level:** Foundation-First, No Compromises

---

## Vision

**Trade Desk** is the unified execution control plane where:
- Users discover opportunities through intelligence streams
- Policies enforce constraints (DAO governance + personal risk)
- Reputation gates capital access and borrowing power
- All execution routes honor privacy—public, shielded, or dark ledger

It connects the entire Capital OS:
```
Intelligence Streams (zkRAG, zkGraph, Risk Passport)
    ↓
Market Data Service (opportunities discovery)
    ↓
AI Recommendations (agent reasoning)
    ↓
Policy Gate (circuit evaluation + DAO rules)
    ↓
Reputation Gating (tier-based access)
    ↓
Execution Adapters (route through appropriate venue)
    ↓
Receipt Generation (memory lane + proof)
    ↓
Yield Distribution (to pools, to user)
```

---

## Architecture: 8 Modular Adapters

### Execution Layer

| Adapter | Role | Privacy | Tests | Status |
|---------|------|---------|-------|--------|
| **EkuboAdapter** | Swaps (ETH/USDC/STRK pairs) | ✅ Dark Ledger | 5 | Ready |
| **LPAdapter** | Liquidity positions (3 risk profiles) | ✅ Shielded | 7 | Ready |
| **DCAAdapter** | Dollar-cost averaging (scheduled swaps) | ✅ Full | 6 | Ready |
| **LimitOrdersAdapter** | Limit orders (Ekubo extension) | ✅ Full | 5 | Ready |
| **LendingAdapter** | Borrow/lend with reputation gating | ✅ Full | 8 | Ready |
| **StakingAdapter** | STRK staking with yield routing | ✅ Partial | 2 | Ready |
| **DarkLedgerAdapter** | Meta-adapter for shielded execution | ✅ Core | 1 | Ready |
| **PrivacyPoolAdapter** | DAO-governed pool buckets | ✅ Core | 7 | Ready |

**Total Adapters:** 8  
**Total Tests:** 41  
**Privacy Support:** 100% of adapters

---

## Services Layer

### Discovery & Intelligence

| Service | Purpose | Privacy |
|---------|---------|---------|
| **MarketDataService** | Fetch opportunities from `/strategies/opportunities` | ✅ No portfolio lookup |
| **AIRecommendationService** | Agent reasoning from zkGraph | ✅ No user history storage |
| **OpportunityList** | Render with privacy badges + policy status | ✅ No tracking |

### Gating & Constraints

| Service | Purpose | Privacy |
|---------|---------|---------|
| **CircuitPolicyGate** | Evaluate policies locally | ✅ Local-only, no server exposure |
| **ReputationGatingService** | Map tier → borrowing power + rates | ✅ Tier-based, not portfolio-based |
| **PoolLiquidityManager** | Track idle capital allocation | ✅ Aggregated, not per-user |

### Execution & Records

| Service | Purpose | Privacy |
|---------|---------|---------|
| **ReceiptService** | Generate memory lane records | ✅ Hash sensitive data for private receipts |
| **ExecutionCoordinator** | Route through adapters | ✅ Commitment-based privacy flows |

---

## Reputation-Gated Pool Access

### Three DAO-Governed Pools

```
┌─ CONSERVATIVE POOL
│  ├─ Max risk: 25
│  ├─ Acceptable: Staking, Lending (low LTV), Blue-chip LPs
│  ├─ Idle maintained: 40%
│  └─ Earning: 8% (Tier1 borrow) | 6% (Tier2) | 4% (Tier3)
│
├─ MODERATE POOL
│  ├─ Max risk: 50
│  ├─ Acceptable: Mixed LPs, medium lending, DCA
│  ├─ Idle maintained: 30%
│  └─ Earning: 6% (Tier2) | 4% (Tier3) + yield from strategies
│
└─ AGGRESSIVE POOL
   ├─ Max risk: 100
   ├─ Acceptable: High-yield LPs, limit orders, leveraged positions
   ├─ Idle maintained: 20%
   └─ Earning: 4% (Tier3) + performance-based kickback
```

### Tier Access Matrix

| Feature | Tier1 (0-50) | Tier2 (51-75) | Tier3 (76-100) |
|---------|---|---|---|
| **Deposit** | ✅ | ✅ | ✅ |
| **Earn yield** | ✅ | ✅ | ✅ |
| **Borrow** | ❌ | ✅ 50% LTV | ✅ 150% LTV |
| **Borrow rate** | — | 6% | 4% |
| **Free vault** | ❌ | ❌ | ✅ (20% for 7 days) |
| **Lending pool idle access** | — | 50% | 80% |

---

## Three Execution Modes

### Manual Mode
- User browses all opportunities
- Clicks to see details
- Selects and executes

### Advisory Mode
- AI recommends top pick (with confidence + reasoning)
- User can override with alternatives below
- Proactive nudges ("High yield available," "Risk elevated")

### Terminal Mode
- Compact ranked list
- One-click execute selected
- Pro traders' preferred interface

---

## Privacy Preservation Strategy

### By Component

| Component | Privacy Threat | Mitigation |
|-----------|---|---|
| **MarketDataService** | Portfolio inference | Use risk profile only, never fetch holdings |
| **AIRecommendationService** | Recommendation history | Stateless, in-memory only, no storage |
| **CircuitPolicyGate** | Policy exposure | Local evaluation, never sent to backend |
| **LendingAdapter** | Borrowing transparency | Tier-based rates mask individual positions |
| **PrivacyPoolAdapter** | Pool composition leakage | Aggregated idle capital, not per-user |
| **ReceiptService** | Timeline sensitivity | Hash amounts for private receipts |

### By Execution Path

**Public Execution:**
```
Opportunity selected → Policy gate checks → Execute directly → Public receipt (full details)
```

**Private Execution (via Dark Ledger):**
```
Opportunity selected → Generate commitment → Deposit to Dark Ledger → 
Execute from Dark Ledger → Withdraw to Dark Ledger → Private receipt (hash only)
```

**Hybrid (Selective Privacy):**
```
Opportunity + privacy tier set → Policy enforces minimum tier → 
Route through appropriate privacy level → Mixed receipt (aggregate + private hash)
```

---

## Data Flow: End-to-End

```
┌─ Intelligence Streams
│  ├─ zkGraph: Market data (public)
│  ├─ zkRAG: Agent reasoning (no user portfolio)
│  └─ Risk Passport: Risk profile (aggregated only)
│
├─ Opportunity Discovery (MarketDataService + AIRecommendationService)
│  ├─ Fetch public opportunities
│  ├─ Enrich with agent reasoning
│  ├─ Filter by policy constraints (local evaluation)
│  ├─ Rank by composite score
│  └─ Flag privacy routing options
│
├─ Reputation Gating (ReputationGatingService)
│  ├─ Fetch user's reputation tier
│  ├─ Determine borrowing power
│  ├─ Calculate available pool capital
│  └─ Apply tier-specific rates
│
├─ Execution (ExecutionAdapters)
│  ├─ Route through selected adapter (Ekubo, LP, DCA, etc.)
│  ├─ Apply privacy protections (commitment-based if needed)
│  ├─ Execute through Starknet account abstraction
│  └─ Collect receipts with privacy metadata
│
└─ Memory Lane Integration
   ├─ Store receipt (hash sensitive data)
   ├─ Display with privacy badge
   ├─ Track reputation impact
   └─ Distribute yield to pools / user
```

---

## Implementation Plan Structure

### Phase 1: Services Foundation (Tasks 1-3)
- **ReputationGatingService** — Tier mapping, borrowing power, rates
- **LendingAdapter (Enhanced)** — Reputation-gated borrowing, free vault
- **PoolLiquidityManager** — Idle capital tracking

### Phase 2: Execution Adapters (Tasks 4-7)
- **EkuboAdapter** → Swaps + privacy routing
- **LPAdapter** → Liquidity with risk profiles
- **DCAAdapter** → Scheduled averaging
- **LimitOrdersAdapter** → Ekubo limit orders

### Phase 3: UI Components (Tasks 8-9)
- **TradeDesk Main** → Integrates all adapters
- **ExecutionPanel** → 3-mode toggle (Manual, Advisory, Terminal)
- **OpportunityList** → Privacy badges + policy status

### Phase 4: Integration (Tasks 10-12)
- **Memory Lane** → Receipt display with privacy
- **DAO Governance UI** → Policy management overlay
- **End-to-End Testing** → Complete flow verification

---

## Success Criteria

### Functional
✅ Users can deposit into privacy pools  
✅ Reputation tiers unlock borrowing capacity  
✅ Tier3 can access free vault for 7 days  
✅ All adapters (swap, LP, DCA, limit orders, lending) working  
✅ Opportunities routable through all venues  
✅ DAO can set pool rates and constraints  

### Privacy
✅ No user portfolio exposed to recommendation engine  
✅ All private execution uses commitments  
✅ Receipts hash sensitive data  
✅ Idle capital aggregated, not per-user  
✅ Policy evaluation local-only  

### Experience
✅ Three execution modes (Manual, Advisory, Terminal)  
✅ Privacy level always visible  
✅ Reputation tiers grant immediate access (no friction)  
✅ Yield distributions appear in Memory Lane  
✅ Free vault withdrawal is seamless  

---

## Files to Create / Modify

### New Files (14)
- `frontend/src/services/MarketDataService.ts`
- `frontend/src/services/AIRecommendationService.ts`
- `frontend/src/services/CircuitPolicyGate.ts`
- `frontend/src/services/ReceiptService.ts`
- `frontend/src/services/ReputationGatingService.ts`
- `frontend/src/services/adapters/ExecutionAdapter.ts` (interface)
- `frontend/src/services/adapters/EkuboAdapter.ts`
- `frontend/src/services/adapters/LendingAdapter.ts`
- `frontend/src/services/adapters/StakingAdapter.ts`
- `frontend/src/services/adapters/DarkLedgerAdapter.ts`
- `frontend/src/services/adapters/LimitOrdersAdapter.ts`
- `frontend/src/services/adapters/DCAAdapter.ts`
- `frontend/src/services/adapters/LPAdapter.ts`
- `frontend/src/services/adapters/PrivacyPoolAdapter.ts`
- `frontend/src/services/adapters/PoolLiquidityManager.ts`
- `frontend/src/components/zkdefi/trade-desk/TradeDesk.tsx`
- `frontend/src/components/zkdefi/trade-desk/OpportunityList.tsx`
- `frontend/src/components/zkdefi/trade-desk/ExecutionPanel.tsx`

### Test Files (14)
- All services get `__tests__/ServiceName.test.ts`
- All adapters get `__tests__/AdapterName.test.ts`

### Total Tests: 41+ test cases across all services and adapters

---

## Next Steps

**Immediate:** Choose execution approach (Subagent-Driven vs. Parallel Session)

**Then:** Implement Phase 1 (Services Foundation) using executing-plans skill

---

## References

- Design: `docs/plans/2026-03-07-trade-desk-design.md`
- Implementation: `docs/plans/2026-03-07-trade-desk-adapters-implementation.md`
- Architecture: `docs/ARCHITECTURE_STRATEGIES_PROOFS_DATA_FLOW.md`
- Mission Control Design: `docs/plans/2026-03-06-mission-control-ux-refactor-design.md`

---

**Ready to build. Privacy first. Always.**
