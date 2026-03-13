# Advanced L3 + EZKL On-Chain (Phased) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Phase 1 status:** ✅ Complete (Tasks 1.1–1.7). Run L3 deploy when Madara is up; ensure Obsqra Stone prover supports `stark_heavy_reputation` and `verification/risk_example_cairo0_heavy.cairo`.

**Phase 2 status:** ✅ Complete (Tasks 2.1–2.5) and live. Noir circuit, HONK verifier script, pipeline, and L3 routing are active; strict showcase captured `noir_honk` on-chain receipt (`tx 0x55f1d6cf06ed5e2deaf90c86479c2f03b27ed631478447d14af808f33963475`).

**Phase 3 status:** 🟡 In progress. Task 3.1 (L1 verifier) done; Task 3.2 (L2 receiver) done in zkdefi and deployed on Starknet Sepolia (`0x02ed07ab9be1d632259f3dd1bbeaf6354c20046b6df8659a30e3e97415b1a220`); Task 3.3 (L1 submit) done in parent backend; Task 3.4 (poll L2 + GET `/api/v1/aggregation/l1/verification-status`) done in parent backend; Task 3.5 docs updated.

**Phase 4 status:** 🟡 In progress. `bridge_circuit=EzklNativeKzg` sends non-empty `kzg_calldata`; Cairo package `circuits/contracts/src/ezkl_kzg_verifier` now performs real BN254 `MPCHECK_BN254_2P_2F` verification when an `ezkl_kzg_v1` payload includes the `kzg_mpcheck_v1` trailer; parent routing validates trailer shape and explicit `native_kzg`/`noir_honk`/`groth16` requests no longer downgrade to hash-only. zkdefi now auto-discovers local EZKL artifacts before fallback, records extractor diagnostics/caching metadata in payloads, and blocks strict native-KZG execution if only placeholder/no-mpcheck payloads are available. Live strict native-KZG pass on Starknet Sepolia confirmed in showcase run (`l3_mode=native_kzg`, tx `0x5c9e21abd2119600421872f0baad9988ea7082eec54bacea8657649a8cf5f42`). Remaining work for full Path B is universal EZKL-to-MPCheck bundle extraction coverage across all model flows and stability/gas benchmarking.

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
- Create: `verification/risk_example_cairo0_heavy.cairo` — 4-pool protocol-agnostic risk (pool_0..pool_3) + aggregate; same Integrity SMALL layout. No deprecated protocol names.
- Create: `verification/STARK_HEAVY_REPUTATION.md` — circuit name `StarkHeavyReputation` / `stark_heavy_reputation`, inputs, and verifier note.

**Step 1:** Heavier STARK circuit added: `risk_example_cairo0_heavy.cairo` (4× calculate_risk_score + sum constraint). Protocol-agnostic; use with Stone and Integrity small layout.

**Step 2:** Build and run Stone for this program; confirm proof and calldata match L3 Integrity. Document circuit_name in STARK_HEAVY_REPUTATION.md.

**Step 3:** No new verifier contract — existing Integrity verifier on L3 is used. Add circuit_name to `applicable_to` for `stark_integrity` in Task 1.6.

**Step 4:** Commit: `feat(circuits): add heavier STARK circuit StarkHeavyReputation for L3`

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

## Phase 2: Path A — Noir HONK Bridge

**Goal:** EZKL-style bridge circuit in Noir; prove with nargo; verify on L2/L3 via Garaga HONK (~178M gas). Circuit name: `NoirEzklBridge`; ProofMode/path: `NOIR_HONK`.

