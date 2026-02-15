# Build impact deep dive, UI optimizations, and next steps

After implementing BUILD_PLAN items 1–7, this doc summarizes **what was impacted**, **how data flows**, **UI optimization ideas**, and **suggested next work**.

---

## 1. Impact map: what we changed and who uses it

### Snapshot binding (Build 1)

| Layer | File(s) | Change | Callers / downstream |
|-------|---------|--------|----------------------|
| Oracle | `mainnet_oracle.py` | `MarketSnapshot` already had `snapshot_hash` in `to_dict()`; no code change | `oracle.py` GET /market-data, /pool-apys; zkml `_resolve_snapshot_hash()` |
| zkML API | `zkml.py` | Optional `snapshot_hash` on Risk/Anomaly/Combined requests; `_resolve_snapshot_hash()` from oracle when omitted; pass to services and `append_proof_receipt` with `model_hash` | Frontend (optional); rebalancer (indirect via policy) |
| Risk service | `zkml_risk_service.py` | `generate_risk_proof(..., snapshot_hash=None)` | zkml.py, policy_engine.py |
| Anomaly service | `zkml_anomaly_service.py` | `analyze_pool_safety(..., snapshot_hash=None)` | zkml.py, policy_engine.py |
| Receipts | `receipt_service.py` | Already had `snapshot_hash`, `model_hash` in `append_proof_receipt` | All proof flows; risk_passport GET user → proof_receipts; ProofTimeline |
| Rebalancer | `agent_rebalancer.py` | Get oracle snapshot in check; set `proposal.snapshot_hash`; pass to policy + receipts; include in `to_dict()` | rebalancer API, frontend proposals, ProofTimeline |

**Data flow:** User/agent triggers proof or rebalance → oracle `get_latest_snapshot()` (or request `snapshot_hash`) → zkML proofs and receipts carry `snapshot_hash` + `model_hash` → Risk Passport and ProofTimeline show them.

### Proof timeline (Build 2)

| Layer | File(s) | Change | Callers |
|-------|---------|--------|---------|
| Frontend | `ProofTimeline.tsx` | New component: receipts list with type, result, threshold, model hash, snapshot (truncated), date, Starkscan link | Profile (Risk Passport card), AgentRebalancer (“Why did this execute?”) |
| Profile | `profile/page.tsx` | Use `<ProofTimeline receipts={passport.proof_receipts} />` instead of raw list | User viewing Profile |
| Agent | `AgentRebalancer.tsx` | Build synthetic receipts from proposal.risk_proof, anomaly_proof, tx_hash, snapshot_hash; render ProofTimeline | User viewing proposal details |

**Impact:** Receipt shape is already returned by risk_passport and rebalancer; no backend change for timeline beyond existing receipt fields.

### Policy engine (Build 3)

| Layer | File(s) | Change | Callers |
|-------|---------|--------|---------|
| New | `policy_engine.py` | `check(user_address, action_type, payload)`; for `rebalance` runs risk + anomaly, returns allowed, proof_calldata, snapshot_hash, risk_result, anomaly_result | agent_rebalancer.check_zkml_gates |
| Rebalancer | `agent_rebalancer.py` | `check_zkml_gates` delegates to `policy_check(...)`, maps result onto proposal, appends receipts | rebalancer API POST /check |

**Impact:** Single place for “can this rebalance proceed”; future actions (e.g. deposit gates) can reuse `policy_engine.check` with different `action_type`.

### Real execution path (Build 4)

| Layer | File(s) | Change | Callers |
|-------|---------|--------|---------|
| Agent service | `zkdefi_agent_service.py` | `submit_rebalance(protocol_id, amount, zkml_risk_calldata, zkml_anomaly_calldata, execution_proof_hash, intent_commitment)`; when `PROOF_GATED_AGENT_ADDRESS` + `REBALANCER_SIGNER_*` set, invokes `execute_with_proofs` via starknet_py; returns `tx_hash` or error | agent_rebalancer.execute_rebalance |
| Rebalancer | `agent_rebalancer.py` | `execute_rebalance` calls `submit_rebalance` first; uses returned `tx_hash` or falls back to simulated | rebalancer API POST /execute |

**Impact:** Frontend already shows Starkscan when `tx_hash` present; no frontend change. ENV: `REBALANCER_SIGNER_PRIVATE_KEY`, `REBALANCER_SIGNER_ADDRESS`.

### Privacy UX & concurrency (Build 6)

| Layer | File(s) | Change | Callers |
|-------|---------|--------|---------|
| Frontend | `TierBadge.tsx` | New: tier label (Strict/Standard/Express), optional visibility hint | AgentRebalancer header |
| Frontend | `AgentRebalancer.tsx` | `userTier` prop; TierBadge; visibility copy before Execute when tier ≥ 1 | agent/page passes userTier |
| Backend | `agent_rebalancer.py` | Per-proposal lock; `check_zkml_gates` and `prepare_execution` acquire with timeout 0; raise RuntimeError when busy | rebalancer API returns 503 on RuntimeError |

**Impact:** Duplicate “Run zkML” or “Prepare” on same proposal now gets 503 with “retry later”; frontend could show toast and retry.

### Linked addresses (Build 7)

