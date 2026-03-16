# Reputation & Credit System UI Integration (FICO Pack + Additive Systems)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build comprehensive Credit & Reputation Hub UI that integrates FICO pack proofs additively with existing credit systems, lending/borrowing, and explainability.

**Architecture:** 
- Unified "Credit & Reputation Hub" component replacing scattered reputation displays
- FICO pack proofs (5 circuits) as additive verification layer, not replacement
- Explainability UI showing how credit conclusions are derived
- Lending/borrowing integration with credit line visualization
- System perks display (what proofs unlock)

**Tech Stack:** React/Next.js, TypeScript, TailwindCSS, framer-motion, Starknet

---

## Phase 1: Cleanup & Architecture

### Task 1.1: Audit Current Profile Components

**Action:** Identify redundant/outdated components

**Step 1: List current reputation UI**

Run:
```bash
cd /opt/obsqra.starknet/zkdefi
grep -r "reputation\|tier\|credit" frontend/src/components/zkdefi/*.tsx | grep -v node_modules | cut -d: -f1 | sort -u
```

Expected: List of files using reputation/tier/credit

**Step 2: Analyze profile page structure**

Read: `/opt/obsqra.starknet/zkdefi/frontend/src/app/profile/page.tsx:972-1050`

Identify:
- Current reputation tab (lines 972-1050)
- Stats grid showing: tier, tenure, txns, collateral
- On-chain reputation section

**Step 3: Document findings**

Create: `/opt/obsqra.starknet/zkdefi/docs/UI_AUDIT_REPUTATION.md`

Structure:
```markdown
# Reputation UI Audit

## Current Components (Keep)
- ProfileJourneyBanner - user guidance
- RiskProfileSummaryCard - risk assessment
- CompliancePanel - regulatory info

## Current Components (Replace/Consolidate)
- Reputation tab stats grid (lines 980-997) - basic stats, no credit context
- On-chain reputation section - isolated, not connected to credit

## Missing (Build)
- Credit line visualization (collateral-backed + unsecured)
- FICO pack proof status (5 circuits)
- Lending positions display
- Explainability panel
- System perks display
```

**Step 4: Create component architecture**

Create: `/opt/obsqra.starknet/zkdefi/docs/CREDIT_HUB_ARCHITECTURE.md`

(Full architecture doc content - see implementation for complete structure)

Key points:
- Component hierarchy: CreditReputationHub → 4 sub-panels
- Data flow: useRiskProfileV2, reputationApi, lendingApi, creditLineService
- Integration points: Profile page, Vault page, Agent page

---

## Phase 2: Core Components

### Task 2.1: Build TierCard Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/TierCard.tsx`

**Component spec:**
- Displays current tier (0/1/2) with icon & color
- Shows tier description (Strict/Standard/Express)
- Displays upgrade requirements
- Shows progress toward next tier
- "Upgrade" button when eligible

**Styling:**
- Tier 0: blue gradient, Lock icon
- Tier 1: emerald gradient, Shield icon
- Tier 2: orange gradient, TrendingUp icon

**Props:**
```typescript
interface TierCardProps {
  tier: number;
  tierName: string;
  collateralEth: number;
  tenureDays: number;
  successfulTxns: number;
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

### Task 2.2: Build CreditLineVisualizer Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/CreditLineVisualizer.tsx`

**Component spec:**
- Total credit line (large number, emerald color)
- Breakdown: Collateral-backed vs. Unsecured
- Animated horizontal bar chart (framer-motion)
- Borrow rate display (APY)
- Multipliers section (cross-chain, credit graph)

**Visual elements:**
- Blue bar segment: collateral-backed (80% LTV)
- Emerald bar segment: unsecured (reputation-based)
- Percentage labels inside bars (if width >= 15%)

**Props:**
```typescript
interface CreditLineVisualizerProps {
  collateralEth: number;
  collateralLineEth: number;
  unsecuredCapEth: number;
  totalLineEth: number;
  rateBps: number;
  tier: number;
  letterRating: string;
  creditTier?: string;
  crossChainMultiplier: number;
  collaborativeMultiplier: number;
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

### Task 2.3: Build LendingPositionsSummary Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/LendingPositionsSummary.tsx`

