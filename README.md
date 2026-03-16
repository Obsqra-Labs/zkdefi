# zkde.fi — Provable Receipt OS for Starknet

> **Start at [zkde.fi/test](https://zkde.fi/test) — every claim below is verifiable there in under 60 seconds.** Judges: see [JUDGES.md](JUDGES.md) for a quick routing guide.

> Every computation — human or AI — produces a verifiable receipt.
> Receipts compose recursively. Reputation emerges from receipts.

**By [Obsqra Labs](https://obsqra.xyz)** · Live: [zkde.fi](https://zkde.fi) · Docs: [docs/](docs/README.md) · [Live Proof Readout](https://zkde.fi/test)

---

## What is this?

zkde.fi is a **recursive multi-chain proving fabric** on Starknet. It turns every on-chain and off-chain action into a provable receipt — then composes those receipts across L1 (Ethereum Sepolia), L2 (Starknet Sepolia), and L3 (Madara appchain).

This is not an AI agent. It's the **proving infrastructure** that any agent, model, or user can run on top of.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     zkde.fi Stack                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │ Noir HONK│   │Native KZG│   │Groth16/  │           │
│  │ (Path A) │   │ (Path B) │   │Garaga    │           │
│  └────┬─────┘   └────┬─────┘   │(Path C)  │           │
│       │               │         └────┬─────┘           │
│       └───────┬───────┴──────────────┘                 │
│               ▼                                         │
│  ┌─────────────────────────┐                           │
│  │   Receipt Aggregator    │  ← verifiable event log   │
│  │   (recursive compose)   │                           │
│  └────────────┬────────────┘                           │
│               │                                         │
│    ┌──────────┼──────────┐                             │
│    ▼          ▼          ▼                              │
│  ┌────┐   ┌─────┐   ┌─────┐                           │
│  │ L1 │   │ L2  │   │ L3  │                           │
│  │ETH │◄──│STRK │◄──│Madara│                          │
│  │Sep.│   │Sep. │   │App  │                            │
│  └────┘   └─────┘   └─────┘                           │
│                                                         │
│  ┌─────────────────────────┐                           │
│  │    ModelBridge (EZKL)   │  AI model → ZK proof      │
│  │  model registry on L3   │                           │
│  └─────────────────────────┘                           │
│                                                         │
│  ┌─────────────────────────┐                           │
│  │  Reputation / Identity  │  Poseidon-hashed           │
│  │  badge-gated lending    │  behavior proofs           │
│  │  DAO voting             │                           │
│  └─────────────────────────┘                           │
│                                                         │
│  ┌─────────────────────────┐                           │
│  │     Capital OS          │  DeFi surface              │
│  │  paper trade · scanner  │  (first receipt consumer)  │
│  │  privacy pools          │                           │
│  └─────────────────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

---

## Core Primitive: Receipts

Everything produces a **receipt** — a verifiable proof that a computation happened correctly.

| Receipt Type | Proof System | Settlement |
|---|---|---|
| Model inference (EZKL) | Groth16 → Garaga | L3 → L2 |
| Noir circuit execution | HONK | L2 |
| KZG polynomial commitment | Native Cairo KZG | L2 |
| Behavior / reputation | Poseidon hash | L3 |
| Cross-chain bridge | STARK + relay | L1 ↔ L2 ↔ L3 |

Receipts compose recursively — a reputation badge is a receipt-of-receipts.

---

## 4 Proving Lanes

### Path A — Noir HONK
Noir circuits → HONK proofs → L2 verification. General-purpose computation receipts.

### Path B — Native KZG
Cairo-native KZG polynomial commitment verification. EZKL model proofs verified directly without Groth16 wrapping. [Spec →](docs/plans/CAIRO_KZG_VERIFIER_SPEC.md)

### Path C — Groth16 / Garaga Bridge
EZKL → Groth16 → Garaga on-chain verifier. Primary ModelBridge lane for AI model verification. [Spec →](docs/plans/EZKL_TO_PROOF_BRIDGE_SPEC.md)

### STARK (Native)
Cairo's native proof system. Contract-level verification and L2 → L1 settlement.

---

## What's Deployed

| Component | Network | Link |
|---|---|---|
| ModelBridge verifier | Starknet Sepolia (L2) | [Contracts](contracts/) |
| L3 Garaga verifier | Madara appchain (L3) | [Architecture](docs/MADARA_L3_APPCHAIN_ARCHITECTURE.md) |
| L1 EZKL bridge verifier | Ethereum Sepolia (L1) | [Spec](docs/plans/L1_SEPOLIA_EZKL_VERIFIER.md) |
| Reputation proof API | Backend | [API](docs/REPUTATION_PROOF_API.md) |
| 7 Starknet contracts | Sepolia testnet | [Contracts](contracts/) |
| 4 EVM contracts | Ethereum Sepolia | [Bridge spec](docs/plans/L1_EZKL_BRIDGE_SPEC.md) |
| 31 circom circuits | WASM + zkey | [Circuits](circuits/) |
| Live proof readout | Web | [zkde.fi/test](https://zkde.fi/test) |

---

## Reputation System

Receipts accumulate into **portable reputation**:

1. **Behavior proofs** — Poseidon-hashed on-chain activity
2. **Badge screening** — threshold-gated credentials from receipt history
3. **Gated DeFi** — reputation unlocks lending tiers, DAO voting weight, privacy pool access

Specs: [Reputation v3](docs/CAPITAL_OS_PORTABLE_REPUTATION_V3_SPEC.md) · [Gated Lending + DAO](docs/REPUTATION_GATED_LENDING_DAO_VOTING.md)

---

## Repository Structure

```
zkdefi/
├── frontend/          Next.js app (zkde.fi)
├── backend/           Python FastAPI — proofs, reputation, model bridge
├── contracts/         Cairo smart contracts (L2 + L3)
├── circuits/          Noir circuits, EZKL models, KZG artifacts
├── scripts/           Build, deploy, showcase runners
├── artifacts/         Generated proof artifacts + showcase reports
├── docs/              Architecture, specs, plans
│   └── plans/         Implementation specs
├── credit-scoring/    Credit scoring model + EZKL compilation
├── monitoring/        Prometheus alerts, Grafana dashboards
├── tests/             Integration + unit tests
└── market-maker-sim/  LP simulation data
```

---

## Quick Start

```bash
# Backend
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set STARKNET_RPC_URL, etc.
uvicorn app.main:app --host 0.0.0.0 --port 8003

# Frontend
cd frontend && npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL, NEXT_PUBLIC_RPC_URL
npm run dev   # → http://localhost:3001
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, React, Tailwind CSS |
| Backend | FastAPI, Python 3.12 |
| Proofs | Garaga (SNARK), Stone/Integrity (STARK), EZKL (zkML), Noir (HONK) |
| Contracts | Cairo, Scarb |
| Chains | Starknet Sepolia · Ethereum Sepolia · Madara L3 appchain |

---

## How It Differs

Other projects verify that an AI agent made a correct decision.
zkde.fi verifies that **any computation happened correctly**, then lets those verifications compose.

- Not an agent framework — a **proving fabric**
- Not single-proof — **recursive multi-lane** (Noir, KZG, Groth16, STARK)
- Not L2-only — **L1 ↔ L2 ↔ L3** tri-chain settlement
- Not inference-only — **behavior, reputation, identity, capital**

The AI model verification (ModelBridge) is one lane. The system is the lanes.

---

## Key Documents

| Document | Covers |
|---|---|
| [Receipts as Primitive](docs/RECEIPTS_AS_PRIMITIVE_STRATEGY.md) | Core thesis — why receipts, not proofs |
| [Recursive Multichain Proving](docs/RECURSIVE_MULTICHAIN_PROVING_CORE.md) | How lanes compose across chains |
| [ZK OS Reframe](docs/ZK_OS_REFrame.md) | Product vision — zkRAG, zkGraph, zkSyslog |
| [L3 Architecture](docs/MADARA_L3_APPCHAIN_ARCHITECTURE.md) | Madara appchain design |
| [ModelBridge Integration](docs/L3_PROVING_PATHS_INTEGRATION.md) | EZKL → L3 → L2 pipeline |
| [Hackathon Build Narrative](docs/HACKATHON_BUILD_NARRATIVE.md) | Build story + milestones |

---

## License

Apache-2.0
