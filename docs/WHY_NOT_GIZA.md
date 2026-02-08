# Why We're Not Using Giza (Yet)

*Short answer: we use Circom + Garaga for zkML today; Giza is for full ML models in Cairo. We mention Giza as the ecosystem’s model layer and as a future integration for “real” zkML inference.*

---

## What We Use Today

| Piece | Role |
|-------|------|
| **Circom** | Circuits: RiskScore, AnomalyDetector, PrivateDeposit, PrivateWithdraw |
| **snarkjs** | Groth16 prove (witness → proof) |
| **Garaga** | Groth16 verifier on Starknet; we deploy circuit-specific verifiers (deposit, withdraw, risk, anomaly) |
| **Stone + Integrity** | STARK execution proofs (constraint satisfaction); fact registry |

Our “zkML” today is **circuit-based predicates**: e.g. “risk score ≤ threshold,” “anomaly = 0/1.” We don’t run a neural network or tree model; we prove statements that look like “output of this small circuit is valid.” That fits Circom + Garaga: small, fixed circuits, fast to prove, already integrated.

---

## What Giza Provides

| Piece | Role |
|-------|------|
| **Orion** | Cairo zkML: compile ML models (e.g. ONNX) to Cairo, run provable inference |
| **Giza agents** | Provable ML models that execute on Starknet (e.g. AgentStark) |
| **Stack** | Full ML model → Cairo → STARK (or their proof flow) → on-chain verification |

Giza is for **real ML models** (neural nets, etc.) with **provable inference** in Cairo. We don’t use that today because our risk/anomaly logic is implemented as **small Circom circuits**, not as a Cairo-compiled model.

---

## Why We're Not Using Giza Right Now

1. **Different abstraction** — We prove “this predicate holds” (circuit → Groth16 → Garaga). Giza proves “this ML model produced this output” (model → Cairo → their proof pipeline). Our current feature set (risk threshold, anomaly flag) doesn’t require a full ML runtime in Cairo.

2. **Stack is already wired** — Circom + snarkjs + Garaga is in production for risk, anomaly, and confidential transfers. Switching to Giza/Orion would mean a new proof pipeline, new verifiers, and different tooling. That’s a deliberate migration or addition, not a one-line swap.

3. **Layer 3B is roadmap** — In our own narrative (TRUSTLESS_AI_NARRATIVE), **Layer 3B** is “zkML Inference”: real ML (NN/tree) with a zkML proof of “model(inputs) = output.” We explicitly call out **EZKL/Giza + Stone** there as the target stack for that layer, planned 2–4 months after research. So we *do* plan to use something like Giza when we do “real” zkML inference.

4. **Division of roles** — We position **Giza = model layer** (what model ran, what it output) and **us = execution / standard layer** (GATE: how agents execute, proof-gated, session keys). So even when we integrate Giza, we don’t replace GATE; we plug Giza’s proven outputs into our execution gate.

---

## When We Would Use Giza

- **Layer 3B (zkML inference)** — When we want a **real** risk or anomaly model (e.g. neural net or gradient-boosted tree) instead of a hand-written circuit. Then: model → Orion (or similar) → provable inference → we gate execution on that proven output. Giza/Orion is a natural fit for “prove model(inputs) = score” on Starknet.

- **Richer agent logic** — If we add agents whose decisions depend on a full ML model (e.g. pricing, sizing, fraud), we’d want provable inference; Giza agents + GATE (“only execute if Giza proof + our proof both valid”) is a clean story.

- **Ecosystem alignment** — Using Giza for the model layer and us for the execution/standard layer (GATE) fits the “trustless AI” narrative and makes us interoperable with other Giza-based agents.

---

## Summary

| Question | Answer |
|----------|--------|
| Why aren’t we using Giza? | Our zkML today is Circom circuits + Garaga (predicates, not full ML). Giza is for full ML models in Cairo (Orion). We’re not using it yet because we don’t need that layer yet. |
| When would we use it? | When we implement Layer 3B (real zkML inference) or richer agent logic that needs provable ML output. Then Giza/Orion is the natural “model layer”; we stay the “execution/standard layer” (GATE). |
| Do we conflict with Giza? | No. We’re complementary: Giza = what model ran; we = how execution is gated (proof + session keys + intent). We can integrate by gating on Giza’s proven outputs. |

So: we talk about Giza because it’s the Starknet zkML/agent stack we’re **complementary to** and **likely to integrate with** at Layer 3B, not because we’re already using it in the current app.
