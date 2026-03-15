---
layout: home
hero:
  name: zkde.fi
  text: Proof-Gated Execution on Starknet
  tagline: Capital only moves when cryptographic conditions are met. Every action produces a verifiable on-chain receipt.
  actions:
    - theme: brand
      text: The Primitive
      link: /intro
    - theme: alt
      text: Live Proof Readout
      link: /proof-readout
    - theme: alt
      text: Open App
      link: https://zkde.fi
      target: _blank
---

## What This Is

zkde.fi is a reference implementation of **proof-gated private finance** — built on top of the [Obsqra Labs](https://obsqra.xyz) proving infrastructure using a SNARK-in-STARK dual-lane architecture.

**Garaga** (Groth16) handles zkML verification in Cairo. **Stone** (STARK) handles execution integrity — the same prover infrastructure that secures Starknet blocks.

```
AI signal / strategy intent
  ↓ zkML inference → Groth16 commitment (EZKL)
  ↓ Garaga KZG pairing check in Cairo
  ↓ Stone STARK execution envelope
  ↓ Policy gate — no proof, no execution
  ↓ On-chain receipt → Madara L3 fact registry
```

## What's Deployed

| Fact | Count |
|---|---|
| Smart contracts across Starknet Sepolia, Ethereum Sepolia, and Madara L3 | **20+** |
| Circom circuits with WASM + zkey | **31** |
| EZKL (Halo2/KZG) ML models | **2** |
| On-chain trust receipts | **136+** |
| Verified proof lanes (Groth16, STARK, Noir HONK, Native KZG) | **5** |

Live proof generation and full claim validation: **[zkde.fi/test](https://zkde.fi/test)**

## Start Here

**If you're a judge or technical reviewer:**
Start with [Live Proof Readout](/proof-readout) — every claim in these docs is verifiable there. Then read [Proof Pipeline](/proof-pipeline).

**If you're an integrator:**
Start with [API Overview](/api-overview) and [Developers](/developers).

**If you're a user:**
Start with [Capital OS](/capital-os) and [Trade Desk](/trade-desk).

## Core Documentation

- [The Primitive](/intro) — what the proof system is and why it exists
- [Live Proof Readout](/proof-readout) — verifiable evidence at [zkde.fi/test](https://zkde.fi/test)
- [Deployed Contracts](/contracts) — on-chain contract map across three networks
- [Proof Pipeline](/proof-pipeline) — ProofMode, verifier lanes, settlement paths
- [Privacy Rails](/privacy-rails) — commitment → nullifier → claim hash flow
- [zkML + Circuit Stack](/zkml-circuits) — 13 agent skill circuits, EZKL, ModelBridge
- [API Overview](/api-overview) — programmatic surface of the proof pipeline
