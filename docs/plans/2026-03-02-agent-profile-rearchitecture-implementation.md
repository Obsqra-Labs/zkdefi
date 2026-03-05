# zkde.fi Agent & Profile Re-architecture — Implementation Plan

**Date:** 2026-03-02  
**Purpose:** No shortcuts. System-level plan to rewire `/agent` and `/profile` into a unified vault-centric, proof-gated, reputation-aware product. Feeds the builder-agent mega-prompt.

---

## 1. Product truth (non-negotiable)

**zkde.fi is:** A vault-centric, proof-gated, reputation-aware autonomous capital engine.

**zkde.fi is NOT:** A DEX UI with extra tabs, an AI bot demo, or a zkML showcase.

Everything—routing, state, copy, and flows—must orbit: **Vault → Trade → Brain → Identity**.

---

## 2. Current state (inventory)

### 2.1 Frontend

| Area | Current | Issue |
|------|--------|--------|
| **Agent page** | Single 680+ line page; 4 main tabs (Portfolio, Strategies, Intelligence, Analytics); 6 strategy sub-tabs (Markets, Swap, LP, Limit, Automate, Stake). | Fragmented. No vault-first entry. Swap/LP/Limit/Stake are siloed. AI does not drive a single flow. |
| **Profile page** | Overview, Collateral, Relayer, Agents, Compliance. Reputation, Risk Passport, Credit Tier, linked addresses. | No demo view when wallet disconnected; identity/reputation feel secondary. |
| **State** | `AppContext`: activityFeed, hasOnboarded, demoMode, invalidateKey. Per-page useState for positions, tier, sessions, constraints, etc. | No single Vault source of truth. Data fetched in multiple places with no shared cache. |
| **Routing** | `/agent`, `/profile`. Deep links via `?tab=`, `?mode=demo`, `#deploy-to-ekubo`. | "Vault" in nav goes to agent (portfolio). No dedicated `/vault` or 4-surface routing. |

### 2.2 Backend (relevant APIs)

| API | Prefix | Purpose |
|-----|--------|---------|
| Vault | `/api/v1/zkdefi/vault` | `GET status`, `GET deposits`, `POST deposit`, `GET operator-address`. Balance, allocations, APY. |
| Ledger | `/api/v1/zkdefi/ledger` | `POST demo-credit` only. **No GET transfers/history yet.** |
| Strategies | `/api/v1/strategies` | `vault-summary`, `execute-allocation`, `recommend`, `analyze-live`, limit-orders, staking, yield, etc. |
| Vault-live | `/api/v1/vault-live` | `positions`, execute-advanced. |
| Orchestration | `/api/v1/zkdefi/orchestration` | `deploy`, receipt/confirm. |
| Session keys | `/api/v1/zkdefi/session_keys` | list, grant, revoke. |
| Reputation | `/api/v1/zkdefi/reputation` | `user/{address}`, `tiers`, stake-collateral, upgrade-tier. |
| Onboarding | `/api/v1/zkdefi/onboarding/status/{address}` | has_agent, identity_commitment, fact_hash. |
| Risk passport | `/api/v1/zkdefi/risk_passport` | Composite score, letter rating. |
| zkML | `/api/v1/zkdefi/zkml/scan`, perceptron/predict | Brain check, circuit scanner. |
| State / history | `/api/v1/zkdefi/state`, `/api/v1/zkdefi/history/timeline` | Wallet state, withdraw-ready, timeline. |

**Gap:** `LedgerService.list_transfers(address, limit, offset)` exists but is **not exposed** via HTTP. A `GET /api/v1/zkdefi/ledger/transfers?user_address=...&limit=50` (or equivalent) is required for the Vault ledger feed.

---

## 3. Target architecture: four surfaces

### 3.1 Top-level nav (max 4 items)

1. **Vault** — Capital source of truth (default for `/agent` or dedicated `/vault`).
2. **Trade** — Unified DEX: Swap, LP, Limit, Stake in one hub with shared token/amount context.
3. **Brain** — AI control: strategy templates, custom agent builder, execution mode (Manual / Assist / Autonomous), ZK gate visibility.
4. **Identity** — Profile: reputation score, strategy/agent reputation, selective disclosure, compliance. (Can stay at `/profile` with Identity as the product name in nav.)

Alternative: keep "Profile" as the 4th nav label but treat the page content as the **Identity** surface (reputation, credit, disclosure, agents).

### 3.2 Surface responsibilities

