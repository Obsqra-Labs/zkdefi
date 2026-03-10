# Pools Rebalance Intent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire deposit into pool buckets, add account-level rebalance mode (user vs oracle), make deposit/withdraw intent-aware (from pool vs vault), cache composition for fast load, and gate oracle rebalance with zkML only.

**Design doc:** `docs/plans/2026-03-10-pools-rebalance-intent-design.md`

**Architecture:** Single ledger for pool buckets; credit_pool_idle called from generate_commitment; drawer receives intent + optional poolId; backend caches get_composition and prices; rebalance_mode stored per user.

**Tech Stack:** FastAPI, Next.js 14, double_entry_ledger, TTLCache, existing full_privacy and pool_composition APIs.

---

## Phase 1: Backend — Deposit → bucket

### Task 1: Call credit_pool_idle from generate_commitment

**Files:**
- Modify: `backend/app/api/routes/full_privacy.py` (generate_deposit_commitment handler)
- Modify: `backend/app/services/full_privacy_proof_service.py` (if commitment generation lives there; else only routes)
- Test: `backend/tests/` (add or extend test for full_privacy deposit flow)

**Step 1:** In `full_privacy.py`, in the `generate_deposit_commitment` endpoint after calling the service to get the commitment result, map `request.pool_type` (0/1/2) to pool_id (`conservative`/`moderate`/`aggressive`). Map token: use STRK for MVP (or add `token` to `DepositCommitmentRequest` if frontend sends it). Call `credit_pool_idle(pool_id, token, amount_wei, source_account="USER_DEPOSIT", refs={"user_address": request.user_address})`. Import from `app.services.pool_composition_service`. Use same `amount` as used for commitment (already in wei or convert).

**Step 2:** Ensure `DoubleEntryLedger` can debit `USER_DEPOSIT` (or a system account). If the ledger requires both dr_account and cr_account to exist, ensure there is a system account like `USER_DEPOSIT` that we debit from (or add a note in ledger that we allow one-sided credit for pool_deposit tx_type). Check `double_entry_ledger.py` for how `post_entry` handles dr_account.

**Step 3:** Add a minimal test: e.g. call generate_commitment with pool_type=1, then assert pool composition for moderate has increased idle (or call pool_balances and assert POOL:moderate:idle:STRK increased). Or test credit_pool_idle in isolation with a test ledger.

**Step 4:** Run tests. Commit: `fix: credit pool idle from generate_commitment so deposit fills bucket`

---

### Task 2: Add rebalance_mode to user state

**Files:**
- Create or modify: backend store for user preferences (e.g. `backend/app/data/rebalance_mode.json` or a table in vault_v2.db, or reuse existing user/settings API)
- Modify: `backend/app/api/routes/` — add GET/PUT for rebalance_mode (e.g. under existing user or agent router)
- Test: `backend/tests/` — test get/set rebalance_mode

**Step 1:** Define storage for `rebalance_mode` per address. Option A: JSON file keyed by address. Option B: SQLite table in vault_v2.db with columns (address, rebalance_mode). Option C: Add to existing user/session API if one exists. Choose simplest (e.g. JSON file `rebalance_mode.json` with `{"0xabc...": "user"}`).

**Step 2:** Add endpoint `GET /api/v1/zkdefi/rebalance-mode` (or under agent: `GET /api/v1/zkdefi/agent/rebalance-mode`) requiring wallet auth, returning `{"rebalance_mode": "user"|"oracle"}`. Default "user" if not set. Add `PUT /api/v1/zkdefi/rebalance-mode` body `{"rebalance_mode": "user"|"oracle"}`.

**Step 3:** Write test: set mode to oracle, get, assert oracle; set to user, get, assert user.

**Step 4:** Run tests. Commit: `feat: add rebalance_mode (user|oracle) per user`

---

## Phase 2: Backend — Caching

### Task 3: Cache pool composition

**Files:**
- Modify: `backend/app/services/pool_composition_service.py` — wrap get_composition with cache
- Modify: `backend/app/services/ttl_cache.py` — add composition_cache if not present

**Step 1:** In `ttl_cache.py` add `composition_cache = TTLCache(default_ttl=20, max_entries=100)`.

**Step 2:** In `pool_composition_service.py`, in `get_composition`, at the start check `composition_cache.get(f"composition:{pool_id}")`; if hit return it. At the end (before return), `composition_cache.set(f"composition:{pool_id}", result, ttl=20)`. Use async if TTLCache is async (it is). So: async get_composition first tries cache; on miss compute result, then cache.set, then return.

**Step 3:** Invalidate cache when deploy/close/credit happens: in `deploy_to_adapter`, `close_position`, and `credit_pool_idle` call `composition_cache.delete(f"composition:{pool_id}")` (or clear by prefix if API supports). Commit: `perf: cache pool composition 20s and invalidate on write`

---

### Task 4: Use cached prices in composition

**Files:**
- Modify: `backend/app/services/pool_composition_service.py` — _get_token_price_usd_sync to use market_cache or a shared price cache

**Step 1:** Ensure mainnet_oracle or price fetch is behind a cache (e.g. key `price:{token}`, TTL 30). If not, add a small in-memory cache in pool_composition_service for token prices with 30s TTL so repeated get_composition don’t hammer oracle.

**Step 2:** Run composition twice in a row; second should be fast. Commit: `perf: cache token prices in pool composition`

---

## Phase 3: Frontend — Intent-aware drawer

### Task 5: Drawer receives intent and poolId

