# Private Vault & Dark Ledger — Design v2

**Date:** 2026-03-04
**Status:** Approved (v2 — incorporates accounting, provability, and trust boundary review)

---

## 1. Core Principles

### A. One canonical entity: VaultAccount

Every user has a **VaultAccount** with a stable `vault_id`. Wallets are auth methods (identity keys), not the vault. A user can connect multiple wallets, session keys, or DIDs to the same vault.

### B. Dark Ledger is real accounting

The Dark Ledger is the operator's internal bank layer. It uses:

- **Double-entry bookkeeping** — every mutation has a debit and credit account
- **Idempotent operations** — every POST takes an `idempotency_key`
- **Pending vs settled states** — funds move through PENDING before AVAILABLE
- **Auditable receipts** — every ledger entry produces a signed receipt

### C. Privacy is a spectrum, not a checkbox

Each action gets a **privacy grade** shown in the UI:

| Grade | What leaks |
|-------|-----------|
| **Full** | Nothing on-chain links to user |
| **Deposit-visible** | Wallet visible at deposit time; unlinkable to withdrawals/deployments |
| **Destination-visible** | Recipient address visible at withdrawal |
| **Strategy-visible** | Deployment target visible (but not the depositor) |

### D. Custody is explicit

Two modes, honestly named:

- **Operator-Managed Vault** — operator holds notes, best privacy, simplest UX. This is custodial note management with privacy benefits. The operator can see balances but cannot link them to on-chain activity without the mapping.
- **Self-Custody Vault** — user holds notes (secrets, nullifiers). Maximum control, some correlation leakage since the user signs transactions directly.

---

## 2. Object Model

### VaultAccount

```
vault_id        UUID
owner_auth      list[AuthMethod]  # wallet pubkeys, session keys, DIDs
mode            OPERATOR_MANAGED | SELF_CUSTODY | HYBRID
risk_profile    RiskProfile
policy_bounds   PolicyBounds
tier            str               # reputation tier
created_at      timestamp
```

### Notes (commitments / positions)

Track these explicitly regardless of custody mode.

```
note_id             UUID
vault_id            FK → VaultAccount
rail_type           COMMITMENT_SHIELD | NULLIFIER_SET | HASHED_PROOF
commitment_hash     hex
nullifier_hash      hex | null
pool_address        hex
token               str
amount_wei          int
custody             OPERATOR_HELD | USER_HELD
status              OPEN | SPENT | SWEPT | WITHDRAWN
created_at          timestamp
spent_at            timestamp | null
```

### Ledger (double-entry)

**Accounts:**

```
VAULT_AVAILABLE:<vault_id>:<token>     # spendable balance
VAULT_PENDING:<vault_id>:<token>       # in-flight (deploy, withdraw)
OPERATOR_CUSTODY:<token>               # operator's on-chain holdings
STRATEGY_ESCROW:<adapter_id>:<token>   # deployed into adapters
FEES:<token>                           # protocol fees
WITHDRAWAL_CLEARING:<token>            # outbound transfers in transit
```

**Entries:**

```
entry_id        UUID
idempotency_key str (unique)
tx_type         DEPOSIT | DEPLOY | HARVEST | WITHDRAW | SWEEP | FEE
amount_wei      int
token           str
dr_account      str   # debit account
cr_account      str   # credit account
ref_tx_hash     hex | null
ref_event_idx   int | null
ref_commitment  hex | null
ref_proposal    hex | null
receipt_hash    hex   # H(entry_id, vault_id, token, amount, refs...)
created_at      timestamp
settled_at      timestamp | null
```

**Invariants:**

- Sum of all debits = sum of all credits (always)
- `VAULT_AVAILABLE` is never negative
- `VAULT_PENDING` is never negative
- Every outward transfer has a matching ledger debit
- `VAULT_AVAILABLE` is never credited until on-chain finality threshold is reached

### Strategy Positions

```
position_id     UUID
vault_id        FK → VaultAccount
adapter_id      hex (adapter contract address)
principal_wei   int
share           int (adapter-specific share units)
entry_price     int | null
harvest_state   dict
status          ACTIVE | CLOSING | CLOSED
proposal_hash   hex (the commit-reveal that created this)
created_at      timestamp
```

### Proposals (commit-reveal)

