# Vault UX Polish + Capital OS Integration — Implementation Plan

**Date:** 2026-03-05  
**Status:** Ready for execution  
**Context:** The Capital OS shell + Oracle surface are in place, but the vault redesign features (side-by-side deposit/withdraw, AI Insight, Trending Bar, Allocation Preview, Proof Pipeline, Deploy to Ekubo promotion, DCA) are missing. This plan implements the full vault UX vision from the March 2-3 designs.

---

## Problem

Current state (after Capital OS Phase 1):
- ✅ Capital OS Strip with Identity, Gate, Ledger
- ✅ Oracle surface (Signals, Radar, Genome)
- ✅ Vault > Trade tab (Swap, LP, Limits)
- ✅ Privacy tier selector (4 cards)
- ✅ strkBTC token support
- ❌ Deposit/withdraw are stacked vertically (not side-by-side)
- ❌ No AI Insight card
- ❌ No Trending Bar with market pulse
- ❌ No Allocation Preview (where capital will be deployed)
- ❌ No Proof Pipeline visualization
- ❌ No enhanced Positions table
- ❌ Capital OS Strip right half (Next step + AI insight) is incomplete
- ❌ Deploy to Ekubo not promoted on Yield tab
- ❌ No DCA tool
- ❌ Missing visual polish and spacing

**Goal:** Nail the UI/UX by implementing all missing features from the vault redesign and UX optimization plans.

---

## Architecture Overview

```
agent/page.tsx (shell)
├── Enhanced CapitalOSStrip
│   ├── Left: Identity | Gate | Ledger (existing)
│   └── Right: Next Step + AI Insight (NEW)
├── Surface tabs: Vault | Oracle | Brain
└── VaultSurface (refactored)
    ├── Portfolio tab (NEW layout)
    │   ├── VaultHealthMeter
    │   ├── NextRebalanceStrip
    │   ├── TrendingBar (NEW)
    │   ├── AIInsight (NEW)
    │   ├── TierSelector (existing, enhanced)
    │   ├── Side-by-side Deposit | Withdraw (NEW layout)
    │   │   ├── Deposit
    │   │   │   ├── AmountInput
    │   │   │   ├── AllocationPreview (NEW)
    │   │   │   └── ProofStepper (NEW)
    │   │   └── Withdraw
    │   │       ├── CommitmentPicker (enhanced)
    │   │       ├── AmountInput
    │   │       └── ProofStepper (NEW)
    │   └── PositionsOverview (enhanced)
    ├── Yield tab
    │   ├── DeployToEkuboCard (promoted, NEW)
    │   ├── YieldSummary
    │   ├── YieldSources
    │   └── PerformanceChart
    ├── Trade tab (existing)
    ├── Lending tab (existing)
    ├── Staking tab (existing)
    └── Activity tab (existing)
```

---

## Tasks

### Task 1: Enhanced Capital OS Strip (Right Half)

**Objective:** Add "Next step + AI insight" to the right half of the Capital OS Strip.

**Steps:**

1. Read current `CapitalOSStrip.tsx` to understand structure
2. Add new props to `CapitalOSStripProps`:
   ```typescript
   nextStep?: {
     copy: string;
     action?: string; // "vault" | "oracle" | "brain"
     actionLabel?: string;
   };
   aiInsight?: {
     message: string;
     reasoning?: string;
   };
   onNextStepClick?: () => void;
   ```
3. Modify layout to use `grid grid-cols-2 gap-4` for left/right split
4. Left half: Identity | Gate | Ledger (existing, no changes)
5. Right half: Render next step card with action button (if present) and AI insight (if present)
6. Update `agent/page.tsx` to pass next step + AI insight data (demo mode uses static data, live mode fetches from `/zkdefi/agent/recommendation`)
7. Add to `demoCapitalOS.ts`:
   ```typescript
   export const DEMO_NEXT_STEP = {
     copy: "Agent running — 3 opportunities in Oracle",
     action: "oracle",
     actionLabel: "View Signals"
   };
   export const DEMO_AI_INSIGHT = {
     message: "Ekubo ETH/STRK pool APY jumped 3.2% in 24h",
     reasoning: "Your reputation qualifies for relayed withdrawals"
   };
   ```

