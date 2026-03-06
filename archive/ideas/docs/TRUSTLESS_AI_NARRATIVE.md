# Trustless AI: Infrastructure, Five Layers, and a New App Class

*Obsqra Labs’ goal is to provide infrastructure for trustless AI execution on Starknet. We entered the Re{define} Hackathon to demo our technique in a new app class — proof-gated, verifiable AI — and to validate the approach before scaling it.*

---

## What We Mean by Trustless AI

**Trustless AI** is AI-driven execution that doesn’t rely on “trust me.” Every decision that affects on-chain state is **cryptographically verified**: the contract checks a proof that the decision satisfied the agreed rules (constraints, risk bounds, policy) before executing. No proof → no execution.

That implies:

- **Verifiable** — The chain verifies a proof (STARK/SNARK), not a claim.
- **Auditable** — Model version, provenance, and receipts are on-chain or disclosed by proof.
- **Policy as code** — Constraints and risk limits are enforced by the verification gate, not by the operator’s goodwill.

Obsqra Labs is building the **infrastructure** that makes that possible: proving pipeline (Stone → Integrity), proof-gated contracts, model registry, and agent primitives. zkde.fi is our **first full app** in a new class — a privacy-preserving autonomous DeFi agent — and we’re open-sourcing it in the hackathon to show that the pattern works and to invite others to build on it.

---

## Five Layers of zkML (Obsqra Stack)

The full stack lives in the **starknet.obsqra.fi** repo (one level up from zkde.fi). We’ve scoped five stages of zkML maturity; the first three are live or in progress, the last two are the roadmap to full trustless AI.

| Layer | Name | What it does | Status |
|-------|------|----------------|--------|
| **2** | **Proof-Gated Execution** | Stone prover generates a STARK proof that allocation satisfied constraints; Integrity fact registry; RiskEngine reverts if proof invalid. “No proof, no execution.” | **Production** (starknet.obsqra.fi) |
| **3A** | **On-Chain Parameterized Model** | Model params (weights, clamp bounds) live in contract storage, versioned. Same Stone flow; upgrade = set params, not redeploy. | **Live** (ModelParams, ModelRegistry) |
| **3B** | **zkML Inference** | Real ML (NN/tree) runs off-chain; zkML proof proves “model(inputs) = output”; contract accepts proven score. EZKL/Giza + Stone. | **Roadmap** (2–4 months after research) |
| **4** | **Trustless AI** | DAO governance for model approval; public artifacts (code, weights, training script on IPFS/Arweave); reproducible training docs. “Fully trustless AI — DAO governance, public artifacts.” | **Planned** (3–6 months) |
| **5** | **On-Chain Agent** | Intent registry, agent reputation, policy marketplace, multi-agent coordination. Submit intent → execute with proof; reputation and policies on-chain. | **Planned** (2–3 months, foundations exist) |

**Why five layers:** Each step adds a dimension of trustlessness — from “proof of execution” (2) to “parameterized, upgradeable model” (3A) to “proven ML inference” (3B) to “governed, reproducible AI” (4) to “verifiable agent infrastructure” (5). The hackathon deliverable (zkde.fi) demonstrates the **technique** — proof-gated execution, session keys, zkML-gated decisions, selective disclosure — in a concrete app; the parent repo is where the full five-layer infrastructure is implemented and extended.

---

## Agent Types Scoped on This Infrastructure

Across the two repos we’ve scoped several agent patterns that sit on top of the same proof and verification stack:

1. **Proof-gated DeFi agent (zkde.fi)**  
   User sets constraints (max position, protocols); agent proposes allocation; Stone proves constraint satisfaction; Integrity verifies; contract executes only if proof valid. Session keys for delegation; optional zkML (risk/anomaly) and selective disclosure. **Live in hackathon.**

2. **Intent-based agent (Stage 5)**  
   User submits intent (goal + constraints); agent executes with proof that action matches intent; intent registry and receipts on-chain. Foundations: STEP 0.6 constraint signatures, allocation events with proof facts. **Planned** (AgentOrchestrator / RiskEngine extension).

3. **Reputation-aware agent**  
   Execution gated on proof *and* agent reputation (success rate, value executed). Contract or orchestrator checks “proof valid + reputation above threshold.” **Scoped** in Stage 5 (agent_id → executions, success, total_value).

4. **Policy marketplace agent**  
   Users pick from pre-built policy templates (e.g. “conservative DeFi”, “max yield with cap”); agent runs within that policy; proof proves “action in policy.” **Scoped** in Stage 5 (policy marketplace).

5. **Multi-agent coordination**  
   Agents call other agents; each step proof-gated; shared fact registry so one proof can be reused across contracts. **Scoped** in Stage 5 (multi-agent).

6. **DAO-governed model agent (Stage 4)**  
   Model upgrades go through DAO: propose model version (hash, artifacts) → vote → approve; only approved models can drive execution. **Planned** (Stage 4 Trustless AI).

All of these use the same core primitive: **execute only if off-chain computation (risk engine, ML, or agent logic) has been proven to satisfy a predicate, and that proof is verified on-chain (Integrity / fact registry).**

---

## What This Unlocks: A New App Class

Trustless AI infrastructure doesn’t just improve one product — it enables a **new class of applications**:

- **Autonomous agents** in any domain (DeFi, gaming, governance, content) that act on your behalf and prove they stayed within your rules.
- **ML-gated execution** — credit scoring, KYC, content moderation, underwriting — where “AI said X” is verified by proof; only compliance is public.
- **Conditional execution** — time-locks, risk caps, insurance payouts — where “do X only if C” is enforced by a proven predicate.
- **Compliance and audit** — prove “we complied with R” without revealing full data; regulators and counterparties check the fact.
- **MEV/intent protection** — intent hidden until execution; execution only with proof (slippage, constraints); no “trust the operator.”

The common pattern: **compute → prove → verify on-chain → gate execution.** Obsqra Labs is building the proving and verification layer (Stone, Integrity, contracts, model registry, agent primitives); zkde.fi is the first shipped app in this class. We entered the hackathon to **demo the technique** and validate that the ecosystem wants this; the longer-term goal is to make this infrastructure the default for teams that want trustless AI execution on Starknet.

---

## Hackathon and Beyond

- **What we’re submitting:** zkde.fi — open-source Starknet app: proof-gated execution, session keys, zkML-gated rebalancing, selective disclosure. The **core deliverable** (contracts + app logic) is open and evaluable; the prover and supporting infra (starknet.obsqra.fi) we treat like third-party infra (e.g. Herodotus), as agreed with the hackathon.
- **Why we’re here:** To demonstrate our **technique** in a **new app class** — trustless, proof-gated AI — and to get real feedback. If the use case validates, we want to pursue grant funding to mature the full five-layer stack and agent infrastructure for the ecosystem.
- **One-liner:** Obsqra Labs is building infrastructure for trustless AI execution on Starknet; we’re using the hackathon to ship the first app in that class (zkde.fi) and to validate the approach.

---

*Summary for Omar / ecosystem: Obsqra Labs’ mission is infrastructure for trustless AI execution. The stack has five layers of zkML (proof-gated execution → parameterized model → zkML inference → DAO-governed trustless AI → on-chain agent). We’ve scoped multiple agent types on that infra. We entered the hackathon to demo the technique in a new app class (proof-gated, verifiable AI) and to validate before scaling.*

---

**Next:** A follow-up blog will go deeper on the five-layer stack, agent types, and how the hackathon deliverable (zkde.fi) fits into Obsqra Labs’ infrastructure roadmap.
