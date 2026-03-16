# Mission Control: Unified Stream Architecture

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Full frontend UX/UI refactor of the `/agent` surface + governance + dual lending model

---

## Problem Statement

The current agent page uses a 3-tab layout (Vault / Oracle / Brain) with 6+ sub-tabs per surface. Critical information is hidden behind navigation. Surfaces are siloed: the vault doesn't show deployed positions, the oracle's signals aren't actionable, the brain's agent controls don't enforce user constraints, and the pipeline's zkRAG output doesn't feed back into decision-making. Dark Ledger is a deposit method rather than a visible surface. The trade tab has broken limits and untested DCA. Lending doesn't reflect the FICO pack or risk passport. Staking isn't wired. Activity is broken. The autonomous agent runs without user-defined policies and uses hardcoded demo positions instead of real portfolio data. Receipts are in-memory only and lost on every restart. Strategy recommendations are hardcoded to the same two Ekubo pools. Three Oracle sub-tabs all call the same dead endpoint and render it three different ways.

---

## Design

### Architecture: Three-Column Layout + Live Intelligence Stream

A single unified page where everything that matters is always visible. No tab-switching to find information. The center column is a live chronological feed of all system activity -- agent decisions, opportunities, receipts, privacy events, governance alerts. Three overlay workbenches (Deploy, Circuit Board, Governance) slide up when focused work is needed.

```
HEADER STRIP (thin, persistent)
zkde.fi / Capital OS          Agent: STRC-8004 / PASS         Sepolia / Tier 2

+------------------+--------------------------------------+------------------+
|                  |                                      |                  |
|   CAPITAL        |        UNIFIED STREAM                |   CONTROL        |
|   LEDGER         |                                      |   PLANE          |
|   (~300px)       |   Chronological feed of:             |   (~280px)       |
|                  |   - Execution receipts               |                  |
|  Vault Balance   |   - Agent decisions                  |  Emergency Stop  |
|  Dark Ledger     |   - Opportunities (actionable)       |  Agent Status    |
|    (L3 Madara)   |   - Policy events                    |  Constraints     |
|  Deployed        |   - Privacy events                   |  Risk Passport   |
|    Capital       |   - Governance alerts                |  Session Key     |
|  Health          |   - System events (proofs, L3)       |                  |
|                  |   - Lending events                   |                  |
|                  |   - Staking events                   |                  |
+------------------+--------------------------------------+------------------+

OVERLAY WORKBENCHES (slide up over center column when invoked):
  1. Deploy: Swap | LP | Lend/Borrow | Stake | DCA | Limits
  2. Circuit Board: React Flow deterministic policy composer (full-width)
  3. Governance: DAO proposals + ZK-private voting
```

---

## Header Strip

Persistent thin bar across the top. Identity and system context at a glance.

- **Left:** Brand + surface name (zkde.fi / Capital OS)
- **Center:** Active agent instance ID, gate status (PASS / BLOCKED / DEFERRED), proof package readiness
- **Right:** Network mode (Demo / Sepolia / Mainnet), user tier badge, wallet connect, [Deploy] shortcut, [Circuit Board] shortcut

Not a card or widget. A thin status bar.

**Data sources:**
- `rebalancer/autonomous/status/{address}` (agent ID)
- `execution_guard.get_guard_status()` (gate)
- `proofs/stats` (proof package)
- `reputation/user/{address}` (tier)

---

## Left Rail -- Capital Ledger

Always-visible capital dashboard. Read-heavy, action-light.

### Sections

**1. Vault Balance**
- Total STRK, ETH, aggregated USD value
- Source: `vault_v2/{id}/balance` via `double_entry_ledger`
- Actions: [Deposit] [Withdraw] open slide-out panels

**2. Dark Ledger (L3 Madara)**
- Shielded note count and available sweep amount
- Privacy level indicator (L3-verified, commitment-shielded)
- L3 settlement status: Madara Appchain block number
- Source: `note_store.get_notes()`, `l3_proving_path_client` for L3 status
- Actions: [Import to Ledger] creates shielded note via `full_privacy/deposit/generate_commitment` routed through L3; [Sweep to Vault] calls `sweep_service.sweep_to_vault()`

