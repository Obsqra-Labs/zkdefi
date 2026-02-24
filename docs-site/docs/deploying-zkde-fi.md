# Deploying zkde.fi

High-level view of how zkde.fi is served. For environment variables and secrets, see the repo (e.g. ENV.md and ops runbooks).

## How the app is served

- **Frontend (Next.js)** — Runs on port 3001. Serves the main app (landing, agent, profile, etc.).
- **Backend (FastAPI)** — Runs on port 8003. Serves `/api/` (zkdefi, health, etc.).
- **Reverse proxy (e.g. nginx)** — Routes `/` and `/_next/` to the frontend, `/api/` to the backend, and `/docs/` to the static docs.

## Serving docs at zkde.fi/docs

1. **Build the docs-site:** From repo root, run `./scripts/sync-docs.sh`. This runs `cd docs-site && npm run build` and copies `docs-site/docs/.vitepress/dist/*` to `frontend/public/docs/`.
2. **Serve the built files:** When the frontend is deployed, the Next app can serve `public/docs/` at `/docs` (via Next rewrites), or nginx can serve that directory directly at `location /docs/` with an alias to `frontend/public/docs/`.

See **docs/DOCS_DEPLOYMENT.md** and **scripts/sync-docs.sh** in the repo for details. For nginx config, see ops runbooks (e.g. OPS_NGINX_ZKDEFI.md).

## Environment and secrets

Not covered here. Use **docs/ENV.md** and your ops runbooks for environment variables and deployment secrets.

Next: [Developers](/developers) | [DOCS_DEPLOYMENT](https://github.com/obsqra-labs/zkdefi/blob/main/docs/DOCS_DEPLOYMENT.md)
