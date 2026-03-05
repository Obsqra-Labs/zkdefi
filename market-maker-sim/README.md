# Market Maker Simulator (Standalone)

This module provides a standalone market-maker simulation stack for Sepolia-focused zkDeFi development:

- Admin controls for peg, bots, and black-swan triggers
- Public transparency dashboard for simulated market activity
- FastAPI backend with WebSocket stream
- Cairo contract stubs for `zkdETH`, `zkDAI`, and controller patterns

## Why this exists

Your existing backend already integrates Ekubo data paths. This standalone repo adds controlled market activity simulation so the AI/agent stack has active market signals during development and demos.

## Quick start

```bash
cd market-maker-sim
chmod +x scripts/run_dev.sh
MM_SIM_ADMIN_KEY=change-me ./scripts/run_dev.sh
```

Then open:

- Admin dashboard: `http://localhost:8099/dashboard/admin`
- Public dashboard: `http://localhost:8099/dashboard/public`

By default, real-activity bots (`swap`, `lp`, `limit`) auto-start on service startup.
Disable per bot with:
- `SWAP_BOT_ENABLED_ON_START=false`
- `LP_BOT_ENABLED_ON_START=false`
- `LIMIT_BOT_ENABLED_ON_START=false`

## API summary

Public:
- `GET /public/state`
- `GET /public/events?limit=100`
- `WS /ws/public`

Admin (`x-admin-key` required):
- `POST /admin/peg`
- `POST /admin/bots/{bot_name}`
- `POST /admin/trade`
- `POST /admin/scenarios/trigger`
- `GET /admin/coordination/policy`
- `POST /admin/coordination/policy`
- `POST /admin/coordination/run`
- `GET /admin/state`

Coordination policy supports:
- stale LP cleanup + auto recenter
- pool coverage boosting to touch uncovered pools before ramping
- optional volume ramp actions via `SwapBot` against per-pair daily `volume_targets_usd`
- priority routing with `primary_volume_pairs` (e.g. `zkdAI/zkdETH`)

## Black swan scenarios

- `depeg_down` (peg loss)
- `depeg_up` (over-peg spike)
- `liquidity_drain`

All scenarios are simulated only and intended for alpha stress testing.

## Existing frontend integration

This repo is designed to be attached to the existing Next.js frontend through a dedicated page that points to this service (`NEXT_PUBLIC_MM_SIM_API`).
