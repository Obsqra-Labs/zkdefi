# Pool-as-Bucket Redesign — Privacy Pools as Capital Containers

**Date:** 2026-03-10
**Status:** Approved
**Goal:** Transform privacy pools from flat risk-tier labels into real capital containers that hold idle funds and deployed positions across Ekubo LP, lending, and Starknet native staking.

## Problem

Privacy pools currently show TVL, APR, utilization — but they're not containers. The capital goes into FullyShieldedPool on-chain, and separately, users deploy to Ekubo LP positions. There's no relationship between "this capital is in Conservative Pool" and "these are the positions Conservative Pool holds."

The UI shows pools that look like LP positions, not buckets of diversified capital.

## Design

### Architecture: Hybrid

- **FullyShieldedPool contract** holds capital on-chain (existing, unchanged)
- **Backend `PoolCompositionService`** tracks what each pool holds (idle + positions)
- **Relayer/admin account** executes position creation/removal via signed transactions
- **Autonomous agent** decides when/where to deploy based on oracle signals
- Capital stays idle after deposit until agent acts

### Pool Data Model

Each pool (Conservative, Moderate, Aggressive) is a bucket tracked in the double-entry ledger:

```
Conservative Pool
├── POOL:conservative:idle:ETH         → 0.8 ETH    (in FullyShieldedPool)
├── POOL:conservative:idle:STRK        → 400 STRK
├── POOL:conservative:ekubo:ETH/USDC   → 0.3 ETH    (Ekubo NFT #47)
├── POOL:conservative:ekubo:STRK/ETH   → 200 STRK   (Ekubo NFT #52)
├── POOL:conservative:lending:USDC     → 500 USDC    (P2P loan)
└── POOL:conservative:staking:STRK     → 300 STRK    (delegation pool)
```

### Three Adapters

| Adapter | Integration | Contract | Status |
|---------|-------------|----------|--------|
| **Ekubo LP** | `ekubo_lp_service.build_lp_add()` / `build_lp_remove()` | Ekubo Positions NFT `0x06a2...17e5` | Real on-chain |
| **P2P Lending** | Existing lending service | Ledger-tracked | Ledger-only |
| **Starknet Staking** | `native_staking.build_delegate_calldata()` / `build_exit_intent_calldata()` | Staking contract `0x0374...09f1` | Real on-chain |

### Flows

**Deposit → Pool idle:**
1. User deposits via FullyShieldedPool (existing commitment flow)
2. Backend credits `POOL:{tier}:idle:{token}` in ledger
3. Capital sits idle until agent evaluates

**Agent deploys to Ekubo LP:**
1. Agent decides: "deploy 200 STRK from Conservative into STRK/ETH LP at ±3000 ticks"
2. `PoolCompositionService.deploy_to_adapter("conservative", "ekubo", params)`
3. Ledger: debit `POOL:conservative:idle:STRK`, credit `POOL:conservative:ekubo:STRK/ETH`
4. Relayer executes `build_lp_add()` calldata via admin account
5. Store Ekubo NFT ID in position record

**Agent deploys to staking:**
1. Agent decides: "stake 300 STRK from Conservative into delegation pool"
2. `PoolCompositionService.deploy_to_adapter("conservative", "staking", params)`
3. Ledger: debit `POOL:conservative:idle:STRK`, credit `POOL:conservative:staking:STRK`
4. Relayer executes `build_delegate_calldata()` via admin account

**Agent closes position:**
1. Agent decides: "close STRK/ETH LP, return to idle"
2. Relayer executes `build_lp_remove()` or `build_exit_intent_calldata()`
3. Ledger: debit deployed account, credit idle account

**User withdraws:**
1. Existing nullifier-based withdrawal flow
2. If idle < withdrawal, agent must close positions first

### API

**New endpoint:** `GET /api/v1/zkdefi/pools/{pool_id}/composition`

```json
{
  "pool_id": "conservative",
  "total_value_usd": 4200,
  "idle_value_usd": 1800,
  "deployed_value_usd": 2400,
  "blended_apy": 5.3,
  "positions": [
    {
      "id": "pos_001",
      "adapter": "ekubo_lp",
      "pair": "ETH/USDC",
      "value_usd": 1200,
      "apy": 8.2,
      "status": "in_range",
      "metadata": { "nft_id": 47, "lower_tick": -3000, "upper_tick": 3000 }
    },
    {
      "id": "pos_002",
      "adapter": "staking",
      "token": "STRK",
      "value_usd": 800,
      "apy": 4.5,
      "status": "active",
      "metadata": { "pool_address": "0x...", "pool_name": "Sepolia Validator" }
    },
    {
      "id": "pos_003",
      "adapter": "lending",
      "token": "USDC",
      "value_usd": 400,
      "apy": 3.5,
      "status": "active"
    }
  ],
  "agent_status": "watching",
  "next_eval_seconds": 240
}
```

### Frontend — Pool Card

Pool cards expand to show position breakdown:

```
┌─ Conservative Pool ─────────────────────────────────┐
│ Total: $4,200  │  Idle: $1,800  │  Deployed: $2,400 │
│ Blended APY: 5.3%                                    │
├──────────────────────────────────────────────────────┤
│ ⬡ ETH/USDC LP      $1,200   8.2% APY   in-range ✓  │
│ ⬡ STRK/ETH LP       $800    6.1% APY   in-range ✓  │
│ ⛓ STRK Staking      $800    4.5% APY   delegated   │
│ 🏦 USDC Lending      $400    3.5% APY   active      │
├──────────────────────────────────────────────────────┤
│ Agent: watching · next eval in 4m                    │
│ [Deposit] [Withdraw]                                 │
└──────────────────────────────────────────────────────┘
```

### Bug Fixes

**Tick base mismatch:** `ekubo_lp_service.py` uses `log(ratio)/log(1.0001)` but Ekubo uses `1.000001`. Fix: change to `log(ratio)/log(1.000001)`.

**Staking pools placeholder:** `native_staking.py` has `pool_address="0x0"` for known pools. Need to discover or configure real Sepolia delegation pool addresses.

### Components

**Backend (new):**
- `PoolCompositionService` — tracks pool composition, deploy/withdraw from adapters
- `GET /pools/{pool_id}/composition` endpoint
- Integration with autonomous agent for deploy decisions

**Backend (modified):**
- `ekubo_lp_service.py` — fix tick base to `1.000001`
- `native_staking.py` — populate real delegation pool addresses
- `privacy_ekubo_orchestrator.py` — route through PoolCompositionService
- `double_entry_ledger.py` — add pool-scoped account helpers

**Frontend (modified):**
- `CapitalTab.tsx` — pool cards show composition, not flat TVL/APR
- New `PoolPositionCard` component for individual positions within a pool
