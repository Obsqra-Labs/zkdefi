# Garaga: Which Proof Types Can You Run on Starknet?

**Short answer: Yes.** With Garaga you can verify **any** of the proof types shown in their benchmark table on Starknet. Garaga provides on-chain Cairo verifiers for each. You “run” them by: (1) using the right Garaga verifier for that proof system, (2) generating proofs with the matching prover (Noir, RISC Zero, SP1, or your own Groth16 prover), (3) calling the verifier from your contract with the proof calldata.

---

## What Garaga Supports (from the benchmark table you pasted)

| Proof system | Verifier | Sierra Gas (approx) | Use case |
|--------------|----------|---------------------|----------|
| **Groth16 BN254** | `groth16_example_bn254` | ~34M | zkML, confidential transfers, SNARKs (what zkde.fi uses today) |
| **Groth16 BLS12-381** | `groth16_example_bls12_381` | ~50M | Alternative curve; some ecosystems use BLS12-381 |
| **Noir Ultra Keccak HONK** | `noir_ultra_keccak_honk` | ~188M | Noir proofs (Keccak transcript) |
| **Noir Ultra Keccak ZK HONK** | `noir_ultra_keccak_zk_honk` | ~204M | Noir ZK HONK (zero-knowledge variant) |
| **Noir Ultra Starknet HONK** | `noir_ultra_starknet_honk` | ~178M | Noir on Starknet-native transcript |
| **Noir Ultra Starknet ZK HONK** | `noir_ultra_starknet_zk_honk` | ~193M | Noir ZK HONK, Starknet transcript |
| **RISC Zero Groth16 BN254** | `risc0_verifier_bn254` | ~43M | RISC Zero proofs (Groth16) |
| **SP1 Groth16 BN254** | `sp1_verifier_bn254` | ~38M | SP1 proofs (Groth16) |

So with Garaga you can run (verify on Starknet):

- **Groth16** (BN254 or BLS12-381) — from snarkjs, Circom, or any Groth16 prover
- **Noir** (Ultra HONK, with Keccak or Starknet transcript; plain or ZK)
- **RISC Zero** (Groth16 BN254)
- **SP1** (Groth16 BN254)

---

## What zkde.fi Uses Today

- **Garaga Groth16 BN254** only:
  - `ZkmlVerifier` and `ConfidentialTransfer` call `verify_groth16_proof_bn254(proof_calldata)`.
  - Proofs are generated with snarkjs (Circom circuits: risk score, anomaly, private deposit/withdraw).
- So today you are using **one** of the Garaga verifier types; the others are available if you add the matching verifier and prover.

---

## How to “Run” Another Proof Type

1. **Pick the proof system** (e.g. Noir Ultra Starknet HONK, or RISC Zero, or SP1).
2. **Add the Garaga verifier for that system**  
   - Use Garaga’s contracts/examples for that verifier (e.g. `noir_ultra_starknet_honk_example`, `risc0_verifier_bn254`, `sp1_verifier_bn254`).  
   - Either deploy that verifier as a separate contract and call it from your app, or embed/integrate the verifier logic (if Garaga exposes it as a library).
3. **Generate proofs with the matching prover**  
   - Noir → Noir toolchain; RISC Zero → RISC Zero prover; SP1 → SP1 prover; Groth16 BLS12-381 → a prover that outputs BLS12-381 Groth16 proofs.
4. **Call the verifier from your contract** with the proof calldata (same pattern as your current `verify_groth16_proof_bn254`).

So: **yes, you can run any of those** — each row in the table is a verifier Garaga supports; you just need the corresponding verifier integration and prover pipeline.

---

## Gas / Cost Tradeoff (from the table)

- **Cheapest:** Groth16 BN254 (~34M Sierra gas) — what you use now.
- **Next:** SP1 Groth16 BN254 (~38M), RISC Zero Groth16 BN254 (~43M).
- **More expensive:** Noir Ultra HONK variants (~178–204M), Groth16 BLS12-381 (~50M).

So if you add Noir, RISC Zero, or SP1, expect roughly 1.1–6× the verification cost of your current Groth16 BN254 path, depending on which you pick.

---

## Summary

| Question | Answer |
|----------|--------|
| Can you run any of those proof types with Garaga? | **Yes.** Garaga provides on-chain verifiers for all of them. |
| What does zkde.fi use today? | Garaga **Groth16 BN254** only (zkML + confidential transfer). |
| What do you need to run another? | The Garaga verifier for that proof type + a prover that produces that proof format. |
| Which is cheapest? | Groth16 BN254 (~34M gas). Noir HONK variants are ~5–6× more. |

