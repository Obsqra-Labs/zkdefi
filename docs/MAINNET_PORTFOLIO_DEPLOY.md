# Mainnet Portfolio Deploy

This is the narrow production lane for exposing `https://zkde.fi/portfolio` safely while mainnet execution stays fail-closed by default.

Progress tracking lives in `docs/MAINNET_V1_PROGRESS.md`.

## Scope

- Frontend route: `/portfolio`
- Backend gate endpoints: `/api/v1/execution_gate/*`
- Default runtime mode: preview-only on mainnet
- Live submission unlock requires both executor readiness and gate approval flags

## Required Env

Backend:

```bash
EXECUTOR_RPC_URL_MAINNET=
EXECUTOR_ACCOUNT_PATH_MAINNET=
EXECUTOR_PRIVATE_KEY_MAINNET=
EXECUTOR_LIVE_SUBMIT_MAINNET=false
EXECUTION_GATE_ALLOW_MAINNET_LIVE=false
```

To wire a recovered/imported signer into the backend without hand-editing secrets:

```bash
./scripts/configure_mainnet_executor.sh \
  --account-path /root/.starkli-wallets/mainnet/account.json \
  --private-key-file /root/.starkli-wallets/mainnet/private_key.txt \
  --expect-address 0x0348914Bed4FDC65399d347C4498D778B75d5835D9276027a4357FE78B4a7eb3
```

This writes the `_MAINNET` executor vars into `backend/.env`, restarts `zkdefi-backend`, and prints the resulting readiness payload. It keeps live submission disabled unless you explicitly opt in.

Frontend:

```bash
NEXT_PUBLIC_API_URL=https://zkde.fi
NEXT_PUBLIC_MM_SIM_API=https://zkde.fi/sim
```

## PM2 Rollout

Build and restart the frontend from the repo root:

```bash
./scripts/deploy_production.sh
```

That script now verifies both:

- `/agent`
- `/portfolio`

It checks that the live HTML points at the same hashed chunks that were just built locally, which catches stale PM2/Nginx/cache drift.

If you only need to restart backend workers:

```bash
./scripts/pm2_restart_zkdefi.sh
```

## Nginx Expectations

The checked-in production config is [zkde.fi.conf](/opt/obsqra.starknet/zkdefi/nginx/zkde.fi.conf).

Current routing model:

- `/` and `/portfolio` proxy to Next on `127.0.0.1:3001`
- `/_next/*` proxies to Next static/runtime assets
- `/api/*` proxies to FastAPI on `127.0.0.1:8003`
- `/sim/*` proxies to the simulator on `127.0.0.1:8099`

No special Nginx rewrite is required for `/portfolio`; if the route is missing live, the usual causes are:

1. Frontend was not rebuilt after the page was added.
2. PM2 is still serving an older `.next` build.
3. Nginx or edge cache is holding stale HTML/chunk references.

## Smoke Checks

Local VPS checks:

```bash
./scripts/smoke_portfolio_mainnet.sh
```

Against the live domain:

```bash
BASE_URL=https://zkde.fi API_BASE=https://zkde.fi ./scripts/smoke_portfolio_mainnet.sh
```

Manual checks:

```bash
curl -I https://zkde.fi/portfolio
curl https://zkde.fi/api/v1/execution_gate/readiness/starknet_mainnet
curl https://zkde.fi/api/v1/execution_gate/policy/0x0123456789abcdef
```

## Live Unlock Sequence

Keep the lane preview-only until all of these are true:

1. `starkli` is installed on the VPS
2. `EXECUTOR_ACCOUNT_PATH_MAINNET` is present
3. `EXECUTOR_PRIVATE_KEY_MAINNET` is present
4. The mainnet account contract is actually deployed
5. The account has dust ETH for gas
6. `EXECUTOR_LIVE_SUBMIT_MAINNET=true`
7. `EXECUTION_GATE_ALLOW_MAINNET_LIVE=true`
8. One very small mainnet swap succeeds and produces a stored receipt

Until then, `/portfolio` should show `Preview` / `Preview-only`, which is the intended mainnet-safe state.
