# Frontend Crawl + Redesign Blueprint

Date: 2026-03-02

## 1) Crawl Scope

This audit covered:
- Route entrypoints under `frontend/src/app`
- Feature components under `frontend/src/components/zkdefi`
- Shared state/context/hooks under `frontend/src/contexts` and `frontend/src/hooks`
- API clients under `frontend/src/lib/api`
- Product intent docs under `docs/` and `docs/plans/`

## 2) Frontend Surface Inventory

### Routes
- `frontend/src/app/page.tsx` — Marketing/landing
- `frontend/src/app/agent/page.tsx` — Main app shell (currently multi-tab control surface)
- `frontend/src/app/profile/page.tsx` — Identity/reputation/profile
- `frontend/src/app/marketplace/page.tsx` — Model marketplace/composer entry
- `frontend/src/app/mvp/page.tsx` — MVP risk→recommend→deploy flow
- `frontend/src/app/mvp/simulator/page.tsx` — Public simulator dashboard
- `frontend/src/app/phase4a/page.tsx` — Legacy/phase-specific surface
- `frontend/src/app/privacy/page.tsx` and `frontend/src/app/terms/page.tsx` — Policy pages

### Core Component Families (zkdefi)
- Vault: `PortfolioTab`, `VaultDashboardPanel`, `VaultOverviewPanel`, `VaultActionCenter`, `VaultPolicyStudio`, `VaultFundingCard`, `UnifiedWithdrawCard`, `VaultLedger`, `VaultHero`
- Markets/Trade: `MarketsTab`, `SwapTab`, `LiquidityTab`, `LimitOrdersPanel`, `NativeStakingPanel`, `DexPanel`, `TradingHub`
- Brain/Automation: `AgentRebalancer`, `ModelComposer`, `AutomationControlPanel`, `ZKGatePipeline`, `ExecutionLoopCard`, `ExecutionControlRail`
- Identity/Trust: `ProfileJourneyBanner`, `ProfileProtocolStatus`, `ProofTimeline`, `TrustDisclosureCards`, `TierBadge`
- Privacy Pools: `ShieldedPoolPanel`, `FullPrivacyPoolPanel`, `HashedWithdrawPoolPanel`, `PrivacyUnifiedActionCard`

### Shared State + Hooks
- Contexts: `ExecutionContext`, `VaultStore`
- App-level shared context: `frontend/src/lib/AppContext.tsx`
- Hooks: `useExecutionContext`, `useExecutionInfra`, `useHistoryTimeline`, `useVaultPolicy`, `useSharedPools`, `useProfile`, `useVisibilityPolling`, etc.

### API Client Layer
- Base client: `frontend/src/lib/api/client.ts` (`API_BASE`, `apiFetch`)
- Domain clients: `ekubo.ts`, `vault.ts`, `strategies.ts`, `policy.ts`, `gating.ts`, `sharedPools.ts`, `state.ts`

## 3) Function/Data Crawl Findings

## 3.1 Route-level coupling
- `agent/page.tsx` is a very large orchestrator that mixes:
  - Wallet lifecycle + onboarding
  - Position aggregation + relayer stats + market polling
  - High-level navigation for multiple product surfaces
  - Component wiring with direct endpoint calls
- `profile/page.tsx` duplicates identity+state orchestration that overlaps with data available in shared APIs/hooks.

## 3.2 API access inconsistency
- Some surfaces use `apiFetch` through domain clients.
- Others still use raw `fetch` with locally-declared `API_BASE`.
- Result: inconsistent error handling, retries, timeout behavior, and response parsing.

## 3.3 Product-surface overlap
- Vault/Markets/Trade/Brain functionality exists in components, but page-level composition mixes old and new IA simultaneously.
- Multiple “entry points” for similar actions (deploy, rebalance, LP, swap) create UX confusion and state drift.

## 3.4 Intent vs implementation drift
From docs:
- `docs/plans/2026-02-19-zkdefi-control-surface.md` targets clear control-surface phases and deferred onboarding.
- `docs/plans/2026-03-02-agent-profile-rearchitecture-implementation.md` targets a 4-surface product model:
  - Vault → Trade → Brain → Identity
- Current implementation only partially reflects this, with mixed legacy and rearchitecture components coexisting.

## 4) Original Intent (Doc-backed)

The intended UX model is:
1. **Vault** as source-of-truth for capital state and ledger.
2. **Trade** as unified execution hub (swap/lp/limit/stake with shared context).
3. **Brain** as intent + constraints + session key + proof gate.
4. **Identity/Profile** for reputation, disclosures, and compliance posture.

