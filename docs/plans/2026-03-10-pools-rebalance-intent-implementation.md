# Pools Rebalance Intent — Implementation Plan (Repo-Accurate V2)

**Date:** 2026-03-10  
**Goal:** Keep pool buckets truthful, add account-level rebalance mode (`user` vs `oracle`), make drawer intent-aware (pool vs vault), add composition caching, and gate oracle rebalance with zkML.

**Design doc:** `docs/plans/2026-03-10-pools-rebalance-intent-design.md`

---

## Current-repo reality (must account for this first)

1. `backend/app/api/routes/pool_composition.py` exists but is empty.
2. `backend/app/services/pool_composition_service.py` does not exist, yet is imported by:
   - `backend/app/api/routes/full_privacy.py` (`credit_pool_idle`)
   - `backend/app/services/autonomous_agent.py` (`get_composition`, `deploy_to_adapter`)
3. Frontend already passes pool context for drawer open/withdraw filtering:
   - `CapitalTab` -> `onSlideout("deposit"|"withdraw", poolId)`
   - `WithdrawPanel` already has `filterPool`
4. `ttl_cache.py` exists and is async-ready, but has no `composition_cache`.
5. Existing policy storage (`vault_policy_service`) is already the right place to store per-user execution preferences; do not introduce a second ad-hoc store for rebalance mode.

---

## Phase 0 — Restore missing pool composition backend surface

### Task 0.1: Create `pool_composition_service`

**Files:**
- Create: `backend/app/services/pool_composition_service.py`
- Modify: `backend/app/services/ttl_cache.py`

**Steps:**
1. Implement canonical helpers:
   - `credit_pool_idle(pool_id, token, amount_wei, source_account="USER_DEPOSIT", refs=None)`
   - `deploy_to_adapter(pool_id, adapter, token, amount_wei, refs=None)`
   - `close_position(pool_id, adapter, token, amount_wei, refs=None)`
   - `async get_composition(pool_id)`
2. Back composition on `DoubleEntryLedger` (`POOL:{pool_id}:idle:{token}` + deployed adapter sub-accounts).
3. Add `composition_cache = TTLCache(default_ttl=20, max_entries=100)` in `ttl_cache.py`.
4. Invalidate `composition_cache` on every write path (`credit`, `deploy`, `close`).
5. Use `market_cache` (or local cached helper) for token USD pricing inside composition.

**Commit:** `feat: add pool composition service with ledger-backed bucket accounting`

---

### Task 0.2: Implement pool composition routes

**Files:**
- Modify: `backend/app/api/routes/pool_composition.py` (currently empty)
- Test: `backend/tests/`

**Steps:**
1. Add `GET /pools/{pool_id}/composition` -> returns `get_composition(pool_id)`.
2. Add `POST /pools/{pool_id}/deploy` -> calls `deploy_to_adapter(...)`.
3. Add `POST /pools/{pool_id}/close` -> calls `close_position(...)`.
4. Validate pool ids (`conservative|moderate|aggressive`) and positive amounts.
5. Add minimal route tests (composition response shape + deploy/close updates).

**Commit:** `feat: add pool composition api routes (composition/deploy/close)`

---

## Phase 1 — Deposit to bucket correctness

### Task 1.1: Make `generate_commitment` bucket credit deterministic

