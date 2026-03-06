# What’s Left — Four-Surface Re-architecture

**As of 2026-03-02.** Reference: `docs/plans/2026-03-02-refined-builder-directive.md`, `docs/plans/2026-03-02-agent-profile-rearchitecture-implementation.md`.

---

## Done

- **Backend:** `GET /api/v1/zkdefi/ledger/transfers`; `POST demo-credit` (unchanged).
- **State:** VaultStore (ledger, session keys, allocation, setEffectiveAddress, invalidate); wired in layout.
- **Routing:** Vault | Trade | Brain | Identity (Profile); no Analytics/Intelligence tabs.
- **Vault surface:** VaultHero, SessionKeysSummary, AllocationBreakdown, VaultLedger; session status in header; allocation clickable → Trade.
- **Trade surface:** TradingHub with persistent token/amount and Swap | LP | Limit | Stake (Swap uses DexPanel; LP/Limit/Stake placeholders).
- **Brain surface:** Strategy templates (4 cards), Session key block primary, BrainVisualizer, AgentRebalancer, How it works, ZK Gate Pipeline, ModelComposer, MyAgents.
- **Identity (Profile):** Passport gating copy added (“manual B+; Assist/Autonomous may require A”; “when blocked, show why”).
- **Demo mode:** Preload via `POST demo-credit` when `?mode=demo`; allocation shows 30% Private; vault invalidate after credit.
- **Build in main repo:** All of the above lives in the main tree (not worktree); `npm run build` / `npm run dev` in `frontend/` runs from there.

---

## Remaining (by priority)

### 1. Backend — proof and ledger fields

- **Execution/orchestration responses:** Include `proofId`, `proofStatus`, `verifyTxHash` so Brain pipeline and Vault ledger can show real status.
- **Ledger response:** Add optional `proof_status`, `session_id`, `routing` (public/private) per transfer when backend has them.
- **Vault balance:** VaultStore currently does not fetch `vaultBalanceWei` from an API (relies on position/context). Add or wire `GET /api/v1/zkdefi/vault/status` (or equivalent) if you want Vault hero balance from backend.

### 2. Vault

- **Deposit flow with routing:** Let user choose **Public | Private | Mixed** at deposit time (directive: privacy-first; no separate Privacy tab).
- **Ledger:** Replace “Proof: —” with real proof status when backend returns it; add “View proof” handler; show **session ID** and **routing** per entry when available.
- **Wallet balance in hero:** Populate `walletBalanceWei` (e.g. from wallet or a small API) so VaultHero isn’t “0” for wallet.
- **Risk limits:** Surface `riskLimits` (e.g. RiskLimitsSummary) if VaultStore/backend provide them.

### 3. Trade

- **AI suggestion engine:** For selected pair: suggested LP range, limit price, staking %; “Apply AI suggestion” that pre-fills form (use recommend/analyze-live or equivalent).
- **Risk and proof inline:** On swap/LP/rebalance proposal, show risk score and anomaly checks inline; which of the eight features/factors affect pass/fail; annotate pools with e.g. “Anomaly risk flagged; proof required”.
- **Private preselection:** When Vault deposit routing is Private, preselect private-pool option in Swap/LP where available.
- **LP / Limit / Stake:** Replace placeholders with real panels (reuse LiquidityTab, LimitOrdersPanel, NativeStakingPanel or equivalents) inside TradingHub with shared token/amount context.

### 4. Brain

- **Strategy template → VaultStore:** On template click, apply configuration to VaultStore (e.g. allocation presets or risk params), not just UI.
- **ZK Gate Pipeline live status:** Drive pipeline step (e.g. “Proof Generated”) from backend execution/receipt state; show animation when AI runs.
- **Model details per directive:** Each model (RiskScore, CorrelationRisk, VolatilityGuard, TWAP, Diversification, CreditWeighting) shows: input params, output signal, effect on execution gating, “This model blocks execution if X”. Risk-score: eight features; anomaly: pool safety. Add threshold controls in Brain.
- **Session key tooltips:** Inline tooltips or modals explaining constraints and “proofs still required for execution”.

### 5. Identity (Profile)

- **Reputation breakdown:** Show formula or factor list (address age, strategy performance, risk discipline, liquidation history, vault tenure).
- **Strategy reputation:** Per strategy: APY, volatility, risk score, adoption % (or “Coming soon”).
- **Agent reputation:** Per agent: ROI, proof compliance %, failure rate (from receipts/orchestration if available).
- **Selective disclosure toggles:** Reveal KYC tier | capital band | risk tier | stay private; each with short ZK explanation (“Prove a fact without revealing raw data”).
- **Compliance profiles:** List from API with when generated, statement proved, proof receipt ID; option to generate new proofs (yield threshold, risk compliance, KYC eligibility).

### 6. Demo mode

- **Simulate AI rebalances / proof-verified events:** Seed or simulate ledger entries (e.g. “AI allocation”, “Rebalance”, “ZK proof verified”) for demo address so ledger isn’t empty after first credit.
- **At least one active session:** Either seed a demo session or keep “Grant session key in Brain” very visible so session keys are obviously part of the flow.

### 7. Polish

- **Block Assist/Autonomous without session:** In Brain (and optionally Vault), if user picks Assist/Autonomous and no active session, block execution and show “Grant session key” CTA.
- **Remove or hide** features that don’t affect capital allocation (per directive).
- **Accessibility:** Contrast, tooltips, keyboard nav; confirmation modals for fund-moving actions.

---

## Quick reference

| Area        | Done | Left |
|------------|------|------|
| Ledger API | GET transfers, demo-credit | proof_status, session_id, routing in response |
| Execution  | — | proofId, proofStatus, verifyTxHash in responses |
| VaultStore | ledger, sessions, allocation, invalidate | vaultBalance from API, walletBalance, riskLimits |
| Vault UI   | Hero, SessionKeysSummary, Allocation, Ledger | Deposit routing (Public/Private/Mixed), real proof/session/routing in ledger |
| Trade UI   | TradingHub, Swap, placeholders for LP/Limit/Stake | AI suggestions, risk inline, real LP/Limit/Stake panels, private preselection |
| Brain UI   | Templates, session block, pipeline, models list | Template→store, pipeline live status, per-model details + thresholds, tooltips |
| Identity   | Passport gating copy, existing Profile | Reputation breakdown, strategy/agent reputation, disclosure toggles, compliance list |
| Demo       | Preload credit, Private % in allocation | Simulated ledger entries, visible session flow |

---

**To run the app:** From repo root, `cd frontend && npm run dev`. If port 3001 is in use, the app may already be running — open http://localhost:3001 (or the port in `package.json`).
