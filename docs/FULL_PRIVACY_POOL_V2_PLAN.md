# Full Privacy Pool V2 — Improvement Plan (No Breaking Changes)

**Scope:** Make the Full Privacy Pool better (e.g. partial withdrawals with change) without breaking existing deposit/withdraw flow.

**Status:** Plan only — no implementation until approved.

---

## 1. Current State

| Layer | Behavior |
|-------|----------|
| **Contract** | `fully_shielded_pool.cairo`: one nullifier per commitment; marking it spent does not create a new commitment. |
| **Merkle tree** | Separate contract. Pool inserts on deposit. Withdraw only checks `is_known_root_u256`. Backend syncs roots via `add_known_root`. |
| **Circuit** | `FullPrivacyWithdraw.circom`: proves `withdrawAmount <= commitmentAmount`. No change-commitment output. |
| **Backend** | Generates commitment, registers root, generates withdraw proof. Does not create a "change" commitment. |
| **Frontend** | Full-withdrawal-only UX (partial would lock remainder). |

**Why partial locks funds today:** Withdraw marks the nullifier as spent and sends `amount` to recipient. The remainder has no new commitment; same nullifier can't be reused.

---

## 2. Goals (Without Breaking Current Flow)

- **Partial withdrawals with change:** Withdraw X from commitment of Y; send X to recipient and create a new commitment for (Y - X).
- **Keep existing pool and tree working:** All current deposits/withdrawals continue on the same addresses and entrypoints.

---

## 3. Approach: New Pool (V2), Same Tree

- **Do not change the existing pool contract.** No migration of already-deposited funds.
- **Introduce a second pool contract (V2)** with a new entrypoint for withdraw-with-change.
- **Merkle tree:** V2 uses the **same** merkle tree. New entrypoint only; tree already supports more leaves. Backend keeps syncing roots. No tree redeploy.

---

## 4. Contract Changes (V2 Pool Only)

**New contract or new deploy** with same deposit/withdraw plus:

1. **New entrypoint: `withdraw_with_change_u256`**
   - Params: nullifier, root, recipient, withdraw_amount, pool_type, change_commitment_low/high, change_amount, zk_proof.
   - Logic: same checks as current withdraw; proof must bind withdraw_amount, change_amount, change_commitment.
   - Transfer withdraw_amount to recipient; mark nullifier used.
   - **New:** Insert (change_commitment_low, change_commitment_high) into the **same** merkle tree (pool must be allowed inserter).
   - No extra token transfer for change — it's re-deposited as a new leaf.

2. **Merkle tree:** No change. Add V2 pool as allowed inserter (admin).

3. **Backward compatibility:** Existing pool unchanged. New flow only when calling V2 and the new entrypoint.

---

## 5. Circuit Changes

**New circuit:** e.g. `FullPrivacyWithdrawWithChange.circom`

- Public inputs: root, nullifier, recipient, withdrawAmount, changeAmount, changeCommitment, poolType.
- Private: same as now, plus change_nonce, change_blinding.
- Constraints: same commitment/nullifier/merkle; **new:** withdrawAmount + changeAmount === commitmentAmount; changeCommitment = H(secret, changeAmount, poolType, change_nonce, change_blinding).
- Existing `FullPrivacyWithdraw.circom` stays for full withdrawals.

---

## 6. Backend Changes

- **New endpoint:** e.g. `POST /withdraw/generate_proof_with_change` — returns proof + change_commitment + change_amount.
- **Root sync after withdraw-with-change:** When user executes withdraw_with_change, tree gains one leaf. Backend must register new root (same as register_commitment after deposit). Backend can apply insert(change_commitment) in memory and call add_known_root(new_root).
- Existing endpoints unchanged.

---

## 7. Frontend Changes

- **Config:** Add optional `NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS`.
- **V2 path:** Partial amount input; "Withdraw X; Y remains (new commitment)"; call new proof endpoint and `withdraw_with_change_u256`; on success remove old commitment and add new change commitment to local list.
- **V1 path:** Unchanged — full withdraw only, current pool.
- If V2 not set, behavior identical to today.

---

## 8. Deployment / Migration

