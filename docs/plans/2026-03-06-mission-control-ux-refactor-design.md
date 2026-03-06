# Mission Control UX Refactor -- Design Document

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Full frontend UX/UI refactor of the `/agent` surface + governance integration

---

## Problem Statement

The current agent page uses a 3-tab layout (Vault / Oracle / Brain) with 6+ sub-tabs per surface. Critical information is hidden behind navigation. Surfaces are siloed: the vault doesn't show deployed positions, the oracle's signals aren't actionable, the brain's agent controls don't enforce user constraints, and the pipeline's zkRAG output doesn't feed back into decision-making. Dark Ledger is a deposit method rather than a visible surface. The trade tab has broken limits and untested DCA. Lending doesn't reflect the FICO pack or risk passport. Staking isn't wired. Activity is broken. The autonomous agent runs without user-defined policies.

## Design

### Layout: Three-Column "Mission Control" + Header Strip

A single unified page where everything that matters is always visible. No tab-switching to find information.

```
HEADER STRIP
zkde.fi / Capital OS                                       Demo / Tier 2
Agent: zkde Capital Agent / STRC-8004        Gate: PASS / Proof Package: Ready

+------------------+--------------------------------------+------------------+
|                  |                                      |                  |
|   CAPITAL        |        CENTER STAGE                  |   CONTROL        |
|   LEDGER         |                                      |   PLANE          |
|   (~320px)       |   (fluid)                            |   (~280px)       |
|                  |                                      |                  |
|  - Vault         |   6 modes via toolbar:               |  - Emergency     |
|  - Dark          |   1. Execution Flow (home)           |    Stop          |
|    Ledger        |   2. Trade Desk                      |  - Agent         |
|  - Deployed      |   3. Circuit Board                   |    status        |
|    Positions     |   4. Pipeline Monitor                |  - Constraints   |
|  - Health        |   5. Governance                      |  - Risk          |
|                  |   6. (future)                        |    Passport      |
|                  |                                      |  - Session       |
|                  |   + Memory Lane (bottom of center)   |                  |
|                  |                                      |                  |
+------------------+--------------------------------------+------------------+
```

---

## Header Strip

Persistent thin bar across the top of the page. Identity and system context at a glance.

- **Left:** Brand + surface name (zkde.fi / Capital OS)
- **Center:** Active agent instance ID, gate status (PASS / BLOCKED / DEFERRED), proof package readiness
- **Right:** Network mode (Demo / Sepolia / Mainnet), user tier badge, wallet connect

Not a card or widget. A thin status bar. All detail lives in the three columns below it.

**Data sources:** `rebalancer/autonomous/status/{address}` (agent ID), `execution_guard.get_guard_status()` (gate), `proofs/stats` (proof package), `reputation/user/{address}` (tier)

---

## Left Rail -- Capital Ledger

Always-visible capital dashboard. Read-heavy, action-light.

### Sections

**1. Vault Balance**
- Total STRK, ETH, aggregated USD value
- Source: `vault_v2/{id}/balance` via `double_entry_ledger`
- Actions: [Deposit] [Withdraw] open slide-out panels

**2. Dark Ledger**
- Shielded note count and available sweep amount
- Privacy level indicator (L3-verified, commitment-shielded)
- Source: `note_store.get_notes()`, new endpoint via `ledger.py`
- Actions: [Import] creates shielded note via `full_privacy/deposit/generate_commitment`; [Sweep to Vault] calls `sweep_service.sweep_to_vault()`

**3. Deployed Capital**
- Live positions across venues:
  - Ekubo LP: amount, APY, status
  - Lending (native pools): supplied amount, APY, health factor
  - Staking: staked amount, APY
  - Idle capital remaining
- Blended APY across all deployed capital
- Source: `vault/positions/{address}` wired to `real_pool_aggregator`; `private-yield/yield/blended`
- Click any position opens details in Center Stage

**4. Health**
- Privacy coverage percentage (commitment count)
- Collateral ratio (from lending positions)
- Tier status with progress bar to next tier
- Source: `risk_passport/user/{address}`, `reputation/user/{address}`

