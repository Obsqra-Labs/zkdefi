# Five Lanes Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the noisy 8-tab + 6-pill + 5-overlay Capital OS dashboard with a clean 5-tab flow-centric layout, eliminating ~4,000 lines of duplicate UI code.

**Architecture:** All changes are frontend-only. No new backend endpoints. Existing hooks and API calls are reused. New tab components are created first (additive), then wired into the layout (swap), then dead code is removed (subtractive). This ordering ensures the app stays functional at every step.

**Tech Stack:** React 18, Next.js 14, TypeScript, Tailwind CSS, Framer Motion, lucide-react icons, existing hooks (`useVaultSummary`, `useHealthPassport`, `usePrivacyVault`, `useRiskProfileV2`).

**Design doc:** `docs/plans/2026-03-10-five-lanes-redesign-design.md`

---

## Phase 1: Foundation — Shared Components + Types

### Task 1: Update VaultTab type in agentState.ts

**Files:**
- Modify: `frontend/src/lib/agentState.ts`

**Step 1:** Change the `VaultTab` type from the current 8 values to the new 5:

```typescript
export type VaultTab = "overview" | "capital" | "lend" | "govern" | "activity";
```

Update `resolveVaultTab` to map old URL params to new tabs:
- `?v=pools` or `?v=ekubo` or `?v=trade` → `"capital"`
- `?v=lending` → `"lend"`
- `?v=governance` → `"govern"`
- `?v=oracle` or `?v=marketplace` → `"overview"` (no longer standalone)
- Default remains `"overview"`

Update `resolveViewParamV2` to map new tabs back to URL params.

Update `resolveViewOverlayV2`:
- Remove `"deploy"` and `"execution-pipeline"` overlay mappings
- Keep `"circuit-board"` and `"brain"`
- Remove `"governance"` (now a tab, not overlay)

**Step 2:** Run `npx tsc --noEmit` from `frontend/`. Fix any type errors this surfaces (they will guide the rest of the work).

**Step 3:** Commit: `refactor: update VaultTab type to five lanes`

---

### Task 2: Create InlineOracleCard component

**Files:**
- Create: `frontend/src/components/zkdefi/shared/InlineOracleCard.tsx`

**Step 1:** Create the component. It displays a single oracle signal as a compact card:

```tsx
"use client";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface OracleSignal {
  pair: string;
  direction: "up" | "down" | "stable";
  confidence: number;
  recommendation: string;
}

export function InlineOracleCard({ signal }: { signal: OracleSignal }) {
  const Icon = signal.direction === "up" ? TrendingUp : signal.direction === "down" ? TrendingDown : Minus;
  const color = signal.direction === "up" ? "text-emerald-400" : signal.direction === "down" ? "text-red-400" : "text-zinc-400";

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 text-xs">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-zinc-300 font-medium">{signal.pair}</span>
      <span className="text-zinc-500">{signal.recommendation}</span>
      <span className="ml-auto text-zinc-600">conf {(signal.confidence * 100).toFixed(0)}%</span>
    </div>
  );
}
```

**Step 2:** Commit: `feat: add InlineOracleCard shared component`

---

### Task 3: Create CreditGauge component

**Files:**
- Create: `frontend/src/components/zkdefi/shared/CreditGauge.tsx`

**Step 1:** Create the component. A compact FICO-style radial gauge showing credit score:

