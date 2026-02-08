# What This Architecture Unlocks: App Types and Use Cases

*Inferred from the zkde.fi codebase — the primitives and patterns that define a new class of Starknet applications.*

---

## The Core Primitive

The architecture reduces to one gate:

**Execute only if an off-chain computation has been proven to satisfy a predicate, and that proof is registered in a shared fact registry (Integrity).**

In contract terms: `is_valid(proof_hash)` → then execute. The *content* of the predicate is arbitrary: constraints, slippage bounds, risk thresholds, compliance statements, game outcomes, attestations. The prover (Stone) runs Cairo (or anything that compiles to it); Integrity stores the fact; any Starknet contract can gate on it.

So the unlock is: **trustless conditional execution** — "do X only if off-chain compute has been proven to satisfy condition C."

---

## Architectural Building Blocks (from the repo)

| Primitive | What it does | Where it lives |
|-----------|--------------|----------------|
| **Proof-gated execution** | No proof → no execution. Contract checks Integrity `is_valid(proof_hash)` before deposit/withdraw/execute. | `ProofGatedYieldAgent`, `deposit_with_proof`, `execute_with_session` |
| **Session-key + proof** | Delegation (session key) *and* verification (proof). Agent can act only if both valid. | `SessionKeyManager.validate_session_with_proof`, `execute_with_session` |
| **Selective disclosure** | Register a *statement* (type, threshold, result) with a proof; anyone can check "did they prove X?" without seeing underlying data. | `SelectiveDisclosure`, `ComplianceProfile` |
| **Intent commitments** | Replay- and fork-safe: commitment = hash(intent, nonce, chain_id, block_number). | `IntentCommitment`, zkDE (GATE-1) |
| **Constraint receipts** | On-chain audit trail: user, constraints_hash, proof_hash, timestamp. | `ConstraintReceipt` |
| **Hybrid proofs** | zkML/privacy (Garaga/SNARK) + execution (Stone/STARK). Combined verification: execute only if all pass. | `execute_with_proofs`, PROOF_SYSTEM_ARCHITECTURE |

The "coprocessor" is: **off-chain compute → prove predicate (Stone) → Integrity fact → Starknet contract gates on that fact.** The app (zkde.fi) is one instance: DeFi agent + constraints + zkML. The *pattern* generalizes.

---

## App Types This Unlocks

### 1. **Autonomous agents (any domain)**

**Pattern:** User sets constraints → agent proposes actions → prove "action satisfies constraints" → execute via session key + proof.

**What we ship:** DeFi rebalancing agent; proof = allocation satisfies max position, allowed protocols, slippage.

**Unlocks:** Trading agents, governance agents, content/social agents, gaming agents. Same formula: delegate with session key; agent only executes if it can produce a valid proof that the action is within the user's guardrails. **Trustless delegation with verifiable guardrails.**

---

### 2. **Trustless AI / ML-gated execution**

**Pattern:** ML model (risk, anomaly, recommendation, filter) produces an output → prove "output satisfies policy P" (e.g. risk ≤ threshold, anomaly = 0) → execute only if proof passes.

**What we ship:** Risk score + anomaly detector (Garaga); execution proofs (Integrity). Combined: `execute_with_proofs(zkml_proof, execution_proof, ...)`.

**Unlocks:** Credit scoring, KYC/AML checks, content moderation, game AI, underwriting. "AI said X; we prove X is within policy; contract executes." The model output stays private; only compliance is verifiable.

---

### 3. **Conditional execution / covenants**

**Pattern:** "Do X only if condition C holds." C is proven off-chain (e.g. "price in range", "oracle said Y", "computation Z returned true"). Stone proves C; Integrity stores it; contract executes X only if `is_valid(proof_hash)`.

**What we ship:** Constraint satisfaction, slippage bounds — both are "condition C" proven and gated.

**Unlocks:** Time-locks, risk-based caps, insurance payouts, options settlement, protocol rules. Any covenant that can be expressed as a provable predicate.

---

### 4. **Compliance and audit (selective disclosure)**

**Pattern:** Prove a *statement* ("I complied with R", "portfolio met criteria C") without revealing full data. Register proof_hash on-chain; auditors/regulators/counterparties check the fact.

