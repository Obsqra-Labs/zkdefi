# Advanced L3 + EZKL On-Chain (Phased) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Phase 1 (one heavier Groth16 + one heavier STARK circuit on L3), then provide clear phased tasks for Path A (Noir HONK), Path C (L1 Sepolia), and Path B (Cairo KZG).

**Architecture:** Phase 1 adds two new circuits and their L3 verifiers; routing by `circuit_name` in parent backend and zkdefi pipeline. Phases 2–4 add EZKL-on-chain paths per design doc.

**Tech Stack:** Circom, snarkjs, Garaga (Groth16); Stone/Integrity (STARK); Noir/Garaga HONK (Phase 2); Solidity + L1→L2 (Phase 3); Cairo BN254/KZG (Phase 4).

**Design reference:** `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-design.md`

---

## Phase 1: Advanced L3 Circuits (implement first)

### Task 1.1: Heavier Groth16 circuit — Circom and build

**Files:**
- Create: `circuits/ModelBridgeHeavy.circom` (or `AllocationGateV2.circom`)
- Create: `circuits/build_model_bridge_heavy.sh`
- Modify: `circuits/` build docs if present

**Step 1:** Add a new Circom circuit that is strictly heavier than ModelBridge (e.g. 16 outputs instead of 8, or extra constraints). Reuse same pattern: private inputs (model_output, ezkl_proof_hash, model_weights_hash), public (expected_model_hash, bounds, timestamp). Ensure it compiles with existing circom/snarkjs setup.

**Step 2:** Add `build_model_bridge_heavy.sh` that runs circom compile, snarkjs setup, and produces `ModelBridgeHeavy_final.zkey`, `ModelBridgeHeavy_js/ModelBridgeHeavy.wasm`, `ModelBridgeHeavy_verification_key.json` under `circuits/build/`.

**Step 3:** Run `bash circuits/build_model_bridge_heavy.sh` and confirm artifacts exist.

**Step 4:** Commit with message: `feat(circuits): add ModelBridgeHeavy circuit and build script`

---

### Task 1.2: Garaga verifier for ModelBridgeHeavy and L3 deploy script

**Files:**
- Create: `circuits/generate_model_bridge_heavy_verifier.sh` (mirror `generate_model_bridge_verifier.sh`, use ModelBridgeHeavy vkey)
- Modify: `backend/deploy_verifiers_l3.py` (parent repo) — add MODEL_BRIDGE_HEAVY_SIERRA / CASM paths; declare/deploy step for ModelBridgeHeavy when artifacts exist; print `L3_MODEL_BRIDGE_HEAVY_VERIFIER_ADDRESS` (or `L3_HEAVY_GROTH16_VERIFIER_ADDRESS`)

**Step 1:** Run Garaga gen from ModelBridgeHeavy vkey into a new folder (e.g. `garaga_verifier_model_bridge_heavy`). Fix Scarb.toml inlining-strategy and copy groth16_verifier.cairo if needed; run scarb build. Document artifact paths.

**Step 2:** In parent backend `deploy_verifiers_l3.py`, add constants for ModelBridgeHeavy Sierra/CASM (under zkdefi circuits/contracts); add a deploy block that declares and deploys this verifier when files exist; append to `.env` output line for the new address.

**Step 3:** Commit (in parent backend): `feat(l3): deploy ModelBridgeHeavy verifier on L3`

---

### Task 1.3: Parent backend — config and routing for heavy Groth16

**Files:**
- Modify: `backend/app/config.py` — add `L3_HEAVY_GROTH16_VERIFIER_ADDRESS` (or `L3_MODEL_BRIDGE_HEAVY_VERIFIER_ADDRESS`)
- Modify: `backend/app/services/l3_verification_service.py` — add `_heavy_groth16_verifier` from settings; in `_groth16_verifier_for_circuit(circuit_name)` return it when `circuit_name` is e.g. `ModelBridgeHeavy`; add `heavy_groth16_available` and expose in `get_stats` / `get_proving_paths`; add to health probe contract list

**Step 1:** Add config key and service field; implement routing by circuit_name (e.g. `"ModelBridgeHeavy"` → heavy verifier).

**Step 2:** Add proving path entry for heavy Groth16 (id e.g. `groth16_heavy`, applicable_to `["ModelBridgeHeavy"]`). Add health probe check for the new address.

**Step 3:** Run existing L3 tests (e.g. `pytest backend/tests/test_l3_proving_paths.py -v`) and ensure no regression; new path appears when env is set.

**Step 4:** Commit: `feat(l3): route ModelBridgeHeavy to L3 heavy Groth16 verifier`

---

### Task 1.4: zkdefi — circuit scanner and Groth16 prover for ModelBridgeHeavy

**Files:**
- Modify: `backend/app/services/zkml/circuit_scanner.py` — add CIRCUIT_REGISTRY entry for `ModelBridgeHeavy` (wasm, zkey, witness_js paths); add `build_model_bridge_heavy_inputs` if needed
- Modify: `backend/app/services/groth16_prover.py` — add MODEL_BRIDGE_HEAVY_* paths and `generate_model_bridge_heavy_proof()` (same pattern as ModelBridge); Garaga formatter for the new circuit
- Modify: `backend/app/services/proof_pipeline.py` — when building bridge bundle or ML proofs, support circuit_name `ModelBridgeHeavy` and call the new prover; pass through to L3 with `circuit_name="ModelBridgeHeavy"`

**Step 1:** Register circuit; add input builder and prover; wire pipeline to produce real calldata for ModelBridgeHeavy when requested.

**Step 2:** Add a test or manual check: generate proof for ModelBridgeHeavy and verify payload contains Garaga-format calldata. Optionally call L3 (if L3 verifier is deployed) and assert verified_on_chain.

