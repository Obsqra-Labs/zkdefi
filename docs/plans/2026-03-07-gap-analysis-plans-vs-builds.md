# Gap Analysis: Plans & Design Docs vs Latest Builds

**Date:** 2026-03-07  
**Scope:** Last 24–48 hours of plans (Mission Control refactor, Trade Desk, Intelligence Stream, adapters) vs current codebase.  
**Goal:** Identify scoped-but-missing items and opportunities to improve; root causes and remediation design.

---

## 1. Exploration Summary

**Sources reviewed:** Mission Control UX refactor design, Intelligence surface rewrite design, Trade Desk design & adapters implementation, TRADE_DESK_IMPLEMENTATION_ROADMAP, TRADE_DESK_ARCHITECTURE, REPUTATION_GATED_LENDING_DAO_VOTING; agent page, DeployOverlay, ControlPlane, UnifiedStream, CapitalLedger, backend mission_control, strategies, main.py.

**Implemented and aligned:** 3-column layout, Center Stage = Intelligence Stream as default, Deploy/Circuit Board/Governance/Brain overlays, unified stream with live opportunities and signal ranking, GET mc/signal/top, receipts timeline, ledger notes endpoint, zkd portfolio + yield chart, constraints/policy/emergency under mc, execution/current, dao_governance and vault_proposals mounted.

---

## 2. Gaps Identified

### 2.1 Privacy Pools (High)

**Scoped:** Three DAO-governed Privacy Pool buckets: Conservative, Moderate, Aggressive. PrivacyPoolAdapter; PoolLiquidityManager + VaultLendingGovernanceService.

**Current state:** PrivacyPoolAdapter.ts exists with tests; not used in Mission Control UI. DeployOverlay has Swap, LP, Lend, Stake, DCA, Limits — no Privacy Pools tab. FullPrivacyPoolPanel is a slideout for full shielded pool, not the three risk buckets or DAO lending from idle pool capital.

**Root cause:** Trade Desk / Deploy implemented with legacy panels; Privacy Pool bucket UX and PrivacyPoolAdapter were never added to Deploy.

### 2.2 Trade Desk vs Deploy Overlay (High)

**Scoped:** Replace deploy with the trade desk; Deploy overlay should show Trade Desk (OpportunityList, ExecutionPanel, policy gating), not legacy stub panels.

**Current state:** TradeDesk.tsx exists. DeployOverlay still uses DexPanel, LPPanel, LendingPanel, NativeStakingPanel, VaultDCAPanel, LimitsPanel — legacy panels, not TradeDesk.

**Root cause:** Deploy overlay content was not replaced by TradeDesk component.

### 2.3 Constraints & Policy API Paths (Medium)

**Scoped:** Design: GET/PUT /api/v1/vault/constraints and policy.

**Current state:** mission_control exposes under mc/constraints and mc/policy. Clients expecting /vault/ paths would 404.

**Root cause:** Backend under mc prefix; design/docs referred to vault paths.

### 2.4 Dark Ledger in Capital Ledger (Medium)

**Scoped:** Left rail Dark Ledger: note count, sweep available, L3 block; Import/Sweep. Data: ledger/notes/{address}.

**Current state:** CapitalLedger shows Dark Ledger section but load() may set note_count/sweep to 0 and not call notes API.

**Root cause:** Notes API and left rail never wired, or response shape mismatch.

### 2.5 Execution Flow as a Visible Mode (Medium)

**Scoped:** Mode 1: Execution Flow (7-step state machine) with Memory Lane below.

**Current state:** Default center stage is Unified Stream (intentional). No selectable Execution Flow mode in center stage.

**Root cause:** Execution Flow never added as a switchable mode.

### 2.6 Governance Mode & Voting Power (Medium)

**Scoped:** Center Stage Mode 5: Governance — voting power, proposals, cast/create. Voting power = f(LP + lending + staking, tier).

**Current state:** dao_governance and vault_proposals mounted; VaultGovernancePanel exists. Gaps: voting power may be mock; Governance reachability from strip unclear.

### 2.7 Memory Lane 3-Level Receipt (Low–Medium)

**Scoped:** 3-level receipt (compact → expanded → forensic drawer); filters; search by receipt ID.

**Current state:** Stream has date-grouped expandable cards; no dedicated Memory Lane with Level 2/3 and receipt-only filters.

### 2.8 Circuit Board Policy Save/Load (Low)

**Scoped:** Circuit Board save/load via policy API.

**Current state:** mc/policy exists; unclear if Circuit Board calls it or uses local state only.

### 2.9 Agent Insights Strip / Limits & DCA (Low)

**Scoped:** Agent Insights from zkML; Limits/DCA wired to real execution.

**Current state:** AgentInsightsStrip exists; Limits/DCA tabs exist; execution may be stubbed.