**3. Deployed Capital**
- Live positions across all venues:
  - Ekubo LP: amount, APY, status
  - Lending (native pools): supplied amount, APY, health factor
  - Staking: staked amount, APR
  - Idle capital remaining
- Blended APY across all deployed capital
- Source: `vault/positions/{address}` wired to `real_pool_aggregator`; `lending_service`; `native_staking`; `private-yield/yield/blended`
- Click any position opens Deploy overlay with that position's details

**4. Health**
- Tier status with progress bar to next tier
- Trust score (from reputation system)
- Privacy coverage percentage (commitment count / total positions)
- Collateral ratio (from lending positions)
- Source: `risk_passport/user/{address}`, `reputation/user/{address}`

### Deposit/Withdraw Panels

Slide-out overlays from the right edge. 4 deposit methods (Commitment Shield, Nullifier Set, Hashed Proof, Dark Ledger Import). Each shows a proof stepper with clear step states. On completion, vault balance updates and a Privacy Event card appears in the stream.

### Backend Changes

- Mount `vault_v2.py` in `main.py` at `/api/v2/vault`
- Mount `ledger.py` in `main.py` at `/api/v1/zkdefi/ledger`
- Add `GET /api/v1/zkdefi/ledger/notes/{address}` endpoint for Dark Ledger note list with L3 status
- Wire `vault/positions/{address}` to `real_pool_aggregator` + `lending_service` + `native_staking` for live data

---

## Center Stage -- Unified Stream

The main workspace. A live reverse-chronological feed of all system activity. Each item is an interactive card that can be collapsed (one line) or expanded (full proof chain detail).

### 9 Feed Item Types

| Type | Source | Example | Actions |
|------|--------|---------|---------|
| Execution Receipt | `receipt_service` + `orchestration_receipts.json` | Rebalanced $29K into Stable Yield Basket -- trust +0.6 | [Inspect Proof Chain] [Export JSON] |
| Agent Decision | `decision_events.json` + rebalancer | Agent deferred: exposure limit hit on Delta Neutral ETH | [Override] [Adjust Limit] |
| Opportunity | `opportunity_feed_service` | Ekubo STRK/ETH LP -- 27.5% APY, risk score 0.22 | [Deploy via Trade] [Create Rule] |
| Policy Event | `execution_guard` + `vault_policy_service` | Gate blocked: slippage exceeded 0.50% threshold | [View Policy] [Edit in Circuit Board] |
| Privacy Event | `full_privacy_proof_service` + `l3_proving_path_client` | Commitment shielded via L3 -- Groth16 verified, Merkle root updated | [Inspect Proof] [View on L3] |
| Governance Alert | `dao_governance` | Proposal #4: Set lending rate to 3.2% -- 6h remaining | [Open Governance] |
| System Event | `proof_pipeline` + `l3_proving_path_client` | STARK proof settled on L3 -- tx 0x7af...91d | [View L3 Explorer] |
| Lending Event | `lending_service` | Supplied 500 STRK to Pool A -- 4.1% APY / Health: 1.82 | [Manage Position] [Borrow Against] |
| Staking Event | `native_staking` | Delegated 1,200 STRK -- 4.5% APR | [Manage Stake] [Claim Rewards] |

### Expanded Card -- Proof Chain View

When any Execution Receipt card is expanded, it shows the full decision pipeline:

```
EXECUTION RECEIPT                                    3:42 PM
Rebalanced $29,000 into Stable Yield Basket

Intent:      Rotate 12% idle stable capital
Policy:      Moderate risk / 0.50% slippage          Hash: 0x7af...91d
Proof:       Constraint + Policy + Receipt Root      [Inspect Set]
Agent:       STRC-8004 / Trust 84 / Assisted
Strategy:    Stable Yield Basket (score 91)
Execution:   Vault -> Agent -> Adapter -> Ekubo LP   Slip: 0.18%
Receipt:     RCPT-2026-03-06-1542-01                 [Export JSON]
Privacy:     Public Flow
L3 Anchor:   0x928...ab2                             [View on L3]
Trust Delta: +0.6
```

