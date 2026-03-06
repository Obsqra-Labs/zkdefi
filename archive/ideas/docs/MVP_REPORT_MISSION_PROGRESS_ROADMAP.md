# /mvp Deep Dive: Mission, Current Progress & Roadmap

**Report date:** February 7, 2026  
**Scope:** zkde.fi MVP page (`/mvp`), backend APIs it uses, and the broader Autonomous AI Yield Vault spec.

---

## 1. Mission

### What /mvp is for

The **MVP** is the **Autonomous AI-Driven Yield Vault** entry point: users deposit tokens and an AI allocates capital across yield strategies with **verifiable decision proofs**.

**Core mission (from spec):**

- **User deposits** generic token (STRK/ETH) → **Risk engine** scores preferences → **AI/zkML** recommends allocation → **Execute** to Nostra (deposits), zkLend (deposits), Ekubo (LP) → **Track yield** and **audit trail** tied to decision hashes and proofs.

**Two target flows:**

1. **Deposit strategy (safe yield)**  
   Conservative risk → mostly Nostra/zkLend deposits (e.g. 80% deposits, 20% LP) → predictable 4–8% APY → optional rebalance.

2. **LP strategy (higher yield)**  
   Moderate risk → meaningful Ekubo LP (e.g. 40% deposits, 60% LP) → 8–15% APY → autonomous rebalancing when drift/fees cross thresholds.

**Differentiator:** Every allocation and rebalance is tied to an **AI decision hash** and **proof** (Stone/zkML + Garaga for privacy), so yield is **verifiable AI** — “here’s the decision, here’s the proof.”

---

## 2. Current Progress

### What’s live on `/mvp` today

The **live** `/mvp` page is a **narrow slice**: **proof-gated autonomous LP on Ekubo** (Phase 1), not yet the full vault (deposit + multi-protocol allocation + pie chart + yield dashboard + audit trail).

| Area | Status | Notes |
|------|--------|------|
| **UI** | ✅ Live | Single page: Connect → Create Position → Manage → History |
| **Connect** | ✅ | Starknet wallet (Argent/Braavos), Sepolia |
| **Create position** | ✅ | Calls backend, then `deposit_with_proof` on-chain |
| **Manage** | ✅ | Lists positions via `/api/v1/zkdefi/position/{address}` |
| **Rebalance** | ✅ | Propose via `/api/v1/zkdefi/rebalancer/propose`, history via `/proposals/{address}` |
| **Backend** | ✅ | phase4a `POST /lp-position/create`, zkdefi position + rebalancer routes |

**APIs the /mvp page actually uses:**

- `POST /api/v1/phase4a/lp-position/create` — prepare LP position (user_address, position_size, garaga_proof).
- `GET /api/v1/zkdefi/position/{address}` — list user positions.
- `POST /api/v1/zkdefi/rebalancer/propose` — propose rebalance (user_address, position_id).
- `GET /api/v1/zkdefi/rebalancer/proposals/{address}` — rebalance history.

On-chain: user signs **ProofGatedYieldAgent** (or equivalent) `deposit_with_proof(protocol_id, amount, proof_hash)`.

**What the current /mvp does *not* yet do (vs full spec):**

- No **deposit card** with risk profile (1–10) and “Deposit & Let AI Allocate”.
- No **allocation display** (pie chart: Nostra / zkLend / Ekubo).
- No **yield dashboard** (total earned, by protocol, by decision).
- No **audit trail** UI (decision hash, proof link, “View Proof”).
- No **Nostra/zkLend** in this flow — only Ekubo LP path is exposed.
- No **SmartYieldVault** / **RiskProfileManager** / **YieldTracker** contracts in the live flow (they’re in the 6-week spec).

So: **mission** = full autonomous vault with verifiable AI; **current progress** = Phase 1 “proof-gated LP + rebalancer” with a working Connect → Create → Manage → History UX.

---

## 3. Roadmap

### 3.1 Spec roadmap (6 weeks) — from `MVP_AUTONOMOUS_VAULT_SYSTEM.md` / `IMPLEMENTATION_ROADMAP_6WEEKS.md`

| Week | Focus | Deliverables |
|------|--------|----------------|
| **1** | Foundation & risk engine | SmartYieldVault, RiskProfileManager, YieldTracker (Cairo); RiskProfileEngine + pool_metrics (backend); tests |
| **2** | AI allocation & proofs | AIAllocationEngine (risk → allocation weights); pool_analyzer for Ekubo; proof_generator (Stone); verifiable decision format |
| **3** | Deposit & LP execution | deposit_executor (Nostra, zkLend); ekubo_lp_executor; position tracking |
| **4** | Yield tracking & audit | yield_collector; record_yield on-chain; audit DB; APIs: yield-breakdown, ai-decision, audit |
| **5** | Rebalancing & frontend | Rebalance triggers (time, volatility, yield, manual); rebalance executor; **full MVP UI**: deposit card, allocation pie, yield dashboard, audit trail |
| **6** | Integration & launch | E2E tests; proof verification API; docs; demo |

