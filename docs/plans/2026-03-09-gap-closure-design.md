# Gap Closure — Design (All 28 Gaps)

**Date:** 2026-03-09  
**Source:** User gap analysis (Critical 1–5, High 6–13, Medium 14–22, Low 23–28).  
**Process:** Brainstorming → design → implementation plan(s).  
**Scope:** All 28 gaps are in scope; low-priority items (23–28) are designed for later phases but not deferred out of the plan.

---

## Clarifying question (before implementation)

**Scope for hackathon:** You listed ~16–20h for items 1–21. For the **critical** tier (1–5), which order do you want?

- **A)** Fix blocking infra first: admin vault (4) + STRK funding (5) so deposits and fleet work; then P2P lending (1), reputation loop (2), Groth16 (3).
- **B)** Core value first: P2P lending (1) + reputation loop (2) so lending is real end-to-end; then admin (4), STRK (5), Groth16 (3).
- **C)** Let the design recommend an order and you confirm.

Recommendation: **A** — unblock real deposits and fleet first so demos aren’t “mock hash” and “fleet dead”; then lending flow and reputation; Groth16 can remain server-side or deferred if browser toolchain is heavy.

---

## 1. Context (explored)

- **P2P lending:** `credit_lines.py` has open/borrow/repay routes; `credit_line_service` is formulaic (LTV, tier, letter). Missing: **lender–borrower matching**, **loan request/list**, and **fund** (lender commits capital to a request). So “P2P” = add request book + match + fund flow.
- **Reputation feedback:** `record_transaction_internal` already updates `transaction_count`, `total_volume`, `successful_txns` and persists; `get_user_reputation` recomputes `reputation_score` from those. Missing: **tier downgrade on default/liquidation** and/or **explicit score penalty**; optional **tier upgrade job** when `upgrade_eligible` is true.
- **Groth16:** `groth16_prover.py` exists; `dao_voting_service` raises `NotImplementedError` for witness + prove. Frontend/browser proof gen: need to locate where `NotImplementedError` is raised in browser context (e.g. WASM/snarkjs).
- **Admin account (privacy vault):** `privacy_vault_service._init_admin_account()` reads `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS` and `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY`; if unset, `admin_account` stays `None` and deposits return mock. So “never initialized” = env not set on deploy; fix = document required env + optional runtime check.
- **STRK funding:** Fleet/gas budget code exists; wallet has 0.013 STRK. Fix = operational (fund wallet or use a faucet/script).
- **Collateral health_factor:** `collateral.py` computes `health_factor = total_collateral_usd / borrowed_usd` from `get_user_positions` and lending data; if those are empty or from different stores, result can look “same for everyone”. Fix = single source of truth for positions + debt.
- **DAO voting power:** `dao_governance.get_voting_power` uses `_compute_capital_breakdown` (LP + lending + staking USD). So it’s not hardcoded $10k unless those feeds return zero/constant. Fix = ensure capital breakdown is real (same as collateral: real positions).
- **Vault positions:** Endpoint that returns “empty list always” — identify route (e.g. `/vault/status` or private_yield `get_user_positions`) and wire to real data or same store as collateral/LP.
- **Receipts / execution / nullifier:** Codebase shows `ReceiptService` and `ExecutionStore` use SQLite; `PrivacyVaultService` uses SQLite for nullifiers. If something still behaves in-memory, it’s likely a different code path (e.g. mission_control merging with in-memory list). Design: ensure all read paths use the persisted stores and document DB paths.
- **DCA / credit line terms:** DCA: 2 hardcoded entries in aggregator or config; replace with real strategies from `dca_service`. Credit terms: `credit_line_service` already uses formula (LTV_MAX, BASE_RATE_BPS, etc.); if an API returns fixed ltv=0.5/rate=0.08, that endpoint should call `compute_credit_line` and return its output.
- **Navigation:** Add app nav (header/sidebar) linking /, /agent, /trade, /profile, /marketplace so users don’t need to know URLs.
- **useVaultController / useAdapterRegistry:** Both already fetch APIs (vault/status, market/context, opportunities); fallbacks are sensible. If “hardcoded” meant “always zero”, the fix is backend (vault/status returning real allocations).
- **Rate limiting / auth / validation / pagination:** Middleware and patterns exist (rate_limiter, auth_session); apply consistently to write endpoints; add validation (Pydantic) and pagination (limit/offset) on list endpoints.
- **Dead components / branches:** Remove or archive 8 dead TradeDesk V1 components; document 3 branches and either merge or park.

---