### 2.10 Legacy branch: Ekubo LP positions / LP dashboard (High — user-reported)

**Context:** In the pinned pre-deletion snapshot (`backup/docs-predeletion-20260306-115441`), the vault surfaces included a full Ekubo LP experience where you could **see your Ekubo positions** (e.g. in an LP dashboard or vault trade/LP surface).

**In the backup branch (not on main):**
- **`frontend/src/lib/api/ekubo.ts`** — Client for Ekubo: `getEkuboPositions(owner)` → `GET /api/v1/zkdefi/ekubo/positions?owner=...`, plus `previewLp`, `buildLpAddTx`, `buildLpRemoveTx`, swap quote/build, capabilities, market surface.
- **`frontend/src/components/zkdefi/EkuboLpPanel.tsx`** — Full LP UI: fetches positions via `getEkuboPositions`, shows position list, add/remove liquidity, preview, risk profile, token selectors; uses `buildLpAddTx` / `buildLpRemoveTx` and gating.
- **`frontend/src/components/zkdefi/EkuboOperateHub.tsx`** — Hub combining Swap + LP (EkuboSwapPanel + EkuboLpPanel).
- **`frontend/src/components/zkdefi/EkuboSwapPanel.tsx`** — Ekubo-specific swap panel.
- **`frontend/src/components/zkdefi/PositionManager.tsx`** — Position management UI.
- **`frontend/src/components/zkdefi/VaultLedger.tsx`** — Vault ledger view.
- Backup also had **TradeSurfaceContainer**, **VaultSurfaceContainer** and a **LiquidityTab** that could be wired to Ekubo positions.

**On main (current):**
- **No `lib/api/ekubo.ts`** — Removed or never merged; no frontend way to call `GET .../ekubo/positions` or LP build/preview.
- **No EkuboLpPanel, EkuboOperateHub, EkuboSwapPanel, PositionManager** — Not present under `frontend/src/components/zkdefi/`.
- **DeployOverlay** uses an inline **LPPanel** that calls **`/api/v1/zkdefi/position/{address}?protocol_id=0`** (zkdefi_agent aggregate position), not the Ekubo list endpoint; positions shown are from that aggregate, not the per-NFT Ekubo positions list.
- **LiquidityTab** (used in VaultTradeTab) is a **stub** — “LP panel shim active. Use standalone LP + Yield demos”; no positions list or Ekubo wiring.
- **Backend:** `backend/app/api/routes/ekubo.py` exists and exposes **`GET /ekubo/positions?owner=...`** (via `list_positions` from `ekubo_lp_service`). The ekubo router is **not** mounted in `main.py` under `/api/v1/zkdefi`; only `app.api.routes.dex` is mounted for zkdefi. So **`/api/v1/zkdefi/ekubo/positions` is not available** unless the ekubo router is included under the zkdefi prefix elsewhere (e.g. by dex router). If not mounted, the legacy “see my Ekubo positions” flow 404s.

**Root cause:** Post–Mission Control refactor, the legacy Ekubo UI and `lib/api/ekubo` were dropped (or lived only on the backup branch). Deploy and Vault trade were rebuilt with a simpler LPPanel and stub LiquidityTab that do not use the Ekubo positions API or the full EkuboLpPanel.

---

## 3. Approaches for Closing Gaps

- **Option A — Phased by impact:** Phase 1: Privacy Pools + Trade Desk in Deploy. Phase 2: Dark Ledger wiring, path contract, Governance voting power. Phase 3: Execution Flow mode, Memory Lane, Circuit Board, Agent Insights/Limits/DCA.
- **Option B — Single parity pass:** One pass touching every gap; higher regression risk.
- **Option C — Document + minimal:** Fix only Privacy Pools surface and Deploy → Trade Desk; defer rest.

**Recommendation:** Option A.

---

## 4. Design: Phase 1 — Privacy Pools + Trade Desk in Deploy

### 4.1 Privacy Pools in Deploy

Add Pools (or Privacy Pools) tab to DeployOverlay. Tab content: PrivacyPoolsPanel listing Conservative / Moderate / Aggressive with TVL, idle %, DAO APR, your deposit; Deposit/Withdraw per bucket. Use PrivacyPoolAdapter; backend: minimal read endpoints for pool stats and per-address positions if missing. FullPrivacyPoolPanel slideout unchanged.

**Acceptance:** Deploy → Pools tab shows three buckets with real or clearly placeholder stats; Deposit/Withdraw wired or Coming soon.

### 4.2 Deploy Overlay Shows Trade Desk

Replace DeployOverlay content with TradeDesk component (address, onClose). Keep legacy panels as sub-views or separate routes if needed.

**Acceptance:** Deploy opens overlay with TradeDesk (opportunities, execution mode, actions).

### 4.3 Legacy: Ekubo LP positions visible again (Phase 1)