### Stream Controls

- Date grouping: TODAY, YESTERDAY, etc. with summary stats per day
- Filters: All | Receipts | Decisions | Opportunities | Privacy | Governance
- Search by receipt ID
- [Load older] pagination

### Data Sources Per Step

| Step | Backend Source |
|------|---------------|
| Intent | `rebalancer/proposals/{address}` or user-initiated action |
| Policy | `vault_policy_service.get_policy()` |
| Proof Package | `constraint_hash_service`, `policy_compiler_service`, `proofs/` |
| Agent | `rebalancer/autonomous/status/{address}`, `reputation/user` |
| Strategy | `opportunity_feed_service` (ranked candidates) |
| Execution | `allocation_executor`, `contract_executor` |
| Receipt | `receipt_service` (persisted to SQLite) |

### Backend Changes

- New `GET /api/v1/zkdefi/stream/{address}?from=&to=&type=&limit=` -- unified stream endpoint merging receipts, decisions, activity, opportunities, and trust deltas
- New `GET /api/v1/zkdefi/execution/current/{address}` -- current execution flow state
- New `GET /api/v1/zkdefi/receipts/{receipt_id}` -- full forensic receipt
- Persist `receipt_service` to SQLite (currently in-memory, lost on restart)

---

## Right Rail -- Control Plane

Always-visible agent controls and risk profile.

### Sections

**0. Emergency Stop** (top priority, always first)
- System status: ACTIVE or PAUSED
- [EMERGENCY STOP] button -- sets `emergency_pause: true` via `PUT /vault/policy/{address}`
- Immediately blocks all execution paths (rebalancer, vault_execute, lending, staking, privacy orchestrator)
- Button turns red when paused; shows [RESUME EXECUTION] to clear
- No proposal needed for your own vault

**1. Agent Status**
- Running / Paused / Stopped indicator
- Active policy name (links to Circuit Board)
- Last action timestamp
- Next scheduled check
- Mode: Assisted (pauses for approval) / Autonomous (acts within constraints)
- [Pause] [Stop] [Resume] controls
- [Switch to Autonomous] / [Switch to Assisted]
- Source: `rebalancer/autonomous/status/{address}`

**2. Constraints**
- Risk tolerance slider (maps to `constraint_gate` thresholds)
- Max slippage, drawdown guard
- Venue limits:
  - Ekubo LP: slider with max %
  - Lending: slider with max %
  - Staking: slider with max %
  - Idle: slider with min %
- Rebalance frequency selector
- Strategy whitelist/blacklist
- Privacy mode: Public / Private Flow Allowed / Full Privacy
- [Edit Constraints] opens constraint form
- [Edit in Circuit Board] opens Circuit Board overlay with current policy
- Source: New `GET/PUT /api/v1/vault/constraints/{address}`

**3. Risk Passport Summary**
- Current tier with icon and color
- Trust score (from reputation system)
- FICO score from credit decision
- Proof count (e.g., 4/5) with progress dots
- Voting power (from governance)
- Available credit line amount
- [View Full Profile] navigates to `/profile`
- Source: `risk_passport/user/{address}`, `profile/decision`, `dao/voting_power/{address}`

**4. Session Key**
- Active key status and remaining duration
- Scope display (execute, read)
- [Revoke] action
- Source: `session_keys/list/{address}`

### Backend Changes

- New `GET/PUT /api/v1/vault/constraints/{address}` -- save/load constraint preferences (reads/writes vault_policy_service)

---

## Overlay 1: Deploy (Trade Desk)

Full capital deployment workspace. Slides up over center column. Left and right rails remain visible.

### 6 Sub-modes

