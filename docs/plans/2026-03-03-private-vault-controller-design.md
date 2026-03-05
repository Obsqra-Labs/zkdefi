# Private Vault Controller -- Design Document

**Date:** 2026-03-03  
**Author:** Obsqra Labs  
**Status:** Approved

---

## Problem

Users deposit privately into the privacy pools (ConfidentialTransfer, FullyShieldedPool) via ZK proofs. But the moment capital is deployed to yield sources (Ekubo LP, lending, staking), the user's wallet signs the transaction directly. An on-chain observer can link: wallet deposited here, then traded there. The private deposit is meaningless if deployment is public.

Additionally, risk buckets (conservative/balanced/aggressive) are hardcoded allocation percentages with no intelligent data, no zkML integration, and no on-chain constraint enforcement. The AI recommends but nothing prevents it from exceeding what users authorized.

## Solution

A three-layer architecture that preserves privacy from deposit through yield and back to withdrawal. Users interact only with the privacy layer. A VaultController contract aggregates capital and deploys to yield sources via pluggable StrategyAdapters. Individual users are cryptographically invisible at the execution layer.

The IStrategyAdapter interface is an open composability primitive. Any protocol can build an adapter to plug into the obsqra privacy vault and inherit privacy, constraint enforcement, and dark pool execution for free.

---

## Architecture

### Layer 1: Privacy Pools (Existing, Deployed)

No changes required. These contracts are proven and deployed on Sepolia:

- **ConfidentialTransfer** (`0x07fdc7...`) -- commitment_shield tier. Pedersen commitments, Groth16 verified deposit/withdraw.
- **FullyShieldedPool** (`0x03dde5...`) -- nullifier_set and hashed_proof tiers. Merkle tree + nullifiers, selective disclosure, partial withdrawals, relayer support.
- **MerkleTree** (`0x03659c...`) -- Root management. Backend syncs BN254 Poseidon roots via add_known_root.
- **Dark Ledger** -- Off-chain accounting for dark_ledger tier.
- **Garaga Verifiers** -- PrivateDeposit, PrivateWithdraw, FullPrivacyWithdraw. On-chain Groth16 verification.

### Layer 2: VaultController (New Contract)

Sits between privacy pools and yield sources. Holds aggregate capital. Deploys to approved StrategyAdapters. Enforces constraints on every allocation.

**State:**

- `adapters: Map<ContractAddress, AdapterConfig>` -- approved adapters with max_allocation_bps, enabled flag, circuit_breaker
- `policy_root: felt252` -- Merkle root of all user constraint hashes
- `last_rebalance_ts: u64` -- cooldown enforcement
- `min_cooldown_seconds: u64` -- minimum time between rebalances
- `pending_proposal: felt252` -- committed proposal hash (dark pool)
- `proposal_block: u64` -- block of commit
- `admin: ContractAddress` -- multi-sig for adapter management
- `zkml_verifier: ContractAddress` -- deployed zkml_verifier.cairo

**Core functions:**

- `register_constraint(constraint_hash, commitment)` -- per-user constraint registration
- `update_policy_root(new_root, proof)` -- aggregate policy update
- `commit_proposal(proposal_hash)` -- phase 1 of dark pool execution
- `execute_proposal(adapters, amounts, params, salt, constraint_proof, risk_proof)` -- phase 2: verify and execute
- `emergency_withdraw(adapter)` -- admin-only circuit breaker
- `total_value() -> u256` -- aggregate vault value across all adapters

**Verification on execute_proposal:**

1. `Poseidon(adapters, amounts, params, salt) == pending_proposal` -- matches commit
2. `verify_merkle_proof(constraint_proof, policy_root)` -- constraints satisfied
3. `zkml_verifier.verify(risk_proof)` -- risk score within bounds
4. Per-adapter: `amount <= total_value * adapter.max_allocation_bps / 10000`
5. `block_timestamp - last_rebalance_ts >= min_cooldown_seconds`
6. Each adapter: `adapter.enabled && !adapter.circuit_breaker`

**Privacy model for constraint registration:** Constraint policies are global per session key / account, not per deposit commitment. The on-chain `register_constraint` stores `constraint_hash` keyed by the session key address, not by deposit commitment. The association between a specific deposit commitment and a user's constraint policy exists only off-chain in the backend's policy registry. This prevents on-chain correlation between deposit commitments and policy updates.

