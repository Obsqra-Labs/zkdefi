# Start here.

**Go to [zkde.fi/test](https://zkde.fi/test) — every claim below is verifiable there in under 60 seconds.**

---

## What we built

Proof-gated execution for private DeFi on Starknet. SNARK-in-STARK dual-lane proving, zkML-gated agent composition, portable ZK reputation, tri-chain settlement.

## Three things to verify

1. **Live proof readout** → [zkde.fi/test](https://zkde.fi/test)  
   136+ receipts across 3 chains. Every hash is queryable via RPC. Click any receipt to trace its proof path.

2. **11 deployed contracts** → 7 Cairo on Starknet Sepolia, 4 Solidity on Ethereum Sepolia, plus a Madara L3 appchain  
   Contract addresses are listed in the [README](README.md#deployed-contracts) and visible in the live readout.

3. **zkML pipeline** → EZKL trains an MLP, exports a Halo2 circuit, Garaga verifies the SNARK on-chain  
   See [`scripts/train_all_ezkl_models.py`](scripts/train_all_ezkl_models.py), [`circuits/`](circuits/), and the [ModelBridge section](README.md#modelbridge-ezkl--zkml) in the README.

## Repo structure

| Directory | What's in it |
|-----------|-------------|
| `backend/` | FastAPI — reputation, zkML, privacy pools, vault, agent services |
| `frontend/` | Next.js 14 — landing page, live demo, proof readout |
| `contracts/` | Cairo contracts for Starknet + Solidity for Ethereum |
| `circuits/` | 31 Circom circuits + EZKL zkML circuits + Garaga verifiers |
| `scripts/` | Deployment, training, and test scripts |
| `docs/` | Architecture docs, deployment guides |
| `monitoring/` | Prometheus rules + Grafana dashboards |

## Key technical decisions

- **Why Python dominates the language stats:** The proving infrastructure (EZKL model training, circuit witness generation, Stone prover orchestration, backend API) is written in Python. The Cairo contracts are small by line count but high by impact — they're the on-chain verification layer. This is a proving fabric, not a frontend app.
- **Why three chains:** Madara L3 for fast/free receipt settlement → Starknet L2 for STARK verification → Ethereum L1 for finality. Receipts compose across all three.
- **Why dual-lane:** SNARK (Groth16/Halo2) proves the AI model ran correctly. STARK (Stone) proves the execution was complete. Both must pass.

---

*Full documentation: [README.md](README.md) · Live: [zkde.fi](https://zkde.fi) · By [Obsqra Labs](https://obsqra.xyz)*
