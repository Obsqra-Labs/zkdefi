# zkde.fi UX Optimization Design

**Date:** 2026-03-03
**Author:** Obsqra Labs
**Status:** Approved

---

## Problem

The app has strong architecture and deep feature coverage, but the UX has friction:

- Capital flow (deposit → session key → agent → proof gate → execute → receipt) is split across surfaces with no unified visibility.
- Naming collisions ("Vault" surface vs "Vault" sub-tab), redundant sections (Credit Line on both Yield and Lending), and dead-weight tabs (Disclosure with "moving to Profile" banner).
- Proof-gate status (ProofsPill) only visible on Vault; Trade and Brain have zero gate visibility.
- Activity/receipt data exists in two incompatible systems (API-backed ActivityTab vs in-memory ActivityLog).
- Key features (Deploy to Ekubo, AI insight) are buried or dismissible.
- Brain surface has 6 sub-tabs with overlapping agent concepts (Identity Agents vs My Agents).

## Approach

**Hybrid (C):** Keep Vault | Trade | Brain as three pillars. Add one consistent Capital flow strip for proof-gate status and next-step guidance. Consolidate redundancy, fix naming, promote key features.

---

## Design

### 1. Capital Flow Strip (new component)

Lives in the app shell (`/agent` page), between header and surface tabs. One row, always visible.

**Left half — Proof gate status:**
- Three signals: policy enforced, risk within bound, MEV protection.
- Same data source as current ProofsPill (`useVaultController` → `proofsState`).
- Click expands detail dropdown (same UI as current ProofsPill expand).
- Replaces ProofsPill in VaultSurface header (single source of truth).

**Right half — Next step + AI insight:**

| State | Copy | Action |
|-------|------|--------|
| No wallet | Connect wallet to start | Mini ConnectButton |
| Connected, not onboarded | Complete onboarding | Link to onboarding |
| Onboarded, no deposits | Deposit to fund your vault | Navigate to Vault > Portfolio |
| Has deposits, no session key | Grant a session key to enable your agent | Navigate to Brain > Agent |
| Has session key, no active agent | Start your agent | Navigate to Brain > Agent |
| Agent running, idle capital | AIInsight content (LLM recommendation) | Navigate to relevant action |
| Agent running, all deployed | Agent active — earning yield | Informational |
| Rebalance pending | Rebalance pending (MEV protected) | Informational |

Data sources: wallet connection state, `commitments.length`, session key list API, agent status, AIInsight recommendation API.

Replaces: AIInsight component on VaultTab (moved here), ProofsPill on VaultSurface header (moved here).

### 2. Vault Surface

**Sub-tabs:** Portfolio (renamed from "Vault") | Yield | Lending | Activity

#### Portfolio (renamed)

Layout top to bottom:
1. VaultHealthMeter (unchanged)
2. NextRebalanceStrip (unchanged)
3. TierSelector (unchanged)
4. Deposit / Withdraw grid (unchanged)
5. PositionsOverview (unchanged)

Removed from this tab:
- AIInsight → moved to Capital flow strip
- TrendingBar → stats (STRK/USD, Top Pool, TVL, Avg APY) merged into VaultSurface header stats row alongside existing STRK/ETH and STRK/USD prices

#### Yield

Removed: Credit Line section (duplicate of Lending tab content).

Changed: "Deploy Capital to Ekubo" promoted from collapsed accordion to a top-level card when user has vault balance but no active Ekubo position. Collapses into sources table after deployment.

Kept: Blended APY / Total Earned / Next Harvest cards, Yield Sources table, YieldChart.

#### Lending

No changes. Already clean.

#### Activity

Added: "Proofs" filter category. Wire `useReceiptAggregator` receipts into the unified activity feed alongside deposits, withdrawals, yields, rebalances.

Added: Explicit empty state copy — "No activity yet. Deposits, withdrawals, and proof receipts will appear here."

### 3. Brain Surface

**Sub-tabs:** Agent (renamed from "Agent Controls") | Models (renamed from "zkML Models") | Pipeline | Agents (merged Identity Agents + My Agents)

#### Removed: Disclosure tab

CompliancePanel moves to Profile page's existing Compliance tab. The "moving to Profile" banner is removed since the move is complete.

#### Agent tab (renamed from "Agent Controls")

Content unchanged: SessionKeyManager, BrainVisualizer, AgentRebalancer, AutomationControlPanel, ExecutionControlRail.