| Surface | Responsibilities | Must show |
|---------|------------------|-----------|
| **Vault** | Wallet vs Vault balance; deposit/withdraw; NAV chart; allocation breakdown (LP / Limit / Private / Idle); **ledger feed** (deposit, AI allocation, rebalance, pool rotation, harvest, ZK verified); session keys; risk limits; AI execution history. | Every ledger line: what happened, why (AI decision), proof status. |
| **Trade** | One hub: Swap | LP | Limit | Stake. Same token selector and persistent amount across modes. AI suggestions inline (LP range, limit price, staking %). "Apply AI suggestion" CTA. | Single entry; no separate pages per action. |
| **Brain** | Strategy templates (Conservative Yield, Balanced Growth, Aggressive LP, Privacy Allocator). Custom agent builder with models explained (Risk Score, Correlation Risk, Volatility Guard, TWAP, Diversification, Credit Weighting): inputs, output, how it gates execution. Execution modes (Manual / Assist / Autonomous) wired to session keys, max capital, max drawdown, allowed pools. **ZK gate pipeline**: AI Decision → zkML circuit → Proof → On-chain verify → Execute. | ZK gate visible and alive, not academic. |
| **Identity** | Reputation score breakdown (address age, strategy success, risk discipline, liquidation history, vault tenure). Strategy reputation (APY track record, risk rating, trust score). Agent reputation (performance %, proof compliance %, execution reliability). Selective disclosure toggles (KYC level, risk tier, capital band). | Transparent formula; no black box. |

---

## 4. Data and signal unification

- **Analytics** becomes an internal data feed consumed by Brain and Vault, not a top-level tab. Market tables, relayer health, system metrics can live inside Brain (for constraints) and Vault (for ledger/NAV).
- **Intelligence** (zkML scanner, constraints, strategy universe) is merged into **Brain**.
- **Portfolio** (positions, opportunities, deploy card, privacy panels) is merged into **Vault** (allocation + ledger) and **Trade** (opportunities as entry points with "Add liquidity" / "Swap" etc.).

So:

- One cohesive system: Vault reflects allocations and ledger; Trade suggests from the same data; Brain consumes analytics and drives execution; Identity shows reputation that affects Brain and relayer.

---

## 5. Component tree redesign (high level)

- **Layout**
  - Shared header: logo, **Vault | Trade | Brain | Identity(Profile)**, session chip, tier badge, settings, Connect.
  - Demo banner when `?mode=demo` (and optional preload for hackathon).

- **Vault surface**
  - `VaultHero`: Wallet balance vs Vault balance, Deposit / Withdraw CTAs.
  - `VaultNavChart`: NAV over time (from vault status + history if available).
  - `AllocationBreakdown`: LP / Limit / **Private** / Idle (from vault status + strategies). **Private** is first-class; clickable → Trade with privacy context.
  - `VaultLedger`: List of ledger entries (from new `GET ledger/transfers` or equivalent). Each row: what, why (AI reason when applicable), proof status, link to tx/receipt; optional "Under session X" when applicable.
  - **`SessionKeysSummary` (required):** Active session(s), expiry, scope (max capital, allowed pools), **Revoke**. If mode is Assist/Autonomous and no session, CTA: "Grant session key in Brain".
  - `RiskLimitsSummary`: From constraints / policy (max position, session duration).
  - **Deposit flow:** Option to choose routing (Public / Private / Mixed) so privacy is first-class at deposit time.

- **Trade surface**
  - `TradeHub`: Token pair selector (persistent), amount field (persistent), sub-tabs: Swap | LP | Limit | Stake.
  - `SwapPanel`, `LiquidityPanel`, `LimitOrdersPanel`, `StakePanel`: reuse existing logic but inside TradeHub with shared context.
  - `AISuggestionsInline`: For selected pair: suggested LP range, limit price, staking %; "Apply AI suggestion" button (calls recommend/analyze-live and fills form or applies action).

- **Brain surface**
  - **`SessionKeyControl` (required, primary):** Grant/revoke session key; set scope (max position, allowed pools, duration). Show active session(s) and expiry. Copy: "Assist and Autonomous require an active session key." Do not bury in settings.
  - `StrategyTemplates`: Cards for Conservative Yield, Balanced Growth, Aggressive LP, Privacy Allocator (link to deploy/execute with preset).
  - `CustomAgentBuilder`: Model selector with **per-model explanation** (what it does, inputs, output, how it gates). Decision logic AND/OR. Compose and save (existing ModelComposer/agent flow).
  - `ExecutionModeControl`: Manual | Assist | Autonomous; wired to session key (Assist/Autonomous require granted session), max capital, max drawdown, allowed pools (from constraints + policy).
  - `ZKGatePipeline`: Visual pipeline: AI Decision → zkML circuit → Proof generated → On-chain verify → Execute. Show status per step (e.g. from rebalancer/prepare, zkml/scan, receipt).
  - `ActiveConstraints`, `StrategyUniverse`: Sidebar or inline (from gate + strategies).

