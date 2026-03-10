# Advanced L3 Circuits + EZKL/KZG On-Chain (Phased) — Design

**Date:** 2026-03-10  
**Scope:** (1) Heavier Groth16 + STARK circuits for L3; (2) Phased EZKL/KZG on-chain: Noir HONK → L1 Solidity (Ethereum Sepolia) → Cairo native KZG.

---

## 1. Goals

- **Advanced L3:** Run heavier Groth16 and STARK circuits on L3 (zero/subsidized gas) so we can verify “as advanced as we can” without user gas cost.
- **EZKL/KZG on-chain:** Full trustlessness of ML inference by verifying EZKL (KZG/Halo2) on-chain, in three phased paths:
  - **Path A:** Noir HONK bridge (single chain, ~178M gas).
  - **Path C:** L1 Solidity verifier on **Ethereum Sepolia** + L1→L2 message to Starknet.
  - **Path B:** Cairo native KZG verifier on Starknet/L3.

---

## 2. Phase Order and Rationale

| Phase | What | Why this order |
|-------|------|----------------|
| **Phase 1** | Advanced L3: one heavier Groth16 circuit + one heavier STARK circuit | Proves L3 capacity and routing before adding new proof systems. |
| **Phase 2** | Path A — Noir HONK bridge | Single-chain, reuses Garaga; first step to full EZKL attestation on-chain. |
| **Phase 3** | Path C — L1 Solidity + L1→L2 (Ethereum Sepolia) | KZG verified on L1 (EVM precompile); good for time-insensitive flows (certification, audits). Sepolia as specified. |
| **Phase 4** | Path B — Cairo native KZG | Full on-Starknet trustlessness; highest effort, done when gas/tooling justify it. |

---

## 3. Phase 1: Advanced L3 Circuits

### 3.1 Heavier Groth16 circuit for L3

- **Intent:** One new Circom circuit that is “heavier” than ModelBridge (e.g. more outputs, more constraints, or a second-tier ML gate). Deploy its Garaga verifier **on L3 only** (or L3-first); route by `circuit_name`.
- **Components:**
  - New circuit in `circuits/` (e.g. `ModelBridgeHeavy.circom` or `AllocationGateV2.circom`), build with existing Circom/snarkjs/Garaga toolchain.
  - Generate verifier with Garaga from the new VK; add to `deploy_verifiers_l3.py` (or a dedicated script) to declare/deploy on L3.
  - Parent backend: new config (e.g. `L3_HEAVY_GROTH16_VERIFIER_ADDRESS`), extend `_groth16_verifier_for_circuit(circuit_name)` to return this verifier for the new circuit name; add proving path and health probe entry.
  - zkdefi: circuit scanner registry entry, proof pipeline able to build witness and call Groth16 prover for this circuit; when `execution_chain="l3"` and circuit is this one, send calldata to parent L3 API (which uses the new verifier).
- **Deliverables:** New circuit + zkey + vkey; L3 verifier deployed; backend routing and proving path; one circuit name (e.g. `ModelBridgeHeavy`) usable end-to-end on L3.

### 3.2 Heavier STARK circuit for L3

- **Intent:** One new Cairo0 (or Stone-compilable) circuit that is heavier than existing reputation circuits. Prove with Stone; verify on L3 via **Integrity** (existing) or a dedicated STARK verifier if we add one.
- **Components:**
  - New circuit in the reputation/Stone path (e.g. in `integrity/` or existing Stone layout). Produce a STARK proof (Stone) and fact hash.
  - L3: Either reuse existing Integrity verifier on L3 (if the new circuit fits the same verifier contract) or deploy a new Integrity-compatible verifier for the new circuit and register it (e.g. `L3_INTEGRITY_HEAVY_VERIFIER_ADDRESS` + circuit_name routing).
  - Parent backend: If new verifier, add config and route `circuit_name` → that verifier in `_verify_stark` path; expose in proving paths.
  - zkdefi: Integrate new circuit into the flow that produces STARK proofs and sends them to L3 (e.g. reputation/onboarding path); ensure `circuit_name` and proof payload match what L3 expects.
- **Deliverables:** New STARK circuit + Stone proof flow; L3 verification (same or new Integrity verifier); backend routing; one new circuit name usable on L3.

### 3.3 Non-goals for Phase 1

- No change to existing ModelBridge / RiskScore / Anomaly circuits.
- No EZKL/KZG verification yet; that starts in Phase 2.

---

## 4. Phase 2: Path A — Noir HONK Bridge