**Swap**
- Ekubo-routed token swap
- `lightweight-charts` for STRK/ETH price candles using `dex/price/{base}/{quote}/history`
- Token pair selector, amount, route display, slippage, execute
- Already working via Ekubo; adding chart visualization

**LP (Liquidity Provision)**
- Current LP positions from Capital Ledger
- Add/remove liquidity with proof receipts
- Source: `ekubo_lp_service`

**Lend/Borrow**
- Dual lending model:
  - Personal: supply from vault/Dark Ledger to native lending pool, earn APY
  - DAO Pool: DAO-governed shared pool, rates set via governance proposals
- Risk Passport gates borrowing terms:
  - Tier 2 Trusted: 85% LTV, preferred rate
  - Tier 0 Anon: 60% LTV, standard rate
- Health factor display, collateral management
- Source: `lending_service` + new DAO lending governance

**Stake**
- Native Starknet staking
- Delegate, claim rewards, exit
- Source: `native_staking.py` RPC

**DCA (Dollar-Cost Averaging)**
- Fix USDC-only constraint; support STRK/ETH pairs
- Wire to `vault/dca/schedule`
- Show active DCA schedules with progress

**Limits**
- Wire to `ekubo/limit_orders_adapter`
- New `limit_order_service.py` for order management
- Active orders list with cancel

### Receipts

Every action generates a receipt that appears in the stream. The execution pipeline runs even for manual trades: Intent -> Policy gate check -> Execution -> Receipt.

### How You Get Here

- Click [Deploy] on a stream Opportunity card (pre-fills with opportunity parameters)
- Click [Deploy] shortcut in header strip
- Click a deployed position in Capital Ledger
- Click [Manage Position] or [Borrow Against] on a Lending Event stream card
- Click [Manage Stake] on a Staking Event stream card

---

## Overlay 2: Circuit Board (Deterministic Sandbox)

Full-width overlay using React Flow. Visual flow composer for building deterministic execution policies.

### 4 Node Categories

**Entity Inputs (what you evaluate):**

| Entity | Properties Exposed |
|--------|-------------------|
| Wallet | balance, tier, trust_score, proof_count |
| Asset | price, volatility, 24h_change |
| Pool | TVL, APY, utilization, volume |
| LP Position | value, impermanent_loss, time_held |
| Contract | verified, age, interaction_count |
| Strategy | score, adapter, venues_used |

**Circuit Nodes (evaluations -- the 25+ compiled circuits):**

| Circuit | Category | Output | What it Proves |
|---------|----------|--------|----------------|
| RiskScore | Financial | score (0.0-1.0) | Risk level without revealing portfolio |
| AnomalyDetector | Behavioral | normal/anomaly + confidence | Behavioral anomaly without revealing patterns |
| SolvencyProof | Financial | solvent/insolvent | Balance sufficiency without revealing amounts |
| CreditEligibility | Financial | eligible/ineligible + terms | Credit worthiness without revealing financials |
| TraderPerformance | Behavioral | score + metrics | Track record without revealing trades |
| Correlation | Market | coefficient (-1 to 1) | Asset correlation without revealing positions |
| TWAP | Market | weighted price | Fair price without revealing order flow |
| StrategyIntegrity | Market | valid/invalid | Strategy stays within declared parameters |
| ExecutionIntegrity | Privacy | correct/incorrect | Execution matched intent without revealing details |

**Logic Nodes (decision gates):**

| Node | Function | Ports |
|------|----------|-------|
| IF/ELSE | Threshold comparison on circuit output | 1 input, 2 outputs (true/false) |
| AND | All inputs must pass | N inputs, 1 output |
| OR | Any input must pass | N inputs, 1 output |
| SEQUENCE | Run circuits in order, pass context | 1 input, 1 output (chained) |
| SPLIT | Fork flow into parallel paths with allocation % | 1 input, N outputs with weights |

**Venue Outputs (actions to execute):**

