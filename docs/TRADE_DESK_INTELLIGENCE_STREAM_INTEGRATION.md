# Trade Desk + Intelligence Stream Integration Design

**Date:** 2026-03-07  
**Status:** Gap Analysis + UI/UX Design  
**Scope:** How Phase 1-2 adapters connect to Phase 3 UI with intelligence stream data

---

## Current State: What We've Built (138 Tests Passing)

### Phase 1: Services Foundation ✅
- **ReputationGatingService** (20 tests) — Maps reputation to borrowing power
- **LendingAdapter** (30 tests) — Executes reputation-gated borrowing
- **PoolLiquidityManager + VaultLendingGovernanceService** (34 tests) — DAO governance

### Phase 2: Execution Adapters (54 tests passing)
- **PrivacyPoolAdapter** (33 tests) — Manages 3 privacy pools
- **LimitOrdersAdapter** (21 tests) — Ekubo limit orders
- **TODO: DCAAdapter** (est. 12 tests) — Dollar-cost averaging
- **TODO: LPAdapter** (est. 15 tests) — Liquidity positions

### What's Missing: Phase 3 UI Components
- **TradeDesk** component (integrates all adapters)
- **OpportunityList** component (displays opportunities)
- **ExecutionPanel** component (3-mode execution: Manual/Advisory/Terminal)
- **MarketDataService** (fetches opportunities without portfolio data)
- **AIRecommendationService** (agent reasoning)

---

## Intelligence Stream Architecture

### Current Sources (Already Implemented Backend)

```
┌─ zkRAG (Obsqra zkRAG API)
│  ├─ Agent query reasoning
│  ├─ Confidence scores
│  └─ Fact-checked data
│
├─ zkGraph (Madara L3)
│  ├─ Market data (Ekubo pools, rates, volumes)
│  ├─ Attested context (pool health, liquidity)
│  ├─ Historical patterns
│  └─ Strategy matches
│
└─ Risk Passport (zkML Circuits)
   ├─ User reputation score
   ├─ FICO pack (creditworthiness)
   ├─ Risk profile (conservative/moderate/aggressive)
   └─ Tier (Tier1/2/3 for borrowing)
```

### Backend Endpoints (Verified Working)

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/zkgraph/agent/query` | POST | Agent reasoning | ✅ Working |
| `/strategies/opportunities` | POST | Market opportunities | ✅ Working |
| `/zkgraph/context/{pool}` | GET | Market data + provenance | ✅ Working |
| `/zkdefi/reputation/user/{address}` | GET | User reputation tier | ✅ Working |
| `/zkml/risk_score` | POST | Risk assessment proof | ✅ Working |

---

## UI/UX Design: How Intelligence Flows Through Trade Desk

### The Three Execution Modes

#### **Mode 1: Manual (User-Driven Discovery)**

```
OPPORTUNITY LIST (OpportunityList component)
┌─────────────────────────────────────────────────────┐
│ ETH/USDC LP (Ekubo)                    [Public]     │
│ ├─ APY: 12.5%                                       │
│ ├─ Risk: 30                                         │
│ ├─ Policy: ✓ PASS                                   │
│ └─ [SELECT]                                         │
│                                                     │
│ STRK Lending (Native Pool)            [Shielded]   │
│ ├─ APY: 6%                                          │
│ ├─ Risk: 20 (Tier2 borrow @ 6%)                    │
│ ├─ Policy: ⚠ Approval needed                        │
│ └─ [SELECT]                                         │
│                                                     │
│ Staking STRK                           [Public]     │
│ ├─ APY: 4.2%                                        │
│ ├─ Risk: 5                                          │
│ ├─ Policy: ✓ PASS                                   │
│ └─ [SELECT]                                         │
└─────────────────────────────────────────────────────┘

DATA FLOW:
  MarketDataService.fetchOpportunities()
    ├─ GET /strategies/opportunities → [Ekubo ETH/USDC, Lending STRK, Staking]
    ├─ EnrichWith: ReputationGatingService → [risks, rates, access]
    ├─ Filter by: CircuitPolicyGate → [policy status]
    └─ Rank by: compositeScore (yield + risk + efficiency)

USER CLICKS [SELECT] on opportunity
  ↓
