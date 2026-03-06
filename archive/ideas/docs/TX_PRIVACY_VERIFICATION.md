# Pool B / Pool C — Transaction privacy verification

Pool B (Full Privacy) and Pool C (Tornado-style) both use the same **FullyShieldedPool** contract. This doc defines the **privacy profile** (what is hidden vs visible on-chain) and how to verify a real tx matches it.

---

## Privacy profile (from the contract)

Source: `contracts/src/fully_shielded_pool.cairo`.

### Deposit (`deposit_u256`)

| Where | Visible | Hidden |
|-------|---------|--------|
| **Calldata** | Caller (tx signer), contract, selector, **commitment_low, commitment_high, amount** | — |
| **Events** | commitment_low, commitment_high, leaf_index, timestamp | **Amount, balance** (not emitted) |

So: **amount is visible in deposit calldata** (contract needs it for `transfer_from`). Events do not reveal amount.

### Withdraw (`withdraw_u256`)

| Where | Visible | Hidden |
|-------|---------|--------|
| **Calldata** | Caller, contract, selector, **nullifier, root, recipient, amount**, pool_type, proof | — |
| **Events** | nullifier_low, nullifier_high, timestamp | **Amount, recipient** (not emitted) |

So: **recipient and amount are visible in withdraw calldata**. Events only expose nullifier and timestamp.

### What is actually private

- **Note unlinkability:** Which deposit (commitment) funded which withdraw is not derivable from chain data (nullifier does not reveal the commitment without the note).
- **Pool events:** No amount or recipient in the pool's own events.
- **Not private on-chain:** The **token contract** emits standard `Transfer(from, to, value)` for every deposit and withdraw, so **outside the pool** we leak everything: depositor→pool and amount on deposit, pool→recipient and amount on withdraw. Calldata also exposes amount (and recipient on withdraw). See **Token contract: we leak everything outside the pool** in [TX_PRIVACY_LOOKUP.md](TX_PRIVACY_LOOKUP.md).

---

## How to verify a tx

1. **Get the tx hash**  
   From the app (toast / activity log after deposit or withdraw) or from Starkscan (contract → Transactions for the pool).

2. **Open the tx on Starkscan**  
   - Sepolia: `https://sepolia.starkscan.co/tx/0x<tx_hash>`  
   - Mainnet: `https://starkscan.co/tx/0x<tx_hash>`

3. **Check calldata vs events**

   **Deposit:**
   - Calldata should include: commitment (two u128/u256 parts), **amount** (u256 or two felts).
   - Events: `DepositU256` with commitment_low, commitment_high, leaf_index, timestamp — **no amount**.

   **Withdraw:**
   - Calldata should include: nullifier, root, **recipient** (address), **amount** (u256), pool_type, proof.
   - Events: `WithdrawalU256` with nullifier_low, nullifier_high, timestamp — **no amount, no recipient**.

4. **RPC (optional)**  
   Use the RPC commands in `TX_PRIVACY_LOOKUP.md` to fetch `starknet_getTransactionByHash` and `starknet_getTransactionReceipt` and inspect `calldata` and `events` in the JSON.

---

## Checklist: “Does this tx match the privacy profile?”

- [ ] **Deposit:** Event has no amount; calldata has commitment + amount.
- [ ] **Withdraw:** Event has no amount/recipient; calldata has recipient + amount + nullifier + proof.
- [ ] No extra leakage: events only contain what’s listed above.

If all hold, the tx matches the documented privacy profile. Pool B and Pool C use the same contract, so the same checks apply to both.