Changed: Replace in-memory ActivityLog with compact ProofTimeline showing last 5 receipts from `useReceiptAggregator`. Real receipt data instead of duplicate in-memory events.

#### Models tab (renamed from "zkML Models")

No content changes. ModelComposer + explainer cards.

#### Pipeline tab

No changes. ExecutionLoopCard + ZKGatePipeline + gate status cards + ExecutionControlRail + pipeline explainer.

#### Agents tab (merged Identity Agents + My Agents)

Two-column layout:
- Left (2/3): AgentBuilder (create) at top, AgentDashboard (manage/execute) below.
- Right (1/3): AgentLeaderboard (compete), SkillMarketplace (discover), AgentPerformanceDashboard (stats for selected agent).

Flow: build an agent (left top) → see it in your agents list (left bottom) → compare on leaderboard (right) → discover skills (right).

### 4. Trade Surface

No structural changes. Polish only:

- Markets tab: empty state copy when API returns no data — "Market intelligence is loading. Prices refresh every 30 seconds."
- Swap / LP: extract shared gate context fetching to avoid redundant `getRiskPassport` + `listSessionKeys` calls (both tabs fetch independently). Use existing `useExecutionContext` or create a shared `useGateContext` hook.
- Token context bar: ensure selected pair + slippage display persists across Swap/LP/Limits sub-tabs.

### 5. Profile

- Wire CompliancePanel (from Brain > Disclosure) into Profile's existing Compliance tab.
- No other structural changes.

### 6. Routing

- Add redirect: `/identity` → `/profile` (currently 404).

---

## Changes Summary

| Area | Change | Type |
|------|--------|------|
| Shell | Add Capital flow strip (proof status + next step + AI insight) | New component |
| Shell | Remove ProofsPill from VaultSurface header (moved to strip) | Move |
| Vault | Rename "Vault" sub-tab → "Portfolio" | Rename |
| Vault | Remove AIInsight from Portfolio (moved to strip) | Move |
| Vault | Remove TrendingBar from Portfolio (merge into header stats) | Move |
| Vault | Remove Credit Line from Yield (already on Lending) | Dedup |
| Vault | Promote "Deploy to Ekubo" from accordion to card | Promote |
| Vault | Add "Proofs" filter to Activity + wire useReceiptAggregator | Enhancement |
| Vault | Add explicit empty state copy to Activity | Polish |
| Brain | Rename "Agent Controls" → "Agent" | Rename |
| Brain | Rename "zkML Models" → "Models" | Rename |
| Brain | Merge "Identity Agents" + "My Agents" → "Agents" | Consolidate |
| Brain | Remove "Disclosure" tab | Move to Profile |
| Brain | Replace ActivityLog with compact ProofTimeline | Replace |
| Trade | Add empty state copy for Markets | Polish |
| Trade | Extract shared gate context hook | Dedup |
| Profile | Wire CompliancePanel into Compliance tab | Move |
| Routing | `/identity` → redirect to `/profile` | Fix |

---

## Files Affected

### New files
- `frontend/src/components/zkdefi/CapitalFlowStrip.tsx` — the shell-level strip

### Modified files
- `frontend/src/app/agent/page.tsx` — mount CapitalFlowStrip, remove ProofsPill import path
- `frontend/src/components/zkdefi/vault/VaultSurface.tsx` — remove ProofsPill, merge TrendingBar stats into header
- `frontend/src/components/zkdefi/vault/VaultTab.tsx` — remove AIInsight, remove TrendingBar
- `frontend/src/components/zkdefi/vault/YieldTab.tsx` — remove Credit Line section, promote Deploy to Ekubo
- `frontend/src/components/zkdefi/vault/ActivityTab.tsx` — add Proofs filter, wire useReceiptAggregator, add empty state
- `frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx` — consolidate tabs (4 instead of 6), rename, merge agents, remove Disclosure, replace ActivityLog with ProofTimeline
- `frontend/src/components/zkdefi/surfaces/TradeSurfaceContainer.tsx` — add Markets empty state copy
- `frontend/src/app/profile/page.tsx` — add CompliancePanel to Compliance tab
- `frontend/src/app/identity/page.tsx` — new redirect page (or Next.js redirect config)

### Potentially modified
- `frontend/src/hooks/useExecutionContext.ts` — may extend for shared gate context
- `frontend/src/contexts/TradeContext.tsx` — ensure token context bar visibility