### Deposit/Withdraw Panels

Slide-out overlays from the right edge. Keep 4 deposit methods (Commitment Shield, Nullifier Set, Hashed Proof, Dark Ledger). Each shows a proof stepper with clear step states. On completion, vault balance updates in real-time via polling or WebSocket.

### Backend Changes

- Mount `vault_v2.py` in `main.py` at `/api/v2/vault`
- Mount `ledger.py` in `main.py` at `/api/v1/zkdefi/ledger`
- Add `GET /api/v1/zkdefi/ledger/notes/{address}` endpoint for Dark Ledger note list
- Wire `vault/positions/{address}` to `real_pool_aggregator` for live Ekubo/LP data

---

## Center Stage -- Execution Flow + Workbenches

Main workspace. A minimal icon toolbar at the top selects the active mode. The default view is the **Execution Flow** -- the live pipeline that shows what the agent is doing right now. The other modes are workbenches you visit to do something specific.

### Mode 1: Execution Flow (default home)

This is the core of the product. It shows the live decision pipeline as an interactive state machine, not scattered cards. Below it, Memory Lane shows the historical record.

The mental model:

```
Current state -> Current decision -> Historical trust
```

The page rhythm:

```
TOP:     Capital State + Agent (Left Rail)  |  Execution Flow (Center)  |  Control Plane (Right Rail)
BOTTOM:  Memory Lane / Hash Obsqra (center-column scrollable)
```

#### Execution Flow -- Interactive State Machine

Each step is a collapsible section. Steps show status (Complete, Pending, Waiting for Approval, Failed, Skipped). In Assisted mode, the flow pauses at Strategy Selection for user approval before Execution fires.

```
EXECUTION FLOW

[1] INTENT           Complete
    Rotate 12% idle stable capital into low-vol yield
    Source: Scheduled window / assisted mode
    User Scope: Approved
    [ Expand ]

[2] POLICY           Complete
    Moderate risk / 0.50% slippage / 35% max exposure
    Privacy Mode: Private Flow Allowed
    Policy Version: v0.8.4
    [ Expand ]

[3] PROOF PACKAGE    Complete
    Policy Hash       0x7af...91d
    Constraint Hash   0x33c...e21
    Receipt Root      0x928...ab2
    [ Expand ] [ Inspect Proof Set ] [ View Gate Logic ]

[4] AGENT            Complete
    zkde Capital Agent / STRC-8004
    Trust Score: 84    Mode: Assisted
    [ Expand ]

[5] STRATEGY         Complete
    Selected:  Stable Yield Basket         Score 91
    Rejected:  Delta Neutral ETH (76) / Liquid Rotation (82)
    Reason: best fit under active policy + capital availability
    [ Compare Candidates ]

[6] EXECUTION        Complete
    Amount Routed:  $29,000
    Route:          Vault -> Agent -> Adapter -> Strategy
    Slippage:       0.18%
    Result:         Executed within policy
    [ Expand ]

[7] RECEIPT          Confirmed
    RCPT-2026-03-06-1542-01
    Outcome: trust +0.6 / exposure delta +11.7% / slippage 0.18%
    [ View Full Receipt ] [ Export JSON ] [ Anchor ] [ Compare ]
```

**Step states:**

| State | Meaning | UI |
|-------|---------|-----|
| Complete | Step finished successfully | Green check, collapsed by default |
| Pending | Step is processing | Spinner, expanded |
| Waiting for Approval | Paused for user input (Assisted mode) | Amber pulse, expanded, shows action buttons |
| Failed | Step failed a gate check | Red, expanded, shows reason |
| Skipped | Step not applicable | Gray, collapsed |
| Deferred | Agent chose not to act | Amber, shows reason |

**Assisted mode interaction at step [5]:**

When the agent is in Assisted mode, step [5] STRATEGY pauses with "Waiting for Approval":