### Layer 3: Strategy Adapters (New Contracts, Pluggable)

Every yield source implements the IStrategyAdapter interface:

```cairo
trait IStrategyAdapter {
    fn deploy(ref self, amount: u256, params: Span<felt252>) -> felt252;
    fn withdraw(ref self, position_id: felt252, amount: u256) -> u256;
    fn harvest(ref self) -> u256;
    fn value_of(self: @ContractState) -> u256;
    fn current_apy_bps(self: @ContractState) -> u32;
    fn is_healthy(self: @ContractState) -> bool;
}
```

Each adapter only accepts calls from the VaultController (assert caller == vault_controller).

**First-party adapters (Obsqra builds):**

| Adapter | Wraps | deploy() | harvest() |
|---------|-------|----------|-----------|
| EkuboLpAdapter | Ekubo Positions | mint_and_deposit | collect_fees |
| LendingAdapter | LendingPool | supply | read accrued interest |
| StakingAdapter | Starknet staking | delegate | claim_rewards |

**Third-party adapters (anyone builds):**

The IStrategyAdapter interface is an open composability primitive. Any protocol can build an adapter. They inherit privacy (users invisible), constraint enforcement (AI bounded), and dark pool execution (MEV protected) for free.

**Third-party adapter onboarding:** New adapters start at max_allocation_bps = 500 (5%) with a 7-day probation. Two tiers: "Verified" (Obsqra audited/owned) and "Community" (whitelisted with caps + time-delayed enable). Requires admin multi-sig to whitelist.

---

## Constraint Engine

Three composable layers form the on-chain constraint boundary.

### Layer A: Constraint Hash (per-user)

Set during onboarding. Stored on VaultController keyed by session key address (not by deposit commitment -- see privacy model above).

```
constraint_hash = Poseidon(
    max_position_wei,
    risk_tolerance,
    approved_adapters_mask,
    max_single_adapter_pct,
    cooldown_seconds,
    session_duration_hours
)
```

**Asymmetric timelock:** Tightening constraints (lower risk, fewer strategies) takes effect immediately. Loosening constraints (higher risk, more strategies) has a 24-hour delay. Prevents "got phished, attacker escalates policy instantly."

### Layer B: Policy Registry (aggregate)

Backend compiles all active constraint hashes into a Merkle tree. Root anchored on-chain:

```
policy_root = MerkleRoot(all active constraint_hashes)
```

Allocation proposals include a Merkle proof that each affected user's constraints are satisfied. Verified on-chain.

### Layer C: zkML Risk Verification

Existing infrastructure (RiskScore.circom, zkml_risk_service, zkml_verifier.cairo):

1. AI generates allocation proposal
2. Backend computes risk features for proposed portfolio
3. RiskScore circuit produces Groth16 proof: risk_score <= aggregate_bound
4. Proof submitted with proposal
5. zkml_verifier verifies on-chain
6. VaultController rejects if proof invalid

---

## Dark Pool Execution

Allocation proposals use commit-reveal to prevent front-running.

**Phase 1 -- COMMIT (block N):**
AI generates proposal. proposal_hash = Poseidon(adapters, amounts, params, salt). VaultController.commit_proposal(proposal_hash). On-chain: only the hash is visible.

**Phase 2 -- REVEAL + EXECUTE (block N+1 or later):**
VaultController.execute_proposal reveals data and proofs. Contract verifies hash matches commit, all proofs valid, bounds respected. Calls each adapter.

Between commit and reveal, trade intent is hidden. MEV bots cannot front-run.

---

## User Journey

1. **Connect Wallet** -- ArgentX, Braavos via StarknetProvider
2. **Onboarding** (existing 7-step wizard) -- constraints, claims, proof, risk disclosure. NEW: Vault Constitution step computes constraint_hash and registers on VaultController.
3. **Profile** (existing 4 tabs) -- NEW: Vault Constitution card, Execution Authority card.
4. **Deposit** (existing DepositPanel) -- pick privacy tier, deposit into privacy pool. Backend registers commitment + constraint association (off-chain only).
5. **AI Allocation** (backend) -- zkML evaluates pools, strategy engine generates proposal, constraint gate pre-validates, proposal committed on-chain (hash only).
6. **Execution** (VaultController) -- verify proofs, call adapters, positions created. Only VaultController address visible on-chain.
7. **Yield Accrual** -- adapters earn yield, VaultController harvests, backend tracks per-user share.
8. **Withdraw** (existing WithdrawPanel) -- ZK proof, tokens released, VaultController rebalances remaining.

