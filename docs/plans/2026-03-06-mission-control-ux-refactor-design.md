# Mission Control UX Refactor — Design Document

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Full frontend UX/UI refactor of the `/agent` surface + governance integration

---

## Problem Statement

The current agent page uses a 3-tab layout (Vault / Oracle / Brain) with 6+ sub-tabs per surface. Critical information is hidden behind navigation. Surfaces are siloed: the vault doesn't show deployed positions, the oracle's signals aren't actionable, the brain's agent controls don't enforce user constraints, and the pipeline's zkRAG output doesn't feed back into decision-making. Dark Ledger is a deposit method rather than a visible surface. The trade tab has broken limits and untested DCA. Lending doesn't reflect the FICO pack or risk passport. Staking isn't wired. Activity is broken. The autonomous agent runs without user-defined policies.

## Design

### Layout: Three-Column "Mission Control"

A single unified page where everything that matters is always visible. No tab-switching to find information.

```
┌──────────────┬────────────────────────────────┬──────────────┐
│              │                                │              │
│   CAPITAL    │       CENTER STAGE             │   CONTROL    │
│   LEDGER     │                                │   PLANE      │
│   (~320px)   │   (fluid)                      │   (~280px)   │
│              │                                │              │
│  - Vault     │   4 modes via toolbar:         │  - Agent     │
│  - Dark      │   1. Opportunity Feed          │    status    │
│    Ledger    │   2. Trade Desk                │  - Policy    │
│  - Deployed  │   3. Circuit Board             │  - Constraints│
│    Positions │   4. Pipeline Monitor          │  - Risk      │
│  - Health    │                                │    Passport  │
│              │                                │  - Session   │
│              │                                │  - Actions   │
│              │                                │              │
└──────────────┴────────────────────────────────┴──────────────┘
```

---

## Left Rail — Capital Ledger

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
- Click any position → opens details in Center Stage

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

## Center Stage — Intelligence + Execution

Main workspace with 4 modes accessible via a minimal icon toolbar at the top. Icons, not text tabs.

### Mode 1: Opportunity Feed (default)

Unified intelligence stream. One merged API replaces the current split between Oracle Signals, Radar, Genome.

**Data sources merged into one endpoint:**
- `strategies/opportunities` (pool/yield data)
- `strategies/recommend` (LLM recommendation with zkRAG context)
- `mainnet_oracle/recommendation` (market data signals)
- `zkgraph_client` (zkGraph intelligence)

**Card structure:**
```
┌────────────────────────────────────────────────────┐
│  ◆ Ekubo STRK/ETH LP           Source: zkRAG ⓘ   │
│  Expected APY: 11.4%   Risk: Low (0.18)           │
│  Confidence: 92%  │  3 proofs attested             │
│  ──────────────────────────────────────────────────│
│  Your passport: ✓ Tier 1 eligible                  │
│  Allocation fit: 35% of idle capital               │
│  ──────────────────────────────────────────────────│
│  [Deploy →]  [Add to Circuit Board]  [Dismiss]     │
└────────────────────────────────────────────────────┘
```

- **Deploy** opens an inline execution flow: amount → proof generation stepper → on-chain submit → receipt. Left Rail updates.
- **Add to Circuit Board** saves the opportunity as a node in the Circuit Board policy.
- Cards sorted by composite score: `confidence * apy_weight - risk_penalty + tier_bonus`.
- Filters: by venue (Ekubo, Lending Pools, Staking), by risk level, by source.

**Backend changes:**
- New `GET /api/v1/zkdefi/opportunities/feed` endpoint that merges oracle, zkRAG, and strategy data into one ranked list.

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

**Deleted:**
- Limits tab (replaced by limit order support in Trade Desk)
- Radar scatter chart (replaced by visualization in Opportunity Feed cards)

### Mode 3: Circuit Board (Deterministic Sandbox)

Replaces: Agent Composer form, zkML Models tab, `/marketplace` page.

Visual flow composer for building deterministic execution policies.

**Components:**
- **Circuit nodes:** From `circuit_scanner` (25+ compiled circuits) — RiskScore, AnomalyDetector, Solvency, Correlation, TWAP, CreditEligibility, Performance, etc.
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