```tsx
"use client";

interface CreditGaugeProps {
  score: number;
  maxScore?: number;
  size?: "sm" | "md";
}

export function CreditGauge({ score, maxScore = 850, size = "md" }: CreditGaugeProps) {
  const pct = Math.min(score / maxScore, 1);
  const dims = size === "sm" ? { w: 64, h: 64, stroke: 6, text: "text-sm" } : { w: 96, h: 96, stroke: 8, text: "text-lg" };
  const r = (dims.w - dims.stroke) / 2;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75; // 270° arc
  const filled = arc * pct;

  const color = score >= 700 ? "#34d399" : score >= 550 ? "#fbbf24" : "#f87171";

  return (
    <div className="relative flex items-center justify-center" style={{ width: dims.w, height: dims.h }}>
      <svg width={dims.w} height={dims.h} className="-rotate-[135deg]">
        <circle cx={dims.w / 2} cy={dims.h / 2} r={r} fill="none" stroke="#27272a" strokeWidth={dims.stroke} strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" />
        <circle cx={dims.w / 2} cy={dims.h / 2} r={r} fill="none" stroke={color} strokeWidth={dims.stroke} strokeDasharray={`${filled} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className={`absolute ${dims.text} font-bold text-zinc-100`}>{score}</span>
    </div>
  );
}
```

**Step 2:** Commit: `feat: add CreditGauge shared component`

---

## Phase 2: New Tab Components

### Task 4: Create OverviewTab

**Files:**
- Create: `frontend/src/components/zkdefi/tabs/OverviewTab.tsx`

**Step 1:** Create the Overview tab. It uses existing hooks — no new API calls. Sections:

1. **Balance hero** — total capital, per-token breakdown, 7d change. Data from `useVaultSummary`.
2. **Deployed/Available breakdown** — three cards (Privacy Pools total, Ekubo LP total, Idle). Pools from `usePrivacyVault`, Ekubo from `getEkuboPositions`.
3. **Inline oracle signals** — 2-3 `InlineOracleCard` components. Data from `GET /api/v1/zkdefi/trade-desk/v2/opportunities?limit=3` (extract pair signals).
4. **Recent activity** — last 5 stream items from `GET /api/v1/zkdefi/mc/stream/{address}?limit=5`. Simple list, no filters.

Imports to use:
- `useVaultSummary` from `@/hooks/useVaultSummary`
- `usePrivacyVault` from `@/hooks/usePrivacyVault`
- `getEkuboPositions` from `@/lib/api/ekubo`
- `apiFetch` from `@/lib/api/client`
- `InlineOracleCard` from `@/components/zkdefi/shared/InlineOracleCard`
- `useAccount` from `@starknet-react/core`

Target: ~180 lines. Use `glass` card styling, Tailwind zinc-900/zinc-800 palette consistent with existing design.

**Step 2:** Commit: `feat: add OverviewTab component`

---

### Task 5: Create CapitalTab

**Files:**
- Create: `frontend/src/components/zkdefi/tabs/CapitalTab.tsx`

**Step 1:** Create the Capital tab. Three sections:

1. **Privacy Pools section** — reuse the pool cards pattern from `PrivacyPoolsPanel.tsx` (read it first for the deposit/withdraw logic, pool data fetching with `Promise.allSettled`, and amounts ref pattern). Show Conservative/Moderate/Aggressive pool cards with TVL, utilization, deposit/withdraw buttons. Add a one-line `InlineOracleCard` per pool.

2. **Active Positions section** — fetch Ekubo LP positions via `getEkuboPositions(address)` and privacy pool commitments from the note store (via `useDarkLedgerNotes` hook or the vault balance endpoint). Render in a unified list — each row shows: type icon, pair/pool name, value, status (in-range / committed).

3. **Opportunities section** — fetch from `GET /api/v1/zkdefi/trade-desk/v2/opportunities?type=lp,lending,staking&limit=20`. Simple filter bar (All, LP, Swap, Stake, Private). Each opportunity card shows pair, APY, risk level, action button.

Key imports from existing code:
- Pool data fetching pattern from `PrivacyPoolsPanel.tsx` (lines ~40-100)
- Deposit/withdraw handlers from `PrivacyPoolsPanel.tsx`
- `getEkuboPositions` from `@/lib/api/ekubo`
- `useDarkLedgerNotes` from `@/hooks/useDarkLedgerNotes`
- `apiFetch, API_BASE` from `@/lib/api/client`
- `InlineOracleCard` from `@/components/zkdefi/shared/InlineOracleCard`

Target: ~320 lines. The deposit/withdraw flow should open the existing deposit/withdraw slideouts (call `onSlideout("deposit")` / `onSlideout("withdraw")` props).

**Step 2:** Commit: `feat: add CapitalTab component`

---

### Task 6: Create LendTab

**Files:**
- Create: `frontend/src/components/zkdefi/tabs/LendTab.tsx`

**Step 1:** Create the Lend tab. Three sections:

1. **Credit Profile hero** — fetch credit data from `GET /api/v1/zkdefi/credit-line/{address}/terms` (or compute from reputation + risk passport). Display `CreditGauge` with the score, plus text fields for tier, trust, collateral, borrowing power, LTV, rate. One-line `InlineOracleCard` about rate environment.

   Credit data sources (read `LendingConsole` and `credit_line_service.py` for the exact endpoints):
   - Reputation: `GET /api/v1/zkdefi/reputation/user/{address}`
   - Risk passport: `GET /api/v1/zkdefi/risk_passport/user/{address}`
   - Credit line terms: `GET /api/v1/credit-line/{address}/terms`
   - Vault summary for collateral total: `useVaultSummary`

2. **Active Loans section** — fetch user's loans from the lending API (read `LendingConsole.tsx` for the exact endpoint pattern). Show borrowed and supplied positions in one list with health factor, rate, remaining term. Repay/withdraw buttons.

3. **Open Market section** — two columns for supply requests and borrow requests. Fetch from lending market endpoint. Fund/create request buttons.

Read `frontend/src/components/zkdefi/LendingConsole.tsx` first to understand the existing API patterns and reuse them.

Key imports:
- `CreditGauge` from `@/components/zkdefi/shared/CreditGauge`
- `InlineOracleCard` from `@/components/zkdefi/shared/InlineOracleCard`
- `useVaultSummary` from `@/hooks/useVaultSummary`
- `useHealthPassport` from `@/hooks/useHealthPassport`
- `apiFetch, API_BASE` from `@/lib/api/client`

Target: ~230 lines.

**Step 2:** Commit: `feat: add LendTab component`

---

### Task 7: Create GovernTab

**Files:**
- Create: `frontend/src/components/zkdefi/tabs/GovernTab.tsx`

**Step 1:** Read `frontend/src/components/zkdefi/mission-control/GovernanceOverlay.tsx` (793 lines). Extract the three section components (`VotingPowerSection`, `ActiveProposalsSection`, `CreateProposalSection`) and their data-fetching logic.

Create `GovernTab.tsx` that renders the same 3 sections but as a tab panel, not an overlay:
- Remove the overlay shell (backdrop, close button, slide animation)
- Remove the `GovernanceOverlayProps` interface (no `onClose`)
- Keep the voting/proposal/create logic intact
- Keep the ZK proof display on vote cast
- Tighten spacing

The component should accept `address: string` as prop (from useAccount in parent).

Target: ~350 lines (down from 793 by removing overlay chrome).

**Step 2:** Commit: `feat: add GovernTab component`

---

### Task 8: Create ActivityTab

**Files:**
- Create: `frontend/src/components/zkdefi/tabs/ActivityTab.tsx`

**Step 1:** Read both `UnifiedStream.tsx` (318 lines) and `EnrichedActivityTab.tsx` (305 lines). Merge them:

- Use the filter bar and search from `UnifiedStream` (All, Receipts, Decisions, Proofs, Deposits, Votes)
- Use the date grouping and `StreamCard` rendering from `UnifiedStream`
- Add the tx hash / proof hash / explorer link display from `EnrichedActivityTab`
- Use `GET /api/v1/zkdefi/mc/stream/{address}?types={filter}&limit={limit}` as the single data source
- Include "Load older" pagination from `UnifiedStream`

The result is one component that replaces two.

Key imports:
- `StreamCard` from `@/components/zkdefi/mission-control/StreamCard`
- `apiFetch, API_BASE` from `@/lib/api/client`

Target: ~200 lines.

**Step 2:** Commit: `feat: add ActivityTab component`

---

## Phase 3: Sidebar Rewrites

### Task 9: Create IdentityBadge (replaces IntelligenceSidebar)

**Files:**
- Create: `frontend/src/components/zkdefi/mission-control/IdentityBadge.tsx`

**Step 1:** Read `IntelligenceSidebar.tsx` (220 lines) for the hook usage pattern.

Create a slim left sidebar component (~80 lines):
- Truncated address with copy button
- Tier badge (T1/T2/T3) with color
- Trust score as percentage
- Proof count
- Small `CreditGauge` (size="sm") with credit score
- Two buttons: Fund, Withdraw (call `onSlideout` prop)

Data from:
- `useHealthPassport(address)` for tier, trust, proofs
- `apiFetch` to `GET /api/v1/zkdefi/reputation/user/{address}` for credit score (or compute inline)
- Address from `useAccount`

No stream items, no vault summary, no strategy section. Just identity at a glance.

**Step 2:** Commit: `feat: add IdentityBadge sidebar component`

---

### Task 10: Create AgentControls (replaces ControlPlane)

**Files:**
- Create: `frontend/src/components/zkdefi/mission-control/AgentControls.tsx`

**Step 1:** Read `ControlPlane.tsx` (994 lines) for the agent status, constraint, and session key patterns.

Create a slim right sidebar component (~150 lines):

1. **Agent status** — start/pause/stop buttons + status indicator. Reuse the API calls from ControlPlane:
   - `GET /api/v1/zkdefi/rebalancer/autonomous/status/{address}`
   - `POST /api/v1/zkdefi/rebalancer/autonomous/{start|pause|resume|stop}`

2. **Emergency stop** — single red button. `POST /api/v1/zkdefi/mc/emergency/pause`.

3. **Constraints summary** — collapsed by default, shows "Risk: 5% · Protocols: Ekubo, Lending" as one-liner. Expandable to show the constraint details. Data from `GET /api/v1/zkdefi/mc/constraints/{address}`.

4. **Session key status** — one line: "Active · 23h remaining" or "Expired". Data from `GET /api/v1/zkdefi/session_keys/list/{address}` (first key).

No oracle policy editor, no zkML result cards, no full session key manager, no risk passport section, no agent insights strip.

**Step 2:** Commit: `feat: add AgentControls sidebar component`

---

## Phase 4: Shell Rewiring

### Task 11: Rewrite VaultCenterStage for 5 tabs

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx`

