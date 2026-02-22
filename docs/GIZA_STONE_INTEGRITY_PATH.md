# Giza → AIR → Stone/Integrity: Does It Map?

**Question:** Is there a path to use Giza for the AIR and then prove with my own Stone/Integrity (so privacy/zkML use STARK, no trusted ceremony)?

**Short answer:** For **zkML** it can map (Giza → Cairo → Stone → Integrity). For **full-privacy (Circom)** there is **no path today**; Stone proves Cairo execution, not Circom circuits.

---

## What Stone does today

Stone proves **Cairo program execution**. Flow:

1. A **Cairo program** runs (e.g. risk/onboarding).
2. That produces an **execution trace**.
3. Stone produces a **STARK proof** of that trace.
4. Integrity verifies the proof and registers **fact_hash** on-chain.

The "AIR" is the one implied by **Cairo execution** — Stone is built for Cairo traces. Stone is not "upload an arbitrary AIR"; it's "run this Cairo program, I'll prove the trace."

---

## What Giza/Orion does

Giza/Orion compiles **ML models (e.g. ONNX) → Cairo**. Output is a **Cairo program**. When you run that program, you get a Cairo execution trace — the same kind Stone can prove.

So you don't need "Giza for the AIR" as a separate artifact. Giza gives you **Cairo**; the AIR is the Cairo VM's, which Stone already knows.

---

## zkML path: Giza + Stone/Integrity

**Flow:** Giza (model → Cairo program) → run the Cairo program → Stone (Cairo trace → STARK proof) → Integrity (verify + register fact).

**It maps.** The integration gap: your Stone/Integrity pipeline is currently wired to a **specific** program (e.g. risk/onboarding with `jediswap_metrics`, `ekubo_metrics`). To use Giza you would:

1. Use Giza to compile your ML model to a Cairo program.
2. Wire Stone to accept/run that **Giza-generated Cairo program** (or its trace) and prove it.
3. Register the resulting fact in Integrity (same as today).

No trusted setup for that path. See also [WHY_NOT_GIZA.md](WHY_NOT_GIZA.md) (Layer 3B: EZKL/Giza + Stone).

---

## Full-privacy (Circom) path: no path today

The full-privacy circuit is **Circom** (R1CS, BN254) → Groth16. Stone proves **Cairo**, not Circom. Giza does **ONNX → Cairo**, not Circom → Cairo.

So there is **no** "Circom full-privacy → Giza for AIR → Stone/Integrity" today. To get full-privacy under Stone you would need to **port** the full-privacy logic (Merkle path, nullifier, amount) to a **Cairo program** (by hand or via a custom translator). Then Stone could prove that Cairo program. That's a rewrite, not "plug in Giza for the AIR."

---

## Summary

| Proof type | Giza role | Stone/Integrity | Path today? |
|------------|-----------|------------------|-------------|
| zkML (risk, anomaly, model output) | Giza gives Cairo (model → Cairo); AIR = Cairo execution | Stone proves Cairo trace; Integrity registers | **Yes.** Wire Stone to Giza-generated Cairo program/trace. |
| Full-privacy withdraw (Circom) | Giza is for ML → Cairo, not Circom | Stone proves Cairo only | **No.** Would need Circom → Cairo port; then Stone can prove it. |

So: **for zkML**, "Giza for the model → Cairo, then my Stone/Integrity" does map. For **full-privacy**, there's currently no path without porting the circuit to Cairo.
