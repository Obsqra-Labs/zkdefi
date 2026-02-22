# Risk Passport — Product Scope (Phase 1)

Scoped plan for the read-only Risk Passport from `docs/PRODUCT_PLAN.md` Phase 1. Use this to implement and test.

**Related:** [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md) — predictive/yield zkML, snapshot binding, policy engine, proof timeline, and UX. **Implemented:** [RISK_PASSPORT_IMPLEMENTATION.md](RISK_PASSPORT_IMPLEMENTATION.md) — endpoints, receipt shape, files, how to test. **Reputation baseline** (on-chain/cross-chain): [REPUTATION_BASELINE.md](REPUTATION_BASELINE.md).

---

## What’s next (prioritized)

| # | What | Scope |
|---|------|--------|
| 1 | **User passport backend** — Composite score + letter (deterministic formula), proof receipts storage (append on risk_score + rebalance), `GET /risk_passport/user/{address}` composing reputation + credit + composite + last N receipts | Risk Passport §5.1–5.3 |
| 2 | **User passport frontend** — Risk Passport block on Profile: score, letter, tier, receipts list; optional “Why did this execute?” from last receipt | Risk Passport §5.5–5.6 |
| 3 | **Pool passport backend** — Store last anomaly (and later stress) result per pool_id; `GET /risk_passport/pool/{pool_id}` (health score, safe, factors, receipts) | Risk Passport §5.4 |
| 4 | **Receipt shape** — Extend receipts with proof_type, model_hash, threshold, snapshot_hash, fact/tx link; GET receipts by user (and by pool_id for pool) | ZKML improvements §7.2 |
| 5 | **Snapshot hash** — Oracle exposes snapshot_hash; anomaly (and optionally risk) accept and bind it; store in receipts | ZKML improvements §7.1 |
| 6 | **Proof timeline UX** — Frontend component showing receipts with model hash, threshold, snapshot, link; reuse on Profile and in Agent/Rebalancer | ZKML improvements §7.2 |
| 7 | **Pool passport frontend** — Optional “Is this pool safe?” / pool passport for selected pool in allocation/rebalance | Risk Passport §5.7 |
| 8 | **Policy engine (v1)** — Backend policy_engine for rebalance (risk + anomaly; later stress); returns allowed + calldata; rebalancer uses it | ZKML improvements §7.3 |
| 9 | **Real execution path** — Execute rebalance via contract/relayer with Garaga calldata; return tx_hash; frontend “Proof verified → execution” | ZKML improvements §7.4 |
| 10 | **Predictive / yield / UX polish** — Predictive models (breach, drawdown, stress), yield (APY, TVL drift), privacy UX, concurrency/fallback | ZKML improvements §7.5–7.8 |

---

## 1. Two passports in the system (user vs pool/asset)

**Both exist.** We are not choosing one use-case — the system needs both; they serve different roles and both are first-class.

| | **User Risk Passport** | **Pool / Asset Risk Passport** |
|---|------------------------|--------------------------------|
| **Subject** | A **user** (address / identity) | A **pool** or **asset** (pool_id, protocol, pair) |
| **Answers** | Who is this user? What can they do? What have they proven? (access, relayer, compliance) | Is this pool safe? What’s the health/stress? Can I allocate here? |
| **Key** | `address` | `pool_id` or `(protocol, pair)` |
| **Inputs** | Reputation (tier, tenure, volume, collateral), identity/credit, proof receipts (risk_score, rebalance, disclosure) | Pool data (TVL, volatility, liquidity concentration, deployer age, volume anomaly, contract risk); oracle snapshot; anomaly/stress proofs |
| **Outputs** | Composite score (0–100), letter rating (A/B/C/D), tier, proof receipts | Pool health score, safety flag (anomaly safe / stress ≤ cap), factors (volatility, concentration, …), snapshot_hash, proof receipts for the pool |
| **Use-cases** | Profile “Risk Passport” block; “Why did this execute for me?”; relayer/tier gating; compliance | Rebalance gating (“only move to pools that pass”); allocation UI (“which pools are safe”); pool picker; stress/drawdown views |
| **API shape** | `GET /risk_passport/user/{address}` | `GET /risk_passport/pool/{pool_id}` (or `/asset/...`) |