ExecutionPanel opens with that opportunity pre-selected
  ├─ Amount input
  ├─ Privacy mode selector (public/shielded/dark_ledger)
  ├─ Slippage/LTV controls
  └─ [Execute] button
  
[Execute] calls appropriate adapter
  ├─ EkuboAdapter.execute() for swap/LP
  ├─ LendingAdapter.borrowFromPool() for borrowing
  ├─ StakingAdapter.execute() for staking
  └─ Generates TradeReceipt → Memory Lane
```

#### **Mode 2: Advisory (AI Recommends)**

```
AGENT RECOMMENDATION PANEL (OpportunityList in advisory mode)
┌─────────────────────────────────────────────────────┐
│ ★ RECOMMENDED (Agent suggests based on market)      │
│                                                     │
│ Opportunity: ETH/USDC LP (Ekubo)                   │
│ ├─ APY: 12.5%                                       │
│ ├─ Why: "High yield (12.5%), low volatility,       │
│ │        your tier allows leverage, policy OK"      │
│ ├─ Confidence: 87% (from zkGraph + zkRAG)          │
│ ├─ Privacy Path: "Can execute shielded via         │
│ │               Dark Ledger first"                 │
│ └─ [EXECUTE RECOMMENDED] button                     │
│                                                     │
│ ── Or browse alternatives below ──                  │
│                                                     │
│ STRK Lending (62% confidence)                       │
│ Staking STRK (48% confidence)                       │
└─────────────────────────────────────────────────────┘

DATA FLOW:
  AIRecommendationService.getRecommendations()
    ├─ POST /zkgraph/agent/query → zkRAG reasoning
    ├─ Returns: [opportunities ranked by confidence]
    ├─ Includes: Why (natural language reasoning)
    └─ Provides: Hints about privacy/privacy paths
    
  OpportunityList.render() in advisory mode
    ├─ Show top recommendation first (87%)
    ├─ Show confidence scores
    ├─ Show reasoning text
    └─ List alternatives below

USER CLICKS [EXECUTE RECOMMENDED]
  ↓
ExecutionPanel opens with full recommendation context
  ├─ Recommended adapter pre-selected
  ├─ Privacy mode auto-set to "shielded" (from recommendation)
  ├─ Amount suggested (but user can adjust)
  └─ [Execute] confirms
```

#### **Mode 3: Terminal (Pro/Compact)**

```
COMPACT OPPORTUNITY LIST (ExecutionPanel in terminal mode)
┌────────────────────────────────────────────┐
│ Ekubo ETH/USDC LP  │ 12.5% │ Risk 30 │ ✓ │
│ Lending STRK       │ 6.0%  │ Risk 20 │ ⚠ │
│ Staking STRK       │ 4.2%  │ Risk 5  │ ✓ │
│                                            │
│ [SELECT] [EXECUTE]                        │
└────────────────────────────────────────────┘

DATA FLOW:
  Same as Manual, but minimal UI
  - No descriptions or hints
  - Ranked list only
  - One-click execution
