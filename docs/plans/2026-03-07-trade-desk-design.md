# Trade Desk: AI Oracle Control Plane Design

**Date:** 2026-03-07  
**Status:** Design Approved  
**Scope:** Privacy-first multi-adapter execution surface integrated into Capital OS

---

## Overview

Trade Desk is the execution control plane for Capital OS—a policy-gated, multi-adapter terminal where opportunities discovered through intelligence streams are evaluated against user circuits and executed through the appropriate adapter (Ekubo, Lending, Staking, Dark Ledger).

**Core Design Principle:** Privacy is not a feature—it's the foundation. Every module prioritizes shielded flows and private execution paths.

---

## Architecture: Modular Design

### Layer 1: Data Intelligence (Privacy-Aware)

**`MarketDataService.ts`** (NEW - wraps LP panel logic)
- Fetches opportunities from `/strategies/opportunities`
- **Privacy handling:** 
  - Flags opportunities that support private execution (Dark Ledger, shielded swaps)
  - Separates public vs. private pool options
  - Never logs opportunity details to persistent storage
- Enriches with composite scores (yield, risk, liquidity, efficiency)
- Caches in memory only (no localStorage)

**`AIRecommendationService.ts`** (NEW - wraps zkRAG integration)
- Calls `rebalancer/autonomous/status` for agent reasoning
- Ranks opportunities by agent confidence
- **Privacy handling:**
  - Doesn't expose user's current portfolio to recommendation logic (uses risk profile only)
  - Recommendations are stateless (no history stored)
  - Can be run in privacy mode (agent reasoning on encrypted data)

**`CircuitPolicyGate.ts`** (NEW - bridges Circuit Board)
- Evaluates opportunity against user's policies (from Circuit Board)
- Returns: PASS | WARNING | BLOCKED with reasoning
- **Privacy handling:**
  - Policies enforce privacy constraints (e.g., "Only execute via Dark Ledger for amounts > $X")
  - Can enforce "no public routing" for sensitive strategies
  - Policy evaluation happens locally, never sent to server

---

### Layer 2: Opportunity Discovery (Public + Private Modes)

**`OpportunityList.tsx`** (NEW component)

Renders opportunities with adapter awareness:
```
Manual Mode:
├─ Ekubo ETH/USDC LP        [Public]  APY: 12.5%  [Select]
├─ Lending: borrow STRK     [Private] APY: 8%     [Select]
└─ Staking: STRK            [Public]  APY: 4.2%   [Select]

Advisory Mode:
├─ ★ RECOMMENDED (agent): Ekubo LP + hint + confidence
└─ All alternatives below

Terminal Mode:
├─ ETH/USDC LP    | Ekubo  | 12.5% | Risk: 30 | ✓ policy
└─ STRK borrow    | Lend   | 8%    | Risk: 15 | ⚠ needs approval
```

**Privacy Features:**
- **Public badge:** Opportunity executes on public chain
- **Private badge:** Opportunity routes through Dark Ledger or private pool
- Adapter icon shows routing venue
- Policy status icon (✓ PASS | ⚠ WARNING | ✗ BLOCKED)

**Data Flow (Privacy Preserved):**
1. Fetch from `/strategies/opportunities` (public market data)
2. Enrich with user's risk profile (NOT portfolio details)
3. Filter by policy constraints (locally)
4. Rank by composite score
5. Display with adapter badges
6. On select: **never expose full portfolio state**

---

### Layer 3: Execution Engine (Privacy-First)

**`ExecutionAdapter.ts`** (EXTRACT & REFACTOR from VaultTradeTab)

Unified adapter interface:
```typescript
interface ExecutionAdapter {
  name: "ekubo" | "lending" | "staking" | "dark_ledger";
  supportsPrivacy: boolean;
  execute(opportunity, amount, userPolicy): Receipt;
}
```

**Adapters (Each a Module):**

**`EkuboAdapter.ts`** (Swap + LP)
- Uses proven VaultTradeTab swap logic
- **Privacy handling:**
  - Checks if pair supports private routing
  - If public: routes through Ekubo directly
  - If private option: routes through Dark Ledger first, then swap
  - Commitment-based execution for privacy mode
- Generates receipt with privacy level metadata

**`LendingAdapter.ts`** (Borrow + Lend)
- Uses proven LP panel logic from VaultTradeTab
- **Privacy handling:**
  - Lending always against collateral in vault (can be private)
  - Borrowed amounts can be withdrawn to Dark Ledger
  - Interest streams are privacy-aware (can be shielded)
  - Collateral ratio calculations never expose full portfolio

**`StakingAdapter.ts`** (Stake STRK)
- Uses proven staking logic
- **Privacy handling:**
  - Staking address can be a shielded commitment
  - Rewards routed through Dark Ledger option
  - Unstaking preserves privacy tier

