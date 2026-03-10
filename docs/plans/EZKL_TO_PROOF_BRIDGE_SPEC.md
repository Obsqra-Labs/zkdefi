# EZKL → Proof Bridge: Spec & Worthwhileness

**Purpose:** Single reference for the **EZKL-to-Groth16 proof bridge** (ModelBridge): what it is, how it works, current state, and whether completing it is a high-value unlock.

---

## 1. What It Is (Technical Wording)

- **zkML proof bridge** — A layer that takes the output of an **EZKL** (Halo2/KZG) ML inference proof and turns it into a **Groth16** proof that Starknet can verify via **Garaga**.
- **Trust model:** EZKL proof is verified **off-chain**; the bridge circuit (ModelBridge) **commits** to (model hash, output, EZKL proof hash, bounds) and produces a Groth16 proof. On-chain you only verify the Groth16 proof (~34M gas); you do **not** verify the original EZKL/KZG proof on-chain.
- **Alternative names you might use:** “EZKL–Groth16 bridge”, “ML proof bridge”, “ModelBridge pipeline”, “zkML proof gate”.

---

## 2. Intended Architecture (Target Design)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. ONNX model inference (e.g. yield allocation, risk score)               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. EZKL prove (Halo2/KZG)                                                │
│    Output: proof, public_inputs, model_hash, inference output [y1..yN]   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Off-chain: verify EZKL proof (trust: backend / verifier service)      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. ModelBridge.circom (Groth16)                                          │
│    Private: model_output[8], ezkl_proof_hash, model_weights_hash        │
│    Public:  expected_model_hash, output_lower_bound, output_upper_bound,  │
│             timestamp                                                    │
│    Proves:  model identity + all outputs in [lower, upper]               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. snarkjs Groth16 prove → format for Garaga (MSM hints, felt252)       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Starknet L3: zkml_verifier.verify_model_bridge_proof(                 │
│      proof_calldata, model_hash, output_commitment, bridge_commitment)    │
│    Garaga verifies Groth16 BN254 (~34M gas)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data flow in one line:**  
ONNX → EZKL prove → off-chain EZKL verify → ModelBridge witness → Groth16 prove → Garaga on-chain verify.

---

## 3. Component Spec

### 3.1 EZKL (upstream)

- **Role:** Prove “I ran this ONNX model on this input and got this output” using Halo2/KZG.
- **Outputs we care about:** `inference_output` (e.g. 8 scalars), `proof` (or proof hash), `model_hash` (or equivalent).
- **Current in repo:** No live EZKL prover in the request path. Pipeline uses a **synthetic** EZKL substitute (hash-based placeholder) for development and demos. Real EZKL would be either:
  - EZKL CLI / lib in backend, or
  - External EZKL proving service called by the backend.

### 3.2 ModelBridge circuit (Circom)

- **File:** `circuits/ModelBridge.circom`
- **Public inputs:** `expected_model_hash`, `output_lower_bound`, `output_upper_bound`, `timestamp`
- **Private inputs:** `model_output[8]`, `ezkl_proof_hash`, `model_weights_hash`
- **Constraints:**
  - `model_weights_hash === expected_model_hash`
  - For each `i`: `output_lower_bound <= model_output[i] <= output_upper_bound`
- **Outputs:** `is_valid`, `public_commitment` (set to `ezkl_proof_hash`)
- **Artifacts:** `ModelBridge_final.zkey`, `ModelBridge_js/ModelBridge.wasm`, verification key; all present and used by circuit scanner / build.

### 3.3 Proof pipeline (backend)

- **Service:** `backend/app/services/proof_pipeline.py`
- **Modes:** `ProofMode.EZKL_ONLY` (0), `EZKL_BRIDGE` (1), `FULL_DUAL_PROVER` (2).
- **For ML proofs:** `generate_ml_proofs()`:
  1. Resolves mode from tier / action / value.
  2. Generates a **synthetic** EZKL-style proof (`_generate_synthetic_ezkl_proof`).
  3. If mode ≥ EZKL_BRIDGE, builds a **bridge bundle** (`_build_bridge_bundle`) with:
     - `bridge_proof` (success, is_compliant, proof_hash, proof metadata, public_signals),
     - `bridge_fact_hash`,
     - `model_bridge_calldata` = list of hex felts.
  4. For L3, calls `_verify_l3_bridge` with `circuit_name="ModelBridge"` and that calldata.

