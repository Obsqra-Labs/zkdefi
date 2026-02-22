# Transaction lookup and on-chain privacy (zkde.fi)

Use **Starkscan** (Sepolia or mainnet) or **your RPC** to inspect a tx. This doc summarizes what is visible vs hidden for zkde.fi Full Privacy Pool flows. Current zkde.fi Full Privacy (Pool B/C) is **Tier 1**: note unlinkability; depositor, amount, recipient visible (calldata + token). See [PRIVACY_TIERS.md](PRIVACY_TIERS.md).

---

## Look up a transaction

**Obsqra RPC (Sepolia):**
```bash
# Your RPC is Sepolia (chainId SN_SEPOLIA). Tx must be on Sepolia.
curl -s -X POST https://starknet.obsqra.fi/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionByHash","params":["0x<tx_hash>"]}'

curl -s -X POST https://starknet.obsqra.fi/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt","params":["0x<tx_hash>"]}'
```

**Starkscan (browser):**
- Sepolia: https://sepolia.starkscan.co/tx/0x\<tx_hash\>
- Mainnet: https://starkscan.co/tx/0x\<tx_hash\>

If a hash returns "not found" on obsqra RPC, it may be on **mainnet** (use Starkscan mainnet or a mainnet RPC).

---

## Example: `0x780ebec2c53807cd3a015e0d5000ffad2238c91c0d3b4c84646d4690052379e`

- **Obsqra RPC (Sepolia):** returns "Transaction hash not found" → this tx is likely on **mainnet** or another network.
- To inspect it: open **https://starkscan.co/tx/0x780ebec2c53807cd3a015e0d5000ffad2238c91c0d3b4c84646d4690052379e** (mainnet) or the Sepolia link if you expect Sepolia.

---

## On-chain visibility (Full Privacy Pool / zkde.fi)

From `contracts/src/fully_shielded_pool.cairo` and `shielded_pool.cairo`:

### Deposit

| On-chain | Visible? | Notes |
|----------|----------|--------|
| **Caller** | Yes | Tx signer (e.g. wallet address) is public. |
| **Contract called** | Yes | Pool address, function selector (e.g. `deposit_u256`). |
| **Calldata** | Partially | Commitment as u256 (low, high), **amount** (used for transfer_from). The commitment hash also encodes the note (secret, amount, …) but amount is visible in calldata. |
| **Events** | Partially | `DepositU256`: commitment_low, commitment_high, leaf_index, timestamp. **No amount, no balance.** |

**Privacy:** Amount is visible in calldata (needed for transfer_from). Events hide amount. Link between your wallet and the commitment is visible (same tx).

---

### Withdraw

| On-chain | Visible? | Notes |
|----------|----------|--------|
| **Caller** | Yes | Who invoked (could be relayer or user). |
| **Contract + selector** | Yes | e.g. `withdraw_u256`. |
| **Calldata** | Yes | **Recipient address, amount, root (u256), nullifier (u256), pool_type, proof calldata.** The contract needs recipient and amount to transfer; they are in calldata and stored in the block. |
| **Events** | Partially | `WithdrawalU256`: nullifier_low, nullifier_high, timestamp. **Event does NOT emit amount or recipient** (privacy preserved in events). |

**Privacy:** Which commitment was spent is hidden (nullifier does not reveal it without the note). **Recipient and amount are visible in calldata** (and thus on Starkscan / any RPC). So withdraw is **not fully private**: an observer sees “someone sent X to address Y at this time.”

---

## Token contract: we leak everything outside the pool

The pool holds an **ERC‑20** and uses standard `transfer_from` / `transfer`. The **token contract** emits normal `Transfer(from, to, value)` events.

| Flow    | Token event | What is visible |
|---------|-------------|------------------|
| **Deposit**  | `Transfer(depositor, pool, amount)` | Depositor address, pool address, **amount**. |
| **Withdraw** | `Transfer(pool, recipient, amount)`  | Pool, **recipient address**, **amount**. |

So **outside the pool**: amount and identities are fully visible in **token** events (and in calldata). The pool's own events are minimal on purpose, but the token gives everything away. Anyone indexing the token (or the tx receipt) sees who deposited how much, and who withdrew how much to whom.

**In practice:** We are **not** hiding amounts or links depositor↔pool or pool↔recipient on-chain. What we get is **note unlinkability** (which commitment funded which withdraw) and a design that could support stronger privacy if the token layer were private (e.g. private transfer primitive or pool-as-token).

---

## Security level summary

- **Deposit:** **Amount and depositor→pool link are visible** (calldata + token `Transfer`). Pool event does not emit amount, but token does.
- **Withdraw:** **Amount and recipient are visible** (calldata + token `Transfer`). Nullifier only hides which deposit was spent.
- **ZK proof:** Verifies “I know a note in the tree with this root; I’m revealing its nullifier; send amount to recipient.” It does not hide recipient or amount from the chain or from the token.

To actually hide amounts and identities on-chain you'd need a different **token** design (e.g. private transfers, or pool-as-issuer so moves are internal) and/or recipient/amount inside the proof with a relayer.

---

## Quick RPC check (chain + tx)

```bash
# Which chain is obsqra RPC?
curl -s -X POST https://starknet.obsqra.fi/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_chainId","params":[]}'
# Result: "0x534e5f5345504f4c4941" = SN_SEPOLIA
```

Use Sepolia Starkscan (or obsqra RPC) for Sepolia txs; use mainnet Starkscan (or a mainnet RPC) for mainnet txs.
