# For Judges (Privacy Track)

**Scope:** Work presented from 48 hours before hackathon start (Jan 30, 2026) through submission.

## Problem

DeFi today forces a choice: full transparency (everyone sees size, timing, counterparty) or opaque custody. We need privacy-preserving execution that's verifiable — proof that the system followed the rules, without revealing the execution details.

## Background

**Our research.** Obsqra Labs started by asking: can we prove an AI made the right decision, on-chain? We built that on EVM (zkd.app), then moved to Starknet in December to build a production system. Here we're shipping zkde.fi — the privacy layer of our verifiable AI infrastructure, proving it works.

Fair play: we reuse our existing proof infrastructure from starknet.obsqra.fi — a local Stone prover that writes proofs to Starknet's Integrity (SHARP fact registry). Contracts check Integrity before execution. We're transparent about that reuse. We're open-sourcing zkde.fi to validate the approach and show what's possible on Starknet.

## Solution

**zkde.fi** is a privacy-preserving **autonomous agent** for DeFi on Starknet. The agent manages positions on your behalf using AI-driven allocation (deterministic risk engine); you control it via constraints (max position, allowed protocols); every action is proof-gated and privacy-preserving.

**Built on zkDE (Zero-Knowledge Deterministic Engine) and GATE (Governed Autonomous Trustless Execution).** zkDE is the engine where execution is proof-gated and verification is deterministic; GATE is the standard for how agents operate in that engine. You delegate to the agent via **session keys** (grant permission once); agent executes within your constraints; **proof-gating** ensures every action is verified on-chain before execution. No proof, no execution.

**zkde.fi** delivers this through three pillars:

1. **Proof-gated execution** — Trade intent stays hidden until execution. A proof verifies constraints on-chain; no proof, no execution. You get MEV protection and verifiable intent.
2. **Confidential transactions** — Amounts and balances stay off-chain. We use Garaga (Groth16) on Sepolia for the demo; mainnet uses MIST.cash.
3. **Selective disclosure** — Prove compliance (e.g. "yield above X" or "auditor-eligible") without revealing full history. Prove a statement, hide the details.

## Track Fit

- **Privacy-preserving applications** using STARKs and zero-knowledge proofs on Starknet.
- Proof-gated execution (verifiable constraints), selective disclosure (prove statements), and confidential transfers (Garaga on Sepolia).

## Novelty

- **Privacy-preserving autonomous agent** — Combines AI-driven allocation with privacy primitives (proof-gating, confidential transactions, selective disclosure). Agent acts on your behalf; intents stay hidden; actions are verifiable.
- **Proof-gated session keys (Starknet AA)** — Uses native account abstraction (session keys) + proof verification. Agent needs **both** valid session **and** valid proof to execute. Novel combination of Starknet's AA with cryptographic verification.
- **Hybrid proof system** — STARKs (Integrity) for execution proofs + Groth16 (Garaga) for privacy proofs. Each proof type optimized for its purpose.
- **zkML models gate execution** — Two privacy-preserving ML models (risk score + anomaly detection) gate agent decisions. Actual model outputs hidden; only compliance visible on-chain.
- **Intent commitments** — Replay-safe and fork-safe execution with cryptographic binding.
- **Constraint receipts** — On-chain audit trail without revealing strategy.
- **E2E hero flow** — delegate via session key -> zkML proofs -> execution proofs -> combined verification -> execute. All wired and working.

## Proof System Architecture

We use a **hybrid proof system**:

| Layer | System | Use Case |
|-------|--------|----------|
| Privacy | Garaga (Groth16/SNARK) | zkML models, confidential transfers |
| Execution | Integrity (STARK) | Constraint proofs, slippage bounds |

**Why hybrid?**
- SNARK proofs hide model outputs (actual risk scores private)
- STARK proofs verify execution (constraints checked on-chain)
- Both are zero-knowledge; both enable privacy
- Consistent story: "Groth16 for privacy, STARK for execution"

See [PROOF_SYSTEM_ARCHITECTURE.md](PROOF_SYSTEM_ARCHITECTURE.md) for details.

## zkML Models

### Risk Score Model (Garaga/Groth16)
- **What it does:** Calculates portfolio risk score
- **Privacy:** Proves `risk_score <= threshold` without revealing actual score
- **Inputs (private):** Portfolio features, risk parameters
- **Circuit:** `circuits/RiskScore.circom`

### Anomaly Detector (Garaga/Groth16)
- **What it does:** Detects unsafe pools/protocols
- **Privacy:** Proves `anomaly_flag == 0` without revealing analysis
- **Inputs (private):** Pool state, liquidity data, deployer history
- **Circuit:** `circuits/AnomalyDetector.circom`

## Protocols (Ekubo, JediSwap)

We integrate **Ekubo** and **JediSwap** at production depth: proof-gated execution, deposits, positions. This is the same integration depth we ship in our main app. Yield is out of scope for this hackathon; everything else is in.

## Garaga vs MIST.cash

On Starknet Sepolia, zkde.fi uses **Garaga** (Groth16 verifier on-chain) for confidential transfers so the demo runs without external dependencies. On mainnet, we use **MIST.cash** — they've solved the UX and infrastructure pieces. This repo documents the Garaga path for reproducibility.
