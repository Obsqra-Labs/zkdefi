# Reputation and Credit System — Deep Dive and Alignment Plan

**Date:** 2026-03-01  
**Purpose:** Research only. Align reputation/credit with current system patterns (ledger, demo, vault, execution guard, constraint gate). No code yet.

---

## 1. Current state (research summary)

### 1.1 Reputation system

| Piece | Where | What it does |
|-------|--------|----------------|
| **Storage** | `JsonStore("reputation_users")` → `backend/data/reputation_users.json` | Per-address: `tier`, `transaction_count`, `total_volume`, `first_interaction`, `successful_txns`, `collateral`. |
| **Staking** | `JsonStore("staking_positions")` → `backend/data/staking_positions.json` | Per-address, per-pool: `staked_wei`, `rewards_wei`, last accrue/stake ts. Staking adds to `user["collateral"]`. |
| **TIER_INFO** | `backend/app/api/reputation.py` | Tier 0 (Strict): 2 dep/day, 1 w/d day, 10 ETH max, no relayer, 0.5% fee. Tier 1 (Standard): 10/5, 50 ETH, relayer 1h delay, 0.3%. Tier 2 (Express): 255/255, unlimited position, relayer no delay, 0.1%. |
| **Upgrade rules** | Same file | 0→1: 30d tenure + 5 successful txns. 1→2: 180d tenure + 1 ETH collateral. |
| **Baseline** | `GET /reputation/user/{address}` | Merges in-app data with `fetch_combined_history(starknet, eth?, arb?, base?)` from `cross_chain_fetcher` + `linked_addresses_store`. tenure_days = max(in_app, chain); successful_txns = in_app + chain. |
| **Consumers** | | **Relayer:** `_get_user_tier(requester)` → sets `ready_time` (tier delay) on relay/deposit/claim queue entries. **Risk Passport:** Fetches reputation user, computes composite score 0–100 and letter A/B/C/D. **Frontend:** Profile, Agent header (tier badge). **No other backend path uses tier for gating.** |
| **record_transaction** | `POST /reputation/record-transaction` | Increments transaction_count, total_volume, successful_txns; sets first_interaction if unset. **Not called from any vault, deploy, or execute path.** So in-app reputation never grows from normal usage. |

### 1.2 Ledger and “credit” (internal accounting)

| Piece | Where | What it does |
|-------|--------|----------------|
| **Ledger** | `LedgerService` (SQLite) | `ledger_accounts` (balance_wei), `ledger_transfers` (direction, reason, **settlement_type** onchain|demo), `vault_deposits` (**is_demo**), `vault_allocations` (**is_demo**). credit_balance / debit_balance with optional settlement_type. |
| **Demo mode** | Middleware + routes | `X-Demo-Mode: true` → request.state.demo_mode. Deploy/execute/allocate branches: ledger-only, no chain; demo-credit endpoint; all ledger writes tagged demo. |
| **Internal payout** | Relayer | When `LEDGER_PAYOUT_MODE=internal`, claim execution credits ledger instead of on-chain payout. |

Ledger is the **settlement layer** (who has how much balance; demo vs onchain). It is **not** used for reputation tier, collateral, or limits.

### 1.3 Execution gating (who actually checks what)

| Gate | Uses tier? | Uses reputation volume/collateral? | Uses ledger? | Uses onboarding? |
|------|------------|-------------------------------------|--------------|------------------|
| **ExecutionGuard** | No | No | No | No. Only VaultPolicy: emergency_pause, strategy_permissions, cooldown, daily_notional, trade_notional, min_edge. |
| **ConstraintGate** | No | No | No | Yes. Onboarding state: fact_hash, identity_commitment, risk_profile, max_position_usd, session_duration; ZKML risk; vault policy session_max. |
| **PolicyCompiler** | No | No | No. Blocks `internal_ledger` for v1. | No. Resolves execution_path from privacy_policy. |
| **Relayer** | Yes (tier → delay only) | No | Yes (balance, claim payout). | No. |

