# Ledger: Who Pays and How to Unstuck Pending Items

*Quick reference for how ledger/relayer settlement works and why items stay "pending".*

---

## Two kinds of "pending" in Pool D

| What you see | What it is | Who settles it |
|--------------|------------|----------------|
| **Ledger audit — Request #8** (status: pending) | A **Tier-2H claim request**: you submitted hash + commitment + proof. Backend stored it and added it to the relayer queue with a `ready_time` (delay by tier). | **Relayer runner** (same backend process, when `RELAYER_RUNNER_ENABLED=true`). After `ready_time` has passed, the runner picks it up and either credits your ledger (internal mode) or submits an on-chain payout (onchain mode). |
| **Withdraw from ledger — Queued (ID: 8)** | A **ledger withdraw**: you debited internal balance and asked for a payout to a shielded commitment. Backend debited the ledger and enqueued one `private_deposit` job. | **Relayer runner**. No delay; it should be picked up on the next runner poll. |

So in both cases **the relayer runner** is what actually “settles” the item. If the runner isn’t running or can’t submit, things stay pending.

---

## Who pays to settle

| Mode / flow | Who pays | What they pay |
|-------------|----------|----------------|
| **Tier-2H claim, `LEDGER_PAYOUT_MODE=internal`** | Operator (you). | Relayer only does an on-chain **read** (`is_claimed_u256`) to verify the claim, then credits your ledger in the DB. So **no relayer gas** for the payout. (The **claim** itself—that the claim is registered on-chain—must already have been submitted by someone; that tx is separate.) |
| **Tier-2H claim, `LEDGER_PAYOUT_MODE=onchain`** | Operator (you). | Relayer submits a **payout** tx (escrow `payout_claim_u256` or `ConfidentialTransfer.private_deposit_u256`). **Relayer pays gas** and **escrow/relayer must hold the tokens** that go into the shielded pool. |
| **Ledger withdraw** (POST /relayer/ledger/withdraw) | Operator (you). | Relayer submits `ConfidentialTransfer.private_deposit_u256`. **Relayer pays gas** and must have **tokens** to move into the shielded pool. |

So: **operator funds the relayer** (and escrow when used). Users don’t pay for settlement; the relayer/escrow does.

---

## How to unstuck pending items

### 1. Restart the backend

The relayer runner runs inside the backend process. If you changed code or env, **restart the backend** so the runner starts with the latest state and config.

### 2. Make sure the runner is on

- Env: `RELAYER_RUNNER_ENABLED=true` (or equivalent in your env).
- If it’s false, the runner never runs and nothing gets settled.

### 3. For Ledger audit — Request #N (claim requests)

- **Delay:** Each claim has a `ready_time` (request time + tier delay). The runner only processes it when `now >= ready_time`. So if it’s still “pending”, wait until that time has passed (or check `ready_time` in the API/state if you expose it).
- **Internal mode:** The runner will only credit your ledger if the claim is **already registered on-chain** (it calls `is_claimed_u256`). If the claim tx was never submitted, the runner will fail with “Claim not registered on-chain” and the request stays pending. In that case you must submit the claim on-chain first (e.g. using calldata from `GET /relayer/claim-request/{id}/calldata` or your normal claim flow).
- **Onchain mode:** Relayer (or escrow) must have **gas + tokens** to submit the payout. Fund the relayer address (and escrow if used).

### 4. For “Withdraw from ledger” (ledger withdraw queue)

- No delay; the runner should pick it up on the next poll. If it’s stuck:
  - **Runner running?** Restart backend (see 1) and ensure `RELAYER_RUNNER_ENABLED=true`.
  - **Relayer funded?** Relayer needs **gas** to send the `private_deposit_u256` tx and **tokens** to deposit. Fund the relayer address.
  - **Config:** `CONFIDENTIAL_TRANSFER_ADDRESS` must be set so the runner can call the contract.

### 5. Check backend logs

On each poll the runner logs what it’s doing. Look for:

- `Relayer runner starting`
- `Ledger withdraw ... tx=0x...` or `Relayed claim ... tx=...` on success
- `Ledger withdraw failed withdraw_id=... err=...` or `Relayer claim failed request_id=... err=...` on failure

Errors (e.g. “Insufficient balance”, “Claim not registered on-chain”, RPC errors) will tell you why something didn’t settle. If you see **Relayer deposit failed ... err=Relayer address/private key not configured**, the runner is running but relayer credentials are missing: set `RELAYER_ADDRESS` and `RELAYER_PRIVATE_KEY` (or starkli account) in backend `.env` so deposits and onchain payouts can be submitted; internal-mode claims (ledger credit only) can still be processed without relayer key.

---

## Short checklist

- [ ] Backend restarted after code/env changes.
- [ ] `RELAYER_RUNNER_ENABLED=true`.
- [ ] `RELAYER_ADDRESS` and `RELAYER_PRIVATE_KEY` (or starkli account) set in backend `.env` if you have pending deposits or onchain payouts.
- [ ] For claims: wait until after `ready_time`; in internal mode, ensure claim is registered on-chain first.
- [ ] For onchain payout or ledger withdraw: relayer (and escrow if used) funded with **gas + tokens**.
- [ ] `CONFIDENTIAL_TRANSFER_ADDRESS` set when doing on-chain payout or ledger withdraw.
- [ ] Backend logs checked for runner errors.

**Making it viable (no constant funding):** Use `LEDGER_PAYOUT_MODE=internal` so claims only credit the user ledger (no on-chain token move); you only fund the relayer for ledger withdrawals. To unstuck request #10 now: set internal mode and restart, or fund `RELAYER_ADDRESS` with the claim amount (e.g. 2 ETH) + gas.

**Sustainability vs privacy:** Today we have sponsor payouts (operator pays gas and, for Pool D, tokens). Sustainable options that preserve privacy: (1) Internal mode for claims (no token cost). (2) Enforce relay fees on-chain (amount minus fee to user, fee to treasury/relayer). (3) Small claim fee for Pool D onchain payouts, routed to relayer. (4) User-funded flows (Tier 3 deposit, user-funded ledger withdraw). See RELAYER_POOL_D_UI_SCOPE.md §5 for who funds what.

See [RELAYER_POOL_D_UI_SCOPE.md](RELAYER_POOL_D_UI_SCOPE.md) (relayer funding) and [ENV.md](ENV.md) (LEDGER_PAYOUT_MODE and ledger env).
