# Escalating Privacy: How zkde.fi’s Tiers Work (and How We Compare)

*A practical guide to our privacy stack, what each tier hides, and where we sit in the ecosystem.*

---

## The short version

zkde.fi doesn’t offer “one” privacy mode. We offer **escalating tiers**: you choose how much to hide (deposit link, withdraw link, amounts, recipients), and the system enforces it with zero-knowledge proofs and relay. **Internal accounting**—so that recipient and amount don’t leak via ERC‑20 transfers—is in active development in this codebase and is the next step for full on-chain privacy.

---

## What “privacy” means on-chain

On a transparent chain, every transaction exposes at least:

- **Who** signed (caller)
- **What** they called (contract, function, calldata)
- **What** the token did (`Transfer(from, to, value)`)

So “privacy” is always **what we hide**, not “everything.” We define tiers by **what is hidden on-chain** in a verifiable way.

---

## Tier 1: Note unlinkability (Pool B/C today)

**What’s hidden:** The link between a specific deposit and a specific withdraw.

**How it works:** You deposit by submitting a **commitment** (hash of your note: secret, amount, etc.) into a Merkle tree. You withdraw by proving “I know a note in the tree with this root” and revealing a **nullifier** so the same note can’t be spent twice. The contract never sees your note; it only checks the proof and the nullifier.

**What’s still visible:** In Tier 1, **you** sign deposit and withdraw. So the chain sees: depositor address, amount (in calldata and in the token’s `Transfer`), and on withdraw, recipient and amount again. So we break the **deposit↔withdraw link** (which commitment funded which withdraw), but we do **not** yet hide who deposited, who withdrew, or how much.

**Good for:** Breaking the obvious “this deposit funded that withdraw” link; minimal trust; no relayer.

**Comparable level:** Classic **Tornado Cash**–style pools (commitment + nullifier; Tornado is legacy/dormant—sanctioned, front-end gone, no active dev). **Typhoon Cash**, **Aztec Connect** (early mixer-style usage), **Railgun**, **Umbra**, **Dandelion**, and many other commitment–nullifier or shielded-pool designs. Tier 1 is a crowded space: lots of projects offer note unlinkability; we're in that class.

---

## Tier 2: Withdrawer hidden (relayer withdraw)

**What’s hidden:** Who initiated the withdraw. The **relayer** signs the withdraw transaction, not the user.

**How it works:** You generate a withdraw proof (nullifier, root, recipient, amount) and submit a **relayer request** to our API. The relayer fetches calldata and submits `withdraw_relayed_u256` on your behalf. On-chain, the caller is the relayer; your identity is not the signer.

**What’s still visible:** Recipient and amount are still in calldata (the contract needs them to transfer), and the token still emits `Transfer(pool, recipient, amount)`. So “someone withdrew to address X, amount Y” is public; “which user” is not.

**Good for:** Hiding that **you** withdrew, while keeping the operation itself verifiable.

**Comparable level:** **Railgun** does this (and deposit relay too). **Tornado Cash** had relayer withdraw before it went dormant. **Mist.cash**, **Typhoon**, and other mixer/relayer stacks. Same idea: relayer signs so the end-user isn’t the on-chain withdrawer.

---

## Tier 3: Depositor hidden (relayer deposit)

**What’s hidden:** Who deposited. The **relayer** signs the deposit transaction.

**How it works:** You send funds to the relayer off-chain. The relayer submits `deposit_u256` with your commitment. On-chain, the depositor (the tx signer) is the relayer, not you.

**What’s still visible:** Amount is still in calldata and in the token’s `Transfer(relayer, pool, amount)`. So “relayer deposited X into pool” is visible; “which user’s money” is not.

**Good for:** Hiding that **you** deposited; useful together with Tier 2 so both sides of the flow can be relayer-signed.

**Comparable level:** **Railgun** does both—deposit and withdraw via relay—so Tier 2 + Tier 3 together. **Tornado Nova** had relayer deposit (Tornado is legacy/dormant). Other mixer/relayer designs where the relayer is the on-chain depositor.

---

## Tier-2H / Pool D: Recipient and amount hidden (hash-only + escrow)

**What’s hidden:** Recipient and amount **on the claim transaction**. The on-chain proof exposes only **hash(recipient, amount, salt)**. The contract verifies the proof and routes to **escrow/ledger**; it does not perform a direct “pool → recipient” token transfer in the clear.

**How it works:** You prove you have a valid note and the right to withdraw; the only public output is the claim hash. The contract emits that hash and credits an internal **escrow/ledger**. Payout is handled by the ledger (or off-chain); the chain never sees “send 100 USDC to 0x….” in calldata or in a public `Transfer` to the recipient.

**What’s still visible:** The existence of a claim (and its hash). If the final payout is done via a normal ERC‑20 transfer, that transfer is still visible; the privacy gain is that the **claim** itself doesn’t reveal recipient or amount.

**Good for:** Maximizing on-chain privacy for the withdrawal step; compliance-friendly hashed claims; preparing for internal accounting so that payout doesn’t leak via token events.

**Comparable level:** Few projects do exactly “hash-only public input + escrow/ledger” in the same way. **Aztec**’s private execution and note model (private state, no public recipient/amount); **Railgun**’s shielded pool + relay and compliance layer; **Secret Network**’s private balances and execution. We’re in the same **direction**: hide recipient and amount at the protocol layer and use internal accounting or shielded settlement where possible.

