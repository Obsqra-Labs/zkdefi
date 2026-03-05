# Phase C Complete — Live Ekubo LP Execution

**Date:** 2026-02-25  
**Status:** ✅ COMPLETE  

---

## What Was Built

### 1. `vault_allocation_executor.py` (~310 lines)
Core execution service bridging AI allocation decisions → Ekubo LP positions.

**Pipeline:**
```
AllocationDecision → parse pool_id → resolve token addresses
  → USD → token-wei conversion → build_lp_add_calldata()
  → (optional) live submit via ContractExecutor
  → record in SQLite ledger
```

**Key functions:**
- `execute_allocation(decision, owner, chain_id, risk_profile)` → `ExecutionBatch`
- `_parse_pool_id(pool_id)` → `(token0, token1, fee_tier)` from aggregator pool_id format
- `_usd_to_token_wei(usd_amount, symbol)` → raw token amount using static price table
- `_split_usd_for_pair(total_usd, sym0, sym1)` → 50/50 split (standard LP)
- `_submit_lp_calls(approvals, calls)` → on-chain via starkli (when live_submit=true)

### 2. `POST /strategies/execute-allocation` endpoint
Combined allocation + execution in a single call:
1. Runs full allocation engine (risk_engine → pool_metrics → ai_allocation)
2. For each pool: builds Ekubo Positions `mint_and_deposit` calldata
3. If `EXECUTOR_LIVE_SUBMIT=true`: signs/broadcasts approvals + LP call
4. Returns allocation summary + per-pool execution results with calldata

### 3. Position Tracking (upgraded)
- `/vault-live/positions/{address}` now reads from the Ekubo LP JSON store
- Also reads from SQLite ledger for execution-tracked positions
- `get_vault_allocations()` added to LedgerService with optional status filter

---

## Verified Results

### Conservative ($5K deposit)
```
1 position: WBTC/USDT built, $1,500
Reserve: $3,500 (70%)
```

### Balanced ($10K deposit)
```
2 positions:
  WBTC/USDT: built, $6,000 (60%)
  ETH/USDC:  built, $1,000 (10%)
Reserve: $3,000 (30%)
```

### Aggressive ($20K deposit)
```
2 positions:
  WBTC/USDT: built, $10,000 (50%)
  ETH/AAE07B: failed (unknown token) — graceful error
Reserve: $0 (0%)
```

Each "built" position includes full calldata:
- ERC20 approval calls (token → Ekubo Positions contract)
- `mint_and_deposit` call with pool_key, tick range, token amounts, position_id

---

## What Was Learned

1. **Pool ID parsing is fragile** — The aggregator generates pool_ids like
   `ekubo:{token0_addr}:{token1_addr}:{fee}:{idx}`. The fee field can be "na" for
   unknown tiers, so the parser must have a fallback (defaults to 3000 = 0.3%).

2. **Token address resolution needs multiple strategies:** Direct hex address match,
   `0x0` → ETH mapping, pair name fallback (split "WBTC/USDT" → symbol lookup).

3. **USD → wei conversion requires the static price table** from real_pool_aggregator.
   No oracle yet — approximate prices (ETH=$3500, WBTC=$95K, USDC=$1, etc.).

4. **Ekubo Sepolia has 0 pairs** — Pool data comes from mainnet API. This means the
   LP calldata uses mainnet token addresses (e.g., `0x2260fac...` for WBTC) which
   are L1 bridged addresses. On Sepolia, these tokens may not exist. Live submission
   would need Sepolia-specific addresses.

5. **Aggressive profile hits unknown tokens** — Exotic pairs (like ETH/0xd9fcd98...)
   don't have price metadata. The executor fails gracefully with a clear error message
   rather than crashing.

6. **The calldata is always returned** regardless of live_submit flag. This means:
   - Client wallet can sign manually
   - Backend can batch-submit later
   - Audit trail has the exact calldata that was (or would be) executed

---

## What This Unlocks

1. **Phase D — Yield Collection:** With position_ids and the Ekubo Positions contract,
   we can query `collect_fees` to read/claim accumulated trading fees.

2. **Phase E — Rebalancing:** Compare current allocation vs. fresh allocation decision;
   `build_lp_remove` existing positions + `build_lp_add` for new ones.

3. **Client-side signing:** The frontend can call `/execute-allocation` and present
   the `calldata` for wallet signing (Argent X, Braavos, Cartridge).

4. **Live mainnet deployment:** Flip `EXECUTOR_LIVE_SUBMIT=true` and point to mainnet
   RPC + wallet with real funds. The pipeline is identical.

---

## Files Created
- `backend/app/services/vault_allocation_executor.py`

## Files Modified
- `backend/app/api/routes/strategies.py` — added `/execute-allocation` endpoint
- `backend/app/api/routes/vault_execute_live.py` — positions endpoint now reads from LP store
- `backend/app/services/ledger_service.py` — added `get_vault_allocations()` method