## 2. Proposed approaches (2–3 per theme)

### Critical 1: P2P lending (request/fund/repay + matching)

- **Approach A — Minimal request book:** Add `LoanRequest` model (borrower, amount_usd, max_rate_bps, term_days); `POST /lending/requests`, `GET /lending/requests`; “match” = lender calls `POST /lending/requests/{id}/fund` with amount; backend creates loan and ties to credit line. No auction; first-come fund.
- **Approach B — Match engine:** Same request book + a background job or synchronous match step that pairs requests with available liquidity (e.g. from a “supply” pool or lender list). More moving parts.
- **Approach C — Defer P2P, keep pool lending:** Keep current pool-based borrow/repay; document “P2P matching” as phase 2. Fastest for hackathon.

**Recommendation:** A. Gives a clear “request → fund → repay” story without a full engine.

---

### Critical 2: Reputation feedback loop

- **Approach A — Tier + score on outcomes:** On repay: already calling `record_transaction_internal(success=True)`. On default/liquidation: call `record_transaction_internal(success=False)` (already done) and add **tier downgrade** when `successful_txns` / `transaction_count` drops below a threshold (e.g. tier 2 → 1 if ratio &lt; 0.9).
- **Approach B — Score only:** No tier change; introduce a “default_count” or “repayment_ratio” into `compute_reputation_score` so score drops with defaults. Simpler, less visible than tier.
- **Approach C — Explicit upgrade job:** Add a small job or endpoint “evaluate tier upgrade” that, when `upgrade_eligible` is true, sets tier to the target and persists. Reputation read path already uses stored user data.

**Recommendation:** A + C: tier downgrade on default, plus optional upgrade path when eligible.

---

### Critical 3: Groth16 proof generation

- **Approach A — Server-side only:** Run snarkjs (or equivalent) on the backend for voting/deposit proofs; frontend calls API, no browser WASM. Easiest for hackathon.
- **Approach B — Browser WASM:** Integrate snarkjs/wasm in the frontend for “proof in browser”; requires toolchain and handling NotImplementedError in the exact call path. Higher effort.
- **Approach C — Stub with structure:** Return a well-formed stub (e.g. placeholder hex) from the prover so UI and verifier calldata paths work; document “real proof gen: server or browser TBD”.

**Recommendation:** A for hackathon; B as follow-up if “trustless client-side proof” is required.

---

### Critical 4: Admin account for privacy vault

- **Approach A — Env + docs:** Document `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS` and `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` in deployment readme; add a startup log or health check that warns “Privacy vault admin not set — deposits mocked”.
- **Approach B — Optional relayer:** If admin key shouldn’t live on app server, add a small relayer service that holds the key and exposes a single “submit_deposit” endpoint; app server calls relayer. More secure, more ops.
- **Approach C — No change:** Rely on deploy checklist. Minimal.

**Recommendation:** A. Low effort, unblocks “why are deposits mock?” in production.

---

### Critical 5: STRK funding

- **Approach A — Ops only:** Document “fund the relayer/fleet wallet” and add a script (e.g. `scripts/fund_agents.py` or use existing) that checks balance and prints instructions. No code change to app.
- **Approach B — Faucet / auto-fund:** Integrate a testnet faucet or internal transfer from a treasury wallet when balance &lt; threshold. Depends on environment.
- **Approach C — Gas budget UI:** Show “STRK balance” and “Fleet status: underfunded” in UI so it’s obvious. Backend already has gas budget; frontend just displays it.

**Recommendation:** A + C: script + UI visibility.

---

### High 6–7: Collateral health_factor and DAO voting power

- **Single source of truth:** Use the same persisted stores for collateral positions and lending positions (already file-backed or SQLite). Ensure `get_user_positions` (collateral), lending `get_user_positions`, and dao `_compute_capital_breakdown` all read from these. No hardcoded 1.67 or 10000; formula stays, inputs become real.
- **Fallback:** If positions are empty, health_factor can return “no debt” (e.g. 99.0) and voting_power 0 or 1; document that.

---

### High 8: Vault positions empty

- Identify the route that returns vault/allocations (e.g. `GET /api/v1/zkdefi/vault/status`). Wire it to the same private_yield or allocation store used elsewhere. If no store exists, add a minimal one (e.g. SQLite or JsonStore) populated by deploy/execute flows.

---

### High 9–11: Receipts, execution, nullifier persistence