- **Gap:** `model_bridge_calldata` is **not** produced by running the ModelBridge circuit. It is a 6-felt list derived from hashes and metadata (`model_bridge`, `effective_model_hash`, `output_commitment`, `bridge_fact_hash`, `ts`, `ezkl_proof_hash`). Garaga expects **real** Groth16 proof calldata (pi_a, pi_b, pi_c + public inputs in Garaga format). So **L3 verification fails** when strict verification is on (e.g. “Strict L3 verification failed”).

### 3.4 On-chain verifier (Starknet)

- **Contract:** `contracts/src/zkml_verifier.cairo`
- **Entrypoint:** `verify_model_bridge_proof(proof_calldata, model_hash, output_commitment, bridge_commitment)`
- **Behavior:** Calls Garaga’s `verify_groth16_proof_bn254(proof_calldata)`; then writes proof record and emits `ModelBridgeVerified`.
- **Expectation:** `proof_calldata` must be Garaga-format Groth16 (BN254) calldata for the **ModelBridge** circuit’s verification key.

### 3.5 Circuit scanner / input builder

- **File:** `backend/app/services/zkml/circuit_scanner.py`
- **Function:** `build_model_bridge_inputs(...)` builds the exact input dict for ModelBridge (model_output, ezkl_proof_hash, model_weights_hash, expected_model_hash, bounds, timestamp).
- **Use:** Ready for when the pipeline actually runs the ModelBridge circuit (witness + snarkjs + Garaga formatter).

---

## 4. Current State Summary

| Layer              | Status | Notes |
|--------------------|--------|--------|
| EZKL               | Synthetic | Hash-based placeholder; no real EZKL prove in pipeline |
| EZKL verify        | N/A    | Would run off-chain before bridge |
| ModelBridge.circom | Ready  | Compiled; zkey, WASM, vkey present |
| ModelBridge prove  | Missing | Pipeline does not run snarkjs on ModelBridge |
| Bridge calldata    | Placeholder | 6 felts = metadata, not Garaga Groth16 |
| Garaga / L3        | Ready  | Contract and verifier exist; fail because calldata invalid |
| ProofMode / API    | Live   | EZKL_BRIDGE mode and L3 path exercised; trust_warning in response |

So: **architecture and contracts are in place; the missing piece is the backend actually producing a real ModelBridge Groth16 proof and Garaga-formatted calldata.**

---

## 5. What “Completing the Unlock” Means

To make the bridge **functional** end-to-end (on-chain verification succeeding):

1. **EZKL (choose one):**
   - **Option A:** Integrate real EZKL (CLI or service): ONNX → EZKL prove → get (proof, output, model_hash); verify proof off-chain.
   - **Option B:** Keep synthetic EZKL for dev/demo but treat it as non-trustless (current behavior, no change).

2. **ModelBridge proof generation (required):**
   - From EZKL output (or synthetic): build witness using `build_model_bridge_inputs`.
   - Run ModelBridge WASM to get witness, then `snarkjs groth16 prove` with `ModelBridge_final.zkey`.
   - Run proof + public signals through **Garaga formatter** (same pattern as `PrivateDeposit` / `PrivateWithdraw` in `groth16_prover.py`).
   - Set `model_bridge_calldata` to this formatted calldata; keep passing `model_hash`, `output_commitment`, `bridge_commitment` as today.

3. **L3 call:** Unchanged. `_verify_l3_bridge` already passes `circuit_name="ModelBridge"` and calldata to the L3 proving path client; once calldata is real, Garaga should accept it (same vkey as in repo).

4. **Optional:** Add a small EZKL prover service or script (e.g. in `backend/app/services/` or `backend/app/ml/`) for real ONNX→EZKL proofs when you want trustless inference (then the only trust is “someone ran EZKL and we verified it off-chain before bridging”).

### Phase 1 status (implemented)

