# Unified Intelligence Pipeline + Capital Deployment Design

**Date:** 2026-03-04
**Author:** Obsqra Labs
**Status:** Approved

---

## Problem

Three disconnected allocation pipelines exist:

| Pipeline | Used By | Intelligence |
|----------|---------|-------------|
| `strategy_recommendation_service` | Privacy orchestrator, `/recommend` | Hardcoded weights (70/30, 60/40, 30/70) |
| `ai_allocation` | `/allocate`, `/execute-allocation` | LLM (Onyx) + risk engine + real pool metrics |
| `agent_orchestrator` | Agent `execute_goal` | LLM + ZK skills (YieldOptimality, IL predictor) |

The privacy-ekubo orchestrator — the path that deploys capital from privacy pools — uses the dumbest pipeline. It ignores the LLM allocation engine, ignores 20+ zkML circuits, and applies fixed percentage splits to real market data.

Circuits like `YieldOptimality`, `ImpermanentLossPredictor`, `SlippageBound`, `LiquidationRisk`, and `CorrelationRisk` are only invoked when an agent's LLM happens to call them as skills. They never feed into allocation decisions.

Current flow:
```
Market Data → Hardcoded Weights → Recommendation → Post-hoc proof validation
```

Target flow:
```
Market Data → zkML Signal Pass → Informed Allocation → Proof of Decision → Policy Gate → Execution
```

Intelligence informs the decision AND validates it afterward.

---

## Pillar 1: Unified Intelligence Pipeline

### Move 1 — Signal Pass

Before any allocation, run a batch of circuits against candidate pools. Each circuit produces a score (0–100) and a provable output.

| Circuit | Signal | Input Source |
|---------|--------|-------------|
| `ImpermanentLossPredictor` | IL risk for this pool's price range | `pool_metrics` (price_std_dev, liquidity) |
| `YieldOptimality` | How close this allocation is to optimal | `market_surface_service` (APY, TVL) |
| `SlippageBound` | Whether trade size causes unacceptable slippage | `pool_metrics` (liquidity_depth) |
| `LiquidationRisk` | Collateral health for lending positions | `lending_service` (health factor) |
| `CorrelationRisk` | Portfolio-level correlation exposure | Aggregate across all positions |

Implementation: a `signal_pass()` function in a new `backend/app/services/signal_pass_service.py` that:
1. Fetches candidate pools from `pool_metrics` / `market_surface_service`
2. Runs each circuit via `circuit_scanner` with real inputs (not defaults)
3. Returns a `SignalReport` dict per pool: `{pool_id, il_score, yield_score, slippage_ok, liquidation_risk, correlation_risk}`

The `agent_skill_service` already has input builders for these circuits. The signal pass wires real data into those builders instead of relying on hardcoded defaults.

### Move 2 — Replace the Recommendation Entry Point

`privacy_ekubo_orchestrator` currently calls:
```python
strategy_recommendation_service.get_recommendation(address, amount, risk_profile)
```

Change to:
```python
signals = signal_pass_service.compute_signals(candidate_pools, portfolio)
allocation = ai_allocation.compute_allocation(amount, risk_level, pool_metrics, signals=signals)
```

The LLM (Onyx) or deterministic fallback now sees verified circuit scores alongside raw pool metrics. The hardcoded 70/30 splits disappear.

Deterministic fallback (when LLM unavailable): weight pools by `(yield_score * 0.4) + (100 - il_score) * 0.3 + (100 - correlation_risk) * 0.2 + slippage_ok * 0.1`, normalized to sum to 100%.

### Move 3 — Post-Allocation Proof

Already works. `policy_engine` runs `RiskScore` and `AnomalyDetector` after the allocation is produced, gating execution. No change needed.

### Data Flow

