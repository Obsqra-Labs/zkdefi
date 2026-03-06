# Unknown merkle root — quick reference

When a withdrawal fails with **"Unknown merkle root"**, the pool contract is rejecting the root in your proof because it is not in its known-root set.

## What it means

- The **on-chain** merkle tree (Starknet Poseidon, updated on pool `deposit`) only accepts withdrawals whose proof root has been registered.
- The **backend** builds proofs from its own off-chain tree (BN254 Poseidon). That root is not the same as the pool’s on-chain root until you register it.

## Fix (pick one)

1. **Register the backend root on-chain**  
   After each `register_commitment`, the backend root must be added to the pool’s merkle tree via `add_known_root(root_felt)`.  
   - **Auto (dev/test):** set `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` (and related env) so the backend calls `add_known_root` after registration.  
   - **Manual (recommended for production):** use the `merkle_root` from the API response; compute `root_felt = int(merkle_root, 16) % STARK_PRIME`; have an operator with the tree admin key call `add_known_root(root_felt)` on the merkle tree contract.

2. **Check configuration**  
   - `FULL_PRIVACY_MERKLE_TREE_ADDRESS` must be the tree the pool uses.  
   - Pool and tree addresses must match what the frontend uses (no V1 vs V2 drift).

3. **If you cannot add roots**  
   You must use a tree that already has your backend root, or switch to a backend/circuit that uses the same hash as the on-chain tree (Starknet Poseidon). See full doc below.

## Full doc

For deploy steps, env vars, and security (who holds the admin key), see:

- **`zkdefi/docs/FULL_PRIVACY_MERKLE_ROOT_SYNC.md`**