Critical product requirements repeatedly documented:
- Session-key visibility and action gating
- Proof-gated execution with clear pipeline status
- Unified history/ledger and invalidation after actions
- Deferred onboarding (don’t block read-only browsing)

## 5) Redesign Proposal (Clean IA)

### 5.1 Navigation and route shape
- Keep top-level app nav strict and stable:
  - Vault
  - Trade
  - Brain
  - Identity (Profile)
- Recommended route structure:
  - `/agent?v=vault|trade|brain` (single app shell)
  - `/profile` (identity)
- Remove duplicate conceptual tabs from page-level nav (no mixed legacy + new labels).

### 5.2 Composition ownership
- `agent/page.tsx` should only own:
  - Shell layout
  - Top-level surface switch
  - global guards (wallet/onboarding mode)
- Move data-fetch orchestration into dedicated feature containers:
  - `VaultSurfaceContainer`
  - `TradeSurfaceContainer`
  - `BrainSurfaceContainer`

### 5.3 Data architecture
- Enforce one API path:
  - All route/components must consume domain clients from `frontend/src/lib/api/*`
  - No direct raw `fetch` in route files except truly local/public data
- Keep `VaultStore` as canonical state for capital-centric data:
  - vault summary
  - live positions
  - ledger/history
  - session summary + limits
- Use one invalidation strategy for cross-surface updates after actions.

### 5.4 Component role boundaries
- Vault surface should include:
  - portfolio summary
  - allocation breakdown
  - ledger/history feed
  - funding/withdraw and policy cards
- Trade surface should include:
  - shared token/amount context
  - mode switch (swap/lp/limit/stake)
  - AI suggestions as inline, not separate destination
- Brain surface should include:
  - session key grant/revoke
  - strategy modules/composer
  - execution mode and gate pipeline status
- Identity surface should include:
  - reputation + passport + linked addresses + compliance disclosures

### 5.5 UX rules
- One action = one canonical place in UI.
- One metric = one source and one formatting rule.
- One error model across clients (avoid HTML/JSON parser crashes).
- Keep “simulator”, “marketplace”, and “mvp” as adjunct modes, not competing primary navigation.

## 6) Implementation Plan (Pragmatic)

### Phase A (stabilize, 1-2 days)
1. Freeze top-level IA (Vault/Trade/Brain/Profile labels and mapping).
2. Remove mixed duplicate tab entries from `agent/page.tsx`.
3. Normalize API access in `agent/page.tsx` and `profile/page.tsx` to domain clients.

### Phase B (surface containers, 2-3 days)
1. Create `VaultSurfaceContainer`, `TradeSurfaceContainer`, `BrainSurfaceContainer`.
2. Move logic from `agent/page.tsx` into those containers.
3. Keep existing leaf components; avoid stylistic rewrite at this step.

### Phase C (data consistency, 2 days)
1. Route all capital state through `VaultStore`.
2. Standardize invalidate/refresh triggers across actions.
3. Consolidate timeline/ledger rendering path.

### Phase D (UX polish, 2-3 days)
1. Unify labels/copy/tooltips to match product intent docs.
2. Remove dead or duplicate entry points.
3. QA pass on wallet disconnected / connected-not-onboarded / onboarded modes.

## 7) Risks and Controls

Risks:
- Breaking action flows by moving orchestration too aggressively.
- Regression in deferred onboarding behavior.
- Fragmented state if old and new contexts both remain active.

Controls:
- Keep leaf components unchanged in early phases.
- Only refactor ownership/composition first.
- Verify each action path after each phase (deposit, withdraw, swap, LP, deploy, rebalance, session grant/revoke).

## 8) Recommended Immediate Next Step

Execute **Phase A only** in the next pass:
- Lock IA labels and tab mapping.
- Remove mixed duplicate tabs from `agent/page.tsx`.
- Replace remaining direct API calls in route files with domain API clients.

This gives a clear UX baseline before deeper refactor.

## 9) Deep Refactor Scope (Entire Vision)

This section breaks the redesign into concrete scope by **page** and **component** so implementation can be reviewed incrementally.

---

## 10) Page-by-Page Refactor Map

### 10.1 `frontend/src/app/agent/page.tsx` (Primary App Shell)

**Current role**
- Massive orchestration file (wallet, onboarding, polling, tabs, per-feature wiring).