**How they interact:** A rebalance (or allocation) decision uses **both**: the **user** passport (does this user have the right tier/credit/risk compliance?) and the **pool** passport (is the target pool safe and within stress/volatility bounds?). Execution gating and policy engine need to consider both subjects.

This doc scopes **Phase 1** for both: read-only endpoints, deterministic/simple scoring, and proof receipts. Sections below that say “Risk Passport” without “pool” refer to the **user** passport; pool/asset passport is called out explicitly where it differs.

---

## 2. Product vision (from plan)

**Risk Passport (one object, provable) — applies to both user and pool; instantiated per subject.**

- **User passport:** Inputs (proof-backed): credit score, liquidity health, stress resilience, concentration risk, tenure, protocol risk exposure. Outputs: composite score (0–100), letter rating, tier, proof bundle.
- **Pool passport:** Inputs: pool factors (TVL volatility, concentration, price impact, deployer age, volume anomaly, contract risk); optional stress/drawdown. Outputs: health score, safe/unsafe (or stress ≤ cap), factor summary, proof receipts for that pool.

**UX:** “Why did this execute?” (user) and “Is this pool safe?” (pool); both show model hash, thresholds, fact/snapshot links.

**Phase 1 (read-only):**
- User Profile + Risk Passport block (user); pool/asset views or allocation UI (pool).
- Deterministic scoring and time-series tracking for both.
- Proof receipts for both (even if execution gating is minimal).

---

## 3. What exists today

### 3.1 User passport (existing pieces)

| Piece | Location | Notes |
|-------|----------|--------|
| **Reputation tier** | `GET /api/v1/zkdefi/reputation/user/{address}` | tier, tier_name, transaction_count, total_volume_eth, tenure_days, successful_txns, collateral_eth, upgrade_eligible, upgrade_requirements |
| **Tier definitions** | `GET /api/v1/zkdefi/reputation/tiers` | TierInfo: proof_requirement, max_deposits_per_day, relayer_access, etc. |
| **Position** | `GET /api/v1/zkdefi/position/{address}`, `/position/aggregate/{address}` | Public + optional aggregate |
| **zkML risk score** | `POST /api/v1/zkdefi/zkml/risk_score` | Proves risk_score ≤ threshold; returns is_compliant, proof calldata, contract_risk_score |
| **zkML status** | `GET /api/v1/zkdefi/zkml/status` | risk_score_circuit_ready, anomaly_circuit_ready |
| **Profile page** | `frontend/src/app/profile/page.tsx` | Tier, collateral, upgrade, relay, agents, compliance tabs; uses reputation/user, tiers, relayer/pending, identity/commitment, compliance/profiles |

**Gaps for Phase 1:**
- No single **composite score (0–100)** or **letter rating** derived from tier + tenure + volume + collateral (or from aggregated zkML outputs).
- No **proof receipts** list (risk_score, rebalance, disclosure events with timestamp, type, threshold/model, tx or fact link).
- No dedicated **Risk Passport** API or UI section that surfaces "one object" (score + letter + tier + proof bundle).
- Portfolio Profile (zkde-managed allocations, rebalances, proof history) is partial: rebalancer has proposals/status but no unified "portfolio profile" or proof timeline.

### 3.2 Pool/asset passport (existing pieces)

| Piece | Location | Notes |
|-------|----------|--------|
| **zkML anomaly** | `POST /zkml/anomaly` | Pool safety: is_safe, anomaly_flag; 6 factors (tvl_volatility, liquidity_concentration, etc.) |
| **zkML pool-safety** | `GET /zkml/pool-safety` | Static overview (low/healthy/etc.); not keyed by pool_id |
| **Oracle snapshots** | mainnet_oracle, `GET /market-data` | JediSwap/Ekubo TVL, APY, volatility; no per-pool passport object yet |