```
[5] STRATEGY         Waiting for Approval
    Candidate A:  Stable Yield Basket         Score 91   [Select]
    Candidate B:  Delta Neutral ETH           Score 76   [Select]
    Candidate C:  Liquid Rotation             Score 82   [Select]
    Recommended:  Stable Yield Basket
    Reason: best fit under active policy + capital availability
    [ Approve Recommended ] [ Reject All ] [ Edit Scope ]
```

In Autonomous mode, step [5] auto-completes and [6] fires immediately.

**Data sources per step:**

| Step | Backend Source |
|------|---------------|
| Intent | `rebalancer/proposals/{address}` or user-initiated action |
| Policy | `vault_policy_service.get_policy()` -- risk budget, strategy permissions, execution policy |
| Proof Package | `constraint_hash_service`, `policy_compiler_service` -- hashes; `proofs/` -- proof artifacts |
| Agent | `rebalancer/autonomous/status/{address}` -- agent instance, trust score from `reputation/user` |
| Strategy | `strategies/recommend` -- candidates with scores; `opportunity_feed_service` -- ranked list |
| Execution | `allocation_executor` -- routing; `contract_executor` -- on-chain result |
| Receipt | `receipt_service` -- receipt ID, hashes, deltas; `orchestration_receipts.json` |

#### Memory Lane / Hash Obsqra

Below the Execution Flow. Date-grouped receipt timeline with 3 detail levels.

**Level 1 -- Compact row (default):**

```
[time] [type] [strategy] [gate status] [trust delta]
```

**Level 2 -- Expanded summary (click Expand):**

Shows Intent, Policy, Agent, Strategy, Execution result, all hashes, outcome deltas inline.

**Level 3 -- Full forensic receipt (click View Full Receipt):**

Dedicated drawer with: receipt ID, timestamp, actor/agent ID, vault source, target strategy, policy version, all hash references, execution path, proof package references, portfolio state deltas, exported JSON, raw record.

**Timeline structure:**

```
HASH OBSQRA / MEMORY LANE

TODAY -- MAR 6, 2026                           2 confirmed / 1 warning

3:42 PM  Rebalance Confirmed  Stable Yield Basket  Trust +0.6  [>]
2:17 PM  Policy Updated       Agent Policy v0.8.4  Trust +0.1  [>]
11:09 AM Gate Warning         Delta Neutral ETH    No Exec     [>]

YESTERDAY -- MAR 5, 2026                       1 confirmed / 1 defer

6:03 PM  Deposit Confirmed    Main Vault           Trust +0.2  [>]
1:21 PM  Rebalance Deferred   Exposure Limit Hit   Trust +0.0  [>]

[ Load older receipts ] [ Filter: All|Gate|Execute|Deposit|Warning ]
[ Search Receipt ID ]
```

Each date header shows summary stats: `Mar 6, 2026  3 receipts  1 warning  trust +0.7`

**Backend sources:**
- `orchestration_receipts.json` -- primary receipt store
- `decision_events.json` -- gate decisions, warnings, deferrals
- `receipt_service` -- receipt IDs, hashes
- `vault/activity/{address}` -- deposits, withdrawals
- `reputation/user/{address}` -- trust score deltas

**Backend changes:**
- New `GET /api/v1/zkdefi/receipts/timeline/{address}?from=&to=&type=&limit=` -- unified timeline endpoint merging receipts, decisions, activity, and trust deltas into date-grouped response
- New `GET /api/v1/zkdefi/receipts/{receipt_id}` -- full forensic receipt (Level 3)
- New `GET /api/v1/zkdefi/execution/current/{address}` -- current execution flow state (which step is active, step data for each completed step)

### Mode 2: Trade Desk

Single-pane trading view replacing the current Trade sub-tab.

**Layout:**
- Chart area using `lightweight-charts` (TradingView open-source) for STRK/ETH candles
- Order panel: token pair selector, amount, route (Ekubo), slippage, execute
- Sub-modes: [Swap] [LP] [DCA]

