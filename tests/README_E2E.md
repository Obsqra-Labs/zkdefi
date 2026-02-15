# E2E and Unit Tests

## Unit tests (pytest)

**Run (all except model_marketplace):** `python3 -m pytest tests/ --ignore=tests/test_model_marketplace.py -v`

**Run (all):** `python3 -m pytest tests/ -v`

**Note:** `test_model_marketplace.py` uses an async fixture `client`; with current pytest-asyncio this can error (sync test depending on async fixture). Exclude with `--ignore=tests/test_model_marketplace.py` for a clean 46 passed.

---

## Backend Full Privacy + Pool C (bash)

**Script:** `backend_full_privacy_e2e.sh`

**Requires:** Backend running on port 8003 (or set `BACKEND_URL`).

**Run:** `bash tests/backend_full_privacy_e2e.sh`

Validates: health, full_privacy generate_commitment, register_commitment, pool_c generate_commitment. All four must return 200. Restart the backend after code changes so pool_c routes are loaded.

---

## Python E2E Suite

**Script:** `e2e_test_suite.py`

**Run:** `BACKEND_URL=http://localhost:8003 python3 tests/e2e_test_suite.py`

### Known failures (Shielded / Private Transfer path)

These 5 tests can fail due to Garaga proof formatting (not related to Pool B/C relabel):

1. Private Deposit Proof Generation - 500 Garaga formatting failed
2. Private Withdraw Proof Generation - depends on private_deposit
3. On-Chain Proof Format Compatibility - needs real proof from private path
4. Garaga Proof Verification (Simulated) - needs real proof
5. Garaga Proof Verification (On-Chain) - needs real proof

**Cause:** circuits/garaga_calldata.mjs (garaga npm package) runs WASM for BN254 pairing; in some environments it exits with Error: unreachable. So PrivateDeposit/PrivateWithdraw proof generation succeeds (snarkjs), but formatting for the Garaga verifier fails.

**What passes:** Full Privacy (Pool B) deposit + register_commitment, Full Privacy withdraw proof with change, zkML proofs, contract accessibility, identity/onboarding/agent marketplace. Use backend_full_privacy_e2e.sh as the source of truth for Pool B and Pool C API.
as the source of truth for Pool B and Pool C API.
