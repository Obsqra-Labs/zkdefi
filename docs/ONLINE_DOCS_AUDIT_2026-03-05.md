# Online Docs Audit (2026-03-05)

## Scope

- Live docs host checked: `https://zkde.fi/docs`
- Codebase source of truth checked:
  - `frontend/src/app/agent/page.tsx`
  - `frontend/src/app/profile/page.tsx`
  - FastAPI route inventory from `dev_log/local_routes_full.json`

## Live Docs: Stale Findings

The following live pages still contain stale markers:

- `index`: `v=trade` still shown as canonical
- `app-overview`: `v=trade` still shown as canonical
- `agent-dashboard`: `v=trade` still shown as canonical
- `flow`: `v=trade` still shown as canonical
- `quick-start`: `v=trade` still shown as canonical
- `guide-first-time-setup`: `v=trade` still shown as canonical
- `compliance-and-disclosure`: `sub=disclosure` still referenced
- `api-overview`: stale endpoints/patterns
  - `/api/v1/zkdefi/contracts`
  - `/api/v1/zkdefi/state/wallet/state/{user_address}`
  - wildcard placeholders for `/phase4a/*`, `/vault-live/*`, `/zkdefi/sim/*`
- `developers`: wildcard placeholders without concrete fixtures

## Live Docs: Deployment Freshness

- `https://zkde.fi/docs/hashmap.json`
  - `last-modified: Tue, 03 Mar 2026 05:09:28 GMT`
- Indicates live docs are behind current local rewrite pass.

## Codebase Truth (Backtest)

### Canonical app routes

- Agent surfaces: `v=vault|oracle|brain`
- Compatibility alias: `v=trade` remaps to `v=oracle`
- Brain sub-tabs: `agent|models|pipeline|agents` (no canonical `sub=disclosure`)
- Profile tabs: `trust|reputation|compliance|connections`

### API route backtest

- Extracted markdown endpoint refs in `docs-site/docs/*.md`: `131`
- Unmatched vs FastAPI routes: `0`

## Rewritten Pages (This Pass)

- `docs-site/docs/index.md`
- `docs-site/docs/app-overview.md`
- `docs-site/docs/agent-dashboard.md`
- `docs-site/docs/flow.md`
- `docs-site/docs/quick-start.md`
- `docs-site/docs/guide-first-time-setup.md`
- `docs-site/docs/compliance-and-disclosure.md`
- `docs-site/docs/api-overview.md`
- `docs-site/docs/developers.md`

## Key Fixture Additions

Added explicit, dated fixture sections and updated endpoint fixtures including:

- Agent route fixtures (`v=oracle`, `v=vault&sub=trade`, brain sub-tabs)
- Auth session APIs:
  - `POST /api/v1/zkdefi/auth/session/start`
  - `POST /api/v1/zkdefi/auth/session/complete`
  - `GET|DELETE /api/v1/zkdefi/auth/session/{starknet_address}`
- zkML scan:
  - `POST /api/v1/zkdefi/zkml/scan`
- Correct wallet state path:
  - `GET /api/v1/zkdefi/wallet/state/{user_address}`
- Concrete experimental fixtures for:
  - `phase4a`
  - `vault-live`
  - `zkdefi/sim`