**Fixes:**
- Swap: Already working via Ekubo. Add `lightweight-charts` for price visualization using `dex/price/{base}/{quote}/history`.
- LP: Show current LP positions from Left Rail. Add/remove liquidity with proof receipts.
- DCA: Fix USDC-only constraint. Support STRK/ETH pairs. Wire to `vault/dca/schedule`.
- Limit orders: Wire to `ekubo/limit_orders_adapter`. Use `bot_limit_orders.json` schema for order storage. New `limit_order_service.py`.

**Trade actions generate receipts.** Every swap, LP add/remove, DCA execution produces a receipt that appears in Memory Lane. The Execution Flow shows the trade pipeline (Intent -> Policy gate check -> Execution -> Receipt) in a compact form for manual trades.

### Mode 3: Circuit Board (Deterministic Sandbox)

Replaces: Agent Composer form, zkML Models tab, `/marketplace` page.

Visual flow composer for building deterministic execution policies.

**Components:**
- **Circuit nodes:** From `circuit_scanner` (25+ compiled circuits) -- RiskScore, AnomalyDetector, Solvency, Correlation, TWAP, CreditEligibility, Performance, etc.
- **Entity inputs:** Wallet, Asset, Pool, LP Position, Contract, Strategy
- **Conditional nodes:** IF/ELSE based on circuit output thresholds
- **Venue outputs:** Ekubo LP, Lending Pools (native), Staking, Dark Ledger, Reject/Alert

**How it works:**
1. Drag a circuit onto the canvas (e.g., RiskScore)
2. Connect an entity input (e.g., asset: STRK/ETH pool)
3. Add a conditional (e.g., IF score < 0.3)
4. Connect to a venue output (e.g., deploy 35% via Ekubo LP adapter)
5. Save as a named policy (e.g., "Conservative Yield")
6. The autonomous agent enforces this policy on its check cycle

Saved policies are what the Execution Flow's step [2] POLICY references. When step [5] STRATEGY evaluates candidates, it runs them through the Circuit Board's logic. This is the bridge between the sandbox and live execution.

**Backend integration:**
- `policy_compiler_service.py` -- compiles Circuit Board flows into executable policies
- `constraint_gate.py` -- gates execution against the active policy
- `execution_guard.py` -- enforces policy during autonomous agent cycles
- New `GET/PUT /api/v1/vault/policy/{address}` for saving/loading policies

**Rendering:**
- Use React Flow (open-source node-based flow editor) for the canvas
- Circuit metadata from `proofs/models` endpoint
- Save/load via policy engine

### Mode 4: Pipeline Monitor

Live system visibility. Replaces the buried Pipeline tab.

**Sections:**

**Proof Queue:** Live list of proof generation, verification status, L3/L2 settlement.
- Source: `proofs/` endpoint + `l3_proving_path_client`

**zkRAG Console:** Existing `ZkRagAgentConsole` with two new output actions:
- [Apply to Feed] pushes recommendation into the Execution Flow as a new Intent
- [Create Circuit Rule] opens Circuit Board with pre-filled nodes from the recommendation

**Agent Log:** Live stream of autonomous agent actions with decision explanations.
- Source: `orchestration_receipts.json` + `decision_events.json`
- Each entry shows: timestamp, policy rule triggered, circuit output, action taken, receipt link

### Mode 5: Governance

See Governance Surface section below.

---

## Right Rail -- Control Plane

Always-visible agent controls and risk profile.

### Sections

**0. Emergency Stop** (top priority, always first)
- System status: ACTIVE or PAUSED
- [EMERGENCY STOP] button -- sets `emergency_pause: true` via `PUT /vault/policy/{address}`
- Immediately blocks all execution paths (rebalancer, vault_execute, privacy orchestrator, strategy workers)
- Button turns red when paused; shows [RESUME EXECUTION] to clear
- No proposal needed for your own vault -- you own it

**1. Agent Status**
- Running / Paused / Stopped indicator
- Active policy name (links to Circuit Board)
- Last action timestamp
- Next scheduled check
- [Pause] [Stop] [Resume] controls
- Source: `rebalancer/autonomous/status/{address}`

