# Five Lanes Redesign — Capital OS Dashboard

**Date:** 2026-03-10
**Status:** Approved
**Goal:** Eliminate duplicate content, reduce navigation noise, and reorganize Capital OS around 5 flow-centric tabs.

## Problem

The current Capital OS dashboard has:
- **28 navigation entry points** on a single page (6 header pills, 8 center tabs, 5 overlay buttons, 9 slideouts)
- **Vault balance shown 3 times** (CapitalLedger, IntelligenceSidebar, VaultOverviewTab)
- **Health/tier/trust shown 4 times** (CapitalLedger, IntelligenceSidebar, VaultOverviewTab, ControlPlane)
- **Oracle/pool intelligence shown 3 times** (PoolIntelligence, PoolIntelligencePanel, OracleSignalsTab)
- **~4,300+ lines** of center-stage component code with heavy overlap
- **ControlPlane** alone is 994 lines; **PoolIntelligencePanel** is 980 lines

## Design: Five Lanes

Replace 8 center tabs + 6 header pills + overlays with 5 primary tabs.

### Tab Structure

| Tab | Purpose | Key Sections |
|-----|---------|-------------|
| **Overview** | At-a-glance capital state | Balance hero, deployed/available breakdown, inline oracle signals, recent activity (5 items) |
| **Capital** | Deploy & manage private capital | Privacy pools (deposit/withdraw), active positions (Ekubo LP + pool commitments), opportunities (filtered trade desk) |
| **Lend** | Borrow & supply with ZK trust | Credit profile hero (FICO gauge, score, LTV, rate), active loans, open P2P market |
| **Govern** | Private DAO voting | Voting power breakdown, active proposals with ZK vote, create proposal |
| **Activity** | Unified event stream | Filtered, date-grouped stream with receipts, decisions, proofs, deposits, votes |