| Step | Action | Breaks existing? |
|------|--------|-------------------|
| 1 | Deploy new pool (V2) with withdraw_with_change_u256 | No |
| 2 | Add V2 as allowed inserter on existing merkle tree | No |
| 3 | Build new circuit; backend new endpoint | No |
| 4 | Backend: proof_with_change + register new root after change | No |
| 5 | Frontend: V2 env + partial-withdraw UI when V2 | No (feature-flagged) |

Existing commitments keep using V1 pool and full withdraw. New deposits can use V2; withdrawals can be full or partial with change. Same tree for both.

---

## 9. Summary

| Item | V1 (current) | V2 (new) |
|------|--------------|----------|
| Pool | Existing address | New deploy |
| Full withdraw | withdraw_u256 | Same on V2 |
| Partial withdraw | Not supported | withdraw_with_change_u256 |
| Tree | Current | Same tree |
| Circuit (partial) | — | FullPrivacyWithdrawWithChange |
| Backend | Current | + proof_with_change + root sync for change |
| Frontend | Full only | Optional partial when V2 configured |

---

## 10. What We Do Not Change

- Existing pool contract and its entrypoints.
- Existing merkle tree and root history.
- Current deposit and full-withdraw flows.
- Backend merkle state and add_known_root sync.
- Frontend when V2 is not configured.

---

## 11. Implementation Order (When You Build It)

1. **Circuit:** Add `FullPrivacyWithdrawWithChange.circom`; build WASM + zkey; verify public signals match contract expectations.
2. **Contract:** Add `withdraw_with_change_u256` to pool (new file or copy + extend); deploy as V2; admin adds V2 as tree inserter.
3. **Backend:** New route and service for `generate_proof_with_change`; after withdraw-with-change, insert change leaf in memory and call `register_root_on_chain` for the new root.
4. **Frontend:** Env for V2 address; withdraw step: if V2 and amount < commitment amount, use new endpoint and new entrypoint; persist change commitment in localStorage with new nonce/blinding/leaf when backend returns or from event.
5. **Docs / ENV:** Document `FULL_PRIVACY_POOL_V2_ADDRESS`, `NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS`; optional "Deposit to V1 vs V2" in UX later.

---

## 12. File-Level Checklist (No Changes Until Implement)

| Area | File(s) | Change |
|------|---------|--------|
| Circuit | `circuits/FullPrivacyWithdrawWithChange.circom` | New circuit; build script |
| Contract | `contracts/src/fully_shielded_pool_v2.cairo` or extend pool | New entrypoint; deploy script |
| Tree | `contracts/src/merkle_tree.cairo` | None (only add V2 as inserter) |
| Backend | `backend/app/api/routes/full_privacy.py` | New POST proof_with_change |
| Backend | `backend/app/services/full_privacy_proof_service.py` | generate_withdraw_proof_with_change |
| Backend | `backend/app/services/merkle_tree_onchain_sync.py` | No change (same register_root) |
| Frontend | `frontend/.../FullPrivacyPoolPanel.tsx` | V2 branch: partial amount, new API, new calldata |
| Frontend | `frontend/.env*`, `deploy_production.sh` | Optional V2 address |
| Docs | `docs/ENV.md`, `docs/FULL_PRIVACY_MERKLE_ROOT_SYNC.md` | Document V2 and change-flow root sync |

---

## 13. Risks / Caveats

- **Root sync timing:** After withdraw_with_change, the new root must be registered before anyone can withdraw using that root. Backend should register as soon as it knows the tx (event or explicit "sync after tx" call from frontend).
- **Double spend:** Change commitment must use a new nonce (and optionally new blinding) so it's a distinct leaf; circuit must bind these.
- **V1 vs V2 UX:** Users with commitments on V1 never see partial withdraw; only V2 commitments get the option. Clear labeling ("Full Privacy (V1)" vs "Full Privacy (V2)") avoids confusion.
- **WithChange verifier:** ✅ **DEPLOYED** — Garaga verifier for `FullPrivacyWithdrawWithChange` deployed (see section 14).

---

## 14. Deployment Status (Starknet Sepolia)