| Layer | File(s) | Change | Callers |
|-------|---------|--------|---------|
| New | `linked_addresses_store.py` | `get_linked(starknet)`, `set_linked(starknet, eth?, arb?, base?, opt?)`; persist to `data/linked_addresses.json` | reputation.py, linked_addresses API |
| API | `linked_addresses.py` | GET `/{address}`, PUT body `starknet_address`, `eth`, `arb`, `base`, `opt` | Profile “Link addresses” UI (new) |
| Reputation | `reputation.py` | `get_user_reputation` loads `get_linked(address)`, passes to `fetch_combined_history(starknet, eth, arb, base)` | GET /reputation/user/{address}, Risk Passport composite |

**Impact:** Credit/reputation baseline can now aggregate ETH/Arb/Base when user has linked addresses; identity credit-proof can later use same store.

---

## 2. Critical paths (trace for debugging)

- **Proof receipt end-to-end:** User runs zkML or rebalance → `zkml.py` or `policy_engine` → `append_proof_receipt(snapshot_hash=, model_hash=)` → `receipt_service._receipts` / `_user_receipts` → `risk_passport` GET user → `proof_receipts` → Profile ProofTimeline.
- **Rebalance execution:** Propose → POST /check (policy_engine, proposal.snapshot_hash set) → POST /prepare (lock, session, execution_proof_hash) → POST /execute (submit_rebalance or simulated tx_hash) → receipt with tx_hash → frontend shows Starkscan.
- **Reputation baseline:** GET /reputation/user/{address} → get_linked(address) → fetch_combined_history(starknet, eth, arb, base) → merge tenure/tx_count into response.

---

## 3. UI optimizations (concrete)

- **ProofTimeline:**  
  - Add “Copy receipt ID” or “Copy snapshot hash” for power users.  
  - In compact mode, consider a single line: “Risk · compliant, Pool · safe, Rebalance · completed — 7 Feb — Starkscan”.  
  - Lazy-load or virtualize if we ever show 50+ receipts.

- **Profile:**  
  - Risk Passport: show “Last proof” timestamp and snapshot hash (truncated) in the card header.  
  - Linked addresses: after adding the card, add a small “Why link?” tooltip (better credit baseline across chains).

- **Agent rebalancer:**  
  - On 503 “Proof in progress”, show toast + auto-retry after 2–3 s instead of only failing.  
  - Tier badge: optional “What leaks” expandable per tier (reuse TIER_VISIBILITY).  
  - Proposal list: show snapshot_hash (truncated) in the proposal row when available.

- **Global:**  
  - Shared “Explorer link” component (Starkscan tx/contract) used by ProofTimeline, AgentRebalancer, OnboardingWizard.  
  - Loading states: skeleton for ProofTimeline while passport loads; same for linked addresses card.

---

## 4. Suggested next steps (priority order)

1. ~~**Link addresses UI**~~ – Done. Profile card: GET/PUT linked_addresses; form (eth/arb/base/opt); reputation and credit-proof use the store.
2. ~~**Tests**~~ – Done. pytest: linked_addresses GET/PUT (test_risk_passport_api); rebalancer check returns 503 when lock held (test_rebalancer); policy_engine.check return shape (test_policy_engine).
3. ~~**Identity wire**~~ – Done. credit-proof loads linked from store when only Starknet is sent; fills eth/arb/base/opt from get_linked(starknet).
4. ~~**Predictive models (Build 5)**~~ – Done. Real pool stress in policy_engine: `_check_pool_stress(pool_id, snapshot_hash, snapshot)` uses oracle snapshot (volatility_bps); stress_ok False when max_vol >= 500 bps. Garaga calldata validation: submit_rebalance validates calldata shape and felt252 bounds before execute_with_proofs.
5. ~~**Real execution hardening**~~ – execute_rebalance sets proposal.error and returns execution_error when submit_rebalance returns error; frontend can show “Execution failed: …”.
6. ~~**Docs**~~ – RISK_PASSPORT_NEXT_STEPS updated with Link addresses UI line; BUILD_IMPACT_AND_NEXT Section 4 updated; REPUTATION_BASELINE end-to-end linked-address flow; Phase 1 checklist signed off.
7. ~~**Profile refactor (phase 1)**~~ – Profile hooks (useProfileReputation, useOnboardingStatus, useRiskPassport, useLinkedAddresses); ProfileJourneyBanner + ProfileProtocolStatus; Profile/Agent `?tab=` deep links; Compliance link to disclosure; pool safety copy + link. See PROFILE_REFACTOR_PLAN.md.

---

## 5. Files touched (reference)

- Backend: `mainnet_oracle.py`, `oracle.py`, `zkml.py`, `zkml_risk_service.py`, `zkml_anomaly_service.py`, `receipt_service.py` (existing params), `agent_rebalancer.py`, `policy_engine.py` (new), `zkdefi_agent_service.py`, `rebalancer.py`, `reputation.py`, `linked_addresses_store.py` (new), `linked_addresses.py` (new), `main.py`.
- Frontend: `ProofTimeline.tsx` (new), `TierBadge.tsx` (new), `profile/page.tsx`, `AgentRebalancer.tsx`, `agent/page.tsx`, `useProfile.ts` (hooks), `ProfileJourneyBanner.tsx`, `ProfileProtocolStatus.tsx`.
- Docs: `REPUTATION_BASELINE.md`, `ENV.md`, `BUILD_IMPACT_AND_NEXT.md` (this file).