```
proposal_id     UUID
vault_id        FK → VaultAccount
proposal_hash   hex
salt            hex
adapters        list[hex]
amounts         list[int]
params          dict
status          CREATED → COMMITTED → EXECUTED → SETTLED | FAILED
commit_tx_hash  hex | null
execute_tx_hash hex | null
created_at      timestamp
committed_at    timestamp | null
executed_at     timestamp | null
```

### Withdrawals

```
withdrawal_id   UUID
vault_id        FK → VaultAccount
amount_wei      int
token           str
destination     hex (recipient address)
route           DIRECT_TRANSFER | VIA_PRIVACY_POOL | BATCHED
status          REQUESTED → APPROVED → SENT → CONFIRMED
tx_hash         hex | null
created_at      timestamp
confirmed_at    timestamp | null
```

---

## 3. Privacy & Trust Boundaries

### What the deposit actually exposes

Deposits signed by the user expose the wallet address on-chain. The privacy guarantee is:

> "No on-chain link between **vault balance** and **user wallet** for withdrawals/deployments, **unless the operator leaks the mapping**. The ledger itself is never on-chain."

This is **deposit-visible** privacy — the deposit is visible, everything after is dark.

### Stronger privacy: relayed deposits

For **full** privacy (user address never appears on-chain):

1. User funds an ephemeral deposit account or uses session keys + paymaster
2. Relayer submits the deposit tx on the user's behalf
3. User never appears on-chain

This is a future enhancement. For now, deposit-visible privacy is the honest claim.

### Operator custody reality

In Operator-Managed mode, the backend generates and holds note secrets. The operator can theoretically reconstruct and spend notes. To keep the "private" claim honest:

**Current state (v1):** Operator-managed is custodial note management. The operator cannot link vault balances to on-chain activity without the internal mapping, but the operator does hold the keys.

**Future (v2):** Client-side secret generation with WASM prover. Backend helps generate proofs without learning the secret. Operator holds commitments but not the preimages.

**Recovery mechanism:** Emergency "export encrypted note bundle" endpoint. The operator cannot lock the user out of their notes.

---

## 4. State Machines

### Deposit (Operator-Managed Mode)

```
deposit_requested
  │ create DepositIntent with idempotency_key
  │ choose deposit rail, generate calldata
  ▼
tx_submitted
  │ user signs + submits (or relayer submits)
  ▼
deposit_verified
  │ indexer confirms on-chain event + commitment
  │ finality threshold reached
  │
  │ Ledger:
  │   DR OPERATOR_CUSTODY:<token>        (operator now holds tokens)
  │   CR VAULT_AVAILABLE:<vault_id>:<token>  (user balance credited)
  │
  │ Create Note (custody=OPERATOR_HELD, status=OPEN)
  │ Create DepositReceipt (signed by operator key)
  ▼
deposit_settled
```

**Invariant:** Never credit VAULT_AVAILABLE until on-chain finality threshold is reached.

### Deploy from Dark Ledger (Commit-Reveal)

```
deploy_requested
  │ validate amount <= VAULT_AVAILABLE
  │ validate strategy within policy_bounds
  │
  │ Ledger:
  │   DR VAULT_AVAILABLE:<vault_id>:<token>
  │   CR VAULT_PENDING:<vault_id>:<token>
  │
  │ Create Proposal (status=CREATED)
  ▼
proposal_committed
  │ relayer submits commit_proposal(hash) on-chain
  │ Proposal status → COMMITTED
  ▼
  │ (MEV protection delay — 30s+)
  ▼
proposal_executed
  │ relayer submits execute_proposal(adapters, amounts, salt)
  │ on-chain: VaultController verifies hash, dispatches to adapter
  │ Proposal status → EXECUTED
  │
  │ Ledger:
  │   DR VAULT_PENDING:<vault_id>:<token>
  │   CR STRATEGY_ESCROW:<adapter_id>:<token>
  │
  │ Create/update StrategyPosition
  ▼
deploy_settled

--- on failure at any point: ---

deploy_failed
  │ Ledger:
  │   DR VAULT_PENDING:<vault_id>:<token>   (reverse)
  │   CR VAULT_AVAILABLE:<vault_id>:<token>  (return to user)
  │
  │ Proposal status → FAILED
```

**Invariant:** If commit or execute fails, funds return from PENDING to AVAILABLE.

### Withdraw (Dark Ledger)

