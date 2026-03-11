# Concepts

**Last updated:** 2026-03-10

Short glossary for onboarding. Cross-links point to [PRODUCT_AND_MVP.md](PRODUCT_AND_MVP.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md), and specs where relevant.

---

## Private commitment vs nullifier

A **commitment** is a cryptographic digest (e.g. Poseidon hash) of private data (e.g. amount, asset, user). It is published so the system can enforce rules without revealing the data. A **nullifier** is a value derived from the same private data and published when the commitment is “spent” or withdrawn, so the same commitment cannot be used twice. Full-privacy deposit/withdraw flows use commitments for deposits and nullifiers for withdrawals; see [PRODUCT_AND_MVP.md](PRODUCT_AND_MVP.md) (full privacy) and [plans/UNIFIED_PRIVACY_POOL_SPEC.md](plans/UNIFIED_PRIVACY_POOL_SPEC.md).

---

## Merkle tree (full-privacy pool)

The full-privacy pool maintains a Merkle tree of commitments. A user proves membership (or balance above threshold) by showing a Merkle path to their commitment without revealing the leaf. Tree root and contract state are on-chain or in backend state; proofs are verified by Garaga. See backend `FULL_PRIVACY_*` config and [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Rebalance mode (user vs oracle)

Account-level setting that controls who can deploy or close pool capital. **User** (`user`): only the wallet owner. **Oracle** (`oracle`): an operator/admin can trigger rebalances, gated by zkML verification via the policy engine. Set via `GET`/`PUT` `/api/v1/zkdefi/mc/rebalance-mode/{address}`. See [PRODUCT_AND_MVP.md](PRODUCT_AND_MVP.md) (execution) and [README.md](../README.md#pool-intent--rebalance-mode).

---

## Proof type (Groth16, STARK, EZKL bridge)

- **Groth16:** SNARK used by Garaga; circuits are Circom; verification on Starknet via Garaga verifier contract. Used for reputation, full-privacy, zkML risk/anomaly, ModelBridge.
- **STARK:** Used by Stone/Integrity for execution and reputation passport; L3/Madara settlement path.
- **EZKL bridge:** EZKL proof is verified off-chain; ModelBridge circuit commits model output and proof hash into a Groth16 proof that is verified on-chain. See [ROADMAP.md](ROADMAP.md) and [archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md](../archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md).

---

## ProofMode

Enum that selects the verification path for EZKL/ML flows: EZKL_ONLY (0), EZKL_BRIDGE (1), FULL_DUAL_PROVER (2), NOIR_HONK (3), L1_BRIDGE (4), NATIVE_KZG (5). Implemented in `backend/app/services/proof_mode.py` (or parent). See [ROADMAP.md](ROADMAP.md) ProofMode table.

---

## Risk passport vs reputation tier

**Risk passport** is a portable attestation (risk tier, scores) that can be shown to protocols or counterparties without revealing full history. **Reputation tier** is an internal or on-chain tier derived from proofs (solvency, performance, strategy integrity, etc.). Both feed into eligibility and gating; passport is the portable object, tier is often the scalar used in policy. See [PRODUCT_AND_MVP.md](PRODUCT_AND_MVP.md) (Risk Passport) and [REPUTATION_PROOF_API.md](REPUTATION_PROOF_API.md).

---

## Session key

A delegated key that can perform actions on behalf of the user within constraints (e.g. cap, expiry, allowed operations). Used for autonomous rebalancer and agent execution without signing every tx with the main wallet. Managed via `/api/v1/zkdefi/session_keys/*`. See [PRODUCT_AND_MVP.md](PRODUCT_AND_MVP.md) (execution).

---

## L1→L2 message (bridge result)

After verifying an EZKL proof on L1 (Ethereum Sepolia), the result (model_hash, output_commitment, verified, nonce) is sent to Starknet via the core L1→L2 messaging. The L2 contract `L1EzklBridgeReceiver` consumes the message and stores the verification. Backend polls L2 to confirm. See [ARCHITECTURE.md](ARCHITECTURE.md) (L1 EZKL bridge) and [plans/L1_EZKL_BRIDGE_SPEC.md](plans/L1_EZKL_BRIDGE_SPEC.md).

---

## Fact registry (ObsqraFactRegistry)

On-chain contract on Starknet (and L3 when Madara is used) that stores fact hashes and exposes `register_fact()` and `is_valid()`. Proof pipeline and obsqra.fi submit facts after proof generation; other contracts or the backend can query validity. See [ARCHITECTURE.md](ARCHITECTURE.md) and [MADARA_L3_APPCHAIN_ARCHITECTURE.md](MADARA_L3_APPCHAIN_ARCHITECTURE.md).
