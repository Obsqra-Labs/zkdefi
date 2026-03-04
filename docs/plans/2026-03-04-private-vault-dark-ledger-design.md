# Private Vault & Dark Ledger — Design

**Date:** 2026-03-04
**Status:** Approved

## Mental Model

### My Private Vault

A user's Private Vault is their personal, sovereign account. They deposit funds into it privately using ZK deposit rails. The Dark Ledger is the accounting layer underneath — it tracks balance, deployments, and yield. The user owns the balance. The AI Capital Navigator optimizes where capital goes.

The Private Vault is not a pool. It's personal.

### The Yield Universe

Everything the AI (or the user manually) can deploy vault capital into:

- Ekubo LP pools
- Lending protocols (Vesu, etc.)
- Native STRK staking
- Privacy pools (shared dark pools where multiple vaults aggregate capital)
- DCA strategies
- Future adapters via IStrategyAdapter

Privacy pools are deployment targets — one of many options in the yield universe. The VaultController commit-reveal mechanism is how capital moves from the vault to these targets without leaking intent (MEV protection).

### Deposit Rails

How funds enter the vault privately. These are mechanisms, not destinations:

- **Commitment Shield** — Pedersen commitment + Groth16 proof via ConfidentialTransfer contract
- **Nullifier Set** — Merkle tree commitment via FullyShieldedPool contract
- **Hashed Proof** — Same infrastructure as Nullifier Set with pool_type=2

Each deposit rail produces a ZK-verified on-chain deposit. The relayer/operator claims the position and credits the user's Dark Ledger balance. The user's address is never the claimant.

### Self-Custody Mode (Optional)

Users who prefer direct control can hold their own commitments and sign their own transactions. This is the existing "vault" behavior. Trade-off: on-chain interactions have some correlation leakage since the user's address appears as the caller.

Self-custody positions can be swept into the Dark Ledger at any time. Dark Ledger balance can be unwound into a self-custody position.

## Architecture

```
Wallet → [ZK Deposit Rail] → My Private Vault (Dark Ledger)
                                     │
                                     ├── AI Capital Navigator
                                     │     └── Deploy via VaultController commit-reveal
                                     │           ├── Ekubo LP
                                     │           ├── Lending
                                     │           ├── Staking
                                     │           ├── Privacy Pools (shared dark pools)
                                     │           ├── DCA
                                     │           └── [future IStrategyAdapter]
                                     │
                                     ├── Manual Deploy
                                     │
                                     └── Withdraw (via relayer)
```

## Deposit Flow (Private Vault Mode)

1. User selects deposit amount and deposit rail (Commitment Shield, Nullifier Set, or Hashed Proof).
2. Frontend calls the corresponding backend endpoint to generate commitment + proof.
3. User signs the approve + deposit transaction via wallet.
4. On-chain: tokens move into the privacy tier pool under a ZK commitment.
5. Backend detects the confirmed deposit (via tx_hash verification).
6. Backend credits the user's Dark Ledger balance.
7. The commitment is held by the operator/relayer — not the user.
8. The user sees their Private Vault balance increase.

The on-chain deposit is private (ZK commitment). The ledger credit is off-chain (Dark Ledger). No on-chain trace connects the user's wallet to their vault balance.

## Deposit Flow (Self-Custody Mode)

Same as today: user holds the commitment directly. The on-chain position is in the privacy tier pool. The user can withdraw by generating a proof and signing the withdraw tx. No ledger involvement.

## Sweep: Self-Custody → Dark Ledger

1. User initiates "Move to Dark Ledger" on a self-custody position.
2. User generates a withdraw proof for the position.
3. Instead of submitting the tx themselves, they send the proof to the relayer.
4. The relayer executes the withdrawal on-chain.
5. Tokens land in the relayer's wallet.
6. Backend credits the user's Dark Ledger balance.
7. Self-custody position is removed from the user's local vault state.

## Sweep: Dark Ledger → Self-Custody

1. User initiates "Move to Vault" on a Dark Ledger balance.
2. Backend debits the Dark Ledger balance.
3. The relayer deposits into a privacy tier pool on behalf of the user.
4. The commitment is returned to the user (stored in their local vault state).
5. User now holds a self-custody position.

## Vault Withdrawal

### From Dark Ledger

1. User requests withdrawal (amount, destination address).
2. Backend debits the Dark Ledger balance.
3. Relayer executes the payout: either direct wallet transfer or through a privacy tier pool for additional obfuscation.
4. User receives tokens at their specified address.
5. No on-chain link between the vault and the withdrawal.