**Step 1:** Replace the current 8-tab TABS array and rendering logic with 5 tabs:

```typescript
const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "capital", label: "Capital", icon: Droplets },
  { id: "lend", label: "Lend", icon: Landmark },
  { id: "govern", label: "Govern", icon: Vote },
  { id: "activity", label: "Activity", icon: Activity },
] as const;
```

Replace the tab content rendering:
- `overview` → `<OverviewTab />`
- `capital` → `<CapitalTab />`
- `lend` → `<LendTab />`
- `govern` → `<GovernTab />`
- `activity` → `<ActivityTab />`

Each wrapped in `<ErrorBoundary>`.

Remove all imports for old tab components: `PrivacyPoolsPanel`, `PoolIntelligencePanel`, `EkuboPositionsList`, `LendingConsole`, `TradeDesk`, `OracleSurfaceContainer`, `MarketplaceConsole`, `EnrichedActivityTab`, `VaultOverviewTab` (inline), `PoolIntelligence`, `PositionsOverview`, `ConstraintGuard`, `VaultHealthMeter`, `CapitalFlowPipeline`.

Remove the internal `VaultOverviewTab` function definition.

Target: ~100 lines (down from 405).

**Step 2:** Commit: `refactor: VaultCenterStage to 5 tabs`

---