**Gaps for pool passport:**
- No **pool-level** Risk Passport endpoint (e.g. `GET /risk_passport/pool/{pool_id}`) that returns one object: health score, safe/unsafe, factor summary, last anomaly/stress proof, snapshot_hash.
- Pool-safety is global/static; not keyed by pool_id or snapshot.
- No proof receipts **for a pool** (anomaly/stress runs stored and listable by pool_id).

---

## 3a. zkML models we can pull from (for aggregation)

We have multiple zkML models that each produce a score or pass/fail. These can be **pulled and aggregated** into the Risk Passport composite score. See `docs-site/docs/zkml-models.md`, `ZKML_MODEL_MARKETPLACE.md`, and backend services.

| Model | Service / API | Output we can store | Factors / inputs (private) |
|-------|----------------|---------------------|----------------------------|
| **Risk Score** | `zkml_risk_service.py`, `POST /zkml/risk_score` | `risk_score` (0–100), `is_compliant` | 8 features: total_balance, position_concentration, protocol_diversity, volatility_exposure, liquidity_depth, time_in_position, recent_drawdown, correlation_risk |
| **Anomaly Detector** | `zkml_anomaly_service.py`, `POST /zkml/anomaly` | `is_safe`, `anomaly_flag` (0/1) | 6 factors: tvl_volatility, liquidity_concentration, price_impact_score, deployer_age_days, volume_anomaly, contract_risk_score |
| **Correlation Risk** | `zkml_correlation_service.py` | `correlation_score` (0–100), `is_compliant` | Positions × correlation matrix (N_ASSETS=5) |
| **TWAP Position** | `zkml_twap_service.py` | `actual_twap`, `is_compliant` | 7-day daily positions → time-weighted average |
| **Safety Diversification** | `zkml_diversification_service.py` | `diversification_score` (0–100), `is_compliant` | Protocol allocations × safety_scores (N_PROTOCOLS=6: JediSwap, Ekubo, zkLend, Nostra, Haiko, Other) |
| **Credit Scoring** (RISC Zero) | Marketplace / cross-chain | Credit score (weighted) | DeFi activity 25%, protocol diversity 20%, historical behavior 30%, cross-chain presence 25% |

**Usage:**  
- **User passport:** Store result per user; aggregate into user composite (see §5.4).  
- **Pool passport:** Anomaly (and later stress) results are stored per pool_id; aggregate into pool health score and safe/unsafe.

---

## 3b. Expanded factors (from product plan and .md)

The product plan and risk-services docs describe **many more factors** we can eventually feed into scoring or proofs. Use these to scope future model inputs and composite aggregation.

**From PRODUCT_PLAN.md — Risk services catalog:**

- **Holdings and exposure:** Net worth, stablecoin ratio, leverage/LTV buffer, concentration risk (token and protocol), liquidation distance, health factor, protocol dependency score.
- **Pool health:** TVL trend, liquidity depth, volatility, utilization, oracle health and deviation risk, withdrawal delay risk (liquidity crunch).
- **Allocation health:** Drift vs target allocation, slippage vs expected, realized vs expected yield, constraint violations and frequency.
- **Stress resilience and behavior:** Max drawdown over rolling windows, time-under-stress (duration below safety thresholds), recovery time from shocks, panic ratio (sell into drawdowns), consistency/tenure (N consecutive snapshots pass).
- **Credit and behavior:** Repayment history, deleveraging speed under stress, on-time response to risk events.
- **Privacy screener:** Linkability score (address reuse, timing correlation), relayer usage and mix set size, on-chain visibility warnings.

**From PRODUCT_PLAN.md — Predictive zkML / yield-focused:**