---

## Internal accounting (in development)

Today, even in Tier-2H, if payout is a plain ERC‑20 `transfer(recipient, amount)`, the token contract still leaks recipient and amount. **Internal accounting**—in development in this codebase—changes that:

- Balances and movements live in **our ledger** (off-chain or on-chain state we control).
- Settlements can be batched, delayed, or routed through a shielded primitive.
- So “who got how much” is not necessarily visible in a single public `Transfer` event.

That’s the next step: Tier-2H + internal accounting = recipient and amount hidden **through to settlement**, not just on the claim. The escrow and ledger contracts and APIs in this repo are the foundation for that.

---

## How to position the tiers

| Tier   | One-line positioning |
|--------|-----------------------|
| **1**  | “Note-unlinkable pool: no one can see which deposit funded which withdraw.” |
| **2**  | “Withdraw through a relayer: the chain sees a relayer, not you.” |
| **3**  | “Deposit through a relayer: the chain sees a relayer, not you.” |
| **2H** | “Claim with a hash only: recipient and amount stay off the public claim; payout via escrow/ledger.” |
| **+ internal accounting** | “Settlement via our ledger: no public token transfer to the recipient, so recipient and amount stay private end-to-end.” |

---

## How we compare (by tier)

| Tier   | Similar privacy level (ecosystem examples) |
|--------|--------------------------------------------|
| **1**  | Tornado Cash (legacy), Typhoon Cash, Railgun, Umbra, Aztec Connect, Dandelion, other commitment–nullifier / shielded pools |
| **2**  | Railgun (withdraw relay), Tornado + relayer (legacy), Mist.cash, Typhoon-style relay |
| **3**  | Railgun (deposit + withdraw relay), Tornado Nova (legacy), other relayer-based mixers |
| **2H** | Aztec (private execution/notes), Railgun (shielded + relay), Secret Network (private state); we share the goal of hiding recipient/amount at the protocol layer |
| **4**  | Railgun compliance layer, Tornado compliance (legacy), selective disclosure / “prove not in set” |

We're not claiming feature parity with any single project; we're mapping **privacy level** (what's hidden on-chain). **Tornado Cash** is legacy/dormant (sanctioned, no active development); **Railgun** is the live project that does both relayer deposit and relayer withdraw (and more) today.

---

## Where we fit in the broader space

**Globally:** A lot of projects offer Tier 1–3 (note unlinkability, relayer deposit/withdraw). Railgun, Typhoon, Aztec, Secret, etc. So on *raw privacy tier level* we're one of many. We don't "own" a tier.

**On Starknet it's different.** Live options for privacy on Starknet are a short list: **StarkCash** (mixer, confidential tx), **StarkSwirl** (token mixer), **Garaga** (verifier—we use it), and **us**. There is no dominant **privacy-first DeFi frontend** or **escalating tiers + proof-gated agent** on Starknet. Re{define} literally asked for "private DeFi, confidential transactions, privacy-first DeFi frontends"—that's what we built. So we're not "nothing special" on privacy *on Starknet*: we're one of the few doing note-unlinkable + relayer + proof-gated execution in one stack, and the only one with escalating tiers (1 → 2 → 3 → 2H) plus a path to internal accounting.

**What's different about zkde.fi:**

- **Starknet-native.** Garaga (Groth16, BN254) on Starknet. StarkCash and StarkSwirl are mixers; we're a **privacy-first DeFi frontend** with confidential transfers, proof-gated agent, and escalating tiers in one product.
- **Proof-gated execution, not just mix-and-cash-out.** Private *DeFi*: confidential transfers, proof-gated agent, yield, path to internal accounting. Not "deposit → wait → withdraw to fresh wallet" as the only use case.
- **Escalating tiers in one stack.** Same Merkle pool, relayer, escrow; step up Tier 1 → 2 → 3 → 2H. Internal accounting (in development) = path to hiding recipient/amount through settlement.

**Summary:** Tier 1–3 *privacy level* globally = many peers. **On Starknet** = few peers (StarkCash, StarkSwirl, us); we're the one with escalating tiers + proof-gated agent + path to Tier-2H/internal accounting. That's the correction: we're not special globally on the tier alone; we *are* special on Starknet for this full stack.



---

## Summary

- **Tier 1:** Break deposit↔withdraw link (note unlinkability). Amounts and identities still on-chain.
- **Tier 2:** Relayer signs withdraw → withdrawer hidden.
- **Tier 3:** Relayer signs deposit → depositor hidden.
- **Tier-2H (Pool D):** Claim exposes only a hash; escrow/ledger handle payout so recipient/amount aren’t in the public claim.
- **Internal accounting (in development):** Ledger-based settlement so payout doesn’t leak via ERC‑20; full path to hiding recipient and amount end-to-end.

All of this is implemented or in progress in the zkde.fi codebase: same stack (Garaga, Merkle tree, relayer, escrow), escalating privacy by tier so you can explain and position each level clearly.

---

*Obsqra Labs · zkde.fi · [PRIVACY_TIERS.md](PRIVACY_TIERS.md), [TX_PRIVACY_LOOKUP.md](TX_PRIVACY_LOOKUP.md)*