```

---

## Integration Points: Where Each Component Connects

### 1. MarketDataService → OpportunityList

```
┌─ MarketDataService.fetchOpportunities()
│
│  Step 1: Fetch from intelligence stream
│  ├─ GET /strategies/opportunities (Ekubo/Lending/Staking market data)
│  ├─ POST /zkgraph/agent/query (agent reasoning, not portfolio)
│  └─ GET /zkdefi/reputation/user/{address} (user's tier)
│
│  Step 2: Enrich with Phase 1 services
│  ├─ ReputationGatingService → [borrowing power, rates]
│  ├─ CircuitPolicyGate → [policy status]
│  └─ PoolLiquidityManager → [available capital per tier]
│
│  Step 3: Rank and return to OpportunityList
│  └─ compositeScore = yield_score + risk_score + efficiency_score
│
└─ OpportunityList renders with:
   ├─ Privacy badges (Public/Shielded/Dark Ledger)
   ├─ Policy status (✓ PASS / ⚠ WARNING / ✗ BLOCKED)
   ├─ Confidence scores (from AI recommendations)
   └─ Adapter icons (Ekubo/Lending/Staking)
```

### 2. AIRecommendationService → ExecutionPanel

```
┌─ AIRecommendationService.getTopRecommendation()
│
│  POST /zkgraph/agent/query
│  ├─ Request type: "market_opportunities"
│  ├─ Privacy mode: true (no portfolio exposure)
│  └─ Returns: top ranked opportunity + confidence + reasoning
│
└─ ExecutionPanel uses recommendation to:
   ├─ Pre-fill opportunity details
   ├─ Set confidence badge (87%)
   ├─ Show reasoning text
   └─ Suggest privacy mode based on recommendation
```

### 3. ExecutionAdapters → TradeReceipt → Memory Lane

```
┌─ ExecutionPanel [Execute] calls adapter
│
│  adapter.execute(opportunity, { amount, privacy, slippage })
│  ├─ LendingAdapter.borrowFromPool()
│  ├─ EkuboAdapter.execute() (swap or LP)
│  ├─ DCAAdapter.createPosition()
│  ├─ LPAdapter.addLiquidity()
│  └─ Each returns: TradeReceipt
│
│  TradeReceipt includes:
│  ├─ action (borrow/swap/dca/lp)
│  ├─ amount + privacyLevel
│  ├─ yieldImpact + trustDelta
│  └─ status (pending/confirmed)
│
└─ Memory Lane displays receipt
   ├─ Privacy-aware display (hash amounts if private)
   ├─ Links to proofs (if available)
   └─ Shows reputation impact
```

---

## Gap Analysis: What's Missing

### Missing Components (Phase 3 to Build)

| Component | Purpose | Depends On | Priority |
|-----------|---------|-----------|----------|
| **MarketDataService** | Fetch opportunities without portfolio | Already designed | HIGH |
| **AIRecommendationService** | Agent recommendations + reasoning | Already designed | HIGH |
| **OpportunityList** | Render opportunities in 3 modes | MarketDataService + AI | HIGH |
| **ExecutionPanel** | 3-mode execution interface | All adapters (Phase 2) | HIGH |
| **TradeDesk** | Main component wrapper | All above | HIGH |
| **ReceiptService** | Privacy-aware Memory Lane display | TradeReceipt from adapters | MEDIUM |
| **VaultGovernancePanel** | DAO voting UI | VaultLendingGovernanceService | MEDIUM |
| **LendingProposalForm** | Submit governance proposals | VaultLendingGovernanceService | MEDIUM |
| **ActiveLoansDisplay** | Monitor vault loans | VaultLendingGovernanceService | MEDIUM |

### Missing Adapters (Phase 2 continued)

| Adapter | Tests | Priority |
|---------|-------|----------|
| **DCAAdapter** | ~12 | HIGH (complete Phase 2) |
| **LPAdapter** | ~15 | HIGH (complete Phase 2) |

### Data Flow Gaps

| Gap | Solution | Status |
|-----|----------|--------|
| Opportunities not fetched without portfolio | MarketDataService.fetchOpportunities() | Ready to build |
| AI confidence scores not displayed | AIRecommendationService integration | Ready to build |
| Privacy mode not selected per opportunity | ExecutionPanel privacy selector | Ready to build |
| Receipts not shown in Memory Lane | ReceiptService + timeline display | Ready to build |
| Policy violations not actionable | CircuitPolicyGate.requestOverride() | Ready to build |
| DAO rate changes not reflected | Cache invalidation on VaultLendingGovernanceService | Ready to build |

---

## UI/UX Design Details

### OpportunityList Component

```typescript
// Location: frontend/src/components/zkdefi/trade-desk/OpportunityList.tsx

interface OpportunityListProps {
  mode: 'manual' | 'advisory' | 'terminal';
  opportunities: Opportunity[]; // from MarketDataService
  recommendations?: AIRecommendation[]; // from AIRecommendationService
  onSelect: (opportunity: Opportunity) => void;
  policies?: Policy[]; // from Circuit Board
}

Rendering logic:
- Manual mode: Show all opportunities with details
- Advisory mode: Top recommendation first, alternatives below
- Terminal mode: Compact ranked list only

Each opportunity card shows:
- Name + Adapter icon
- APY / Risk / Composite score
- Privacy badge
- Policy status indicator
- [Select] button
```

### ExecutionPanel Component

```typescript
// Location: frontend/src/components/zkdefi/trade-desk/ExecutionPanel.tsx

interface ExecutionPanelProps {
  mode: 'manual' | 'advisory' | 'terminal';
  selectedOpportunity: Opportunity;
  userReputation: UserReputation; // Tier1/2/3
  onExecute: (params: ExecutionParams) => Promise<TradeReceipt>;
}

Features:
- Mode toggle (Manual / Advisory / Terminal)
- Opportunity details (APY, risk, confidence)
- Amount input (with max calculated from LTV)
- Privacy mode selector
- Slippage/LTV controls
- Policy status + override request button
- [Execute] button that calls appropriate adapter
```

### TradeDesk Component

```typescript
// Location: frontend/src/components/zkdefi/trade-desk/TradeDesk.tsx

Composition:
┌─ TradeDesk
│  ├─ Header (Mode toggle: Manual / Advisory / Terminal)
│  ├─ OpportunityList (renders opportunities)
│  ├─ ExecutionPanel (right side, opens on selection)
│  └─ Memory Lane (bottom, shows past trades)
│
│  Data flow:
│  ├─ Load opportunities on mount: MarketDataService.fetchOpportunities()
│  ├─ Get AI recommendations: AIRecommendationService.getRecommendations()
│  ├─ User selects opportunity → open ExecutionPanel
│  ├─ User clicks [Execute] → adapter.execute()
│  ├─ Receipt → Memory Lane display
│  └─ Update opportunity list (yield impact)
```

---

## Implementation Sequence for Phase 3

### Week 1: Core Services
1. **MarketDataService** — Fetch + rank opportunities
2. **AIRecommendationService** — Agent reasoning
3. **ReceiptService** — Privacy-aware receipts for Memory Lane

### Week 2: UI Components (Depends on adapters from Phase 2)
4. **OpportunityList** — Display opportunities in 3 modes
5. **ExecutionPanel** — Execute with privacy + policy gating
6. **TradeDesk** — Main integration component

### Week 3: Governance + Polish
7. **VaultGovernancePanel** — DAO voting
8. **LendingProposalForm** — Submit proposals
9. **ActiveLoansDisplay** — Monitor loans
10. **End-to-end testing** — Full workflow verification

---

## Privacy Guarantees in UI/UX

### Information Exposure Model

| Data | UI Shows | Privacy | Notes |
|------|----------|---------|-------|
| **Market opportunities** | APY, risk, adapter | Public | No portfolio inference |
| **User tier** | Tier1/2/3 badge | Public | Tier itself is not sensitive |
| **Borrowing power** | Max borrow amount | Computed locally | Never sends portfolio |
| **Recommendation reasoning** | Text summary | Public | From agent, aggregated |
| **Execution details** | Receipt with privacy badge | Privacy-aware | Hash amounts if private |
| **Pool compositions** | Aggregated stats only | Aggregated | Never per-user breakdowns |

---

## Success Criteria for Phase 3

- [ ] **MarketDataService** fetches opportunities without portfolio exposure
- [ ] **AIRecommendationService** provides confidence scores + reasoning
- [ ] **OpportunityList** renders all 3 modes correctly
- [ ] **ExecutionPanel** allows privacy mode selection
- [ ] **TradeDesk** integrates all components seamlessly
- [ ] **Memory Lane** displays receipts with privacy badges
- [ ] **DAO UI** allows voting on governance changes
- [ ] **End-to-end workflow** works from discovery → execution → audit trail

---

## Key Insight: Intelligence Stream Powers Discovery, Adapters Power Execution

The intelligence stream (zkRAG, zkGraph) **discovers** opportunities:
- Market data + agent reasoning
- Confidence scores
- Contextual hints

The adapters (Phase 2) **execute** those opportunities:
- LendingAdapter → borrowing at DAO-voted rates
- EkuboAdapter → swaps with privacy routing
- DCAAdapter → scheduled purchases
- LPAdapter → liquidity positions

The **UI (Phase 3)** connects them:
- OpportunityList → displays what intelligence stream discovered
- ExecutionPanel → routes to appropriate adapter
- Memory Lane → tracks what was executed

**Privacy is maintained throughout:**
- Intelligence stream never sees full portfolio
- Adapters support commitment-based execution
- UI shows privacy badges for all operations

---

This design ensures the Trade Desk becomes a unified execution layer powered by intelligent data discovery, reputation-gated access, and DAO governance—all with privacy as foundation, not afterthought.