- **Predictive risk:** Risk breach probability over N blocks, drawdown threshold in 24h/7d, pool health stress (liquidity + volatility shocks).
- **Yield-focused:** Net APY forecast, liquidity/TVL drift, utilization spikes, volatility regime shift, impermanent loss risk, depeg probability, oracle deviation risk, liquidation cascade risk, incentive decay (emissions cliff), correlation breaks across pools.

**From product vision (Risk Passport inputs):** Credit score, liquidity health, stress resilience, concentration risk, tenure, protocol risk exposure — these align with the catalog above; we can map them to existing zkML features (e.g. liquidity_depth, recent_drawdown, position_concentration, time_in_position, protocol_diversity) and to new inputs as we add them.

---

## 3c. How user Risk Passport ties to Reputation, Profile, Onboarding, and Identity

The **user** Risk Passport is one coherent object that answers: *who is this user in our system, what can they do, and what have they proven?* It must tie together what we already show on Profile and what we collect in Onboarding and Identity.

**Single user journey (how it ties together):**

| Stage | What we have | What Risk Passport uses |
|-------|----------------|-------------------------|
| **Onboarding** | Connect → Configure (max position, risk tolerance, session duration) → Claims (compliance, tenure) → **Authorize** (STARK proof → `fact_hash`, `identity_commitment`) → Review (risk disclosure) → Submit agent. | Identity commitment; fact_hash (proof of constraints); user’s stated **risk_tolerance**. Passport can show “Identity: Verified” and include onboarding proof in receipts. |
| **Identity** | Credit proof (RISC Zero, cross-chain) → tier (AAA/AA/A/B/C), score (300–850). Profile fetches via `GET /api/v1/identity/commitment/{id}`. | **Credit tier + score** — primary input to composite. Same source as Profile “Credit Score” card. Key by address (resolve commitment from onboarding status or identity cache). |
| **Reputation** | Tier (Strict/Standard/Express), tenure_days, successful_txns, total_volume_eth, collateral_eth, upgrade_eligible. Profile Overview + Collateral + Upgrade. | **Tier, tenure, volume, collateral** — already the deterministic baseline for composite. Drives relayer access and proof mode. |
| **Profile** | Overview (tier, tenure, txns, collateral), Credit Score card (identity), Tier Benefits, Upgrade, Collateral, Relayer, Agents, **Compliance** (profiles + Pool Safety). | Passport = **single GET** that aggregates the same data Profile uses, plus composite score, letter, and proof receipts. Compliance tab already shows “Risk Compliance” and “Pool Safety” (zkML) — those should appear in passport receipts. |

**Canonical key:** **Address.** `GET /api/v1/zkdefi/risk_passport/{address}`. Backend joins: reputation by address; identity/credit by address (or by commitment when we have it from onboarding/identity); proof receipts by address.

**Which factors are most helpful for this goal (priority):**

1. **Reputation (tier, tenure, volume, collateral)** — Already in use. Defines “what you can do” and behavioral signal. Keep as baseline.
2. **Identity / Credit (RISC Zero)** — Already on Profile as “Credit Score”. Should be a **primary** input to composite and letter. Unlocks “ZK-Proven” narrative and ties to onboarding (“Complete onboarding to get Credit Tier”).
3. **Risk Score (zkML)** — Proves “portfolio risk ≤ threshold”. Aligns with **onboarding risk_tolerance** and Profile **Compliance → Risk Compliance**. Storing “last risk_score compliant” in passport = “have they proven risk compliance?” Most helpful for tying passport to compliance and constraints.
4. **Anomaly / Pool Safety (zkML)** — Proves “pools I use are safe”. Profile Compliance tab already shows “Pool Safety Analysis”. Including anomaly result in passport = proof of due diligence; fits “what have they proven?”
5. **Proof receipts** — Include: `risk_score`, `rebalance`, `disclosure`, `pool_safety` (anomaly), and **onboarding/authorization** (fact_hash / STARK proof) when available. So passport tells the full story: authorization proof, then risk + pool safety + rebalances over time.
6. **Correlation, TWAP, Diversification (zkML)** — Additive for composite when we have them; less central to the “identity + reputation + compliance” narrative than Credit and Risk Score and Anomaly.

