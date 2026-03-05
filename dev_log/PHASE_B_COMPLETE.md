# Phase B Complete — AI Allocation Engine + Attestation

**Date:** 2026-02-25  
**Duration:** ~1 hour (after Phase A)

## What Was Built

### 1. AI Allocation Engine (`backend/app/services/ai_allocation.py`)
- `compute_allocation(assessment, pools, deposit_amount, user_address)` → `AllocationDecision`
- **LLM path:** When OPENAI_API_KEY is set, sends risk bounds + candidate pools to GPT-3.5-turbo
  - System prompt constrains the model to respect allocation bounds
  - Validates and caps LLM output to risk engine limits
- **Deterministic fallback:** Score-based ranking: `APY × TVL_depth × tier_bonus`
  - Tier bonuses: stable=1.2, blue_chip=1.1, volatile=1.0, concentrated=0.8
  - Selects top N pools up to max_lp_pct
- **Attestation hash:** SHA-256 of `{timestamp, user, risk_profile, deposit, pool_ids, weights}`
  - Deterministic and reproducible — same inputs always produce same hash
  - Serves as audit-trail proof until full ZK circuit is built

### 2. Strategy Endpoint (`POST /api/v1/strategies/allocate`)
- Full pipeline: risk_engine → pool_metrics → ai_allocation → ledger_service
- Records each allocation decision in `vault_allocations` table
- Returns: allocations, reserve %, blended APY, reasoning, confidence, source, attestation_hash

### 3. Ledger Recording (`ledger_service.record_vault_allocation()`)
- New method for recording allocation decisions
- Stores strategy_id, pool_ids, amount, and full metadata JSON
- Status starts as "pending" → updated to "active" when LP is executed (Phase C)

## Verified Behavior

```
POST /api/v1/strategies/allocate
{
  "deposit_amount": 10000,
  "risk_profile": "balanced",
  "user_address": "0x05fe81..."
}

→ {
  "allocations": [
    {"pair": "WBTC/USDT", "weight_pct": 60.0, "amount_usd": 6000, "expected_apy_pct": 51.79, "risk_tier": "blue_chip"},
    {"pair": "ETH/USDC", "weight_pct": 10.0, "amount_usd": 1000, "expected_apy_pct": 46.86, "risk_tier": "blue_chip"}
  ],
  "reserve_pct": 30.0,
  "reserve_usd": 3000.0,
  "blended_apy_pct": 51.08,
  "source": "deterministic",
  "attestation_hash": "15ca653..."
}
```

## What Was Learned

1. **Two-path coverage is essential.** The LLM path adds intelligence but the deterministic fallback ensures the system never returns empty when OpenAI is down.
2. **Bridge token addresses were the missing piece.** Ekubo's mainnet API returns L1-originating addresses (e.g. `0xa0b86991...` for USDC). Adding these to the symbol lookup fixed pair name resolution AND TVL calculation (USDC got its $1 price).
3. **Risk tier "blue_chip" was needed.** ETH/USDC is not "stable" (ETH is volatile) but it's not purely "volatile" either. The blue_chip tier bridges this gap — allowing conservative users to access major-pair pools.
4. **Ledger integration is lightweight.** Recording the allocation as a vault_allocations row with metadata JSON took ~20 lines. Phase C will update status from "pending" → "active".

## What It Unlocks

- **Phase C (Live Execution):** The allocation decision includes specific pool_ids, amounts, and pairs. `ekubo_lp_service.build_lp_add()` can be called directly with these.
- **Phase D (Yield Collection):** Attestation hashes link each yield event back to the allocation decision that generated it.
- **Phase E (Rebalancing):** Comparing current allocations (from ledger) vs fresh `compute_allocation()` output tells the rebalancer what needs to change.
- **Frontend:** The `/allocate` response shape maps directly to a UI confirmation dialog showing pools, amounts, and expected returns.

## Files Changed/Created

| File | Action | Lines |
|---|---|---|
| `backend/app/services/ai_allocation.py` | Created | ~265 |
| `backend/app/api/routes/strategies.py` | Modified | ~675 |
| `backend/app/services/ledger_service.py` | Modified | ~760 |
| `dev_log/PHASE_B_COMPLETE.md` | Created | this file |
