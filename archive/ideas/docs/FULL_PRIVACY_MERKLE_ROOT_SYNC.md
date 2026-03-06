# Full Privacy Pool: Unknown merkle root

## Why it happens

The pool contract only accepts withdrawals when the **root** in the proof is one it “knows”. It learns roots from its **on-chain merkle tree** (Starknet Poseidon, updated when someone calls `deposit` on the pool).

Our **backend** keeps a separate off-chain tree (BN254 Poseidon) for generating ZK proofs. Its root is different from the pool’s on-chain root, so the pool rejects it with **"Unknown merkle root"**.

## Fix: register our root on-chain

We need the pool’s merkle tree to treat our backend root as a known root.

1. **Contract change**  
   The merkle tree contract must expose an admin-only function that adds a root to its history. In this repo that is:
   - **`add_known_root(root: felt252)`** in `contracts/src/merkle_tree.cairo`.

2. **After each `register_commitment`**  
   The backend must register the current backend root (as felt252) on that tree:
   - Either **automatically**: set backend env so the backend calls `add_known_root(root_felt)` after each `register_commitment`.
   - Or **manually**: your admin account calls `merkle_tree.add_known_root(root_felt)` after each registration, using the `merkle_root` returned by `register_commitment` (reduced to felt252: `root_felt = root % STARK_PRIME`).

## Deploy merkle tree with add_known_root

To deploy a **new** merkle tree (with `add_known_root`) and a FullyShieldedPool pointing to it:

```bash
cd zkdefi
./scripts/deploy_merkle_tree_and_full_privacy_pool.sh
```

This builds the contracts, deploys MerkleTree(admin), deploys FullyShieldedPool(merkle_tree, 0x0, token, admin), authorizes the pool as inserter, and appends addresses to `backend/.env` and `frontend/.env.local`. For an **existing** pool that uses an old tree without `add_known_root`, you must redeploy: run this script to get a new tree + pool, then point backend/frontend at the new addresses.

## Do you need auto root registration for the app to work?

**For withdraw to work, the backend root must be registered on-chain** (via `add_known_root`). Without that, withdraw fails with "Unknown merkle root". You do **not** need the backend to hold the admin key: you can register roots **manually** (see below) and the app works the same. Auto-registration is a convenience, not a requirement.

## Op sec: prefer manual root registration

Putting the merkle tree **admin private key** on the app backend (`FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY`) is a **concentration of risk**: the admin can call `add_known_root` and `add_inserter`. If the backend is compromised, an attacker with that key could register arbitrary roots or change inserters.

**Recommended for production:**

- **Do not set** `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` on the app server.
- **Manual registration:** After each `register_commitment`, an operator (with the admin key in a secure, separate env—e.g. cold wallet or CI with secrets) calls `add_known_root(root_felt)` on the merkle tree. Use the `merkle_root` from the API response; `root_felt = int(merkle_root, 16) % STARK_PRIME` (see backend `circomlib_poseidon.STARK_PRIME`). The app server never sees the key.
- **Optional relayer:** A separate, locked-down service (not the public API) holds the admin key and watches for new roots (e.g. from a queue or DB) and calls `add_known_root`. The main backend never has the key.

Auto-registration (backend holds the key) is acceptable only for dev/test or if you explicitly accept that risk.

## Backend auto-registration (optional; dev/test or accepted risk)

If you control the merkle tree admin key and accept putting it on the backend:

1. **Upgrade the merkle tree**  
   Deploy (or upgrade to) a merkle tree that includes `add_known_root` (see `contracts/src/merkle_tree.cairo`). Use `scripts/deploy_merkle_tree_and_full_privacy_pool.sh` for a full deploy.

2. **Configure backend** (in `backend/.env`):
   - `FULL_PRIVACY_MERKLE_TREE_ADDRESS` — merkle tree contract address (the one the pool uses).
   - `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` — admin private key (hex).
   - `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS` — admin account address (hex).

3. After each `POST .../deposit/register_commitment`, the backend will schedule a call to `add_known_root(root_felt)` so the pool accepts that root on withdraw.

## If you cannot upgrade the tree

Then the pool will only ever know roots that come from its own on-chain tree (Starknet Poseidon). To use that, the backend and circuits would need to use the same hash (Starknet Poseidon) for the tree and for the proof — a larger change (different circuit and possibly verifier).

## Manual root registration (recommended for production)

1. User deposits on-chain and calls `POST .../deposit/register_commitment` with the commitment. The API returns `merkle_root` (hex).
2. Operator (with the merkle tree admin key, **not** on the app server) computes `root_felt = int(merkle_root, 16) % STARK_PRIME`. In Python: `from app.services.circomlib_poseidon import STARK_PRIME; root_felt = int(merkle_root, 16) % STARK_PRIME`.
3. Operator calls `add_known_root(root_felt)` on the merkle tree contract (e.g. via starkli: `starkli invoke <MERKLE_TREE> add_known_root <root_felt>`).
4. Once the tx confirms, the user can withdraw; the pool will accept that root.

You can batch or automate step 2–3 in a separate, locked-down process that never shares the admin key with the public backend.

## Test Full Privacy flow (manual)

After deploying a merkle tree with `add_known_root` and configuring the backend:

1. **Deposit:** Use the app to deposit (generate commitment → confirm on-chain deposit).
2. **Register:** Call `POST .../deposit/register_commitment` with the commitment. Ensure the response includes `merkle_root`. If `FULL_PRIVACY_MERKLE_TREE_*` is set, the backend will have scheduled `add_known_root(root_felt)`.
3. **Ensure root is registered:** Either wait for the `add_known_root` tx to confirm, or call `add_known_root(root_felt)` manually with the `merkle_root` from step 2 (as felt252: `int(merkle_root, 16) % STARK_PRIME`).
4. **Withdraw:** Use the app to generate the withdraw proof and submit the withdraw tx. **Expect "Unknown merkle root" to disappear** once the root from step 2 is known to the pool’s merkle tree.

If "Unknown merkle root" still appears, the root was not registered (check backend logs for `add_known_root` tx, or call `add_known_root` manually).

## If "Invalid withdrawal proof" appears after root fix

We reduce nullifier, root, and proof calldata to `value % STARK_PRIME` so Starknet accepts felts. Garaga verifier expects BN254 Groth16; reducing mod P can change the value the verifier sees. If, after fixing "Unknown merkle root", you get **"Invalid withdrawal proof"** (or verifier revert):

1. Do **not** add mock or skip verification.
2. Investigate Garaga proof encoding: confirm whether their Cairo verifier accepts felt252-encoded proof or requires u256 (e.g. low/high per element). See plan section 6 and backend proof pipeline (e.g. `proof_pipeline.py`, calldata formatting).

## Summary

- **"Unknown merkle root"** = pool does not know the root we send in the withdraw proof.
- **Fix:** add `add_known_root` to the merkle tree, then register our backend root (as felt252) after each `register_commitment`, either via backend env or by calling `add_known_root` manually.
- **Scope:** Only Full Privacy (FullyShieldedPool + merkle tree) uses roots and `add_known_root`. Private Transfer (ConfidentialTransfer) and Shielded Pool use commitment_balance + nullifiers only; no merkle tree and no code changes from this fix.