**Backend integration:**
- `policy_compiler_service.py` — compiles Circuit Board flows into executable policies
- `constraint_gate.py` — gates execution against the active policy
- `execution_guard.py` — enforces policy during autonomous agent cycles
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
- [Apply to Feed] pushes recommendation into Opportunity Feed
- [Create Circuit Rule] opens Circuit Board with pre-filled nodes from the recommendation

**Agent Log:** Live stream of autonomous agent actions with decision explanations.
- Source: `orchestration_receipts.json` + `decision_events.json`
- Each entry shows: timestamp, policy rule triggered, circuit output, action taken, receipt link

---

## Right Rail — Control Plane

Always-visible agent controls and risk profile.

### Sections

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
- Rebalance frequency selector
- Strategy whitelist/blacklist
- [Edit Policy →] opens Circuit Board
- Source: New `GET/PUT /api/v1/vault/constraints/{address}`

**3. Risk Passport Summary**
- Current tier with icon and color
- FICO score from credit decision
- Proof count (e.g., 3/5) with progress dots
- Available credit line amount
- [View Full →] opens `/profile` page
- Source: `risk_passport/user/{address}`, `profile/decision`

**4. Session Key**
- Active key status and remaining duration
- Scope display (execute, read)
- [Revoke] action
- Source: `session_keys/list/{address}`

**5. Recent Actions**
- Last 5 actions with type, amount, receipt link, timestamp
- Proof verification status (L3 verified, pending, etc.)
- Source: `vault/activity/{address}` + `orchestration_receipts.json`

### Backend Changes

- New `GET/PUT /api/v1/vault/constraints/{address}` — save/load constraint preferences
- Fix `vault/activity/{address}` — wire to orchestration receipts and proof pipeline

---

## What Gets Deleted / Merged

| Current Component | Fate |
|-------------------|------|
| Vault tab | Left Rail (balances, positions) + Center Stage Trade Desk |
| Portfolio sub-tab | Left Rail (always visible) |
| Yield sub-tab | Left Rail (blended APY) + Opportunity Feed |
| Trade sub-tab | Center Stage Trade Desk mode |
| Lending sub-tab | Opportunity Feed (lending as venue) + Left Rail (lending position) |
| Staking sub-tab | Opportunity Feed (staking as venue) + Left Rail (staking position) |
| Activity sub-tab | Right Rail (recent actions) + Pipeline Monitor (full log) |
| Oracle tab (Signals) | Center Stage Opportunity Feed |
| Oracle tab (Radar) | Opportunity Feed cards with risk/yield visualization |
| Oracle tab (Genome) | Data layer within Opportunity Feed (not separate tab) |
| Brain tab (Agent Controls) | Right Rail Control Plane |
| Brain tab (zkML Models) | Center Stage Circuit Board |
| Brain tab (Pipeline) | Center Stage Pipeline Monitor |
| Brain tab (Agents) | Right Rail Agent Status + Circuit Board policies |
| Agent Composer form | Center Stage Circuit Board |
| `/marketplace` page | Center Stage Circuit Board |
| CapitalOSStrip | Deleted — information distributed across all three rails |
| VaultBanner | Notification bar at top of center stage |

---

## Component Map (New → Old)

| New Component | Replaces | Key Props |
|---------------|----------|-----------|
| `MissionControlLayout` | Agent page shell | Three-column responsive layout |
| `CapitalLedger` | VaultSurface + VaultTab | Vault, Dark Ledger, positions, health |
| `OpportunityFeed` | OracleSignalsTab + OracleRadarTab + OracleGenomeTab | Merged intelligence stream |
| `OpportunityCard` | Signal cards | Deploy action, circuit board link |
| `TradeDesk` | VaultTradeTab + DexPanel + DCAPanel | Chart, swap, LP, DCA, limits |
| `CircuitBoard` | ModelComposer + AgentDashboard + marketplace | React Flow canvas, policy save/load |
| `CircuitNode` | (new) | Draggable circuit with entity input |
| `ConditionalNode` | (new) | IF/ELSE threshold gate |
| `VenueNode` | (new) | Ekubo/Lending/Staking/Ledger output |
| `PipelineMonitor` | ProofTimeline + ZkRagAgentConsole | Proof queue, zkRAG, agent log |
| `ControlPlane` | BrainSurfaceContainer (partial) | Agent status, constraints, passport |
| `ConstraintPanel` | (new) | Risk tolerance, venue limits, frequency |
| `PassportSummary` | (new, from CreditReputationHub data) | Tier, FICO, proof count, credit line |
| `DepositSlideout` | DepositPanel | Overlay variant of existing deposit flow |
| `WithdrawSlideout` | WithdrawPanel | Overlay variant of existing withdraw flow |