- **`backend/app/services/groth16_prover.py`**: Added `MODEL_BRIDGE_*` paths and `generate_model_bridge_proof()`. Builds witness, runs snarkjs groth16 prove, formats with Garaga, returns `proof_calldata`.
- **`backend/app/services/proof_pipeline.py`**: In `_build_bridge_bundle`, calls `Groth16Prover.generate_model_bridge_proof()` when building the bridge; on success uses real calldata for L3; on failure (missing WASM/zkey, snarkjs/garaga error) falls back to placeholder and logs a warning.
- **To run with real proofs:** Ensure `circuits/build/ModelBridge_js/ModelBridge.wasm`, `circuits/build/ModelBridge_final.zkey`, and `circuits/build/ModelBridge_verification_key.json` exist (run `circuits/build_model_bridge.sh` if needed). Then `generate_ml_proofs(..., proof_mode=EZKL_BRIDGE, execution_chain="l3")` will use real Groth16 calldata when the L3 path is available.

---

## 6. Worthwhileness Evaluation

### What the bridge gives you

- **On-chain guarantee:** “A Groth16 proof was verified that commits to (model hash, output in [L,U], EZKL proof hash).” So you can gate actions (rebalance, allocation, risk gates) on **attested ML outputs** without putting a full EZKL/KZG verifier on-chain.
- **Cost:** ~34M gas per verification (same as other Groth16 circuits via Garaga).
- **Reuse:** Same Garaga BN254 stack you already use for RiskScore, AnomalyDetection, PrivateDeposit/Withdraw, etc.

### Trust vs full trustlessness

- **Current / “pragmatic bridge”:** Trust that the backend (or a designated verifier) correctly ran EZKL and only then produced the ModelBridge proof. On-chain you only verify the Groth16 bridge.
- **Full trustlessness** would require verifying the EZKL (KZG/Halo2) proof on-chain (see `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md`: Noir HONK bridge, L1 Solidity bridge, or native Cairo KZG). That’s a larger project (weeks/months) and higher gas (~178M+ or cross-chain).

### When it’s worthwhile

- **Worth doing (complete the bridge):**
  - You want **ML-gated rebalancing or allocation** (e.g. “only rebalance if model says so”) with on-chain verification of the **commitment** to that ML result.
  - You’re okay with the **pragmatic** trust model (off-chain EZKL verify, on-chain Groth16 bridge).
  - You want to **reuse** existing Garaga/L3 infra and keep gas at ~34M per proof.
  - Demos and partners expect “proof-gated ML” to actually verify on L3.

- **Lower priority:**
  - You don’t need on-chain ML attestation yet (e.g. pure off-chain ML with no proof flow).
  - You need **full** trustlessness (KZG on-chain) — then the bridge is a stepping stone but you’ll still need Path A/B/C from the roadmap.
  - Throughput is huge and 34M gas per proof is too high; then you’d look at batching or different proof systems later.

### Effort vs impact (rough)

- **To “working bridge” (synthetic EZKL + real ModelBridge Groth16):**  
  - Implement ModelBridge proving in the pipeline (witness → snarkjs → Garaga format) and plug the result into existing L3 call.  
  - Order of magnitude: **days** (assuming Circom/snarkjs/Garaga toolchain already work for other circuits).
- **To “real EZKL + bridge”:**  
  - Add EZKL integration (model export + prove + verify off-chain) then feed outputs into the same ModelBridge step.  
  - Order of magnitude: **1–2 weeks** depending on EZKL setup and model format.

---

## 7. Recommendation

- **Treat the EZKL → proof bridge as a worthwhile unlock** if you care about on-chain, proof-gated ML (rebalance, allocation, risk) with the pragmatic trust model and ~34M gas.
- **Complete it in two steps:**
  1. **Phase 1:** Add real ModelBridge Groth16 proof generation in the pipeline (reuse `build_model_bridge_inputs`, snarkjs, Garaga formatter). Keep synthetic EZKL so L3 verification can succeed and demos are correct.
  2. **Phase 2 (optional):** Add real EZKL prove + off-chain verify for production ML models when you need attested inference (not just dev/demo).
- **Keep the roadmap** (Noir HONK / L1 / native KZG) for when you need full on-chain verification of the EZKL proof itself; the current bridge stays the right interim design.

---

## 9. L2 vs L3 Deployments: Trustless Meaning, Existing Circuits, and “Advanced Models on L3”

### Q1: What do L2 and L3 deployments of the bridge verifier mean for trustless?