So: **tier/reputation does not gate vault execute, deploy, or strategies.** Only relayer uses tier (for delay). Constraint gate uses onboarding + policy, not reputation.

### 1.4 Onboarding vs reputation

- **Onboarding:** `onboarding_state.json` (or backend store): has_agent, pending_constraints (risk_tolerance, max_position, session_duration), fact_hash, identity_commitment. Feeds ConstraintGate and Risk Passport (identity/credit).
- **Reputation:** JsonStore: tier, volume, tenure, collateral. Feeds Relayer delay, Risk Passport composite score, Profile/Agent tier display.
- **Risk Passport:** Composes both: GET reputation/user → tier, tenure, volume, collateral; GET onboarding/status + identity/commitment → credit_tier/score; composite + letter. Read-only view.

Two separate “identities”: one for **authorization and constraints** (onboarding), one for **tier and limits** (reputation). They are merged only for display (passport), not for a single gating authority.

---

## 2. Gaps vs “recent” system patterns

1. **Reputation never updated by usage**  
   Deploy, execute-allocation, vault execute, rebalance do not call `record_transaction`. So tenure and successful_txns only grow from (a) cross-chain baseline or (b) manual/other callers. Normal in-app usage does not progress tier.

2. **TIER_INFO limits are not enforced**  
   max_deposits_per_day, max_withdrawals_per_day, max_position_eth are returned to frontend and documented but **no backend path enforces them**. Relayer only uses tier for delay.

3. **Ledger and reputation are disconnected**  
   Ledger balance is not used as collateral. Vault deposits (on-chain or demo) do not auto-update reputation volume or first_interaction. So “internal accounting” and “reputation” run in parallel.

4. **Demo mode and reputation**  
   Demo flows do not call record_transaction. So paper mode does not build reputation. If we want “demo builds reputation,” we need a policy (e.g. record demo activity with a flag, or explicitly exclude demo from reputation).

5. **No single source of truth for gating**  
   ExecutionGuard (policy), ConstraintGate (onboarding + ZKML + policy), Relayer (tier for delay). No unified “user credit/reputation/ledger” view that drives all gates.

6. **Staking/collateral vs ledger**  
   Staking is JsonStore; collateral is `user["collateral"]`. Not in ledger. So “stake to unlock Express” is separate from ledger balance; no shared notion of “user’s collateral” across ledger and reputation.

---

## 3. User direction (answered)

**D (all in phases)**, with:

- **Ledger should reflect privacy** — ledger records should carry enough information to know which privacy path/pool they belong to (not just onchain vs demo).
- **Gating should be about proofed constraints** — identity, onboarding, risk bounds, ZKML; not overly restrictive for MVP; should work with gating.
- **Manual vs gated today** — we’re not gating manual in some paths; some constraints are used in others. Need to find gaps and align before changing behavior.
- **Reputation** — day-1 design; recent development doesn’t reflect it; it’s still documented in md and online docs. Align code and docs in phases.

---

## 4. Deeper dive: gaps before making the plan

### 4.1 Which paths run ConstraintGate (proofed constraints) vs not

| Backend path | ConstraintGate run? | ExecutionGuard run? | Used by (frontend) |
|--------------|--------------------|----------------------|--------------------|
| **POST /api/v1/strategies/allocate** | Yes (action=allocate). 403 if not allowed. | No | Recommendation flow |
| **POST /api/v1/strategies/execute-allocation** | Yes (action=execute). 403 if not allowed. Demo path runs gate for profile but doesn’t block on verdict. | No (vault_allocation_executor may do guard elsewhere) | VaultDashboardPanel “Deploy” (risk + deposit USD) |
| **POST /api/v1/strategies/rebalance** (get plan) | Yes (action=rebalance). 403 if not allowed. | No | Rebalancer |
| **POST /api/v1/zkdefi/orchestration/deploy** | **No** | Yes (in orchestrate_deploy → execution_guard, strategy=manual → always allowed) | **DeployToEkuboCard** (deployable amount + risk profile) |
| **POST /vault-live/execute** (vault_execute_live) | **No** | Yes (in execute_strategy_impl, strategy=manual → always allowed) | MVP page (execute-advanced) and any direct vault execute client |