### 3.2 Phase 1 (already built) — from `MVP_IMPLEMENTATION_PHASE_1.md`

- **Backend:** EkuboYieldService, ZkmlProofService, AutonomousRebalancer, PerformanceTracker; phase4a LP create; zkdefi position + rebalancer routes.
- **Contracts:** ProofGatedLpAgent (create_lp_position_with_proofs, rebalance_position_with_proof, record_fee_accrual), ConfidentialLpPosition (optional amount-hiding).
- **Frontend:** `/mvp` = Connect → Create Position → Manage → History (current page).

### 3.3 Gaps between Phase 1 and 6-week spec

- **Contracts:** SmartYieldVault, RiskProfileManager, YieldTracker not yet in the live path (spec only).
- **APIs:** No `/vault/deposit`, `/vault/create-lp`, `/vault/yield-breakdown`, `/vault/rebalance`, `/vault/ai-decision` yet; MVP uses phase4a + zkdefi only.
- **UI:** No risk slider, no allocation pie, no yield dashboard, no audit trail with decision hashes and proof links.
- **Protocols:** Only Ekubo LP in the live flow; Nostra/zkLend are in the spec.

### 3.4 Post-MVP (from spec + Phase 1 doc)

- **Phase 2:** Advanced AI (volatility models, arbitrage detection, user learning, portfolio optimization).
- **Phase 3:** Full automation (24/7 rebalancing, risk-aware sizing, dynamic Ekubo concentration, multi-chain).
- **Phase 4:** AI marketplace (strategies, proof verification as a service).

---

## 4. Summary Table

| Dimension | Mission (target) | Current progress | Roadmap |
|-----------|------------------|------------------|--------|
| **Mission** | Autonomous vault: deposit → AI allocation → multi-protocol yield + verifiable proofs | Proof-gated Ekubo LP only: connect, create, manage, rebalance history | 6-week spec + Phase 2–4 |
| **User flow** | Deposit + risk → see allocation → yield + audit | Connect wallet → Create LP position → Manage positions → Rebalance history | Week 5: full vault UI |
| **Protocols** | Nostra, zkLend, Ekubo | Ekubo (via phase4a + ProofGatedYieldAgent) | Week 3: Nostra/zkLend + Ekubo |
| **Proofs** | Stone (zkML) + Garaga (privacy) on every decision | Garaga placeholder in LP create; rebalancer proposals | Week 2: proof_generator; Week 6: verify API |
| **Contracts** | SmartYieldVault, RiskProfileManager, YieldTracker | ProofGatedLpAgent (deposit_with_proof, rebalance) | Week 1: vault contracts |

---

## 5. What Carries Over vs What’s Missing (Streamlined MVP)

### 5.1 Carry over (current zkde.fi stack → streamlined MVP)

| Layer | What exists | How it helps the MVP |
|-------|-------------|------------------------|
| **Backend APIs** | `/api/v1/phase4a/lp-position/create` | LP creation prep + calldata for Ekubo; reuse for vault “LP leg”. |
| | `/api/v1/zkdefi/position/{address}` | User positions; reuse for vault “current allocation” and Manage. |
| | `/api/v1/zkdefi/rebalancer/propose`, `/proposals/{address}` | Propose rebalance + history; reuse for vault rebalance flow. |
| | `/api/v1/vault/*` (autonomous_vault.py) | **Route shapes only:** `/deposit`, `/yield-breakdown/{user}`, `/ai-decision/{hash}`, `/audit/{user}`, `/rebalance`. Request/response models and URL design are done; all helpers are stubs. |
| **Backend services** | `EkuboYieldService`, `ZkmlProofService`, `AutonomousRebalancer`, `PerformanceTracker` | LP creation, risk/proof generation, rebalance loop, APY/Sharpe/drawdown. Wire into vault allocation + rebalance. |
| | `proof_pipeline`, `groth16_prover`, `garaga_formatter` | Garaga (privacy) proof generation; reuse for confidential amounts in vault. |
| | `session_key_service` | Delegation for autonomous rebalance; reuse for vault. |
| | `audit_trail_service` | Rebalance decisions + model version; extend for allocation decisions and yield events, or plug vault audit into it. |
| | `obsqra_prover_client` | Stone/zkML integration; reuse for allocation proof generation once model exists. |
| **Contracts** | `proof_gated_yield_agent.cairo` | `deposit_with_proof(protocol_id, amount, proof_hash)`; reuse for vault “deposit + proof” execution (Ekubo leg today). |
| | `smart_yield_vault.cairo` | **Exists.** Deposit/allocation/yield/rebalance storage + events; needs deploy + backend calls to `record_*`. |
| | `garaga_verifier` | Groth16 verification on-chain; reuse for privacy proofs in vault. |
| **Frontend** | `/mvp` page | Connect → Create Position → Manage → History; reuse Connect + Manage + History; add Deposit card + Allocation + Yield + Audit, or make vault the primary flow. |
| | Starknet provider, wallet connect | Reuse for vault deposit and any on-chain signing. |

