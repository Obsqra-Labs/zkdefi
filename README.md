# zkde.fi

**Privacy-first DeFi agent on Starknet.**  
By [Obsqra Labs](https://obsqra.xyz).

**Live:** [zkde.fi](https://zkde.fi) · **Docs:** [docs.zkde.fi](https://docs.zkde.fi)

---

## What it is

zkde.fi is an open-source app for private, proof-gated DeFi on Starknet (Sepolia):

- **Full Privacy Pool** — Deposit and withdraw with note unlinkability; Merkle tree + Garaga SNARK proofs; root synced on-chain so withdrawals verify.
- **MVP yield flow** — Connect → risk profile (Conservative / Balanced / Aggressive) → recommendation → deploy (or sign on Dashboard). Enable **AI rebalancing** on the Dashboard so the agent monitors and rebalances when conditions change.
- **Agent & session keys** — Delegate execution with constraints (max position, protocols, expiry). Rebalancer: propose → zkML gate checks → execute. Autonomous mode runs the agent on an interval.
- **Hybrid proofs** — Garaga (SNARK) for zkML and confidential transfers; Integrity (STARK) for execution. Proof-gated: no proof, no execution.

## Architecture

```
User → Wallet → Frontend (:3001) → Backend (:8003) → Proofs (Garaga / obsqra.fi) → Starknet Sepolia
                                                      ├─ Full privacy: merkle + withdraw proof
                                                      ├─ zkML: risk + anomaly
                                                      └─ Rebalancer: propose → check → execute
```

| Component | Port | Role |
|-----------|------|------|
| Frontend | 3001 | Next.js: / (landing), /agent (dashboard, pools, rebalancer), /mvp (risk → recommend → deploy), /profile. |
| Backend | 8003 | FastAPI: full_privacy (deposit/withdraw), zkML, session keys, rebalancer, strategies (recommend), relayer, onboarding. |
| Contracts | Sepolia | ProofGatedYieldAgent, SelectiveDisclosure, ConfidentialTransfer, Garaga verifier, Merkle tree; see [docs/CONTRACTS.md](docs/CONTRACTS.md). |

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

If `app.main` is missing, the runnable app may be in `app.main.py.bak` or your deployment; see [docs/SETUP.md](docs/SETUP.md).

**Frontend**

```bash
cd frontend
npm install
# Set .env.local (NEXT_PUBLIC_API_URL=http://localhost:8003, NEXT_PUBLIC_RPC_URL, etc.)
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). Use **/agent** for dashboard and rebalancer, **/mvp** for risk → recommend → deploy.

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
