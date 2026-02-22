# obsqra.fi EVM build vs zkdefi: privacy and depositor hiding

This doc summarizes how the **obsqra.fi EVM** build (source in `/opt/obsqra.fi`) handles privacy and recovery, and what would be needed for true **depositor hiding** (Tornado-style) on either chain.

---

## Where the EVM build lives

- **Path:** `/opt/obsqra.fi` (and `obsqra.fi-public`). EVM (Base, Anvil, etc.).
- **Spec:** `hash.obsqra/` under that repo — Hash Obsqra protocol for wallet-gated encrypted receipts.
- **Contracts:** `contracts/src/PoolController.sol`, `NullifierRegistry.sol`, `Groth16VerifierAdapter.sol`, strategy adapters.

---

## What obsqra.fi EVM actually does (Hash Obsqra)

**Hash Obsqra** is a **receipt and recovery** protocol, not an on-chain depositor-hiding mechanism:

1. **Wallet-gated encrypted receipts**  
   After a deposit, the app creates a receipt containing commitment, secret, nullifier, amount. It **encrypts** that with a key derived from the **deposit wallet’s EIP-191 signature** (message like `"Encrypt receipt for obsqra.fi"`). The receipt is stored in localStorage, IPFS, and optionally in a blockchain event (e.g. CID).

2. **Signature usage**  
   The **signature** is used to:
   - **Derive the decryption key** for the receipt (so only that wallet can decrypt).
   - **Sign the receipt hash** for authenticity (`signature.receipt_hash`, `signature.wallet_signature` in the receipt).  
   It is **not** submitted inside the deposit/withdraw transaction to hide the depositor. The receipt (with signature) lives off-chain / IPFS / event payload.

3. **Recovery and “more privacy”**  
   - **Recovery:** If you lose the device, you can reconnect the **deposit** wallet, sign to decrypt the receipt, and re-import the commitment into any wallet.
   - **Withdrawer privacy:** You withdraw from a **different** wallet than the one that deposited. So on-chain you do **not** see “same address deposited and withdrew.” The withdrawal tx signer is a fresh address; only the ZK proof links to the commitment.  
   So obsqra.fi EVM achieves **withdrawer** privacy (break deposit↔withdraw link by address) and **recoverability** (wallet-gated decryption). It does **not** hide the depositor on-chain.

---

## On-chain visibility in obsqra.fi EVM

From `contracts/src/PoolController.sol` and `PRIVACY_ANALYSIS.md`:

- **Deposit event:** `Deposit(address indexed depositor, uint256 amount, bytes32 commitment, uint256 timestamp)`  
  So **depositor, amount, and commitment** are public in the event.
- **Withdraw:** Nullifier, recipient, amount are visible (event/calldata).

So the EVM pool **does not hide the depositor** in the contract; it’s the same visibility as “we don’t store depositor in our pool events but the token/calldata leaks it” on Starknet — on EVM the **pool event itself** exposes the depositor.

---

## What would be needed for true depositor hiding (Tornado-style)

This corresponds to **Tier 3** in [PRIVACY_TIERS.md](PRIVACY_TIERS.md).


1. **Relayer-submitted deposit**  
   The **deposit** tx is sent by a relayer (or another third party), not by the user. So `msg.sender` / tx signer is the relayer; the user moves funds to the relayer off-chain or via a separate flow, and the relayer calls `deposit(amount, commitment)`. Then the chain shows “relayer deposited,” not “user deposited.”  
   Neither obsqra.fi EVM nor zkdefi implements this today.

2. **Contract design**  
   The pool must allow a **deposit** entrypoint that does not require the depositor to be `msg.sender` (e.g. relayer is the only caller, or there is a meta-tx / permit flow that credits the commitment to the right note).

3. **Roadmap (zkdefi)**  
   We already have “Later: Private recipient in proof; relayer submits **withdraw**.” For **depositor** hiding we’d add: “Relayer (or meta-tx) submits **deposit** so tx signer ≠ depositor.”

---

## Summary

| Aspect | obsqra.fi EVM (Hash Obsqra) | zkdefi (Starknet) |
|--------|----------------------------|--------------------|
| **Receipt / recovery** | Encrypted receipt, wallet signature to decrypt; IPFS + events + localStorage | No Hash Obsqra; commitments/notes stored in app/backend as needed |
| **Signature in tx?** | No — signature is for receipt encryption/authenticity, not in deposit/withdraw calldata | No — proof in withdraw tx, but signer still visible |
| **Depositor on-chain** | **Visible** — `Deposit(address indexed depositor, ...)` | **Visible** — tx signer + token `Transfer(depositor, pool, amount)` |
| **Withdrawer privacy** | Yes — withdraw from a different wallet; recovery uses deposit wallet only to decrypt | Possible if user withdraws from a different wallet; no receipt protocol |
| **Depositor hiding** | Not implemented | Not implemented |
| **Roadmap** | — | Relayer withdraw (later); depositor hiding would require relayer deposit |

So: **obsqra.fi EVM** gives better **recoverability** (Hash Obsqra) and **withdrawer** privacy (withdraw from fresh wallet); it does **not** put a “signature proof in the transaction” to hide the depositor, and the EVM contract still emits the depositor in the Deposit event. True Tornado-style **depositor** hiding would need **relayer-submitted deposits** (and matching contract/UX) on either stack.
