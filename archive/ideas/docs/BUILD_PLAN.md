# Risk Passport & zkML — Build Plan

Single scoped build plan for Phase 2 and related work. Execute in order unless marked parallel.

**Phase 1 gate:** [RISK_PASSPORT_UI_CHECKLIST.md](RISK_PASSPORT_UI_CHECKLIST.md) signed off before starting Phase 2.

**Sources:** [RISK_PASSPORT_NEXT_STEPS.md](RISK_PASSPORT_NEXT_STEPS.md), [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md), [REPUTATION_BASELINE.md](REPUTATION_BASELINE.md), [RISK_PASSPORT_IMPLEMENTATION.md](RISK_PASSPORT_IMPLEMENTATION.md).

---

## Build order and dependencies

```
Phase 1 checklist ✓
       │
       ├──► 1. Snapshot binding (foundation for receipts)
       │         │
       ├──► 2. Proof timeline UX (uses receipt shape; can start after 1)
       │         │
       ├──► 3. Policy engine (v1) ──► 4. Real execution path
       │
       ├──► 5. Predictive / yield models (incremental; can overlap with 3–4)
       │
       ├──► 6. Privacy UX / concurrency
       │
       └──► 7. Linked addresses (parallel track; backend store, 8004-aligned)
```

---

## 1. Snapshot binding

**Scope:** Bind all zkML proofs and receipts to oracle snapshot so receipts are verifiable and non-repudiable.

**Acceptance criteria:**
- Oracle `GET /market-data` and `get_latest_snapshot()` expose `snapshot_hash` (already in MarketSnapshot; confirm in response).
- risk_score and anomaly flows accept optional `snapshot_hash`; when provided, include in witness/public and in `append_proof_receipt`.
- Rebalancer: when calling zkML or appending receipts, pass `snapshot_hash` from oracle; receipts show non-null `snapshot_hash` where applicable.

**Files:**
- `backend/app/services/mainnet_oracle.py` — confirm snapshot_hash in to_dict and get_latest.
- `backend/app/api/oracle.py` — MarketDataResponse.snapshot_hash.
- `backend/app/api/zkml.py` — pass snapshot_hash into risk_score and anomaly; pass to append_proof_receipt.
- `backend/app/services/zkml_risk_service.py` — optional snapshot_hash/state_hash in request and witness.
- `backend/app/services/zkml_anomaly_service.py` — optional snapshot_hash; bind in proof and receipt.
- `backend/app/services/agent_rebalancer.py` — get snapshot from oracle before check_zkml_gates; pass snapshot_hash to zkML and receipt.

**Dependencies:** None. Do first.

---

## 2. Proof timeline UX

**Scope:** One frontend component that shows proof receipts (model hash, threshold, snapshot, link); reuse on Profile and Agent/Rebalancer.

**Acceptance criteria:**
- Backend: receipts from receipt_service already have proof_type, threshold_or_model, result, timestamp, snapshot_hash, tx_hash, pool_id, etc. Expose via existing risk_passport user/pool or add GET /receipts/{address} if needed.
- Frontend: ProofTimeline (or ReceiptTimeline) component: list of receipts with type, date, model hash (truncated), threshold, snapshot (truncated), link (Starkscan or fact registry when present).
- Profile (Risk Passport card) and Agent/Rebalancer (“Why did this execute?”) use this component.

**Files:**
- `frontend/src/components/zkdefi/ProofTimeline.tsx` (new) — props: receipts[], compact?: boolean.
- `frontend/src/app/profile/page.tsx` — use ProofTimeline in Risk Passport card instead of raw list.
- `frontend/src/components/zkdefi/AgentRebalancer.tsx` — use ProofTimeline for proposal proof summary when tx_hash or receipts available.
- Backend: ensure receipt shape includes model_hash if not already (receipt_service.append_proof_receipt already has model_hash); risk_passport returns receipts.

**Dependencies:** Receipt shape stable (1 improves it). Can start once 1 is done or in parallel if receipt shape is already sufficient.

---

## 3. Policy engine (v1)