**Component spec:**
- Displays total borrowed & supplied (ETH)
- Number of active loans & supplies
- Empty state: "No active lending positions" + link to Lending Pool
- Quick action button: "Manage Positions →" (links to /vault?tab=lending)

**Styling:**
- Supplied: emerald background, TrendingUp icon
- Borrowed: amber background, TrendingDown icon

**Props:**
```typescript
interface LendingPosition {
  id: number;
  principal_wei: string;
  interest_accrued_wei: string;
  interest_rate_bps: number;
  opened_at: number;
  active: boolean;
}

interface SupplyPosition {
  id: number;
  shares: string;
  supplied_wei: string;
  accrued_interest_wei: string;
  supplied_at: number;
  active: boolean;
}

interface LendingPositionsSummaryProps {
  loans: LendingPosition[];
  supplies: SupplyPosition[];
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

### Task 2.4: Build CreditOverviewPanel Wrapper

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/CreditOverviewPanel.tsx`

**Component spec:**
- Fetches data from 3 APIs:
  1. `/api/v1/zkdefi/reputation/user/{address}` → reputation
  2. `/api/v1/zkdefi/profile/decision?address={address}` → credit line
  3. `/api/v1/zkdefi/lending/positions/{address}` → lending
- Loading state: Loader2 spinner
- Error state: red alert box
- Renders: TierCard + grid of (CreditLineVisualizer, LendingPositionsSummary)

**Props:**
```typescript
interface CreditOverviewPanelProps {
  address: string;
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

## Phase 3: FICO Pack Components

### Task 3.1: Build ProofCard Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/ProofCard.tsx`

**Component spec:**
- Shows proof title, description, icon
- Status indicator (complete/pending/available)
- Perks list (unlocked by this proof)
- "Generate Proof" button (when status = available)
- Verified date (when status = complete)

**Status colors:**
- Complete: emerald (CheckCircle icon)
- Pending: amber (Clock icon)
- Available: zinc (FileCheck icon)

**Props:**
```typescript
interface ProofCardProps {
  title: string;
  description: string;
  status: "complete" | "pending" | "available";
  completedAt?: string;
  icon: React.ReactNode;
  onGenerate?: () => void;
  perks?: string[];
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

### Task 3.2: Build FicoPackProofPanel Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/FicoPackProofPanel.tsx`

**Component spec:**
- Displays 5 ProofCards:
  1. **Solvency Proof** (Shield, blue) → higher credit, unsecured lending, reduced penalty
  2. **Risk Passport** (TrendingUp, emerald) → Tier 2, autonomous agents, priority access
  3. **Trader Performance** (Activity, purple) → fee discount, leveraged strategies
  4. **Strategy Integrity** (Lock, amber) → custom strategies, higher limits
  5. **Execution Integrity** (Zap, orange) → relayer discount, MEV protection
- Progress indicator: "X / 5 Complete"
- TODO: Fetch actual proof statuses from backend (currently mocked)
- TODO: Implement proof generation modal

**Props:**
```typescript
interface FicoPackProofPanelProps {
  address: string;
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

## Phase 4: Explainability & Perks

### Task 4.1: Build ExplainabilityPanel Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/ExplainabilityPanel.tsx`

**Component spec:**
- Scoring method badge (Formulaic / Predictive zkML / RISC Zero)
- **Formulaic mode:**
  - Unsecured capacity formula breakdown
  - Factor contributions (tier weight, letter weight, credit weight)
  - Cross-chain boost calculation
  - Credit graph boost calculation
  - Total unsecured capacity
- **Predictive mode:**
  - Credit class (AAA/AA/A/B/C)
  - Model name (XGBoost / RISC Zero)
  - Feature count (38 features)
- **Both modes:**
  - Collateral-backed credit (collateral × 80% LTV)

**Weights (hardcoded for display):**
```typescript
TIER_WEIGHTS = { 0: 0.0, 1: 0.5, 2: 1.0 }
LETTER_WEIGHTS = { A: 1.0, B: 0.6, C: 0.3, D: 0.0 }
CREDIT_WEIGHTS = { AAA: 1.5, AA: 1.2, A: 1.0, B: 0.5, C: 0.2 }
BASE_UNSECURED_CAP = 5.0 ETH
```

