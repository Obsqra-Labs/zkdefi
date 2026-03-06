---
layout: home
hero:
  name: zkde.fi
  text: Privacy-preserving AI capital allocation
  tagline: Privacy + Verification = zkDeFi. Every vault operation carries cryptographic guarantees - STARK proofs, on-chain receipts, and privacy-preserving execution
  actions:
    - theme: brand
      text: Start here
      link: /intro
    - theme: alt
      text: Open app
      link: https://zkde.fi
      target: _blank
---

## What Is zkde.fi?

zkde.fi is a **privacy-preserving AI Capital OS** for DeFi on Starknet. Your capital allocation decisions, risk assessments, and portfolio strategies remain **completely private** while being cryptographically verifiable. Every risk score, anomaly detection, and strategy recommendation is backed by a zero-knowledge proof that verifies correctness without revealing your sensitive data.

**New in 2026:** Real-time WebSocket updates, one-click execution from Oracle recommendations, and autonomous position monitoring — all while preserving your privacy.

## The Privacy Problem in DeFi

Traditional DeFi automation exposes everything: your wallet balance, strategy preferences, risk tolerance, and trading patterns are visible on-chain. Off-chain AI services require you to send private data to centralized servers. You must choose between **privacy** (keeping data secret) and **verification** (proving decisions are correct).

## Why Privacy-Preserving Proofs Matter

zkde.fi solves this with **zero-knowledge computation oracles**: AI decisions are proven without revealing inputs. 

- **Private Risk Scoring**: Your portfolio positions and risk tolerance stay hidden while proving the risk calculation is correct
- **Confidential Strategy Recommendations**: zkML models analyze your data locally, generate proofs of correct execution, without exposing your preferences
- **Anonymous Anomaly Detection**: Pool health checks and fraud detection run on encrypted state, producing verifiable alerts
- **Shielded Deposits & Withdrawals**: Capital moves through privacy pools with Poseidon commitments, unlinkable to your identity

Smart contracts verify proofs on-chain, allowing capital to flow based on **proven private decisions**. The result: AI-powered DeFi where you keep your data private and still prove everything is correct.

## Core Navigation Model

```mermaid
flowchart LR
  A[/agent?v=vault] --> B[/agent?v=oracle]
  B --> C[/agent?v=brain]
  A --> D[/profile?tab=trust]
  D --> E[/profile?tab=reputation]
  D --> F[/profile?tab=compliance]
```

Legacy compatibility: `/agent?v=trade` is still accepted and remapped to `v=oracle`.

## Where To Go Next

- [Introduction](/intro)
- [App overview and routes](/app-overview)
- [API overview](/api-overview)
- [Developers](/developers)
