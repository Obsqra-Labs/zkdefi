# Roadmap

**Last updated:** 2026-03-10

## Vision

Private capital and verifiable trust together: identity and intent protected, proofs and receipts enabling safe coordination. Multiple proof paths (Groth16, STARK, EZKL bridge, L1 bridge); L3/Madara and optional native KZG when gas and tooling allow.

## Current state

- Pragmatic EZKL bridge (ModelBridge to Garaga); 25 circuits in CIRCUIT_REGISTRY; Starknet Sepolia live.
- L1 Sepolia EZKL verifier and L2 receiver (L1EzklBridgeReceiver); parent backend L1 submit and L2 poll; signer opt-in.
- Rebalance mode, pools, Trade Desk v2, Mission Control, reputation proofs, full-privacy rails.

## Next

- L3/Madara when up; Noir HONK verifier deploy; L1 to L2 E2E; Capital OS polish (intent, pool UX, oracle visibility).

## Later

- Cairo KZG verifier (Path B); portable trust; policy compiler.

## ProofMode table

| Id | Name | Path | Status |
|----|------|------|--------|
| 0 | EZKL_ONLY | Off-chain EZKL | Backend trust |
| 1 | EZKL_BRIDGE | ModelBridge to Garaga ~34M | Shipped |
| 2 | FULL_DUAL_PROVER | ModelBridge plus STARK ~70M | Shipped |
| 3 | NOIR_HONK | Noir to HONK ~178M | Implemented; deploy on L3 |
| 4 | L1_BRIDGE | L1 KZG to L1-L2 msg | L1+L2 shipped; E2E in progress |
| 5 | NATIVE_KZG | Cairo KZG ~300M | Planned |

Reference: proof_mode.py; RECURSIVE_EZKL_ROADMAP.md in archive/ideas/docs.

## Links

- Path A/B/C: archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md
- **Phased tasks:** [plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md](plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md)
- **Capital OS road:** [HACKATHON_BUILD_NARRATIVE.md](HACKATHON_BUILD_NARRATIVE.md) section 9
