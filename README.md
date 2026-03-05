# zkde.fi

**AI-powered capital allocation with verifiable risk analysis on Starknet.**  
By [Obsqra Labs](https://obsqra.fi) — infrastructure for verifiable AI agents.

**Live:** [zkde.fi](https://zkde.fi) · **Docs:** [docs.zkde.fi](https://docs.zkde.fi)

---

## What it is

zkde.fi is an AI-driven capital allocator for DeFi where every risk assessment, pool analysis, and strategy signal is backed by a cryptographic proof. Built on Obsqra's verifiable AI infrastructure on Starknet (Sepolia).

- **Verifiable AI agents** — Autonomous agents whose decisions flow through provable skill modules (zkML circuits). The agent recommends; the circuits prove the math; the contracts verify before execution.
- **Computation oracles** — Risk scores, anomaly detection, and yield forecasts are proven, not just asserted. Smart contracts query the proof registry before authorizing capital movement.
- **Full privacy stack** — Multi-tier privacy from deposit-visible to fully shielded. Merkle tree + Garaga SNARK proofs. Relayer-mediated execution for gas payer unlinkability.
- **Agent identity and reputation** — Agents minted as SRC-721 NFTs with bound skills, verifiable proof history, and auditable LLM provider hashes. Proof-gated: no proof, no execution.

## Architecture

```
User → Wallet → Frontend (:3001) → Backend (:8003) → Proofs (Garaga / obsqra.fi) → Starknet Sepolia
                                                      ├─ Full privacy: merkle + withdraw proof
                                                      ├─ zkML: risk + anomaly
                                                      └─ Rebalancer: propose → check → execute
```

| Component | Port | Role |
|-----------|------|------|
| Frontend | 3001 | Next.js: / (landing), /agent (primary app), /mvp (experimental automation lane), /profile. |
| Backend | 8003 | FastAPI (`app.main`): unified API surface for /agent + /mvp + /profile. |
| Contracts | Sepolia | ProofGatedYieldAgent, SelectiveDisclosure, ConfidentialTransfer, Garaga verifier, Merkle tree; see [docs/CONTRACTS.md](docs/CONTRACTS.md). |

Route ownership:
- `/agent` is the canonical product surface.
- `/mvp` is the experimental UX for automation and strategy iteration.
- Both routes hit the same backend (`zkdefi/backend/app/main.py`), including shared strategy execution (`/api/v1/strategies/execute-advanced`).

## Quick Start

**Backend**

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
# Set .env (STARKNET_RPC_URL, FULL_PRIVACY_*, etc.; see docs)
uvicorn app.main:app --host 0.0.0.0 --port 8003
```

**Frontend**

```bash
cd frontend
npm install
# Set .env.local (NEXT_PUBLIC_API_URL=http://localhost:8003, NEXT_PUBLIC_RPC_URL, etc.)
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). Use **/agent** as the primary app and **/mvp** as the experimental automation lane.

## API (overview)

| Area | Examples |
|------|----------|
| **Full privacy** | `POST /api/v1/zkdefi/full_privacy/deposit/register_commitment`, `.../withdraw/generate_proof` |
| **Strategies** | `POST /api/v1/strategies/recommend` (risk + amount → allocation); deploy via vault/execute where mounted |
| **zkML** | `POST /api/v1/zkdefi/zkml/risk_score`, `.../anomaly`, `.../combined` |
| **Session keys** | `POST /api/v1/zkdefi/session_keys/grant`, `.../revoke`, `GET .../list/{address}` |
| **Rebalancer** | `POST /api/v1/zkdefi/rebalancer/propose`, `.../check`, `.../execute`; `.../autonomous/start`, `.../status/{address}` |

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, proof flow, components. |
| [docs/WORKING_STATE_DEPOSIT_WITHDRAW.md](docs/WORKING_STATE_DEPOSIT_WITHDRAW.md) | Why full-privacy deposit/withdraw works; root sync, critical files. |
| [docs/PRIVACY_TIERS.md](docs/PRIVACY_TIERS.md) | Tiers 1–4 (on-chain visibility); relayer flows. |
| [docs/PROOF_FLOWS.md](docs/PROOF_FLOWS.md) | Private transfer, shielded, Pool B/C, zkML flows. |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Sepolia contract addresses and main functions. |
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, deploy contracts, backend/frontend env. |
| [docs/AGENT_FLOW.md](docs/AGENT_FLOW.md) | Session keys, delegation, proof-gated execution UX. |
| [docs/DEV_LOG.md](docs/DEV_LOG.md) | Fixes and findings (merkle root, wallet, etc.). |

More planning and specs: `docs/`, root (e.g. BUILD_SUMMARY_FEB18.md, QUICK_START.md).

## Standards

- **zkDE** — Zero-Knowledge Deterministic Engine (proof-gated, delegated execution on Starknet).
- **GATE-1** — Governed Autonomous Trustless Execution; see [docs/AEGIS-1.md](docs/AEGIS-1.md).

## License

Apache-2.0