- **Identity surface (Profile page)**
  - `ReputationScore`: Score + breakdown (address age, success rate, risk discipline, liquidation history, vault tenure). Transparent formula.
  - `StrategyReputation`, `AgentReputation`: Per-strategy / per-agent metrics.
  - `SelectiveDisclosure`: Toggles for KYC level, risk tier, capital band; ZK framing.
  - Existing: Risk Passport, Credit Tier, linked addresses, collateral, relayer, compliance, My Agents.

---

## 6. Routing structure

- **Option A (recommended):**  
  - `/agent` → Default to **Vault** surface (first tab). Tabs: Vault | Trade | Brain.  
  - `/profile` → **Identity** surface (same content, nav label "Identity" or "Profile").  
  - No `/vault` or `/trade` as separate routes unless we want deep links; then `/agent/vault`, `/agent/trade`, `/agent/brain` with shared layout.

- **Option B:**  
  - `/agent` with hash or query: `#vault`, `#trade`, `#brain`, and `/profile` for Identity.  
  - Single page with 3 surfaces + Profile as separate page.

Keep **max 4 top-level nav items**; no nested tab hell. If a feature does not affect capital allocation, remove from primary nav or put under "Advanced" / settings.

---

## 7. Unified state: VaultStore

Introduce a **VaultStore** (React context or Zustand) as the single source of truth for:

- `walletBalance` (from wallet or read-only)
- `vaultBalanceWei`, `vaultStatus` (from `GET /api/v1/zkdefi/vault/status`)
- `ledgerTransfers` (from new `GET /api/v1/zkdefi/ledger/transfers`)
- `allocations` (from vault status + strategies; must include **Private** as allocation type)
- **`sessionKeyState`** (active sessions, permissions, expiry, from `GET /api/v1/zkdefi/session_keys/list/{address}`; consumed by Vault SessionKeysSummary and Brain SessionKeyControl; required for Assist/Autonomous)
- `demoMode` (from URL or app context)
- `invalidate()` to refetch and refresh all consumers

Components read from VaultStore instead of duplicating fetches. Agent page (and later Trade/Brain) trigger refetch on deploy, execute, deposit, withdraw. **No other store manages capital or session keys.**

**Backend dependency:** Add `GET /api/v1/zkdefi/ledger/transfers?user_address=...&limit=50&offset=0` that returns `LedgerService.list_transfers(address, limit, offset)` with optional fields for `reason` (e.g. `vault_deposit`, `ai_allocation`, `rebalance`, `harvest`) and `settlement_type` (onchain | demo). If we add `execution_path`/`privacy_path` later (per reputation design doc), include in response for filtering.

---

## 8. Capital flow (user journey)

1. Connect wallet.
2. Demo mode option visible (banner + optional "Preload demo vault").
3. **Deposit into Vault** (from Vault surface): wallet → vault (on-chain or demo-credit in demo).
4. Choose: **Manual Trade** | **AI Assist** | **Autonomous** (Brain).
5. **If Assist or Autonomous:** grant session key in Brain (scope: max capital, allowed pools, duration); visible in Vault as SessionKeysSummary.
6. AI suggests allocations (Trade or Brain); user approves.
7. Brain executes; ZK gate verifies; ledger logs it (Vault ledger feed; entries can show "Under session X" when applicable).
8. One loop: Vault → Trade/Brain → execution → ledger. No seven disconnected tabs.

---

## 9. Demo / hackathon mode

- **Preload:** When `?mode=demo` and no wallet (or explicit "Preload demo vault"), call `POST /api/v1/zkdefi/ledger/demo-credit` with a fixed amount (e.g. 10 ETH wei) so vault balance is non-zero.
- **Simulate:** Show ledger entries for "AI allocation", "Rebalance", "ZK proof verified" (can be seeded in backend for demo address or generated on first deploy simulation).
- **No empty dashboards:** Vault shows balance and ledger; Trade shows opportunities; Brain shows templates and pipeline. Demo must feel alive.

---

## 10. Identity dashboard schema (Profile)

