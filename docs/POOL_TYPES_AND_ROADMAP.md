# Pool Types and Roadmap: Shielded (A), B, C

Privacy tiers (what is hidden on-chain) are defined in [PRIVACY_TIERS.md](PRIVACY_TIERS.md). Below: pool labels A/B/C and where they stand vs those tiers.

---

## Naming (A = Shielded, B = Full Privacy, C = Tornado-style)

| Label | Meaning | Implementation |
|-------|--------|----------------|
| **A (Shielded)** | Pool left as-is; balance-style, relayer option | ShieldedPoolPanel, `/shielded_deposit`, `/shielded_withdraw`, ShieldedPool contract. PrivateDeposit/PrivateWithdraw circuits. |
| **B (Pool B – Full Privacy)** | Note-unlinkable Merkle pool | FullPrivacyPoolPanel, `/api/v1/zkdefi/full_privacy/*`, FullyShieldedPool + Merkle tree. FullPrivacyWithdraw circuit. |
| **C (Pool C – Tornado-style)** | Same as B; relayer emphasized; compliance-ready | Same API/contract as B; Pool C panel uses `variant="pool_c"`. Optional `/pool_c/*` alias. |

---

## Where A, B, C stand

| Pool | Contract(s) | Backend API | Frontend | WASM / Garaga |
|------|-------------|------------|----------|----------------|
| **A (Shielded)** | ShieldedPool, ConfidentialTransfer | `shielded_deposit`, `shielded_withdraw` | ShieldedPoolPanel | **Garaga formatter required, no fallback.** If `garaga_calldata.mjs` fails (e.g. WASM "unreachable"), private deposit/withdraw return 500. |
| **B (Pool B)** | FullyShieldedPool, Merkle tree | `/full_privacy/*` | FullPrivacyPoolPanel "Pool B (Full Privacy)" | **Garaga try + snarkjs fallback.** If Garaga WASM fails, backend uses snarkjs `exportsoliditycalldata` or minimal proof calldata so withdraw proof still returns. |
| **C (Pool C)** | Same as B | Same or `/pool_c/*` | FullPrivacyPoolPanel `variant="pool_c"` | Same as B (Full Privacy proof service with fallback). |

- **A** is the one that hard-fails on Garaga WASM in this environment. **B and C** can still complete proof generation when WASM fails, via fallback calldata.
- No contract or API URL renames: backend stays `/full_privacy/` so existing clients and tests keep working.

---

## CLI wallet: full deposit and withdraw flow

**Not yet tested end-to-end with a CLI wallet** (e.g. starkli or sncast). Current automated tests:

- **Backend e2e** (`tests/backend_full_privacy_e2e.sh`): Calls API only (health, generate_commitment, register_commitment, pool_c generate_commitment). No on-chain deposit or withdraw tx.
- **Python e2e** (`e2e_test_suite.py`): Same for Full Privacy (API only for deposit/register); for withdraw it gets proof from API but does not submit an on-chain withdraw tx with a real wallet.

To validate the **full** deposit and withdraw flow (Pool B or C) with a CLI wallet you would:

1. **Deposit:** Get commitment from `POST .../full_privacy/deposit/generate_commitment` → approve token → call pool `deposit_u256(commitment, leaf_index)` (or equivalent) with sncast/starkli → call `POST .../full_privacy/deposit/register_commitment` with the commitment.
2. **Withdraw:** Get proof from `POST .../full_privacy/withdraw/generate_proof` (or `generate_proof_with_change`) → call pool `withdraw_u256(..., proof_calldata)` with the same wallet.

See [WORKING_STATE_DEPOSIT_WITHDRAW.md](WORKING_STATE_DEPOSIT_WITHDRAW.md) for the exact API and contract flow. A small script or doc for CLI-wallet testing could be added (e.g. `docs/CLI_WALLET_FULL_FLOW.md` or a script in `scripts/`).

---

## Roadmap (Pool C)

Pool C roadmap: **Tier 2** (relayer withdraw, recipient/amount in proof) → **Tier 3** (relayer deposit) → **Tier 4** (association set). See [PRIVACY_TIERS.md](PRIVACY_TIERS.md).

See [PROOF_FLOWS.md](PROOF_FLOWS.md) for circuit/contract details and [WORKING_STATE_DEPOSIT_WITHDRAW.md](WORKING_STATE_DEPOSIT_WITHDRAW.md) for Pool B deposit/withdraw preservation.
