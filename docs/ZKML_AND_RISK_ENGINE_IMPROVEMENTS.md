# zkML and Risk Engine: Improvements and Proposed Modules

How to improve existing zkML/oracle/rebalancer modules and add the proposed predictive, yield-focused, and execution-gating pieces. Ties to proof timeline, policy engine, and UX.

---

## 1. Existing modules (quick map)

| Module | Location | What it does today | Proof type |
|--------|----------|--------------------|------------|
| **zkml_risk_service** | `backend/app/services/zkml_risk_service.py` | 8-feature risk score ≤ threshold; Garaga Groth16 | risk_score |
| **zkml_anomaly_service** | `backend/app/services/zkml_anomaly_service.py` | 6-factor pool safety; Garaga Groth16 | anomaly_detection |
| **zkml_correlation_service** | `backend/app/services/zkml_correlation_service.py` | Correlation score ≤ threshold (5 assets) | correlation_risk |
| **zkml_twap_service** | `backend/app/services/zkml_twap_service.py` | 7-day TWAP ≤ threshold | twap_position |
| **zkml_diversification_service** | `backend/app/services/zkml_diversification_service.py` | Diversification score ≥ threshold (6 protocols) | safety_diversification |
| **zkml API** | `backend/app/api/zkml.py` | risk_score, anomaly, combined; status; pool-safety (static) | — |
| **proof_pipeline** | `backend/app/services/proof_pipeline.py` | Composes risk + anomaly for rebalance; execution proof stub (unimplemented) | — |
| **agent_rebalancer** | `backend/app/services/agent_rebalancer.py` | Propose → check_zkml_gates (risk + anomaly) → prepare → execute (simulated) | — |
| **mainnet_oracle** | `backend/app/services/mainnet_oracle.py` | Market snapshots (JediSwap/Ekubo); TVL, APY, volatility; snapshot history | No proof |
| **compliance_service** | `backend/app/services/compliance_service.py` | Register/confirm compliance profiles (kyc, risk, performance, aggregation) | — |
| **receipt_service** | `backend/app/services/receipt_service.py` | Constraint receipts (deposit/withdraw/rebalance); no zkML type or model hash | — |

**Gaps:** No snapshot_hash binding on zkML inputs; no predictive or yield-focused models; execution proof in pipeline is unimplemented; receipts don’t include model hash/threshold/fact link; pool-safety is static; rebalancer execute doesn’t call contract.

---

## 2. Predictive zkML (risk engine) — improve existing + add

### 2.1 Bind existing models to snapshot hashes (improve)

**Constraint:** “Bind all predictions to snapshot hashes.”

- **Where:** Every zkML service that consumes market or pool data.
- **Change:**
  - **Oracle:** Already has `MarketSnapshot` with `timestamp`; add `snapshot_hash = hash(timestamp, jediswap, ekubo)` (or same schema) and expose in `GET /market-data` and `get_latest_snapshot()`.
  - **zkml_anomaly_service:** `_fetch_pool_data` should accept optional `snapshot_hash`; when provided, fetch pool metrics from a snapshot store keyed by hash (or from oracle at that timestamp). Include `snapshot_hash` in witness input and in public signals so the proof is bound to that snapshot.
  - **zkml_risk_service:** Portfolio features can be bound to a “state hash” (e.g. hash of position snapshot + block or timestamp). Add optional `state_hash` to witness/public so “risk score ≤ threshold at state_hash”.
  - **proof_pipeline / rebalancer:** When generating proofs, pass `snapshot_hash` from `oracle.get_latest_snapshot()` (or from request). Store `snapshot_hash` in receipt and in proposal.

**Files to touch:** `mainnet_oracle.py` (add snapshot_hash), `zkml_anomaly_service.py` (accept and bind snapshot_hash), `zkml_risk_service.py` (optional state_hash), `proof_pipeline.py`, `agent_rebalancer.py`, receipt storage.

