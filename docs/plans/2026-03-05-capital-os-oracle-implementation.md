# Capital OS + AI Oracle (Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the agent page into the Capital OS layout: unified strip (Identity | Gate | Ledger), three surfaces (Vault | Oracle | Brain), Oracle with Signals/Radar/Genome sub-tabs, and Vault with Trade/Lending/Staking absorbed. No new backend services.

**Architecture:** Replace CapitalFlowStrip + AIZkmlBanner with a single CapitalOSStrip. Replace the Trade surface with Oracle surface (Signals, Radar, Genome). Move Swap/LP/Limits/Staking/Lending into Vault as sub-tabs. Wire Oracle to existing `/strategies/opportunities` and related APIs. Demo mode uses seeded fixture data.

**Tech Stack:** React, Next.js, TypeScript, Recharts (or existing chart lib) for scatter plot, existing API client and hooks.

**Design reference:** `docs/plans/2026-03-05-capital-os-oracle-design.md`

---

## Task 1: Capital OS Strip component

**Files:**
- Create: `frontend/src/components/zkdefi/CapitalOSStrip.tsx`
- Modify: `frontend/src/app/agent/page.tsx` (later task will swap strip usage)

**Step 1: Add a simple test that the strip renders**

Create `frontend/src/components/zkdefi/__tests__/CapitalOSStrip.test.tsx` (if test setup exists) or skip and verify manually. If no component test pattern exists, proceed to Step 3.

**Step 2: (Optional) Run test**

Run: `npm run test -- --testPathPattern=CapitalOSStrip` (if tests exist). Expected: FAIL (component not found).

**Step 3: Implement CapitalOSStrip**

Create `CapitalOSStrip.tsx` with:
- Props: `identity: { address: string; tier: string; proofCount: number }`, `gate: { riskTolerance: string; allowedCount: number; totalCount: number; status: 'ok' | 'warn' | 'blocked' }`, `ledger: { lastEntryLabel: string; receiptCount: number }`, `demoMode?: boolean`, `onNavigateToProfile?: () => void`, `onLedgerClick?: () => void`.
- Three segments in a single horizontal bar (flex), each clickable: Identity (navigate to profile or emit callback), Gate (optional popover with allowed/blocked list placeholder), Ledger (callback or scroll).
- When `demoMode` true, show a small "Demo" pill.
- Use existing design tokens (zinc background, emerald accent, borders). No new dependencies.

**Step 4: Verify**

Run: `cd frontend && npm run build`. Expected: success (strip compiles).

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/CapitalOSStrip.tsx
git commit -m "feat(ui): add CapitalOSStrip component (Identity | Gate | Ledger)"
```

---

## Task 2: Wire agent page to Capital OS Strip data and replace old strips

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`
- Keep: `frontend/src/components/zkdefi/CapitalFlowStrip.tsx` and `AIZkmlBanner.tsx` in codebase but unused for now (or remove imports only; deletion can be separate)

**Step 1: Add data fetching for strip**

In `page.tsx`, add state or derived data for:
- Identity: from `effectiveAddress`, fetch risk passport v2 or reputation for tier; fetch proof/receipt count from `/api/v1/zkdefi/receipts/on-chain/{address}` or proof stats. In demo mode use `{ address: demoAddress, tier: 'Pathfinder', proofCount: 342 }`.
- Gate: from user constraints or policy API; demo: `{ riskTolerance: 'Moderate', allowedCount: 4, totalCount: 6, status: 'ok' }`.
- Ledger: from activity or receipts; demo: `{ lastEntryLabel: 'LP Deploy +2,400 STRK', receiptCount: 12 }`.

Use existing `effectiveAddress`, `demoMode`. On Ledger click, call a callback that will later scroll to Activity (or set surface to vault and sub to activity).

**Step 2: Replace strip and banner with CapitalOSStrip**

- Remove the two `<div className="mb-4">` blocks that render `CapitalFlowStrip` and `AIZkmlBanner`.
- Render a single `<CapitalOSStrip ... />` with the props from Step 1. Pass `onNavigateToProfile` that uses `router.push('/profile')` or Link; pass `onLedgerClick` that sets `setSurface('vault')` and `setSubTabOverride('activity')`.

**Step 3: Verify**

Run: `cd frontend && npm run build`. Expected: success. Manually: agent page shows one strip with three segments.

**Step 4: Commit**

```bash
git add frontend/src/app/agent/page.tsx
git commit -m "feat(agent): replace CapitalFlowStrip and AIZkmlBanner with CapitalOSStrip"
```

---

