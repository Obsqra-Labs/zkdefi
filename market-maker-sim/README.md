# Sepolia Ekubo market tool (market-maker-sim)

Public-facing **Starknet Sepolia** tooling for developers: **read Ekubo pool state** over HTTP/WebSocket, optional **on-chain activity** (swap / LP / limit bots and multi-agent fleet), and HTML dashboards.

This directory is maintained as a **standalone-friendly** module inside the [zkdefi](https://github.com/Obsqra-Labs/zkdefi) repo and is the starting point for **broader Sepolia developer support** (configurable contracts, more protocols, cleaner read-only defaults).

## What you get

| Mode | Requirements | Behavior |
|------|----------------|----------|
| **Read-only** | RPC URL only (`STARKNET_RPC_URL`) | Pool snapshots, APY views, events, `/public/contracts`, WebSocket state — **no** txs |
| **Bots / fleet** | Funded Sepolia account + `BOT_*` keys | Real swaps, LP, limits, coordination loops (`FLEET_ENABLED=true`) |

Default **Docker** setup uses **read-only** (`FLEET_ENABLED=false`) so you can run without wallet secrets.

## Quick start (Docker)

```bash
cd market-maker-sim
docker compose up --build
```

- API: `http://localhost:8099`
- OpenAPI: `http://localhost:8099/docs`
- Health: `http://localhost:8099/health`

Optional: create `.env` in this directory (Compose loads it for variable substitution). Copy from `.env.example` and set any overrides, e.g.:

```bash
cp .env.example .env
# edit STARKNET_RPC_URL, MM_SIM_CORS, etc.
```

### Enable on-chain bots (Sepolia testnet only)

1. Fund a **Sepolia** account with STRK for fees.
2. In `.env`: set `BOT_ACCOUNT_ADDRESS`, `BOT_PRIVATE_KEY`, and `FLEET_ENABLED=true` (and other bot knobs as needed).
3. `docker compose up --build`

**Never commit private keys.** Use `.env` locally and CI secrets in automation.

## Quick start (local Python)

```bash
cd market-maker-sim
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH="$(pwd)"
cp .env.example .env   # optional
uvicorn api.main:app --host 0.0.0.0 --port 8099
```

Or: `./scripts/run_dev.sh` (creates venv, installs deps, runs uvicorn with reload).

### Editable install + `sepolia-mm` CLI (optional)

```bash
pip install -e ".[dev]"
export SEPOLIA_MM_URL=http://127.0.0.1:8099   # optional
sepolia-mm health
sepolia-mm get public/pools --pretty
sepolia-mm urls
sepolia-mm watch              # live Δ tvl / pool prices (color if tty)
sepolia-mm watch --jsonl | jq .state.block_number
sepolia-mm watch --raw        # full payload each tick
```

Without install: `PYTHONPATH=. python3 -m sepolia_mm health`

**What’s the difference vs NPM?** The **CLI** hits your running API (curl-style, good for ops and demos). The **JS client** is a few `fetch` helpers for **Next.js / Node** apps. **CI** only proves tests pass and the **Docker image builds**—it’s not a product surface, it keeps main green.

## JavaScript client

Tiny ESM package under [`clients/js`](./clients/js) (`@obsqra/sepolia-mm-client`): `createClient({ baseUrl })` with `.publicState()`, `.publicPools()`, etc. Use `file:./clients/js` from a monorepo app or publish to npm when ready.

## CI

On push/PR to `main` when `market-maker-sim/**` changes, GitHub Actions runs **pytest**, **Docker build**, and **`node --check`** on the JS client. Workflow: [`.github/workflows/market-maker-sim.yml`](../.github/workflows/market-maker-sim.yml).

## Public HTTP API (selected)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/public/state` | Aggregated on-chain snapshot + bot metadata |
| GET | `/public/pools` | Per-pool detail |
| GET | `/public/apy` | Fee-based APY summary when tracker is active |
| GET | `/public/contracts` | Deployed token/controller JSON + Ekubo infra addresses |
| GET | `/public/positions` | LP positions from JSON (see below) |
| GET | `/public/events` | Recent engine events |
| GET | `/docs` | Swagger UI |

WebSocket: **`/ws/public`** — periodic state + events (same poll interval as `MM_SIM_POLL_INTERVAL_SEC`).

Admin routes (`/admin/*`) require header `X-Admin-Key: <MM_SIM_ADMIN_KEY>`.

## Configuration

See **`.env.example`** for all variables. Important:

| Variable | Purpose |
|----------|---------|
| `STARKNET_RPC_URL` | Sepolia JSON-RPC (e.g. Cartridge, QuickNode, Dwellir) |
| `MM_SIM_CORS` | Comma-separated origins for browser clients |
| `MM_SIM_ADMIN_KEY` | Admin API key (change in production) |
| `MM_SIM_EKUBO_POSITIONS_PATH` | JSON file for `/public/positions` (default: `data/ekubo_positions.json`) |
| `FLEET_ENABLED` | `true` to run multi-agent fleet (needs wallet) |
| `BOT_ACCOUNT_ADDRESS` / `BOT_PRIVATE_KEY` | Required for real txs |

### Monorepo note (zkdefi)

To point LP positions at the main backend export:

```bash
export MM_SIM_EKUBO_POSITIONS_PATH="../backend/data/ekubo_positions.json"
```

## Data files

| File | Purpose |
|------|---------|
| `data/bot_lp_positions.json` | Fallback LP **simulation** data for other zkdefi services when live API is offline |
| `data/bot_limit_orders.json` | Simulated limit book for demos/tests |
| `data/ekubo_positions.json` | Default source for `/public/positions` (safe to extend or replace via env) |

## Cairo contracts (optional)

`contracts/` contains **zkd** test tokens and a **market controller** for demos. See `deployed_addresses.json` for Sepolia deploys used by this stack. `scripts/deploy_mock_tokens.sh` assists declare/deploy flows (requires local Starknet toolchain).

## Roadmap — stronger Sepolia support

Contributions and priorities:

1. **Config-driven pools** — YAML/JSON for token addresses and Ekubo pool keys (reduce hard-coded `chain_reader` defaults).
2. **More protocols** — Index additional Sepolia contracts behind feature flags.
3. **Read-only hardening** — Single env flag to disable all write paths and admin unless explicitly enabled.
4. **CI** — `pytest` + `docker build` on PRs.

Issues and PRs: [Obsqra-Labs/zkdefi](https://github.com/Obsqra-Labs/zkdefi) (path: `market-maker-sim/`).

## License

Use the license of the parent **zkdefi** repository.
