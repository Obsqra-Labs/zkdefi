# Frontend Refactor — Whole Scope

Date: 2026-03-02

## 1) Objective

Refactor the frontend into a clean, coherent product architecture centered on:
- Vault
- Trade
- Brain
- Identity

This scope is end-to-end and implementation-oriented. It defines page ownership, component ownership, state/data contracts, API normalization, rollout sequence, and QA acceptance.

---

## 2) Product North Star

zkde.fi frontend should behave as a vault-centric, proof-gated, reputation-aware execution surface.

### Non-negotiables
- One canonical place per action.
- One canonical source per metric.
- One canonical gate/advisory model per execution path.
- Deferred onboarding preserved (read-first, gate on action/identity).

---

## 3) Information Architecture (Target)

## Top-level surfaces
1. Vault
2. Trade
3. Brain
4. Identity (Profile)

## Route strategy
- `/agent?v=vault|trade|brain`
- `/profile` for Identity
- MVP / Simulator / Marketplace remain adjunct modes

---

## 4) Page-by-Page Scope

## 4.1 `frontend/src/app/agent/page.tsx`

### Keep
- Surface selection from URL
- Wallet/onboarding guard orchestration
- Surface container mounting
- Top-level error boundaries

### Remove
- Feature-specific polling/data-fetch logic
- Direct endpoint integration for business data
- Duplicated action entry points

### End state
- Shell router only; feature logic lives in containers.

---

## 4.2 `frontend/src/app/profile/page.tsx`

### Keep
- Reputation/passport hooks and profile controls
- Existing compliance/linked-address infrastructure

### Reframe
- Organize as identity-first sections:
  - Reputation & score breakdown
  - Agent/strategy credibility
  - Disclosure/compliance controls

### End state
- Identity narrative first, ops controls secondary.

---

## 4.3 `frontend/src/app/marketplace/page.tsx`

### Keep
- Catalog/composer capability

### Add
- Explicit bridge to Brain surface (`/agent?v=brain`)

### End state
- Adjunct “catalog” mode, not primary brain control plane.

---

## 4.4 `frontend/src/app/mvp/page.tsx` + `frontend/src/app/mvp/simulator/page.tsx`

### Keep
- Demo/lab workflows

### Ensure
- Clear lab labeling
- No overlap with primary IA responsibilities

---

## 4.5 `frontend/src/app/page.tsx`

### Keep
- Marketing content

### Align copy
- Match final IA labels and flow language.

---

## 5) Container Architecture (New)

Create and move orchestration into:
- `frontend/src/components/zkdefi/surfaces/VaultSurfaceContainer.tsx`
- `frontend/src/components/zkdefi/surfaces/TradeSurfaceContainer.tsx`
- `frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx`

Container responsibilities:
- Data loading
- Action handlers
- Loading/error/empty states
- Invalidation hooks to shared state

---

## 6) Component-by-Component Scope

## 6.1 Vault Surface

Primary components:
- `PortfolioTab`
- `VaultOverviewPanel`
- `VaultFundingCard`
- `UnifiedWithdrawCard`
- `VaultLedger`
- `VaultPolicyStudio`
- `SessionKeysSummary`
- `TrustDisclosureCards` (vault-relevant subset)

Scope:
- Consolidate summary cards and ledger timeline.
- Make Vault the only canonical entry for funding/withdraw actions.

APIs:
- `strategies.getVaultSummary`
- `vault.getVaultStatus`, `vault.getVaultDeposits`
- `state.getHistoryTimeline` (or ledger endpoint)
- `gating.listSessionKeys`

---

## 6.2 Trade Surface

Primary components:
- `TradingHub`
- `SwapTab`
- `LiquidityTab`
- `LimitOrdersPanel`
- `NativeStakingPanel`
- `MarketsTab` (advisory + jump-in)

Scope:
- One shared trade context (tokenIn, tokenOut, amount, mode).
- Eliminate duplicate trade actions outside Trade surface.

APIs:
- `ekubo.*`
- strategy advisories (`opportunities`, `recenter`, `guard`)
- policy/gating preflight

---

## 6.3 Brain Surface