## Task 3: Add Oracle surface type and tab (no content yet)

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`

**Step 1: Extend surface type**

- Change `type Surface = "vault" | "trade" | "brain"` to `type Surface = "vault" | "oracle" | "brain"`.
- Keep internal handling for `"trade"` only as redirect: when user would see "trade", show "oracle" instead (see Task 4).
- Add "Oracle" tab button (e.g. icon: Activity or LineChart from lucide-react). Label: "Oracle". On click: `setSurface("oracle")`, `setSubTabOverride(undefined)`.

**Step 2: Add placeholder Oracle container**

- Create `frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx` that for now renders a single line: "Oracle — Signals | Radar | Genome (coming next)". Accept props: `address`, `initialSubTab`, (optional) `demoMode`.
- In `page.tsx`, add `import { OracleSurfaceContainer } from "@/components/zkdefi/surfaces/OracleSurfaceContainer"`. Render `{surface === "oracle" && <OracleSurfaceContainer address={...} initialSubTab={subTabOverride} demoMode={demoMode} />}`.

**Step 3: Verify**

Run: `cd frontend && npm run build`. Click Oracle tab: placeholder content shows.

**Step 4: Commit**

```bash
git add frontend/src/app/agent/page.tsx frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx
git commit -m "feat(agent): add Oracle surface and tab; placeholder container"
```

---

## Task 4: Redirect Trade to Oracle and remove Trade tab

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`

**Step 1: Redirect v=trade to v=oracle**

- In the deep-link `useEffect`, when `v === "trade"` (from URL), set `setSurface("oracle")` instead of `"trade"`.
- In `LEGACY_TAB_MAP`, change all entries that had `surface: "trade"` to `surface: "oracle"` and map sub-tabs: `markets` → `signals` (or keep `markets` for Oracle as radar for now; design says Oracle sub = signals | radar | genome). So: `markets: { surface: "oracle", sub: "signals" }`, `swap` → vault trade: `swap: { surface: "vault", sub: "trade" }`, `lp`, `limits`, `staking` → `surface: "vault", sub: "trade"` (Trade sub can be refined in Vault task). For legacy, map `dex`, `swap`, `lp`, `limits`, `staking` to vault+trade; `markets` to oracle+signals.

**Step 2: Remove Trade button, keep Vault and Brain**

- Remove the button that sets `surface === "trade"`. Only three buttons: Vault, Oracle, Brain.

**Step 3: Remove TradeSurfaceContainer render**

- Remove the block `{surface === "trade" && <TradeSurfaceContainer ... />}`. Do not delete `TradeSurfaceContainer.tsx` yet; it will be reused inside Vault (Trade sub-tab).

**Step 4: Verify**

Open `?v=trade` → should show Oracle. Tabs: Vault, Oracle, Brain only.

**Step 5: Commit**

```bash
git add frontend/src/app/agent/page.tsx
git commit -m "feat(agent): redirect trade to oracle; remove Trade tab; legacy map trade→vault+trade, markets→oracle"
```

---

## Task 5: Vault surface — add sub-tabs Trade, Lending, Staking and resolve sub routing

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx` (and possibly `VaultSurfaceContainer.tsx` if it only forwards props)

**Step 1: Extend Vault tab type**

- Change `type Tab = "vault" | "yield" | "lending" | "activity"` to `type Tab = "vault" | "yield" | "trade" | "lending" | "staking" | "activity"`.
- In `resolveTab(initialSubTab)`, add cases for `"trade"`, `"staking"`. Map `"swap"`, `"lp"`, `"limits"` to `"trade"` (inner sub for Trade can be chosen by default or by query).

**Step 2: Add tab buttons**

- Add "Trade" and "Staking" to the tab list. Order: Portfolio (vault) | Yield | Trade | Lending | Staking | Activity.
- Ensure Lending and Staking are first-class (already present; Staking may currently live only in Trade — so add Staking tab and content).

**Step 3: Render Trade sub-tab content**

- When `tab === "trade"`, render the same content as current Trade surface: either import and render the existing `TradeSurfaceContainer` content in a reduced form (Swap, LP, Limits as inner sub-tabs), or render a wrapper that includes `MarketsTab` (optional compact strip) + `SwapTab`, `LiquidityTab`, `LimitOrdersPanel` with a small inner nav. Use existing components from `TradeSurfaceContainer`: SwapTab, LiquidityTab, LimitOrdersPanel. For "Markets" in Vault/Trade, either a compact "Top opportunities" strip that links to Oracle, or omit and only show Swap | LP | Limits.
- When `tab === "staking"`, render `NativeStakingPanel`.
- Lending already exists as `tab === "lending"` with `LendingPanel`. Ensure it remains.

**Step 4: Verify**

Run build. Open Vault → Trade: swap/LP/limits visible. Vault → Lending, Vault → Staking visible.

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/vault/VaultSurface.tsx
git commit -m "feat(vault): add Trade and Staking sub-tabs; move Swap/LP/Limits/Staking into Vault"
```