**Files:**
- Modify: `frontend/src/app/agent/page.tsx` — slideout state holds intent and poolId (e.g. slideoutIntent: "deposit"|"withdraw", slideoutPoolId: string | null)
- Modify: `frontend/src/components/zkdefi/tabs/CapitalTab.tsx` — pass (intent, poolId) when opening from pool card
- Modify: `frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx` — pass (intent, poolId) through
- Modify: `frontend/src/components/zkdefi/mission-control/IdentityBadge.tsx` — when Fund/Withdraw clicked, pass intent and poolId=null

**Step 1:** In agent page, add state: `slideoutIntent: "deposit" | "withdraw" | null` and `slideoutPoolId: string | null`. When opening slideout from pool card set both (e.g. slideoutIntent="deposit", slideoutPoolId="conservative"). When opening from vault Fund/Withdraw set slideoutIntent and slideoutPoolId=null.

**Step 2:** Update openSlideout signature to accept optional intent and poolId (or derive from existing poolId for deposit/withdraw). IdentityBadge: on Fund call openSlideout("deposit", null); on Withdraw call openSlideout("withdraw", null). CapitalTab pool card: on Deposit call openSlideout("deposit", pool.id); on Withdraw openSlideout("withdraw", pool.id).

**Step 3:** Pass slideoutIntent and slideoutPoolId into DepositPanel and WithdrawPanel as props. Commit: `feat: drawer intent and poolId from pool vs vault`

---

### Task 6: DepositPanel intent-aware UI

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx` — accept initialPool and fixedPool (boolean). When fixedPool true, hide pool selector and use initialPool only. Title from parent or prop: “Deposit to [Pool]” vs “Fund vault”.

**Step 1:** Add props: `intentSource: "pool" | "vault"`, `fixedPoolId: string | null`. When intentSource=== "pool" and fixedPoolId set, do not show PoolSelector; use fixedPoolId as selected pool and set initialPool to it. When intentSource=== "vault", show PoolSelector and default initialPool to moderate or last selected.

**Step 2:** Slideout title: when fixed pool, show “Deposit to Conservative” (etc.). When vault, show “Fund vault”. Commit: `feat: DepositPanel fixed pool when intent from pool card`

---

### Task 7: WithdrawPanel intent-aware UI

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx` — already has filterPool. When opened from pool card, pass filterPool so only that pool’s commitments shown. When from vault, pass filterPool=undefined so all shown. Title: “Withdraw from [Pool]” vs “Withdraw”.

**Step 1:** Ensure WithdrawPanel receives filterPool from slideout state (slideoutPoolId). When slideoutPoolId is set, filter commitments by pool_variant === slideoutPoolId. When null, show all. Set label/title from parent: “Withdraw from Conservative” vs “Withdraw”.

**Step 2:** Verify empty state copy when filterPool set: “No positions in the [pool] pool.” Commit: `feat: WithdrawPanel filter by pool when intent from pool card`

---

### Task 8: Rebalance mode UI (account-level)

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/` or settings — add toggle or dropdown “My agent” vs “Oracle rebalances”. Call GET/PUT rebalance-mode API.
- Optional: Show current mode near Agent controls or Identity badge.

**Step 1:** Add a small control (e.g. in AgentControls or a settings strip): “Rebalance: My agent | Oracle”. On change call PUT rebalance-mode. On load call GET rebalance-mode and set local state.

**Step 2:** Commit: `feat: rebalance mode toggle (user vs oracle) in UI`

---

## Phase 4: Gate oracle deploy/close by mode and zkML

### Task 9: Backend enforce rebalance_mode on deploy/close

**Files:**
- Modify: `backend/app/api/routes/pool_composition.py` — deploy and close endpoints require either user auth (and rebalance_mode=user) or operator auth (and rebalance_mode=oracle for that user). For oracle path, require zkML check before executing.

**Step 1:** In deploy_capital and close_pool_position, resolve user_address (from session or body). Look up rebalance_mode for that user. If "user", require request to be from that user (wallet auth). If "oracle", require operator/oracle auth and run existing zkML gate before calling deploy_to_adapter/close_position. If mode is user and caller is not the user, return 403. If mode is oracle and caller is not operator, return 403.

**Step 2:** Add integration test or manual test: set user to oracle, call deploy as operator with zkML pass → 200; call deploy as user → 403. Commit: `feat: enforce rebalance_mode and zkML for oracle deploy/close`

---

## Phase 5: Tests and docs

### Task 10: Integration test and doc update

**Files:**
- Create or extend: `frontend/src/__tests__/` or `backend/tests/` — one integration test: deposit flow credits pool; drawer intent pool vs vault.
- Modify: `docs/DEMO_SCRIPT_3MIN.md` or README — mention “Deposit/Withdraw from pool or from vault” and “Rebalance: My agent vs Oracle”.

**Step 1:** Add test: generate_commitment with pool_type=1 → then GET composition for moderate → assert idle increased (or ledger pool_balances). Optional: frontend test that opening drawer from pool card passes poolId and shows fixed pool title.

**Step 2:** Update demo script or docs with one line on intent (from pool vs vault) and rebalance mode. Commit: `test: deposit credits pool; docs: intent and rebalance mode`

---

## Execution order

- Task 1 → Task 2 → Task 3 → Task 4 (backend)
- Task 5 → Task 6 → Task 7 → Task 8 (frontend)
- Task 9 (gate) → Task 10 (tests/docs)

Tasks 3–4 can run after 1–2. Tasks 6–7 depend on 5.

---

## Handoff

Plan saved to `docs/plans/2026-03-10-pools-rebalance-intent-implementation.md`.

**Two execution options:**

1. **Subagent-driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach?