### Task 12: Simplify HeaderStrip

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx`

**Step 1:** Replace `NAV_ITEMS` with the 5 new tab IDs:

```typescript
const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "capital", label: "Capital" },
  { id: "lend", label: "Lend" },
  { id: "govern", label: "Govern" },
  { id: "activity", label: "Activity" },
];
```

Remove overlay buttons for Deploy, Pipeline, and Govern. Keep only Design and Brain.

Remove the Fund/Withdraw buttons from the header (they live in IdentityBadge now).

Keep: brand, nav pills, Design/Brain overlay buttons, network badge, tier, connect wallet.

Target: ~120 lines (down from 211).

**Step 2:** Commit: `refactor: simplify HeaderStrip to 5 lanes`

---

### Task 13: Remove CenterStageModes wrapper

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`
- Delete: `frontend/src/components/zkdefi/mission-control/CenterStageModes.tsx`

**Step 1:** In `agent/page.tsx`, replace `CenterStageModes` with `VaultCenterStage` directly as the center stage content. `CenterStageModes` was a wrapper that split between "intelligence" (OracleSurfaceContainer + UnifiedStream) and "vault" (VaultCenterStage). That split no longer exists.

Change the `centerStage` prop of `MissionControlLayout` from `<CenterStageModes ... />` to `<VaultCenterStage ... />`.

