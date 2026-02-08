# Landing Page Rewrite Plan

**Goal:** Package the landing page around our **zkML coprocessor** and the **two core concepts** it delivers: **Trustless execution** and **Verifiable AI** (Combo 1 — locked). zkML drives both; the landing page uses this framing.

---

## 1. What we build

We build a **zkML coprocessor**: off-chain inference and proofs (Garaga for zkML, Integrity for execution constraints), consumed by the chain. The coprocessor drives two outcomes:

- **Trustless execution** — Execution that doesn't require trust. zkML gates execution (proofs of inference + intent); part of the logic (e.g. allocation risk) runs on-chain in Cairo.
- **Verifiable AI** — The AI's outputs are cryptographically verifiable. zkML proves model results (e.g. risk ≤ threshold, pool safe) without revealing raw scores or analysis.

Framing choice: **Combo 1 (Trustless execution + Verifiable AI)**. Two distinct concepts: execution = trustless (we gate it); AI = verifiable (we prove it). "Verifiable AI" is the established category (Polyhedra, etc.); "Trustless execution" is the user-facing promise. Alternatives (Combo 2: Trustless AI + Verifiable execution) are documented in section 6 for reference.

---

## 2. Ground truth (for accurate copy)

**Inference:** We run risk and anomaly models (Python: `RiskScoreModel.compute_risk_score`, `AnomalyDetectionModel.analyze_pool`). That is model inference; we prove predicates on the outputs (e.g. risk_score ≤ threshold, anomaly_flag == 0) via Groth16 (Garaga). We verify **intent** (your constraints, Integrity) and **inference** (model outputs). Intent + inference — not "just intent."

**Proof-gated execution:** The contract verifies proofs (Garaga + Integrity), then executes. We do not re-run full ML inference on-chain; we verify off-chain proofs. "Verifiable" on execution means: execution only proceeds after cryptographic verification of those proofs. Use "proof-gated" when we need to be precise.

**On-chain slice:** In Cairo we have `AllocationRouter.calculate_risk_score(allocation) -> u8`. At rebalance, the contract computes risk from allocation and asserts `new_risk <= risk_tolerance` before executing. So part of the "brain" runs on-chain; the rest is proof-gated off-chain inference.

**RISC Zero:** Documented and referenced in the frontend; no backend RISC Zero prover in the current execution path. Landing: "Today: Groth16 (risk, anomaly). Roadmap: RISC Zero for complex zkML (credit scoring, neural networks)." Do not claim RISC Zero is live in the main flow.

---

## 3. Two core concepts (definitions + how zkML drives them)

### Trustless execution

**Definition:** Execution that doesn't require trust. No proof, no execution. Verification is deterministic. Part of the logic (e.g. allocation risk) runs on-chain in Cairo; the rest is proof-gated.

**How zkML drives it:** The coprocessor produces proofs of inference (risk, anomaly) and intent (constraints). The contract verifies those proofs (Garaga + Integrity), then executes. Where we have on-chain logic (e.g. AllocationRouter in Cairo), the contract computes and enforces it. So zkML (proofs) + on-chain slice = trustless execution.

### Verifiable AI

**Definition:** The AI's decisions are verifiable — we prove model outputs (or predicates on them) without revealing inputs, model details, or raw outputs. Only compliance (e.g. risk ≤ threshold) is proven on-chain.

**How zkML drives it:** We run risk and anomaly models (inference); we prove predicates on the outputs via Groth16 (Garaga). Raw scores and analysis stay private. Today: Groth16 (risk, anomaly). Roadmap: RISC Zero. zkML = inference + proof; that's what makes the AI verifiable.

---

## 4. Landing page packaging

| Section | Content |
|--------|--------|
| **Hero** | "Private DeFi. Verifiable execution." + "No proof, no execution." Optional: mention zkML coprocessor in sub-copy. |
| **Problem** | Verifiable privacy; prove rules without revealing strategy. |
| **zkML coprocessor + two concepts** | Lead: We build a zkML coprocessor that drives **Trustless execution** and **Verifiable AI**. Two cards: (1) Trustless execution — definition + how zkML drives it (proofs + on-chain slice). (2) Verifiable AI — definition + how zkML drives it (inference + proof). Optional: one line on "What is the coprocessor?" (off-chain inference + proofs → chain verifies and executes). |
| **How it works** | Step 2: Run inference (risk, anomaly), prove the result, verify on-chain; contract also runs allocation risk check in Cairo where applicable. |
| **Privacy by design** | Unchanged (Intent hiding, Confidential transactions, Selective disclosure). |
| **Hybrid proof** | Inference proofs (Garaga) + execution proofs (Integrity); allocation risk computed on-chain (Cairo) for rebalance flow. |
| **Trust + Footer** | Unchanged. |

---

## 5. Copy notes (implementation)

- **zkML coprocessor:** The thing we build. Off-chain inference + proofs (Garaga, Integrity); chain verifies and executes. Drives trustless execution and verifiable AI.
- **Trustless execution:** Execution that doesn't require trust. zkML drives it by gating execution on proofs (+ on-chain allocation risk in Cairo). No proof, no execution.
- **Verifiable AI:** The AI's outputs are verifiable. zkML drives it by proving model results (risk ≤ threshold, pool safe) without revealing raw outputs. Today: Groth16. Roadmap: RISC Zero.

---

## 6. Appendix: Why Combo 1 (Trustless execution + Verifiable AI)

We have two adjectives (**trustless**, **verifiable**) and two nouns (**execution**, **AI**). The four pair combinations:

| Combo | Concept A | Concept B |
|-------|-----------|-----------|
| **1** | Trustless execution | Verifiable AI |
| 2 | Trustless AI | Verifiable execution |
| 3 | Trustless execution | Verifiable execution |
| 4 | Trustless AI | Verifiable AI |

Combos 3 and 4 put both adjectives on one noun (redundant; one concept). Combos 1 and 2 are the only non-redundant pairs. We chose **Combo 1**: execution = trustless (the thing we gate), AI = verifiable (the thing we prove). "Verifiable AI" is the standard category name; "Trustless execution" is the clear DeFi value prop. Combo 2 (Trustless AI + Verifiable execution) is the only other option if we ever want to stress "don't trust the agent" more; tradeoff is losing the standard "Verifiable AI" label.
