# Relayer Sustainability and Privacy: Technical Explainer

This document describes how zkde.fi’s relayer and Pool D payout flows are funded today (“sponsor payouts”), why that is not sustainable at scale, and which changes preserve privacy while making the system sustainable.

---

## 1. Current architecture: who pays for what

### 1.1 Tier 2 / Tier 1 relayed withdrawals (Pool B/C)

**Flow:** User requests a relayed withdrawal (nullifier + root + ZK proof). Backend enqueues the request; the relayer runner (same process, `RELAYER_RUNNER_ENABLED=true`) calls the pool contract’s `withdraw_relayed_u256` with the relayer’s account as transaction signer. The pool pays the withdrawal amount to the user’s recipient/commitment.

**Who pays:**
- **Gas:** The relayer account (operator-funded). The relayer is the transaction signer; Starknet charges that account for execution and L1 data.
- **Tokens:** The pool contract holds the tokens; the withdrawal is a transfer from pool to user. The operator does not supply the withdrawal amount; the pool does. So for the **token** side, the operator does not pay. For the **gas** side, the operator pays.

**Fee in the API:** `backend/app/api/relayer.py` defines `get_tier_fee(tier)`: Tier 1 = 50 bps (0.5%), Tier 2 = 10 bps (0.1%). When the frontend or a client asks for execution status, the API returns `amount_sent` (amount_wei − fee) and `fee_collected` (fee). The `/stats` endpoint aggregates `total_fees_wei` from executed Tier 1 requests. **Important:** The relayer runner (`relayer_runner.py`) invokes `withdraw_relayed_u256` with the calldata (nullifier, root, pool_type, proof); it does **not** pass a fee or split amount. The pool contract today pays the full withdrawal amount. So the “fee” is **accounting only** in the API; it is not enforced on-chain. The operator is therefore **sponsoring gas** for every relayed withdrawal; fee revenue is not yet realized on-chain.

### 1.2 Tier 3 relayed deposits (Pool B/C)

**Flow:** User creates a deposit request (commitment + amount). User **sends the deposit amount** to the relayer’s address (shown via `GET /relayer/stats` → `relayer_address`). The relayer runner later picks up the request and calls the pool’s `deposit_u256` (or equivalent), moving tokens from the relayer’s balance into the pool and crediting the commitment.

**Who pays:** The **user** pays the full deposit amount (and their own gas to send to the relayer). The operator only pays relayer **gas** for the `deposit_u256` transaction. So token flow is user-funded; gas is still operator-funded. This is already more sustainable on the token side than Pool D claims.

### 1.3 Pool D (Tier-2H) claim payouts

**Flow:** User has previously deposited into the hashed-withdraw pool and later submitted a **claim** (claim hash + commitment + proof) that was registered on-chain (e.g. via a claim entrypoint). The backend stores a **claim request** (amount, commitment, proof, claim_hash, etc.) and the relayer runner processes it after `ready_time`. In **onchain** mode (`LEDGER_PAYOUT_MODE=onchain`), the runner calls either an escrow’s `payout_claim_u256` or `ConfidentialTransfer.private_deposit_u256`, sending tokens from the relayer/escrow to the user’s shielded commitment.

**Who pays:** The **operator** (relayer or escrow account) pays **gas** and the **full claim amount** (tokens). No fee is deducted from the user. So we have full **sponsor payouts**: the operator funds both execution cost and the payout itself. This is not sustainable at scale unless the operator has other revenue or we change the model.

### 1.4 Ledger withdraw (internal ledger → shielded)

**Flow:** User has an internal ledger balance (e.g. from a Tier-2H claim settled in internal mode). They call `POST /relayer/ledger/withdraw` with amount and commitment; backend debits the ledger and enqueues a **ledger withdraw** job. The relayer runner calls `ConfidentialTransfer.private_deposit_u256` to move tokens from the relayer’s balance into the shielded pool for that commitment.

**Who pays:** The **operator** (relayer) pays **gas** and the **tokens** for the deposit. Again sponsor-funded.

### 1.5 Internal mode for Pool D claims

When `LEDGER_PAYOUT_MODE=internal`, the runner does **not** call `private_deposit_u256` or escrow payout for claims. It only checks that the claim is registered on-chain (`is_claimed_u256` on the hashed-withdraw pool or related contract) and then **credits the user’s ledger balance** in the backend DB. No token transfer; no relayer token balance required. The operator pays no gas for the payout step (only a read call if needed). So internal mode removes both token and gas cost for claim settlement; sustainability improves and privacy is unchanged (amounts/recipients remain in proofs and internal state).

---

## 2. Why this is “sponsor payouts” and why it’s unsustainable

**Sponsor payouts** here means: the **operator** (zkde.fi / Obsqra) pays the cost of settling user-facing payouts (gas and, where applicable, tokens) instead of the user or a fee pool.

- **Relayed withdrawals (Tier 1/2):** Operator pays gas; fee is tracked in API but not enforced on-chain → no fee revenue to offset gas.
- **Pool D claim payouts (onchain):** Operator pays gas + full claim amount → direct and unbounded cost.
- **Ledger withdraw:** Operator pays gas + tokens → same.

At scale, unbounded sponsor payouts are unsustainable unless funded by grants, other product revenue, or a deliberate cap. So we need models that either shift cost to the user (or to a fee pool) or remove cost (e.g. internal mode for claims) while preserving privacy.

---

## 3. Privacy invariants we want to preserve