### Layout Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ HeaderStrip                                                          │
│ [zkde.fi]  Overview · Capital · Lend · Govern · Activity   [Design│Brain]  Sepolia ◆ T2  [wallet] │
├────────────┬───────────────────────────────────────────┬─────────────┤
│ Identity   │                                           │ Agent       │
│ Badge      │         Center Stage                      │ Controls    │
│ (~240px)   │         (active tab content)              │ (~260px)    │
│            │                                           │             │
└────────────┴───────────────────────────────────────────┴─────────────┘
```

### Left Sidebar — Identity Badge (~80 lines)

Compact read-only status card:
- Address (truncated) + tier badge
- Trust score percentage
- Proof count
- FICO-style credit gauge (small)
- Quick actions: Fund, Withdraw (open slideouts)

Replaces: IntelligenceSidebar (220 lines) which duplicated balance, health, stream, and quick actions.

### Right Sidebar — Agent Controls (~150 lines)

Minimal operational controls:
- Agent status with start/pause/stop buttons
- Emergency stop
- Constraint summary (collapsed, expandable on click)
- Session key status (one-liner: active/expired + TTL)

Replaces: ControlPlane (994 lines) which included risk passport, oracle policy editor, session key manager, zkML result cards, agent insights, and brain check.

### Header Strip — Simplified

- Brand: zkde.fi / Capital OS
- 5 tab pills: Overview, Capital, Lend, Govern, Activity
- 2 overlay buttons: Design (circuit board), Brain
- Network badge + tier
- Connect wallet button

Removed: Deploy overlay button (absorbed into Capital tab), Pipeline overlay button, Govern overlay button (now a tab).

### Overlays (kept)

- **Design** (circuit board) — power-user policy circuit editor
- **Brain** — zkML model inspection, marketplace

### Overlays (removed)

- **Deploy** — TradeDesk absorbed into Capital tab Opportunities section
- **Governance** — promoted to Govern tab
- **Execution Pipeline** — removed

### Slideouts (kept)

- deposit (Fund Vault)
- withdraw
- privacy (direct to pool)
- agent-builder

### Slideouts (removed)

- lending (Lend tab replaces it)
- marketplace (Brain overlay covers it)
- oracle (inline contextual cards replace it)
- shielded (merged into privacy)
- zkrag (niche, defer)

## Tab Detail: Overview

Balance hero (single source of truth, no duplication), deployed capital breakdown (privacy pools total, Ekubo LP total, idle), 2-3 inline oracle signal cards (compact one-liners), recent activity feed (last 5 stream items).

**Absorbs:** VaultOverviewTab hero + PositionsOverview summary.
**Kills:** ConstraintGuard (→ right sidebar), VaultHealthMeter (→ left badge), PoolIntelligence (→ inline oracle cards), CapitalFlowPipeline (→ simple breakdown).

**~180 lines.**

## Tab Detail: Capital

Three vertically stacked sections:

1. **Privacy Pools** — Conservative/Moderate/Aggressive cards with TVL, utilization, deposit/withdraw buttons, and inline oracle hint per pool. Reuses deposit/withdraw logic from PrivacyPoolsPanel.

2. **Active Positions** — Combined list of Ekubo LP positions (from getEkuboPositions) and privacy pool commitments (from note store). Each shows token pair, value, range/status.

3. **Opportunities** — Simplified TradeDesk filter bar (All, LP, Swap, Stake, Private) with opportunity cards. Click opens execution flow.

**Absorbs:** PrivacyPoolsPanel, EkuboPositionsList, TradeDesk (opportunities only), PoolIntelligencePanel, PoolIntelligence, OracleSignalsTab.
**Kills:** PoolIntelligencePanel (980 lines), PoolIntelligence (302 lines), OracleSignalsTab (317 lines), DeployOverlay (103 lines).

**~320 lines.**

## Tab Detail: Lend

1. **Credit Profile** (hero) — FICO-style gauge with score (0-850), tier, trust percentage, total collateral, borrowing power, computed LTV and interest rate. Shows computation source (reputation + risk passport + linked addresses). Inline oracle hint about rate environment.

2. **Active Loans** — Both borrowed and supplied positions in one list. Health factor per loan. Repay/withdraw actions.

3. **Open Market** — Two-column P2P view: supply requests and borrow requests. Fund/create actions.

**Absorbs:** LendingConsole (3 internal tabs flattened), credit line section from CapitalLedger, credit score from portable identity.
**Kills:** Lending slideout.

**~230 lines.**

## Tab Detail: Govern

Promoted from GovernanceOverlay. Same 3 sections (voting power, active proposals, create proposal) but rendered as a tab panel instead of a full-screen overlay.

**Changes:** Remove overlay shell/backdrop. Tighter layout. ~350 lines (down from 793).

## Tab Detail: Activity

Merged from UnifiedStream + EnrichedActivityTab. Single stream component with filter bar (All, Receipts, Decisions, Proofs, Deposits, Votes), search, date-grouped items with tx/proof/commitment hashes and explorer links. One API endpoint.

**Kills:** Redundant stream in IntelligenceSidebar.

**~200 lines.**

## Components Removed

| Component | Lines | Reason |
|-----------|-------|--------|
| PoolIntelligencePanel | 980 | Oracle data goes inline |
| PoolIntelligence | 302 | Oracle data goes inline |
| OracleSignalsTab | 317 | Oracle data goes inline |
| OracleSurfaceContainer | 26 | Wrapper for OracleSignalsTab |
| CenterStageModes | 73 | No more intelligence/vault split |
| DeployOverlay | 103 | TradeDesk absorbed into Capital |
| EnrichedActivityTab | 305 | Merged into Activity tab |
| VaultOverviewTab (current) | ~200 | Rewritten as Overview |
| CapitalLedger | 712 | Replaced by Identity Badge |
| **Total removed** | **~3,018** | |

## Components Rewritten

| Component | Current Lines | New Lines | Change |
|-----------|--------------|-----------|--------|
| VaultCenterStage | 405 | ~100 | 5 tabs instead of 8, simpler |
| HeaderStrip | 211 | ~120 | Fewer pills, fewer overlay buttons |
| IntelligenceSidebar → IdentityBadge | 220 | ~80 | Compact badge only |
| ControlPlane → AgentControls | 994 | ~150 | Agent ops only |
| GovernanceOverlay → GovernTab | 793 | ~350 | Tab, not overlay |
| UnifiedStream → ActivityTab | 318 | ~200 | Merged with EnrichedActivityTab |

## New Components

| Component | Lines (est) | Purpose |
|-----------|------------|---------|
| OverviewTab | ~180 | At-a-glance dashboard |
| CapitalTab | ~320 | Privacy pools + positions + opportunities |
| LendTab | ~230 | Credit profile + loans + P2P market |
| CreditGauge | ~60 | FICO-style radial gauge, reused in IdentityBadge + LendTab |
| InlineOracleCard | ~40 | Compact oracle signal card, reused across tabs |

## Net Impact

- **Navigation:** 28 entry points → 12 (5 tabs + 2 overlays + 4 slideouts + wallet)
- **Center stage code:** ~4,300 lines → ~1,280 lines
- **Sidebar code:** ~1,214 lines → ~230 lines
- **Total UI reduction:** ~4,000+ lines removed
- **Zero content lost** — everything is still accessible, just not duplicated

## Data Flow

All tabs use the same hooks/API calls that already exist. No new backend endpoints needed.

| Data | Source | Used by |
|------|--------|---------|
| Vault summary | `useVaultSummary` hook | Overview hero, IdentityBadge |
| Health/trust/proofs | `useHealthPassport` hook | IdentityBadge |
| Credit score | `GET /api/v1/zkdefi/credit-line/score/{address}` | IdentityBadge gauge, LendTab hero |
| Privacy pools | `GET /api/v1/zkdefi/full_privacy/pools` + pool endpoints | CapitalTab |
| Ekubo positions | `getEkuboPositions(address)` | CapitalTab |
| Opportunities | `GET /api/v1/zkdefi/trade-desk/v2/opportunities` | CapitalTab |
| Lending | existing LendingConsole API calls | LendTab |
| Voting power | `GET /api/v1/dao/voting_power/{address}` | GovernTab |
| Proposals | `GET /api/v1/dao/proposals` | GovernTab |
| Stream | `GET /api/v1/zkdefi/mc/stream/{address}` | Overview (limit 5), ActivityTab (paginated) |
| Agent status | `GET /api/v1/zkdefi/rebalancer/autonomous/status/{address}` | AgentControls |
| Constraints | `GET /api/v1/zkdefi/mc/constraints/{address}` | AgentControls |
| Session keys | `GET /api/v1/zkdefi/session_keys/list/{address}` | AgentControls |
