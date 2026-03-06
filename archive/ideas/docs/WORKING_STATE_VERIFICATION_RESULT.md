# Working state verification result

Run date: 2026-02-07 (after commit `fc004c9` and tag `zkdefi-deposit-withdraw-working`).

## Checklist (from WORKING_STATE_DEPOSIT_WITHDRAW.md)

| Check | Result |
|-------|--------|
| Backend `.env` has `FULL_PRIVACY_MERKLE_TREE_ADDRESS`, `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY`, `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS` | ⚠️ Verify on deployment host (`.env` not in repo) |
| `contracts/snfoundry.toml` has `[sncast.sepolia]` and deployer account | ✅ Has `[sncast.sepolia]` with `account = "deployer"` |
| `sncast` is on PATH where the backend runs | ✅ Found: `sncast 0.53.0` |
| `register_commitment` awaits `register_root_on_chain` and returns 503 on failure | ✅ `full_privacy.py` L199: `registered = await register_root_on_chain(root_int, max_retries=3)`; 503 raised if not registered |
| `generate_withdraw_proof` (and with_change) verify root and register if missing before return | ✅ L414–417 and L503–506: `verify_root_on_chain(proof_root)` then `register_root_on_chain` when not known |
| `merkle_tree_onchain_sync` uses `_registration_lock` and verifies after each submit | ✅ L129: `async with _get_registration_lock()`; L159: `is_confirmed = await verify_root_on_chain(root)` |
| `merkle_tree_service.get_merkle_proof` uses `_compute_current_proof` and `verify_proof` sanity check | ✅ L184: `_compute_current_proof(leaf_index)`; L186: `verify_proof(...)` before return |

## Summary

All code-path checks pass. On the server that runs the zkde.fi backend, confirm the three `FULL_PRIVACY_MERKLE_TREE_*` env vars are set (see ENV.md).
