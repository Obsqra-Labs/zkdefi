# Working State: Full Privacy Deposit & Withdraw (zkde.fi)

**Status:** Deposit and withdraw flow works end-to-end on zkde.fi. This doc explains why and how to preserve it.

---

## Why It Works

### 1. Deposit flow

- **Frontend:** User enters amount → `generate_commitment` → wallet signs `deposit(commitment)` + approve → **then** calls `register_commitment` with the same commitment.
- **Backend `register_commitment`:**
  - Inserts commitment into the **in-memory + persisted** Merkle tree (BN254 Poseidon, circomlib).
  - Gets the new root, then **blocks** until that root is on-chain:
    - Calls `add_known_root(root_felt)` via **sncast** (contracts dir, `sepolia` profile).
    - Waits **10s** for block confirmation.
    - Calls `is_known_root(root)` to **verify** the root landed; if not, retries (with backoff) up to 3 times.
  - Returns 200 only when the root is **confirmed on-chain**. Returns 503 if registration fails so the frontend can retry.
- **Why withdrawals later succeed:** Every deposit that gets a 200 from `register_commitment` has its root already in the on-chain Merkle tree’s `roots` history. So when the user withdraws, the pool’s `is_known_root_u256(root_low, root_high)` check passes.

### 2. Root registration is serialized and verified

- **`merkle_tree_onchain_sync.py`:**
  - All `register_root_on_chain` calls are behind an **async lock** (`_registration_lock`). No concurrent `add_known_root` invokes → no nonce clashes (e.g. startup reconcile vs new deposit).
  - After each `sncast invoke`, we **verify** with `is_known_root`; if the root isn’t there (e.g. tx reverted), we retry instead of assuming success.
- **Config:** Uses `FULL_PRIVACY_MERKLE_TREE_ADDRESS` (the same Merkle tree contract the pool uses). sncast runs from `contracts/` with `--profile sepolia` (deployer account in `snfoundry.toml`).

### 3. Withdraw proof uses current tree and guaranteed-on-chain root

- **Backend `generate_withdraw_proof` (and `generate_proof_with_change`):**
  - **Always** builds a fresh Merkle proof from the **current** tree state via `get_merkle_proof(leaf_index)` → `_compute_current_proof(leaf_index)`. No stale stored proofs: sibling path is correct for the current root.
  - After generating the proof, it **ensures the proof’s root is on-chain:** calls `verify_root_on_chain(proof_root)`; if false, calls `register_root_on_chain(proof_root, max_retries=3)` and only then returns the proof. So we never return a proof whose root isn’t in the on-chain tree.
- **Frontend (optional extra safety):** Before calling `account.execute` for withdraw, it can call `POST .../merkle/ensure_root` with `commitmentData.root` so even a stale proof gets its root registered.

### 4. Merkle proof correctness

- **`merkle_tree_service.py`:**
  - `get_merkle_proof(leaf_index)` uses `_compute_current_proof(leaf_index)`: sparse rebuild so the sibling path is valid for **current** `self.root`.
  - Before returning, it checks `verify_proof(leaf, path_elements, path_indices, self.root)` and raises if the proof doesn’t verify.
- Leaves are stored as `commitment_felt = commitment % STARK_PRIME` (felt252-safe). Same reduction is used in the circuit and in the pool’s view of the tree.

### 5. Poseidon and tooling

- **Poseidon:** Backend uses a **persistent Node.js worker** (circomlibjs) for BN254 Poseidon so proof generation is fast and consistent with the circuit.
- **sncast:** Root registration uses **sncast** (not starkli) from `contracts/` with a single deployer account, so nonce handling is predictable.

---

## Critical Files (do not break)

