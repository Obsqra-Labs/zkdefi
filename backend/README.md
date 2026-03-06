# Backend (zkde.fi API)

FastAPI application serving the full zkde.fi product surface: vault/DEX/strategies, reputation & FICO proofs, zkML, full-privacy, rebalancer, session keys, governance. Single entrypoint: `app.main:app` (port 8003).

---

## Run

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# Set .env (STARKNET_RPC_URL, FULL_PRIVACY_*, etc.)
uvicorn app.main:app --host 0.0.0.0 --port 8003
```

OpenAPI: [http://localhost:8003/docs](http://localhost:8003/docs) · Metrics: [http://localhost:8003/metrics](http://localhost:8003/metrics)

---

## API surface (index)

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/v1/zkdefi` | `app.api.zkdefi_agent` | Agent actions, skills, rebalancer hooks |
| `/api/v1/zkdefi/zkml` | `app.api.zkml` | zkML risk score, anomaly, combined |
| `/api/v1/zkdefi/session_keys` | `app.api.session_keys` | Grant/revoke/list session keys |
| `/api/v1/zkdefi/rebalancer` | `app.api.rebalancer` | Propose, check, execute; autonomous start/status |
| `/api/v1/zkdefi/reputation` | `app.api.reputation` | Tier info, proofs status, **generate proofs** (FICO pack) |
| `/api/v1/zkdefi/risk_passport` | `app.api.risk_passport` | Risk passport and L3 verify |
| `/api/v1/zkdefi` (relayer) | `app.api.relayer` | Relayer endpoints |
| `/api/v1/zkdefi/linked_addresses` | `app.api.linked_addresses` | Link/unlink addresses |
| `/api/v1/zkdefi/full_privacy` | `app.api.routes.full_privacy` | Deposit/withdraw, commitments, proofs |
| `/api/v1/zkdefi/dex` | `app.api.routes.dex` | DEX/swap routes |
| `/api/v1/zkdefi/onboarding` | `app.api.routes.onboarding` | Onboarding flow |
| `/api/v1/zkdefi/proofs` | `app.api.routes.proofs` | Proof submission/status |
| `/api/v1/strategies`, vault_execute | strategies, vault_execute | Recommend, deploy, vault execution (swaps, lending, LP, staking) |
| DAO / governance | (see risk_passport or dedicated routes) | Proposals, voting |

---

## Directory layout

```text
app/
├── main.py              # FastAPI app, router mounting
├── api/                 # Route handlers (reputation, zkml, rebalancer, …)
├── api/routes/          # full_privacy, dex, onboarding, proofs, vault_execute
├── services/            # Business logic and proof orchestration
│   ├── zkml/            # Circuit scanner, input builders, Garaga run
│   ├── proof_pipeline.py
│   ├── session_key_service.py
│   ├── agent_rebalancer.py
│   └── ...
├── db/                  # Decision store, schema
├── monitoring/          # Prometheus metrics (optional)
└── models/              # Pydantic / domain models
data/                    # JsonStore persistence (reputation_proofs, etc.)
```

---

## Key services (technical notes)

| Service | Role |
|---------|------|
| **Circuit scanner** (`zkml/circuit_scanner.py`) | Builds inputs per circuit, runs Garaga, returns proof + public signals. Used by reputation proof endpoints. |
| **Reputation API** (`api/reputation.py`) | GET `/proofs/{address}`; POST `/proof/solvency`, `/proof/risk-passport`, etc. Persists completion to `reputation_proofs` store. |
| **Proof pipeline** | Coordinates multi-step proofs and submission to obsqra/Starknet. |
| **Session key service** | Delegation constraints and revocation. |
| **Rebalancer** | Propose → zkML gate check → execute; autonomous loop. |

---

## Env (summary)

- `STARKNET_RPC_URL` — Starknet JSON-RPC (Sepolia).
- `FULL_PRIVACY_*` — Merkle tree and full-privacy pool config.
- `.env.verifiers` — Reputation verifier contract addresses (see [scripts/](../scripts/README.md)).

See repo root `.env.example` or docs for full list.