```
withdraw_requested
  │ validate amount <= VAULT_AVAILABLE
  │
  │ Ledger:
  │   DR VAULT_AVAILABLE:<vault_id>:<token>
  │   CR VAULT_PENDING:<vault_id>:<token>
  │
  │ Create Withdrawal (status=REQUESTED)
  ▼
withdraw_approved
  │ policy checks pass (tier limits, cooldowns)
  │ Withdrawal status → APPROVED
  ▼
withdraw_sent
  │ relayer executes payout
  │ route = DIRECT_TRANSFER | VIA_PRIVACY_POOL
  │
  │ Ledger:
  │   DR VAULT_PENDING:<vault_id>:<token>
  │   CR OPERATOR_CUSTODY:<token>  (operator wallet sends)
  │
  │ Withdrawal status → SENT
  ▼
withdraw_confirmed
  │ on-chain confirmation received
  │ Withdrawal status → CONFIRMED
  │ Create WithdrawalReceipt (signed by operator key)
```

**Invariant:** Every outward transfer has a matching ledger debit.

### Sweep: Self-Custody → Dark Ledger

```
sweep_requested
  │ user provides note proof bundle (nullifier, root, proof_calldata)
  ▼
sweep_executed
  │ relayer executes withdrawal from privacy pool
  │ tokens land in operator wallet
  │
  │ Ledger:
  │   DR OPERATOR_CUSTODY:<token>
  │   CR VAULT_AVAILABLE:<vault_id>:<token>
  │
  │ Note status → SWEPT
  ▼
sweep_settled
```

### Sweep: Dark Ledger → Self-Custody

```
sweep_requested
  │ validate amount <= VAULT_AVAILABLE
  │
  │ Ledger:
  │   DR VAULT_AVAILABLE:<vault_id>:<token>
  │   CR OPERATOR_CUSTODY:<token>
  ▼
sweep_executed
  │ relayer deposits into privacy pool
  │ commitment returned to user
  │
  │ Create Note (custody=USER_HELD, status=OPEN)
  ▼
sweep_settled
```

---

## 5. Provability — Making the Dark Ledger Credible

Without provability, the Dark Ledger is "trust me bro accounting." These mechanisms make it verifiable.

### Signed Receipts (MVP)

Every ledger mutation emits a signed receipt:

```
receipt = {
  entry_id,
  vault_id,
  tx_type,
  amount_wei,
  token,
  dr_account,
  cr_account,
  refs: { tx_hash, commitment_hash, proposal_hash },
  timestamp,
}
receipt_hash = Poseidon(serialize(receipt))
signature = operator_key.sign(receipt_hash)
```

Receipts are stored and shown in the UI. Users can export their receipt bundle for independent verification.

### Daily Ledger Commitment Root (Proof of Liabilities)

Periodically compute and publish a Merkle root of all vault balances:

```
leaf_i = Poseidon(vault_id_i, token_i, balance_i, nonce_i)
root = MerkleRoot(leaf_0, leaf_1, ..., leaf_n)
```

Publish `root` to:
- On-chain `LedgerCommitment` contract (or existing Fact Registry)
- Timestamp + block number for anchoring

Users can request an **inclusion proof** for their balance:
- Operator provides Merkle path from their leaf to the published root
- User verifies their balance is included in the committed total
- If the operator publishes a root that doesn't include the user's correct balance, the user has cryptographic evidence of fraud

**Invariant:** Operator cannot silently change balances without it being detectable.

---

## 6. Services Layout

### Backend

| Service | Responsibility |
|---------|---------------|
| **VaultAccountService** | Create/manage VaultAccounts, auth methods, mode selection |
| **DepositIntentService** | Create deposit intent, choose rail, generate calldata, assign relayer route |
| **ChainIndexerService** | Watch pool events, extract commitment/nullifier, verify finality |
| **LedgerService (double-entry)** | `post_entry(dr, cr, amount, refs)`, `balance(vault_id, token)`, receipt generation |
| **VaultProposalService** | Build proposal hash + salt, validate against policy bounds |
| **VaultDeployService** | Orchestrate deploy lifecycle: intent → commit → execute → settle |
| **StrategyAccountingService** | Periodic harvest, mark-to-market, yield credit to vault |
| **WithdrawalService** | Withdrawal lifecycle: request → approve → send → confirm |
| **SweepService** | Self-custody ↔ Dark Ledger transitions |
| **ReceiptService** | Generate signed receipts, publish ledger commitment roots |
| **RelayerQueue** | `commit_proposal`, `execute_proposal`, `withdraw_note`, `payout` jobs |

