# Phase A Complete — Risk Engine + Pool Metrics + Strategy Endpoint

**Date:** 2026-02-25  
**Duration:** ~3 hours

## What Was Built

### 1. Risk Engine (`backend/app/services/risk_engine.py`)
- Deterministic risk scoring: `score_risk(risk_level, time_horizon_days)` → `RiskAssessment`
- Three tiers with allocation bounds:
  - Conservative (1-3): max 30% LP, max 80% single pool
  - Balanced (4-6): max 70% LP, max 60% single pool
  - Aggressive (7-10): max 100% LP, max 50% single pool
- Returns reasoning text, safe protocol list, concentration caps

### 2. Pool Metrics (`backend/app/services/pool_metrics.py`)
- Live Ekubo pool data with 5-minute TTL cache
- Risk tier classification: `stable` | `blue_chip` | `volatile` | `concentrated`
- Blue-chip tier added for stablecoin-paired volatile assets (e.g. ETH/USDC, WBTC/USDT)

### 3. Real Pool Aggregator Fixes (`backend/app/services/real_pool_aggregator.py`)
- Fixed Ekubo API format change: `token0`/`token1` are now raw address strings, not `{address, symbol}` dicts
- Added token address → symbol lookup (Starknet mainnet + bridged L1 addresses)
- Added per-token decimal handling (ETH=18, USDC=6, WBTC=8)
- Added static USD price estimates (ETH=$3500, STRK=$0.50, USDC=$1, WBTC=$95K)
- Fixed TVL, volume, and APY calculations to use correct decimals and prices

### 4. Strategy Endpoint (`POST /api/v1/strategies/analyze-live`)
- Takes: `deposit_amount`, `risk_profile`, `user_address`, `time_horizon_days`
- Returns: ranked pool recommendations with allocation percentages, blended APY, reserve amount
- Includes deterministic proof hash of the decision
- Properly differentiates allocation by risk profile

## Verified Behavior

| Profile | Pools | LP % | Reserve % | Blended APY | Tier Selection |
|---|---|---|---|---|---|
| Conservative | 1 | 30% | 70% | ~52% | blue_chip only |
| Balanced | 2 | 70% | 30% | ~51% | blue_chip + volatile |
| Aggressive | 2 | 100% | 0% | ~145% | all tiers incl. concentrated |

## What Was Learned

1. **Ekubo API has 0 Sepolia pairs.** Pool discovery must use mainnet data. Execution remains on Sepolia.
2. **Token addresses differ by chain.** Bridged L1 addresses (e.g. `0xa0b86991...` for USDC) appear in mainnet API responses alongside Starknet-native addresses.
3. **Token decimals matter.** USDC (6 decimals) vs ETH (18 decimals) — dividing everything by 1e18 gave $77 billion TVL for USDC pools.
4. **PM2 env vars override code defaults.** `EKUBO_CHAIN_ID` in `.env` forced Sepolia chain_id even when code intended mainnet. Required explicit `chain_id=None` with sentinel-based constructor.
5. **Fee-based APY is reliable.** `(fees_24h / tvl) * 365 * 100%` gives useful APY estimates without a price oracle, since fees and TVL are in the same token units.

## What It Unlocks

- **Phase B (AI Allocation):** The risk engine bounds + pool metrics are the inputs to the LLM allocation engine. Phase B can now take a risk assessment + pool list and produce weighted allocation decisions.
- **Phase C (Live Execution):** Pool recommendations include pool_id and fee_ratio — these map directly to Ekubo LP parameters for `build_lp_add()`.
- **Frontend Integration:** The `/analyze-live` response shape is ready for the vault dashboard to display recommendations before execution.

## Files Changed/Created

| File | Action | Lines |
|---|---|---|
| `backend/app/services/risk_engine.py` | Created | ~163 |
| `backend/app/services/pool_metrics.py` | Created | ~116 |
| `backend/app/services/real_pool_aggregator.py` | Modified | ~307 |
| `backend/app/api/routes/strategies.py` | Modified | ~560 |
| `dev_log/PHASE_A_COMPLETE.md` | Created | this file |
