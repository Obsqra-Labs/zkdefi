# Sigma Protocol: "I Know the Secret of This Commitment" — Implementation Plan

Lightweight proof verified in Cairo (no Circom/Groth16). Use case: relayer eligibility, rate-limiting, Sybil resistance.

---

## 1. Choice of commitment and curve

- **Pool today:** Poseidon(secret, amount, pool_type, nonce, blinding) → field element. Proving "I know preimage" for Poseidon with a *pure* Sigma protocol is not standard (Poseidon isn’t a group homomorphism).
- **For Sigma:** Use an **elliptic-curve (Pedersen-style) commitment** so the relation is "I know (secret, blinding) such that C = secret·G + blinding·H". That’s a classic Schnorr-style relation.

**Curve:** **Stark curve** (Starknet’s native curve). Cairo has `ec_op` (point add, scalar mul). No BN254/Garaga needed for this path.

- **G, H:** Fixed independent generators on the Stark curve (e.g. from standard specs or derived).
- **Commitment:** C = secret·G + blinding·H (point).
- **Opening:** (secret, blinding) — scalars in the Stark curve scalar field.

This is **separate** from the pool’s Poseidon commitment: use it only for “prove I’m allowed” (e.g. relayer eligibility). Pool notes stay Poseidon + Groth16 for actual withdraw.

---

## 2. Proof system (Fiat–Shamir Schnorr)

**Relation:** Prover knows (secret, blinding) such that C = secret·G + blinding·H.

**Non-interactive (Fiat–Shamir):**

1. Prover samples random a, b (scalars).
2. A = a·G + b·H (point).
3. Challenge: c = H(A, C, context) → scalar (e.g. hash to curve scalar field).
4. Responses: s1 = a + c·secret, s2 = b + c·blinding.
5. Proof = (A, s1, s2). Commitment C is public.

**Verification (Cairo):**

- c = H(A, C, context).
- Check: s1·G + s2·H = A + c·C (point equality).

Requires in Cairo: one hash (e.g. Pedersen or Poseidon over A,C,context), EC point add, EC scalar mul. Starknet’s `ec_op` provides the curve ops.

---

## 3. Implementation pieces

### 3.1 Cairo verifier contract

- **Inputs:** commitment C (two felts: x, y of point, or compressed), proof (A as two felts, s1, s2).
- **Output:** bool (proof valid or not).
- **Steps:**
  1. Recompute c = H(A, C, context).
  2. LHS = s1·G + s2·H (two scalar muls + add).
  3. RHS = A + c·C (scalar mul + add).
  4. Return LHS == RHS.

**Cairo:** Use Stark curve builtins / `ec_op`. Hash: use `starknet::pedersen_hash` or a Poseidon that takes (Ax, Ay, Cx, Cy, context) and outputs a scalar (reduce mod curve order).

**Contract surface:** e.g. `verify_commitment_opening(commitment: (felt252,felt252), proof: (felt252,felt252,felt252,felt252)) -> bool` where proof is (Ax, Ay, s1, s2) and commitment is (Cx, Cy).

### 3.2 Off-chain prover (Python)

- **Input:** (secret, blinding, commitment C).
- **Output:** (A, s1, s2) and C (for the contract).
- Use `starknet_py` or an EC lib for the Stark curve: point mul, point add, sample random a,b, compute A, then c = H(A,C,context), then s1, s2.
- **Hash for challenge:** Same as Cairo (e.g. Pedersen over encoding of A, C, context; then reduce to scalar). Must be deterministic and match the contract.

**Backend endpoint (optional):** e.g. `POST /api/v1/zkdefi/eligibility/prove_commitment` body `{ "secret", "blinding", "commitment_x", "commitment_y" }` → returns `{ "A_x", "A_y", "s1", "s2" }` so the frontend can call the contract.

### 3.3 Frontend / relayer flow

- **Eligibility commitment:** User gets (secret, blinding) and C off-chain (e.g. after KYC or from a “ticket” the relayer issues). C is registered in a contract or relayer allow-list.
- **To use relayer:** User (or backend) computes proof (A, s1, s2) from (secret, blinding, C). User submits (C, proof) to relayer or contract.
- **Contract:** Verifies `verify_commitment_opening(C, proof)` and checks C is in the allowed set (or that C was issued by the relayer). Then relayer accepts the Tier 2/3 request.

No Circom, no Groth16, no Garaga for this path.

---

## 4. Difficulty estimate

| Piece              | Effort | Notes                                                                 |
|--------------------|--------|-----------------------------------------------------------------------|
| Cairo verifier     | Medium | EC ops + hash; Stark curve builtins exist; main work is encoding and one hash. |
| Challenge hash     | Low    | Pedersen/Poseidon over (A, C, context) → scalar; match prover/verifier. |
| Off-chain prover   | Low    | Small Python/JS using Stark curve lib; ~50–100 LOC.                    |
| Contract + deploy  | Low    | One new contract or one function in relayer contract.                |
| Integration        | Low    | Relayer checks proof + allowed C before processing Tier 2/3.        |

Overall: **medium** (a few days for a minimal end-to-end: verifier contract, prover, one relayer check).

---

## 5. Where it lives in the repo (suggested)

- **Contract:** `contracts/src/sigma_commitment_verifier.cairo` (or `relayer.cairo` with a single function).
- **Prover:** `backend/app/services/sigma_commitment_prover.py` + optional `backend/app/api/routes/eligibility.py`.
- **Docs:** This file; optional one-line in [HACKATHON_IDEAS_MATRIX.md](HACKATHON_IDEAS_MATRIX.md) when implemented.