- **Reputation:** Already have `userRep` (tier, tenure_days, successful_txns, collateral_eth), Risk Passport (composite_score, letter_rating), Credit Tier. Expose **breakdown** (formula or at least list of factors: address age, strategy success rate, risk discipline, liquidation history, vault tenure) so it's transparent.
- **Strategy reputation:** Per strategy: APY track record, risk rating, community trust score (if we have data; else placeholder with "Coming soon").
- **Agent reputation:** Per agent: performance %, proof compliance %, execution reliability (from receipts / orchestration if available).
- **Selective disclosure:** Toggles for "Reveal KYC level", "Reveal risk tier", "Reveal capital size band", "Remain private". Store preferences and use ZK framing in copy.

---

## 11. ZK proof state tracking

- **Brain:** Show pipeline state per execution: pending → zkML running → proof generated → on-chain verify → executed (or failed at step X).
- **Vault ledger:** Each line that came from AI has a proof status: verified / pending / failed.
- **Backend:** Rebalancer/prepare, zkml/scan, and receipt/confirm already exist; ensure responses include a **proof_status** or **verification_status** field that the frontend can display. If missing, add to orchestration/receipt and rebalancer responses.

---

## 12. Implementation order (phases)

1. **Backend**
   - Add `GET /api/v1/zkdefi/ledger/transfers` (and optionally extend ledger_transfers with `reason`/`execution_path` for richer feed).
   - Ensure deploy/execute/rebalance responses include proof/verification status for ledger and Brain pipeline.

2. **State**
   - Add VaultStore (context or Zustand) with vault balance, ledger, allocations, session summary; wire to existing APIs and new ledger/transfers.

3. **Agent page structure**
   - Replace current 4-tab (Portfolio, Strategies, Intelligence, Analytics) with **3 surfaces**: Vault, Trade, Brain. Move Analytics into Brain and Vault as needed. Merge Portfolio content into Vault (allocation + ledger) and Trade (opportunities).

4. **Vault surface**
   - Build VaultHero, AllocationBreakdown, VaultLedger (using VaultStore + GET ledger/transfers). Deposit/Withdraw flow (existing vault deposit + demo-credit). SessionKeysSummary, RiskLimitsSummary.

5. **Trade surface**
   - Single TradeHub with token/amount context; Swap | LP | Limit | Stake as sub-tabs. Reuse SwapTab, LiquidityTab, LimitOrdersPanel, NativeStakingPanel. Add AISuggestionsInline and "Apply AI suggestion".

6. **Brain surface**
   - Strategy templates, CustomAgentBuilder with model explanations, ExecutionModeControl, ZKGatePipeline. Reuse ModelComposer, SessionKeyManager, AutomationControlPanel, BrainVisualizer, AgentRebalancer.

7. **Profile → Identity**
   - Rename or reframe as Identity; add reputation breakdown, strategy/agent reputation placeholders, selective disclosure toggles. Keep existing Profile content; ensure demo mode shows sample data for reputation/passport so the page is never empty.

8. **Demo mode**
   - Preload demo vault on first load when `?mode=demo`; seed or simulate ledger entries; ensure all four surfaces show non-empty state.

9. **Polish**
   - Remove or hide features that don't affect capital allocation. Accessibility: contrast, tooltips, keyboard nav. Confirmation modals for fund-moving actions.

---

## 13. Deliverables checklist

- [ ] Component tree redesign (Vault, Trade, Brain, Identity).
- [ ] Updated routing (max 4 top-level nav; 3 surfaces on agent).
- [ ] VaultStore and unified state.
- [ ] GET ledger/transfers and proof status in responses.
- [ ] AI decision pipeline visual (ZK gate) in Brain.
- [ ] Ledger system (VaultLedger) with what/why/proof status.
- [ ] Identity dashboard schema (reputation breakdown, selective disclosure).
- [ ] ZK proof state tracking (pipeline + ledger).
- [ ] **Session keys first-class:** SessionKeysSummary on Vault, SessionKeyControl (grant/revoke) primary in Brain; Assist/Autonomous require active session.
- [ ] **Privacy-first:** Private % in allocation; deposit routing (Public/Private/Mixed); selective disclosure in Identity with ZK explanation; no separate Privacy tab.
- [ ] Demo mode preload and simulated ledger (and demo session / Private % so both are visible).
- [ ] **Doc-backed alignment:** Session key structure and tooltips in Brain; ledger shows session ID and private/public routing; Risk Passport and reputation tier tied to gating; risk score and anomaly inline in Trade/Brain; compliance profiles in Identity; no standalone Analytics/Intelligence tab.
- [ ] No visual-only patches: rebuild flows and data flow logically.

---

## 14. References