**Concrete ties:**

- **Onboarding → Passport:** When user completes onboarding we have `identity_commitment`, `fact_hash`, `risk_tolerance`. Store a receipt type `onboarding` or `authorization` with fact_hash. Optionally show “Authorized risk band” (e.g. “Risk tolerance: 50”) without revealing full constraints.
- **Identity → Passport:** Credit tier/score from identity service (by address or commitment). Composite formula should weight credit highly when present (e.g. map AAA→100, AA→85, A→70, B→55, C→40 and blend with reputation).
- **Profile → Passport:** Risk Passport block on Profile (new tab or top section) shows composite score, letter, tier, and receipts. No duplicate data entry: same APIs (reputation, identity, receipts) that Profile already uses, plus one aggregated GET.
- **Compliance → Passport:** Compliance profiles (KYC eligibility, Risk Compliance, Performance, Portfolio Aggregation) and Pool Safety (anomaly) become receipt types and/or inputs. “Risk Compliance” attestation = risk_score proof; “Pool Safety” = anomaly proof.

This ordering (reputation + credit first, then risk_score + anomaly, then receipts that include onboarding and compliance) makes the passport the **single place** that ties together onboarding, identity, reputation, and compliance for the user and for “why did this execute?”.

---

## 3. Scoped Phase 1 deliverables

### 4.1 Backend

**A. User passport: composite score and letter rating (deterministic, optionally zkML-aggregated)**  
- **Endpoint:** `GET /api/v1/zkdefi/risk_passport/{address}` or extend `GET /api/v1/zkdefi/reputation/user/{address}` with optional `?include_passport=1`.  
- **Inputs:** Same as reputation (tier, tenure_days, total_volume_eth, successful_txns, collateral_eth). **Optionally:** last stored outputs from zkML models (risk_score, correlation_score, diversification_score, anomaly is_safe → 0/100, twap is_compliant → 0/100, credit_score if available). See §3a and §4.4.  
- **Formula (v1):** Deterministic baseline: `composite = clamp(0, 100, tier*30 + min(tenure_days/10, 20) + min(total_volume_eth*2, 25) + min(collateral_eth*10, 25))`. When we have stored zkML results, use weighted aggregation (§4.4). Letter: A ≥80, B ≥60, C ≥40, D &lt;40.  
- **Output:** `composite_score` (0–100), `letter_rating` (A|B|C|D), plus existing tier/tier_name so UI can show "Risk Passport: B (72)" without changing existing reputation response shape (or add a small new response block).

**B. User proof receipts (list)**  
- **Endpoint:** `GET /api/v1/zkdefi/risk_passport/{address}/receipts` or `GET /api/v1/zkdefi/receipts/{address}`.  
- **Data:** List of proof events: `{ type, timestamp, threshold_or_model, tx_hash_or_fact_hash, result }`. Types: e.g. `risk_score`, `rebalance`, `disclosure`, `pool_safety`.  
- **Storage (v1):** In-memory list per address (or append-only file / SQLite table). When we generate a risk_score proof or rebalance executes, append one entry. No proof verification in Phase 1; just "we issued this proof at this time for this threshold."  
- **Optional:** Link to Starkscan (tx_hash) or Obsqra Fact Registry (fact_hash) when available.

**C. User Risk Passport object (single GET)**  
- **Endpoint:** `GET /api/v1/zkdefi/risk_passport/{address}`.  
- **Response:**  
  - `composite_score`, `letter_rating` (from 3.1A).  
  - `tier`, `tier_name` (from reputation).  
  - `credit_tier`, `credit_score` (from identity when available; resolve by address or via commitment from onboarding). See §3c.  
  - `proof_receipts`: last N entries (from 3.1B) or summary count + link to full receipts. Include receipt types: `risk_score`, `rebalance`, `pool_safety` (anomaly), `onboarding`/`authorization` (fact_hash) when available.  