---

## 6. Sigma instead of trusted ceremony in the dual proof system?

**Today:** Privacy = Garaga (Groth16) → **trusted setup** (tau ceremony, circuit-specific zkey). Execution = Integrity (STARK) → **no trusted setup**.

**Can we use Sigma instead of the trusted ceremony?**

- **For the *same* statements (full withdraw, zkML):** **No.** Sigma protocols prove *simple* relations: "I know the discrete log," "I know the opening of this Pedersen commitment." They don't scale to "I know a Merkle path + nullifier derivation + amount + recipient" in a succinct way. That's a *circuit* — you need either a SNARK (with setup) or a STARK (no setup). So we **cannot** replace the Groth16 trusted ceremony with Sigma for full-privacy withdraw or zkML; the statement is too complex for Sigma.

- **For a *subset* of use cases:** **Yes.** Use Sigma (no setup) for **light** proofs: "I know the secret of this commitment" (eligibility, rate-limiting). Keep Groth16 (with ceremony) for **heavy** proofs: full withdraw, zkML. Result: **partial** removal of trusted setup — the eligibility path is trustless; the full-privacy path still uses the ceremony.

- **To remove the trusted ceremony *entirely*:** Replace **Groth16 with STARK** (or another transparent system) for the privacy circuits. Then:
  - **Dual proof = Sigma (simple, no setup) + STARK (complex, no setup).**
  - No tau ceremony at all.
  - Tradeoff: you'd need to port the Circom full-privacy and zkML circuits to a STARK-friendly representation (e.g. AIR) and use a STARK prover (e.g. Stone/Integrity or another). Bigger lift than "add Sigma for eligibility."

**Summary**

| Goal | Approach |
|------|----------|
| Use Sigma *instead of* ceremony for full withdraw/zkML | Not possible (Sigma can't express those statements). |
| Use Sigma *alongside* Groth16 so part of the system is trustless | Yes — Sigma for eligibility; Groth16 for full withdraw/zkML. |
| Remove ceremony from the whole dual system | Replace Groth16 with STARK for privacy circuits; dual = Sigma + STARK, both trustless. |

---

## 6.1 Giza → AIR → Stone/Integrity: does it map?

**Short answer:** For **zkML** it can map (Giza → Cairo → Stone → Integrity). For **full-privacy (Circom)** there is **no path today**; Stone proves Cairo execution, not Circom circuits.

**Stone today:** Stone proves **Cairo program execution**. Flow: Cairo program runs → execution trace → Stone produces STARK proof of that trace → Integrity verifies and registers fact_hash. The “AIR” is the one implied by **Cairo execution** (Stone is built for Cairo traces). Stone is not “upload an arbitrary AIR”; it’s “run this Cairo program, I’ll prove the trace.”

**Giza/Orion:** Compiles **ML models (e.g. ONNX) → Cairo**. So Giza’s output is a **Cairo program**. If you run that program, you get a Cairo execution trace. That trace is exactly what Stone can prove. So:

- **zkML path:** Giza (model → Cairo program) → run the Cairo program → Stone (Cairo trace → STARK proof) → Integrity. **It maps.** You don’t need “Giza for the AIR” as a separate step—Giza gives you Cairo; the AIR is the Cairo VM’s, which Stone already knows. **Gap:** Your Stone/Integrity pipeline is currently wired to a **specific** program (e.g. risk/onboarding with `jediswap_metrics`, `ekubo_metrics`). To use Giza you’d wire Stone to accept/run a **Giza-generated Cairo program** (or its trace) and prove it, then register the fact. So the path exists; the work is integration (new program/trace input, same Stone + Integrity).

- **Full-privacy (Circom) path:** The full-privacy circuit is **Circom** (R1CS, BN254) → Groth16. Stone proves **Cairo**, not Circom. There is **no** “Circom → AIR” or “Circom → Cairo” in your stack today. Giza does **ONNX → Cairo**, not Circom → Cairo. So: **no path** to “full-privacy circuit → Giza for AIR → Stone/Integrity” unless you **port** the full-privacy logic (Merkle path, nullifier, amount) to a **Cairo program** by hand or via a custom translator. Then Stone could prove that Cairo program. That’s a rewrite, not “plug in Giza for the AIR.”

**Summary**

| Proof type | Giza for “AIR”? | Stone/Integrity | Path today? |
|------------|------------------|------------------|-------------|
| zkML (risk, anomaly, etc.) | Giza gives **Cairo** (model → Cairo); AIR = Cairo execution | Stone proves Cairo trace; Integrity registers | **Yes, conceptually.** Wire Stone to Giza-generated Cairo program/trace; no trusted setup for that path. |
| Full-privacy withdraw (Circom) | Giza is for ML → Cairo, not Circom → AIR | Stone proves Cairo only | **No.** Would need Circom → Cairo port; then Stone can prove it. |

So: **for zkML**, “Giza for the model → Cairo, then my Stone/Integrity” does map; for **full-privacy**, there’s currently no path without porting the circuit to Cairo.

---

## 7. References

- Stark curve: Starknet docs (curve parameters, base point G).
- Fiat–Shamir Schnorr: e.g. “Proof of knowledge of discrete log” + “Fiat–Shamir transform.”
- Cairo EC: `ec_op` builtin; Pedersen hash in `starknet` crate.
