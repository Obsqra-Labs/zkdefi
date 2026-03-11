# Branch Guide

> Last updated: 2026-03-11

## Active Branch

| Branch | Commits | Description |
|--------|---------|-------------|
| **`main`** | 232 | Production — deployed to zkde.fi |

## Feature Branches (ahead of main)

| Branch | Ahead / Behind | Status | Description |
|--------|----------------|--------|-------------|
| `feature/advanced-l3-phase1` | +2 / −3 | **Nearly merged** | ModelBridgeHeavy circuit, Garaga verifier gen script. Most work already on main. |
| `feature/ui-improvements-pass` | +63 / −232 | **Superseded** | A11y labels, responsive Capital OS Strip, animated ProofStepper. Superseded by Privacy-Track UI reshape (Phases A-E) now on main. |
| `feature/tradedesk-real-aggregation` | +91 / −232 | **Archived** | Real signal aggregation, receipts timeline, market context. TradeDesk V1 replaced by MissionControl layout. Components moved to `_archive/`. |
| `feature/capital-os-oracle-phase1` | +49 / −232 | **Superseded** | Relayer vault processor, receipt service, WithdrawalService. Core ideas landed in main via oracle gating engine. |
| `feature/capital-os-integration-2026-03-06` | +26 / −232 | **Docs-only** | Architecture guides, strategy docs, API routing fix docs. |
| `feature/control-surface-deferred-auth` | +29 / −232 | **Docs-only** | Docs-site pages: Troubleshooting, Deploy to Ekubo, Architecture summary. |
| `feature/four-surface-rearchitecture` | +29 / −232 | **Docs-only** | Same as control-surface-deferred-auth (identical tip). |
| `merge/phase1-3-integration` | +101 / −232 | **Superseded** | Oracle gating engine (Phase 3), forecaster + reputation adapters (Phase 2). Cherry-picked to main. |
| `feature/phase-b-improvements` | +141 / −232 | **Superseded** | Phase B UX improvements. Strategy now executed directly on main via Privacy-Track Phases A-E. |

## Branch Lifecycle

- **Nearly merged** — 1-2 commits left; can be merged or rebased trivially.
- **Superseded** — Work was rearchitected or cherry-picked into main under a different approach. Safe to delete after review.
- **Archived** — Feature direction abandoned (e.g., TradeDesk V1). Keep for reference only.
- **Docs-only** — Contains documentation that may still be useful but diverged significantly from main.

## Backup Branch

| Branch | Description |
|--------|-------------|
| `backup/docs-predeletion-20260306-115441` | Snapshot of docs before bulk cleanup on 2026-03-06. |
