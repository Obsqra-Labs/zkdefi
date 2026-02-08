---
layout: home
hero:
  name: zkde.fi
  text: Privacy-preserving DeFi on Starknet
  tagline: zkDE + GATE. Proof-gated execution. Selective disclosure. Confidential positions. By Obsqra Labs.
  actions:
    - theme: brand
      text: Get started
      link: /intro
    - theme: alt
      text: Open app
      link: https://zkde.fi
      target: _blank
---

## What is zkde.fi?

**zkde.fi** is the first **GATE-compatible** app: a privacy-preserving autonomous agent for DeFi on Starknet, built on **zkDE (Zero-Knowledge Deterministic Engine)** and **GATE (Governed Autonomous Trustless Execution)**. zkDE is the engine where execution is proof-gated and verification is deterministic; GATE is the standard for how agents operate in that engine. You set constraints; the agent allocates across protocols; every action is **proof-gated** (verified on-chain) and **privacy-preserving** (intent-hiding, confidential balances, selective disclosure).

### Core Features

- **zkML Models** — AI-driven decisions with hidden model outputs. Risk score and anomaly detection gate actions.
- **Proof-gating** — No proof, no execution. Both zkML (Garaga) and execution (Integrity) proofs required.
- **Session keys** — Delegate once; agent acts within your limits (max position, protocols, duration).
- **Intent commitments** — Replay-safe and fork-safe execution.
- **Selective disclosure** — Prove compliance without revealing your full history.
- **Confidential transfers** — Amounts and balances stay off the public ledger (Garaga on Sepolia).

### Architecture

| Layer | Proof System | Purpose |
|-------|--------------|---------|
| Privacy | Garaga (Groth16) | zkML proofs, confidential transfers |
| Execution | Integrity (STARK) | Constraint proofs, receipts |

[Read the docs](/intro) | [zkML Models](/zkml-models) | [Session Keys](/session-keys)