```
┌────────────────────────────────────────┐
│         MARKET DATA SOURCES            │
│  Ekubo API, Oracle, pool_metrics       │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         SIGNAL PASS (pre-allocation)   │
│  Per pool:                             │
│    ImpermanentLossPredictor → il_score │
│    YieldOptimality → yield_score       │
│    SlippageBound → slippage_ok         │
│    LiquidationRisk → liq_risk          │
│  Per portfolio:                        │
│    CorrelationRisk → corr_risk         │
│    RiskScore → risk_score              │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         ALLOCATION ENGINE              │
│  ai_allocation.compute_allocation()    │
│                                        │
│  Inputs:                               │
│    Real pool metrics                   │
│    Signal scores per pool              │
│    User risk profile                   │
│    Behavioral history (DecisionStore)  │
│                                        │
│  LLM (Onyx) or deterministic fallback │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         POLICY GATE (post-allocation)  │
│  policy_engine.check():                │
│    RiskScore proof → is_compliant      │
│    AnomalyDetector → is_safe           │
│    Constraint bounds from vault policy │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         EXECUTION                      │
│  privacy_ekubo_orchestrator            │
│  VaultController / Operator / Agent    │
└────────────────────────────────────────┘
```

### What Happens to `strategy_recommendation_service`

It stays as a lightweight fallback for non-privacy flows (e.g. direct `/recommend` API for informational queries). The privacy orchestrator stops using it for capital deployment.

---

## Pillar 2: Capital Deployment (Layered Trust)

Three deployment tiers. All route through the unified intelligence pipeline above.

### Tier 1 — Personal Vault (Operator as Dark Broker)

User deposits into any privacy tier. Operator keypair executes on Ekubo directly. User's identity never appears on-chain at the execution layer.

- **Trust model:** User trusts operator with capital custody during deployment
- **Who signs:** Operator keypair
- **Constraint enforcement:** `policy_engine` gates every deployment with zkML proofs
- **Proof of execution:** Receipt anchored on-chain (fact_hash), proof timeline visible to user

### Tier 2 — Shared Dark Pool (VaultController + Commit-Reveal)

Multiple users deposit into VaultController. AI produces a deployment proposal. Proposal hash committed on-chain (intent hidden). After reveal, VaultController calls strategy adapter.

- **Trust model:** On-chain constraints; proposal must match committed hash
- **Who signs:** VaultController contract (programmatic)
- **Capital flow:** Privacy pools → VaultController → IStrategyAdapter.deploy()
- **Yield distribution:** Pro-rata shares tracked by VaultController

### Tier 3 — Autonomous Agent (Session Key Delegation)

User grants a session key to their agent. Agent operates within bounds: max amount per tx, allowed strategies, expiry. Agent's keypair signs on-chain; user's wallet is never exposed.

- **Trust model:** Bounded delegation via SessionKeyManager
- **Who signs:** Agent keypair (session-key-bounded)
- **Constraint enforcement:** On-chain `validate_session_with_proof` + zkML gates
- **Revocation:** User can revoke session key at any time

### "Dark" Strategy Variants

Each yield strategy has a privacy-preserving version where the operator/VaultController/agent acts as the on-chain intermediary:

| Strategy | Normal | Dark Version |
|----------|--------|-------------|
| Ekubo LP | User mints position | Operator mints; user's identity hidden |
| Swap | User signs swap tx | Operator executes; commit-reveal hides intent |
| Lending | User supplies to pool | Operator supplies; borrower sees operator, not user |
| Staking | User delegates STRK | Operator delegates; validator sees operator, not user |
| Collateral | User deposits collateral | Operator deposits; protocol sees operator |

### Execution Pipeline

Shared across all tiers:

1. User deposits into privacy pool (any of 4 tiers)
2. Backend detects idle capital (`private_yield_service`)
3. Signal pass runs circuits on candidate pools/strategies
4. `ai_allocation` produces allocation decision
5. `policy_engine` gates with risk + anomaly proofs
6. Operator / VaultController / agent executes on Ekubo / lending / staking
7. Yield accrues; tracked via `ledger_service` or on-chain shares
8. User withdraws via nullifier proof

---

## Pillar 3: Token Expansion

### strkBTC

A standard ERC20 deployed on Sepolia. Mint supply to deployer. No bridging, no atomic swaps — purely a test token representing BTC-denominated value.

**Deployment:** Standard OpenZeppelin ERC20 Cairo contract. `deploy_zkd_pools.py` pattern.

**Ekubo pools:**
- `strkBTC/ETH` (pegged ~1:1 for testnet simplicity)
- `strkBTC/STRK`

**What it unlocks:**