| Venue | Parameters | Adapter |
|-------|------------|---------|
| Ekubo LP | pool_id, allocation_% | `ekubo_execution_service` |
| Lending Supply | pool_id, amount | `lending_service` |
| Lending Borrow | pool_id, amount, collateral | `lending_service` |
| Staking | amount, delegation_pool | `native_staking` |
| Dark Ledger Import | amount, privacy_level | `full_privacy_proof_service` + L3 |
| Execute Strategy | strategy_id | `allocation_executor` via adapter |
| Reject + Alert | reason, severity | `execution_guard` |
| Defer | reason, recheck_interval | Agent skips, tries next cycle |

### Composability: Chaining Circuits

Circuits chain via SEQUENCE nodes. The output of one becomes input context for the next:

```
EXAMPLE: "Privacy-First Conservative Yield"

[My Wallet]
    |
    v
[RiskScore] --> score = 0.22
    |
  IF < 0.3 --YES--> [SPLIT 3-way]
    |                  |         |          |
    NO                35%       20%        15%
    |                  |         |          |
    v                  v         v          v
 [Defer]        [Pool: STRK/ETH] [Pool A] [Native]
                      |           |          |
                      v           v          v
                 [Anomaly]  [CreditElig]  [Stake]
                      |           |
                 IF normal   IF eligible
                   /    \      /    \
                 YES    NO   YES    NO
                  |      |    |      |
                  v      v    v      v
            [Ekubo LP] [Reject] [Lend] [Reject]
                  |               |
                  v               v
            [Dark Ledger]  [Dark Ledger]
            (privacy-wrap  (privacy-wrap
             LP receipt)    lending receipt)
```

### How Policies Connect to Execution

Saved policies are what the Execution Flow references. When the agent runs:
1. It loads the active policy (a Circuit Board graph)
2. Walks the graph from entity inputs through circuits and conditionals
3. Reaches venue outputs and executes
4. Each traversal generates a receipt showing which path was taken and why
5. The receipt appears in the stream with expandable node-by-node detail

### Templates

| Template | Logic | Risk Profile |
|----------|-------|-------------|
| Conservative Yield | Risk < 0.3 -> LP 35% + Lend 20% + Stake 15% + Idle 30% | Low |
| Balanced Growth | Risk < 0.5 -> highest APY venue, anomaly-gated | Medium |
| Privacy Sovereign | All flows through Dark Ledger -> L3 -> then deploy | Any (privacy-maximized) |
| Yield Hunter | Risk < 0.7 -> top APY across all adapters, performance-gated | High |
| Credit Optimizer | CreditElig -> maximize borrowing capacity -> deploy borrowed | Advanced |

### Backend Integration

- `policy_compiler_service.py` -- compiles Circuit Board flows into executable policies
- `constraint_gate.py` -- gates execution against the active policy
- `execution_guard.py` -- enforces policy during autonomous agent cycles
- Circuit metadata from `circuit_scanner` (25+ compiled circuits, `proofs/models` endpoint)
- New `GET/PUT /api/v1/vault/policy/{address}` for saving/loading policies

---

## Overlay 3: Governance

DAO proposals and private ZK voting. Slides up over center column.

### Voting Power Calculation

```
voting_power = sqrt(lp_position + lending_supplied + staked_amount) x tier_multiplier
```

| Tier | Multiplier | Requirements |
|------|-----------|--------------|
| Tier 0 (Anon) | 1.0x | Connected wallet |
| Tier 1 (Express) | 1.5x | 2+ proofs completed |
| Tier 2 (Trusted) | 2.0x | 4+ proofs, collateral staked |

Reputation directly amplifies governance weight.

**Data sources:**
- LP positions: `vault/positions/{address}` (Ekubo LP value)
- Lending supplied: `lending_service.get_user_positions(address)`
- Staked amount: `staking/native_staking` position
- Tier: `reputation/user/{address}` -> `tier_id`
- Tier multiplier: `reputation/tiers` -> tier config

### Proposal Types