---

## UI State Model

The frontend must track and display these states to prevent UX ambiguity during normal operation and incidents.

| State Domain | Values | UI Effect |
|--------------|--------|-----------|
| Vault State | `ACTIVE`, `COOLDOWN`, `PENDING_REBALANCE`, `PAUSED`, `EMERGENCY` | Header badge color, action availability |
| Proofs State | `OK`, `WARNING`, `FAIL` (per proof type) | Proofs pill in header |
| Adapter State | `HEALTHY`, `DEGRADED`, `CIRCUIT_BREAKER`, `DISABLED` | Per-adapter health dot |
| Pending Proposal | `NONE`, `COMMITTED`, `EXECUTABLE`, `EXPIRED` | Next Rebalance strip |

---

## UI Surfaces and Data Contracts

### Surface Changes

| Area | Change |
|------|--------|
| Profile Trust tab | Add Vault Constitution card + Execution Authority card |
| DepositPanel | Register constraint association (off-chain) after deposit |
| VaultSurface header | Add Proofs pill (expandable) |
| VaultSurface below tabs | Add Vault Health Meter strip |
| YieldTab deploy section | "Deploy Capital" routes through VaultController |
| Yield Sources table | APY from adapter, health dots, verified badges |
| PositionsOverview | Capital Flow Pipeline (Wallet -> Shield -> Vault -> Strategies) |
| ActivityTab | Plain-language AI rebalance events with verification badges |

### New Frontend Data Contracts

**VaultControllerState** (new hook: `useVaultController`)
- vault_state: ACTIVE | COOLDOWN | PENDING_REBALANCE | PAUSED | EMERGENCY
- cooldown_remaining_seconds: number
- pending_proposal_exists: boolean
- last_rebalance_ts: ISO timestamp

**AdapterRegistry** (new hook: `useAdapterRegistry`)
- adapters[]: { name, address, type (first-party | community), health, apy_bps, value, max_allocation_bps }

**ActivityFeed** (extend existing)
- chain events: commit, execute, emergency_withdraw
- backend events: "AI proposed rebalance", "risk score computed", "harvest completed"
- Each event: timestamp, plain-language message, verification badges array

**UserVaultView** (extend `usePrivacyVault`)
- shielded_balance, deployed_balance, idle_balance
- user_policy_snapshot: { risk_level, max_per_strategy, allowed_strategies[], cooldown }

---

## Required UI Elements

### 1. Execution Authority Card (non-negotiable)

Displayed on vault page and in Profile. Eliminates "AI is stealing my funds" anxiety.

```
Execution Authority
---
Session Key:       Enabled (expires in 30d) / Disabled
Vault Controller:  Active / Paused
Admin Breaker:     Multisig 3/5 (emergency-only)
Relayer:           Enabled (shielded withdrawals)
```

### 2. Proofs Pill (header)

Default collapsed: "Proofs OK" (green). Expanded:
- Policy enforced (check or X)
- Risk within bound (check or X)
- MEV protection active (check or X)

### 3. Next Rebalance Strip

```
Status:    Pending (MEV protected) | Cooldown (4h remaining) | Ready
Reason:    APY +1.2% / Risk -0.08 / Adapter health change
Earliest:  in 4h (cooldown)
```

### 4. Capital Flow Drawers

Each balance in the pipeline opens a drawer:
- **Shielded:** deposit receipts, privacy tier, withdraw CTA
- **Deployed:** strategy positions (human names), yield contributions, unwind rules
- **Idle:** why idle (cooldown/policy cap), how to change ("Update Constitution")

### 5. Failure State Banners

| Color | Trigger | Message |
|-------|---------|---------|
| Yellow | Adapter degraded | "Strategy health degraded -- rebalancing when cooldown ends" |
| Red | Circuit breaker | "Emergency: capital returning to vault from [strategy]" |
| Gray | Policy blocks | "Rebalance blocked -- your constitution prevents the required move" |
| Blue | Proposal committed | "Rebalance pending... protected from front-running" |

---

## UX Principles (Non-negotiable)

### No Technical Jargon in UI

