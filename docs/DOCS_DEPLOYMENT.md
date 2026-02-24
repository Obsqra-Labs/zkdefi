# Docs Deployment

**Canonical docs URL: zkde.fi/docs.** Nginx serves `frontend/public/docs/` at that path. The subdomain **docs.zkde.fi** is optional; document it only if you re-enable it.

## zkde.fi/docs (canonical)

Build the docs-site, then copy output into the frontend so the app (or nginx) serves docs at **zkde.fi/docs**:

```bash
./scripts/sync-docs.sh
```

From repo root: builds `docs-site`, copies `docs-site/docs/.vitepress/dist/*` to `frontend/public/docs/`. When the frontend is deployed, docs are at `https://zkde.fi/docs/`. On servers using nginx, configure `location /docs/` with alias to `frontend/public/docs/` (see ops runbooks).

## Subdomain: docs.zkde.fi

### Setup in Hostinger
1. Log into Hostinger hPanel
2. Go to Domains → Subdomains
3. Create subdomain: `docs.zkde.fi`
4. Point it to a directory (e.g., `public_html/docs`)
5. Deploy the built docs to that directory

### Build Command (standalone)
```bash
cd docs-site
npm install
npm run build
# Output: docs/.vitepress/dist
```

## Troubleshooting

### docs.zkde.fi shows matchain.obsqra.fi or wrong site

The subdomain is pointing to the wrong location. Fix in Hostinger:

1. Log into Hostinger hPanel
2. Go to Domains → Subdomains → docs.zkde.fi
3. Check the document root or CNAME:
   - If using a directory, ensure it points to the deployed docs static files (not to another site)
   - If using a redirect, remove any redirect to matchain.obsqra.fi
4. If the subdomain was set up as a redirect instead of a directory, delete it and recreate as a proper subdomain with its own document root
5. Deploy the docs archive to the correct directory

**Workaround:** Use `https://zkde.fi/docs/` instead. This always works when the frontend is deployed.

### docs.zkde.fi shows 404

The docs have not been deployed to the subdomain directory. Either:
- Deploy the docs archive to the subdomain document root, or
- Use `https://zkde.fi/docs/` as the fallback### VitePress assets not loading at /docsEnsure `base: '/docs/'` is set in `docs-site/docs/.vitepress/config.mts`. This is required for asset paths to work correctly under the `/docs/` path.