**Scope:** Backend module that, for rebalance (and optionally other actions), evaluates risk + anomaly (and later stress) and returns allowed + calldata.

**Acceptance criteria:**
- New service or module: `policy_engine.check(user_address, action_type, proposal)`.
- For action_type rebalance: load or run risk_score and anomaly (and optional pool_stress when added); if all pass, return `{ allowed: true, proof_calldata: [...], snapshot_hash }`; else `{ allowed: false, missing: [...], reason }`.
- Rebalancer calls policy_engine before execute; execute only if allowed.

**Files:**
- `backend/app/services/policy_engine.py` (new) — check(user, action, payload); calls zkML services and/or stored proofs; returns allowed + calldata.
- `backend/app/services/agent_rebalancer.py` — replace or wrap check_zkml_gates with policy_engine.check; use result for execute gate.
- `backend/app/api/rebalancer.py` — if needed, expose policy check result in proposal status.

**Dependencies:** Snapshot binding (1) recommended so policy uses bound proofs. Builds on current rebalancer flow.

---

## 4. Real execution path

**Scope:** Execute rebalance via contract or relayer with Garaga calldata; return real tx_hash.

**Acceptance criteria:**
- `execute_rebalance` (or equivalent) invokes ProofGatedYieldAgent or relayer with Garaga proof calldata (from policy_engine / proof_pipeline).
- Backend returns tx_hash when execution is submitted; frontend shows “Proof verified → execution” and Starkscan link.
- No “simulated” execution in production path; real on-chain tx.

**Files:**
- `backend/app/services/agent_rebalancer.py` — execute_rebalance: call zkdefi_agent_service or starknet client to invoke contract; capture tx_hash.
- `backend/app/services/zkdefi_agent_service.py` (or contract client) — method to submit rebalance with proofs.
- `backend/app/api/rebalancer.py` — response includes tx_hash when execution succeeds.
- Frontend: already shows “Proof verified” and Starkscan link when tx_hash present; ensure it receives tx_hash from API.

**Dependencies:** Policy engine (3) provides allowed + calldata. Relayer/contract addresses and credentials configured (ENV).

---

## 5. Predictive / yield models

**Scope:** Add zkML models incrementally: risk breach prob, drawdown, pool stress; then APY forecast, TVL drift; then IL, depeg, etc. All snapshot-bound and small circuits.

**Acceptance criteria (incremental):**
- **Risk breach (deterministic):** Service that proves “breach probability over N blocks ≤ threshold” using current risk_score + trend; bind snapshot_hash.
- **Drawdown:** Service that proves “predicted max drawdown 24h/7d ≤ X%” from volatility/snapshot; bind snapshot_hash.
- **Pool stress:** Extend anomaly or new circuit: “stress score ≤ cap”; bind snapshot_hash.
- **APY forecast:** Prove “net APY ≥ min” from oracle APY + allocation; bind snapshot_hash.
- **TVL drift:** Prove |drift| ≤ cap from snapshot history.
- Later: IL risk, depeg prob, oracle deviation (see ZKML_AND_RISK_ENGINE_IMPROVEMENTS §2–3).

**Files:**
- New: `zkml_risk_breach_service.py`, `zkml_drawdown_service.py`, `zkml_pool_stress_service.py` (or extend anomaly), `zkml_apy_service.py`; circuits as needed (small Circom or extend existing).
- `backend/app/api/zkml.py` — register new endpoints.
- `backend/app/services/proof_pipeline.py` / `agent_rebalancer.py` — call new models when policy requires.
- Oracle: snapshot history and volatility where needed.

**Dependencies:** Snapshot binding (1). Policy engine (3) can be extended to require new proof types. Implement one model at a time.

---

## 6. Privacy UX / concurrency

**Scope:** Tier badge, visibility warnings, and concurrency-safe proof generation.

