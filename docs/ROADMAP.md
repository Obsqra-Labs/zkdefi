# Roadmap

**Last updated:** 2026-03-13

## Vision

Private capital and verifiable trust together: identity and intent protected, proofs and receipts enabling safe coordination. Multiple proof paths (Groth16, STARK, EZKL bridge, L1 bridge); L3/Madara and optional native KZG when gas and tooling allow.

## Current state

- Pragmatic EZKL bridge (ModelBridge to Garaga) live; `ModelBridge`, `ModelBridgeHeavy`, Noir HONK, and native KZG lanes all emit receipt-backed proofs through the current bridge stack.
- L1 Sepolia EZKL verifier and L2 receiver (L1EzklBridgeReceiver); parent backend L1 submit and L2 poll; signer opt-in.
- Rebalance mode, pools, Trade Desk v2, Mission Control, reputation proofs, full-privacy rails.
- Path B native KZG is now strict-gated and receipt-backed across the current proving-ready catalog, with bootstrap support for first-party models when local EZKL artifacts are missing.

## Next

- Broaden Path B beyond the current proving-ready catalog and keep tightening bridge/runtime benchmarks.
- L1 to L2 E2E polish; Capital OS polish (intent, pool UX, oracle visibility).

## Later

- Portable trust; policy compiler; deeper recursive closure of the STARK/SNARK lanes.

## ProofMode table

| Id | Name | Path | Status |
|----|------|------|--------|
| 0 | EZKL_ONLY | Off-chain EZKL | Backend trust |
| 1 | EZKL_BRIDGE | ModelBridge to Garaga ~34M | Shipped |
| 2 | FULL_DUAL_PROVER | ModelBridge plus STARK ~70M | Shipped |
| 3 | NOIR_HONK | Noir to HONK ~178M | Live on current bridge gate |
| 4 | L1_BRIDGE | L1 KZG to L1-L2 msg | L1+L2 shipped; E2E in progress |
| 5 | NATIVE_KZG | Cairo KZG ~300M | Live on L3; catalog expansion ongoing |

Reference: proof_mode.py; RECURSIVE_EZKL_ROADMAP.md in archive/ideas/docs.

## Links

- Path A/B/C: archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md
- **Phased tasks:** [plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md](plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md)
- **Capital OS road:** [HACKATHON_BUILD_NARRATIVE.md](HACKATHON_BUILD_NARRATIVE.md) section 9
