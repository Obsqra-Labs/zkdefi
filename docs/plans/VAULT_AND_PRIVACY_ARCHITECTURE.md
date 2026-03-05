# Vault and privacy architecture: current vs intended

**Summary:** Today privacy tiers route to **different shared pools** (Full Privacy Pool vs Shielded Pool). The intended model is **one user vault** with programmatic privacy at deposit/withdraw, then optional allocation to a **shared pool (Track B)** for the AI. You do **not** need a separate pool per privacy tier.

---

## Current state (why "my deposit" can feel wrong)

### Where "fund your agent vault" goes today

1. User chooses a **privacy preset** (unlinkable_basic, hidden_flow, hashed_claims) and amount.
2. Backend **compiles a route** and picks an **execution_path**:
   - `full_privacy_pool` → **FullyShieldedPool** (one shared contract)
   - `shielded_pool` → **ConfidentialTransfer** (different shared contract)
   - `internal_ledger` → blocked in v1
3. User signs:
   - Full privacy: `approve(STRK, pool)` + **pool.deposit_u256(commitment, amount)** on FullyShieldedPool.
   - Shielded: `approve(STRK, ct)` + **ConfidentialTransfer.private_deposit_u256(...)**.

So "fund your agent vault" today = **put tokens into one of two shared pools**, depending on policy/preset. There is **no per-user vault contract**. What's "yours" is:

- **Commitments** in the backend Merkle tree + localStorage (and on-chain leaves in the pool's Merkle tree for full_privacy).
- **Balance** is the pool's token balance; your share is only implied by your commitments and proofs.

If the preset/policy flips the execution_path (e.g. full_privacy vs shielded), **deposits go to a different contract**. Withdrawals must then go from that same contract. So:

- **You do not need a pool per privacy tier** for correctness; you need **consistent routing**: same pool for deposit and withdraw for a given "vault" or path.
- The real issue today is **one shared pool (e.g. FullyShieldedPool) holds everyone's full-privacy deposits**. Pool balance = sum of all users' deposits minus all withdrawals. If that pool was never funded enough, or deposits went to the other pool (ConfidentialTransfer), you get "pool has insufficient balance" even though *you* deposited.

---

## Intended model (your description)

- **Track A – User vault**
  "Fund your agent vault" = funds go into **the user's own vault** (one logical vault per user).
  **Privacy is programmatic** at deposit and withdraw (unlinkability, proofs, relayer if needed).
  **No separate pool per tier**; one vault, one place, with configurable privacy semantics.

- **Track B – Shared pool**
  From the user's vault, they can **optionally** move funds into a **shared pool** that the **AI can deploy and manage** (yield, strategies, etc.).
  So: **User Vault (Track A) → (optional) Shared Pool (Track B)**.

Implications:

1. **One logical "user vault"** (per user), not multiple pools chosen by tier.
2. **Privacy** = how deposit/withdraw are proven and relayed (ZK, relayer, disclosure), not "which pool contract."
3. **Shared pool** = optional second step for AI-managed deployment, not the first destination of "fund my vault."

---

## Current vs intended (side by side)

| Aspect | Current | Intended |
|--------|--------|----------|
| "Fund your agent vault" | Tokens go to one of two **shared** pools (FullyShieldedPool or ConfidentialTransfer) by execution_path. | Tokens go to **user's vault** (one per user). |
| Privacy tiers | Map to **different** execution_paths → **different** contracts. | **One** vault; privacy = programmatic deposit/withdraw (proofs, relayer, etc.). |
| Pools per tier | Effectively one pool per path (full_privacy vs shielded). | **No** pool per tier; one vault with privacy semantics. |
| AI / "Track B" | Agent uses positions/state that ultimately reference those shared pools. | User vault first; **optional** allocation from vault → **shared pool** that AI deploys and manages. |

---

## What needs to change (direction only)

- **Single user-vault abstraction**
  Either one contract per user vault, or one shared contract with per-user accounting (e.g. internal ledger), so "fund your agent vault" always credits **that user's vault**, regardless of privacy preset.

- **Privacy as semantics, not routing**
  Preset/tier chooses **how** deposit/withdraw are done (which proofs, relayer or not), not **which pool** receives the funds. Same vault balance, different privacy "flavor."

- **Track B explicit**
  A separate, optional step: "Move X from my vault into the shared pool (Track B) for the AI to deploy." That shared pool is then the AI's deployment target; the user vault remains the source of truth for "my funds."

This doc is the **architecture intent**. Implementation can be phased (e.g. first unify routing so one pool backs "full privacy" for your product, then introduce a clear user-vault + Track B model).

---

## Frontend unification (Track A / Track B)

Phase 1 unification is **presentation and copy** only: no contract or backend routing change. The UI presents **one vault (Track A)** with multiple **privacy modes** (Full privacy, Shielded, Hashed claims), plus an explicit **Track B** entry point for the shared pool the AI manages.

**Inspiration — obsqra.fi:** At obsqra.fi, user deposits go to a single **PoolController**; after each deposit, `_autoDeployToStrategy()` sends idle funds to a StrategyRouter (Aave/Lido/Compound). AI manages via allocation weights, AIRecommendationCommitment (commit-then-execute), and AutoRebalancer. So "deposit into the pool the AI manages" = one pool, then AI steers deployment. **Contrast:** zkdefi keeps **Track A (user vault)** as the primary destination; **Track B (shared pool)** is an optional second step. "Fund your agent vault" = Track A; "Allocate to shared pool" = optional Track B for AI-managed yield and strategies.

**Frontend principles:**

- **Track A:** "Fund your vault" and "Withdraw from your vault" are the main flows. Privacy preset selects **how** (proof type, relayer), not **where**. Route labels: "Vault (Full privacy)", "Vault (Shielded)", etc.
- **Track B:** Explicit CTA: "Allocate to shared pool — Let the AI manage yield and strategies." SharedPoolManagerPanel / SharedPoolMemberPanel and ExecutionControlRail's "Shared pool X" are labeled as Track B.

---

## Implementation checklist

Use this list to keep frontend work aligned with the architecture:

| Area | Components / files |
|------|--------------------|
| Copy (Track A = one vault) | VaultFundingCard, UnifiedWithdrawCard, VaultOverviewPanel, ExecutionControlRail, VaultPolicyStudio, ActivityLog, agent page summary cards |
| Track B entry point | Agent Dashboard (Vault tab): Track B card/link; Strategies tab: one line + link; SharedPoolManagerPanel, SharedPoolMemberPanel: Track B header |
| Types | Track A / Track B constants (e.g. vaultTracks or types) used in ExecutionControlRail, VaultOverviewPanel, Track B CTA |
| Backend | Policy compiler / ADR: document execution_path = Track A privacy semantics; shared_pool_id = Track B (comment only) |
| Docs | This file: Frontend unification section, obsqra.fi reference, this checklist |