| Backend Concept | UI Name |
|-----------------|---------|
| Privacy Pools | Shield |
| VaultController | Vault |
| StrategyAdapters | Strategies |
| constraint_hash | Vault Constitution |
| policy_root, Merkle proof, nullifier | (never shown) |
| commit_proposal | "Rebalance pending... (protected from front-running)" |
| execute_proposal | "Rebalance executed. No trade intent was exposed." |

### Vault Constitution

Presented during onboarding and editable from Profile. Shows risk level, max per strategy, allowed strategies, cooldown in plain language. Hash computation is invisible.

### Shared Vault Messaging

Repeated throughout: "Funds are pooled for execution efficiency. Your ownership remains private and provable."

### Adapter Safety

First-party visually separated. Health dots. "Verified by Obsqra" badge. Third-party behind advanced toggle (default off). Verification badges on every execution.

### UX Acceptance Criteria

- [ ] No hash, root, nullifier, or proof calldata ever displayed to user
- [ ] Vault Constitution editable in plain language; hash invisible
- [ ] Capital Flow Pipeline with clickable drawers (shielded/deployed/idle)
- [ ] Execution Authority card visible on vault page and profile
- [ ] Proofs pill in header with three expandable checks
- [ ] Failure banners appear within 5 seconds of state change
- [ ] Next Rebalance strip with status, reason, countdown
- [ ] Activity log uses plain language with verification badges
- [ ] Third-party adapters hidden by default behind advanced toggle

---

## What Already Exists vs What's New

### Exists (no changes)

Privacy pool contracts, Garaga verifiers, onboarding wizard, profile page, deposit/withdraw panels, zkML risk scoring, strategy recommendation engine, private yield service, Ekubo integration, lending pool, staking, constraint gate, vault policy service.

### New

| Component | Type | Effort |
|-----------|------|--------|
| VaultController | Cairo contract | Medium |
| EkuboLpAdapter | Cairo contract | Small |
| LendingAdapter | Cairo contract | Small |
| StakingAdapter | Cairo contract | Small |
| IStrategyAdapter spec + docs | Documentation | Small |
| Vault Constitution component | Frontend | Small-Medium |
| Execution Authority card | Frontend | Small |
| Proofs pill | Frontend | Small |
| Capital Flow Pipeline + drawers | Frontend | Small-Medium |
| Vault Health Meter | Frontend | Small |
| Next Rebalance strip | Frontend | Small |
| Failure state banners | Frontend | Small |
| useVaultController hook | Frontend data contract | Small |
| useAdapterRegistry hook | Frontend data contract | Small |
| Proposal commit-reveal service | Backend | Small |
| Constraint hash service | Backend | Small |
| Vault proposal API routes | Backend | Small |

---

## Security Considerations

- VaultController admin: 3/5 multi-sig with 1 hardware wallet required signer.
- Adapter whitelisting prevents rogue adapters. New community adapters: 5% cap, 7-day probation.
- Circuit breaker for emergency withdrawal from compromised protocols.
- Cooldown prevents rapid rebalancing for price manipulation.
- zkML proof verification bounds AI behavior.
- Constraint Merkle proofs prevent policy violations.
- Commit-reveal prevents front-running (1-block minimum delay).
- Asymmetric timelock: tightening immediate, loosening 24h delay.
- Constraint-commitment association is off-chain only; no on-chain deposit-to-policy correlation.

---

## Resolved Design Decisions

### 1. Admin key management

3/5 multi-sig, 1 hardware wallet required signer. Keys split across team + trusted advisor. Admin can only: enable/disable adapters, circuit breaker, emergency withdraw. Cannot modify user policies or access funds.

### 2. Adapter audit process

Verified (Obsqra audited): no extra caps. Community (whitelisted): 5% max allocation, 7-day probation, admin multi-sig to whitelist.

### 3. Fee model (v1)

Performance fee on realized yield (10-20%) to protocol treasury / risk pool. Optional per-rebalance proof fee (tiny) for prover infra. Fee parameters set by admin multi-sig, visible in Vault Constitution.

### 4. BTC timeline

Future adapter example only. No roadmap dependency. When strkBTC is available, BtcYieldAdapter is straightforward.

### 5. Policy update timelock

Asymmetric. Tightening: immediate. Loosening: 24-hour delay. Prevents phishing escalation attacks.