---

## Task 6: Oracle — Signals sub-tab

**Files:**
- Create: `frontend/src/components/zkdefi/oracle/SignalsTab.tsx`
- Modify: `frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx`

**Step 1: Implement SignalsTab**

- Fetch `POST /api/v1/strategies/opportunities` with body e.g. `{ user_address?: string, risk_profile?: string }`. Map each opportunity to a signal card: name, yield trend (from apy or label), volatility, risk scan (from risk_score), proof status (verified if proof refs exist).
- Section "Recommended actions": fetch from `/strategies/recommend` or derive 1–2 from top opportunities (e.g. "Allocate 12% to [top strategy]"). Buttons: Approve, Modify, Ignore (Phase 1: toast or no-op in demo).
- Section "Model transparency": collapsible; list active models (Yield Forecast, Anomaly Detector, Volatility) — from zkML circuits or proof stats API; show model hash and last proof hash; link "View Proofs" to `/proofs` or proof explorer.
- In demo mode, if no address or demoMode, use seeded data: 4–6 strategy cards, 2–3 recommendations, placeholder model hashes.

**Step 2: Wire into OracleSurfaceContainer**

- Add sub-tabs to Oracle: Signals | Radar | Genome. Default sub: signals.
- When `sub === "signals"` (or default), render `<SignalsTab address={address} demoMode={demoMode} />`.

**Step 3: Verify**

Build; open Oracle → Signals. See signal cards and recommendations (or empty state if API fails).

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/SignalsTab.tsx frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx
git commit -m "feat(oracle): add Signals sub-tab with signal stream, recommendations, model transparency"
```

---

## Task 7: Oracle — Radar sub-tab (scatter + top opportunities)

**Files:**
- Create: `frontend/src/components/zkdefi/oracle/RadarTab.tsx`
- Modify: `frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx`

**Step 1: Implement RadarTab**

- Use same data as Signals: `POST /strategies/opportunities`. Build scatter plot: X = risk_score (normalize 0–100), Y = apy (or yield). Point size = signal strength or TVL (normalized). Color = green (low risk / good yield), yellow, red (high risk). Use Recharts `ScatterChart` or existing chart lib. Tooltip: strategy name, risk, yield. On point click: set selected strategy and optionally navigate to Genome sub with that strategy (e.g. `onNavigateToGenome(strategyId)`).
- Below plot: "Top opportunities" ranked list (same data, sorted by signal strength or score). Each row: name, signal bar, risk, yield, [Allocate] button. Allocate: navigate to Vault with sub=trade or open allocation flow (e.g. set surface to vault, sub to trade).

**Step 2: Wire into OracleSurfaceContainer**

- When `sub === "radar"`, render `<RadarTab address={address} demoMode={demoMode} onSelectStrategy={...} onAllocate={...} />`. `onAllocate` can be passed from agent page (set surface to vault, sub to trade).

**Step 3: Verify**

Build; Oracle → Radar shows scatter and list. Demo mode: seeded points.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/RadarTab.tsx frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx
git commit -m "feat(oracle): add Radar sub-tab with scatter plot and top opportunities list"
```

---

## Task 8: Oracle — Genome sub-tab (bars + compare)

**Files:**
- Create: `frontend/src/components/zkdefi/oracle/GenomeTab.tsx`
- Modify: `frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx`

**Step 1: Implement GenomeTab**

- Strategy selector: dropdown or list from same opportunities API. Single or multi-select (for compare).
- Bar view: for each selected strategy, five horizontal bars (Yield source, Risk exposure, Volatility sensitivity, Liquidity depth, Capital efficiency). Values 0–100 derived in frontend: e.g. yield_factor = normalize(apy), risk_factor = risk_score, volatility from volatility or risk, liquidity from tvl, efficiency from apy/tvl or similar. Use same opportunity payload fields.
- Compare mode: when 2+ selected, show bars side-by-side; optional toggle for radar chart (5 axes, one polygon per strategy) using Recharts RadarChart.
- Proof refs: per strategy show link(s) to proofs when available in API response.

**Step 2: Wire into OracleSurfaceContainer**