- **Backend:** Mount `app.api.routes.ekubo` under `/api/v1/zkdefi` so `GET /api/v1/zkdefi/ekubo/positions?owner=...` and related LP/swap routes are live.
- **Frontend:** Restore or reimplement `lib/api/ekubo.ts` with `getEkuboPositions(owner)`. In Deploy LP and/or Vault Trade (LiquidityTab), show the list of Ekubo positions (from that endpoint) and optionally wire add/remove to existing backend LP build endpoints. Prefer reusing EkuboLpPanel from backup if feasible; otherwise enhance the current LPPanel or LiquidityTab to consume `ekubo/positions`.
- **Acceptance:** User can see their Ekubo positions (e.g. in Deploy → LP or Vault → Trade → LP) and, if in scope, add/remove liquidity.

---

## 5. Design: Phase 2 — Data & Path Consistency

Dark Ledger: CapitalLedger load() calls ledger/notes and maps to note_count, sweep_available_usd, l3_block. Paths: Standardize on mc paths; update docs and frontend. Governance: Replace mock voting power with real LP + lending + staking aggregation and tier multiplier.

---

## 6. Design: Phase 3 — Optional Modes & Polish

Execution Flow: Add center-stage mode switch; render ExecutionFlow component using mc/execution/current. Memory Lane: Optional dedicated receipt section with compact → expanded → forensic drawer. Circuit Board: Load/save via mc/policy. Agent Insights / Limits / DCA: Verify wiring; complete execution where stubbed.

---

## 7. Summary Table

| Gap | Priority | Phase | Remediation |
|-----|----------|--------|-------------|
| Privacy Pools not in Deploy | High | 1 | Add Pools tab; PrivacyPoolsPanel + adapter + backend |
| Deploy shows legacy, not Trade Desk | High | 1 | Replace overlay content with TradeDesk |
| Constraints/Policy path | Medium | 2 | Standardize mc; update docs/frontend |
| Dark Ledger notes | Medium | 2 | Wire CapitalLedger to ledger/notes |
| Governance voting power | Medium | 2 | Real aggregation + tier |
| Execution Flow mode | Medium | 3 | Add selectable mode + ExecutionFlow component |
| Memory Lane 3-level | Low–Med | 3 | Receipt section + expand + forensic |
| Circuit Board save/load | Low | 3 | Use mc/policy in UI |
| Agent Insights / Limits / DCA | Low | 3 | Verify wiring; complete execution |
| **Legacy: Ekubo LP positions / LP dashboard** | **High** | **1** | **Mount ekubo router under /api/v1/zkdefi; restore or rewire lib/api/ekubo + EkuboLpPanel (or LPPanel → ekubo/positions); replace LiquidityTab stub with positions list** |

---

## 8. Legacy branch remediation (Ekubo LP / positions)

- **Backend:** Ensure **`app.api.routes.ekubo`** is mounted so **`GET /api/v1/zkdefi/ekubo/positions?owner=...`** (and any other ekubo routes: capabilities, lp/preview, lp/add/build, swap/quote, etc.) are available. If the router exists but is not mounted in `main.py`, add it under the zkdefi prefix.
- **Frontend:** Either **restore** from backup or **reimplement**:
  - **`lib/api/ekubo.ts`** (or equivalent) — at least `getEkuboPositions(owner)` and, if Deploy LP should support add/remove, `previewLp`, `buildLpAddTx`, `buildLpRemoveTx`.
  - **LP positions in the UI** — Either (a) use **EkuboLpPanel** (or EkuboOperateHub) from backup in Deploy or Vault trade, or (b) have the existing **LPPanel** in DeployOverlay call `GET .../ekubo/positions?owner=...` and display that list (with add/remove if desired), or (c) replace the **LiquidityTab** stub with a panel that fetches and displays Ekubo positions from the same endpoint.
- **Acceptance:** From the vault/Deploy LP surface, the user can see their Ekubo positions (list from `ekubo/positions`) and, if in scope, add/remove liquidity via existing backend LP build endpoints.

---

## 9. Next Step

After you approve this gap analysis and phased design, create a detailed implementation plan (e.g. via writing-plans skill) for Phase 1 (including Legacy Ekubo LP / positions), then Phase 2, then Phase 3. No implementation in this step.

**Phase 1 implementation plan:** `docs/plans/2026-03-07-phase1-privacy-pools-trade-desk-ekubo.md`. **Acceptance:** Deploy default = Trade Desk; Privacy Pools tab with three buckets (CONSERVATIVE_POOL, MODERATE_POOL, AGGRESSIVE_POOL); Ekubo LP positions list from `GET /api/v1/zkdefi/ekubo/positions?owner=...`. Manual verification: backend running → `curl` ekubo/positions and dao/pools/CONSERVATIVE_POOL/stats → 200; frontend → Deploy shows Trade Desk, Privacy Pools tab, Ekubo positions section.