| Role | File | What must stay |
|------|------|----------------|
| Root sync | `backend/app/services/merkle_tree_onchain_sync.py` | Lock around `register_root_on_chain`; post-submit verify with `verify_root_on_chain`; retries with backoff; config from env each call |
| Deposit API | `backend/app/api/routes/full_privacy.py` | `register_commitment` awaits `register_root_on_chain(root_int, max_retries=3)` and returns 503 on failure |
| Withdraw API | `backend/app/api/routes/full_privacy.py` | After `generate_withdraw_proof`, verify proof’s root with `verify_root_on_chain`; if not known, call `register_root_on_chain` before returning |
| Tree proofs | `backend/app/services/merkle_tree_service.py` | `get_merkle_proof` uses `_compute_current_proof` and sanity-checks with `verify_proof` |
| Proof service | `backend/app/services/full_privacy_proof_service.py` | Always uses current tree root and `get_merkle_proof(leaf_index)` (no stale stored proof) |
| Frontend deposit | `frontend/.../FullPrivacyPoolPanel.tsx` | After successful deposit tx, call `register_commitment` and (optional) retry on 503 |
| Frontend withdraw | `frontend/.../FullPrivacyPoolPanel.tsx` | Use proof from backend (root already ensured on-chain); optional pre-submit `ensure_root` |

---

## Required env (backend)

- `FULL_PRIVACY_MERKLE_TREE_ADDRESS` — Merkle tree contract the pool uses (e.g. `0x03659ca95ebe890741ca68dd84945716ca9e40baa6650d81f977466726370947`).
- `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` — Hex key for the account that can call `add_known_root`.
- `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS` — That account’s address.

Without these, `register_root_on_chain` does nothing and withdrawals fail with “Unknown merkle root”.

Optional for nullifier pre-check: `FULL_PRIVACY_POOL_V2_ADDRESS` (pool contract for `is_nullifier_used`).

---

## Backup / preserve this state

1. **Version control:** Ensure the above files are committed. Tag or branch if you want a named snapshot (e.g. `git tag zkdefi-deposit-withdraw-working`).
2. **Deploys:** When deploying backend, keep `merkle_tree_onchain_sync.py`, the full_privacy routes, and `full_privacy_proof_service` + `merkle_tree_service` logic as above. Don’t remove the “verify after submit” or the “ensure root before return proof” behavior.
3. **Env:** Keep `FULL_PRIVACY_MERKLE_TREE_*` set on the server that runs the zkde.fi backend (or use the documented manual root registration flow if you don’t want the key on the app server).
4. **sncast:** Backend needs `sncast` on PATH and `contracts/snfoundry.toml` with the `sepolia` profile pointing at the same account as the admin key.

---

## Quick verification

- **Deposit:** Do a deposit; ensure `register_commitment` returns 200 and logs “Root registered on-chain successfully” (or “Root confirmed on-chain”). If you see 503, root registration failed and that deposit’s root may not be on-chain.
- **Withdraw:** Generate proof then withdraw. If you ever see “Unknown merkle root”, the root in the proof was not in the on-chain tree at execution time — then check backend logs for “Root NOT confirmed” or “FAILED to register root”, and that `FULL_PRIVACY_MERKLE_TREE_*` is set and sncast is available.

This working state is preserved as long as the above chain (register → verify on-chain → only then return; and proof generation → ensure root on-chain → return proof) and the listed files/env stay intact.

---

## Verification checklist (periodic)

- [ ] Backend `.env` has `FULL_PRIVACY_MERKLE_TREE_ADDRESS`, `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY`, `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS`.
- [ ] `contracts/snfoundry.toml` has `[sncast.sepolia]` and the deployer account matches the admin key.
- [ ] `sncast` is on PATH where the backend runs.
- [ ] `register_commitment` in `full_privacy.py` still awaits `register_root_on_chain` and returns 503 when it fails.
- [ ] `generate_withdraw_proof` (and with_change) still call `verify_root_on_chain(proof_root)` and `register_root_on_chain` when not known before returning.
- [ ] `merkle_tree_onchain_sync.py` still uses `_registration_lock` and verifies with `verify_root_on_chain` after each `_starkli_add_known_root`.
- [ ] `merkle_tree_service.get_merkle_proof` still uses `_compute_current_proof` and `verify_proof` sanity check.