**Reference:** `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path A; `GARAGA_PROOF_TYPES.md` (noir_ultra_starknet_honk ~178M).

### Task 2.1: Noir project and EZKL-bridge circuit

**Files:**
- Create: `circuits/noir_ezkl_bridge/Nargo.toml` — Noir package config, name `noir_ezkl_bridge`
- Create: `circuits/noir_ezkl_bridge/src/main.nr` — circuit: public (expected_model_hash, output_lower_bound, output_upper_bound), private (model_output); constrain model_output in [lower, upper]; public output is_compliant (1)
- Create: `circuits/noir_ezkl_bridge/README.md` — build (nargo compile), prove (nargo execute / nargo prove), and Garaga HONK verifier note

**Step 1:** Add Noir package under `circuits/noir_ezkl_bridge/` with entrypoint `main.nr`. Circuit semantics: same as ModelBridge (model identity + output bounds); single aggregated model_output (Field) for minimal scaffold.

**Step 2:** Document: `nargo compile` → ACIR/artifact; `nargo execute` with `Prover.toml`/`Verifier.toml` (or equivalent); note that Garaga HONK verifier will be generated in Task 2.2.

**Step 3:** Optional: add `circuits/build_noir_ezkl_bridge.sh` that runs nargo compile and prints artifact path. Require `nargo` on PATH.

**Step 4:** Commit: `feat(circuits): add Noir EZKL-bridge circuit (noir_ezkl_bridge)`

---

### Task 2.2: Garaga HONK verifier and L2/L3 deploy

**Files:**
- Create: `circuits/generate_noir_ezkl_bridge_honk_verifier.sh` — run Garaga for Noir Ultra HONK (e.g. `garaga gen --system UltraStarknetHonk` or per Garaga docs) from noir_ezkl_bridge vkey/artifact; output Cairo verifier package
- Modify: parent repo `backend/deploy_verifiers_l3.py` — add NOIR_EZKL_BRIDGE_HONK Sierra/CASM paths; declare/deploy block; `.env` line `L3_NOIR_EZKL_BRIDGE_HONK_VERIFIER_ADDRESS`
- Modify: parent repo `backend/app/config.py` — add `L3_NOIR_EZKL_BRIDGE_HONK_VERIFIER_ADDRESS` (and L2 if separate)

**Step 1:** Generate HONK verifier with Garaga from the Noir circuit’s verification key (or ACIR artifact). Use Garaga’s Noir/UltraStarknetHonk flow; document exact `garaga gen` command and artifact paths.

**Step 2:** Add deploy step in parent `deploy_verifiers_l3.py` for Noir HONK verifier when artifacts exist; append address to `.env` output.

**Step 3:** Add config key(s) in parent backend for L3 (and L2 if applicable).

**Step 4:** Commit (parent): `feat(l3): deploy Noir EZKL-bridge HONK verifier on L3`

---

### Task 2.3: Parent backend — routing and proving path for NOIR_HONK

**Files:**
- Modify: `backend/app/services/l3_verification_service.py` — add `_noir_honk_verifier`; route when proof_type is HONK / circuit_name `NoirEzklBridge`; add proving path entry (id e.g. `noir_honk`, applicable_to `["NoirEzklBridge"]`); expose in get_stats / get_proving_paths; add to health probe
- Modify: `backend/app/config.py` — ensure L3 Noir HONK verifier address is read and passed to service

**Step 1:** Route `NoirEzklBridge` / NOIR_HONK to the new HONK verifier contract; expose path in API and health probe.

**Step 2:** Run L3 proving path tests; ensure new path appears when env is set.

**Step 3:** Commit: `feat(l3): route NoirEzklBridge to L3 HONK verifier`

---

### Task 2.4: zkdefi — proof pipeline and NOIR_HONK path

**Files:**
- Modify: `backend/app/services/proof_pipeline.py` — support ProofMode or circuit path `NOIR_HONK` / `NoirEzklBridge`; when building ML/bridge proof for this path, call Noir prover (nargo prove) and format proof for Garaga HONK; pass circuit_name and proof to L3
- Modify or add: prover module for Noir (e.g. `backend/app/services/noir_prover.py`) — `generate_noir_ezkl_bridge_proof(expected_model_hash, output_lower_bound, output_upper_bound, model_output)` → proof bytes + public inputs for Garaga HONK
- Modify: `backend/app/services/zkml/circuit_scanner.py` — register `NoirEzklBridge` (type NOIR_HONK, artifact path, no wasm/zkey); or keep scanner Groth16-only and add separate Noir circuit list

**Step 1:** Implement Noir proof generation (nargo prove with inputs) and Garaga HONK calldata formatting. Wire pipeline to use it when circuit is `NoirEzklBridge` or proof mode is NOIR_HONK.

**Step 2:** Optional: add API or existing risk_passport/onboarding flow to request Noir HONK proof and submit to L3.

**Step 3:** Commit: `feat(zkdefi): pipeline and prover for Noir EZKL-bridge (NOIR_HONK)`

---

### Task 2.5: ZkmlVerifier / entrypoint and docs

**Status:** Done. Backend calls HONK verifier on L3 when `proof_type=noir_honk` and `honk_calldata` provided; no separate ZkmlVerifier entrypoint required for L3 path. RECURSIVE_EZKL_ROADMAP updated.

**Files:**
- Modified: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` — Path A status and Phase 2 progression updated
- Modified: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` — Phase 2 status at top

---

## Phase 3: Path C — L1 Solidity Bridge (Ethereum Sepolia)

**Goal:** Verify EZKL (KZG) on Ethereum Sepolia; bridge result to Starknet via L1→L2 message. Use for time-insensitive flows (certification, audits, model registration).

**Reference:** `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path C; design doc §5.

