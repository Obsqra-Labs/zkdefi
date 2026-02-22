# Relayer, Pool D, UI/UX — Where We Stand & Scoped Updates

*Status vs `docs/PRODUCT_PLAN.md` and `docs/PRODUCT_PLAN_PRIVACY_UPDATES.md`. Use this to begin working.*

---

## 1. PRODUCT_PLAN: What’s in scope

### Relayer (Tier 2/3)
- **Build checklist (done):** Relayer queue persistence (JSON), state lock, runner (env-gated), RPC compatibility (starkli fallback), ledger persistence + audit API.
- **Plan says:** "Relayer is partially production-ready: JSON persistence + optional runner, but no durable DB queue, worker scaling, or hardened key management."
- **Privacy updates doc:** Relayer runner loads `relayer_state.json` only at process start; new API requests are not picked up until runner restarts → **production blocker**. Fix: reload state each poll or watch file mtime and call `_load_state()`.

### Pool D (Tier-2H)
- **Build checklist (done):** Tier-2H spec, circuit + verifier, verifier contract, claim entrypoint (hash-only), escrow contract, ledger service (SQLite + `/relayer/ledger/*`), relayer payout pipeline, **Pool D (Tier-2H) UI lane + warnings**.
- **Plan says:** "Pool D (Tier-2H) is live as a separate pool: hash-only claims + escrow payout." Phase 4: "Deploy Tier-2H as Pool D … UI offers a tiered privacy selector with explicit trust trade-offs."
- **Privacy updates doc:** "Tier 2H UX polish: claim creation, escrow funding, payout status."

### UI/UX (Privacy)
- **Build checklist (done):** Tier badge + relayer eligibility in Pool C, relayer request IDs + status polling in success state, backend error mapping (403, 503, invalid proof), withdraw amount ≤ deposited + max hint, post-deploy smoke checklist for `/privacy` (actually: pools live on `/agent`).
- **Plan “Privacy UX contract”:** Privacy tier badge ("what leaks / what doesn’t"), "Private lane" toggle (relayer), explicit recipient/amount visibility warnings for Tier 1/2, clear relayer funding and status for Tier 3.
- **Note:** `/privacy` in the app is the **Privacy Policy** page (legal text). Pools (B/C, D, Shielded) live on **`/agent`** (Dashboard tab + pool tabs).

---

## 2. Where we stand (implementation)

### Relayer — backend
| Item | Status | Location |
|------|--------|----------|
| Request/deposit/claim API | Done | `backend/app/api/relayer.py` |
| JSON state + lock | Done | relayer_state.json, re-entrant lock |
| Runner (Tier-2 withdraw, Tier-3 deposit, Tier-2H payout) | Done, env-gated | `backend/app/services/relayer_runner.py` |
| Runner **state reload** | **Done** | Runner calls `relayer_api.reload_state()` at start of each `process_once()` poll |
| Ledger API (claims, events, balance, transfers) | Done | `/relayer/ledger/*` |
| DB-backed queue / worker scaling | Not done | Still JSON; single process |

### Pool D (Tier-2H) — backend
| Item | Status | Location |
|------|--------|----------|
| Claim-request API + proof | Done | `relayer.py`: claim-request, claim-request/{id}, calldata, execute |
| Ledger persistence (SQLite) | Done | `backend/app/services/ledger_service.py` |
| Payout pipeline (ConfidentialTransfer private_deposit) | Done | Relayer runner + ledger |

### Pool D (Tier-2H) — frontend
| Item | Status | Location |
|------|--------|----------|
| Pool D tab on `/agent` | Done | `agent/page.tsx` → `HashedWithdrawPoolPanel` |
| Deposit / Claim flow | Done | `HashedWithdrawPoolPanel.tsx`: deposit steps, claim steps, proof, submit |
| Tier-2H trust warning | Done | Amber box: "recipient/amount never on-chain; relayer must honor claims" |
| Ledger audit block | Done | "Ledger audit" section: list claims, status, claim_tx, payout_tx, refresh |
| Escrow funding UX | **Minimal** | No dedicated "fund escrow" or "relayer balance" in Pool D panel |
| Payout status clarity | **Partial** | Ledger shows status + tx links; no "pending payout" vs "funding needed" copy |
| Pool D discoverability | **Partial** | One of four tabs (Shielded, Full Privacy, Pool C, Pool D); no tiered selector that explains B/C vs D |