**Verification:**
- Capital OS Strip shows left (Identity, Gate, Ledger) and right (Next Step, AI Insight)
- Clicking "View Signals" navigates to Oracle > Signals
- Demo mode shows static data, live mode attempts API fetch

---

### Task 2: Trending Bar Component

**Objective:** Create `TrendingBar` component showing market pulse stats.

**Steps:**

1. Create `frontend/src/components/zkdefi/vault/TrendingBar.tsx`:
   ```typescript
   export interface TrendingBarProps {
     isDemo?: boolean;
   }
   ```
2. Fetch data from `/zkdefi/market/surface` and `/zkdefi/oracle/pool-apys` (30s poll)
3. Display slim stats bar:
   - STRK/ETH 24h change (with up/down arrow and color)
   - Top pool + APY (name + percentage)
   - Vault TVL (formatted with K/M suffix)
   - Active depositors count
   - Average APY across all pools
4. Demo mode: use static data from `demoCapitalOS.ts`:
   ```typescript
   export const DEMO_TRENDING = {
     strkEth24h: 2.4,
     topPool: { name: "STRK/ETH", apy: 22.0 },
     vaultTvl: 1200000,
     activeDepositors: 47,
     avgApy: 18.5
   };
   ```
5. Responsive: `overflow-x-auto` with `flex gap-4` items

**Verification:**
- Trending Bar appears below NextRebalanceStrip on Portfolio tab
- Shows 5 stats with proper formatting
- Demo mode shows static data

---

### Task 3: AI Insight Card

**Objective:** Create `AIInsight` card for Portfolio tab.

**Steps:**

1. Create `frontend/src/components/zkdefi/vault/AIInsight.tsx`:
   ```typescript
   export interface AIInsightProps {
     message: string;
     reasoning?: string;
     onDismiss?: () => void;
   }
   ```
2. Card displays:
   - Brain icon + "AI Insight" header
   - Message text (bold)
   - Reasoning text (gray, smaller)
   - Dismiss button (X)
3. Styling: light blue background, border, rounded corners
4. Wire into `VaultTab.tsx` below TrendingBar
5. Fetch from `/zkdefi/agent/recommendation` in live mode, use `DEMO_AI_INSIGHT` in demo mode
6. Dismissable: store dismissed state in localStorage `zkdefi_ai_insight_dismissed_{address}`

**Verification:**
- AI Insight card appears below Trending Bar
- Shows message and reasoning
- Dismiss button hides card (persists across reload)

---

### Task 4: Allocation Preview Component

**Objective:** Create `AllocationPreview` component showing where deposit capital will be deployed.

**Steps:**

1. Create `frontend/src/components/zkdefi/vault/AllocationPreview.tsx`:
   ```typescript
   export interface AllocationPreviewProps {
     amount: string;
     asset: "STRK" | "ETH" | "strkBTC";
     riskProfile?: string;
     isDemo?: boolean;
   }
   ```
2. Fetch allocation split from `/strategies/recommend` (pass amount, asset, risk profile)
3. Display:
   - Section header: "Capital Deployment"
   - Allocation breakdown: Ekubo LP %, Lending %, Staking %, Idle %
   - Horizontal bar chart (color-coded segments)
   - Blended APY estimate
4. Demo mode: calculate deterministic split based on demo opportunities:
   - Ekubo LP: 60%
   - Lending: 25%
   - Staking: 10%
   - Idle: 5%
   - Blended APY: weighted average
5. Show below amount input in `DepositPanel`