- **Recipient and amount in relayed withdrawals:** Only in the ZK proof and/or commitment, not in plain calldata. The relayer and chain see “a withdrawal with this nullifier/root/proof,” not the recipient address or amount in clear text.
- **Pool D (Tier-2H):** Claim hash and commitment; amount and recipient are hidden in the proof. On-chain we see “a claim payout to this commitment” (and possibly a fee parameter), not the underlying amount or identity in plain form.
- **Ledger:** Internal ledger is off-chain (DB); only the withdraw step may touch chain (private_deposit to a commitment). We do not want to expose per-user balances or history on-chain.

Any sustainability mechanism (fees, user-funded flows) should preserve these: fees can be tier-based or flat bps; amounts and recipients stay inside proofs/commitments.

---

## 4. Sustainable options (technical)

### 4.1 Internal mode for Pool D claims

**What:** Set `LEDGER_PAYOUT_MODE=internal`. The relayer runner, for each claim request, only verifies on-chain that the claim is registered (`is_claimed_u256`) and then credits the user’s ledger in the backend (e.g. `ledger_service.credit_balance`). No `private_deposit_u256` or escrow payout.

**Sustainability:** Operator pays no tokens and minimal (or no) gas for the payout step. Claim settlement cost goes to zero for the operator.

**Privacy:** Unchanged. Amounts and recipients are already in proofs and internal ledger; we do not add new on-chain leakage.

**Caveat:** User’s balance is now on the **internal ledger**. To get tokens into a shielded commitment they must later do a **ledger withdraw** (which can be made user-funded or fee-funded; see below).

### 4.2 Enforce relay fees on-chain (Tier 1/2)

**What:** Today the pool (or the relayer’s invocation) pays the **full** withdrawal amount to the user. To make relay sustainable, the flow must split the amount: `(amount - fee)` to the user’s recipient/commitment and `fee` to a **treasury** or **relayer** address. That requires either:
- Contract change: the pool’s `withdraw_relayed_u256` (or a wrapper) accepts a fee_bps or fee_wei and a fee recipient, and sends `amount - fee` to the user and `fee` to the recipient, or
- A two-step flow: relayer receives full amount from pool then sends `amount - fee` to user and `fee` to treasury (more complex and possibly less gas-efficient).

**Sustainability:** Accumulated fees fund the relayer (gas and optionally a buffer). Fee is already defined in API (50 bps / 10 bps); it just needs to be enforced on-chain.

**Privacy:** Fee can be a function of tier only (e.g. 0.5% or 0.1%); it does not need to reveal the withdrawal amount or recipient. Recipient and amount remain in the proof.

### 4.3 Claim fee for Pool D onchain payouts

**What:** When `LEDGER_PAYOUT_MODE=onchain`, before calling `private_deposit_u256` (or escrow payout), the runner computes `fee = claim_amount * fee_bps / 10000` (or a flat fee). It then submits a payout of `claim_amount - fee` to the user’s commitment and routes `fee` to the relayer/treasury (e.g. a second transfer or a contract that splits). Implementation can live in the runner and, if needed, in the escrow/ConfidentialTransfer contract (e.g. a dedicated “payout with fee” entrypoint).

**Sustainability:** Each onchain claim payout generates a small fee to the operator, offsetting gas and token cost.

**Privacy:** The **net** amount to the user’s commitment can remain the only on-chain observable; the fee can be a fixed bps or flat so it does not leak the full claim amount. Recipient is still only in the commitment.

### 4.4 User-funded ledger withdraw

**What:** For `POST /relayer/ledger/withdraw`, require that the user first sends `(withdraw_amount + fee)` to the relayer address (similar to Tier 3 deposit). The runner only processes the ledger-withdraw job when the relayer’s balance has received that amount. The runner then submits `private_deposit_u256` for `withdraw_amount` to the user’s commitment; the extra `fee` stays in the relayer and funds gas / sustainability.

**Sustainability:** User pays both the principal and the fee; operator no longer sponsors this flow.

**Privacy:** Withdraw amount and recipient are still in the proof and commitment; the fee can be a flat or tier-based value.

### 4.5 Tier 3 deposit (already user-funded)

**What:** Already implemented. User sends the deposit amount to the relayer; relayer submits `deposit_u256`. No operator token cost for the deposit itself; only gas.

**Sustainability:** Token side is user-funded. Gas can be covered over time by relay/claim fees if those are enforced (see above).

---

## 5. Summary table

| Flow | Who pays today | Sustainable change | Privacy |
|------|----------------|--------------------|--------|
| Tier 1/2 relayed withdraw | Operator (gas); pool (tokens) | Enforce fee on-chain → fee to treasury/relayer | Fee = bps/tier; amount/recipient in proof |
| Tier 3 deposit | User (tokens); operator (gas) | Gas funded by fees (above) | Unchanged |
| Pool D claim (onchain) | Operator (gas + tokens) | Internal mode (no token/gas) or claim fee (fee → relayer) | Unchanged |
| Ledger withdraw | Operator (gas + tokens) | User-funded (user sends amount + fee to relayer) | Unchanged |

---

## 6. References

- **Who pays and unstuck:** [LEDGER_WHO_PAYS_AND_UNSTUCK.md](LEDGER_WHO_PAYS_AND_UNSTUCK.md)
- **Relayer funding (self vs user):** [RELAYER_POOL_D_UI_SCOPE.md](RELAYER_POOL_D_UI_SCOPE.md) §5
- **Backend relayer API:** `backend/app/api/relayer.py` (`get_tier_fee`, `/stats`, claim/ledger endpoints)
- **Runner:** `backend/app/services/relayer_runner.py` (`_submit_claim_payout`, `_submit_ledger_withdraw`, `_submit_withdrawal`)
