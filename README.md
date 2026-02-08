# zkde.fi — Privacy-First Autonomous DeFi Agent

**Built by [Obsqra Labs](https://obsqra.xyz)**

zkde.fi is the first **GATE-compatible** app: a privacy-preserving autonomous agent for DeFi on Starknet, built on **zkDE (Zero-Knowledge Deterministic Engine)** and **GATE (Governed Autonomous Trustless Execution)**. The agent manages positions on your behalf using AI-driven allocation; you control it via constraints (max position, allowed protocols); every action is proof-gated and privacy-preserving.

**Live:** [zkde.fi](https://zkde.fi) | **Docs:** [docs.zkde.fi](https://docs.zkde.fi)

## Privacy Architecture

zkde.fi uses a **hybrid proof system** for maximum privacy:

| Layer | Proof System | Use Case |
|-------|--------------|----------|
| **Privacy** | Garaga (Groth16/SNARK) | zkML models, confidential transfers |
| **Execution** | Integrity (STARK) | Constraint proofs, slippage bounds |

### zkML Models

Two privacy-preserving ML models gate agent decisions:

1. **Risk Score Model** — Proves `risk_score <= threshold` without revealing actual score
2. **Anomaly Detector** — Proves `anomaly_flag == 0` without revealing analysis

Both use Groth16 proofs verified on-chain via Garaga.

## Key Features

- **Proof-gated execution** — Intent hidden until execution; no proof, no execution
- **zkML-gated rebalancing** — ML models gate decisions (risk + anomaly)
- **Session keys** — Native Starknet AA for delegated execution with constraints
- **Intent commitments** — Replay-safe and fork-safe execution
- **Constraint receipts** — On-chain audit trail without revealing strategy
- **Compliance profiles** — Productized selective disclosure
- **Confidential transfers** — Amount-hiding via Garaga (Sepolia demo)

## Architecture

```
User -> Session Key -> Agent -> zkML Proofs (Garaga) + Execution Proofs (Integrity) -> Combined Verification -> Execute
```

### Components

| Component | Port | Role |
|-----------|------|------|
| Frontend | 3001 | Next.js app with agent dashboard |
| Backend | 8003 | FastAPI: zkML, session keys, rebalancing |
| Contracts | Sepolia | Cairo contracts with proof verification |

### Contracts

- `proof_gated_yield_agent.cairo` — Main agent with combined proof verification
- `zkml_verifier.cairo` — Garaga-based zkML verifier
- `session_key_manager.cairo` — Session key management
- `intent_commitment.cairo` — Replay-safe commitments
- `constraint_receipt.cairo` — On-chain receipts
- `compliance_profile.cairo` — Selective disclosure profiles
- `confidential_transfer.cairo` — Amount-hiding transfers

## Quick Start

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8003

# Frontend
cd frontend
npm install
npm run dev
```

## API Endpoints

### zkML
- `POST /api/v1/zkdefi/zkml/risk_score` — Generate risk score proof
- `POST /api/v1/zkdefi/zkml/anomaly` — Generate anomaly detection proof
- `POST /api/v1/zkdefi/zkml/combined` — Generate both proofs

### Session Keys
- `POST /api/v1/zkdefi/session_keys/grant` — Grant session key
- `POST /api/v1/zkdefi/session_keys/revoke` — Revoke session key
- `GET /api/v1/zkdefi/session_keys/list/{address}` — List sessions

### Rebalancer
- `POST /api/v1/zkdefi/rebalancer/propose` — Propose rebalancing
- `POST /api/v1/zkdefi/rebalancer/check` — Run zkML gate checks
- `POST /api/v1/zkdefi/rebalancer/execute` — Execute rebalancing

## Standards

- **zkDE** — Zero-Knowledge Deterministic Engine: the infrastructure for proof-gated, delegated execution on Starknet. Strong Starknet fit (AA, session keys, Integrity).
- **GATE-1** — Governed Autonomous Trustless Execution: the agent standard for zkDE ([docs/AEGIS-1.md](docs/AEGIS-1.md) - file contains GATE-1 spec)

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture
- [PROOF_SYSTEM_ARCHITECTURE.md](docs/PROOF_SYSTEM_ARCHITECTURE.md) — Hybrid proof system
- [FOR_JUDGES.md](docs/FOR_JUDGES.md) — Privacy track submission
- [ADVERSARIAL_DEMOS.md](docs/ADVERSARIAL_DEMOS.md) — Attack prevention demos
- [GATE-1 Standard](docs/AEGIS-1.md) — Governed Autonomous Trustless Execution
- [dev_log/](dev_log/) — Chronological progress log

## Privacy Track Fit

- Privacy-preserving applications using STARKs and zero-knowledge proofs
- Proof-gated execution (verifiable constraints)
- zkML-gated decisions (hidden model outputs)
- Confidential transfers (Garaga on Sepolia)
- Selective disclosure (compliance profiles)

## License

Apache-2.0