### Relayer — frontend (Pool B/C)
| Item | Status | Location |
|------|--------|----------|
| Tier badge (relayer access) | Done | FullPrivacyPoolPanel: tierInfo.relayer_access, "Relayer Locked" vs delay label |
| Relayer toggle + destination | Done | "Use relayer" checkbox, recipient field when relayer |
| Request ID + status polling | Done | relayerRequestId, depositRelayRequestId, poll `/relayer/request/{id}`, success state copy |
| Relayer funding hint (Tier 3) | Done | "Send X ETH to relayer to fund. Relayer will submit on-chain when funded." |
| **Relayer Health** panel | **Missing** | PRODUCT_PLAN_PRIVACY_UPDATES: "Relayer Health panel (queue depth, failures, last tx)" |

### Privacy UX (plan vs current)
| Plan requirement | Status |
|------------------|--------|
| Privacy tier badge "what leaks / what doesn’t" | Partial: Tier badge exists; no explicit "what leaks" per pool |
| "Private lane" toggle (relayer) | Done in Pool B/C |
| Explicit recipient/amount visibility warnings Tier 1/2 | Partial: Pool D has trust warning; Pool B/C could add "amount/recipient visible on-chain" |
| Clear relayer funding and status for Tier 3 | Done: funding hint + request ID + polling |

---

## 3. Scoped updates (so we can begin working)

### Priority 1 — Relayer runner state reload (done)
- **Goal:** New relayer requests (Tier-2, Tier-3, Tier-2H claim) created via API are picked up by the runner without restart.
- **Scope:** In `relayer_runner.py`, at the start of each `process_once()` poll, `relayer_api.reload_state()` is called, so new API requests are picked up without restart.
- **Files:** `zkdefi/backend/app/services/relayer_runner.py`
- **Acceptance:** Create a Tier-2 request via API, leave runner running; request is executed within next poll cycle without restart.

### Priority 2 — Pool D UX polish (product plan + privacy updates)
- **Goal:** Clearer claim → escrow → payout flow and status.
- **Scope (pick one or more):**
  1. **Payout status copy:** In Pool D ledger section, distinguish "pending" (claim submitted, waiting for relayer) vs "executed" (payout tx done) vs "funding_required" (if backend ever returns it). Use short labels and optional tooltip.
  2. **Escrow/relayer funding:** If relayer needs to be funded for payouts: add a small "Relayer balance" or "Escrow status" line (call `/relayer/stats` or a small backend endpoint if needed) so users know payouts can complete.
  3. **Pool D vs B/C selector:** On `/agent`, add one sentence under the pool tabs: e.g. "Pool B/C: note unlinkability; amount/recipient on-chain. Pool D: hash-only claim; payout via escrow (trust)." Optional: link to `zkdefi/docs/BLOG_ESCALATING_PRIVACY_TIERS.md`.
- **Files:** `zkdefi/frontend/src/components/zkdefi/HashedWithdrawPoolPanel.tsx`, optionally `zkdefi/frontend/src/app/agent/page.tsx`

### Priority 3 — Relayer Health panel (product plan)
- **Goal:** Operators and power users see queue depth, failures, last tx.
- **Scope:** New small panel or section (e.g. on `/agent` below pool tabs, or in a "Relayer" tab): call `GET /api/v1/zkdefi/relayer/stats` and show queue depth, last executed tx hash, last error (if backend exposes it). Read-only.
- **Files:** `zkdefi/frontend/src/app/agent/page.tsx` or new `zkdefi/frontend/src/components/zkdefi/RelayerHealthPanel.tsx`; backend may need to extend `/relayer/stats` (see `backend/app/api/relayer.py`).

### Priority 4 — Internal accounting (no longer “later”)

Internal accounting is **partly done**: when `LEDGER_PAYOUT_MODE=internal`, claim payout credits the recipient’s ledger balance (no on-chain transfer). What’s missing: **show ledger balance in Pool D** and **withdraw-from-ledger** (API + UI so users can pull balance into a shielded commitment).

- **Goal:** Visibility + withdraw so internal accounting is usable, not deferred.
- **Scope:** See [INTERNAL_ACCOUNTING_NEXT.md](INTERNAL_ACCOUNTING_NEXT.md): (1) Pool D shows ledger balance; (2) POST /relayer/ledger/withdraw (debit + one ConfidentialTransfer.private_deposit); (3) Pool D “Withdraw from ledger” flow; (4) docs/env for internal mode.
- **Files:** `HashedWithdrawPoolPanel.tsx`, `backend/app/api/relayer.py`, ENV.md.