**Step 2:** Commit: `refactor: remove CenterStageModes wrapper`

---

### Task 14: Wire new sidebars into agent page

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`

**Step 1:** Replace sidebar components:

- `leftRail`: change from `<IntelligenceSidebar ... />` (or `<CapitalLedger ... />`) to `<IdentityBadge ... />`
- `rightRail`: change from `<ControlPlane ... />` to `<AgentControls ... />`

Remove the V2 toggle logic that switches between IntelligenceSidebar and CapitalLedger — there's only IdentityBadge now.

Update overlay handling:
- Remove `"deploy"` and `"execution-pipeline"` from the overlay switch/case
- Remove `"governance"` from overlays (now the Govern tab)
- Keep `"circuit-board"` and `"brain"`

Update slideout handling:
- Remove `"lending"`, `"marketplace"`, `"oracle"` slideouts (now tabs or inline)
- Keep `"deposit"`, `"withdraw"`, `"privacy"`, `"agent-builder"`

Update the `SlideoutModeV2` type in `agentState.ts` accordingly.

**Step 2:** Run `npx tsc --noEmit` — fix any remaining type errors.

**Step 3:** Commit: `refactor: wire IdentityBadge and AgentControls into agent page`

---

## Phase 5: Cleanup

### Task 15: Remove dead components

**Files to delete:**
- `frontend/src/components/zkdefi/mission-control/CenterStageModes.tsx` (if not deleted in Task 13)
- `frontend/src/components/zkdefi/mission-control/PoolIntelligence.tsx`
- `frontend/src/components/zkdefi/mission-control/PoolIntelligencePanel.tsx`
- `frontend/src/components/zkdefi/mission-control/DeployOverlay.tsx`
- `frontend/src/components/zkdefi/mission-control/CapitalLedger.tsx`
- `frontend/src/components/zkdefi/mission-control/IntelligenceSidebar.tsx`
- `frontend/src/components/zkdefi/vault/EnrichedActivityTab.tsx`
- `frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx`
- `frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx`

Do NOT delete:
- `ControlPlane.tsx` — keep for reference, but it's no longer imported
- `GovernanceOverlay.tsx` — keep for reference, GovernTab extracts from it
- `UnifiedStream.tsx` — keep, `StreamCard` may still be used by ActivityTab
- `StreamCard.tsx` — still used by ActivityTab and OverviewTab

**Step 1:** Delete the files listed above.

**Step 2:** Commit: `chore: remove dead components after five-lanes redesign`

---

### Task 16: Update exports in index.ts

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/index.ts`