| Type | Purpose | Parameters | Execution |
|------|---------|------------|-----------|
| `emergency_pause` | Pause all execution for a pool or system | `target`, `reason` | Sets `emergency_pause: true` |
| `emergency_unpause` | Resume execution after emergency | `target` | Clears `emergency_pause` |
| `adapter_limit` | Cap allocation to a venue | `adapter`, `max_pct` | Updates on-chain constraint |
| `whitelist_asset` | Allow a new token for strategies | `token_address`, `token_symbol` | Updates `token_allowlist` |
| `blacklist_asset` | Remove a token | `token_address`, `reason` | Removes from `token_allowlist` |
| `set_lending_rate` | Set lending pool base rate | `base_rate`, `slope`, `kink` | Updates lending pool params |
| `set_borrower_criteria` | Set borrowing requirements | `min_tier`, `min_proofs`, `min_collateral_ratio` | Updates lending gate |
| `set_pool_cap` | Cap lending pool TVL | `max_tvl`, `max_single_exposure` | Updates lending pool limits |

### Dual Lending Governance

The DAO governs the shared lending pool:
- **Rate setting:** proposals set base rate, utilization curve via `set_lending_rate`
- **Borrower criteria:** proposals set minimum tier, proof count, collateral requirements
- **Risk mitigation:** Personal lending (your capital, your risk) vs. pool lending (collective capital, DAO-governed terms)
- **Privacy:** Rate-setting votes use the `private_vote` circuit. Vote direction hidden, voting power proven, no double voting.

### Vote Privacy

Votes use the `private_vote` circuit (registered in `circuit_scanner`):
- Vote direction is hidden (ZK-proven)
- Voting power is proven without revealing exact position
- Nullifier prevents double voting per proposal
- Tallied results are public and verifiable

### Governance Backend Changes

- Mount `dao_governance.py` in `main.py` at `/api/v1/dao`
- Mount `vault_proposals.py` in `main.py` at `/api/v1/zkdefi/vault/proposals`
- Update `_get_voting_power()` in `dao_voting_service.py` to query real positions and apply tier multiplier
- Add new proposal types for lending governance

---

## What Gets Deleted / Merged

| Current Component | Fate |
|-------------------|------|
| Vault tab (VaultSurface) | Left Rail (balances, positions) + Deploy overlay |
| Portfolio sub-tab (VaultTab) | Left Rail (always visible) |
| Yield sub-tab (YieldTab) | Left Rail (blended APY) + Stream receipts |
| Trade sub-tab (VaultTradeTab) | Deploy overlay |
| Lending sub-tab | Deploy overlay Lend/Borrow + Stream lending events |
| Staking sub-tab | Deploy overlay Stake + Stream staking events |
| Activity sub-tab (ActivityTab) | Unified Stream (replaces scattered activity) |
| Oracle tab (OracleSurfaceContainer) | Unified Stream opportunity cards |
| Oracle Signals (OracleSignalsTab) | Stream opportunities with [Deploy] actions |
| Oracle Radar (OracleRadarTab) | Stream opportunities with scoring |
| Oracle Genome (OracleGenomeTab) | Data layer within Stream expanded cards |
| Brain tab (AgentDashboard) | Control Plane agent status + constraints |
| Brain tab (BrainVisualizer) | Circuit Board overlay |
| Brain tab (AgentRebalancer) | Control Plane agent controls |
| Brain tab (ModelComposer) | Circuit Board overlay |
| Brain tab (MyAgents) | Control Plane + Circuit Board |
| Agent Composer form | Circuit Board overlay |
| `/marketplace` page | Circuit Board overlay |
| CapitalOSStrip | Header Strip |
| VaultBanner | Header Strip gate status |
| VaultHealthMeter | Left Rail Health section |
| ProofTimeline | Unified Stream |
| Scattered wallet/identity/privacy/intent/gate/proof cards | Unified Stream proof chain cards |

---

## Component Map