**Deployed: 2026-02-10 (Updated: 2026-02-07)**

### Contracts:
- **Garaga Verifier (FullPrivacyWithdraw - full withdrawals)**: `0x07890b8387a71e1df9a37793e995cc5ac4bb055fa67c292ff296bdb0705352a1`
- **Garaga Verifier (FullPrivacyWithdrawWithChange - partial withdrawals)**: `0x0077afd06dc426ba8cb66ec51e1900e903812e3d034a91a0ac310be3a8e91350`
  - Transaction: https://sepolia.starkscan.co/tx/0x05e4806401531313f3d9c4b0fdc0c169e20b551c03187e4e91664ac8b367318a
- **FullyShieldedPool V2**: `0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1`
  - Transaction: https://sepolia.starkscan.co/tx/0x073cd950238498a1b990323f0d003ba53eda17f53e5167fc32516bf2942705f0
  - Initial constructor args:
    - merkle_tree: `0x03659ca95ebe890741ca68dd84945716ca9e40baa6650d81f977466726370947`
    - withdraw_verifier: `0x0077afd06dc426ba8cb66ec51e1900e903812e3d034a91a0ac310be3a8e91350` (⚠️ WRONG - fixed below)
    - token: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
    - admin: `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`
  - **FIXED** - Updated verifiers:
    - `withdraw_verifier`: `0x07890b...` (for full withdrawals) - [Tx: 0x04e7978ca110988d3ddcc7dcf96accf193b8e7e0c253974ecfa4d5de7c60dcb4](https://sepolia.starkscan.co/tx/0x04e7978ca110988d3ddcc7dcf96accf193b8e7e0c253974ecfa4d5de7c60dcb4)
    - `withdraw_with_change_verifier`: `0x0077af...` (for partial withdrawals)

### Environment Configuration:
```bash
# Backend (.env)
FULLY_SHIELDED_POOL_V2_ADDRESS=0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1

# Frontend (.env.local)
NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS=0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1
```

### Test Results:
✅ E2E test `test_full_privacy_withdraw_proof_with_change` passes (29.5s)
- Generates commitment
- Registers commitment in backend Merkle tree
- Generates partial withdraw proof with change commitment
- Validates proof calldata format

✅ **Production V2 deposits and withdrawals working** (2026-02-10)
- Fixed "Unknown merkle root" error caused by nonce conflicts in root registration
- Backend now successfully registers roots on-chain using `sncast` with retry logic
- All 36 backend roots synced to on-chain merkle tree

### Scripts:
- **Generate Verifier**: `circuits/generate_with_change_verifier.sh`
- **Deploy Verifier**: `scripts/deploy_with_change_verifier.sh` (uses sncast)
- **Build Circuits**: `circuits/build_private_circuits.sh` (includes VK export)

### Known Issues & Fixes:
1. ✅ **Merkle Root Sync**: Fixed `InvalidTransactionNonce` errors by switching from `starkli` to `sncast` with exponential backoff retry logic. See `integration_tests/dev_log.md` for details.
2. ✅ **Withdrawal Routing**: Fixed logic that routed full withdrawals to V1 pool instead of V2. Now all withdrawals (partial and full) correctly route to V2 when V2 is configured. See `integration_tests/dev_log.md` for details.
3. ✅ **Stored Root Validation**: Fixed backend to verify stored roots are on-chain before reusing them. Prevents "Unknown merkle root" errors from stale localStorage data. Backend now checks both backend history AND on-chain state before accepting stored proofs. See `integration_tests/dev_log.md` for details.
4. ✅ **Wrong Verifier in V2 Constructor (2026-02-07)**: Fixed critical bug where V2 pool was deployed with WithChange verifier as `withdraw_verifier`. V2 pool needs TWO verifiers: (1) FullPrivacyWithdraw for **full** withdrawals, (2) FullPrivacyWithdrawWithChange for **partial** withdrawals. Full withdrawals were failing with "Option::unwrap failed" because they were using the wrong proof format. Fixed by calling `set_withdraw_verifier` to update to correct verifier. See `integration_tests/dev_log.md` for details.