### Priority 5 — PRODUCT_PLAN.md / PRODUCT_PLAN_PRIVACY_UPDATES.md sync
- **Goal:** Product plan reflects current state and remaining work.
- **Scope:** Merge PRODUCT_PLAN_PRIVACY_UPDATES into PRODUCT_PLAN: mark Tier 2/3 as implemented with caveats; add Tier-2H as "implemented (trust-minimized)"; add relayer runner state reload and Tier-2H UX polish to Phase 4 / checklist; add testing tx hashes from privacy updates doc.
- **Files:** `docs/PRODUCT_PLAN.md` (parent repo)

---

## 4. Quick reference

| System | Backend | Frontend |
|--------|---------|----------|
| **Relayer** | `api/relayer.py`, `services/relayer_runner.py` | FullPrivacyPoolPanel (tier, toggle, request ID, polling); **no Relayer Health panel** |
| **Pool D** | Same relayer + ledger; claim-request + execute | HashedWithdrawPoolPanel (deposit, claim, ledger audit, trust warning) |
| **Ledger** | `services/ledger_service.py`, `/relayer/ledger/*`, `POST /relayer/ledger/withdraw` | Pool D "Ledger audit" + ledger balance + "Withdraw from ledger" |

**Env (Pool D):** `NEXT_PUBLIC_HASHED_WITHDRAW_POOL_ADDRESS`, `TIER2H_ESCROW_ADDRESS`; relayer runner: `RELAYER_RUNNER_ENABLED`, funded relayer account. Internal accounting: `LEDGER_PAYOUT_MODE=onchain|internal` (see [ENV.md](ENV.md)).

**Docs:** `zkdefi/docs/PRIVACY_TIERS.md`, `zkdefi/docs/BLOG_ESCALATING_PRIVACY_TIERS.md`, `docs/PRODUCT_PLAN.md`, `docs/PRODUCT_PLAN_PRIVACY_UPDATES.md`. Internal accounting (ledger balance + withdraw-from-ledger) is implemented; see [ENV.md](ENV.md) for `LEDGER_PAYOUT_MODE`. Who pays and how to unstuck pending ledger/claim items: [LEDGER_WHO_PAYS_AND_UNSTUCK.md](LEDGER_WHO_PAYS_AND_UNSTUCK.md).

---

## 5. Relayer funding: self-fund vs user-fund

### Who funds what

| Flow | Who funds | How |
|------|-----------|-----|
| **Tier 2 (relayed withdraw)** | Operator (self-fund) | Relayer account pays gas. Set `RELAYER_ADDRESS` + `RELAYER_PRIVATE_KEY` (or starkli account); fund that address with ETH/STRK for gas. |
| **Tier 3 (relayed deposit)** | **User** (user-fund) | User creates deposit-request; user **sends the deposit amount** to the relayer address; relayer then submits `deposit_u256` (relayer is tx signer, tokens move from relayer → pool). So the user funds the relayer for that specific deposit. |
| **Pool D (Tier-2H payout)** | Operator (self-fund) | Escrow contract pays via `payout_claim_u256`, or relayer calls `ConfidentialTransfer.private_deposit_u256`. Escrow/relayer must hold the tokens; operator pre-funds escrow or relayer. |

### What was added (so user can fund Tier 3)

- **Backend:** `GET /api/v1/zkdefi/relayer/stats` now returns `relayer_address` (hex) when `RELAYER_ADDRESS` is set. Also returns `deposit_pending` and `claim_pending` counts.
- **Frontend (Pool C):** After a Tier 3 deposit request is submitted, the success step shows “Send X ETH to relayer (user-funded):” with the relayer address (copyable) and a Starkscan link. Address is loaded from `/relayer/stats` on mount.

### How to test

1. **Relayer address in API:** `curl -s http://localhost:8003/api/v1/zkdefi/relayer/stats` → should include `relayer_address` when `RELAYER_ADDRESS` is set in backend env.
2. **Tier 3 deposit (user-fund):** In Pool C, create a deposit request (generate commitment → submit deposit-request). Success screen should show “Send X ETH to 0x... (relayer)” with copy and Starkscan link. User sends that amount to the relayer address; once relayer has funds, runner will submit `deposit_u256` on next poll.
3. **E2E:** `python3 tests/e2e_test_suite.py` (from repo root; backend and env must be set). Relayer/Pool D tests require `RELAYER_RUNNER_ENABLED`, contract addresses, and optionally a funded relayer account for on-chain execution.
 and optionally a funded relayer account for on-chain execution.