### From Self-Custody (via Relayer — new)

1. User generates the withdraw proof for their position.
2. User sends the proof to the relayer instead of submitting directly.
3. Relayer executes the withdraw on-chain (relayer address is the caller).
4. Relayer sends tokens to the user's specified address via a separate transfer.
5. On-chain: the privacy pool withdrawal and the token receipt are decoupled.

### From Self-Custody (Direct — existing)

1. User generates the withdraw proof.
2. User signs and submits the withdraw transaction.
3. Tokens go directly to the user's wallet.
4. Some correlation leakage (user's address appears on both sides).

## Capital Deployment (VaultController Commit-Reveal)

When the AI or user deploys capital from the Dark Ledger:

1. User/AI requests deployment (strategy, amount, parameters).
2. Backend debits the Dark Ledger balance.
3. VaultProposalService creates a proposal hash from (adapters, amounts, params, salt).
4. Relayer submits `commit_proposal(proposal_hash)` on VaultController.
5. After commit delay (MEV protection window), relayer submits `execute_proposal(adapters, amounts, salt)`.
6. VaultController verifies the hash matches and dispatches to the appropriate IStrategyAdapter.
7. IStrategyAdapter deploys capital (Ekubo LP, lending, staking, etc.).
8. Allocation recorded in the Dark Ledger.
9. Yield accrues to the user's Dark Ledger balance (harvested periodically).

The user's identity never appears on-chain. Only the relayer address appears as the caller of commit and execute.

## Components to Build / Wire

### Backend

| Component | Status | Work Needed |
|-----------|--------|-------------|
| LedgerService | Built | Add `credit_from_privacy_deposit` method (verify privacy tier deposit, credit ledger) |
| VaultProposalService | Built | Wire to relayer for on-chain commit/execute submission |
| RelayerRunner | Built | Add `submit_commit_proposal` and `submit_execute_proposal` tasks |
| Deposit verification | Partial | Add tx verification for privacy tier deposits (detect commitment in events) |
| Sweep endpoints | New | `POST /sweep/to-ledger` (self-custody → dark ledger), `POST /sweep/to-vault` (dark ledger → self-custody) |
| Relayer-mediated vault withdraw | New | Accept withdraw proof, execute via relayer, transfer to user |

### Frontend

| Component | Status | Work Needed |
|-----------|--------|-------------|
| DepositPanel | Built | Add destination toggle (Private Vault vs Self-Custody). Private Vault = Dark Ledger credit. |
| WithdrawPanel | Built | Add "via Relayer" option for self-custody withdrawals. |
| VaultTab / PositionsOverview | Built | Show Dark Ledger balance alongside self-custody positions. Add sweep actions. |
| Deploy UI | Partial | Wire to VaultController commit-reveal for Dark Ledger deployments. |

### Contracts (On-Chain)

| Contract | Status | Work Needed |
|----------|--------|-------------|
| VaultController | Deployed | Already supports commit_proposal / execute_proposal. No changes needed. |
| IStrategyAdapter impls | Deployed | Ekubo, Lending, Staking adapters deployed. No changes needed. |
| ConfidentialTransfer | Deployed | No changes needed. |
| FullyShieldedPool | Deployed | No changes needed. |

### Relayer

| Task | Status | Work Needed |
|------|--------|-------------|
| Privacy tier withdrawal execution | Partial | Wire relayer to accept withdraw proofs and execute on behalf of users |
| VaultController commit submission | New | Relayer submits `commit_proposal` tx |
| VaultController execute submission | New | Relayer submits `execute_proposal` tx after delay |
| Sweep deposit execution | New | Relayer deposits into privacy tier on behalf of user (ledger → self-custody) |

## Privacy Guarantees

| Action | On-chain visibility | User address exposed? |
|--------|--------------------|-----------------------|
| Private Vault deposit | ZK commitment in privacy pool | No (relayer claims) |
| Self-custody deposit | ZK commitment in privacy pool | Yes (user signs) |
| Dark Ledger deployment | Relayer calls VaultController | No |
| Dark Ledger withdrawal | Relayer transfers to user | Destination only (no link to vault) |
| Self-custody withdraw (relayer) | Relayer calls pool withdraw | No (relayer is caller) |
| Self-custody withdraw (direct) | User calls pool withdraw | Yes |
| Sweep to Dark Ledger | Relayer withdraws from pool | No |
| Sweep to Self-Custody | Relayer deposits to pool | No (commitment returned to user) |
