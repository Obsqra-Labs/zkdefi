# Cairo Native KZG Verifier (Phase 4 — Path B)

Verify EZKL (KZG/Halo2) proofs natively in Cairo on Starknet/L3. No L1 or Noir layer.

## Goal

- **Contract:** Cairo module for BN254 pairing + KZG verification; contract exposes `verify_kzg(proof_calldata, public_inputs)`.
- **Deploy:** L3 first (zero gas at point of use); L2 when gas acceptable (~200–400M estimated).
- **Backend:** ProofMode/path `NATIVE_KZG` or `EzklNativeKzg`; route EZKL proof to L3 KZG verifier.

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

## References

- Plan: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` Phase 4
- Roadmap: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path B
