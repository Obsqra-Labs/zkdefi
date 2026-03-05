# Quick Start (Live App)

This quick start is for users who want to move from zero setup to first meaningful execution in the live app.

## The Problem This Solves

New users frequently connect a wallet but do not know which surface to open first, which route state to use, or how to avoid legacy links.

## Why This Matters

A clean first session reduces user error, lowers support load, and makes later automation and compliance flows easier to complete.

## Fast Path

1. Install a Starknet wallet (ArgentX or Braavos).
2. Select Starknet Sepolia in wallet settings.
3. Open `https://zkde.fi` and connect wallet.
4. Open `/agent?v=vault` for capital and deployment context.
5. Open `/profile?tab=trust` to verify trust/reputation posture.

## First Session Flow

```mermaid
flowchart LR
  A[Install wallet] --> B[Switch to Sepolia]
  B --> C[Connect at zkde.fi]
  C --> D[/agent?v=vault]
  D --> E[/agent?v=oracle]
  D --> F[/agent?v=brain]
  C --> G[/profile?tab=trust]
```

## What To Do Next

### Problem it solves

After first connection, users often jump directly into execution without understanding constraints and profile context.

### Why it matters

Working through the intended order improves outcome quality:

- `vault` first for capital posture
- `oracle` next for signal and market context
- `vault` trade sub-surface for execution: `/agent?v=vault&sub=trade`
- `brain` last for automation controls
- `profile` in parallel for trust/compliance visibility

## Key Fixtures (Verified 2026-03-05)

- `/agent?v=vault`
- `/agent?v=oracle`
- `/agent?v=vault&sub=trade`
- `/agent?v=brain&sub=agent`
- `/profile?tab=trust`

Next: [First-time setup](/guide-first-time-setup) | [Agent workspace](/agent-dashboard) | [Profile and identity](/profile-and-identity)