### 2.2 Predict risk breach probability over N blocks (add)

- **Goal:** Prove “probability(risk breach over next N blocks) ≤ threshold” (e.g. 5%).
- **Model constraint:** Start deterministic or simple quantized; keep circuit small.
- **Approach:**
  - **Deterministic v1:** Use current risk_score + last K snapshots of risk_score (e.g. from receipt/store). Rule: “if risk_score now ≤ X and trend (linear fit or last−first) ≤ Y, then breach_prob = 0 else 1”. Circuit: prove breach_prob = 0 (or ≤ threshold if quantized).
  - **Data:** Risk scores per snapshot from existing risk model; store last N per user in backend (or pass in request). Snapshot hashes for each step.
  - **New module:** `zkml_risk_breach_service.py` — inputs: current portfolio_features, last K risk_scores (or hashes), N_blocks, threshold; output: proof that breach_prob ≤ threshold; public signals include snapshot_hash for current state.
  - **Circuit:** New small Circom (e.g. `RiskBreachProb.circom`) or extend RiskScore with optional “trend” input and one extra constraint.

### 2.3 Predict drawdown threshold 24h/7d (add)

- **Goal:** Prove “predicted max drawdown over 24h/7d ≤ X%”.
- **Model constraint:** Deterministic/simple; small circuit.
- **Approach:**
  - Use snapshot history: volatility_bps, TVL change over last 24h/7d from oracle. Simple rule: e.g. `max_dd_24h = volatility_bps * k` (k fixed); prove `max_dd_24h ≤ threshold`.
  - **New module:** `zkml_drawdown_service.py` — inputs: snapshot_hash, volatility_bps (or derived from snapshots), threshold_24h, threshold_7d; output: proof that predicted drawdown ≤ threshold; bind to snapshot_hash.
  - **Circuit:** Minimal: multiply volatility by constant, compare to threshold; public: snapshot_hash, pass/fail.

### 2.4 Predict pool health stress (liquidity + volatility shocks) (add)

- **Goal:** Prove “pool stress score (liquidity + volatility) ≤ threshold”.
- **Approach:**
  - Reuse anomaly factors (tvl_volatility, liquidity_concentration, price_impact_score) plus optional utilization from oracle. Combine into one “stress” score (e.g. weighted sum); prove ≤ threshold.
  - **Option A:** Extend `zkml_anomaly_service` with a “stress mode”: same circuit, different threshold/weights, output “stress_score ≤ cap”.
  - **Option B:** New small circuit `PoolStress.circom` — same 6 inputs as anomaly, different formula (e.g. sum of normalized factors); prove stress ≤ threshold; bind to snapshot_hash.
  - **New endpoint:** `POST /zkml/pool_stress` (or `POST /zkml/anomaly` with `mode=stress`).

---

## 3. Yield-focused predictions — add (deterministic/simple first)

All bind to snapshot_hash; circuits small (quantized if needed).