So:

- **Strategies:** allocate, execute-allocation, rebalance are **gated by proofed constraints** (onboarding, identity, risk, ZKML, vault policy). Manual deploy that goes through **execute-allocation** (e.g. VaultDashboardPanel) is gated.
- **Orchestration deploy** (DeployToEkuboCard) and **vault_execute_live execute** do **not** run ConstraintGate. They only run ExecutionGuard (VaultPolicy: pause, cooldown, notional). So the main “Deploy to Ekubo” card in the agent UI is **not** proof/constraint gated — only policy (pause, cooldown, etc.) applies.

**Gap:** Two deploy entry points — one (strategies execute-allocation) is constraint-gated; one (orchestration deploy) is not. For MVP, we can either: (a) add ConstraintGate to orchestration deploy and vault_execute_live execute so all deploy paths require proofed constraints, or (b) keep manual deploy (orchestration) advisory-only for constraints (run gate, return violations in response but don’t 403) so MVP “just works” while still surfacing constraints. Option (b) matches “not too restrictive for MVP.”

### 4.2 Policy compiler: manual vs autonomous/session

- **PolicyCompilerService._gate_matrix:** `manual_wallet` + `wallet_connected` → `gate_required=False`, `advisory_only=True`. So for manual with wallet we don’t require zkML/gate; it’s advisory.
- **Autonomous / session** → `gate_required=True`, `advisory_only=False`.

So the **intent** in the compiler is: manual = advisory; autonomous/session = hard gate. Backend ConstraintGate today is **hard** (403) on strategies paths; it doesn’t distinguish manual vs session when it’s invoked. So the gap: ConstraintGate is only invoked on strategies (allocate, execute-allocation, rebalance), not on orchestration or vault_execute_live, and when it is invoked it always blocks (403). There is no “advisory-only” mode in ConstraintGate for manual.

### 4.3 Ledger and privacy

- **Today:** Ledger has `settlement_type` (onchain | demo) and `reason` (e.g. vault_deposit, demo_deploy, tier2h_claim). **No** execution_path, pool_id, or privacy path. So we cannot today “reflect privacy” in the sense of “this transfer is from Full Privacy Pool B” or “internal_ledger settlement.”
- **Policy compiler** resolves `execution_path` from privacy_policy (full_privacy_pool, shielded_pool, hashed_withdraw_pool, internal_ledger). internal_ledger is **blocked** for v1. Demo mode is a **separate** branch (X-Demo-Mode), not a privacy_policy settlement_mode.
- **Gap:** To have “ledger reflect privacy,” we’d add something like `execution_path` or `privacy_path` (or reuse `reason` with a richer enum) on ledger_transfers and optionally vault_deposits/vault_allocations so that internal payout, demo, and future internal_ledger can be distinguished and reported by path/pool.

### 4.4 Reputation: docs vs code

- **Docs:** REPUTATION_BASELINE.md, reputation-system.md (docs-site), RISK_PASSPORT_*.md describe tiers, upgrade rules, cross-chain baseline, and that tier affects relayer delay and passport score. They do **not** say that deploy/execute paths call record_transaction or enforce TIER_INFO limits.
- **Code:** Relayer uses tier for delay. No other backend path enforces tier limits or calls record_transaction. So “reputation” in code is display + relayer delay only; “reputation” in docs implies a larger role (proof requirements, limits). Aligning them means either: (1) wire usage into reputation and optionally enforce limits in a few places, or (2) narrow the docs to “tier drives relayer delay and passport score; limits are advisory until enforced.”

---

## 5. Phased plan (high level)

Aligned with **D** and “ledger reflects privacy, gating = proofed constraints, MVP not too restrictive, reputation aligned in phases.”

### Phase 1 — Ledger reflects privacy (MVP-safe)