**While waiting for Sepolia ETH (faucet):** You can (1) obtain an Sepolia RPC URL (e.g. Alchemy/Infura) and set `L1_SEPOLIA_RPC`, (2) implement the web3/L1 submit logic in `l1_ezkl_bridge_service` (calls will fail until the verifier is deployed), (3) implement L2 polling for the receiver contract, (4) prepare the EZKL Solidity verifier build and a deploy script (Foundry/Hardhat/Remix). Faucet options and env usage are documented in `docs/plans/L1_SEPOLIA_EZKL_VERIFIER.md` §0.

**Phase 3 one-shot (do it all):** Run from repo root with `L1_SEPOLIA_MNEMONIC`, `L1_SEPOLIA_KEYSTORE_PASSWORD`, and `L1_SEPOLIA_RPC` set. Script: `python3 scripts/l1_sepolia_ezkl_verifier_one_shot.py`. It (1) creates `backend/.l1-sepolia-keystore.json` from the mnemonic if missing, (2) generates `contracts/l1_ezkl/EZKLVerifier.sol` and ABI via `ezkl.create_evm_verifier` using the creditworthiness EZKL model (vk/settings/srs), (3) runs Foundry compile. For large Halo2 verifiers that fail with Yul stack-limit, use `bash contracts/l1_ezkl/build_halo2_verifier.sh` (fallback: `FOUNDRY_VIA_IR=false` + solc `0.8.24`). If an artifact exists (e.g. `contracts/l1_ezkl/out/EZKLVerifier.sol/Halo2Verifier.json` or exported `contracts/l1_ezkl/EZKLVerifier_artifact.json`), then (4) deploy to Sepolia and set `L1_EZKL_VERIFIER_ADDRESS`.

### Task 3.1: EZKL Solidity verifier on Sepolia

**Files:**
- Create: `docs/plans/L1_SEPOLIA_EZKL_VERIFIER.md` — how to generate EZKL Solidity verifier, deploy to Sepolia, document address and RPC
- Modify: parent repo `backend/app/config.py` — add `L1_SEPOLIA_RPC`, `L1_EZKL_VERIFIER_ADDRESS` (optional; used when L1 bridge flow is enabled)

**Step 1:** Document EZKL Solidity verifier generation (EZKL CLI/toolchain) and deployment to Ethereum Sepolia. Record contract address and required RPC (e.g. Alchemy/Infura Sepolia).

**Step 2:** Add config keys in parent backend for Sepolia RPC and verifier address; default empty so L1 flow is opt-in.

**Step 3:** Commit: `feat(l1): config placeholders for Sepolia EZKL verifier`

---

### Task 3.2: L1→L2 messaging — Starknet receiver contract

**Files:**
- Create: `verification/L1_EZKL_BRIDGE_SPEC.md` (parent or zkdefi) — message format: (model_hash, output_commitment, verified, nonce, chain_id); sender auth; storage layout
- Create or modify: Starknet contract that receives L1→L2 messages (Starknet core messaging), validates origin (L1 bridge), and stores or emits (model_hash, output_commitment, verified=true)