- Mega-prompt: `docs/plans/2026-03-02-agent-profile-megaprompt-builder.md`
- Reputation/credit alignment: `docs/plans/2026-03-01-reputation-credit-system-design.md`
- Backend: `ledger_service.list_transfers`, `vault.py`, `strategies.py`, `orchestration`, `session_key_service`, `reputation.py`
- Frontend: `frontend/src/app/agent/page.tsx`, `frontend/src/app/profile/page.tsx`, `AppContext.tsx`, `PortfolioTab`, `Strategies` sub-tabs

---

## Appendix A: Doc-backed capabilities and current UI gaps

The following capabilities are documented in the codebase/docs but are only partially or poorly surfaced in the current UI. The four-surface re-architecture must make them visible and actionable.

### Session keys (Starknet account-abstraction delegation)

- **What:** Delegation of limited execution rights: owner, max position, protocol bitmap, expiry. Grant/revoke/list via API. Execution requires proofs; keys can be revoked.
- **Current UI:** Buried in Automate tab; no summary, no single place to grant/revoke.
- **Target:** SessionKeysSummary on Vault (and status in header); SessionKeyControl primary in Brain; ledger entries show session ID for scoped actions; tooltips explain delegation, constraints and proof requirement.

### Proof-gated execution

- **What:** Smart contract executes only when a valid proof attests to user-defined constraints (max position, allowed protocols). Core to MEV protection and deterministic execution.
- **Current UI:** Proof status seldom shown per action.
- **Target:** Every ledger entry shows proof status (Pending/Verified/Failed) and View Proof; execution responses include proofId, proofStatus, verifyTxHash.

### zkML models and gating

- **What:** Risk-score model: eight features (balance, concentration, diversification, volatility exposure, liquidity depth, time in position, recent drawdown, correlation); proves score below threshold without revealing score. Anomaly detector: pool safety, proves no anomaly without revealing analysis. Both produce Groth16 proofs verified on-chain.
- **Current UI:** Intelligence tab has "Brain Tiers" but relationship between models, thresholds and execution gating is opaque.
- **Target:** Brain exposes each model with inputs, output signal and "blocks execution if X". Trade/Brain show risk score and anomaly checks inline when proposing trade/LP/rebalance; show which features/factors affect pass/fail; threshold controls in Brain.

### Risk Passport

- **What:** Composite from reputation, onboarding/identity and proof receipts. Returns composite score (0–100), letter (A/B/C/D), tier, optional credit score. Used by execution control rail, Ekubo operate hub and agent rebalancer for gating.
- **Current UI:** Profile shows passport card but not tied to execution or how it affects allowed actions.
- **Target:** Identity shows passport; gating logic is explicit (e.g. manual allowed for letter B+; Assist/Autonomous may require A). When an action is blocked, show why (e.g. "Passport rating below required for this mode").

### Reputation tiers

- **What:** Strict, Standard, Express with different proof requirements, rate limits and fees. API returns tier and stats per user.
- **Current UI:** Shown in profile but not integrated into trade or automate flows.
- **Target:** Identity shows tier and implications (proof requirement, rate limits, fees); upgrade path (e.g. stake collateral) in same view. Tier visible in header; where backend gates by tier, UI explains it.

### Selective disclosure / compliance profiles

- **What:** Prove statements (e.g. yield above X, risk compliance) without revealing full strategies. GET /compliance/profiles/{address}; can feed identity dashboard.
- **Current UI:** Shown in agent disclosure tab; not unified with Identity.
- **Target:** Identity dashboard lists compliance profiles: when generated, which statement proved, proof receipt ID. Option to generate new proofs (yield threshold, risk compliance, KYC eligibility). Explain selective disclosure (prove without revealing).

### Private deposits and position aggregation

- **What:** Private deposits and aggregation hide amounts/balances on-chain.
- **Current UI:** Privacy tiers and private vs public capital share rarely highlighted.
- **Target:** Vault allocation shows Private %; deposit flow offers routing (Public/Mixed/Private); ledger shows per entry whether action used private or public routing and whether amount was hidden (private deposit). Trade can preselect private option when vault routing is private.

### Data duplication and analytics

- **What:** Analytics and Intelligence show overlapping pool stats and ML circuits; not integrated into trade suggestions or automated strategies.
- **Target:** Retire standalone Analytics tab; feed metrics into Vault, Trade and Brain. Pool health/APY/volume in LP suggestion context; risk model outputs annotate pool lists (e.g. "Anomaly risk flagged; proof required"). Simplified risk/anomaly visualisation in Brain; advanced circuit inspect optional.