**Files:**
- Modify: `backend/app/api/routes/full_privacy.py`
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx`
- Test: `backend/tests/`

**Steps:**
1. In `DepositCommitmentRequest`, add optional token field (default `STRK`) for backend attribution.
2. In frontend generate-commitment call, include token symbol from selected asset.
3. Keep pool mapping `0/1/2 -> conservative/moderate/aggressive`.
4. Replace current hardcoded `"ETH"` credit token with resolved request token.
5. Remove silent import-failure path: if bucket credit cannot run, return a clear 5xx (avoid hidden divergence between deposits and pool state).

**Commit:** `fix: align full privacy generate_commitment with pool bucket token accounting`

---

### Task 1.2: Add focused backend tests

**Files:**
- Create/modify: `backend/tests/test_pool_bucket_credit_from_commitment.py` (or nearest existing full privacy test file)

**Steps:**
1. `generate_commitment(pool_type=1, token=STRK)` should increase `POOL:moderate:idle:STRK`.
2. Verify composition endpoint reflects increased idle value.
3. Assert idempotency behavior for ledger helper (same idempotency key does not double-credit).

**Commit:** `test: generate_commitment credits pool idle bucket`

---

## Phase 2 — Rebalance mode as policy field (no parallel store)

### Task 2.1: Add `rebalance_mode` to policy model and API

**Files:**
- Modify: `backend/app/services/vault_policy_service.py`
- Modify: `backend/app/api/routes/mission_control.py` (or add small dedicated route file)
- Test: `backend/tests/`

**Steps:**
1. Add default `execution_policy.rebalance_mode = "user"` to policy defaults/backfill.
2. Add focused endpoints:
   - `GET /api/v1/zkdefi/rebalance-mode/{address}`
   - `PUT /api/v1/zkdefi/rebalance-mode/{address}` with `{"rebalance_mode":"user"|"oracle"}`
3. `PUT` requires wallet-owner auth for same address.
4. Add tests: default is `user`, set to `oracle`, set back to `user`.

**Commit:** `feat: store rebalance_mode in vault policy and expose focused api`

---

## Phase 3 — Frontend intent-aware drawer polish

### Task 3.1: Finish intent semantics (partially already wired)

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx`
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx`

**Steps:**
1. Keep existing `slideoutPool` plumbing; add title semantics:
   - Deposit + pool -> `Deposit to <Pool>`
   - Deposit + no pool -> `Fund vault`
   - Withdraw + pool -> `Withdraw from <Pool>`
   - Withdraw + no pool -> `Withdraw`
2. `DepositPanel`:
   - Add `fixedPoolId?: PoolBucket`
   - If fixed, hide `PoolSelector` and lock selected pool.
3. `WithdrawPanel`:
   - Keep `filterPool`, but filter strictly by pool when present.
   - Preserve empty copy: `No positions in the <pool> pool.`

**Commit:** `feat: finalize intent-aware drawer behavior for pool vs vault entries`

---

### Task 3.2: Rebalance mode control in UI

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/AgentControls.tsx` (preferred)
- Optional: add small hook in `frontend/src/hooks/`

**Steps:**
1. Add segmented control: `My agent` | `Oracle`.
2. On load: GET current mode.
3. On toggle: PUT mode using wallet-authenticated client (`apiFetchAuth`).
4. Show error toast/revert on failed update.

**Commit:** `feat: add rebalance mode toggle in mission control`

---

## Phase 4 — Enforce mode on deploy/close and gate oracle path with zkML

### Task 4.1: Backend authorization + gating

**Files:**
- Modify: `backend/app/api/routes/pool_composition.py`
- Modify (if needed): `backend/app/services/agent_rebalancer.py` / existing zkML gate helper
- Test: `backend/tests/`

**Steps:**
1. For deploy/close routes, resolve target user address from request.
2. Lookup `execution_policy.rebalance_mode`.
3. Enforce:
   - `user` mode: caller must be wallet owner of target address.
   - `oracle` mode: caller must be operator/admin; run zkML gate before execute.
4. Return `403` on auth/mode mismatch; no partial ledger writes on gate failure.

**Commit:** `feat: enforce rebalance_mode and zkml gate for pool deploy/close`

---

## Phase 5 — Validation and docs

### Task 5.1: Integration checks

**Files:**
- Create/modify backend tests under `backend/tests/`
- Optional frontend test under `frontend/src/__tests__/`

**Checks:**
1. Deposit flow credits correct pool/token idle bucket.
2. Drawer open from pool card locks/focuses pool context.
3. Rebalance mode matrix:
   - mode=`user`, user deploy allowed, operator denied
   - mode=`oracle`, operator deploy with zkML pass allowed, user denied

**Commit:** `test: cover pool bucket credit, intent drawer, and rebalance mode gating`

---

### Task 5.2: Docs update

**Files:**
- Modify: `README.md` (use this; `docs/DEMO_SCRIPT_3MIN.md` is currently absent)

**Update copy:**
1. “Deposit/Withdraw can be launched from pool cards (fixed pool intent) or vault actions (global intent).”
2. “Rebalance mode is account-level: My agent (`user`) vs Oracle (`oracle`).”

**Commit:** `docs: add intent-aware drawer and rebalance mode notes`

---

## Execution order

1. Task 0.1 -> Task 0.2 (unblock missing backend surface first)
2. Task 1.1 -> Task 1.2 (deposit correctness + tests)
3. Task 2.1 (mode storage/api)
4. Task 3.1 -> Task 3.2 (frontend polish + mode toggle)
5. Task 4.1 (enforcement + zkML gate)
6. Task 5.1 -> Task 5.2 (verification + docs)

---

## Notes

1. This v2 intentionally reuses existing policy infrastructure rather than introducing `rebalance_mode.json`.
2. Frontend intent wiring is not greenfield; it is a completion/polish pass.
3. Do not proceed with caching-only work until `pool_composition_service` + routes exist and are tested.
