# Environment variables

Central reference for backend and frontend env.

## Backend (backend/.env)

| Variable | Purpose |
|----------|---------|
| STARKNET_RPC_URL | Starknet RPC (e.g. Sepolia). |
| EKUBO_CHAIN_ID | Starknet Sepolia chain id for Ekubo API. Set for DEX routes and real_pool_aggregator. See EKUBO_SEPOLIA_INTEGRATION_SCOPE.md. |
| EKUBO_API_BASE | Optional; default https://prod-api.ekubo.org. |
| EKUBO_BUILD_CALLDATA | If true (default), orchestration/vault execute builds Router.swap calldata per allocation and returns tx_calldata on each position for client to sign. |
| EXECUTOR_LIVE_SUBMIT | If true and EXECUTOR_* account/key set, backend submits swap via starkli and returns real tx_hash on positions. See contract_executor. |
| EKUBO_LP_ENABLED | Enables canonical LP endpoints under `/api/v1/zkdefi/ekubo/lp/*` (default `true`). |
| EKUBO_MARKET_SURFACE_ENABLED | Enables cross-DEX market surface endpoint `/api/v1/zkdefi/market/surface` (default `true`). |
| FAUCET_ETH_AMOUNT_WEI | Optional; default 1000000000000000 (0.001 ETH). Amount sent per POST /orchestration/faucet/eth. |
| FAUCET_ETH_COOLDOWN_SEC | Optional; default 86400 (24h). One claim per address per cooldown. |
| FULL_PRIVACY_* | Merkle tree, pool, admin. See SETUP.md. |
| OBSQRA_PROVER_* | Prover API. |

Ekubo addresses (Core, Router, Positions) are in backend/app/services/ekubo_config.py.

## Frontend (frontend/.env.local)

| Variable | Purpose |
| NEXT_PUBLIC_API_URL | Backend URL. |
| NEXT_PUBLIC_DYNAMIC_ENV_ID | Dynamic Labs environment id. Enables StarkGate-style dual-chain wallet modal (MetaMask + Starknet) in `WalletModal`. |
| NEXT_PUBLIC_EKUBO_HUB_V2 | Enables Operate Hub UX on `/agent` (set `true` to enable). |
| NEXT_PUBLIC_*_ADDRESS | Contract addresses. See SETUP.md. |

Frontend does not use EKUBO_CHAIN_ID; backend uses it for DEX/orchestration.

## See also

- SETUP.md
- EKUBO_SEPOLIA_INTEGRATION_SCOPE.md
