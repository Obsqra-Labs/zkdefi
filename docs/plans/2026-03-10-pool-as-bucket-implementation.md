# Pool-as-Bucket Implementation Plan

**Design doc:** `2026-03-10-pool-as-bucket-design.md`
**Estimated tasks:** 10 across 4 phases

---

## Phase 1: Bug Fixes & Infrastructure

### Task 1 — Fix Ekubo tick base
**File:** `backend/app/services/ekubo_lp_service.py`
**Change:** Line 161: `math.log(1.0001)` → `math.log(1.000001)`
**Why:** Ekubo uses tick base `1.000001` (not Uniswap's `1.0001`). Current code produces tick values ~100x wrong.

### Task 2 — Discover real Sepolia delegation pools
**File:** `backend/app/services/staking/native_staking.py`
**Change:** Replace the placeholder `pool_address="0x0"` in `get_delegation_pools()` with an RPC-based discovery mechanism. Query the Starknet staking contract's events or known pool registry to find active Sepolia delegation pools.
**Fallback:** If no pools can be discovered via RPC, use a configurable env var `STAKING_POOL_ADDRESSES` (comma-separated) so users can manually set them. The staking adapter should return `"no_pools_available"` status when no real pools are configured.

### Task 3 — Ledger pool-scoped account helpers
**File:** `backend/app/services/double_entry_ledger.py`
**Change:** Add method `pool_balances(pool_id: str) -> Dict[str, int]` that queries all accounts matching `POOL:{pool_id}:*` and returns a structured breakdown:
```python
{
    "idle:ETH": 800000000000000000,
    "idle:STRK": 400000000000000000000,
    "ekubo:ETH/USDC": 300000000000000000,
    "staking:STRK": 300000000000000000000,
    "lending:USDC": 500000000,
}
```
Also add `pool_entries(pool_id: str, limit, offset)` for audit trail.

---

## Phase 2: Pool Composition Service

### Task 4 — Create PoolCompositionService
**New file:** `backend/app/services/pool_composition_service.py`

Core responsibilities:
- `get_composition(pool_id)` — reads ledger balances, fetches live position data from Ekubo API and staking contract, computes `total_value_usd`, `idle_value_usd`, `deployed_value_usd`, `blended_apy`, and per-position details.
- `deploy_to_adapter(pool_id, adapter, params)` — posts ledger entries to move capital from idle to deployed, returns calldata for relayer execution.
- `close_position(pool_id, position_id)` — reverse: debit deployed, credit idle.

Position value enrichment:
- **Ekubo LP**: call Ekubo API `GET /tokens/{nft_id}` or use local position store to get current tick/range, mark `in_range`/`out_of_range`.
- **Staking**: call `native_staking.get_user_delegation_positions()` for delegated amount + unclaimed rewards.
- **Lending**: read from P2P lending service for active loans.

Price feeds: use existing `MainnetOracle` service for ETH/STRK/USDC prices to compute USD values.

### Task 5 — Pool composition API endpoint
**New file:** `backend/app/api/routes/pool_composition.py`

```
GET /api/v1/zkdefi/pools/{pool_id}/composition
```

Response matches the schema from the design doc. Pool IDs: `conservative`, `moderate`, `aggressive`.

**Register in:** `backend/app/main.py`

---

## Phase 3: Agent Integration

### Task 6 — Wire autonomous agent to PoolCompositionService
**File:** `backend/app/services/autonomous_agent.py`
**Change:** In the evaluation loop, after fetching oracle signals, call `PoolCompositionService.get_composition()` for each pool. If idle capital exceeds a threshold and oracle signals are favorable, create a deploy proposal. The agent should respect pool risk tier constraints:
- Conservative: only staking + low-volatility LP pairs
- Moderate: staking + LP + lending
- Aggressive: all adapters, wider tick ranges

### Task 7 — Connect deposit flow to pool idle accounts
**File:** `backend/app/services/privacy_vault_service.py` or `backend/app/api/routes/full_privacy.py`
**Change:** After a successful shielded deposit, also post a ledger entry crediting `POOL:{tier}:idle:{token}`. The tier is determined by the pool the user selected.

---

## Phase 4: Frontend — Pool Card Redesign

### Task 8 — PoolBucketCard component
**New file:** `frontend/src/components/zkdefi/shared/PoolBucketCard.tsx`

An expandable pool card that shows:
- **Collapsed:** Pool name, risk badge, total value, blended APY, idle vs deployed bar
- **Expanded:** Position breakdown table with adapter icon, pair/token, value, APY, status. Agent status line. Deposit/Withdraw buttons.

Uses the composition API (`/api/v1/zkdefi/pools/{pool_id}/composition`).

### Task 9 — Rewrite CapitalTab pool section
**File:** `frontend/src/components/zkdefi/tabs/CapitalTab.tsx`
**Change:** Replace the current pool cards (lines 210-319 approx) with `PoolBucketCard` components. Remove the separate "Active Positions" section — positions now live inside their parent pool cards. Keep the "Opportunities" section as-is.

Remove imports for `PrivacyPoolAdapter`, `PoolLiquidityManager` (no longer needed for pool display — composition API handles it).

### Task 10 — Staking position display in pool
**File:** `frontend/src/components/zkdefi/shared/PoolBucketCard.tsx`
**Change:** For positions with `adapter === "staking"`, show delegation pool name, delegated STRK amount, unclaimed rewards, and estimated APR from the Starknet staking contract data.

---

## Dependency Order

```
T1 (tick fix) ─┐
T2 (staking)  ─┼─→ T4 (composition service) ─→ T5 (API) ─→ T6 (agent) ─→ T7 (deposit wiring)
T3 (ledger)   ─┘                                    │
                                                     └─→ T8 (PoolBucketCard) ─→ T9 (CapitalTab) ─→ T10 (staking display)
```

Tasks 1-3 can run in parallel. Tasks 8-10 depend on Task 5 (need the API).

---

## Post-implementation: Pool-aware deposit/withdraw UI (2026-03-10)

**Goal:** Fix broken deposit/withdraw flows so they are pool-aware and consistent with the pool-as-bucket model.

### Changes made

1. **Pool context through slideout** — When the user clicks Deposit or Withdraw on a specific pool bucket card (Conservative, Moderate, Aggressive), the pool ID is passed through: `PoolBucketCard` → `CapitalTab` → `VaultCenterStage` → agent page → `DepositPanel` / `WithdrawPanel`. The deposit slideout shows a pool badge in the header and pre-selects that pool in the allocation strategy.

2. **Single deposit panel** — Removed the "Fund Vault" vs "Direct to Pool" toggle. One unified deposit panel: pool selector, asset, amount, proof stepper. `VaultStrategyDeposit` remains available but is no longer the default path.

3. **Pool naming** — Renamed "Balanced" to "Moderate" across the stack (`PoolSelector`, `PoolBucketCard`, `VaultStrategyDeposit`, `PositionsOverview`) to match backend pool IDs. Legacy `balanced` kept in lookup maps for existing commitments.

4. **Withdraw filtering** — When opening Withdraw from a pool card, the commitment list is filtered to that pool. Pool variant badges shown on commitment cards when not filtered.

5. **Guest mode feedback** — In guest mode, Deposit/Withdraw buttons show a toast: "Connect a wallet to deposit or withdraw" instead of doing nothing.

### Files touched

- `frontend/src/app/agent/page.tsx` — `slideoutPool` state, removed deposit-mode toggle, guest toast
- `frontend/src/components/zkdefi/vault/DepositPanel.tsx` — `initialPool` prop
- `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx` — `filterPool` prop, pool labels
- `frontend/src/components/zkdefi/vault/PoolSelector.tsx` — balanced → moderate
- `frontend/src/components/zkdefi/shared/PoolBucketCard.tsx` — pass `poolId` in callbacks
- `frontend/src/components/zkdefi/tabs/CapitalTab.tsx` — thread pool through `onSlideout`
- `frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx` — `onSlideout(mode, poolId?)`
- `frontend/src/components/zkdefi/vault/PositionsOverview.tsx` — moderate in color/label maps
- `frontend/src/components/zkdefi/vault/VaultStrategyDeposit.tsx` — balanced → moderate

