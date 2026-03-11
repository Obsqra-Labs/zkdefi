# Deployment

**Last updated:** 2026-03-10

## Prerequisites

Python 3.12, Node. Optional: nargo, EZKL CLI, Garaga/Stone for full proof chain.

## Local - Backend

cd backend; python -m venv venv; source venv/bin/activate; pip install -r requirements.txt; cp .env.example .env; set STARKNET_RPC_URL; uvicorn app.main:app --host 0.0.0.0 --port 8003.

OpenAPI: http://localhost:8003/docs. Metrics: http://localhost:8003/metrics if enabled.

Env: STARKNET_RPC_URL required; FULL_PRIVACY_*, EXECUTOR_*, RELAYER_*, contract addresses, .env.verifiers. See backend/.env.example.

## Local - Frontend

cd frontend; npm install; .env.local with NEXT_PUBLIC_API_URL and NEXT_PUBLIC_RPC_URL; npm run dev. App: http://localhost:3001. Use NEXT_PUBLIC_API_URL=/api only when proxying.

## Optional local

Merkle tree; verifier addresses; L1 signer see plans/L1_SEPOLIA_EZKL_VERIFIER.md.

## Production-like

Build frontend; run backend; nginx serve / and proxy /api; NEXT_PUBLIC_API_URL=/api; CSP; PM2 and scripts/fix-static-404.sh. See DEPLOYMENT_ROUTING_FIX_COMPLETE.md, API_ROUTING_FIX_FINAL.md.

## Verifier deploy

Garaga/L3: parent deploy_verifiers_l3.py, plans/MODELBRIDGE_VERIFIER_DEPLOY.md. L1 Sepolia: scripts/l1_sepolia_ezkl_verifier_one_shot.py, plans/L1_SEPOLIA_EZKL_VERIFIER.md. L2 receiver: contracts/src/l1_ezkl_bridge_receiver.cairo, L1_BRIDGE_RECEIVER_ADDRESS.

## Runbooks

- **(a) Static 404** for `/_next/static/*`: Rebuild frontend, restart Node, nginx reload, CDN purge, hard refresh. See [DEPLOY_STATIC_404.md](DEPLOY_STATIC_404.md), [scripts/fix-static-404.sh](../scripts/fix-static-404.sh).
- **(b) Proofs fail:** Check `STARKNET_RPC_URL`, verifier addresses, circuit artifacts (zkey, wasm under `circuits/build/`), Garaga/Stone. For dev: `ZKDEFI_REQUIRE_REAL_PROOFS=false`.
- **(c) L1 submit fails:** Signer not configured. Set `L1_SEPOLIA_PRIVATE_KEY` or `L1_SEPOLIA_KEYSTORE_PASSWORD` (and optional path). Confirm `signer_ready` in parent backend.