---

## Backend Endpoint Changes

### New Endpoints

| Method | Path | Purpose | Service |
|--------|------|---------|---------|
| GET | `/api/v1/zkdefi/opportunities/feed` | Unified opportunity feed | New: merges oracle, zkRAG, strategies |
| GET | `/api/v1/vault/constraints/{address}` | Load user constraints | `constraint_gate` + `policy_engine` |
| PUT | `/api/v1/vault/constraints/{address}` | Save user constraints | `constraint_gate` + `policy_engine` |
| GET | `/api/v1/vault/policy/{address}` | Load active policy | `policy_engine` |
| PUT | `/api/v1/vault/policy/{address}` | Save policy from Circuit Board | `policy_compiler_service` |
| GET | `/api/v1/zkdefi/ledger/notes/{address}` | Dark Ledger note list | `note_store` |

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

### New Service

| Service | Purpose |
|---------|---------|
| `limit_order_service.py` | Limit order management via `ekubo/limit_orders_adapter` |
| `opportunity_feed_service.py` | Merges oracle + zkRAG + strategies into ranked feed |

---

## Frontend Dependencies (New)

| Package | Purpose | License |
|---------|---------|---------|
| `reactflow` | Circuit Board node-based editor | MIT |
| `lightweight-charts` | Trade Desk price charts | Apache 2.0 |
| `recharts` | Opportunity Feed risk/yield visualizations | MIT |

---

## Data Flow