**Verification:**
- Allocation Preview appears when user enters deposit amount > 0
- Shows breakdown with percentages and blended APY
- Demo mode uses static split

---

### Task 5: Proof Stepper Component

**Objective:** Create `ProofStepper` component visualizing proof pipeline steps.

**Steps:**

1. Create `frontend/src/components/zkdefi/vault/ProofStepper.tsx`:
   ```typescript
   export interface ProofStepperProps {
     steps: Array<{
       label: string;
       status: "pending" | "active" | "done" | "error";
       description?: string;
     }>;
   }
   ```
2. Visual design inspired by obsqra.fi `DataPathVisualization`:
   - Horizontal stepper with circles and connecting lines
   - Green checkmark for "done"
   - Blue spinner for "active"
   - Gray circle for "pending"
   - Red X for "error"
3. Responsive: `overflow-x-auto` for narrow screens
4. Define step sequences per privacy tier:
   ```typescript
   const COMMITMENT_SHIELD_STEPS = [
     { label: "Generate Commitment", status: "pending" },
     { label: "Approve & Sign", status: "pending" },
     { label: "Confirm", status: "pending" }
   ];
   const NULLIFIER_SET_STEPS = [
     { label: "Generate Secret", status: "pending" },
     { label: "Register in Tree", status: "pending" },
     { label: "Build Proof", status: "pending" },
     { label: "Approve & Sign", status: "pending" }
   ];
   // ... similar for other tiers
   ```
5. Wire into `DepositPanel` and `WithdrawPanel` below allocation preview

**Verification:**
- Proof Stepper appears in deposit/withdraw panels
- Shows correct step sequence for selected privacy tier
- Steps advance from pending → active → done during proof generation

---

### Task 6: Side-by-Side Deposit/Withdraw Layout

**Objective:** Refactor Portfolio tab to show deposit and withdraw panels side-by-side (not stacked).

**Steps:**

1. Read current `VaultTab.tsx` structure
2. Modify layout to use `grid grid-cols-1 lg:grid-cols-2 gap-6` for deposit/withdraw
3. Deposit panel (left):
   - Token selector (STRK | ETH | strkBTC)
   - Amount input with MAX button
   - AllocationPreview (Task 4)
   - ProofStepper (Task 5)
   - "Deposit with Privacy" button
4. Withdraw panel (right):
   - CommitmentPicker (select existing position)
   - Amount input (grayed for Commitment Shield, editable for Nullifier Set / Dark Ledger)
   - Relayer toggle (only if reputation tier qualifies)
   - ProofStepper (Task 5)
   - "Withdraw Privately" button
5. Mobile: stack vertically with `grid-cols-1`
6. Add subtle border between panels on desktop

**Verification:**
- Deposit and withdraw panels appear side-by-side on desktop
- Stack vertically on mobile
- Both panels include proof steppers and allocation preview (deposit only)

---

### Task 7: Enhanced Positions Overview

**Objective:** Enhance `PositionsOverview` with clickable rows that auto-select in withdraw panel.

**Steps:**

1. Read current `PositionsOverview` component
2. Add `onSelectPosition` callback prop:
   ```typescript
   export interface PositionsOverviewProps {
     // ... existing props
     onSelectPosition?: (commitmentId: string) => void;
   }
   ```
3. Make table rows clickable:
   - Add hover state (light background)
   - Add cursor-pointer
   - On click, call `onSelectPosition(commitment.id)` and scroll to withdraw panel
4. Wire in `VaultTab.tsx`:
   - Pass `onSelectPosition` callback
   - Callback sets selected commitment in withdraw panel state
   - Scroll to withdraw panel: `document.getElementById("withdraw-panel")?.scrollIntoView({ behavior: "smooth" })`
5. Add "Capital Deployed" section showing aggregate allocation across all positions:
   - Ekubo LP: X STRK
   - Lending: X STRK
   - Staking: X STRK
   - Idle: X STRK