### On-Chain (no changes needed)

| Contract | Role |
|----------|------|
| ConfidentialTransfer | Commitment Shield deposit rail |
| FullyShieldedPool | Nullifier Set / Hashed Proof deposit rail |
| VaultController | Commit-reveal capital deployment |
| IStrategyAdapter impls | Ekubo LP, Lending, Staking |

### Relayer/Operator

- Runs jobs from RelayerQueue
- Uses hot wallet with limits
- Produces signed receipts for every action
- Publishes daily ledger commitment roots

---

## 7. API Design

### Vault

```
POST /vault/create                    → { vault_id, mode }
GET  /vault/:id                       → { vault_id, mode, auth_methods }
GET  /vault/:id/balance               → { available, pending, deployed, by_token }
GET  /vault/:id/notes                 → list[Note]
GET  /vault/:id/positions             → list[StrategyPosition]
GET  /vault/:id/receipts              → list[Receipt]
```

### Deposit

```
POST /vault/deposit/intent            → { intent_id, calldata, relayer_instructions }
POST /vault/deposit/confirm           → { receipt, balance }
  body: { intent_id, tx_hash } OR auto-detected by indexer
```

### Deploy

```
POST /vault/deploy/intent             → { proposal_hash, salt, commit_params }
  body: { vault_id, strategy, amount, idempotency_key }
POST /vault/deploy/commit             → (relayer only) { commit_tx_hash }
POST /vault/deploy/execute            → (relayer only) { execute_tx_hash }
GET  /vault/deploy/:proposal_hash     → { status, commit_tx, execute_tx }
```

### Withdraw

```
POST /vault/withdraw/request          → { withdrawal_id, status }
  body: { vault_id, amount, token, destination, route, idempotency_key }
GET  /vault/withdraw/:id              → { status, tx_hash }
```

### Sweep

```
POST /sweep/to-ledger                 → { receipt, balance }
  body: { vault_id, note_id, proof_bundle }
POST /sweep/to-vault                  → { note_id, commitment, secrets }
  body: { vault_id, amount, target_rail }
```

### Provability

```
GET  /vault/:id/inclusion-proof       → { leaf, path, root, published_block }
GET  /ledger/commitment-root/latest   → { root, block, timestamp }
```

Every POST accepts `idempotency_key`. Auth via session key or wallet signature.

---

## 8. UI/UX

### Vault Screen — Two Balances, One Truth

```
┌──────────────────────────────────────────────┐
│  My Vault                          [Settings]│
│                                              │
│  Available (Dark Ledger)     12.45 STRK      │
│  Deployed                     8.20 STRK      │
│    ├ Ekubo LP (STRK/ETH)     5.00  [receipt] │
│    ├ Lending (Vesu)           2.00  [receipt] │
│    └ Staking                  1.20  [receipt] │
│                                              │
│  Self-Custody Notes              2 open      │
│    ├ Nullifier Set  3.00 STRK    [sweep|w/d] │
│    └ Commitment     1.50 STRK    [sweep|w/d] │
│                                              │
│  [Deposit]  [Deploy]  [Withdraw]             │
└──────────────────────────────────────────────┘
```

Each line item has:
- Privacy grade indicator (shield icon with tooltip: "What leaks?")
- Receipt link (for every deposit, deploy, withdraw)
- Action buttons (sweep, withdraw, harvest)

### Deposit Panel

- Mode toggle: **Operator-Managed** (best privacy) | **Self-Custody** (max control)
- Rail chooser collapsed under "Advanced" (most users don't need to pick)
- Privacy grade shown: "Your wallet is visible at deposit. Withdrawals and deployments are unlinkable."

### Withdraw Panel

- Source: Dark Ledger balance or specific self-custody note
- Route: Fast (direct) | Private (via pool / delayed / batched)
- Privacy grade shown per route

### Deploy

- AI deploy: uses signals + policy bounds, shows commit-reveal countdown
- Manual deploy: select adapter, amount, same commit-reveal flow
- Privacy grade: "Strategy visible on-chain, but not linked to your wallet"