**2. Constraints**
- Risk tolerance slider (maps to `constraint_gate` thresholds)
- Max allocation per venue (Ekubo %, Lending %, Staking %, Idle %)
- Max slippage, drawdown guard, exposure limit per strategy
- Rebalance frequency selector
- Strategy whitelist/blacklist
- Privacy mode: Public / Private Flow Allowed / Full Privacy
- [Edit Policy] opens Circuit Board
- Source: New `GET/PUT /api/v1/vault/constraints/{address}`

**3. Risk Passport Summary**
- Current tier with icon and color
- Trust score (from reputation system)
- FICO score from credit decision
- Proof count (e.g., 3/5) with progress dots
- Voting power (from governance)
- Available credit line amount
- [View Full] opens `/profile` page
- Source: `risk_passport/user/{address}`, `profile/decision`, `dao/voting_power/{address}`

**4. Session Key**
- Active key status and remaining duration
- Scope display (execute, read)
- [Revoke] action
- Source: `session_keys/list/{address}`

### Backend Changes

- New `GET/PUT /api/v1/vault/constraints/{address}` -- save/load constraint preferences

---

## What Gets Deleted / Merged

| Current Component | Fate |
|-------------------|------|
| Vault tab | Left Rail (balances, positions) + Center Stage Trade Desk |
| Portfolio sub-tab | Left Rail (always visible) |
| Yield sub-tab | Left Rail (blended APY) + Execution Flow |
| Trade sub-tab | Center Stage Trade Desk mode |
| Lending sub-tab | Execution Flow (lending as venue) + Left Rail (lending position) |
| Staking sub-tab | Execution Flow (staking as venue) + Left Rail (staking position) |
| Activity sub-tab | Memory Lane (replaces scattered activity) |
| Oracle tab (Signals) | Execution Flow strategy candidates |
| Oracle tab (Radar) | Execution Flow strategy scoring |
| Oracle tab (Genome) | Data layer within Execution Flow |
| Brain tab (Agent Controls) | Right Rail Control Plane |
| Brain tab (zkML Models) | Center Stage Circuit Board |
| Brain tab (Pipeline) | Center Stage Pipeline Monitor |
| Brain tab (Agents) | Right Rail Agent Status + Circuit Board policies |
| Agent Composer form | Center Stage Circuit Board |
| `/marketplace` page | Center Stage Circuit Board |
| CapitalOSStrip | Replaced by Header Strip |
| VaultBanner | Absorbed into Header Strip gate status |
| ProofTimeline | Replaced by Memory Lane (3-level receipt system) |
| OracleSignalsTab / OracleRadarTab / OracleGenomeTab | All merged into Execution Flow |
| Scattered wallet/identity/privacy/intent/gate/proof cards | Unified into Execution Flow steps |

---

## Component Map

