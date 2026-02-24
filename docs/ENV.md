# Environment variables

Central reference for backend and frontend env.

## Backend (backend/.env)

| Variable | Purpose |
|----------|---------|
| STARKNET_RPC_URL | Starknet RPC (e.g. Sepolia). |
| EKUBO_CHAIN_ID | Starknet Sepolia chain id for Ekubo API. Set for DEX routes and real_pool_aggregator. See EKUBO_SEPOLIA_INTEGRATION_SCOPE.md. |
| EKUBO_API_BASE | Optional; default https://prod-api.ekubo.org. |
| FULL_PRIVACY_* | Merkle tree, pool, admin. See SETUP.md. |
| OBSQRA_PROVER_* | Prover API. |

Ekubo addresses (Core, Router, Positions) are in backend/app/services/ekubo_config.py.

## Frontend (frontend/.env.local)

| Variable | Purpose |
| NEXT_PUBLIC_API_URL | Backend URL. |
| NEXT_PUBLIC_*_ADDRESS | Contract addresses. See SETUP.md. |

Frontend does not use EKUBO_CHAIN_ID; backend uses it for DEX/orchestration.

## See also

- SETUP.md
- EKUBO_SEPOLIA_INTEGRATION_SCOPE.md