| New Component | Replaces | Purpose |
|---------------|----------|---------|
| `MissionControlLayout` | Agent page shell | Header strip + three-column responsive layout |
| `HeaderStrip` | CapitalOSStrip + VaultBanner | Agent ID, gate status, proof package, tier, wallet, shortcuts |
| `CapitalLedger` | VaultSurface + VaultTab | Vault, Dark Ledger (L3), deployed positions, health |
| `UnifiedStream` | Everything in center | Reverse-chronological intelligence feed |
| `StreamCard` (9 variants) | ActivityTab + ProofTimeline + OracleSignals + OracleRadar | Type-specific interactive feed cards |
| `ControlPlane` | BrainSurfaceContainer (partial) | Emergency stop, agent, constraints, passport |
| `EmergencyStop` | (new) | Emergency pause/resume for execution guard |
| `ConstraintPanel` | (new) | Risk tolerance, venue limits, privacy mode |
| `PassportSummary` | (new, from CreditReputationHub data) | Tier, trust, FICO, proof count, VP, credit line |
| `DeployOverlay` | VaultTradeTab + DexPanel + DCAPanel + LendingPanel + StakingPanel | 6-mode capital deployment workbench |
| `CircuitBoard` | ModelComposer + AgentDashboard + marketplace | React Flow canvas, policy save/load |
| `EntityInput` | (new) | Draggable entity node (wallet, asset, pool, etc.) |
| `CircuitNode` | (new) | Draggable circuit with entity input |
| `LogicNode` | (new) | IF/ELSE, AND, OR, SEQUENCE, SPLIT gates |
| `VenueNode` | (new) | Ekubo/Lending/Staking/Ledger/Reject output |
| `GovernanceOverlay` | (new, replaces dead `/governance` route) | Proposals, voting, voting power |
| `ProposalCard` | (new) | Proposal with vote status, countdown, actions |
| `VoteCaster` | (new) | ZK vote proof generation stepper |
| `DepositSlideout` | DepositPanel | Overlay variant of existing deposit flow |
| `WithdrawSlideout` | WithdrawPanel | Overlay variant of existing withdraw flow |

---

## Backend Endpoint Changes

### New Endpoints

| Method | Path | Purpose | Service |
|--------|------|---------|---------|
| GET | `/api/v1/zkdefi/stream/{address}` | Unified stream feed | `receipt_timeline_service` + `opportunity_feed_service` + `decision_events` |
| GET | `/api/v1/zkdefi/execution/current/{address}` | Current execution flow state | `execution_flow_service` |
| GET | `/api/v1/zkdefi/receipts/timeline/{address}` | Receipt timeline (date-grouped) | `receipt_timeline_service` |
| GET | `/api/v1/zkdefi/receipts/{receipt_id}` | Full forensic receipt | `receipt_service` |
| GET | `/api/v1/zkdefi/opportunities/feed` | Unified opportunity feed | `opportunity_feed_service` |
| GET | `/api/v1/vault/constraints/{address}` | Load user constraints | `vault_policy_service` |
| PUT | `/api/v1/vault/constraints/{address}` | Save user constraints | `vault_policy_service` |
| GET | `/api/v1/vault/policy/{address}` | Load active Circuit Board policy | `policy_compiler_service` |
| PUT | `/api/v1/vault/policy/{address}` | Save Circuit Board policy | `policy_compiler_service` |
| GET | `/api/v1/zkdefi/ledger/notes/{address}` | Dark Ledger note list with L3 status | `note_store` + `l3_proving_path_client` |
| POST | `/api/v1/dao/emergency/pause` | System-wide emergency pause | `execution_guard` |
| POST | `/api/v1/dao/emergency/unpause` | System-wide emergency unpause | `execution_guard` |

### Mount Existing (Currently Orphaned)

| Route File | Mount Path | Purpose |
|------------|------------|---------|
| `vault_v2.py` | `/api/v2/vault` | Double-entry ledger, note store, sweep, deploy lifecycle |
| `ledger.py` | `/api/v1/zkdefi/ledger` | Ledger transfers, demo credit |
| `dao_governance.py` | `/api/v1/dao` | Proposals, voting, tally, execute |
| `vault_proposals.py` | `/api/v1/zkdefi/vault/proposals` | Commit-reveal vault allocation proposals |
| `lending.py` | `/api/v1/zkdefi/lending` | Lending pool operations |
| `staking.py` | `/api/v1/zkdefi/staking` | Staking operations |