- **Implementation:** Compose reputation + identity (credit) + new composite + receipts in one handler. Resolve identity by address (e.g. onboarding status → commitment → identity/commitment GET, or address-keyed credit cache). Keeps Phase 1 read-only; no new write flows except recording receipts when proofs are generated (rebalancer, zkML risk_score, onboarding submit; add side-effect to append receipt).

**D. Pool/asset Risk Passport object (single GET) — Phase 1**

- **Endpoint:** `GET /api/v1/zkdefi/risk_passport/pool/{pool_id}` (or `/asset/{protocol}/{pair}` if we key by asset).
- **Response:** `pool_id`, `health_score` (0–100 or derived), `safe` (boolean from last anomaly/stress), `factors` (tvl_volatility, liquidity_concentration, …), `snapshot_hash` when bound, `proof_receipts` (last N anomaly/stress runs for this pool). Optional: `stress_score`, `drawdown_24h` when we add those models.
- **Data:** From anomaly service (last result per pool_id when we store it), oracle snapshot for pool; receipts keyed by pool_id. Phase 1: can be deterministic from oracle + last anomaly result if stored; otherwise return “no passport yet” until first anomaly run for that pool.

### 4.2 Frontend

**E. User Risk Passport block on Profile**  
- **Place:** Profile page, new tab or top section "Risk Passport".  
- **Content:**  
  - Composite score (0–100) and letter rating (A/B/C/D).  
  - Tier (existing).  
  - "Proof receipts" list: type, date, threshold/model, link (tx or fact) if present.  
- **Data:** `GET /api/v1/zkdefi/risk_passport/{address}` (and optionally `/receipts` if paginated later).

**F. "Why did this execute?" (minimal)** — user side.  
- **Place:** Agent/Rebalancer success state or a single "Proof timeline" section.  
- **Content:** Last rebalance or last risk_score proof: "Executed because risk_score ≤ threshold (X). Proof: [link]."  
- **Data:** From receipts or rebalancer status; link to Starkscan if we have tx_hash.

**G. Pool passport in UI (minimal Phase 1)** — In allocation/rebalance or pool picker: show “Pool passport” for selected pool (health score, safe/unsafe, link to `GET /risk_passport/pool/{pool_id}`). Optional: “Is this pool safe?” panel with last anomaly result and snapshot.

### 4.3 Out of scope for Phase 1

- Proof verification of receipts (just display what we recorded).  
- Time-series proofs ("score ≥ threshold over last N snapshots").  
- Portfolio Profile as a separate dashboard (Phase 1 = User Profile + Risk Passport block + receipts list).  
- Execution gating changes (Phase 2).

### 4.4 Data sources and aggregation (user composite score from zkML + reputation)

**Goal:** One composite score (0–100) that can pull from **all** available zkML models and reputation, with way more factors represented over time (see §2b).

**Phase 1 approach:**
- **Baseline:** Deterministic score from reputation only (tier, tenure, volume, collateral) as in §3.1A.
- **When we have proof receipts / stored zkML outputs:** For each model type we have a last result for this address, map to a 0–100 contribution:
  - **Risk Score:** use stored `risk_score` (already 0–100) or treat `is_compliant` as 100, non-compliant as 0.
  - **Anomaly:** `is_safe` → 100, else 0 (or map anomaly_flag to a penalty).
  - **Correlation / Diversification:** use stored `*_score` (0–100) or `is_compliant` → 100/0.
  - **TWAP:** `is_compliant` → 100, else 0 (or normalize actual_twap vs threshold).
  - **Credit (RISC Zero):** use credit score if returned.