- When `sub === "genome"`, render `<GenomeTab address={address} demoMode={demoMode} selectedStrategyId={...} />`. Support `initialSubTab` and optional preselected strategy from Radar click (e.g. URL param or context).

**Step 3: Verify**

Build; Oracle → Genome: select strategy, see bars; select two, see compare and optional radar.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/GenomeTab.tsx frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx
git commit -m "feat(oracle): add Genome sub-tab with factor bars and compare radar"
```

---

## Task 9: Demo mode seeded data

**Files:**
- Create: `frontend/src/lib/demoCapitalOS.ts` (or `frontend/src/fixtures/demoOracle.ts`)
- Modify: `frontend/src/app/agent/page.tsx`, `SignalsTab.tsx`, `RadarTab.tsx`, `GenomeTab.tsx`, `CapitalOSStrip.tsx`

**Step 1: Add fixture**

- Export demo strip data: identity (tier, proofCount), gate (riskTolerance, allowedCount, totalCount, status), ledger (lastEntryLabel, receiptCount).
- Export demo opportunities: 4–6 strategies with id, name, apy, risk_score, volatility, tvl, signal_strength, proof refs placeholder.
- Export demo recommendations: 2–3 actions (e.g. "Allocate 12% to STRK/ETH Ekubo LP").

**Step 2: Use in strip and Oracle**

- When `demoMode` or !address, strip uses demo fixture. Oracle tabs when demoMode use demo opportunities and recommendations so UI is populated.

**Step 3: Verify**

Open `?mode=demo`. Strip shows Demo pill and filled segments; Oracle Signals/Radar/Genome show data. No real API writes on Approve/Allocate (toast or no-op).

**Step 4: Commit**

```bash
git add frontend/src/lib/demoCapitalOS.ts frontend/src/app/agent/page.tsx frontend/src/components/zkdefi/CapitalOSStrip.tsx frontend/src/components/zkdefi/oracle/*.tsx
git commit -m "feat(demo): seeded data for Capital OS strip and Oracle in demo mode"
```

---

## Task 10: URL and deep-link cleanup

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`, `frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx`, `frontend/src/components/zkdefi/vault/VaultSurface.tsx`

**Step 1: Canonical sub params**

- Vault: `sub=portfolio|yield|trade|lending|staking|activity`. Oracle: `sub=signals|radar|genome`. Ensure agent page reads `sub` and passes to containers; containers sync sub to URL (replaceState or shallow push) so links stay shareable.

**Step 2: Legacy redirects**

- Ensure `?v=trade` and legacy `?tab=markets` etc. map correctly (trade→oracle, swap/lp/limits/staking→vault&sub=trade or sub=staking). Document in code comment or design doc.

**Step 3: Verify**

Open `?v=oracle&sub=radar`, `?v=vault&sub=trade`. Refresh keeps state. Old bookmarks redirect.

**Step 4: Commit**

```bash
git add frontend/src/app/agent/page.tsx frontend/src/components/zkdefi/surfaces/OracleSurfaceContainer.tsx frontend/src/components/zkdefi/vault/VaultSurface.tsx
git commit -m "chore(agent): canonical URL sub params and legacy redirects for Capital OS"
```

---

## Task 11: Remove or repurpose old Trade surface entry point

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`
- Optionally delete or keep: `frontend/src/components/zkdefi/surfaces/TradeSurfaceContainer.tsx`

**Step 1: Ensure no remaining references to Trade surface**

- All navigation and redirects use Oracle for intelligence and Vault for execution. Remove any remaining `surface === "trade"` render. TradeSurfaceContainer is only used inside Vault (Trade sub-tab) if we inlined its content there; otherwise keep the file and use it inside VaultSurface as the Trade tab content (recommended: reuse TradeSurfaceContainer inside Vault for Swap/LP/Limits/Staking to avoid duplication).

**Step 2: (Optional) Remove CapitalFlowStrip and AIZkmlBanner imports**

- If fully replaced by CapitalOSStrip, remove unused imports and delete or archive the old components in a follow-up. For this task, just ensure agent page does not render them.

**Step 3: Verify**

Full build; smoke test: Vault (all sub-tabs), Oracle (all sub-tabs), Brain; demo mode; deep links.

**Step 4: Commit**

```bash
git add frontend/src/app/agent/page.tsx
git commit -m "chore(agent): remove Trade surface render; execution only via Vault"
```

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-05-capital-os-oracle-implementation.md`.

**Two execution options:**

1. **Subagent-driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — Open a new session with executing-plans in the repo (or worktree), run task-by-task with checkpoints.

Which approach do you prefer?
