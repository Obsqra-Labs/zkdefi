# Vault Redesign: Privacy-First Unified Surface

**Date:** 2026-03-02
**Status:** Approved
**Approach:** Full unification (Approach A)

## Problem

The current Vault surface has 6 sub-tabs, 5 deposit/withdraw panels, 3 localStorage key schemes, and ~3,800 lines of overlapping components. Privacy mode selection is disconnected from deposit/withdraw actions. Users can't find their money across scattered panels. The experience feels chonky.

## Design Decisions

1. **Privacy first** -- the vault IS the privacy. The privacy method is the product, not a setting.
2. **Programmatic privacy tiers** -- 4 escalating methods (not pools). The method determines what's proven and revealed, not where funds go.
3. **One unified flow** -- tier selection within the deposit/withdraw flow. Three separate panels merge into one adaptive component.
4. **Side-by-side deposit/withdraw** -- always visible on the Vault tab. Inspired by obsqra.fi's layout.
5. **Three tabs** -- Vault, Yield, Activity. Down from 6.

## Component Architecture

```
VaultSurface (shell: header, 3 tabs, shared state)
├── VaultTab
│   ├── TierSelector (4 privacy method cards)
│   ├── AIInsight (contextual LLM recommendation)
│   ├── TrendingBar (market pulse stats)
│   ├── DepositPanel (left)
│   │   ├── AmountInput
│   │   ├── AllocationPreview (Ekubo LP, Lending, Staking, Idle)
│   │   └── ProofStepper (tier-adaptive)
│   ├── WithdrawPanel (right)
│   │   ├── CommitmentPicker (unified across all tiers)
│   │   ├── AmountInput (partial withdraw where supported)
│   │   └── ProofStepper
│   └── PositionsOverview (all commitments, balances, privacy levels)
├── YieldTab
│   ├── YieldSummary (blended APY, total earned, next harvest)
│   ├── YieldSources (Ekubo LP, Lending, Staking -- one table)
│   └── LendingSection (credit line, supply/borrow)
└── ActivityTab
    ├── FilterBar (action type filters)
    └── ActivityFeed (chronological, grouped by day)
```

### What gets deleted

- `ShieldedPoolPanel` (~540 lines)
- `FullPrivacyPoolPanel` (~680 lines)
- `PrivateTransferPanel` (~510 lines)
- `VaultFundingCard`
- `UnifiedWithdrawCard`
- `AllocationPools` (~75 lines, orphaned)
- `PortfolioTab` (~420 lines)

Logic from these panels lives on inside `DepositPanel`, `WithdrawPanel`, and a shared `usePrivacyVault` hook.

### What survives (trimmed)

- `PositionChart` -- folded into PositionsOverview
- `VaultLedger` -- becomes ActivityFeed (read-only, no manual tx paste)
- `LendingPanel` -- becomes LendingSection (compact card)
- `PrivateYieldPanel` -- absorbed into YieldSummary + YieldSources
- `PerformanceDashboard` -- becomes performance sparkline in YieldTab

### Shared state

One `usePrivacyVault` hook manages:
- Selected privacy method (tier 1-4)
- All commitments (one unified localStorage key: `zkdefi_vault_{address}`, tagged by method)
- Proof generation state machine
- Step progress per method

## Privacy Methods (4 Tiers)

The tier selector shows 4 cards representing escalating privacy techniques. Funds can go into any pool regardless of method. Each card has a tooltip explaining the tradeoffs.

| Method | What it does | What's hidden | Proof type |
|---|---|---|---|
| **Commitment Shield** | Pedersen commitment wraps deposit amount | Amount | Pedersen hash |
| **Nullifier Set** | Merkle tree membership + nullifier-based withdraw | Amount + deposit/withdraw link | Groth16 (Garaga) |
| **Hashed Proof** | Hash-based proofs of claims without revealing values | Amount + balance + claim details | Hash circuit |
| **Dark Ledger** | Off-chain private accounting, no on-chain footprint | Everything | None (internal) |

Each card shows: method name, one-line description, what's hidden, proof type badge, privacy strength indicator (1-4 dots), active commitment count.

### Tooltip content

- **Commitment Shield:** "Your deposit amount is hidden behind a cryptographic commitment. The deposit event is visible on-chain but the value is not. Fastest, lowest gas."
- **Nullifier Set:** "Your deposit joins an anonymity set. Withdrawals use a nullifier so no one can link your withdraw to your deposit. Supports selective disclosure -- prove properties without revealing balances."
- **Hashed Proof:** "Prove things about your position (balance above threshold, pool membership, tenure) without revealing the values themselves. Claims are verified against hashed inputs."
- **Dark Ledger:** "Maximum privacy. Your position is tracked in an encrypted off-chain ledger. No individual deposit/withdraw events on-chain. The protocol operates on your behalf via the operator pattern."

### Endpoint mapping per method

| | Commitment Shield | Nullifier Set | Hashed Proof | Dark Ledger |
|---|---|---|---|---|
| Deposit | `/shielded_deposit` | `/full_privacy/deposit/*` | `/full_privacy/deposit/*` (pool_c) | `/ledger/transfer-in` |
| Withdraw | `/shielded_withdraw` | `/full_privacy/withdraw/*` | `/full_privacy/withdraw/*` | `/ledger/transfer-out` |
| Contract | ShieldedPool | FullyShieldedPool | FullyShieldedPool | None |

## Vault Tab

### Layout (top to bottom)

