# zkde.fi Documentation

This directory contains the **official documentation** for zkde.fi, a privacy-preserving AI capital allocator for DeFi on Starknet.

## Overview

zkde.fi documentation is built with **VitePress** and served at `https://zkde.fi/docs/`. The docs emphasize **privacy preservation through zero-knowledge proofs**, not just verification.

## Core Privacy Technologies Documented

1. **zkML (Zero-Knowledge Machine Learning)**: AI models that analyze private user data and generate proven recommendations without exposing inputs
2. **Shielded Pools**: Poseidon commitment-based deposits/withdrawals that hide amounts and break address links
3. **Privacy-Preserving Oracle**: Strategy recommendations computed on encrypted user profiles
4. **Proof Pipeline**: STARK proofs generated for every vault operation (deposits, withdrawals, allocations)

## Directory Structure

```
docs-site/
├── docs/
│   ├── .vitepress/
│   │   ├── config.mts         # VitePress configuration
│   │   └── dist/              # Built static site (gitignored)
│   ├── index.md               # Homepage (hero section)
│   ├── intro.md               # Introduction to privacy-preserving AI
│   ├── privacy-features.md    # Core privacy technologies
│   ├── zkml-models.md         # zkML circuits and models
│   ├── real-time-updates.md   # WebSocket + Event Bus architecture
│   ├── oracle-execution.md    # Oracle flow + proof generation
│   ├── session-keys.md        # Session delegation
│   ├── rebalancing.md         # Autonomous agents
│   ├── api-overview.md        # API reference
│   ├── developers.md          # Developer guide
│   └── ...
├── package.json
└── README.md                  # This file
```

## Building the Docs

### Development Mode
```bash
npm run dev
# Serves at http://localhost:5173/
```

### Production Build
```bash
npm run build
# Output: docs/.vitepress/dist/
```

### Sync to Frontend
After building, sync the static site to the frontend's public directory:

```bash
# From zkdefi root
rsync -a --delete docs-site/docs/.vitepress/dist/ frontend/public/docs/

# Or use deployment script
./deploy_production.sh  # Includes docs build + sync
```

## Documentation Standards

### Privacy-First Framing

All documentation should frame features around **privacy preservation**, not just verification. The core narrative:

> zkde.fi uses **zero-knowledge proofs** to prove AI decisions are correct **without revealing your private data**.

### Key Messaging

- **The Privacy Problem**: Traditional DeFi exposes wallet balances, strategies, risk profiles to MEV bots and competitors
- **Zero-Knowledge Solution**: zkML proves AI ran correctly on your data without exposing inputs; shielded pools hide transaction amounts and break address links
- **Real-World Impact**: Institutions prove compliance without exposing strategies; retail users get personalized recommendations without data harvesting

### Writing Style

- **Concrete over abstract**: Explain "Poseidon commitment hides deposit amount" not "privacy-aware operational flows"
- **Problem → Solution → Impact**: Start with user pain, explain ZK technology, show real benefit
- **Technical accuracy**: Use correct cryptographic terms (zkSNARK, zkSTARK, Poseidon hash, commitment scheme)

## Deployment

The docs are deployed to **`https://zkde.fi/docs/`** via nginx:

```nginx
# In /etc/nginx/conf.d/zkde.fi.conf
location /docs/ {
    alias /opt/obsqra.starknet/zkdefi/frontend/public/docs/;
    index index.html;
    try_files $uri $uri/ $uri.html =404;
    add_header Cache-Control "public, max-age=300";
}
```

### Deployment Process

1. Edit docs in `docs-site/docs/`
2. Build: `npm run build`
3. Sync: `rsync -a --delete docs-site/docs/.vitepress/dist/ frontend/public/docs/`
4. Nginx serves from `frontend/public/docs/`

## Key Documentation Pages

### For Users

- **`index.md`**: Homepage with privacy-first hero section
- **`intro.md`**: Introduction to privacy-preserving AI agents
- **`privacy-features.md`**: Detailed explanation of zkML, shielded pools, confidential strategies
- **`quick-start.md`**: Getting started guide

### For Developers

- **`developers.md`**: Integration guide, proof verification, API authentication
- **`api-overview.md`**: REST API reference
- **`contracts.md`**: Smart contract addresses and ABIs
- **`real-time-updates.md`**: WebSocket events and Event Bus architecture
- **`oracle-execution.md`**: Oracle recommendation flow and proof pipeline

### For Integrators

- **`architecture-summary.md`**: System architecture overview
- **`deploying-zkde-fi.md`**: Deployment guide
- **`zkml-models.md`**: Available zkML circuits and privacy guarantees

## Maintenance

### Updating for New Features

When adding new features, update relevant docs and emphasize privacy aspects:

1. Describe the **privacy problem** the feature solves
2. Explain the **zero-knowledge technology** used (zkML, Poseidon, proofs)
3. Show **concrete examples** of how user data stays private
4. Document **API endpoints** and **proof verification**

### Keeping Docs in Sync

The documentation should be the **source of truth**. When backend/frontend changes:

- Update API endpoints in `api-overview.md`
- Update contract addresses in `contracts.md`
- Update proof schemas in `developers.md`
- Rebuild and sync to frontend

## Dependencies

```json
{
  "vitepress": "^1.0.0"
}
```

VitePress provides:
- Markdown-based static site generation
- Vue 3 components in markdown
- Built-in search
- Dark mode
- Mermaid diagram support

## Testing

Before deploying docs changes:

1. **Build locally**: `npm run build` (check for broken links)
2. **Preview**: `npm run preview` (test navigation)
3. **Verify nginx**: After sync, test `https://zkde.fi/docs/` in production

## Support

For documentation questions or improvements:
- Open an issue in the main zkdefi repo
- Tag with `documentation` label
- Mention privacy framing if relevant

---

**Last Updated**: 2026-03-05  
**Maintained By**: Obsqra Labs  
**License**: See main zkdefi LICENSE