- **Receipts:** ReceiptService already uses SQLite (`data/receipts.db`). Confirm mission_control and any other consumers read from it; remove or migrate in-memory paths.
- **Execution:** ExecutionStore already uses SQLite (`data/executions.db`). Same: ensure all execution history reads go through it.
- **Nullifiers:** PrivacyVaultService already uses SQLite (`data/nullifiers.db`). Ensure every spend path writes and checks this DB. No in-memory nullifier store.

---

### High 12–13: DCA and credit line terms

- **DCA:** Replace hardcoded 2 entries in opportunity_aggregator (or config) with `dca_service.get_active_strategies()` (or equivalent); if that returns empty, keep a small default list for demo only.
- **Credit terms:** Any endpoint returning “ltv=0.5, rate=0.08” should call `compute_credit_line` (and optionally `compute_predictive_credit_line`) and return `credit_line.total_line_eth`, `credit_line.rate_bps`, etc.

---

### Medium 14: App navigation

- Add a global nav (header or sidebar): Home, Agent, Trade, Profile, Marketplace, Docs (if applicable). Use Next.js layout and `<Link>` so every page has the same nav. No new routes, only links.

---

### Medium 15–16: useVaultController / useAdapterRegistry

- Hooks already call APIs. If backend returns empty, fix backend (vault/status and opportunities). Optionally add a “degraded” or “no data” state in the UI when APIs return empty so it’s clear it’s not hardcoded.

---

### Medium 17–20: Rate limiting, auth, validation, pagination

- **Rate limiting:** Apply existing `rate_limiter` middleware to all write routes (or a central wrapper). Document limits.
- **Auth:** Enforce `auth_session` (or equivalent) on POST/PUT/DELETE where “user must be authenticated”. Use `X-Wallet-Address` or session and reject 401 if missing.
- **Validation:** Use Pydantic request models for all POST bodies; return 422 on invalid input.
- **Pagination:** Add `limit` (default 20, max 100) and `offset` (or `cursor`) to list endpoints; return `{ items, next_offset, total }` or equivalent.

---

### Medium 21–22: Dead components and branches

- **Dead components:** Delete or move to `_archive` the 8 listed TradeDesk V1 components (e.g. AdvisoryMode, CreditLinePanel, ExecutionPanel, etc.) if they are unused. Grep to confirm no imports.
- **Branches:** Document in a short “BRANCHES.md” or in the plan: ui-improvements (63 commits), control-surface-deferred-auth, four-surface-rearchitecture — and either “merge before hackathon” or “park and merge after”.

---

### Low 23–28: Madara L3, zkML economy, WebSocket, cross-chain reputation, session key e2e, Oracle UI

- **23 Madara L3:** Config-driven L3 RPC + chain id; optional adapter that routes reads/writes to L3 when enabled; document deployment for L3.
- **24 zkML marketplace economy:** Extend model registry / marketplace with pricing and usage recording; optional settlement (in-app or on-chain); one "buy/use model" flow.
- **25 WebSocket:** Single WS endpoint (e.g. `/ws`) with auth; backend pushes execution/receipt/oracle events; frontend subscribes for live updates on one stream.
- **26 Cross-chain reputation:** Attestation format + "export/verify for chain X"; one extra chain (e.g. L3 or testnet) as first target; reuse attestation_service and portable identity.
- **27 Session key e2e:** Complete create → delegate → execute → revoke in backend; add UI for delegate/revoke and for signing with session key (e.g. in Circuit Board or Agent).
- **28 Oracle Command Center UI:** New page/overlay that consumes existing oracle and execution APIs (gated-signals, should-execute, policy, history); no new backend for MVP.

---

## 3. Design summary (sections for approval)

**Section A — Critical (1–5)**  
- **1 P2P lending:** Add loan request model + `POST/GET /lending/requests` + `POST /lending/requests/{id}/fund`; match = first-come fund; reuse existing borrow/repay.  
- **2 Reputation:** Keep `record_transaction_internal`; add tier downgrade when default/liquidation and ratio drops below threshold; add optional “apply tier upgrade” when `upgrade_eligible`.  
- **3 Groth16:** Server-side proof gen (snarkjs or equivalent) for voting/deposit; remove or catch NotImplementedError in browser path and return 501 with message.  
- **4 Admin vault:** Document env vars; add startup warning or health field “admin_configured: bool”.  
- **5 STRK:** Docs + script to check/fund wallet; optional UI for “Fleet STRK balance” and “underfunded” state.

**Section B — High (6–13)**  
- **6–7** Single source of truth for positions/debt; collateral and dao use same stores; health_factor and voting_power computed from real data.  
- **8** Wire vault/status (or equivalent) to real allocation/position store.  
- **9–11** Ensure receipts, execution history, nullifiers all read/write SQLite only; remove in-memory code paths.  
- **12–13** DCA from dca_service; credit terms from `compute_credit_line`/predictive.