| Prediction | Data source (existing) | Model (deterministic v1) | New module / endpoint |
|------------|-------------------------|---------------------------|-------------------------|
| **Net APY forecast** | Oracle: jediswap.apy_bps, ekubo.apy_bps, incentives | weighted APY by allocation; prove ≥ min_apy | `zkml_apy_service.py`; `POST /zkml/apy_forecast` |
| **Liquidity/TVL drift** | Oracle: snapshot history TVL | drift = (TVL_now - TVL_24h_ago) / TVL_24h; prove \|drift\| ≤ cap | Use snapshot_hash; add to oracle response; circuit in anomaly or tiny new one |
| **Utilization spikes** | Oracle / pool API | utilization at t; prove utilization ≤ max_util | `zkml_utilization_service.py` or extend pool_safety |
| **Volatility regime shift** | Oracle: volatility_bps over time | e.g. volatility_bps ≤ “high” threshold → safe regime | Reuse risk or anomaly volatility input; prove regime = “normal” |
| **IL risk** | Allocation + pool fee/volatility (from oracle) | Simple IL proxy (e.g. fee * vol term); prove ≤ cap | `zkml_il_service.py` (small circuit) |
| **Depeg probability** | Oracle: stable/peg data or default 0 | Prove depeg_prob = 0 (or ≤ threshold) | Stub: 0; later add feed |
| **Oracle deviation risk** | Oracle snapshot vs chain price | Prove deviation ≤ threshold | Compare snapshot price to on-chain; small circuit |
| **Liquidation cascade risk** | LTV/health from lending (if we have it) | Prove health_factor ≥ min | Lending-specific; add when we integrate zkLend/Nostra |
| **Incentive decay** | Oracle: emissions / time | Prove emissions_at_T ≥ min (or decay ≤ cap) | Add to snapshot; simple comparison circuit |
| **Correlation breaks** | Existing correlation matrix + positions | Prove correlation_score stable (same matrix, positions within band) | Extend `zkml_correlation_service` with “stability” proof |

**Implementation order:** (1) Snapshot hash in oracle and bind in existing zkML. (2) APY forecast (uses current snapshot only). (3) TVL drift (uses snapshot history). (4) Utilization and volatility regime (extend anomaly/risk). (5) IL, depeg, oracle deviation, incentive decay as needed.

---

## 4. Model constraints (apply everywhere)

- **Deterministic or simple quantized:** All new models: formulas that can be implemented in Circom with fixed-point or small integers (no floating point). Keep weights/thresholds in circuit or as public inputs.
- **Small circuits:** Prefer one comparison per circuit (score ≤ threshold, or trend ≤ cap). Split “risk breach over N blocks” into small steps (e.g. one proof per block or one proof for “trend” only).
- **Bind to snapshot hashes:** Every proof that uses market/pool data: snapshot_hash (or state_hash) as public input; backend passes hash from oracle; store in receipt.

**Backend pattern:** For each new model, add a service in `backend/app/services/` (e.g. `zkml_apy_service.py`), register in `zkml.py` or a dedicated router, and have proof_pipeline / rebalancer call it when the policy requires it.

---

## 5. Execution and gating (on-chain enforcement)

### 5.1 Current state

- **Rebalancer:** `check_zkml_gates` runs risk + anomaly; `prepare_execution` validates session and creates `execution_proof_hash` (hash only, no Stone prover); `execute_rebalance` simulates execution (no contract call).
- **Proof pipeline:** `_generate_execution_proof` raises “not yet implemented”; no Fact Registry / Stone integration in pipeline.
- **Onboarding:** Stone prover + Fact Registry used for authorization proof; fact_hash stored and used for agent init.

### 5.2 Proof-gated rules (examples) — map to code

| Rule | Where to enforce | Current | Improvement |
|------|------------------|--------|-------------|
| **Lending: composite risk ≥ X and LTV buffer ≥ Y** | Contract (lending module) + backend | N/A | Backend: compute composite from Risk Passport + stored proofs; require risk_score + (future LTV proof); contract: verify Garaga proof + optional fact_hash. |
| **Rebalance: stress resilience ≥ Z** | agent_rebalancer + contract | Only risk + anomaly | Add stress proof (pool_stress or drawdown); rebalancer checks stress proof; contract verifies Garaga proofs. |
| **Privacy tier: relayer if privacy score ≥ threshold** | Reputation tier + relayer API | Tier 1+ gets relayer | Add “privacy score” from compliance/receipts (e.g. linkability score); gate relayer on tier AND privacy score proof if desired. |
| **Allocation: predicted APY ≥ threshold and IL risk ≤ cap** | Rebalancer + policy engine | No APY/IL gating | Add `zkml_apy_service` and `zkml_il_service`; rebalancer check: apy_forecast proof ≥ min and IL proof ≤ cap; policy engine returns “allowed” only if proofs pass. |

