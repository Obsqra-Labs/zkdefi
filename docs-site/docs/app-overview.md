# App Overview

This is the practical route map for current usage.

## Primary Routes

| Route | Purpose |
|---|---|
| `/` | Landing and product context |
| `/agent` | Capital OS workspace |
| `/trade` | Trade Desk workspace |
| `/profile` | Identity, trust, reputation, compliance context |
| `/privacy` | Product privacy page |
| `/docs` | Documentation |

## Recommended User Path

1. Connect wallet at `/`.
2. Check trust/profile state in `/profile`.
3. Operate in `/agent` (Capital OS).
4. Execute in `/trade` (Trade Desk).
5. Return to `/profile` to review state and disclosures.

## Current Scope

- Production-facing user flows: `/agent`, `/trade`, `/profile`.
- Additional pages can exist for experiments, but core docs prioritize the route set above.

## Notes For Integrators

- Deep-link users to the exact surface they need (`/agent` vs `/trade`).
- Do not assume old query-state route models in new integrations.
- Keep support links explicit so reported issues are reproducible.

Next: [Capital OS](/capital-os) | [Trade Desk](/trade-desk) | [How Systems Work](/how-systems-work)