- **Weighted composite:** e.g. `composite = w_rep * reputation_score + w_risk * risk_score_norm + w_anomaly * anomaly_safe_norm + w_corr * correlation_norm + w_div * diversification_norm + w_twap * twap_norm + w_credit * credit_norm`, with weights summing to 1 and missing inputs skipped (or defaulted). Start with `w_rep` high (e.g. 0.5) and spread the rest across zkML outputs when present.
- **Letter rating:** Unchanged: A ≥80, B ≥60, C ≥40, D &lt;40.

**Later (more factors):** As we add inputs from §3b (holdings, pool health, allocation health, stress resilience, credit/behavior, privacy screener), they can feed new zkML circuits or deterministic sub-scores that are then included in the same weighted composite. The marketplace doc (`ZKML_MODEL_MARKETPLACE.md`) already describes composing agents from risk_scoring, correlation_risk, twap_position, safety_diversification, anomaly with AND/OR logic; for the **user** Risk Passport we use the same model outputs in a single numeric aggregate (weighted sum) instead of a boolean decision. For the **pool** passport, we aggregate anomaly + stress + (later) drawdown/APY into a pool health score and safe/unsafe.

---

## 5. Implementation order

1. **Backend: user composite score + letter** — Add deterministic formula; expose in `GET /risk_passport/user/{address}` (or `GET /risk_passport/{address}`).  
2. **Backend: user proof receipts** — Append-only list or table; append on risk_score proof and on rebalance execute.  
3. **Backend: GET risk_passport/user/{address}** — Compose composite, letter, tier, credit, last N receipts.  
4. **Backend: pool passport** — Store last anomaly (and later stress) result per pool_id; `GET /risk_passport/pool/{pool_id}` returns health score, safe, factors, receipts for pool.  
5. **Frontend: User Risk Passport block on Profile** — Call user passport API; show score, letter, tier, receipts list.  
6. **Frontend: "Why did this execute?"** — One line or small panel from last receipt / rebalance status.  
7. **Frontend: Pool passport in allocation/rebalance** — Optional “Is this pool safe?” / pool passport for selected pool.

---

## 6. Testing

- **Unit:** Composite score formula for known inputs (tier=1, tenure=30, volume=1, collateral=0 → expect score in [40,70] or similar; letter B or C).  
- **API:** `GET /risk_passport/{address}` returns 200, shape has composite_score, letter_rating, tier, proof_receipts (array).  
- **E2E:** Profile page shows Risk Passport section; score and letter update when reputation changes (e.g. after stake or upgrade).  
- **Receipts:** After generating a risk_score proof or executing a rebalance, GET user receipts includes new entry.  
- **Pool passport:** After running anomaly for a pool_id, GET risk_passport/pool/{pool_id} returns that pool’s passport with safe/factors.

---

## 7. Files to touch (checklist)

- **Backend:**  
  - New router or extend `reputation.py`: user composite score, letter, `GET /risk_passport/user/{address}`.  
  - New module or table: user proof receipts append + list; pool proof receipts (anomaly/stress) keyed by pool_id.  
  - Rebalancer / zkML: side-effect to append user receipt when proof generated or rebalance executed; append pool receipt when anomaly run for a pool.  
  - Pool passport: `GET /risk_passport/pool/{pool_id}`; compose from stored pool results + oracle.  
- **Frontend:**  
  - `profile/page.tsx`: User Risk Passport section/tab; fetch user risk_passport; show score, letter, receipts.  
  - Optional: Agent or Rebalancer success view: "Why: risk_score ≤ X" + link.  
  - Optional: Allocation/rebalance UI: pool passport for selected pool ("Is this pool safe?").

---

## 8. Success criteria (Phase 1)

- **User passport:** User can open Profile and see a Risk Passport block: composite score (0–100), letter rating, tier; list of proof receipts (type, date, threshold/model, link if any). One deterministic formula for composite score; letter rating derived from score.  
- **Pool passport:** Caller can GET risk_passport/pool/{pool_id} and see health score, safe/unsafe, factors, and last proof receipts for that pool (when we have run anomaly for it).  
- Both passports read-only in Phase 1; no execution gating changes.
