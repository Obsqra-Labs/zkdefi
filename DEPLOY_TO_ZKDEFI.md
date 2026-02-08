# Deploy zkde.fi on this VPS

Hostinger is the **VPS provider**; **this machine** is the server that hosts zkde.fi (and typically the backend). There is no separate "Hostinger panel" deploy — you build and run on this VPS.

## Prerequisites

- zkde.fi domain pointing to this VPS
- Node.js on this machine
- Backend API running (on this VPS or elsewhere; frontend calls `NEXT_PUBLIC_API_URL`)

## Deploy frontend on this machine

1. **Set env before build** (NEXT_PUBLIC_* are baked in at build time). Or run `./deploy_production.sh` from repo root — it sets API URL, Full Privacy pool, and felt deposit fix.
   ```bash
   cd /opt/obsqra.starknet/zkdefi/frontend
   export NEXT_PUBLIC_API_URL=https://zkde.fi   # production
   export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true   # so Confirm Deposit works (avoids ENTRYPOINT_NOT_FOUND)
   export NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x0700376443e295f33dda9ac2721a95d601f6b7c38719d58077049de357d3b85f
   export NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS=<address>
   export NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS=<address>
   export NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=<address>
   export NEXT_PUBLIC_STARKNET_CHAIN_ID=0x534e5f5345504f4c4941
   ```

2. **Build and run**:
   ```bash
   npm ci && npm run build
   npm start   # or pm2 / systemd for production
   ```

3. **Reverse proxy**: Put nginx (or similar) in front so https://zkde.fi serves the Next.js app (e.g. proxy to localhost:3000).

## Archive script (optional)

To create a tarball of the frontend (e.g. to copy to another host or backup):

```bash
cd /opt/obsqra.starknet/zkdefi
./deploy_zkdefi_to_hostinger.sh
```

This builds docs into `frontend/public/docs` and creates `zkdefi-frontend-<timestamp>.tar.gz` in the repo root. Build and run on the target machine with env set.

## Backend

- If the backend runs on **this same VPS**, use a subdomain or path (e.g. `https://starknet.obsqra.fi` or `https://api.zkde.fi`) and set `NEXT_PUBLIC_API_URL` to that base.
- Backend health: `GET <API_BASE>/health` should return `{"status":"ok",...}`.
- **Private Withdraw**: Restart backend after any change to `backend/app/services/groth16_prover.py` so deposit returns raw BN254 commitment (withdraw proof needs it).
- **Garaga verifier**: To redeploy the deposit verifier from current circuits: `cd contracts && ./deploy_garaga_verifier.sh` (uses same `STARKNET_RPC_URL` default as e2e). Set `GARAGA_VERIFIER_ADDRESS` in backend `.env` and for e2e. To run only the Garaga on-chain test (test 15) deterministically: `GARAGA_VERIFIER_ADDRESS=<addr> BACKEND_URL=http://localhost:8003 ./run_tests.sh --garaga-onchain-only`.

## Post-deployment checklist

- [ ] Frontend live at https://zkde.fi
- [ ] Landing page and /agent load
- [ ] Connect wallet works (Sepolia)
- [ ] Backend reachable; market data and position load (CSP in next.config.js allows API origin)
- [ ] SSL active (e.g. Let's Encrypt via nginx/certbot)