So with Garaga you can run (verify on Starknet) Groth16 (BN254/BLS12-381), Noir Ultra HONK (Keccak or Starknet, plain or ZK), RISC Zero Groth16, and SP1 Groth16 — each with the verifier and prover pair that matches the benchmark row.

---

## What Advantage Would Any of These Give You?

You already use **Groth16 BN254** (cheapest, Circom/snarkjs). The others only help if you have a **concrete reason** to switch or add a second proof type.

| Proof type | Advantage over Groth16 BN254 | When it’s worth it |
|------------|------------------------------|---------------------|
| **Noir (HONK)** | Different language (Noir vs Circom); Starknet-native HONK; strong privacy/ZK ecosystem (Aztec, Noir). ZK HONK = hiding/zero-knowledge at the proof level. | You want to write circuits in Noir, hire Noir devs, or align with Noir/Aztec stack. **Cost:** ~5–6× gas. |
| **RISC Zero** | **zkVM:** prove “this Rust (or C) program ran correctly” without hand-writing a circuit. Run your existing risk engine, ML inference, or tooling in Rust and prove execution. | Complex logic or existing codebase in Rust; “prove arbitrary computation” without Circom. **Cost:** ~1.2× gas vs BN254. |
| **SP1** | Same idea as RISC Zero: zkVM, prove program execution. Different VM/ecosystem. | Prefer SP1 tooling/ecosystem over RISC Zero for provable execution. **Cost:** ~1.1× gas vs BN254. |
| **Groth16 BLS12-381** | **Curve compatibility:** BLS12-381 is used on Ethereum (EIP-2537, BLS signatures), in aggregation, and in some cross-chain designs. Same proof *logic*, different curve. | You need proofs or keys that plug into Ethereum BLS, aggregation, or a system that expects BLS12-381. **Cost:** ~1.5× gas vs BN254. |

**Summary:**

- **Stay on Groth16 BN254** unless you have one of: (a) desire to use Noir/Aztec, (b) need to prove arbitrary Rust/code (zkVM → RISC Zero/SP1), (c) need BLS12-381 for Ethereum or aggregation.
- **Noir** = language/ecosystem choice and Starknet-native HONK; you pay ~5–6× gas.
- **RISC Zero / SP1** = “prove my Rust (or general) program” without writing circuits; modestly higher gas (~1.1–1.2×).
- **BLS12-381** = curve compatibility only; no gain unless you need that curve.

---

## Would Our zkML Stuff Benefit?

**Short answer: your current zkML (RiskScore + AnomalyDetector in Circom) is already a good fit for Groth16 BN254.** The other proof types only help if you change *what* you prove (e.g. more complex ML) or *how* you want to write it (Noir, or native code).

**What you have today:** Circom circuits: weighted-sum risk (8 features) and multi-factor anomaly (6 factors), then threshold checks. Both are deterministic formulas, not deep NNs. Circom handles this well; Groth16 BN254 is cheap and sufficient.

| Option | Benefit for zkML? | When it’s worth it |
|--------|--------------------|---------------------|
| **Noir (HONK)** | **Lateral.** Same statements (risk ≤ threshold, anomaly = 0). You could rewrite circuits in Noir; you get a different DSL and Starknet HONK, not a better zkML outcome. | Only if you prefer Noir for writing/maintaining circuits or want to be in the Noir ecosystem. You pay ~5–6× gas. |
| **RISC Zero / SP1** | **Yes, when ML gets complex or you reuse code.** zkVM = prove “this program ran correctly” without writing a circuit. So you could: run your **actual** risk model (e.g. small NN, tree, or existing Rust/Python logic) inside the VM and prove execution; reveal only “risk ≤ threshold” or “anomaly = 0.” No Circom rewrite. | When you add real ML (NN, tree, or more complex logic) or want to prove an existing Rust/Python risk engine without porting it to Circom. Modest gas increase (~1.1–1.2×). |
| **BLS12-381** | **No zkML benefit.** Same proof logic, different curve; only for ecosystem/aggregation. | Skip for zkML. |

**Summary for zkML:**

- **Keep Groth16 BN254** for current RiskScore and AnomalyDetector; they don’t need a different proof system.
- **Consider RISC Zero or SP1** when you want to prove a more complex model (e.g. small neural net, tree, or existing code) without hand-writing Circom. Then zkML *does* benefit: same “prove compliance, hide details” guarantee with less circuit work and easier iteration.
- **Noir** doesn’t add a zkML *functional* benefit for the same logic; it’s a language/ecosystem choice at higher cost.