```
                    ┌──────────────────────────────────────┐
                    │          OPPORTUNITY FEED             │
                    │   (merges all intelligence sources)   │
                    └──────────┬───────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌─────────────┐  ┌──────────────┐  ┌────────────┐
     │  mainnet     │  │   zkGraph    │  │ strategies │
     │  oracle      │  │   client     │  │ recommend  │
     └──────┬──────┘  └──────┬───────┘  └─────┬──────┘
            │                │                 │
            ▼                ▼                 ▼
     ┌──────────────────────────────────────────────┐
     │              opportunity_feed_service         │
     │    ranks, deduplicates, adds passport context │
     └──────────────────┬───────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   User Action    │
              │   [Deploy →]     │
              └────────┬─────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌───────────┐ ┌──────────┐ ┌───────────┐
   │ Circuit   │ │ policy   │ │ allocation│
   │ Board     │ │ engine   │ │ executor  │
   │ (if auto) │ │ gate     │ │           │
   └───────────┘ └──────────┘ └─────┬─────┘
                                    │
                              ┌─────┼─────┐
                              ▼     ▼     ▼
                         Ekubo  Lending  Staking
                          LP    Pools    Native
                              │
                              ▼
                    ┌──────────────────┐
                    │   Left Rail      │
                    │   updates live   │
                    └──────────────────┘
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

- `dao_governance.py` has 8 endpoints (create proposal, generate vote proof, cast vote, tally, execute, list proposals, get voting power) — **not mounted in `main.py`**
- `dao_voting_service.py` generates ZK proofs for private voting with quadratic voting power (`sqrt(lp_position_value)`) — working but uses mock voting power
- `vault_proposals.py` has commit-reveal for vault allocation proposals — **not mounted**
- `execution_guard.py` has `emergency_pause` as the first check in every pre-transaction gate — working
- `vault_policy_service.py` stores `emergency_pause` per user in `vault_policies.json` — working
- `DAOConstraintManager` contract exists as a compiled artifact but has no Cairo source in repo
- `private_vote` circuit is registered in `circuit_scanner` (category: governance)
- `/governance` frontend route doesn't exist; `/products/private-governance` links to it with a dead link
- `test_dao_proposal.sh` and `test_emergency_controls.sh` exist but 404 because routes aren't mounted

### Design

Governance is **not a separate page**. It lives inside Mission Control as a **fifth center-stage mode** and as a persistent **emergency stop** in the Control Plane (right rail).

### Right Rail Addition: Emergency Stop

The Control Plane gets a new top-priority section above Agent Status:

```
┌─────────────────────────────┐
│  CONTROL PLANE               │
├─────────────────────────────┤
│  ┌── Emergency ───────────┐ │
│  │  System: ● ACTIVE       │ │
│  │  [EMERGENCY STOP]       │ │
│  │  Pauses all execution   │ │
│  │  until you resume.      │ │
│  └─────────────────────────┘ │
│  ┌── Agent ───────────────┐ │
│  │  ...                    │ │
```

- **EMERGENCY STOP** button sets `emergency_pause: true` via `PUT /api/v1/vault/policy/{address}` on `execution_policy.emergency_pause`
- Immediately blocks all execution paths (rebalancer, vault_execute, privacy orchestrator, strategy workers) — the `execution_guard.check()` gate already enforces this
- Button turns red when paused; shows [RESUME EXECUTION] to clear
- No proposal or voting needed for your own vault's emergency stop — you own it

### Center Stage Mode 5: Governance

Accessible from the center-stage toolbar alongside Feed, Trade, Circuit Board, Pipeline.

```
┌─────────────────────────────────────────────────────────┐
│  GOVERNANCE                                              │
├─────────────────────────────────────────────────────────┤
│  ┌── Your Voting Power ──────────────────────────────┐  │
│  │  LP Position: 1.2 STRK in Ekubo + 2.0 staked     │  │
│  │  Reputation Tier: 1 (Express)                      │  │
│  │  Voting Power: 142 VP (√position × tier_mult)     │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌── Active Proposals ───────────────────────────────┐  │
│  │                                                    │  │
│  │  #3  Emergency Pause — Pool 0x3f..                │  │
│  │  Type: emergency_pause  │  Status: VOTING          │  │
│  │  Votes: 420 FOR / 180 AGAINST  │  Ends: 2h 14m    │  │
│  │  Your vote: ○ For  ○ Against  [Cast Vote →]       │  │
│  │  Vote is ZK-private: direction hidden, power       │  │
│  │  proven via Groth16 nullifier circuit              │  │
│  │                                                    │  │
│  │  #2  Whitelist Asset: wstETH                      │  │
│  │  Type: whitelist_asset  │  Status: PASSED          │  │
│  │  Result: 680 FOR / 120 AGAINST  │  [Execute →]    │  │
│  │                                                    │  │
│  │  #1  Set Adapter Limit: Ekubo max 60%             │  │
│  │  Type: adapter_limit  │  Status: EXECUTED          │  │
│  │  Result: 510 FOR / 290 AGAINST                     │  │
│  │                                                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌── Create Proposal ────────────────────────────────┐  │
│  │  Type: [emergency_pause ▾]                        │  │
│  │  Description: ___________________________________  │  │
│  │  Parameters:                                       │  │
│  │    Target: [pool / adapter / asset] ___            │  │
│  │    Value: ___                                      │  │
│  │  Voting period: 24h (default)                      │  │
│  │  [Submit Proposal]                                 │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Voting Power Calculation

Current implementation uses `sqrt(lp_position_value_usd)`. This needs to be extended:

```
voting_power = sqrt(lp_position + lending_supplied + staked_amount) × tier_multiplier
```

| Tier | Multiplier | Requirements |
|------|-----------|--------------|
| Tier 0 (Anon) | 1.0x | Connected wallet |
| Tier 1 (Express) | 1.5x | 2+ proofs completed |
| Tier 2 (Trusted) | 2.0x | 4+ proofs, collateral staked |

This means reputation directly amplifies governance weight. A Tier 2 user with the same capital has 2x the voting power of a Tier 0 user — rewarding proof participation and commitment to the protocol.

**Data sources:**
- LP positions: `vault/positions/{address}` (Ekubo LP value)
- Lending supplied: `lending_service.get_user_positions(address)`
- Staked amount: `staking/native_staking` position
- Tier: `reputation/user/{address}` → `tier_id`
- Tier multiplier: `reputation/tiers` → tier config

### Proposal Types

| Type | Purpose | Parameters | Execution |
|------|---------|------------|-----------|
| `emergency_pause` | Pause all execution for a pool or the whole system | `target` (pool_id or "system"), `reason` | Sets `emergency_pause: true` in `execution_guard` for all users interacting with that pool |
| `emergency_unpause` | Resume execution after emergency | `target` | Clears `emergency_pause` |
| `adapter_limit` | Cap allocation to a venue | `adapter` (ekubo, lending, staking), `max_pct` | Updates `DAOConstraintManager` on-chain; `policy_compiler_service` reads it |
| `whitelist_asset` | Allow a new token for strategies | `token_address`, `token_symbol` | Updates `token_allowlist` in global policy |
| `blacklist_asset` | Remove a token | `token_address`, `reason` | Removes from `token_allowlist` |