6. Add Privacy/Public toggle:
   - Privacy view: aggregate totals only, no individual positions
   - Public view: show all commitments in table

**Verification:**
- Clicking a position row selects it in withdraw panel and scrolls
- "Capital Deployed" section shows aggregate allocation
- Privacy toggle hides individual rows (shows totals only)

---

### Task 8: Deploy to Ekubo Promotion (Yield Tab)

**Objective:** Promote "Deploy to Ekubo" from collapsed accordion to top-level card on Yield tab.

**Steps:**

1. Read current `YieldTab.tsx` structure
2. Check if user has vault balance but no active Ekubo position
3. If true, render `DeployToEkuboCard` component at top of Yield tab (above YieldSummary):
   - Card header: "Deploy Capital to Ekubo"
   - Body: "Earn yield by providing liquidity to Ekubo pools. Your positions are privacy-shielded."
   - Pool selector dropdown (top 3 pools by APY)
   - Amount input
   - "Deploy" button
4. If user has Ekubo position, collapse into a single row in YieldSources table
5. Wire DeployToEkuboCard to call `/deploy-to-ekubo` endpoint (existing)

**Verification:**
- Deploy to Ekubo card appears at top of Yield tab when user has vault balance but no Ekubo position
- Card disappears after deployment (shows in YieldSources table instead)
- Clicking "Deploy" creates Ekubo position

---

### Task 9: DCA Configuration Panel

**Objective:** Create DCA configuration panel as a new sub-tab under Vault > Trade.

**Steps:**

1. Add "DCA" button to `VaultTradeTab.tsx` sub-tabs (Swap | LP | Limits | DCA)
2. Create `frontend/src/components/zkdefi/vault/DCAPanel.tsx`:
   ```typescript
   export interface DCAPanelProps {
     address?: string;
     isDemo?: boolean;
   }
   ```
3. Configuration form:
   - Token pair selector (e.g. STRK → strkBTC)
   - Amount per interval input
   - Interval selector (Hourly | Daily | Weekly)
   - Privacy tier selector (defaults to Nullifier Set)
   - Max slippage tolerance (default 1%)
   - Start/Stop buttons
4. Display active DCA schedules in a table:
   - Pair
   - Amount
   - Interval
   - Next execution
   - Total executed
   - Stop button
5. Wire to new backend endpoint `/vault/dca/schedule` (POST) and `/vault/dca/list` (GET)
6. Demo mode: show 1 pre-configured DCA (STRK → strkBTC, 100 STRK daily)

**Verification:**
- DCA tab appears in Vault > Trade
- User can configure new DCA schedule
- Active DCAs appear in table with next execution time
- Demo mode shows pre-configured DCA

---

### Task 10: Visual Polish Pass

**Objective:** Polish spacing, colors, typography, and responsive behavior across all vault components.

**Steps:**

1. Consistent spacing:
   - Section headers: `mb-4`
   - Cards: `p-6 rounded-lg border`
   - Between sections: `space-y-6`
2. Typography:
   - Headers: `text-xl font-semibold`
   - Sub-headers: `text-lg font-medium`
   - Body: `text-sm text-gray-700 dark:text-gray-300`
3. Colors:
   - Privacy tiers: consistent color scheme (blue → purple → pink → black)
   - Status indicators: green (active), yellow (pending), red (error)
   - Allocation bars: color-coded (blue = Ekubo, green = Lending, orange = Staking, gray = Idle)
4. Responsive:
   - All grids: `grid-cols-1 lg:grid-cols-2` or similar
   - Tables: `overflow-x-auto`
   - Buttons: stack on mobile, horizontal on desktop
5. Animations:
   - Smooth transitions for expand/collapse
   - Fade-in for AI Insight card
   - Proof stepper progress animation
6. Empty states:
   - Portfolio: "No positions yet. Deposit to get started."
   - Yield: "Deploy capital to start earning yield."
   - DCA: "No active DCA schedules. Configure one above."

