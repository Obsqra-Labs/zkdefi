# Recursive EZKL Verification Roadmap

## Current Architecture: Pragmatic Bridge (v6)

The current implementation uses a **pragmatic bridge** approach:

```
ONNX Model → EZKL prove (Halo2/KZG) → off-chain verify
                                             ↓
ModelBridge.circom(output, model_hash, proof_hash, bounds)
                                             ↓
Groth16 proof → Garaga BN254 → on-chain verification (~34M gas)
```

This verifies the EZKL proof **off-chain** and commits the model output + proof hash into a Groth16 proof that Garaga can verify on Starknet. It's pragmatic because:
- It works TODAY with existing Garaga infrastructure
- Gas cost is identical to existing Groth16 proofs (~34M gas)
- The ModelBridge circuit cryptographically binds the EZKL output to the on-chain proof

However, it does NOT verify the KZG/Halo2 proof on-chain. The trust assumption is that the backend correctly ran EZKL verification before generating the ModelBridge proof.

---

## Path A: Noir HONK Bridge (6–10 weeks)

**Status (2026-03):** Circuit and pipeline implemented. Noir circuit `noir_ezkl_bridge`; Garaga HONK verifier script; zkdefi pipeline supports `NoirEzklBridge` / `proof_type=noir_honk`; parent backend routes to L3 HONK verifier. Deploy verifier on L3 when Madara is up. Gas ~178M on L2.

**Most viable near-term path to full on-chain ML proof verification.**

### Key Insight
Garaga v1.0.1 already supports Noir UltraKeccakHONK proofs at ~178M gas. If we can re-prove the EZKL model inference in Noir instead of (or wrapping) Halo2, we get full on-chain verification.

### Architecture
```
ONNX Model → EZKL prove (Halo2/KZG) → EZKL output
                                             ↓
Noir circuit wraps: verify_ezkl_output(model, input, output)
                                             ↓
Noir HONK proof → Garaga HONK verifier → on-chain (~178M gas)
```

### Steps
1. **Week 1–2**: Implement simple Noir circuit that verifies model output bounds and model hash (similar to ModelBridge but in Noir instead of Circom)
2. **Week 3–4**: Deploy HONK verifier via Garaga (`garaga gen --system UltraKeccakHonk`)
3. **Week 5–6**: Integrate Noir HONK proof into proof_pipeline.py, replacing Groth16 ModelBridge for ML proofs
4. **Week 7–8**: Implement full KZG verification in Noir (requires BN254 pairing check in Noir — complex)
5. **Week 9–10**: Testing, gas optimization, trusted setup for Noir circuit

### Pros
- Garaga infrastructure already exists (v1.0.1 supports HONK)
- No new Cairo contract development for verifier
- Noir ecosystem is mature and audited
- Can incrementally migrate from Circom → Noir

### Cons
- ~178M gas per ML proof verification (5x more than Groth16)
- Full KZG verification in Noir is non-trivial (pairing operations)
- Requires Noir toolchain setup and integration

### Gas Analysis
| Proof Type | Garaga Gas | Notes |
|------------|-----------|-------|
| Groth16 BN254 (current) | ~34M | Used for all 22 existing circuits |
| Groth16 BLS12-381 | ~50M | Available but unused |
| Noir HONK | ~178M | ML proof verification path |

---

## Path B: Cairo KZG Verifier (12–16 weeks)

**Most trustless path — native KZG verification in Cairo.**

### Architecture
```
ONNX Model → EZKL prove (Halo2/KZG) → {proof, vk, public_inputs}
                                             ↓
Cairo KZG verifier contract (BN254 pairing check)
                                             ↓
On-chain verification (~200-400M gas estimated)
```

### Steps
1. **Week 1–3**: Port BN254 pairing implementation to Cairo (Garaga already has primitives)
2. **Week 4–6**: Implement KZG batch verification in Cairo
3. **Week 7–9**: Implement Halo2 IPA/KZG accumulation scheme in Cairo
4. **Week 10–12**: End-to-end integration with EZKL proof format
5. **Week 13–16**: Optimization, testing, audit preparation

### Pros
- Fully trustless: KZG proof verified natively on Starknet
- No intermediate proof transformation
- Reusable for any Halo2-based prover

### Cons
- Extremely high gas cost (pairing operations in Cairo VM are expensive)
- Complex implementation: BN254 pairing + Halo2 accumulation
- Long development timeline
- May not be viable until Starknet gas costs decrease

### Key Dependencies
- Garaga's `BN254.G1Point`, `BN254.G2Point`, and pairing operations
- Possible use of `garaga` multi-pairing for batching

---

## Path C: L1 Solidity Bridge (4–6 weeks)

**Hybrid approach — verify KZG on Ethereum L1, bridge result to Starknet.**

