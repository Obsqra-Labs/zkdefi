---
layout: home
hero:
  name: zkde.fi
  text: AI capital allocation with verifiable risk analysis
  tagline: By Obsqra Labs — infrastructure for verifiable AI agents. Every decision is provably computed.
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

zkde.fi is an AI-driven capital allocator for DeFi on Starknet. Every risk assessment, anomaly detection, and strategy signal is backed by a cryptographic proof of the computation that produced it. Built on Obsqra's verifiable AI infrastructure.

## The Problem It Solves

Traditional DeFi automation relies on opaque off-chain bots. Users deposit capital and trust that some server is running the right algorithm on the right data. There is no way to verify that the risk check actually ran, or that the strategy recommendation was computed from real inputs.

## Why It Matters

zkde.fi introduces **computation oracles** — where AI decisions are proven, not just asserted. Risk scores come with mathematical proofs. Anomaly detection produces verifiable evidence. Smart contracts check these proofs before allowing capital to move. The result: AI-powered DeFi where you verify the AI instead of trusting it.

## Core Navigation Model

```mermaid
flowchart LR
  A[/agent?v=vault] --> B[/agent?v=trade]
  B --> C[/agent?v=brain]
  A --> D[/profile?tab=trust]
  D --> E[/profile?tab=reputation]
  D --> F[/profile?tab=compliance]
```

## Where To Go Next

- [Introduction](/intro)
- [App overview and routes](/app-overview)
- [API overview](/api-overview)
- [Developers](/developers)