**Step 1:** Specify L1→L2 message payload and validation rules (e.g. only accept from known L1 bridge and EZKL verifier contract).

**Step 2:** Implement receiver contract (e.g. `L1EzklBridgeReceiver.cairo` or extend existing fact registry): on `consume_message` / L1→L2 handler, parse payload and set proof record or call existing registry.

**Step 3:** Deploy on Starknet Sepolia (and L3 if desired); document address. Add `L1_BRIDGE_RECEIVER_ADDRESS` to config.

**Step 4:** Commit: `feat(l1-bridge): Starknet L1→L2 receiver for EZKL verification results`

---

### Task 3.3: L1 submit and bridge trigger

**Status:** ✅ L1 submit + bridge trigger implemented. Parent backend supports both direct `verifyProof` and `verifyAndBridge` via `L1_EZKL_BRIDGE_SENDER_ADDRESS`; Sepolia sender deployed and Starknet receiver `allowed_l1_sender` updated. Runtime hardening now returns the exact bridge polling token (`used_nonce`, `message_hash`, `verification_status_query`) from `verifyAndBridge`, and can optionally wait for L2 confirmation in the same request.

**Files:**
- Create: parent repo `backend/app/services/l1_ezkl_bridge_service.py` — `submit_ezkl_proof_to_l1(proof_hex, public_inputs)` → call Sepolia EZKL verifier via RPC; on success, trigger or document L1→L2 message send (may be same tx or separate bridge contract call)
- Modify: `backend/app/api/routes/` — optional endpoint or extend aggregation: request L1 verify for a given proof; return tx hash and status

**Step 1:** Implement service that submits EZKL proof to L1 verifier contract (eth_call or send_transaction). Handle Sepolia gas and errors.

**Step 2:** L1→L2 message: either EZKL verifier contract emits event / sends message, or a separate L1 contract called after verify sends the message. Document flow and integrate in service.

**Step 3:** Optional API: POST `/api/v1/aggregation/l1/verify` with proof payload; return L1 tx hash and polling token for L2 confirmation.

**Step 4:** Commit: `feat(l1-bridge): L1 EZKL verify service and optional API`

---

### Task 3.4: Backend — poll L2 for L1→L2 confirmation

**Status:** ✅ Implemented in parent backend (`l1_ezkl_bridge_service.poll_l2_for_verification` + GET `/api/v1/aggregation/l1/verification-status` with `verified_on_l2`, `output_commitment`, `block_timestamp`). `POST /api/v1/aggregation/l1/verify` can now optionally inline that confirmation loop when `wait_for_l2=true`.

**Files:**
- Modify: `l1_ezkl_bridge_service.py` — `poll_l2_for_verification(model_hash, nonce)` or similar: query L2 receiver contract or indexer for message consumption; return verified=true when message received
- Modify: config — `L1_BRIDGE_RECEIVER_ADDRESS`, `STARKNET_RPC_URL` (or existing) for L2 state read

**Step 1:** Implement polling: given L1 tx hash or (model_hash, nonce), check L2 receiver contract storage or events for corresponding verification record.

**Step 2:** Expose in API or service: get verification status for an L1-submitted proof.

**Step 3:** Commit: `feat(l1-bridge): poll L2 for L1→L2 verification confirmation`

---

### Task 3.5: Docs and ProofMode

**Files:**
- Modify: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` — Phase 3 completion note when done
- Modify: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` — Path C status when Phase 3 is deployed
- Optional: add ProofMode `L1_BRIDGE` (4) in backend and pipeline; route certification/audit flows to L1 verify when enabled

**Step 1:** Document Sepolia addresses, env vars, L1→L2 message format in one place (e.g. L1_SEPOLIA_EZKL_VERIFIER.md or L1_EZKL_BRIDGE_SPEC.md).

**Step 2:** Update roadmap and implementation plan with completion status.

**Step 3:** Commit: `docs: Phase 3 L1 Sepolia bridge addresses and env`

---

## Phase 4: Path B — Cairo Native KZG Verifier