| # | Feature | How |
|---|---------|-----|
| 15 | Private BTC swap | Same DexPanel flow, strkBTC token address |
| 16 | Private BTC lending | Add strkBTC to LendingPool accepted tokens |
| 17 | Private yield on BTC | Same yield pipeline, strkBTC as deposit token |

Every privacy tier works identically — the commitment math is token-agnostic. `Poseidon(amount, secret)` doesn't care whether the amount represents ETH, STRK, or strkBTC.

### Stables

USDC/USDT test tokens on Sepolia (deploy our own if needed, same pattern). Ekubo pairs created the same way. Unlocks feature #18 (private yield on stables).

### Privacy Pool Token Support

Privacy pool contracts (`ConfidentialTransfer`, `FullyShieldedPool`) already accept any ERC20 via the `token` parameter. No contract changes needed — only backend/frontend configuration to register new token addresses.

---

## Pillar 4: DCA Tool

Natural extension of autonomous agent + session keys + Ekubo swap.

### Configuration

User specifies:
- Token pair (e.g. STRK → strkBTC)
- Amount per interval (e.g. 100 STRK)
- Interval (hourly, daily, weekly)
- Privacy tier for accumulation
- Max slippage tolerance

### Execution

1. Session key grants bounded execution: max amount per tx, expiry, allowed pair
2. Autonomous agent loop triggers at each interval
3. Each swap routes through privacy pool — accumulation is private
4. `SlippageBound` circuit gates each swap: if slippage exceeds tolerance, skip and retry next interval
5. `signal_pass` checks IL and market conditions before each execution

### Architecture

No new contracts. Combines existing primitives:
- `SessionKeyManager` for delegation
- `autonomous_agent` for recurring execution
- `ekubo_executor` for swap execution
- `signal_pass_service` for pre-swap verification
- Privacy pool for private accumulation

A DCA strategy is a simplified autonomous rebalancer: fixed amount, fixed interval, single direction.

---

## What Ships vs. What Doesn't

### Ships (this design)

| # | Feature | Grade |
|---|---------|-------|
| — | Unified Intelligence Pipeline | New |
| — | Capital Deployment (3 tiers) | New |
| 15 | Private BTC swap | READY → BUILT |
| 16 | Private BTC lending | READY → BUILT |
| 17 | Private yield on BTC | READY → BUILT |
| 18 | Private yield on stables | READY → BUILT |
| 20 | DCA tool | READY → BUILT |

### Community / Adapter Territory (not this design)

| # | Feature | Why |
|---|---------|-----|
| 2 | Sealed-bid auction | Primitives exist; separate UX surface |
| 5 | Sigma verifiers | Different cryptographic primitive |
| 6 | Mental Poker | Niche adapter |
| 11-14 | BTC yield/leverage/tokenized | IStrategyAdapter implementations |
| 19 | BTC CDP | Adapter |
| 21 | BTC staking | Adapter |
| 24 | Prediction market | Separate contract + UI |
| 25 | Private voting | Separate contract + UI |

### Already Shipped (no changes)

10 BUILT features from HACKATHON_FEATURE_COVERAGE.md remain unchanged.

---

## Files Affected

### New Files
- `backend/app/services/signal_pass_service.py` — circuit signal batch runner
- `contracts/src/strk_btc.cairo` — test ERC20 for strkBTC
- `deploy_strkbtc_pools.py` — pool creation script

### Modified Files
- `backend/app/services/privacy_ekubo_orchestrator.py` — swap recommendation entry point from `strategy_recommendation_service` to `ai_allocation` + signal pass
- `backend/app/services/ai_allocation.py` — accept `signals` parameter in `compute_allocation()`
- `backend/app/services/private_yield_service.py` — replace hardcoded splits with `ai_allocation` call
- `backend/app/services/agent_skill_service.py` — wire real pool data into circuit input builders
- `backend/app/services/autonomous_agent.py` — add DCA strategy type
- `backend/app/services/ekubo_config.py` — register strkBTC token and pool addresses
- `frontend/src/components/zkdefi/DexPanel.tsx` — add strkBTC to token selector
- `frontend/src/components/zkdefi/vault/DepositPanel.tsx` — add strkBTC/stables to token list
- `docs/HACKATHON_FEATURE_COVERAGE.md` — update grades for #15-18, #20