Primary components:
- `AgentRebalancer`
- `ModelComposer`
- `AutomationControlPanel`
- `ExecutionControlRail`
- `ExecutionLoopCard`
- `ZKGatePipeline`
- `SessionKeyManager`

Scope:
- Session key controls as first-class, top-of-surface.
- Standard gate outcomes/advisory copy.
- Pipeline visibility for every autonomous action path.

APIs:
- `gating.runActionGate`
- `gating.advisoryActionCheck`
- `strategies` recommend/execute/rebalance/auto agent

---

## 6.4 Identity Surface

Primary components:
- `ProfileJourneyBanner`
- `ProfileProtocolStatus`
- `ProofTimeline`
- `TierBadge`
- profile hooks in `useProfile.ts`

Scope:
- Present trust/compliance posture, not mixed operational dashboard.
- Keep selective disclosure and linked addresses coherent.

---

## 7) State Ownership Scope

## 7.1 `VaultStore` (canonical capital state)
Owns:
- vault summary
- positions
- ledger/timeline
- policy/risk limits snapshot
- session summary bridge (if needed)

## 7.2 `ExecutionContext`
Owns:
- execution mode and capability
- wallet execution readiness
- gate requirement posture

## 7.3 `AppContext`
Reduce to:
- demo mode
- app-level invalidate signal
- global feed/toast plumbing

Rule: avoid duplicate ownership of same domain state across stores.

---

## 8) API Refactor Scope

## Rules
- No raw business `fetch` in page files.
- All business calls routed via `frontend/src/lib/api/*` domain clients.
- Typed errors and consistent non-JSON handling.

## Immediate migration targets
- `agent/page.tsx` direct calls
- `profile/page.tsx` direct calls
- remaining mixed direct calls inside top-level surface components

---

## 9) UX Contract Scope

- One canonical action location:
  - funding/withdraw in Vault
  - swap/lp/limit/stake in Trade
  - automation/session/gate in Brain
  - compliance/disclosure in Identity
- One canonical label set in nav and deep links.
- Consistent gate/advisory messages across all action cards.

---

## 10) Rollout Work Packages

## WP-1 Shell Extraction (2-3 days)
- Add containers
- Reduce `agent/page.tsx` to shell/router

## WP-2 Vault Consolidation (2-3 days)
- Unify vault summary + ledger + session overview

## WP-3 Trade Unification (2-3 days)
- Shared trade context + de-duped entry points

## WP-4 Brain Systemization (2-3 days)
- Session/gate/pipeline as cohesive control plane

## WP-5 Identity Reframe (1-2 days)
- Trust/compliance-first layout and copy

## WP-6 API & Error Harmonization (1-2 days)
- Route all calls through domain clients

## WP-7 QA Matrix Execution (2 days)
- full state/action scenario validation

---

## 11) Acceptance Criteria

Global:
- No duplicate high-level action entry points.
- No direct business endpoint calls in route pages.
- All major actions invalidate and refresh dependent views.
- Wallet disconnected / connected-not-onboarded / onboarded all behave predictably.

Per action path:
- Deposit
- Withdraw
- Swap
- LP add/remove
- Limit order place/cancel
- Stake
- Deploy/execute allocation
- Rebalance
- Session key grant/revoke

Each must pass:
- UI affordance
- API success/failure handling
- state refresh
- telemetry/log visibility

---

## 12) Risks & Controls

Risks:
- Breaking flows while moving ownership.
- Regressing deferred onboarding behavior.
- State duplication between old/new patterns.

Controls:
- Move composition first, avoid visual rewrites in early packages.
- Keep leaf feature logic stable during container extraction.
- Ship in WP-sized reviewable increments with QA gates.

---

## 13) Deliverables

Planned companion docs for implementation review:
- `REFRACTOR_SCOPE_PAGE_MAP.md`
- `REFRACTOR_SCOPE_COMPONENT_MAP.md`
- `REFRACTOR_SCOPE_API_MAP.md`
- `REFRACTOR_SCOPE_STATE_MAP.md`
- `REFRACTOR_QA_MATRIX.md`

This file is the canonical whole-scope contract.