**Step 1:** Remove exports for deleted components:
- `CapitalLedger`
- `DeployOverlay`, `DeployMode`, `DeployOverlayProps`
- `CenterStageModes`, `CenterStageModesProps`
- `GovernanceOverlay`, `GovernanceOverlayProps` (if GovernTab replaces it)

Add exports for new components:
- `IdentityBadge`
- `AgentControls`

Keep exports for:
- `MissionControlLayout`, `OverlayMode`
- `HeaderStrip`
- `ControlPlane` (may still be imported somewhere)
- `UnifiedStream`, `StreamCard`, `StreamItem`
- `CircuitBoard`
- `ProofChainStrip`
- `VaultCenterStage`, `VaultCenterStageProps`

**Step 2:** Commit: `chore: update mission-control exports`

---

### Task 17: Fix remaining imports across codebase

**Step 1:** Search for any remaining imports of deleted components across the codebase:
- `rg "PoolIntelligence" frontend/src/ --files-with-matches`
- `rg "DeployOverlay" frontend/src/ --files-with-matches`
- `rg "CapitalLedger" frontend/src/ --files-with-matches`
- `rg "IntelligenceSidebar" frontend/src/ --files-with-matches`
- `rg "EnrichedActivityTab" frontend/src/ --files-with-matches`
- `rg "OracleSurfaceContainer" frontend/src/ --files-with-matches`
- `rg "OracleSignalsTab" frontend/src/ --files-with-matches`
- `rg "CenterStageModes" frontend/src/ --files-with-matches`

Fix any remaining references — either remove the import or replace with the new component.

**Step 2:** Commit: `fix: clean up stale imports`

---

### Task 18: Update tests

**Step 1:** Search for existing tests referencing old components:
- `rg "PoolIntelligence|DeployOverlay|CapitalLedger|CenterStageModes|EnrichedActivityTab" frontend/src/__tests__/ --files-with-matches`

Update or remove tests for deleted components. Add basic render tests for new tab components (OverviewTab, CapitalTab, LendTab, GovernTab, ActivityTab) that verify they render without crashing.

**Step 2:** Run `cd frontend && npx jest --passWithNoTests` to verify all tests pass.

**Step 3:** Commit: `test: update tests for five-lanes redesign`

---

### Task 19: Build verification

**Step 1:** Run full build: `cd frontend && npm run build`

**Step 2:** Fix any build errors.

**Step 3:** Restart PM2 services:
```bash
pm2 restart zkdefi-frontend
pm2 restart zkdefi-backend
```

**Step 4:** Verify https://zkde.fi/agent loads correctly.

**Step 5:** Commit any remaining fixes: `fix: build fixes for five-lanes redesign`

---

## Task Dependency Graph

```
Task 1 (types) ──┬──→ Task 4 (OverviewTab)  ──┐
                 ├──→ Task 5 (CapitalTab)   ──┤
Task 2 (Oracle)──┤                             ├──→ Task 11 (VaultCenterStage) ──→ Task 13 (CenterStageModes) ──┐
Task 3 (Gauge) ──┼──→ Task 6 (LendTab)     ──┤                                                                 │
                 ├──→ Task 7 (GovernTab)    ──┤                                                                 ├──→ Task 15 (cleanup) → Task 16 → Task 17 → Task 18 → Task 19
                 ├──→ Task 8 (ActivityTab)  ──┘                                                                 │
                 ├──→ Task 9 (IdentityBadge) ──→ Task 14 (wire sidebars) ───────────────────────────────────────┤
                 └──→ Task 10 (AgentControls)──→ Task 14                                                        │
                                                 Task 12 (HeaderStrip) ─────────────────────────────────────────┘
```

**Parallelizable:** Tasks 2+3 (shared components), Tasks 4-10 (all new components, after Task 1), Tasks 11+12+13+14 (shell rewiring, after components exist).
