# Cairo Native KZG Verifier (Phase 4 — Path B)

Verify EZKL (KZG/Halo2) proofs natively in Cairo on Starknet/L3. No L1 or Noir layer.

## Current stage (2026-03-11)

- Path B is **in progress**.
- zkdefi backend now supports `bridge_circuit="EzklNativeKzg"` and routes `proof_type="native_kzg"` with non-empty `kzg_calldata`.
- If local EZKL artifacts are available, backend serializes real EZKL proof payload (`ezkl_kzg_v1`).
- If artifacts are unavailable, backend emits deterministic placeholder payload (`native_kzg_placeholder_v1`) so proving-path routing and integration tests still run.
- Native Cairo verifier package now exists at `circuits/contracts/src/ezkl_kzg_verifier` and builds via `bash circuits/generate_ezkl_kzg_verifier.sh`.
- Parent backend now attempts strict ABI `verify_ezkl_kzg_v1(expected_fact_hash, payload)` first, then legacy `verify_kzg(payload)`.
- Live lane rejects placeholder payload marker (`native_kzg_placeholder_v1`) before on-chain call.
- Cairo verifier now enforces a `kzg_mpcheck_v1` trailer and runs `multi_pairing_check_bn254_2P_2F` on-chain with fixed KZG G2 points.
- Parent backend validates trailer shape (`kzg_mpcheck_v1`, two G1 points, non-empty MPCheck hint span) before submitting on-chain calls.
- Latest L3 deploy (Madara): class hash `0x07294fe4a60b45de1da26dc528359b2bd3bbb27a74ee4a20aa69b6bf89aeaada`, contract `0x026b2298aae275009ae68c1733e662981f056d99e1c241a16b78780fee52a5bf`.
- Remaining gap for full production Path B is automatic extraction of KZG pairing witness (pair0/pair1 + hint) from raw EZKL proof artifacts in every model flow.

## Goal

- **Contract:** Cairo module for BN254 pairing + KZG verification; contract exposes `verify_kzg(proof_calldata, public_inputs)`.
- **Deploy:** L3 first (zero gas at point of use); L2 when gas acceptable (~200–400M estimated).
- **Backend:** ProofMode/path `NATIVE_KZG` or `EzklNativeKzg`; route EZKL proof to L3 KZG verifier.

## Backend calldata format (zkdefi -> parent -> L3)

### `ezkl_kzg_v1` (real EZKL serialization)

felts header:
1. marker felt: `"ezkl_kzg_v1"`
2. model hash felt
3. verification-key hash felt
4. proof hash felt
5. `public_inputs_count`
6. `output_count`
7. `proof_blob_felts_count`
8. `raw_proof_json_hash`

then:
- `public_inputs_count` fixed-point felts (scale = `1_000_000`)
- `output_count` fixed-point felts
- proof blob chunks as felts (31-byte packing)
- cryptographic trailer:
  1. marker felt: `"kzg_mpcheck_v1"`
  2. `pair0_g1` (8 felts = two `u384` coords as 4×96-bit limbs each)
  3. `pair1_g1` (8 felts)
  4. `hint_len`
  5. `hint_len` felts for `MPCheckHintBN254` serialization (`MPCHECK_BN254_2P_2F`)

Current fact binding:
- parent passes `expected_fact_hash` to `verify_ezkl_kzg_v1`.
- verifier accepts only when `expected_fact_hash == proof_hash` (header slot 4) **or** equals payload Poseidon hash.
- verifier additionally requires the MPCheck trailer to deserialize and pass a real BN254 pairing check.

`zkdefi` serializer accepts optional bundle fields in `raw_proof_json`:

```json
{
  "kzg_mpcheck_bundle": {
    "pair0": { "x": "0x...", "y": "0x..." },
    "pair1": { "x": "0x...", "y": "0x..." },
    "mpcheck_hint_felts": ["0x...", "0x..."],
    "auto_build_hint": true
  }
}
```

- If `mpcheck_hint_felts` is omitted and `auto_build_hint=true`, serializer attempts local Garaga npm `mpcCalldataBuilder` (BN254, `n_fixed_g2=2`) to generate the hint.
- When bundle generation fails, payload still serializes as `ezkl_kzg_v1` but is marked `verification_semantics=payload_and_fact_binding_only` and L3 strict validation rejects it.

### `native_kzg_placeholder_v1` (deterministic fallback)

Used when local EZKL artifacts are unavailable:
1. marker felt: `"native_kzg_placeholder_v1"`
2. model hash felt
3. proof hash felt
4. timestamp felt
5. output count
6. output felts (fixed-point, scale = `1_000_000`)

## Dependencies

- Garaga BN254 primitives (`G1Point`, `G2Point`, pairing) or equivalent Cairo lib.
- EZKL/Halo2 proof format spec: public inputs, proof encoding, verification equation.

## Config (parent backend)

| Variable | Description |
|----------|-------------|
| `L3_KZG_VERIFIER_ADDRESS` | Cairo KZG verifier contract on L3 |

When unset, native KZG path is disabled.

## Tasks (see implementation plan)

- Task 4.1: Cairo BN254/KZG module + spec (`verification/CAIRO_KZG_VERIFIER_SPEC.md`).
- Task 4.2: KZG verifier contract + deploy script.
- Task 4.3: Backend routing and proving path.
- Task 4.4: zkdefi pipeline path for native KZG.
- Task 4.5: Docs and gas note.

Outstanding for "full trustless KZG":
- Add deterministic extraction of `(pair0, pair1, mpcheck_hint)` from EZKL proof JSON in all proof-generation paths.
- Add pass/fail vectors from live EZKL outputs that cover both valid and invalid MPCheck trailers.

## References

- Plan: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` Phase 4
- Roadmap: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path B
