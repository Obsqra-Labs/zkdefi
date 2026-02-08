# What is zkde.fi?

**zkde.fi** (by Obsqra Labs) is the first **GATE-compatible** app: a privacy-preserving autonomous agent for DeFi on Starknet, built on **zkDE (Zero-Knowledge Deterministic Engine)** and **GATE (Governed Autonomous Trustless Execution)**. It combines:

- **zkML-gated decisions** — Two privacy-preserving ML models (risk score, anomaly detection) gate agent actions. Model outputs stay private; only compliance is public.
- **Proof-gated execution** — Every action requires both zkML proofs (Garaga) and execution proofs (Integrity). No proof, no execution.
- **Session keys** — Delegate to the agent via Starknet's native account abstraction. Agent acts within your constraints (max position, protocols, duration).
- **Intent commitments** — Replay-safe and fork-safe execution. Each commitment is single-use.
- **Selective disclosure** — Prove statements (e.g. "my agent followed the rules" or "yield above X") without revealing your full strategy or history.
- **Confidential positions** — Private transfers use commitments: amounts and balances stay off the public ledger. On Sepolia we use Garaga (Groth16 verifier); on mainnet the stack can use MIST.cash.

The app is **open source** and lives at [zkde.fi](https://zkde.fi). You connect your Starknet wallet (e.g. ArgentX, Braavos), set constraints (max position, allowed protocols), and grant session keys for autonomous execution.

## Hybrid Proof System

| Layer | Proof System | Purpose |
|-------|--------------|---------|
| Privacy | Garaga (Groth16/SNARK) | zkML proofs, confidential transfers |
| Execution | Integrity (STARK) | Constraint proofs, receipts |

## Key Features

- **zkML risk score** — Proves portfolio risk <= threshold without revealing actual score
- **zkML anomaly detection** — Proves pool is safe without revealing analysis
- **Session keys** — Delegated execution with constraints
- **Intent commitments** — Replay-safe execution
- **Constraint receipts** — On-chain audit trail
- **Compliance profiles** — Productized selective disclosure
- **Private deposits/withdrawals** — Amounts hidden

Next: [Why it matters](/why) | [zkML Models](/zkml-models) | [Session Keys](/session-keys)
