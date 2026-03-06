# Changelog

All notable changes to the zkdefi Full Privacy Pool and related infrastructure are documented here. No API keys, passwords, or secrets are included.

## [Unreleased]

### Fixed

- **Full Privacy Pool: withdrawal "Unknown merkle root" (2026-02-08)**  
  Withdrawals from the FullyShieldedPool were failing with "Unknown merkle root" even when deposits and on-chain root registration succeeded.  
  **Cause:** In `contracts/src/merkle_tree.cairo`, `u256_to_felt(low, high)` hashed `[low, high]` with Cairo Poseidon when `high != 0`, instead of reconstructing the 256-bit value. BN254 Poseidon roots are ~254 bits, so `high` is always non-zero. The contract therefore compared a hashed value to the `root % STARK_PRIME` stored via `add_known_root`, and the lookup always failed.  
  **Fix:** Replaced the hashing branch with arithmetic reconstruction: `low_felt + high_felt * 2^128`, which reduces modulo the Stark prime and matches the backend's `_root_to_felt252(root) = root % STARK_PRIME`.  
  **Deployment:** New MerkleTree and FullyShieldedPool were declared and deployed on Starknet Sepolia. Backend and frontend env were updated to the new contract addresses. Existing deposits on the previous pool are not migrated; users must use the new pool for new deposits and withdrawals.

- **Deposits list not updating after new deposit**  
  The list of saved commitments (withdraw tab) could fail to show the latest deposit due to stale React state when appending.  
  **Fix:** Append to saved commitments using a functional state update so the latest state is always used.

### Added

- **Explorer links for Full Privacy Pool transactions**  
  After a successful deposit or withdrawal, the success step now shows links to Starkscan and Voyager (Starknet Sepolia) so users can confirm the transaction on-chain.

### Documentation

- **DEV_LOG.md**  
  Added a finding entry for the u256_to_felt fix, including root cause, code change, and new contract addresses (no secrets).

---

## Pre-release (prior to first GitHub push)

- Full Privacy Pool: deposit flow (generate commitment, on-chain deposit, register commitment in backend Merkle tree, backend registers root on-chain via `add_known_root`).
- Full Privacy Pool: withdrawal flow (generate withdrawal proof, submit withdraw tx; contract checks `is_known_root_u256`, verifies Groth16 proof, transfers tokens).
- Dual-tree design: on-chain Merkle tree (Cairo Poseidon) for insertions; off-chain tree (BN254 Poseidon) for ZK proofs; synchronization via `add_known_root(root_felt)`.
- Backend: Merkle tree service, full privacy proof service, on-chain root sync via starkli (v0.8 RPC).
- Contracts: MerkleTree (u256 leaves, root history, `add_known_root`), FullyShieldedPool (deposit_u256, withdraw_u256, Garaga Groth16 verifier).