1. **Tier Selector** -- 4 method cards, always visible
2. **AI Insight** -- contextual LLM recommendation, dismissable
3. **Trending Bar** -- market pulse (STRK/ETH price, top pool APY, vault TVL, depositor count)
4. **Deposit (left) | Withdraw (right)** -- side-by-side, adaptive per method
5. **Positions Overview** -- all commitments, capital deployment, privacy/public toggle

### AI Insight

Compact card with one-liner + reasoning. Pulls from `/zkdefi/agent/recommendation`. Contextual to user's positions, reputation tier, risk profile. Refreshes on page load, dismissable.

Example: "Ekubo ETH/STRK pool APY jumped 3.2% in 24h. Consider depositing via Nullifier Set -- your reputation qualifies for relayed withdrawals."

### Trending Bar

Slim stats bar. Non-personalized. Pulls from `/zkdefi/market/surface` and `/zkdefi/oracle/pool-apys`. 30-second poll.

Shows: STRK/ETH 24h change, top pool + APY, vault TVL, active depositors, average APY.

### Deposit Flow

User experience is always: **amount > preview > prove > confirm**. The proof steps adapt per method.

- **Asset selector** (STRK / ETH)
- **Amount input** with balance and MAX button
- **Allocation Preview** -- where capital will be deployed (Ekubo LP %, Lending %, Staking %, Idle %). Split comes from user's risk profile. Blended APY shown.
- **Proof Pipeline** -- step-by-step visualization (green check done, blue spinner active, gray circle pending). Inspired by obsqra.fi `DataPathVisualization`.

Proof steps per method:

| Step | Commitment Shield | Nullifier Set | Hashed Proof | Dark Ledger |
|---|---|---|---|---|
| 1 | Generate Pedersen commitment | Generate secret + commitment | Generate hash inputs | Verify tx on-chain |
| 2 | Approve + sign deposit | Register in Merkle tree | Build hash proof | Credit ledger |
| 3 | Confirm | Build Groth16 proof | Register claim | Done |
| 4 | -- | Approve + sign deposit | Approve + sign | -- |

### Withdraw Flow

Starts with selecting an existing commitment, not entering a fresh amount.

- **Commitment Picker** -- shows ALL positions across all methods in one list, tagged by method. Selecting auto-sets the tier selector above.
- **Amount input** -- partial withdraw for Nullifier Set (V2) and Dark Ledger. Commitment Shield is full-only (input grayed, "Full withdrawal only").
- **Relayer toggle** -- only appears when user's reputation tier qualifies. Otherwise absent.
- **Proof Pipeline** -- same visual pattern as deposit, different steps per method.
- **Yield accrued** shown next to each commitment in the picker.

### Positions Overview

Below the deposit/withdraw panels.

- **Summary row:** Total value, privacy coverage (% shielded), 30-day yield
- **Allocation bar:** Visual breakdown by privacy method, color-coded to tier selector
- **Positions table:** Every commitment across all methods. Clicking a row selects it in withdraw panel.
- **Capital deployed:** Where the protocol put your money (Ekubo, lending, staking, idle)
- **Privacy/Public toggle:** Privacy view aggregates totals, hides individual positions.

## Yield Tab

Three sections:

### Sources Table

Every yield source in one table: source name, allocation %, APY, 30-day earnings, status. Replaces scattered cards from PrivateYieldPanel and PerformanceDashboard.

### Credit Line

Compact card collapsed from LendingPanel. Shows: collateral, reputation tier, interest rate, available credit, current debt, health factor. Supply/Borrow via inline expanders. If no credit line, one-line CTA: "Stake or build reputation to unlock borrowing."

### Performance Chart

Cumulative yield sparkline (30d). Rebalance activity summary: last/next rebalance timing, count, average improvement.

## Activity Tab

Chronological feed grouped by day. Replaces VaultLedger (no more manual tx hash paste) and ReceiptTimeline.

### Filter bar

Filter by action type: All, Deposits, Withdrawals, Yields, Proofs.

### Feed entries

Each entry shows: action icon + type, description, privacy method used, timestamp, relevant hashes (commitment, nullifier, proof, tx), Starkscan link for on-chain events.

Entry types: deposits, withdrawals, rebalances (what moved + why), yield accruals (amount + source), proof generations, selective disclosures.

Dark Ledger entries show action but no tx hash (no on-chain event).

### Data source

New unified endpoint: `GET /zkdefi/vault/activity/{address}` aggregating ledger entries, proof receipts, rebalance logs, yield events from existing backend data.

## Scope

### Frontend

- Delete: ~2,500 lines (5 panels + PortfolioTab + AllocationPools)
- Create: ~1,200 lines (VaultSurface shell, VaultTab, YieldTab, ActivityTab, TierSelector, DepositPanel, WithdrawPanel, ProofStepper, CommitmentPicker, PositionsOverview, AIInsight, TrendingBar, usePrivacyVault hook)
- Modify: VaultSurfaceContainer (replace guts, keep mounting point)

### Backend

- New endpoint: `GET /zkdefi/vault/activity/{address}` (aggregation)
- Existing endpoints unchanged -- unified frontend calls the right ones per tier

### Storage migration

- Merge `zkdefi_commitments_{addr}`, `zkdefi_shielded_{addr}`, `zkdefi_fullprivacy_{addr}` into `zkdefi_vault_{addr}`
- Migration function reads old keys, tags by method, writes unified key, cleans up
- Runs on first load after deploy