### Fix Existing

| Endpoint | Issue | Fix |
|----------|-------|-----|
| `vault/positions/{address}` | Returns empty | Wire to `real_pool_aggregator` + `lending_service` + `native_staking` |
| `vault/activity/{address}` | Broken | Replace with unified stream endpoint |
| `receipt_service` | In-memory only, lost on restart | Persist to SQLite |
| `strategy_recommendation_service` | Hardcoded 2 Ekubo pools | Replace with `opportunity_feed_service` using real zkRAG + adapters |
| `autonomous_agent` | Hardcoded demo positions | Read real portfolio from `double_entry_ledger` |
| `dao_voting_service._get_voting_power()` | Returns mock 10000 | Query real positions: LP + lending + staking, apply tier multiplier |

### New Services

| Service | Purpose |
|---------|---------|
| `execution_flow_service.py` | Assembles current execution state from multiple services |
| `receipt_timeline_service.py` | Merges receipts, decisions, activity into date-grouped timeline (SQLite-backed) |
| `opportunity_feed_service.py` | Merges oracle + zkRAG + strategy adapters into ranked opportunity feed |
| `limit_order_service.py` | Limit order management via `ekubo/limit_orders_adapter` |

---

## Frontend Dependencies (New)

| Package | Purpose | License |
|---------|---------|---------|
| `reactflow` | Circuit Board node-based editor | MIT |
| `lightweight-charts` | Deploy overlay price charts | Apache 2.0 |
| `recharts` | Risk/yield visualizations | MIT |

---

## Data Flow

```
Intent (user action or agent cycle)
  |
  v
Policy (Circuit Board graph -> vault_policy_service -> execution_guard)
  |
  v
Proof Package (constraint_hash + policy_hash + receipt_root)
  |
  v
Agent (autonomous_agent or user-assisted via Deploy overlay)
  |
  v
Strategy Selection (opportunity_feed_service -> candidates scored by Circuit Board logic)
  |
  v
Execution (allocation_executor -> contract_executor -> Ekubo/Lending/Staking)
  |
  v
Receipt (receipt_service -> SQLite -> Unified Stream)
  |
  v
Trust Delta (reputation update -> Risk Passport -> Voting Power)
```

---

## Venue Clarification

| Venue | Type | Implementation |
|-------|------|----------------|
| Ekubo LP | External DEX | `ekubo_client`, `ekubo_execution_service`, `ekubo_lp_service` |
| Lending Pools (Personal) | Native (our pools) | `lending_service.py`, `LendingPool` contract, `collateral_service` |
| Lending Pools (DAO) | Native (DAO-governed) | `lending_service.py` + `dao_governance` proposals for rates/criteria |
| Staking | Native | `staking/native_staking.py` |
| Dark Ledger | Native (privacy) | `note_store`, `full_privacy_proof_service`, `merkle_tree_service`, L3 Madara |

Vesu is not included. All lending references use native lending pools.

---

## Migration Notes

- The existing `/agent` page URL remains. The layout changes from tab-based to three-column + stream.
- `/profile` page is untouched (scoped separately).
- `/products` marketing pages continue to deep-link; update `/products/private-governance` to link to `/agent` with governance overlay trigger.
- Components from the `ui-improvements` worktree are replaced by the new component tree.
- Existing deposit/withdraw proof logic is preserved -- only the UI container changes to slide-out overlay.

---

## Labels

Use these labels consistently across the UI:

- **Intent** -- what user or agent wanted
- **Policy** -- what rules constrained the action (Circuit Board graph reference)
- **Proof Package** -- what hashes/proofs were formed
- **Agent** -- which agent instance acted
- **Strategy Selection** -- which candidates were considered and why one won
- **Execution** -- what actually happened
- **Receipt** -- what was recorded
- **Trust Delta** -- how reputation changed
- **Privacy** -- what was shielded and how