- Add optional **execution_path** (or **privacy_path**) to ledger_transfers and, where useful, to vault_deposits/vault_allocations (e.g. values: onchain, demo, internal_claim, full_privacy, shielded, hashed_claim, internal_ledger when unblocked).
- Populate from callers: demo flows set `demo` (or keep settlement_type and add path); relayer internal payout set `internal_claim`; future internal_ledger set `internal_ledger`. No change to existing balance math; reporting and filtering can use path.
- **Out of scope for Phase 1:** Unblocking internal_ledger in policy compiler (can stay blocked for v1).

### Phase 2 — Gating: proofed constraints, consistent and MVP-friendly

- **Run ConstraintGate on all deploy/execute paths** (orchestration deploy, vault_execute_live execute) so every path sees the same proofed constraints (onboarding, identity, risk, ZKML, policy).
- **MVP behavior:** For **manual** (orchestration deploy, vault execute with manual intent): run ConstraintGate but treat result as **advisory** when user is not onboarded or violations exist — do not 403; return violations (and optionally attestation_hash) in response so UI can show “Complete onboarding for full access” or “Constraints not met” without blocking. For **autonomous/session**, keep 403 when not allowed.
- **Implementation options:** (a) Add an `advisory_only` (or `intent=manual`) parameter to ConstraintGate.check and have orchestration/vault_execute_live pass it; or (b) run gate in those routes and only 403 when `verdict.allowed is False` and request is not manual (e.g. from header or body execution_intent). Prefer (a) for clarity.
- **Result:** Manual deploy “works” without onboarding; constraints are visible and can be enforced later; autonomous/session remain fully gated.

### Phase 3 — Reputation reflects usage (and optional enforcement)

- **Wire usage into reputation:** From deploy/execute paths (orchestration deploy, execute-allocation, vault_execute_live execute, rebalance execute), after successful execution (onchain or demo), call a small helper that updates reputation (e.g. `record_transaction` or a new `record_vault_action`) with volume and success. For **demo**, policy: either (i) do not update reputation, or (ii) update with a `is_demo` flag so tier/volume can be reported separately. Recommend (i) for MVP so demo doesn’t inflate tier.
- **Optional:** Enforce TIER_INFO limits (max_deposits_per_day, max_withdrawals_per_day, max_position_eth) in one or two critical paths (e.g. execute-allocation, orchestration deploy) as a soft cap or hard cap; start soft (log + warn) then hard if desired.
- **Docs:** Update REPUTATION_BASELINE.md and reputation-system.md to state that in-app deploy/execute (non-demo) update reputation, and whether tier limits are enforced and where.

### Phase 4 — Unify and align (later)

- **Single gating view (optional):** One service or endpoint that combines onboarding status, ConstraintGate verdict, reputation tier, and ledger balance (and optionally ExecutionGuard status) for UI and for future “unified allow/deny” for autonomous/session.
- **Ledger as collateral (optional):** If we want ledger balance to count toward tier upgrade (e.g. Express), add a read from LedgerService in reputation GET and in upgrade eligibility; keep staking/collateral as-is or merge semantics in docs.

---

## 6. References

- `backend/app/api/reputation.py` — Reputation API, TIER_INFO, get_user_data, record_transaction, staking, upgrade-tier.
- `backend/app/services/ledger_service.py` — LedgerService, settlement_type, is_demo, credit/debit, vault_deposits/allocations.
- `backend/app/services/execution_guard.py` — VaultPolicy-only checks; no tier.
- `backend/app/services/constraint_gate.py` — Onboarding + ZKML + vault policy; no reputation tier.
- `backend/app/api/relayer.py` — _get_user_tier, tier delay for queue ready_time.
- `backend/app/api/risk_passport.py` — Composes reputation + onboarding + identity + receipts.
- `docs/REPUTATION_BASELINE.md` — Cross-chain baseline, linked addresses.
- `docs/INTERNAL_ACCOUNTING_NEXT.md` — Ledger, internal payout, withdraw-from-ledger scope.
- `docs-site/docs/reputation-system.md` — Public tier and API description.
- Control surface plan: `docs/plans/2026-02-19-zkdefi-control-surface.md` (deferred auth, single source of truth for execution context).