**Props:**
```typescript
interface ExplainabilityPanelProps {
  creditLine: {
    collateral_eth: number;
    collateral_line_eth: number;
    unsecured_cap_eth: number;
    total_line_eth: number;
    rate_bps: number;
    tier: number;
    letter_rating: string;
    credit_tier?: string;
    cross_chain_multiplier: number;
    collaborative_multiplier: number;
    predictive_credit?: {
      credit_class: string;
      model_used: string;
    };
  };
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

### Task 4.2: Build SystemPerksPanel Component

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/credit/SystemPerksPanel.tsx`

**Component spec:**
- Shows all system perks (proof-gated features)
- **Unlocked perks** (green cards, CheckCircle icon):
  - User has completed required proofs & tier
  - Shows perk title, description
- **Available perks** (grey cards, Lock icon):
  - Missing proofs or tier
  - Shows requirements (e.g., "solvency proof + Tier 2")

**Perks list (10 total):**
1. Standard Tier Access (Tier 1, no proofs)
2. Express Tier Access (Tier 2, risk_passport proof)
3. Enhanced Credit Line (+20%, solvency proof, Tier 1)
4. Unsecured Lending (solvency + risk_passport, Tier 2)
5. Trading Fee Discount (trader_performance, Tier 1)
6. Leveraged Strategies (trader_performance + strategy_integrity, Tier 2)
7. Custom Strategy Deployment (strategy_integrity, Tier 2)
8. Relayer Fee Discount (execution_integrity, Tier 1)
9. MEV Protection (execution_integrity, Tier 2)
10. Reduced Liquidation Penalty (solvency, Tier 1)

**Props:**
```typescript
interface SystemPerksPanelProps {
  completedProofs: string[];
  tier: number;
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

## Phase 5: Integration

### Task 5.1: Create CreditReputationHub Wrapper

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/CreditReputationHub.tsx`
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/ui/Tabs.tsx` (if missing)

**Component spec (CreditReputationHub):**
- 4 tabs: Overview, FICO Pack Proofs, Explainability, System Perks
- Tab state management (useState)
- Fetches credit data once (shared across tabs)
- Renders appropriate panel based on activeTab

**Component spec (Tabs):**
- Simple tab navigation UI
- Active tab: blue border-bottom & text
- Inactive tab: transparent border, zinc text, hover effect

**Props:**
```typescript
interface CreditReputationHubProps {
  address: string;
}

interface TabsProps {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}
```

**Verify:** `npm run build` (no TypeScript errors)

---

### Task 5.2: Integrate into Profile Page

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/app/profile/page.tsx:972-1050`

**Changes:**
1. Add import: `import { CreditReputationHub } from "@/components/zkdefi/CreditReputationHub";`
2. Replace reputation tab content (lines 972-1050) with:
   ```typescript
   {activeTab === "reputation" && (
     <CreditReputationHub address={effectiveAddress!} />
   )}
   ```

**Removed (old code):**
- Stats grid (lines 980-997): tier, tenure, txns, collateral
- On-chain reputation section (lines 1000-1050)
- Staking section (if present)

**Rationale:** All this data is now in CreditReputationHub with better UX

**Verify:**
1. `npm run build` (no TypeScript errors)
2. `pm2 restart zkdefi-frontend`
3. Visit: `http://localhost:3000/profile?mode=demo&tab=reputation`
4. Confirm: New hub renders, no old stats grid visible

---

### Task 5.3: Add Lending API Client

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/lib/api/lending.ts`

**API methods:**
```typescript
export async function getLendingPositions(address: string): Promise<LendingPositionsResponse>
export async function getPoolStats(): Promise<PoolStats>
```

**Endpoints:**
- `GET /api/v1/zkdefi/lending/positions/{address}` → loans & supplies
- `GET /api/v1/zkdefi/lending/pool` → pool stats (utilization, APY)

**Update CreditOverviewPanel:**
- Replace `fetch(...)` with `await lendingApi.getLendingPositions(address)`

**Verify:** `npm run build` (no TypeScript errors)

---

## Phase 6: Cleanup

### Task 6.1: Remove Redundant Components

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/app/profile/page.tsx`