**Target role**
- Shell-only orchestrator:
  - route/query-state to surface mapping (`vault`, `trade`, `brain`)
  - global auth/onboarding mode checks
  - render one surface container at a time

**Must remove from page**
- Direct calls to reputation, market-data, relayer, position endpoints.
- Feature-specific polling and merge logic.

**Must add/keep in page**
- Deterministic surface router
- URL deep link contract (`?v=vault|trade|brain`, optional subview)
- Error boundaries around each surface container

**Definition of done**
- <200-250 lines target for page orchestration.
- No direct business-data `fetch` except local mode/probe checks.

---

### 10.2 `frontend/src/app/profile/page.tsx` (Identity Surface)

**Current role**
- Mixed profile + operational + agents + compliance tabs.

**Target role**
- Identity-first page with sections:
  - Reputation & Passport
  - Strategy/Agent credibility
  - Selective disclosure & compliance
  - Linked addresses and profile controls

**Scope changes**
- Keep existing useful blocks (`useProfile*`, `ProofTimeline`, relayer/compliance) but reorder around identity intent.
- De-emphasize unrelated operational controls that belong in Vault/Brain.

**Definition of done**
- Identity data grouped by trust/compliance outcomes, not infra categories.

---

### 10.3 `frontend/src/app/marketplace/page.tsx` (Adjunct)

**Current role**
- Model browsing/composition separate from app shell.

**Target role**
- Keep as adjunct “catalog” entry, but ensure Brain surface is primary in-app place for model composition.

**Scope changes**
- Reuse API/domain clients only.
- Add explicit bridge CTA back to `/agent?v=brain`.

---

### 10.4 `frontend/src/app/mvp/page.tsx` + `frontend/src/app/mvp/simulator/page.tsx` (Adjunct Modes)

**Current role**
- Separate MVP recommendation/deploy and simulator dashboards.

**Target role**
- Preserve for demos/testing.
- Ensure they do not compete with main product IA.

**Scope changes**
- Label as lab/simulator clearly.
- Keep API client consistency and robust non-JSON error handling.

---

### 10.5 `frontend/src/app/page.tsx` (Landing)

**Current role**
- Marketing/positioning.

**Target role**
- Reflect final IA language consistently: Vault, Trade, Brain, Identity.

---

## 11) Surface Containers (New)

Create these container modules and move logic out of `agent/page.tsx`:

- `frontend/src/components/zkdefi/surfaces/VaultSurfaceContainer.tsx`
- `frontend/src/components/zkdefi/surfaces/TradeSurfaceContainer.tsx`
- `frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx`

Each container should own:
- data loading from domain APIs
- optimistic/loading/error states
- action handlers for its scope
- invalidation hooks into shared stores

---

## 12) Component-by-Component Scope

### 12.1 Vault Surface Components

**Primary components**
- `PortfolioTab`
- `VaultOverviewPanel`
- `VaultFundingCard`
- `UnifiedWithdrawCard`
- `VaultLedger`
- `VaultPolicyStudio`
- `TrustDisclosureCards` (subset)
- `SessionKeysSummary`

**Refactor actions**
- Merge duplicate portfolio/vault summary cards into one canonical summary region.
- Ensure ledger/history component uses one timeline source.
- Keep deposit/withdraw actions only here (no duplicate fund actions in unrelated tabs).

**API dependencies (canonical)**
- `strategies.getVaultSummary`
- `vault.getVaultStatus` / `vault.getVaultDeposits`
- `state.getHistoryTimeline` (or ledger endpoint once finalized)
- `gating.listSessionKeys`

---

### 12.2 Trade Surface Components

**Primary components**
- `TradingHub`
- `SwapTab`
- `LiquidityTab`
- `LimitOrdersPanel`
- `NativeStakingPanel`
- `MarketsTab` (as signal layer feeding actions)

**Refactor actions**
- Introduce shared token/amount context for swap/lp/limit/stake.
- Eliminate duplicate trade entry points from Vault/Brain.
- Keep opportunities panel as advisory input, not separate destination.

**API dependencies (canonical)**
- `ekubo.*`
- `strategies` opportunities/recenter/guard
- `policy`/`gating` preflight before execution

---

### 12.3 Brain Surface Components

**Primary components**
- `AgentRebalancer`
- `ModelComposer`
- `AutomationControlPanel`
- `ExecutionLoopCard`
- `ExecutionControlRail`
- `ZKGatePipeline`
- `SessionKeyManager`

**Refactor actions**
- Session key grant/revoke and execution mode controls become first-class at top.
- Standardize gate outcomes and advisory copy.
- Surface proof pipeline state for every autonomous action.