| New Component | Replaces | Purpose |
|---------------|----------|---------|
| `MissionControlLayout` | Agent page shell | Header strip + three-column responsive layout |
| `HeaderStrip` | CapitalOSStrip + VaultBanner | Agent ID, gate status, proof package, tier, wallet |
| `CapitalLedger` | VaultSurface + VaultTab | Vault, Dark Ledger, deployed positions, health |
| `ExecutionFlow` | (new) | 7-step interactive state machine |
| `ExecutionStep` | (new) | Collapsible step with status indicator |
| `MemoryLane` | ActivityTab + ProofTimeline | Date-grouped receipt timeline, 3 detail levels |
| `ReceiptRow` | (new) | Level 1 compact receipt |
| `ReceiptDetail` | (new) | Level 2 expanded summary |
| `ReceiptDrawer` | (new) | Level 3 full forensic receipt |
| `TradeDesk` | VaultTradeTab + DexPanel + DCAPanel | Chart, swap, LP, DCA, limits |
| `CircuitBoard` | ModelComposer + AgentDashboard + marketplace | React Flow canvas, policy save/load |
| `CircuitNode` | (new) | Draggable circuit with entity input |
| `ConditionalNode` | (new) | IF/ELSE threshold gate |
| `VenueNode` | (new) | Ekubo/Lending/Staking/Ledger output |
| `PipelineMonitor` | ProofTimeline + ZkRagAgentConsole | Proof queue, zkRAG, agent log |
| `ControlPlane` | BrainSurfaceContainer (partial) | Emergency stop, agent, constraints, passport |
| `EmergencyStop` | (new) | Emergency pause/resume for execution guard |
| `ConstraintPanel` | (new) | Risk tolerance, venue limits, privacy mode |
| `PassportSummary` | (new, from CreditReputationHub data) | Tier, trust, FICO, proof count, VP, credit line |
| `GovernanceMode` | (new, replaces dead `/governance` route) | Proposals, voting, voting power |
| `ProposalCard` | (new) | Proposal with vote status, countdown, actions |
| `VoteCaster` | (new) | ZK vote proof generation stepper |
| `ProposalForm` | (new) | Proposal creation with type/params |
| `VotingPowerBadge` | (new) | VP amount + tier multiplier |
| `DepositSlideout` | DepositPanel | Overlay variant of existing deposit flow |
| `WithdrawSlideout` | WithdrawPanel | Overlay variant of existing withdraw flow |

---

## Backend Endpoint Changes

### New Endpoints

| Method | Path | Purpose | Service |
|--------|------|---------|---------|
| GET | `/api/v1/zkdefi/execution/current/{address}` | Current execution flow state | New: assembles step data from multiple services |
| GET | `/api/v1/zkdefi/receipts/timeline/{address}` | Memory Lane timeline | New: merges receipts, decisions, activity, trust deltas |
| GET | `/api/v1/zkdefi/receipts/{receipt_id}` | Full forensic receipt (Level 3) | `receipt_service` |
| GET | `/api/v1/zkdefi/opportunities/feed` | Unified opportunity feed | New: merges oracle, zkRAG, strategies |
| GET | `/api/v1/vault/constraints/{address}` | Load user constraints | `constraint_gate` + `policy_engine` |
| PUT | `/api/v1/vault/constraints/{address}` | Save user constraints | `constraint_gate` + `policy_engine` |
| GET | `/api/v1/vault/policy/{address}` | Load active policy | `policy_engine` |
| PUT | `/api/v1/vault/policy/{address}` | Save policy from Circuit Board | `policy_compiler_service` |
| GET | `/api/v1/zkdefi/ledger/notes/{address}` | Dark Ledger note list | `note_store` |
| POST | `/api/v1/dao/emergency/pause` | System-wide emergency pause | Sets `emergency_pause` across all policies |
| POST | `/api/v1/dao/emergency/unpause` | System-wide emergency unpause | Clears `emergency_pause` |

### Mount Existing (Currently Orphaned)

| Route File | Mount Path | Purpose |
|------------|------------|---------|
| `vault_v2.py` | `/api/v2/vault` | Double-entry ledger, note store, sweep, deploy lifecycle |
| `ledger.py` | `/api/v1/zkdefi/ledger` | Ledger transfers, demo credit |
| `dao_governance.py` | `/api/v1/dao` | Proposals, voting, tally, execute |
| `vault_proposals.py` | `/api/v1/zkdefi/vault/proposals` | Commit-reveal vault allocation proposals |

### Fix Existing

| Endpoint | Issue | Fix |
|----------|-------|-----|
| `vault/positions/{address}` | Returns empty | Wire to `real_pool_aggregator` for live Ekubo data |
| `vault/activity/{address}` | Broken | Merge orchestration receipts + proof pipeline output |
| `mainnet_oracle/*` | Stale data | Add periodic background sync task |
| Staking | No routes | Mount staking endpoints from `staking/native_staking.py` |
| `dao_voting_service._get_voting_power()` | Returns mock 10000 | Query real positions: LP + lending + staking, apply tier multiplier |

### New Services