**Goal:** Verify EZKL (KZG/Halo2) natively in Cairo on Starknet/L3. Highest trustlessness; highest gas (~200–400M). Deploy on L3 first (zero gas at point of use).

**Reference:** `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path B; design doc §6.

### Task 4.1: Cairo BN254/KZG verification module

**Files:**
- Create or use: Cairo library for BN254 pairing and KZG batch verification (Garaga has BN254 primitives; extend or wrap for EZKL/Halo2 proof format)
- Create: `verification/CAIRO_KZG_VERIFIER_SPEC.md` — EZKL proof format, public inputs, verification equation; mapping to Cairo types

**Step 1:** Specify EZKL/Halo2 proof format and verification steps (pairing check, etc.). Document in CAIRO_KZG_VERIFIER_SPEC.md.

**Step 2:** Implement or integrate Cairo BN254 pairing (e.g. Garaga `BN254.G1Point`, `G2Point`, pairing); implement KZG verification logic matching EZKL output.

**Step 3:** Unit tests with known EZKL proof; confirm verification result.

**Step 4:** Commit: `feat(kzg): Cairo BN254/KZG verification module for EZKL`

---

### Task 4.2: KZG verifier contract and deploy

**Files:**
- Create: Cairo contract exposing `verify_kzg(proof_calldata, public_inputs)` (or equivalent); on success write result to storage or emit event
- Modify: parent repo `backend/deploy_verifiers_l3.py` — add KZG verifier deploy step when artifact exists
- Modify: `backend/app/config.py` — add `L3_KZG_VERIFIER_ADDRESS`

**Step 1:** Contract that calls the Cairo KZG verification library and stores/emits result. Minimize storage for gas.

**Step 2:** Build and deploy on L3 first (zero gas); optionally L2 when gas is acceptable. Add to deploy script and config.

**Step 3:** Commit: `feat(l3): deploy Cairo KZG verifier on L3`

---

### Task 4.3: Backend — routing and proof path for native KZG

**Files:**
- Modify: `backend/app/services/l3_verification_service.py` — add proof_type or path for `NATIVE_KZG`; route to KZG verifier contract when proof format is EZKL calldata
- Modify: `backend/app/config.py` — ensure `L3_KZG_VERIFIER_ADDRESS` is read and passed to service
- Modify: proving paths and health probe — add `kzg_verifier` path, applicable_to e.g. `["EzklNativeKzg"]`

**Step 1:** Route EZKL proof payload to KZG verifier contract; format calldata per contract ABI.

**Step 2:** Expose in get_proving_paths and get_stats; add to health probe.

**Step 3:** Commit: `feat(l3): route native KZG proofs to L3 KZG verifier`

---

### Task 4.4: zkdefi — pipeline path for native KZG

**Status:** 🟡 Partially complete in zkdefi. Native KZG routing is implemented with non-empty calldata serialization (`ezkl_kzg_v1` / placeholder), but full trustless semantics still depend on deployed Cairo verifier + parent ABI alignment.

**Files:**
- Modify: `backend/app/services/proof_pipeline.py` — support ProofMode or circuit path `NATIVE_KZG` / `EzklNativeKzg`; when selected, send EZKL proof (and public inputs) to L3 KZG verifier path
- Modify or add: EZKL proof serialization to contract calldata format (may already exist in ezkl_prover_service or similar)

**Step 1:** Add path in pipeline that builds EZKL proof calldata and calls L3 verify with proof_type=native_kzg.

**Step 2:** Optional API: allow requesting native KZG verification for certification flows.

**Step 3:** Commit: `feat(zkdefi): pipeline path for native KZG on L3`

---

### Task 4.5: Docs and gas note

**Files:**
- Modify: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` — Path B status when Phase 4 is deployed
- Modify: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` — Phase 4 completion note
- Document gas (L3: 0 at point of use; L2 estimate ~200–400M if deployed)

**Step 1:** Update roadmap and plan with Phase 4 completion and gas notes.

**Step 2:** Commit: `docs: Phase 4 Cairo KZG verifier status and gas`

---

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