**API dependencies (canonical)**
- `gating.runActionGate`, `gating.advisoryActionCheck`
- `strategies` execute/recommend/rebalance/auto-agent
- relevant orchestration endpoints through domain clients

---

### 12.4 Identity Surface Components

**Primary components**
- `ProfileJourneyBanner`
- `ProfileProtocolStatus`
- `ProofTimeline`
- `MyAgents` (identity context only)
- `TierBadge`

**Refactor actions**
- Reframe sections by trust/compliance and reputation explainability.
- Keep collateral and relayer controls but subordinate to identity narrative.

**API dependencies (canonical)**
- `useProfileReputation`, `useOnboardingStatus`, `useRiskPassport`, `useLinkedAddresses`
- compliance/reputation endpoints via domain clients

---

## 13) State Refactor Scope

### 13.1 `VaultStore` becomes canonical capital state

Canonical keys:
- vault summary
- live positions
- unified ledger/history
- risk limits / policy snapshot
- session summary (or execution context mirror)

### 13.2 `ExecutionContext` owns execution mode + auth capability

Canonical keys:
- wallet connected state
- execution mode (`manual_wallet` | `paymaster` | `orchestrated` | `autonomous`)
- session capability state
- gate requirement flags

### 13.3 `AppContext` reduced to lightweight app-wide concerns

Target scope:
- toasts/event feed hooks
- demo mode
- invalidate signal bridge

Avoid duplicate ownership across contexts.

---

## 14) API Refactor Scope

### 14.1 Rule
- No raw `fetch` in route pages for business endpoints.
- Route pages and components consume only `frontend/src/lib/api/*` and hooks.

### 14.2 Immediate migrations
- Migrate direct calls in `agent/page.tsx` to domain clients.
- Normalize `MarketsTab` and `PortfolioTab` remaining raw calls into client wrappers.

### 14.3 Error model
- All domain client failures return consistent typed errors.
- UI never assumes JSON on failed response.

---

## 15) Sequence Plan (Deep Refactor Work Packages)

### WP-1: Shell Extraction (2-3 days)
- Add surface containers.
- Reduce `agent/page.tsx` to shell/router/guards.

### WP-2: Vault Consolidation (2-3 days)
- Unify vault summary + ledger + session summary.
- Remove duplicate capital controls outside Vault.

### WP-3: Trade Unification (2-3 days)
- Shared trade context across swap/lp/limit/stake.
- Markets as advisory + action jump-in.

### WP-4: Brain Systemization (2-3 days)
- Standardize execution modes + session gating + pipeline state.

### WP-5: Identity Reframe (1-2 days)
- Reorder profile content by identity trust model.

### WP-6: API and Error Harmonization (1-2 days)
- Remove page-level business fetch.
- Centralize client behavior and error normalization.

### WP-7: QA and Flow Verification (2 days)
- scenario matrix (wallet disconnected / connected not onboarded / onboarded)
- action matrix (deposit, withdraw, swap, LP, limit, stake, deploy, rebalance)

---

## 16) Verification Matrix (Page + Component)

For each work package, verify:
- Rendering
- Data loading
- Action execution
- Invalidation propagation
- Error/retry behavior
- Deep-link behavior

Minimum checklist per primary component:
- Inputs contract explicit
- API dependencies explicit
- Side-effects isolated
- Loading and empty states explicit
- Error state explicit
- Ownership (surface) explicit

---

## 17) What Not to Do During Deep Refactor

- Do not redesign visual style and architecture simultaneously.
- Do not move backend contracts unless necessary for frontend invariants.
- Do not keep duplicate action entry points “for convenience.”
- Do not leave mixed state ownership unresolved.

---

## 18) Proposed Deliverables (Review-Friendly)

Deliverable set so you can review page-by-page and component-by-component:
- `docs/2026-02-27/REFRACTOR_SCOPE_PAGE_MAP.md` (page contracts)
- `docs/2026-02-27/REFRACTOR_SCOPE_COMPONENT_MAP.md` (component contracts)
- `docs/2026-02-27/REFRACTOR_SCOPE_API_MAP.md` (endpoint ownership and client wrappers)
- `docs/2026-02-27/REFRACTOR_SCOPE_STATE_MAP.md` (store/context ownership)
- `docs/2026-02-27/REFRACTOR_QA_MATRIX.md` (flow verification matrix)

If approved, implementation should proceed in WP order and submit each WP as a standalone reviewable PR-sized change set.