**Actions:**
1. Verify old reputation stats grid (lines 980-997) is removed
   - Run: `grep -n "Access Tier" frontend/src/app/profile/page.tsx`
   - Expected: No matches (or only in CreditReputationHub import)

2. Verify no other isolated reputation displays exist
   - Run: `grep -r "userRep?.tier" frontend/src/app --exclude-dir=node_modules`
   - Expected: Only in profile page (now using CreditReputationHub)

3. Check for unused imports in profile page
   - Look for imports used only by old reputation tab
   - Remove if no longer needed

**Verify:** No unused code, profile page clean

---

## Phase 7: Documentation

### Task 7.1: Create User Guide

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/docs/CREDIT_HUB_USER_GUIDE.md`

**Content sections:**
1. **Overview** - What is the Credit & Reputation Hub
2. **Accessing the Hub** - Navigate to /profile → Reputation tab
3. **Tabs** - Detailed walkthrough of all 4 tabs
   - Overview: Tier, credit line, lending positions
   - FICO Pack Proofs: 5 proofs, status, perks
   - Explainability: How credit is computed
   - System Perks: Unlocked vs. available features
4. **Upgrading Your Tier** - Step-by-step for Tier 0→1, 1→2
5. **Generating FICO Pack Proofs** - Proof generation flow
6. **FAQ** - Common questions (why is unsecured credit 0? how to increase credit?)

**Verify:** User guide is clear, actionable, complete

---

### Task 7.2: Update Architecture Doc

**Files:**
- Update: `/opt/obsqra.starknet/zkdefi/docs/REPUTATION_SYSTEM_ARCHITECTURE.md`

**Additions (new section 5):**
```markdown
## 5. Frontend Credit & Reputation Hub

### Overview
The Credit & Reputation Hub is a unified UI component that replaces scattered reputation displays.

### Component Structure
(Component hierarchy diagram)

### Data Sources
(API endpoints used)

### System Perks
(Proof → perk mapping table)

### Integration Points
(Profile page, Vault page, Agent page links)
```

**Verify:** Architecture doc reflects new UI structure

---

## Phase 8: Verification

### Task 8.1: E2E Test in Browser

**Test Plan:**

**Setup:**
1. `cd /opt/obsqra.starknet/zkdefi`
2. `pm2 restart zkdefi-backend zkdefi-frontend`
3. Visit: `http://localhost:3000/profile?mode=demo&tab=reputation`

**Test Cases:**

**TC1: Overview Tab**
- ✅ Tier card displays (Tier 0/1/2, correct color)
- ✅ Upgrade button appears when eligible (7+ days, 3+ txns for Tier 1)
- ✅ Credit line visualizer renders (collateral + unsecured bars)
- ✅ Lending positions summary shows (empty or with data)
- ✅ No layout breaks, responsive on mobile

**TC2: FICO Pack Proofs Tab**
- ✅ 5 proof cards display
- ✅ Status indicators correct (complete/pending/available)
- ✅ Perks list shows for each proof
- ✅ "Generate Proof" button appears for available proofs
- ✅ Progress indicator shows "X / 5 Complete"

**TC3: Explainability Tab**
- ✅ Scoring method badge displays (Formulaic / Predictive)
- ✅ Unsecured capacity formula breakdown visible
- ✅ Factor contributions display (tier/letter/credit weights)
- ✅ Multipliers section shows (cross-chain, credit graph)
- ✅ Collateral-backed credit displays (collateral × 0.80)

**TC4: System Perks Tab**
- ✅ Unlocked perks render (green cards with CheckCircle)
- ✅ Available perks render (grey cards with Lock)
- ✅ Requirements display for locked perks
- ✅ Hover effect works on cards

**TC5: Integration**
- ✅ Tab switching works smoothly (no flicker)
- ✅ No old reputation stats grid visible
- ✅ No console errors
- ✅ API calls succeed (check Network tab)
- ✅ Demo mode functional (no wallet required)

---

### Task 8.2: Document Results

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/CREDIT_HUB_VERIFICATION.md`

**Content:**
```markdown
# Credit & Reputation Hub Verification

## Date
2026-03-05

