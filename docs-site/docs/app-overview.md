# App Overview And Routes

This page is the source of truth for how users and GATE integrators should think about the public app surface at `https://zkde.fi`.

## The Problem This Solves

The app has evolved from an older tab model into a surface model, but many references in historical docs still describe the old shape. That creates onboarding friction, broken deep links, and confusion when users try to follow guided flows.

## Why This Matters

When route semantics are clear, users can reliably complete tasks, support can triage issues faster, and integrators can generate stable links from external systems, bots, or partner dashboards.

## Route Map (Current)

| Route | Primary role | Current status |
|---|---|---|
| `/` | Landing and product narrative | Production |
| `/agent` | Main execution workspace | Production |
| `/profile` | Identity, trust, and compliance context | Production |
| `/mvp` | Legacy/alternate workflow surface | Experimental |
| `/marketplace` | Model marketplace view | Experimental |
| `/privacy` | Privacy positioning page | Production |
| `/terms` | Terms/legal page | Production |
| `/docs` | Public documentation | Production |

## Canonical State In URL

The app uses URL state so links are shareable and support can reproduce exact UI context.

### Agent workspace

- Canonical route state is `?v=` for top-level surfaces.
- Valid values: `vault`, `oracle`, `brain`.
- Optional `?sub=` can select a sub-surface when supported.
- Legacy `v=trade` is still accepted and remapped to `v=oracle`.
- Legacy `?tab=` links are still accepted for backward compatibility, but should not be used for new docs.

### Profile workspace

- Canonical route state is `?tab=` for profile sections.
- Valid values: `trust`, `reputation`, `compliance`, `connections`.
- Legacy values like `overview` and `collateral` are mapped for compatibility.
- Reputation tab includes collateral and reputation-based lending readiness context.

## How A User Moves Through The App

```mermaid
flowchart LR
  A[Landing /] --> B[Connect wallet]
  B --> C[/agent?v=vault]
  C --> D[/agent?v=oracle]
  C --> E[/agent?v=brain]
  B --> F[/profile?tab=trust]
  F --> G[/profile?tab=reputation]
  F --> H[/profile?tab=compliance]
  F --> I[/profile?tab=connections]
```

## Production Vs Experimental Scope

zkde.fi docs intentionally cover both production and experimental paths:

- Production content explains what is expected to work for standard users now.
- Experimental content is labeled clearly so advanced users and integrators understand that behavior, API fields, or UX can change faster.

This dual scope avoids hiding meaningful capabilities while still setting realistic expectations.

## Linking Guidance For Integrators

If you generate links from partner portals, bots, or runbooks:

1. Use canonical forms such as `/agent?v=vault` and `/profile?tab=trust`.
2. Avoid legacy `?tab=` values on `/agent` in new systems.
3. Prefer explicit links in user notifications so support and users see identical state.

## Key Fixtures (Verified 2026-03-05)

- `/agent?v=vault`
- `/agent?v=oracle`
- `/agent?v=brain`
- `/agent?v=vault&sub=trade`
- `/profile?tab=trust`
- `/profile?tab=reputation`
- `/profile?tab=compliance`
- `/profile?tab=connections`

Next: [Agent workspace](/agent-dashboard) | [Profile and identity](/profile-and-identity) | [How execution flows](/flow)
