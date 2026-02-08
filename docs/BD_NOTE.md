# zkde.fi — Note for Business Development

**By Obsqra Labs**

---

## In One Sentence

**zkde.fi** is a privacy-preserving autonomous DeFi agent on Starknet. The core question we answer: **How do you remain private but also have an identity?** Our answer is **provable reputation** — you prove you’re trustworthy without revealing your full history; that identity unlocks more privacy.

Live: [zkde.fi](https://zkde.fi) · Docs: [docs.zkde.fi](https://docs.zkde.fi)

---

## Privacy and Identity: Our Answer Is Provable Reputation

In DeFi you’re forced to choose: be **transparent** (everyone sees your positions and timing) or hand control to someone else and **trust them**. We want something else: **privacy-preserving execution that is verifiable** — you keep control, the system proves it followed your rules without revealing the details.

That raises a harder question: **How do you remain private but also have an identity?** If you’re fully anonymous, protocols can’t tell you from a bad actor. If you’re fully doxxed, you lose the privacy you came for.

**Our answer is provable reputation.** You don’t reveal your history; you **prove** properties about it. Tenure, successful transactions, collateral, compliance — all attestable on-chain or via proofs, without exposing amounts, strategy, or full history. So you stay **private** (no one sees your balances or trades) and you build **identity** (the system knows you’re trusted). That provable reputation is what unlocks more privacy-preserving features: relayer access, higher limits, lighter proof requirements. Privacy and identity coexist because reputation is **provable**, not revealed.

We manage this with **rewards and consequences**. New users start with tight limits and no relayer (no unlimited anonymous trading from day one). Trust is earned through tenure and good behavior — e.g. 30 days + 5 successful txns → Standard tier (relayer with delay/fee); tenure + collateral → Express (higher limits, relayer with lower fee). Flagged or abusive wallets can be **downgraded** (lose relayer, lose limits); **collateral can be slashed** for malicious behavior. So we prevent bad actors from mixing while **rewarding good actors with more privacy** — and that reward is gated on **provable** reputation, not on handing over your data.

---

## What We Actually Built

**Product** — zkde.fi is the first **GATE-compatible** app: a privacy-preserving autonomous agent for DeFi on Starknet (zkDE + GATE). Users set constraints; an AI-driven agent allocates and rebalances; every action is **proof-gated** (no proof, no execution) and **privacy-preserving** (intent-hiding, confidential balances, selective disclosure).

**Privacy modes** — (1) **Confidential transfer**: commitment-based deposit/withdraw (Garaga Groth16); amounts hidden, nullifier-based double-spend prevention. (2) **Full Privacy Pool**: Merkle-tree pool (FullyShieldedPool + MerkleTree on Sepolia); only commitments on-chain; withdraw via ZK proof (merkle membership + nullifier + amount). (3) **Private relayer**: tier-gated; lets trusted users withdraw to a fresh address so the on-chain link between source and destination is broken. (4) **Selective disclosure**: prove statements (e.g. balance above threshold, risk compliance, tenure) without revealing full history.

**Provable reputation (implemented)** — Tiers (Strict / Standard / Express), upgrade path (tenure + successful_txns for 0→1; tenure + collateral for 1→2), downgrade and slash for bad actors, daily/position limits and relayer gating by tier. You prove who you are (trusted, compliant) via behavior and collateral; you don’t reveal your data. Profile UI: tier, tenure, collateral, upgrade path, relayer (tier-gated).

---

## Technical Differentiation

- **Proof-gated execution** — Session key + proof required; no proof, no execution. Hybrid proofs: Garaga (Groth16) for privacy/zkML; Integrity (STARK) for execution.
- **Provable reputation** — Identity without disclosure: attest tenure, txns, collateral; unlock more privacy (relayer, limits) based on proofs, not on revealing history.
- **Starknet-native** — Account abstraction, Integrity fact registry, Sepolia (mainnet-ready); MerkleTree, FullyShieldedPool, ConfidentialTransfer deployed.

---

## Current Status

**Live** — Frontend (dashboard, profile, allocation pools, session keys, compliance panel, full privacy panel); backend (zkML, session keys, rebalancing, reputation, relayer, full-privacy proof service); Cairo contracts on Sepolia (proof verification, session key management, confidential transfer, risk engine, reputation registry design). **Open source** — Apache-2.0.

---

## Who It’s For

- **Institutions and sophisticated users** who want private allocation and optional full-privacy/relayer flows, with a clear way to show they’re trusted without exposing strategy or balances.
- **Compliance-sensitive users** who need to prove they followed rules without revealing full history — provable reputation is the bridge.
- **Builders and protocols** looking for a reference implementation of privacy + provable reputation on Starknet (zkDE + GATE).

---

## What We’ll Do at Matchain

zkde.fi is not a one-off app. It **flagships the class of apps** that become possible when execution is proof-gated and reputation is provable — the same class that the **MCP gateway** at Matchain will enable, without revealing the gateway’s secret sauce. The strategy is deliberate:

1. **Win hackathon validation** — Ship zkde.fi on the Privacy track; prove that proof-first execution and provable reputation make strong privacy possible without anonymity or disclosure. Validate the idea in public.
2. **Establish the asset class** — Position zkde.fi as the first full instance of **GATE** (Governed Autonomous Trustless Execution) under **zkDE** (Zero-Knowledge Deterministic Engine). This is the standard for privacy-preserving autonomous agents: proof-gated, reputation-emergent, surveillance-unnecessary.
3. **Give it a home at Matchain** — Shortly after hackathon validation, announce the **MCP gateway** as the home for GATE. The GATE standard that zkDE introduces to the industry is the same standard the MCP gateway will use. zkde.fi becomes the flagship app for the class of apps that gateway makes possible; builders get a reference implementation and a place to ship.

So: **win the hackathon → validate the idea → establish the asset class → give it a home at Matchain.** The app proves the model; the gateway scales it.

---

## One-Liner for BD

**zkde.fi answers how you remain private but also have an identity: provable reputation. You prove you’re trustworthy without revealing your history; that identity unlocks more privacy. Built by Obsqra Labs; first GATE-compatible app.**