**Acceptance criteria:**
- **Tier badge:** Show user tier (Strict/Standard/Express) in header or Profile; optional “What leaks” per pool/tier (from PRIVACY_TIERS.md).
- **Visibility warnings:** In withdraw/rebalance flows: “Recipient and amount may be visible on-chain” for Tier 1/2 where applicable.
- **Concurrency:** Proof generation for same (user, proposal) is serialized (lock or single worker); no double-generate; clear “Proof in progress” or 503 with retry.

**Files:**
- `frontend/src/components/zkdefi/` — TierBadge or reuse existing tier display; add visibility copy in PrivateTransferPanel / AgentRebalancer / HashedWithdrawPoolPanel.
- `frontend/src/app/profile/page.tsx`, `frontend/src/app/agent/page.tsx` — ensure tier visible.
- `backend/app/services/agent_rebalancer.py` or `proof_pipeline.py` — mutex/lock per (user, proposal_id) for check_zkml_gates + prepare; return 503 with detail if proof service busy or failed.

**Dependencies:** None blocking. Can run in parallel with 2–5.

---

## 7. Linked addresses (cross-chain baseline)

**Scope:** Backend store for linked eth/arb/base addresses (8004-aligned: commitment on-chain, mapping private); “Link addresses” UX; wire reputation and identity to use them.

**Acceptance criteria:**
- **Backend store:** Persisted store (file or DB) keyed by Starknet address: optional eth, arb, optimism, base addresses + optional proof (signatures) or “verified_at” timestamp. API: GET/PUT linked addresses for address (or part of onboarding state).
- **UX:** Optional “Link addresses” step (onboarding or Profile): user enters eth/arb/base, signs a message per chain; backend verifies and stores. No contract changes.
- **Reputation:** GET /reputation/user/{address} reads linked addresses from store; passes them into `fetch_combined_history(starknet, eth, arb, base)`; merges chain baseline (already implemented for Starknet-only; extend to pass linked).
- **Identity:** When generating credit-proof, backend can load linked addresses from store and use them in POST /identity/credit-proof (or return them to frontend for that call). Commitment formula unchanged (Poseidon of addresses); store is private.

**Files:**
- `backend/app/services/linked_addresses_store.py` (new) or extend onboarding state: get_linked(address), set_linked(address, eth?, arb?, base?, opt?), persist to file or DB.
- `backend/app/api/reputation.py` — read linked from store; call fetch_combined_history(starknet, eth, arb, base) when present.
- `backend/app/api/routes/identity.py` — optional: accept address and resolve linked from store for credit-proof flow, or document that frontend passes linked from store/UX.
- `frontend/src/` — “Link addresses” UI (form + signatures); call backend to save; show in Profile “Linked accounts” or in onboarding.
- Docs: [REPUTATION_BASELINE.md](REPUTATION_BASELINE.md) — document store and flow.

**Dependencies:** None. Can run in parallel with 1–6. Chosen approach: backend store (option 1, 8004-aligned). Starknet ID: use for .stark resolution only; linked multi-chain from our store.

---

## Checklist summary

| # | Item | Priority | Parallel? |
|---|------|-----------|-----------|
| 1 | Snapshot binding | P0 | No — do first |
| 2 | Proof timeline UX | P0 | After 1 (or with 1 if receipt shape ok) |
| 3 | Policy engine (v1) | P0 | After 1 |
| 4 | Real execution path | P0 | After 3 |
| 5 | Predictive / yield models | P1 | After 1; incremental |
| 6 | Privacy UX / concurrency | P1 | Yes |
| 7 | Linked addresses | P1 | Yes |

---

## References

- [RISK_PASSPORT_UI_CHECKLIST.md](RISK_PASSPORT_UI_CHECKLIST.md) — Phase 1 sign-off
- [RISK_PASSPORT_NEXT_STEPS.md](RISK_PASSPORT_NEXT_STEPS.md) — High-level next steps and 8004/Starknet ID notes
- [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md) — Detailed zkML, policy engine, execution, UX
- [REPUTATION_BASELINE.md](REPUTATION_BASELINE.md) — Baseline from chain; linked addresses
- [SRC_8004_ALIGNMENT.md](SRC_8004_ALIGNMENT.md) — Identity commitment and 8004 alignment