### Vote Privacy

Votes use the `private_vote` circuit (already registered in `circuit_scanner`):
- Vote direction is hidden (ZK-proven)
- Voting power is proven without revealing exact position
- Nullifier prevents double voting per proposal
- Tallied results are public and verifiable

The `dao_voting_service.py` currently uses a Poseidon-based mock. For production, it needs the actual `private_vote.wasm` and `private_vote_final.zkey` in `circuits/build/`. The mock is acceptable for the UI wiring phase.

### Backend Changes

| Change | Scope |
|--------|-------|
| Mount `dao_governance.py` in `main.py` at `/api/v1/dao` | 1 line in `main.py` |
| Update `_get_voting_power()` in `dao_voting_service.py` | Replace mock with real position query: sum LP + lending + staking, multiply by tier |
| Add system-wide emergency pause endpoint | New: `POST /api/v1/dao/emergency/pause` and `/unpause` that sets `emergency_pause` across all user policies |
| Mount `vault_proposals.py` in `main.py` | 1 line |

### Frontend Components

| Component | Purpose |
|-----------|---------|
| `EmergencyStop` | Right Rail button, calls `PUT /vault/policy/{address}` with `emergency_pause: true/false` |
| `GovernanceMode` | Center Stage mode 5: voting power display, proposal list, vote casting, proposal creation |
| `ProposalCard` | Single proposal with vote status, countdown, vote buttons |
| `VoteCaster` | ZK vote proof generation stepper: direction → proof → submit |
| `ProposalForm` | Create proposal form with type selector and parameter inputs |
| `VotingPowerBadge` | Compact badge showing VP and tier multiplier (also shown in Right Rail passport summary) |

### Updated Layout

```
┌──────────────┬────────────────────────────────┬──────────────┐
│              │                                │              │
│   CAPITAL    │       CENTER STAGE             │   CONTROL    │
│   LEDGER     │                                │   PLANE      │
│   (~320px)   │   (fluid)                      │   (~280px)   │
│              │                                │              │
│  - Vault     │   5 modes via toolbar:         │  - EMERGENCY │
│  - Dark      │   1. Opportunity Feed          │    STOP      │
│    Ledger    │   2. Trade Desk                │  - Agent     │
│  - Deployed  │   3. Circuit Board             │    status    │
│    Positions │   4. Pipeline Monitor          │  - Policy    │
│  - Health    │   5. Governance                │  - Constraints│
│              │                                │  - Risk      │
│              │                                │    Passport  │
│              │                                │    (+ VP)    │
│              │                                │  - Session   │
│              │                                │  - Actions   │
│              │                                │              │
└──────────────┴────────────────────────────────┴──────────────┘
```

### Updated Component Map Addition

| New Component | Replaces | Key Props |
|---------------|----------|-----------|
| `EmergencyStop` | (new) | `address`, `onPause`, `onResume` |
| `GovernanceMode` | (new, replaces dead `/governance` route) | Proposal list, vote casting, proposal creation |
| `ProposalCard` | (new) | Proposal data, vote status, countdown |
| `VoteCaster` | (new) | ZK proof generation for private vote |
| `ProposalForm` | (new) | Type selector, parameters, submit |
| `VotingPowerBadge` | (new) | VP amount, tier multiplier |

### Updated Deletion Table Addition

| Current | Fate |
|---------|------|
| `/governance` route (planned, never built) | **Replaced** by Center Stage Governance mode |
| `/products/private-governance` deep link | Update `deepLinkHref` to `/agent?mode=governance` |

---

## Migration Notes

- The existing `/agent` page remains the URL. The layout changes from tab-based to three-column.
- `/profile` page is untouched in this refactor (scoped separately).
- `/products` marketing pages continue to deep-link into the agent page; no changes needed.
- Components from the `ui-improvements` worktree (VaultSurface, OracleSurfaceContainer, etc.) are replaced by the new component tree.
- Existing deposit/withdraw proof logic is preserved — only the UI container changes from tab-panel to slide-out overlay.