**Section C — Medium (14–22)**  
- **14** Global app nav (header/sidebar) linking main pages.  
- **15–16** Backend fix for vault/status and opportunities so hooks show real data; optional “empty” state in UI.  
- **17–20** Rate limiting on writes; auth on writes; Pydantic validation; pagination on list endpoints.  
- **21** Remove 8 dead TradeDesk components after confirming no imports.  
- **22** Document 3 branches and merge or park.


**Section D — Low / planned (23–28) — in scope**

- **23 Madara L3 appchain:** Define integration surface: RPC endpoint config, chain id, and any L3-specific contracts (e.g. bridge or L3 vault). Add env/config for Madara RPC and a small adapter or router that can target L3 when enabled. Implementation plan: config + optional L3 client; deploy/execute can target L2 or L3 based on flag.
- **24 zkML marketplace economy:** Design: model listing, pricing (e.g. pay-per-proof or stake), and settlement. Add marketplace API (list models, get price, record usage); optional on-chain or ledger-based payment flow. Implementation plan: extend existing model registry / marketplace routes with economy fields and a minimal “usage → payment” path.
- **25 WebSocket real-time updates:** Design: WebSocket endpoint (e.g. `/ws`) for live stream (execution status, receipts, oracle signals, price ticks). Backend: integrate with existing event sources (execution_store, receipt_service, oracle) and broadcast on change. Frontend: optional hook or component that subscribes and updates UI. Implementation plan: WS server (e.g. FastAPI WebSocket), auth by query/header, and one canonical “stream” channel to start.
- **26 Cross-chain portable reputation:** Design: reputation attestation that can be consumed on another chain (e.g. attestation format + optional bridge or L3). Reuse or extend `attestation_service` and portable identity; add “export for chain X” or “verify on chain X” endpoint. Implementation plan: define attestation payload and verifier interface per chain; one additional chain (e.g. L3 or testnet) as first target.
- **27 Session key delegation e2e flow:** Design: full flow from “create session key” → “delegate to agent/relayer” → “execute with session key” → “revoke”. Backend: session_key_service already exists; add or wire endpoints for create/delegate/revoke and enforce session-key auth on execute. Frontend: UI for delegate/revoke and for signing with session key. Implementation plan: complete backend e2e (create, use, revoke) and one frontend path (e.g. Circuit Board or Agent settings).
- **28 Oracle Command Center standalone UI:** Design: dedicated UI (page or overlay) for oracle state: gated signals, should-execute results, policy, and recent execution decisions. Reuse existing API (oracle_gating, execution_policy_service, execution history). Implementation plan: new route (e.g. `/oracle` or `/command-center`) and components that consume existing oracle/execution endpoints; no new backend APIs required for MVP.

---

## 4. Next step

Once you confirm:
- **Order for critical items** (A vs B vs C from the clarifying question), and  
- **Approval of sections A–D** (and any edits),

the next step is to invoke **writing-plans** to produce a concrete implementation plan (bite-sized tasks, files, tests, commits) for the full scope (1–28). The plan can be phased: e.g. Critical + High + Medium (1–22) first, then Low (23–28), or interleaved by dependency.

---

## 5. Codebase notes (for implementers)

- **ReceiptService:** `backend/app/services/receipt_service.py` — SQLite at `data/receipts.db`.  
- **ExecutionStore:** `backend/app/db/execution_store.py` — SQLite at `data/executions.db`.  
- **Nullifiers:** `PrivacyVaultService._init_nullifier_db()` — SQLite at `data/nullifiers.db`.  
- **Reputation:** `record_transaction_internal` and `get_user_data` / `_persist_user` in `backend/app/api/reputation.py`; tier in `TIER_INFO`, score from `compute_reputation_score`.  
- **Credit line:** `backend/app/services/credit_line_service.py` — `compute_credit_line`, `compute_predictive_credit_line`; used by risk_profile, attestation, profile_decision_service.  
- **Collateral:** `backend/app/services/collateral_service.py` — `get_user_positions` from JsonStore `collateral_positions`.  
- **DAO voting power:** `backend/app/api/routes/dao_governance.py` — `_compute_capital_breakdown` uses LP, lending, staking positions.  
- **Privacy vault admin:** `backend/app/services/privacy_vault_service.py` — `_init_admin_account()` from env; deposits use `self.admin_account` when set.