**What we ship:** `SelectiveDisclosure`, `ComplianceProfile`, compliance proofs (risk, performance, KYC-style).

**Unlocks:** Regulatory reporting, counterparty checks, fund audits, accreditation. Prove what’s needed; hide the rest.

---

### 5. **MEV / intent protection**

**Pattern:** Intent is hidden until execution. Execution only with proof (e.g. slippage bounds, constraint satisfaction). Intent commitment binds intent to nonce/chain/block.

**What we ship:** Intent-hiding execution, proof-gated execution, intent commitments (AGENT_FLOW, zkDE / GATE-1).

**Unlocks:** Private order flow, sealed-bid auctions, fair sequencing. "You see the execution; you don’t see the intent until it’s proven and executed."

---

### 6. **Delegated execution with guardrails (keepers, bots, relayers)**

**Pattern:** A third party has permission to trigger actions (session/key) but can only execute if they supply a valid proof that the action is within rules.

**What we ship:** `execute_with_session(session_id, proof_hash, ...)` — session key alone is not enough; proof required.

**Unlocks:** Trustless keepers ("liquidate only if health < X" proven), relayers ("submit only if order matches" proven), bots with hard limits. Delegation without blind trust.

---

### 7. **Gaming and procedural content**

**Pattern:** Prove "this outcome was generated by rules R" (fair RNG, deterministic state transition) without revealing the process. Integrity stores the proof; contract pays out or advances state only if valid.

**What we ship:** Same fact-registry gate: any provable predicate.

**Unlocks:** Verifiable fairness, procedural content with on-chain verification, game state transitions that are provably correct.

---

### 8. **Attestation and reputation**

**Pattern:** Prove "entity E has property P" (KYC, risk tier, credential). Other contracts gate on that proof via the same fact registry.

**What we ship:** Selective disclosure, compliance profiles — attestation to a statement with a proof_hash.

**Unlocks:** Identity/reputation layers, gated access ("only if accredited"), cross-protocol reuse of the same fact.

---

### 9. **Oracle-gated execution**

**Pattern:** Oracle (or any data source) supplies data; prover proves "data satisfies predicate P". Contract executes only if proof valid. You trust the proof, not the oracle’s raw word.

**What we ship:** Generic `is_valid(proof_hash)` — the "computation" can be "fetch + compute + prove P."

**Unlocks:** Conditional execution from real-world or off-chain data with cryptographic verification of the condition.

---

### 10. **Cross-protocol / shared verification**

**Pattern:** One proof (one fact_hash) can be checked by many contracts. Fact registry is the shared layer.

**What we ship:** Integrity as single registry; multiple contracts (ProofGatedYieldAgent, SelectiveDisclosure, ComplianceProfile, SessionKeyManager) all call `registry.is_valid(proof_hash)`.

**Unlocks:** Prove once, use in many protocols; shared compliance/attestation layer across the ecosystem.

---

## One-Liner for the Ecosystem

**"Proof-gated execution + shared fact registry = a new class of apps: any flow where execution is conditioned on off-chain computation that can be STARK-proven and verified on-chain."**

zkde.fi is the first instance: **privacy-preserving autonomous DeFi agent** with session keys, zkML, and proof-gating. The same architecture unlocks autonomous agents in other domains, trustless AI/ML-gated actions, conditional covenants, compliance and audit, MEV/intent protection, guarded delegation, gaming, attestation, and oracle-gated execution — all using the same coprocessor pattern: **compute → prove → Integrity → gate.**

---

## For Grants / Omar / Narrative

- **What we built:** A specialized coprocessor for verifiable execution (local Stone → Integrity) and an app that uses it (proof-gated DeFi agent with zkML and session keys).
- **What it opens:** A *class* of apps that need "execute only if proven predicate" — agents, trustless AI, covenants, compliance, MEV protection, keepers, gaming, attestation.
- **Why it matters for Starknet:** Native STARK verification (Integrity), no trusted setup for execution proofs, one fact registry many contracts can use. Validating this via the hackathon (zkde.fi as the first full instance) de-risks the pattern for more builders.