- **Intent:** Verify EZKL inference on-chain by re-proving (or wrapping) it in Noir and verifying a HONK proof with Garaga’s HONK verifier (~178M gas).
- **Reference:** `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path A.
- **Components:**
  - Noir circuit that constrains (model hash, input commitment, output, bounds) and optionally wraps or verifies EZKL output.
  - Garaga HONK verifier: `garaga gen --system UltraKeccakHonk` (or equivalent) from Noir’s VK; deploy on L2 and L3.
  - Backend: Noir prove step in proof pipeline; format HONK proof for Garaga; call L2/L3 with `circuit_name` e.g. `NoirEzklBridge`; new ProofMode or path for HONK.
  - Contract: ZkmlVerifier (or new entrypoint) that calls the HONK verifier contract when `circuit_name` indicates Noir/HONK.
- **L3:** Deploy same HONK verifier on Madara; register in parent backend; route HONK proofs to it so L3 verification is free at point of use.
- **Deliverables:** Noir circuit + HONK verifier on L2 and L3; pipeline producing HONK proofs; routing and ProofMode; docs update.

---

## 5. Phase 3: Path C — L1 Solidity Bridge (Ethereum Sepolia)

- **Intent:** Verify EZKL (KZG) on Ethereum Sepolia via EZKL’s Solidity verifier; pass result to Starknet via L1→L2 message.
- **Reference:** `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path C.
- **Chain:** **Ethereum Sepolia** (as requested).
- **Components:**
  - EZKL Solidity verifier (from EZKL toolchain) deployed on Ethereum Sepolia.
  - L1 contract or script: submit EZKL proof to the verifier; on success, send a structured L1→L2 message (e.g. model_hash, output_commitment, verified=true, nonce).
  - Starknet L2 (and optionally L3): core contract that receives L1→L2 messages from the Sepolia bridge, validates origin, and updates proof record or sets a “KZG-verified” flag the app can read.
  - Backend: For time-insensitive flows (certification, audits, model registration), optionally trigger L1 verification and wait for L2 confirmation; API or webhook to expose status.
- **Deliverables:** EZKL verifier on Sepolia; L1→L2 messaging contract on Starknet; receiver logic and storage; backend integration for chosen flows; docs (Sepolia addresses, RPC, env vars).

---

## 6. Phase 4: Path B — Cairo Native KZG Verifier

- **Intent:** Verify EZKL (KZG/Halo2) natively in Cairo on Starknet/L3 so there is no L1 or Noir layer.
- **Reference:** `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path B.
- **Components:**
  - Cairo library (or Garaga-based) for BN254 pairing and KZG batch verification; match EZKL/Halo2 proof format.
  - Contract that exposes `verify_kzg(...)` (or equivalent) and writes result to storage / emits event; called by proof pipeline or a dedicated service when “native KZG” mode is selected.
  - Backend: ProofMode or path that sends EZKL proof + public inputs to this contract; handle high gas (~200–400M) and possibly L3-only deployment first (zero gas).
- **Deliverables:** Cairo KZG verifier contract; deployment on L3 (and L2 when gas is acceptable); pipeline path; config and routing; docs and gas notes.

---

## 7. Configuration and ProofMode

- **Phase 1:** New circuit names (e.g. `ModelBridgeHeavy`, `StarkHeavyReputation`) and optional env vars (e.g. `L3_HEAVY_GROTH16_VERIFIER_ADDRESS`, `L3_INTEGRITY_HEAVY_VERIFIER_ADDRESS`).
- **Phase 2:** ProofMode or path for Noir HONK (e.g. `NOIR_HONK`); `circuit_name` for HONK verifier routing on L2/L3.
- **Phase 3:** ProofMode or path for L1 bridge (e.g. `L1_BRIDGE`); Sepolia RPC and contract addresses in config; L1→L2 message format documented.
- **Phase 4:** ProofMode or path for native KZG (e.g. `NATIVE_KZG`); contract address and gas handling (e.g. L3-only initially).

Existing `ProofMode` and `execution_chain` remain; new modes/paths are additive.

---

## 8. Dependencies and Repos

- **zkdefi:** Circuits (Circom, Noir in Phase 2), proof pipeline, circuit scanner, L3 client (calls parent backend).
- **Parent backend (obsqra):** L3 verifier config, routing by `circuit_name`, deploy scripts (`deploy_verifiers_l3.py`), health probe.
- **Contracts:** ZkmlVerifier or new Cairo contracts (HONK in Phase 2, L1 receiver in Phase 3, KZG in Phase 4).
- **L1 (Phase 3):** EZKL Solidity verifier + L1→L2 bridge on **Ethereum Sepolia**.

---

## 9. Success Criteria (per phase)

- **Phase 1:** One heavier Groth16 and one heavier STARK circuit verify on L3; proving paths and health show them; no regression on existing circuits.
- **Phase 2:** EZKL inference attested on-chain via Noir HONK on L2 and L3; pipeline produces and sends HONK proofs; gas documented (~178M).
- **Phase 3:** EZKL proof verified on Ethereum Sepolia; L1→L2 message received on Starknet; at least one flow (e.g. certification) uses it end-to-end.
- **Phase 4:** EZKL proof verified natively in Cairo on L3 (and L2 when viable); pipeline has a native KZG path; gas and scope documented.

---

## 10. References

- `docs/plans/EZKL_TO_PROOF_BRIDGE_SPEC.md` — bridge and L2/L3 verifier context
- `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` — Paths A, B, C
- `docs/plans/MODELBRIDGE_VERIFIER_DEPLOY.md` — L3 verifier deploy and routing
- Parent backend: `app/services/l3_verification_service.py`, `app/config.py`, `deploy_verifiers_l3.py`