### 5.3 Policy engine (contract + backend)

- **Contract (existing):** ProofGatedYieldAgent, Garaga verifier(s), Fact Registry (Integrity). Contract already verifies proofs; we need to wire more proof types and rules.
- **Backend policy engine (add):**
  - **Module:** `backend/app/services/policy_engine.py` (or extend `agent_rebalancer`).
  - **Inputs:** user_address, action_type (rebalance, deposit, withdraw, relayer_request), proposal/payload.
  - **Logic:** Load rules for action_type (e.g. rebalance: risk ≤ R, anomaly safe, stress ≤ S, apy ≥ A, IL ≤ I). For each rule, determine required proof type (risk_score, anomaly, pool_stress, apy_forecast, il_risk). Fetch latest stored proofs for user (or generate on demand). If all required proofs pass, return `{ "allowed": true, "proof_calldata": [...], "snapshot_hash": "0x..." }`; else `{ "allowed": false, "missing": ["apy_forecast"], "reason": "..." }`.
  - **Verifiable receipts:** Backend returns receipt with model hashes, thresholds, snapshot_hash, fact_registry links; contract verifies Garaga proofs and optionally Fact Registry for STARK proofs.

**Flow:** User requests rebalance → rebalancer calls policy_engine.check(user, "rebalance", proposal) → policy engine runs risk, anomaly, stress, apy, IL checks (generating or reusing proofs) → if allowed, returns combined calldata + receipt → frontend/submit calls contract with calldata → contract verifies proofs and executes.

---

## 6. UX requirements for a killer app

### 6.1 Flagship flow: “Private, proof-gated yield autopilot” one click

- **Current:** User configures agent, proposes rebalance, runs check → prepare → execute (execute is simulated).
- **Improvement:** Single “Enable autopilot” that: (1) Ensures onboarding + risk disclosure done. (2) Starts autonomous agent with default policy (risk + anomaly). (3) When rebalance is proposed and proofs pass, show “Proof verified → execution happened” with tx link. (4) Backend actually calls ProofGatedYieldAgent (or relayer) so execution is on-chain; frontend shows tx_hash.

**Files:** `agent_rebalancer.execute_rebalance` → integrate with zkdefi_agent_service / contract invocation; frontend AgentRebalancer / agent page: one “Autopilot” button and post-execution “Proof verified → tx” state.

### 6.2 Proofs as UX: timeline, receipt, audit trail

- **Proof timeline:** Show model hash, thresholds, constraints, fact registry links per proof.
  - **Backend:** Receipts must include: proof_type, model_hash (circuit/version hash), threshold_or_model, snapshot_hash, fact_hash or tx_hash, timestamp. Extend `receipt_service` and any receipt appended from zkML/rebalancer/onboarding to this shape. Add `GET /risk_passport/{address}/receipts` (or reuse receipts in risk passport) with full list.
  - **Frontend:** “Proof timeline” component: list of receipts with type, date, model hash, threshold, link (Starkscan / fact registry). Reuse in Profile (Risk Passport) and in Agent/Rebalancer “Why did this execute?”.

- **Shareable receipt and audit trail:** Each receipt has a stable ID; optional public page or PDF export: “User X at time T had risk_score ≤ 30 (model hash 0x…), anomaly safe (model hash 0x…), snapshot 0x…”. Backend: `GET /receipts/{receipt_id}` (read-only, no sensitive data).

### 6.3 Privacy UX contract

- **Privacy tier badge:** “What leaks / what doesn’t” per pool/tier. Document in UI: Tier 1 = deposit/withdraw link hidden, amount/recipient visible on-chain; Tier 2 = recipient/amount in proof; Tier 3 = relayer, depositor hidden. Frontend: small badge per pool or on relayer section (from PRIVACY_TIERS.md).
- **“Private lane” toggle:** Relayer network on/off; when on, show relayer status and funding hint (already in HashedWithdrawPoolPanel).
- **Recipient/amount visibility warnings:** For Tier 1/2, explicit copy: “Recipient and amount may be visible on-chain” (e.g. in withdraw flow).
- **Relayer funding and status:** Already in place (Relayer Health, funding hint when claim_pending > 0). Keep and ensure visible on Pool D / hashed withdraw.