- **On both L2 and L3, the chain verifies the Groth16 proof.** So you get **cryptographic attestation on-chain**: “this proof passed the verifier contract” instead of “trust the backend said it’s valid.” That’s the trustless win: the chain is the authority for the proof.
- **L2 (Starknet):** A user or contract pays gas (~34M for Garaga BN254). Good for permissionless, user-pays flows (e.g. a vault contract that only executes if `verify_model_bridge_proof` succeeds).
- **L3 (Madara):** You control the chain; gas can be zero (operator-subsidized). Verification is **free at point of use**. Good for high-volume or internal flows where you want on-chain attestation without charging users for verification.
- **Caveat:** “Trustless” here is **proof verification** only. The EZKL proof itself is still verified **off-chain** before the bridge; the chain only verifies the ModelBridge Groth16 wrapper. Full trustlessness of the ML inference would require verifying EZKL/KZG on-chain (see roadmap).

### Q2: Do we need “offchain” vs “onchain” versions of existing circuits/models?

**No.** You don’t need separate circuit artifacts for offchain vs onchain.

- **Same circuit, same proof.** One circuit (e.g. ModelBridge, RiskScore, Anomaly) has one verification key (VK). The verifier contract on L2 or L3 is built from that VK. The proof you generate is identical whether you verify it locally (off-chain) or submit it to L2/L3.
- **What you need is routing and the right verifier per circuit:**
  - **ModelBridge** → ModelBridge verifier (dedicated contract on L2 and L3).
  - **RiskScore / Anomaly** → existing Garaga verifier.
  - Backend and L3 service already route by `circuit_name`; we added `circuit_name="ModelBridge"` → ModelBridge verifier on L3 (and on L2 via ZkmlVerifier’s `model_bridge_verifier` slot).
- **If you add a new circuit** (new model, new VK): you deploy a **new** verifier contract for that VK and register it (e.g. new `circuit_name` → address). You don’t duplicate the circuit into “offchain” and “onchain” versions; you have one circuit and choose **where** to verify (off-chain, L2, or L3) by where you send the same proof.

### Q3: Can we run more advanced models on L3 because we control gas? What would that look like?

**Yes.** Because you control L3 gas (zero or subsidized), you can verify **heavier** proofs on L3 that would be too expensive on L2.

- **What “more advanced” can mean:**
  - **Larger Groth16 circuits:** More constraints → more proving time off-chain, but **verification cost on L3 is free**. So you could run a “ModelBridge Heavy” or a second-tier model with more outputs / more constraints and deploy a verifier for it **only on L3** (or on both L2 and L3 but primarily use L3 for that circuit).
  - **STARK (Integrity) on L3:** You already have Integrity on L3 for reputation/Stone proofs. Heavier STARK proofs (more steps) are viable on L3 because verification gas isn’t passed to users.
- **What it would look like in practice:**
  1. **Design a heavier circuit** (e.g. bigger ONNX → EZKL → bridge with more constraints, or a dedicated “advanced” circuit).
  2. **Build and get the VK** (same toolchain: Circom/snarkjs or Garaga generator).
  3. **Deploy the verifier on L3** (and optionally on L2 if you want it there too).
  4. **Register it** in the parent backend (e.g. `L3_<ADVANCED>_VERIFIER_ADDRESS` and route by `circuit_name` or tier).
  5. **Route advanced/high-value flows to L3** so verification is free; keep lighter circuits (RiskScore, current ModelBridge) on both L2 and L3 as today.
- **No change required to existing circuits.** You add **new** circuits/verifiers for “as advanced as we can” and route them to L3; existing ones stay as-is.

---

## 10. References (in repo)

- Design & roadmap: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md`
- Circuit doc: `circuits/CIRCUITS_COMPREHENSIVE_DOCUMENTATION.md` (ModelBridge section)
- Pipeline: `backend/app/services/proof_pipeline.py`
- ModelBridge inputs: `backend/app/services/zkml/circuit_scanner.py` (`build_model_bridge_inputs`)
- L3 verifier: `contracts/src/zkml_verifier.cairo` (`verify_model_bridge_proof`)
- Groth16 pattern: `backend/app/services/groth16_prover.py`, `backend/app/services/garaga_formatter.py`
