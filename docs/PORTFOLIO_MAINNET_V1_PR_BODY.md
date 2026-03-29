Portfolio: Gate-First Mainnet V1 Desk
=====================================

Suggested Title
---------------
`Portfolio: Gate-first mainnet-v1 execution desk`

Suggested PR Body
-----------------
## Summary

This ships the new `/portfolio` mainnet-v1 product surface as a gated wallet-signing desk for spot swaps and token-only rebalances.

The release changes the product story from "operator console" to:

1. AI proposes
2. The Gate evaluates
3. Execution is permitted or blocked
4. Wallet signing proceeds only after Gate review
5. Receipts and auditability stay available behind the main flow

## Product Decisions

### Gate-first UX

- The Gate is now the hero state on the page.
- The main desk answers, in order:
  1. what the system recommends
  2. whether the Gate allows it
  3. why it passed or failed
  4. what changes if the user accepts
  5. where to inspect checks and receipts

### Manual wallet mode stance

- Gate remains decisive for the product thesis.
- No manual bypass is included in this release.
- Tiny single-step manual rebalances are no longer hard-blocked purely because the wallet is small when a real route exists.
- Those cases now surface as expensive-but-allowed warnings instead of fake route failures.

## What Changed

### Frontend

- Added the new `/portfolio` route and component split for the allocation desk.
- Promoted the Gate result into a dominant hero module with primary CTA and summary reasoning.
- Reframed the AI recommendation as a thesis instead of a settings panel.
- Simplified current vs target vs AI allocation presentation.
- Moved deep checks and verbose reasoning behind Safety details / drawers.
- Tightened CTA state handling so the desk no longer shows contradictory states for the same draft.
- Fixed the prepared rebalance sign path so wallet-signing no longer silently no-ops.
- Improved rebalance guidance for small wallets by surfacing signable-target hints and calmer economic messaging.
- Merged duplicate approvals before wallet signing on prepared executions.

### Backend

- Added the stable `/api/v1/execution_gate/*` API for the `/portfolio` lane.
- Added the portfolio execution gate service for mainnet-v1 swap and rebalance evaluation.
- Added receipt confirmation, recommendation, policy, readiness, telemetry, and execution endpoints for the portfolio desk.
- Added portfolio monitoring / tx-status workers for the receipt lifecycle.
- Relaxed fee-policy handling for tiny one-step manual rebalances so a valid route can proceed with warnings instead of being hard-vetoed on fee share alone.
- Preserved clearer fee-efficiency reasoning in the gate response.

## User-Visible Outcomes

- The desk now reads as "AI proposes, Gate decides, execution is governed."
- A first-time user can see the Gate decision above the fold instead of digging through internal-looking panels.
- Warnings and blockers are no longer conflated.
- When a draft is signable, the CTA cleanly advances to wallet review/signing.
- When a draft is not signable, the desk explains why instead of looking clickable-but-dead.

## Key Files

### Frontend

- `frontend/src/app/portfolio/page.tsx`
- `frontend/src/components/portfolio/PortfolioMainDesk.tsx`
- `frontend/src/components/portfolio/usePortfolioPageShell.ts`
- `frontend/src/components/portfolio/TargetEditor.tsx`
- `frontend/src/components/portfolio/PrimaryActionTray.tsx`
- `frontend/src/components/portfolio/execution.ts`

### Backend

- `backend/app/api/routes/execution_gate.py`
- `backend/app/services/portfolio_execution_gate.py`
- `backend/app/main.py`
- `backend/app/api/routes/portfolio.py`

### Docs / Validation

- `docs/PORTFOLIO_FRONTEND_SPEC.md`
- `docs/MAINNET_V1_PROGRESS.md`
- `scripts/smoke_portfolio_mainnet.sh`

## Verification

Validated with:

```bash
python3 -m py_compile backend/app/services/portfolio_execution_gate.py
cd frontend && npm run build
pm2 restart zkdefi-backend
pm2 restart zkdefi-frontend
BASE_URL=https://zkde.fi API_BASE=https://zkde.fi ./scripts/smoke_portfolio_mainnet.sh
```

Also verified live against the small-wallet rebalance case:

- a real one-step route exists
- the Gate now returns allowed with warning for the expensive-but-executable case
- wallet review/signing can proceed once the draft is in the signable band

## Explicit Non-Goals In This Release

- No LP / lending / staking execution on the main product surface
- No advanced executor mode management on the main surface
- No manual Gate bypass
- No session-key-first primary flow

## Follow-Ups

1. Show the minimum signable move or nearest signable target directly in the editor
2. Continue reducing above-the-fold density in the Gate and impact sections
3. Decide whether manual wallet mode should eventually support a secondary explicit override when a route exists but the Gate still advises against execution