| Service | Purpose |
|---------|---------|
| `limit_order_service.py` | Limit order management via `ekubo/limit_orders_adapter` |
| `opportunity_feed_service.py` | Merges oracle + zkRAG + strategies into ranked feed |
| `execution_flow_service.py` | Assembles current execution state from multiple services |
| `receipt_timeline_service.py` | Merges receipts, decisions, activity into date-grouped timeline |

---

## Frontend Dependencies (New)

| Package | Purpose | License |
|---------|---------|---------|
| `reactflow` | Circuit Board node-based editor | MIT |
| `lightweight-charts` | Trade Desk price charts | Apache 2.0 |
| `recharts` | Risk/yield visualizations | MIT |

---

## Data Flow

```
Intent (user or agent)
  |
  v
Policy (vault_policy_service -> execution_guard)
  |
  v
Proof Package (constraint_hash + policy_hash + receipt_root)
  |
  v
Agent (autonomous_agent or user-assisted)
  |
  v
Strategy Selection (opportunity_feed_service -> candidates scored by Circuit Board logic)
  |
  v
Execution (allocation_executor -> contract_executor -> Ekubo/Lending/Staking)
  |
  v
Receipt (receipt_service -> Memory Lane)
  |
  v
Trust Delta (reputation update)
```

---

## Venue Clarification

| Venue | Type | Implementation |
|-------|------|----------------|
| **Ekubo LP** | External DEX | `ekubo_client`, `ekubo_execution_service`, `ekubo_lp_service` |
| **Lending Pools** | Native (our pools) | `lending_service.py`, `LendingPool` contract, `collateral_service` |
| **Staking** | Native | `staking/native_staking.py` |
| **Dark Ledger** | Native (privacy) | `note_store`, `full_privacy_proof_service`, `merkle_tree_service` |

Vesu is **not included**. All lending references in pool aggregator and LLM engine fallbacks should be updated to reference native lending pools.

---

## Governance Surface

### Problem

Governance is fully implemented in the backend but completely disconnected from the UI:

- `dao_governance.py` has 8 endpoints (create proposal, generate vote proof, cast vote, tally, execute, list proposals, get voting power) -- **not mounted in `main.py`**
- `dao_voting_service.py` generates ZK proofs for private voting with quadratic voting power (`sqrt(lp_position_value)`) -- working but uses mock voting power
- `vault_proposals.py` has commit-reveal for vault allocation proposals -- **not mounted**
- `execution_guard.py` has `emergency_pause` as the first check in every pre-transaction gate -- working
- `vault_policy_service.py` stores `emergency_pause` per user in `vault_policies.json` -- working
- `DAOConstraintManager` contract exists as a compiled artifact but has no Cairo source in repo
- `private_vote` circuit is registered in `circuit_scanner` (category: governance)
- `/governance` frontend route doesn't exist; `/products/private-governance` links to it with a dead link
- `test_dao_proposal.sh` and `test_emergency_controls.sh` exist but 404 because routes aren't mounted

### Design

Governance is **not a separate page**. It lives inside Mission Control as center-stage mode 5, and the Emergency Stop lives persistently in the Control Plane (right rail, section 0).

### Center Stage Mode 5: Governance

Accessible from the center-stage toolbar alongside Execution Flow, Trade, Circuit Board, Pipeline.

```
GOVERNANCE

-- Your Voting Power --
LP Position: 1.2 STRK in Ekubo + 2.0 staked
Reputation Tier: 1 (Express)
Voting Power: 142 VP (sqrt(position) x tier_mult)

-- Active Proposals --

#3  Emergency Pause -- Pool 0x3f..
Type: emergency_pause  |  Status: VOTING
Votes: 420 FOR / 180 AGAINST  |  Ends: 2h 14m
Your vote: ( ) For  ( ) Against  [Cast Vote]
Vote is ZK-private: direction hidden, power proven via Groth16 nullifier circuit

#2  Whitelist Asset: wstETH
Type: whitelist_asset  |  Status: PASSED
Result: 680 FOR / 120 AGAINST  |  [Execute]

#1  Set Adapter Limit: Ekubo max 60%
Type: adapter_limit  |  Status: EXECUTED
Result: 510 FOR / 290 AGAINST

-- Create Proposal --
Type: [emergency_pause v]
Description: ___
Parameters:
  Target: [pool / adapter / asset] ___
  Value: ___
Voting period: 24h (default)
[Submit Proposal]
```