**Step 3:** Commit: `feat(zkdefi): ModelBridgeHeavy circuit in scanner and pipeline`

---

### Task 1.5: Heavier STARK circuit — define and build

**Files:**
- Locate or create: new Cairo0/Stone circuit under `integrity/` or existing Stone layout (see `archive/ideas/docs` for reputation circuits)
- Modify: Stone config / layout to include new circuit; document circuit name and proof format

**Step 1:** Choose one heavier STARK circuit (e.g. extended reputation or constraint check with more steps). Add or extend Cairo0 source; ensure Stone can produce a proof and fact hash.

**Step 2:** Build and run Stone for the new circuit; confirm proof and calldata format match what L3 Integrity (or the verifier) expects. Document `circuit_name` (e.g. `StarkHeavyReputation`).

**Step 3:** If a new verifier contract is required for this circuit, add deploy path in parent backend (Integrity-style) and config; otherwise document that existing Integrity verifier on L3 is used and add circuit_name to `applicable_to` for `stark_integrity` path.

**Step 4:** Commit: `feat(circuits): add heavier STARK circuit for L3`

---

### Task 1.6: Parent backend — route heavier STARK circuit on L3

**Files:**
- Modify: `backend/app/services/l3_verification_service.py` — ensure `_verify_stark` is used when proof_type is stark and circuit_name is the new one; if new verifier deployed, add `_integrity_heavy_verifier` and route by circuit_name; expose in get_proving_paths
- Modify: `backend/app/config.py` — add `L3_INTEGRITY_HEAVY_VERIFIER_ADDRESS` only if a separate verifier is deployed

**Step 1:** If same Integrity verifier: add new circuit_name to `applicable_to` for `stark_integrity` and ensure backend sends that circuit_name when submitting the new STARK proof. If new verifier: add config, service field, and routing.

**Step 2:** Test: submit STARK proof for the new circuit to L3 and confirm verified_on_chain or hash-only fallback as designed.

**Step 3:** Commit: `feat(l3): route heavier STARK circuit on L3`

---

### Task 1.7: zkdefi — pipeline and API for heavier STARK

**Files:**
- Modify: `backend/app/services/proof_pipeline.py` or reputation/onboarding flow — when generating STARK proof for the new circuit, set `circuit_name` and send to L3 path
- Modify: any API that returns proving paths or circuit list — include the new STARK circuit and its L3 availability

**Step 1:** Wire pipeline so that when the heavier STARK circuit is requested (e.g. by tier or action), proof is generated and sent to L3 with correct circuit_name.

**Step 2:** Smoke test or integration test: request proof for new circuit, verify L3 response.

**Step 3:** Commit: `feat(zkdefi): pipeline support for heavier STARK on L3`

---

## Phase 2: Path A — Noir HONK Bridge (outline)

- **Task 2.1:** Add Noir project/circuit that constrains (model_hash, output, bounds); build and test locally.
- **Task 2.2:** Generate HONK verifier with Garaga (`garaga gen --system UltraKeccakHonk`); deploy on L2 and L3; add config and routing in parent backend.
- **Task 2.3:** Backend proof pipeline: Noir prove → HONK proof → format for Garaga HONK; new ProofMode or path (e.g. `NOIR_HONK`); circuit_name for routing.
- **Task 2.4:** ZkmlVerifier or new entrypoint: call HONK verifier contract when circuit_name indicates Noir; L3 deploy and register.
- **Task 2.5:** Docs and gas note (~178M); update RECURSIVE_EZKL_ROADMAP.md status.

---

## Phase 3: Path C — L1 Solidity Bridge (Ethereum Sepolia) (outline)

- **Task 3.1:** Deploy EZKL-generated Solidity verifier to **Ethereum Sepolia**; document address and RPC.
- **Task 3.2:** Implement L1→L2 messaging: Starknet contract that receives messages from Sepolia bridge; validate and store (model_hash, output_commitment, verified=true).
- **Task 3.3:** Backend: for chosen flows (e.g. certification), trigger L1 verify and poll for L2 confirmation; config for Sepolia RPC and contract addresses.
- **Task 3.4:** Docs: Sepolia addresses, env vars, L1→L2 message format.

---

## Phase 4: Path B — Cairo Native KZG (outline)

- **Task 4.1:** Cairo BN254 pairing/KZG verification module (or Garaga-based); match EZKL/Halo2 proof format.
- **Task 4.2:** Contract with `verify_kzg` (or equivalent); deploy on L3 first (zero gas); optional L2 when gas acceptable.
- **Task 4.3:** Backend: ProofMode/path for native KZG; send EZKL proof to contract; document gas and scope.
- **Task 4.4:** Update roadmap and spec with final trust model.

---

## Execution Notes

- Implement **Phase 1** (Tasks 1.1–1.7) first; Phases 2–4 are outlines to be expanded into full task-by-task plans when starting each phase.
- For Phase 1, run in zkdefi repo for circuit/pipeline work and parent backend repo for L3 config/deploy/routing.
- After Phase 1: run L3 deploy script with ModelBridgeHeavy artifacts present; set `L3_HEAVY_GROTH16_VERIFIER_ADDRESS` (or chosen name) in parent backend .env; run proving path tests.

---

## Verification (Phase 1)

- New Groth16 circuit builds and produces Garaga-format calldata.
- L3 verifier for ModelBridgeHeavy deployed; parent backend routes `circuit_name=ModelBridgeHeavy` to it; health probe shows verifier.
- New STARK circuit produces proof; L3 verifies via Integrity (or new verifier); proving paths list it.
- No regression: existing ModelBridge, RiskScore, Anomaly, and STARK reputation paths still work on L2/L3.