### 6.4 Reliability and recovery

- **Concurrency-safe proof generation:** Run proof jobs in a single worker or with a lock per (user, proposal_id) so two requests don’t double-generate. Use proof_pipeline cache (already keyed); add mutex in rebalancer for check_zkml_gates + prepare for same proposal.
- **Bulletproof root sync:** Merkle root sync already in relayer_runner and OPS_RUNBOOK; ensure one source of truth and retries; status endpoint exposes merkle_root/leaf_count.
- **Clear fallback if proof or execution fails:** (1) If proof generation fails: return 503 with detail “Proof service unavailable”; frontend shows “Try again” and optional “Use deterministic fallback” for dev. (2) If execution fails (revert or relayer down): show “Execution failed: …” with tx link if any; do not mark proposal completed; allow retry. Store failure reason in proposal/receipt.

---

## 7. Implementation order (suggested)

1. **Snapshot hash and binding** — Oracle exposes snapshot_hash; anomaly (and optionally risk) accept and bind it; receipts store snapshot_hash. (Improves existing.)
2. **Receipt shape and proof timeline** — Extend receipt_service and rebalancer/zkML to write receipts with model_hash, threshold, snapshot_hash, fact/tx link; add GET receipts by user; frontend Proof timeline component.
3. **Policy engine (v1)** — Backend policy_engine that for rebalance checks risk + anomaly (+ optional stress when added); returns allowed + calldata; rebalancer uses it.
4. **Real execution path** — Execute rebalance via contract (ProofGatedYieldAgent or relayer) with Garaga calldata; return tx_hash; frontend “Proof verified → execution” with link.
5. **Predictive models (one by one)** — Risk breach prob (deterministic trend); drawdown 24h/7d; pool stress (extend anomaly or new circuit). All snapshot-bound, small circuits.
6. **Yield-focused (incremental)** — APY forecast, TVL drift, utilization; then IL, depeg, etc. as needed.
7. **Privacy UX** — Tier badge, visibility warnings, “Private lane” toggle and relayer status (polish existing).
8. **Concurrency and fallback** — Lock/cache for proof generation; clear errors and retry path.

---

## 8. Files to touch (checklist)

| Area | Files |
|------|--------|
| Snapshot hash | `mainnet_oracle.py`, `oracle.py` (response), `zkml_anomaly_service.py`, `zkml_risk_service.py`, `proof_pipeline.py`, `agent_rebalancer.py` |
| Receipts | `receipt_service.py`, `agent_rebalancer.py` (append on proof + execute), risk_passport router (GET receipts), compliance_service (align profile types) |
| Policy engine | New `policy_engine.py`, `agent_rebalancer.py` (call policy_engine), rebalancer API |
| Execution | `agent_rebalancer.execute_rebalance`, `zkdefi_agent_service` or contract client, rebalancer API response |
| Predictive | New `zkml_risk_breach_service.py`, `zkml_drawdown_service.py`; extend anomaly or new `zkml_pool_stress_service.py`; `zkml.py` routes |
| Yield | New `zkml_apy_service.py`, etc.; oracle snapshot history usage; `zkml.py` |
| UX | Frontend: Proof timeline component, Profile Risk Passport receipts, Agent “Autopilot” + “Proof verified → tx”, privacy badge and warnings; backend: GET receipt by id |
| Reliability | Proof pipeline / rebalancer mutex or single-worker; error codes and retry messaging |

This ties predictive and yield-focused zkML to existing risk/anomaly/oracle, keeps circuits small and snapshot-bound, and connects execution gating and policy to receipts and UX.