**`DarkLedgerAdapter.ts`** (Shielded execution)
- Meta-adapter: routes swaps/LP/lending through commitment first
- **Privacy handling:**
  - All operations start with commitment generation
  - Amounts obfuscated as commitments
  - Nullifier set proves ownership without exposure
  - Receipts marked as "Private" with commitment hash only

---

### Layer 4: Policy Gate (Privacy-Aware Constraints)

**`PolicyEvaluator.ts`** (NEW - bridges Circuit Board)

Evaluates policies without exposing data:
```
User's Policy (from Circuit Board):
├─ IF amount > $1000 THEN route via Dark Ledger
├─ IF risk_score > 60 THEN BLOCK
├─ IF strategy == "risky" THEN require_approval
└─ Always preserve privacy tier

Opportunity Evaluation:
├─ Amount: $2,000 → Dark Ledger required ✓
├─ Risk: 35 → Below threshold ✓
├─ Strategy: "moderate yield" → Auto-approve ✓
└─ Privacy: Maintained throughout ✓
```

**Privacy Features:**
- Policies evaluated locally, never sent to server
- Policy evaluation doesn't require portfolio state
- Can enforce "minimum privacy tier" constraints
- Blocked opportunities are silently hidden (don't expose rejection reason to backend)

---

### Layer 5: Receipt Generation (Privacy-Preserving)

**`ReceiptService.ts`** (NEW - privacy-aware receipts)

Generates receipt for Memory Lane:
```typescript
interface TradeReceipt {
  id: string;
  timestamp: ISO8601;
  action: "swap" | "lp_add" | "borrow" | "stake";
  opportunity: { name, adapter, apy };
  
  // Privacy layer
  privacyLevel: "public" | "shielded" | "dark_ledger";
  exposureLevel: number; // 0-100, how much is exposed
  
  // User-visible data
  yieldImpact: number; // APY change
  trustDelta: number;  // Reputation impact
  
  // Private data (hidden by default, only show if user opts in)
  commitment?: string; // Only if private
  amountHashed?: string; // Not actual amount
}
```

**Privacy Features:**
- Public receipts: Show full details
- Private receipts: Show only aggregate impact (yield +X%, trust +Y)
- Dark Ledger receipts: Show commitment hash, not amount
- User can expand to see more detail (with authentication)

---

## UI/UX: Three Toggle Modes

### Mode 1: Manual (User-Driven)
```
┌─ Mode Toggle: Manual [✓] | Advisory | Terminal
├─ Left Sidebar:
│  └─ Adapter filters (Ekubo, Lending, Staking, Dark Ledger)
├─ Main Panel:
│  ├─ All opportunities (sorted by composite score)
│  └─ Each shows: Name | Adapter | APY | Risk | Policy Status | Select
├─ Bottom Panel:
│  ├─ Selected opportunity details
│  ├─ Amount input
│  ├─ Slippage control
│  ├─ Privacy mode toggle (if supported)
│  ├─ Policy gate status (✓ PASS / ⚠ WARNING / ✗ BLOCKED)
│  └─ [Execute] button
└─ Privacy Indicator: 
   └─ "Privacy Level: [Public] [Shielded] [Dark Ledger]"
```

### Mode 2: Advisory (Agent Recommends)
```
┌─ Mode Toggle: Manual | Advisory [✓] | Terminal
├─ Top Panel: AI Recommendation
│  ├─ ★ RECOMMENDED: Ekubo ETH/USDC LP
│  ├─ Why: "High yield (12.5%), low vol, policy approved"
│  ├─ Confidence: 87%
│  ├─ Privacy: Can execute shielded via Dark Ledger first
│  └─ [Execute Recommended] button
├─ Below: All alternatives (if user wants to override)
└─ Privacy Indicator:
   └─ "Privacy Level: [Recommended Path Uses Dark Ledger]"
```

### Mode 3: Terminal (Pro/Compact)
```
┌─ Mode Toggle: Manual | Advisory | Terminal [✓]
├─ Compact ranked list:
│  ├─ Ekubo ETH/USDC LP | 12.5% | Risk 30 | ✓ | [Select]
│  ├─ Lending STRK | 8% | Risk 15 | ⚠ | [Select]
│  └─ Staking STRK | 4.2% | Risk 5 | ✓ | [Select]
├─ Adapter badges (tiny icons)
└─ One-click execute selected
```

---

## Privacy Preservation Strategy

### By Component:

| Component | Privacy Threat | Mitigation |
|-----------|---|---|
| MarketDataService | Portfolio inference | Use risk profile only, not actual holdings |
| AIRecommendationService | Recommendation history leaking | Stateless, in-memory only |
| CircuitPolicyGate | Policy exposure | Local evaluation, never sent to server |
| ExecutionAdapter | Transaction privacy | Support Dark Ledger routing, commitments |
| ReceiptService | Sensitive data in timeline | Hash sensitive data, show aggregates |
| OpportunityList | User preference inference | Don't track which opportunities user views |

### By Flow:

**Public Execution (e.g., Ekubo swap):**
```
User selects opportunity → Check policy gate → 
If policy says "public OK" → Execute directly → Public receipt
```

**Private Execution (e.g., via Dark Ledger):**
```
User selects opportunity → Check policy gate → 
If policy says "use Dark Ledger" → 
  Generate commitment → Deposit to Dark Ledger → 
  Execute swap from Dark Ledger → 
  Withdraw to Dark Ledger → Private receipt (hash only)
```

**Hybrid (Selective Privacy):**
```
User selects opportunity + sets privacy tier → 
Policy gate enforces minimum tier → 
Route through appropriate privacy level → 
Mixed receipt (aggregate + private hash)
```

---

## Integration Points

### With Capital Ledger (Left Rail):
- Click deployed position → Trade Desk opens with that position pre-selected
- "Rebalance" action → Trade Desk in Manual mode showing alternatives
- Privacy level visible on position (🔒 Private | 🌐 Public)

### With Memory Lane (Bottom):
- Every execution generates receipt
- Receipt appears in timeline with privacy level badge
- Click receipt → Expand to see details (if privacy allows)
- Privacy-aware grouping (private receipts together, public separate)

### With Circuit Board:
- Policies become execution guards in Trade Desk
- Policy violations marked with ⚠️ WARNING
- User can "Request Override" (generates approval request)

### With Oracle Intelligence Strip:
- Opportunity in oracle strip → [Deploy] button
- Opens Trade Desk with that opportunity pre-selected
- Advisory mode shows why oracle recommended it

---

## Data Flow: End-to-End (Privacy Preserved)

```
┌─ Intelligence Streams
│  ├─ zkGraph: Market data (public)
│  ├─ zkRAG: Agent reasoning (no user portfolio)
│  └─ Risk Passport: Risk profile (aggregated only)
│
├─ Opportunity Discovery (MarketDataService)
│  ├─ Fetch public opportunities
│  ├─ Flag private routing options
│  └─ Rank by scores (no portfolio lookup)
│
├─ Policy Gate (CircuitPolicyGate)
│  ├─ Evaluate against user policies (local)
│  ├─ Filter by privacy constraints
│  └─ Determine execution path
│
├─ Execution (ExecutionAdapter)
│  ├─ Route through selected adapter
│  ├─ Apply privacy protections (if needed)
│  └─ Generate receipt with privacy metadata
│
└─ Memory Lane Integration
   ├─ Store receipt (hash sensitive data)
   ├─ Display with privacy badge
   └─ Allow expand if user authenticates
```

---

## Modules to Build/Extract

### New Modules (Build):
1. `TradeDesk.tsx` - Main component wrapper
2. `MarketDataService.ts` - Opportunity discovery
3. `AIRecommendationService.ts` - Agent reasoning integration
4. `CircuitPolicyGate.ts` - Policy evaluation
5. `ReceiptService.ts` - Privacy-aware receipts
6. `OpportunityList.tsx` - Opportunity rendering
7. `ExecutionPanel.tsx` - Execution controls

### Extracted & Refactored (from VaultTradeTab):
1. `EkuboAdapter.ts` - Swap + LP (privacy-enhanced)
2. `LendingAdapter.ts` - Lending (privacy-enhanced)
3. `StakingAdapter.ts` - Staking (privacy-enhanced)
4. `DarkLedgerAdapter.ts` - Shielded routing (privacy-aware)
5. `MarketDataLPPanel.ts` - Market data sourcing (extracted, tested)

---

## Success Criteria

✅ Trade Desk displays opportunities with adapter clarity  
✅ Three toggle modes work independently (Manual, Advisory, Terminal)  
✅ Policy gates enforce circuit constraints  
✅ Privacy level is always visible and preserved  
✅ Execution generates proper receipts for Memory Lane  
✅ No user portfolio data exposed in recommendations  
✅ Dark Ledger routing is seamless and automated  
✅ All legacy logic is extracted, tested, and optimized for Capital OS  

---

## Privacy Audit Checklist

Before implementation completion:
- [ ] MarketDataService never accesses full portfolio
- [ ] AIRecommendationService doesn't store user history
- [ ] CircuitPolicyGate evaluation is local-only
- [ ] ExecutionAdapters support private routing
- [ ] ReceiptService hashes sensitive data
- [ ] Dark Ledger flows are tested end-to-end
- [ ] Privacy badges accurately reflect execution path
- [ ] No sensitive data in browser localStorage
- [ ] All adapters support commitment-based execution
- [ ] Memory Lane respects privacy level on display