So: **phase4a LP create, zkdefi position/rebalancer, vault route shapes, Ekubo/proof/session-key/audit services, proof_gated_yield_agent, smart_yield_vault.cairo, and current /mvp UX** all carry over. The gap is **wiring and net-new pieces** below.

---

### 5.2 Missing (to reach the streamlined MVP)

| Gap | What’s missing | Notes |
|-----|----------------|--------|
| **Vault API implementation** | All helpers in `autonomous_vault.py` are `pass` stubs. | Implement: `_fetch_pool_metrics`, `_run_ai_allocation_model`, `_generate_allocation_proof`, `_execute_allocation`, `_record_allocation_on_chain`, `_fetch_yield_events`, `_fetch_ai_decision`, `_fetch_yields_for_decision`, `_fetch_user_decisions`, `_fetch_rebalance_history`, `_get_user_allocation`, `_get_user_profile`, `_execute_rebalance`, `_record_rebalance_on_chain`, `_calculate_actual_apy`, `_compare_actual_vs_expected`. Wire to existing services + DB. |
| **Nostra / zkLend execution** | No deposit_with_proof execution path to Nostra or zkLend. | Only Ekubo LP (phase4a) is implemented. Add deposit executors (or adapters) that call Nostra/zkLend with proof; reuse same proof-gating pattern as `proof_gated_yield_agent`. |
| **SmartYieldVault (and friends) on-chain** | Contract exists; not deployed/called. | Deploy `SmartYieldVault`; optionally RiskProfileManager, YieldTracker. Backend must call them to record allocation, yield, rebalance (e.g. `_record_allocation_on_chain`, `_record_rebalance_on_chain`). |
| **Allocation model + proof** | No AI allocation model that outputs Nostra/zkLend/Ekubo weights. | `ZkmlProofService` does LP risk/rebalance; add (or reuse) an “allocation engine” that, given risk + pool_metrics, returns nostra_pct / zklend_pct / ekubo_pct and feeds Stone proof generation. |
| **Pool metrics (real)** | `_fetch_pool_metrics` is stub. | Use `mainnet_oracle` / existing oracle or add pool_metrics service that fetches Nostra, zkLend, Ekubo APY/TVL (and optionally volatility). |
| **Yield persistence + audit** | No DB or service that stores yield events and links them to decision_hash. | Either extend `audit_trail_service` or add a yield_events store; implement `_fetch_yield_events`, `_fetch_ai_decision`, `_fetch_yields_for_decision`, `_fetch_user_decisions` against it. |
| **Full MVP UI** | No deposit card (risk slider, “Deposit & Let AI Allocate”), no allocation pie, no yield dashboard, no audit trail (decision hash + proof link). | Current /mvp is Connect → Create LP → Manage → History. Add: Deposit card, Allocation display (pie), Yield dashboard, Audit trail; or replace Create LP with “Deposit” and make allocation/LP a result of AI. |

---

### 5.3 One-line summary

**Carry over:** Phase4a LP create, zkdefi position/rebalancer APIs, vault route shapes and models, Ekubo/proof/session-key/audit services, proof_gated_yield_agent, smart_yield_vault.cairo, and /mvp Connect + Manage + History.  
**Missing:** Vault stub implementations (wire to services + DB), Nostra/zkLend deposit execution, SmartYieldVault deploy + backend recording, allocation model + Stone proof, real pool metrics, yield persistence/audit, and full MVP UI (deposit card, allocation pie, yield dashboard, audit trail).

---

## 6. References

- **Mission & scope:** `zkdefi/MVP_AUTONOMOUS_VAULT_SYSTEM.md`
- **6-week plan:** `zkdefi/IMPLEMENTATION_ROADMAP_6WEEKS.md`
- **Phase 1 done:** `zkdefi/MVP_IMPLEMENTATION_PHASE_1.md`
- **Live page:** `zkdefi/frontend/src/app/mvp/page.tsx`
- **Backend:** `zkdefi/backend/app/api/routes/phase4a.py`, `zkdefi/backend/app/api/zkdefi_agent.py`, `zkdefi/backend/app/api/rebalancer.py`, `zkdefi/backend/app/api/routes/autonomous_vault.py`
- **Contracts:** `zkdefi/contracts/src/smart_yield_vault.cairo`, `zkdefi/contracts/src/proof_gated_yield_agent.cairo`