### Architecture
```
ONNX Model → EZKL prove (Halo2/KZG)
                    ↓
L1 Solidity: EZKL verifier contract (precompile: ecPairing ~130k gas)
                    ↓
L1→L2 message: (model_hash, output_commitment, verified=true)
                    ↓
Starknet: Receive L1 message → update proof record
```

### Steps
1. **Week 1–2**: Deploy EZKL-generated Solidity verifier to Ethereum Sepolia
2. **Week 3**: Implement L1→L2 messaging contract (Starknet core messaging)
3. **Week 4**: Implement L2 receiver contract that accepts L1 verification results
4. **Week 5–6**: Integration testing, gas optimization, bridge latency handling

### Pros
- L1 has native EVM precompiles for pairing (~130k gas on L1)
- Fully trustless KZG verification
- Leverages EZKL's existing Solidity verifier generation
- Shortest development timeline

### Cons
- Cross-layer latency (L1→L2 message finality: ~minutes)
- Additional L1 gas cost per proof (~200-500k gas on Ethereum)
- Complexity of managing cross-chain state
- Not suitable for time-sensitive operations (rebalancing)

---

## Recommended Progression

```
Phase 1 (NOW):     Pragmatic Bridge (ModelBridge.circom → Groth16 → Garaga)
                    ✅ Implemented in v6

Phase 2 (Month 2): Noir HONK Bridge (Path A, Steps 1-3)
                    ✅ Implemented: Noir circuit, HONK verifier script, pipeline, L3 routing.
                    Deploy verifier when L3 (Madara) is up. Gas ~178M on L2.

Phase 3 (Month 4): L1 Solidity Bridge (Path C) — Ethereum Sepolia
                    Target: Time-insensitive operations (certification, audits)
                    Use: Robustness certificates, model registration

Phase 4 (Month 6+): Cairo KZG Verifier (Path B)
                     Target: Native Starknet verification
                     Trigger: Starknet gas cost reduction / Garaga KZG support
```

## Configuration: ProofMode Toggle

The `ProofMode` system (implemented in `backend/app/services/proof_mode.py`) manages the transition:

| ProofMode | Verification | Gas | Trust |
|-----------|-------------|-----|-------|
| `EZKL_ONLY` (0) | Off-chain EZKL only | 0 | Backend |
| `EZKL_BRIDGE` (1) | EZKL → ModelBridge → Garaga | ~34M | Groth16 circuit |
| `FULL_DUAL_PROVER` (2) | EZKL → ModelBridge + STARK | ~70M | Dual independent |

Future modes (post-Path A):
| ProofMode | Verification | Gas | Trust |
|-----------|-------------|-----|-------|
| `NOIR_HONK` (3) | EZKL → Noir → HONK → Garaga | ~178M | Noir circuit |
| `L1_BRIDGE` (4) | EZKL → L1 KZG → L1→L2 msg | ~130k L1 | L1 precompile |
| `NATIVE_KZG` (5) | EZKL → Cairo KZG verify | ~300M | Native Cairo |

## Files Created in v6

### Backend
- `backend/app/services/ezkl_prover_service.py` — EZKL CLI wrapper
- `backend/app/services/proof_mode.py` — ProofMode enum + resolver
- `backend/app/ml/creditworthiness/` — XGBoost creditworthiness model + EZKL setup
- `backend/app/ml/llm_fallback/` — Deterministic fallback + agreement checker
- `backend/app/ml/timing_predictor/` — LSTM timing prediction + commitment scheme
- `backend/app/ml/credit_graph/` — Collaborative credit graph builder
- `backend/app/ml/adversarial/` — Attack generator + robustness tester
- `backend/app/db/` — PostgreSQL schema, connection pool, decision event store

### Circuits
- `circuits/ModelBridge.circom` — EZKL↔Groth16 bridge (8 outputs, Poseidon commitments)
- `circuits/RebalanceTimingCommitment.circom` — MEV-resistant timing proof
- `circuits/RobustnessCertificate.circom` — Adversarial robustness certificate

### Cairo Contracts (Modified)
- `contracts/src/proof_gated_yield_agent.cairo` — Added `execute_with_ml_proof()`, timing commitments
- `contracts/src/zkml_verifier.cairo` — Added `verify_model_bridge_proof()`, `verify_robustness_certificate()`, `verify_timing_proof()`
- `contracts/src/reputation_registry.cairo` — Added `set_collaborative_score()`, `get_collaborative_score()`

### Circuit Count
- **Before v6**: 22 circuits (16 in scanner registry)
- **After v6**: 25 circuits (19 in scanner registry)
  - `ModelBridge` — EZKL bridge
  - `RebalanceTimingCommitment` — MEV resistance
  - `RobustnessCertificate` — Model safety

---

*Last updated: 2026-03 — Phase 2 (Noir HONK) implementation complete*
*Author: zkDeFi AI Agent Infrastructure*