## Test Results
(Checklist of all test cases with ✅/❌)

## Known Gaps
1. Proof generation modal not implemented (next iteration)
2. Actual proof status from backend (currently mocked)
3. Tier upgrade API call (endpoint exists, frontend integration next)

## Next Steps
1. Implement proof generation modal with input forms
2. Connect proof status API endpoint
3. Add tier upgrade mutation
4. Test with real wallet (not demo mode)
5. Browser E2E testing across devices
```

---

## Success Criteria

### Must Have (This Iteration)
- [x] All components build without TypeScript errors
- [x] Profile page integrates CreditReputationHub cleanly
- [x] No redundant reputation displays remain
- [x] All 4 tabs render correctly
- [x] Lending integration works (API + UI)
- [x] Explainability shows credit calculation
- [x] System perks display proof-gated features
- [x] Documentation created (user guide + architecture)

### Nice to Have (Next Iteration)
- [ ] Proof generation modal with input forms
- [ ] Real proof status from backend API
- [ ] Tier upgrade button functional (API call)
- [ ] E2E test with real wallet (not demo)
- [ ] Mobile responsive testing
- [ ] Animation polish (framer-motion transitions)

### Future Enhancements
- [ ] Proof verification status polling (real-time updates)
- [ ] Credit score history chart (track over time)
- [ ] Perk recommendation engine (suggest next proofs)
- [ ] Social proof sharing (share tier/proofs on Twitter)

---

## Technical Notes

### API Contracts

**Reputation User:**
```typescript
GET /api/v1/zkdefi/reputation/user/{address}
Response: {
  tier: number;
  tier_name: string;
  tenure_days: number;
  successful_txns: number;
  collateral_eth: number;
  letter_rating: string;
  credit_tier: string;
}
```

**Credit Line Decision:**
```typescript
GET /api/v1/zkdefi/profile/decision?address={address}
Response: {
  credit_line: {
    collateral_eth: number;
    collateral_line_eth: number;
    unsecured_cap_eth: number;
    total_line_eth: number;
    rate_bps: number;
    tier: number;
    letter_rating: string;
    credit_tier: string;
    cross_chain_multiplier: number;
    collaborative_multiplier: number;
    predictive_credit?: {
      credit_class: string;
      model_used: string;
    };
  };
  reputation: { ... };
}
```

**Lending Positions:**
```typescript
GET /api/v1/zkdefi/lending/positions/{address}
Response: {
  loans: LendingPosition[];
  supplies: SupplyPosition[];
  loan_count: number;
  supply_count: number;
}
```

### Component Dependencies

```
frontend/package.json:
  - react, next, typescript (existing)
  - framer-motion (existing)
  - lucide-react (existing)
  - @starknet-react/core (existing)
  
No new dependencies required.
```

### File Structure

```
frontend/src/
├── components/
│   ├── zkdefi/
│   │   ├── CreditReputationHub.tsx (new)
│   │   └── credit/ (new folder)
│   │       ├── TierCard.tsx
│   │       ├── CreditLineVisualizer.tsx
│   │       ├── LendingPositionsSummary.tsx
│   │       ├── CreditOverviewPanel.tsx
│   │       ├── ProofCard.tsx
│   │       ├── FicoPackProofPanel.tsx
│   │       ├── ExplainabilityPanel.tsx
│   │       └── SystemPerksPanel.tsx
│   └── ui/
│       └── Tabs.tsx (new if missing)
├── lib/
│   └── api/
│       └── lending.ts (new)
└── app/
    └── profile/
        └── page.tsx (modified)
```

---

## Implementation Order

1. **Phase 1** (Audit) → Understand current state
2. **Phase 2** (Core) → Build Overview tab components
3. **Phase 3** (FICO) → Build FICO Pack Proofs tab
4. **Phase 4** (Explain) → Build Explainability & Perks tabs
5. **Phase 5** (Integrate) → Wire into profile page
6. **Phase 6** (Cleanup) → Remove old code
7. **Phase 7** (Docs) → User guide + architecture
8. **Phase 8** (Verify) → E2E test + document results

**Total Estimated Tasks:** 16 tasks across 8 phases
**Recommended Batch Size:** 3-4 tasks per review checkpoint