**Verification:**
- All components have consistent spacing and typography
- Responsive layout works on mobile, tablet, desktop
- Colors are cohesive across vault surface
- Empty states are clear and actionable

---

## Demo Data Additions

Add to `frontend/src/lib/demoCapitalOS.ts`:

```typescript
export const DEMO_NEXT_STEP = {
  copy: "Agent running — 3 opportunities in Oracle",
  action: "oracle" as const,
  actionLabel: "View Signals"
};

export const DEMO_AI_INSIGHT = {
  message: "Ekubo ETH/STRK pool APY jumped 3.2% in 24h",
  reasoning: "Your reputation qualifies for relayed withdrawals"
};

export const DEMO_TRENDING = {
  strkEth24h: 2.4,
  topPool: { name: "STRK/ETH", apy: 22.0 },
  vaultTvl: 1200000,
  activeDepositors: 47,
  avgApy: 18.5
};

export const DEMO_ALLOCATION = {
  ekubo: 60,
  lending: 25,
  staking: 10,
  idle: 5,
  blendedApy: 19.2
};

export const DEMO_DCA = {
  pair: "STRK → strkBTC",
  amountPerInterval: 100,
  interval: "daily",
  nextExecution: new Date(Date.now() + 86400000).toISOString(),
  totalExecuted: 5,
  totalAmount: 500
};
```

---

## Files Affected

### New Files
- `frontend/src/components/zkdefi/vault/TrendingBar.tsx`
- `frontend/src/components/zkdefi/vault/AIInsight.tsx`
- `frontend/src/components/zkdefi/vault/AllocationPreview.tsx`
- `frontend/src/components/zkdefi/vault/ProofStepper.tsx`
- `frontend/src/components/zkdefi/vault/DCAPanel.tsx`
- `frontend/src/components/zkdefi/vault/DeployToEkuboCard.tsx`

### Modified Files
- `frontend/src/components/zkdefi/CapitalOSStrip.tsx` — add right half (next step + AI insight)
- `frontend/src/app/agent/page.tsx` — pass next step + AI insight to strip
- `frontend/src/components/zkdefi/vault/VaultTab.tsx` — side-by-side layout, wire new components
- `frontend/src/components/zkdefi/vault/YieldTab.tsx` — promote Deploy to Ekubo card
- `frontend/src/components/zkdefi/vault/VaultTradeTab.tsx` — add DCA sub-tab
- `frontend/src/components/zkdefi/vault/PositionsOverview.tsx` — clickable rows, capital deployed section
- `frontend/src/lib/demoCapitalOS.ts` — add all demo data

---

## Verification Strategy

After each task:
1. `npm run build` in `frontend/` (no TypeScript errors)
2. Visual check in demo mode (`http://localhost:3001/agent?mode=demo`)
3. Check responsive behavior (mobile, tablet, desktop)
4. Verify empty states and error states

After all tasks:
1. Full demo mode walkthrough (Portfolio → Yield → Trade → Oracle)
2. Verify all new components render correctly
3. Verify navigation flows (Oracle → Vault, Position click → Withdraw)
4. Check browser console (no React errors)

---

## Success Criteria

- ✅ Capital OS Strip has complete left + right layout
- ✅ Trending Bar shows market pulse stats
- ✅ AI Insight card is dismissable and contextual
- ✅ Allocation Preview shows capital deployment breakdown
- ✅ Proof Stepper visualizes proof pipeline steps
- ✅ Deposit/Withdraw panels are side-by-side on desktop
- ✅ Positions table is clickable (auto-selects in withdraw)
- ✅ Deploy to Ekubo is promoted on Yield tab
- ✅ DCA configuration panel is functional
- ✅ Visual polish: consistent spacing, colors, typography, responsive
- ✅ Demo mode works for all new features
- ✅ No TypeScript or build errors