### Voting Power Calculation

Current implementation uses `sqrt(lp_position_value_usd)`. Extended formula:

```
voting_power = sqrt(lp_position + lending_supplied + staked_amount) x tier_multiplier
```

| Tier | Multiplier | Requirements |
|------|-----------|--------------|
| Tier 0 (Anon) | 1.0x | Connected wallet |
| Tier 1 (Express) | 1.5x | 2+ proofs completed |
| Tier 2 (Trusted) | 2.0x | 4+ proofs, collateral staked |

Reputation directly amplifies governance weight. A Tier 2 user with the same capital has 2x the voting power of a Tier 0 user.

**Data sources:**
- LP positions: `vault/positions/{address}` (Ekubo LP value)
- Lending supplied: `lending_service.get_user_positions(address)`
- Staked amount: `staking/native_staking` position
- Tier: `reputation/user/{address}` -> `tier_id`
- Tier multiplier: `reputation/tiers` -> tier config

### Proposal Types

| Type | Purpose | Parameters | Execution |
|------|---------|------------|-----------|
| `emergency_pause` | Pause all execution for a pool or the whole system | `target` (pool_id or "system"), `reason` | Sets `emergency_pause: true` in `execution_guard` for all users |
| `emergency_unpause` | Resume execution after emergency | `target` | Clears `emergency_pause` |
| `adapter_limit` | Cap allocation to a venue | `adapter` (ekubo, lending, staking), `max_pct` | Updates `DAOConstraintManager` on-chain |
| `whitelist_asset` | Allow a new token for strategies | `token_address`, `token_symbol` | Updates `token_allowlist` in global policy |
| `blacklist_asset` | Remove a token | `token_address`, `reason` | Removes from `token_allowlist` |

### Vote Privacy

Votes use the `private_vote` circuit (already registered in `circuit_scanner`):
- Vote direction is hidden (ZK-proven)
- Voting power is proven without revealing exact position
- Nullifier prevents double voting per proposal
- Tallied results are public and verifiable

The `dao_voting_service.py` currently uses a Poseidon-based mock. For production, it needs the actual `private_vote.wasm` and `private_vote_final.zkey` in `circuits/build/`. The mock is acceptable for the UI wiring phase.

### Governance Backend Changes

| Change | Scope |
|--------|-------|
| Mount `dao_governance.py` in `main.py` at `/api/v1/dao` | 1 line in `main.py` |
| Update `_get_voting_power()` in `dao_voting_service.py` | Replace mock with real position query: sum LP + lending + staking, multiply by tier |
| Mount `vault_proposals.py` in `main.py` | 1 line |

---

## Migration Notes

- The existing `/agent` page remains the URL. The layout changes from tab-based to three-column.
- `/profile` page is untouched in this refactor (scoped separately).
- `/products` marketing pages continue to deep-link into the agent page; update `/products/private-governance` to link to `/agent?mode=governance`.
- Components from the `ui-improvements` worktree (VaultSurface, OracleSurfaceContainer, etc.) are replaced by the new component tree.
- Existing deposit/withdraw proof logic is preserved -- only the UI container changes from tab-panel to slide-out overlay.

---

## Labels

Use these labels consistently across the UI:

- **Intent** -- what user or agent wanted
- **Policy** -- what rules constrained the action
- **Proof Package** -- what hashes/proofs were formed
- **Agent** -- which agent instance acted
- **Strategy Selection** -- which candidates were considered and why one won
- **Execution** -- what actually happened
- **Receipt** -- what was recorded
- **Memory Lane** -- historical trust record
