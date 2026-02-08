# zkde.fi environment variables

Copy these into `backend/.env` and `frontend/.env.local` (create files if missing). Do not commit `.env` or `.env.local`.

## Backend (`zkdefi/backend/.env`)

```bash
# RPC and prover (Blast deprecated; Alchemy default per run_tests.sh/e2e)
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7
# Stone prover: GET {base}/ = liveness (200), POST {base}/proofs/generate = proof generation. See docs/STONE_PROVER_API.md.
OBSQRA_PROVER_API_URL=https://starknet.obsqra.fi/api/v1
OBSQRA_API_KEY=

# Deployed contract addresses (Starknet Sepolia)
PROOF_GATED_AGENT_ADDRESS=
SELECTIVE_DISCLOSURE_ADDRESS=
CONFIDENTIAL_TRANSFER_ADDRESS=
GARAGA_VERIFIER_ADDRESS=

# ObsqraFactRegistry: on-chain persistence for STARK facts (dual-proof). Point ProofGatedYieldAgent
# and TieredAgentController fact_registry at this address. Default (Sepolia): 0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8. See docs/DUAL_PROOF_ARCHITECTURE.md.
OBSQRA_FACT_REGISTRY_ADDRESS=0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8

# Full Privacy Pool contracts
MERKLE_TREE_ADDRESS=
FULLY_SHIELDED_POOL_ADDRESS=
# Merkle root sync (avoids "Unknown merkle root" on withdraw). Set FULL_PRIVACY_MERKLE_TREE_ADDRESS (and optionally admin key) so the backend can call add_known_root after register_commitment. For production, prefer manual root registration (do not set admin key on app server). See docs/FULL_PRIVACY_MERKLE_ROOT_SYNC.md.
FULL_PRIVACY_MERKLE_TREE_ADDRESS=
FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY=
FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS=

# Server
PORT=8003

# Development mode (NEVER set in production)
# When true, services may return simulated/mock proofs if circuits are unavailable.
# When false or unset (production), all proof endpoints require real proof generation
# and will return 503 if circuits/prover are not available.
ALLOW_SIMULATED_PROOFS=false
```

## Frontend (`zkdefi/frontend/.env.local`)

```bash
# Backend API
NEXT_PUBLIC_API_URL=http://localhost:8003

# Starknet RPC for wallet/chain (default: Alchemy Sepolia). If wallet won't load, set this to a working Sepolia RPC.
# NEXT_PUBLIC_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY

# Deployed contract addresses (Starknet Sepolia)
NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS=
NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS=
NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=

# Full Privacy Pool contracts
NEXT_PUBLIC_MERKLE_TREE_ADDRESS=
NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=
# Token for Full Privacy Pool must implement ERC20 (approve + transfer_from). Default: Sepolia ETH. If you see ENTRYPOINT_NOT_FOUND on approve, the token at that address does not have approve — use this or another ERC20 token.
# NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
# Use deposit(commitment: felt252)/withdraw(amount: felt252) when the deployed pool only exposes felt entrypoints (avoids ENTRYPOINT_NOT_FOUND).
# NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true
# NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW=true
```

**Production (zkde.fi):** Set `NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true` so Confirm Deposit uses the `deposit` entrypoint. Set `NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW=true` so Withdraw uses the `withdraw` entrypoint (avoids ENTRYPOINT_NOT_FOUND on pools that only expose felt252 entrypoints). Set `NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS` to the pool’s token (e.g. STRK) if different from Sepolia ETH.

## Deployment script env (for `scripts/deploy_sepolia.sh`)

Set before running the deploy script (or in `.env` at repo root):

- `OBSQRA_FACT_REGISTRY_ADDRESS` — ObsqraFactRegistry on Sepolia (STARK facts; use as **fact_registry** in ProofGatedYieldAgent / TieredAgentController constructor). Default: `0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8`.
- `ERC20_TOKEN_ADDRESS` — ERC20 token contract address on Sepolia.
- `ADMIN_ADDRESS` — Admin address for contracts (optional; deployer used if unset).
- `GARAGA_VERIFIER_ADDRESS` — Garaga Groth16 verifier address (required to deploy ConfidentialTransfer; deploy from `circuits/` first).

See [SETUP.md](SETUP.md) for deployment order and constructor calldata.
