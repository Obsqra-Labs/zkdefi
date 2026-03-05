# Phase 4: Market Enrichment Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Date:** 2026-03-05  
**Status:** Draft  
**Goal:** Enrich Oracle opportunities with multi-DEX aggregation, off-chain validation, and cross-protocol arbitrage detection

---

## What We've Built So Far

✅ **Phase 1B:** zkML risk scoring, circuit integration  
✅ **Phase 2:** Strategy Intelligence Service, persistent strategies, genome computation  
✅ **Phase 3:** Oracle Recommendation Engine, personalized actions  

**Current Limitation:** All opportunities come from **Ekubo only** — missing better yields/opportunities on JediSwap, mySwap, Nostra, 10KSwap.

---

## Critical Gap: Single Data Source

**Current state:**
```python
# backend/app/services/market_surface_service.py
async def get_market_surface():
    pairs = await _fetch_ekubo_pairs()  # ONLY Ekubo
    opportunities = _enrich_pairs(pairs)
    return {"opportunities": opportunities}
```

**Impact:**
- Oracle recommendations biased to Ekubo pools only
- Missing potentially better yields on other DEXes
- Can't detect cross-DEX arbitrage opportunities
- No price validation across venues

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Market Enrichment Service                       │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. Multi-DEX Aggregation                       │
│     ┌──────────────────────────────┐            │
│     │ Ekubo API → pools            │            │
│     │ JediSwap API → pools         │            │
│     │ 10KSwap API → pools          │            │
│     │ mySwap API → pools (future)  │            │
│     └──────────┬───────────────────┘            │
│                ▼                                 │
│  2. Normalization & Deduplication               │
│     - Standardize token addresses               │
│     - Merge pools for same pair                 │
│     - Aggregate liquidity/volume                │
│                ▼                                 │
│  3. Off-Chain Enrichment (Optional/Future)      │
│     - CoinGecko prices (validation)             │
│     - DeFi Llama TVL trends                     │
│     - L1 price comparison                       │
│                ▼                                 │
│  4. Arbitrage Detection                         │
│     - Find same pair on multiple DEXes          │
│     - Calculate price differential              │
│     - Flag profitable arbitrage (>1% spread)    │
│                ▼                                 │
│  Output: EnrichedOpportunity[]                  │
│    - all_venues: ["Ekubo", "JediSwap"]          │
│    - best_venue: "JediSwap"                     │
│    - arbitrage_opportunity: true/false          │
│    - price_spread_pct: 2.5                      │
│    - aggregated_tvl_usd: 500000                 │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Task 1: Add JediSwap Integration

**Files:**
- Modify: `backend/app/services/market_surface_service.py`

**Step 1: Add JediSwap fetcher**

After `_fetch_ekubo_pairs()` function (line ~127), add:

```python
async def _fetch_jediswap_pairs() -> list[dict[str, Any]]:
    """Fetch top pairs from JediSwap API (Starknet).
    
    JediSwap API docs: https://api.jediswap.xyz/docs
    Returns normalized pool data matching Ekubo schema.
    """
    try:
        # JediSwap public API endpoint
        url = "https://api.jediswap.xyz/pools"
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        
        pools = []
        for pool in data.get("data", [])[:50]:  # Top 50 pools
            # Normalize to match Ekubo schema
            token0 = pool.get("token0", {})
            token1 = pool.get("token1", {})
            pair_name = f"{token0.get('symbol', 'UNK')}/{token1.get('symbol', 'UNK')}"
            
            tvl_usd = float(pool.get("tvl_usd", 0))
            volume_24h = float(pool.get("volume_24h", 0))
            apy = float(pool.get("apr", 0)) if pool.get("apr") else 0.0
            
            pools.append({
                "pair": pair_name,
                "protocol": "JediSwap",
                "token0_address": token0.get("address", ""),
                "token1_address": token1.get("address", ""),
                "tvl_usd": tvl_usd,
                "volume_24h_usd": volume_24h,
                "estimated_apy_pct": apy,
                "fee_tier": float(pool.get("fee", 0.003)),
                "pool_address": pool.get("address", ""),
            })
        
        logger.info("Fetched %d JediSwap pools", len(pools))
        return pools
    
    except Exception as exc:
        logger.warning("JediSwap pools fetch failed: %s", exc)
        return []
```

**Step 2: Add 10KSwap fetcher**

```python
async def _fetch_10kswap_pairs() -> list[dict[str, Any]]:
    """Fetch top pairs from 10KSwap API (Starknet).
    
    10KSwap API: https://api.10kswap.com/
    Returns normalized pool data.
    """
    try:
        url = "https://api.10kswap.com/pools/list"
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        
        pools = []
        for pool in data.get("pools", [])[:30]:  # Top 30 pools
            token0_symbol = pool.get("token0_symbol", "UNK")
            token1_symbol = pool.get("token1_symbol", "UNK")
            pair_name = f"{token0_symbol}/{token1_symbol}"
            
            pools.append({
                "pair": pair_name,
                "protocol": "10KSwap",
                "token0_address": pool.get("token0_address", ""),
                "token1_address": pool.get("token1_address", ""),
                "tvl_usd": float(pool.get("tvl", 0)),
                "volume_24h_usd": float(pool.get("volume_24h", 0)),
                "estimated_apy_pct": float(pool.get("apy", 0)),
                "fee_tier": 0.003,  # 10KSwap default
                "pool_address": pool.get("pool_address", ""),
            })
        
        logger.info("Fetched %d 10KSwap pools", len(pools))
        return pools
    
    except Exception as exc:
        logger.warning("10KSwap pools fetch failed: %s", exc)
        return []
```

**Step 3: Aggregate in `get_market_surface()`**

Modify the main function (line ~270):

```python
async def get_market_surface(chain_id: str | None = None) -> dict[str, Any]:
    """Aggregate market data from multiple DEXes."""
    
    all_pools = []
    
    # Fetch from all DEXes in parallel
    ekubo_task = _fetch_ekubo_pairs(chain_id)
    jediswap_task = _fetch_jediswap_pairs()
    tenk_task = _fetch_10kswap_pairs()
    
    ekubo_pools, jediswap_pools, tenk_pools = await asyncio.gather(
        ekubo_task,
        jediswap_task,
        tenk_task,
        return_exceptions=True,
    )
    
    # Collect successful results
    if isinstance(ekubo_pools, list):
        all_pools.extend(ekubo_pools)
    if isinstance(jediswap_pools, list):
        all_pools.extend(jediswap_pools)
    if isinstance(tenk_pools, list):
        all_pools.extend(tenk_pools)
    
    logger.info(
        "Market surface aggregated: %d Ekubo + %d JediSwap + %d 10KSwap = %d total",
        len(ekubo_pools) if isinstance(ekubo_pools, list) else 0,
        len(jediswap_pools) if isinstance(jediswap_pools, list) else 0,
        len(tenk_pools) if isinstance(tenk_pools, list) else 0,
        len(all_pools),
    )
    
    # ... (rest of enrichment logic)
```

**Step 4: Verify**

```bash
cd backend && python3 -c "
import sys, asyncio
sys.path.insert(0, '.')
from app.services.market_surface_service import get_market_surface

async def test():
    surface = await get_market_surface()
    opps = surface.get('opportunities', [])
    protocols = set(o.get('protocol') for o in opps)
    print(f'✓ Aggregated {len(opps)} opportunities from {len(protocols)} protocols: {protocols}')

asyncio.run(test())
"
```

Expected: `✓ Aggregated 80+ opportunities from 3 protocols: {'Ekubo', 'JediSwap', '10KSwap'}`

**Step 5: Commit**

```bash
git add backend/app/services/market_surface_service.py
git commit -m "feat(market): add JediSwap and 10KSwap integration

- _fetch_jediswap_pairs(): fetch top 50 pools from JediSwap API
- _fetch_10kswap_pairs(): fetch top 30 pools from 10KSwap API
- Parallel aggregation in get_market_surface()
- Normalized schema across all DEXes

Oracle now sees opportunities across 3+ protocols"
```

---

## Task 2: Deduplicate and Merge Multi-Venue Pairs

**Files:**
- Modify: `backend/app/services/market_surface_service.py`

**Step 1: Add deduplication logic**

After aggregation in `get_market_surface()`, before `_enrich_pairs()`:

```python
def _deduplicate_pools(pools: list[dict]) -> list[dict]:
    """Merge pools for the same pair across multiple DEXes.
    
    Strategy:
    - Group by normalized pair name (e.g., "ETH/USDC" == "USDC/ETH")
    - Keep the venue with highest TVL as primary
    - Add 'all_venues' metadata
    - Calculate aggregated_tvl across venues
    """
    from collections import defaultdict
    
    # Normalize pair names (order-agnostic)
    def normalize_pair(pair: str) -> str:
        tokens = pair.upper().replace(" ", "").split("/")
        return "/".join(sorted(tokens))
    
    grouped = defaultdict(list)
    for pool in pools:
        norm_pair = normalize_pair(pool.get("pair", ""))
        grouped[norm_pair].append(pool)
    
    merged = []
    for norm_pair, venues in grouped.items():
        if len(venues) == 1:
            # Single venue, just pass through
            merged.append(venues[0])
        else:
            # Multiple venues: merge
            best_venue = max(venues, key=lambda p: p.get("tvl_usd", 0))
            best_venue["all_venues"] = [v.get("protocol") for v in venues]
            best_venue["aggregated_tvl_usd"] = sum(v.get("tvl_usd", 0) for v in venues)
            best_venue["best_venue"] = best_venue.get("protocol")
            
            # Check for arbitrage opportunity (>1% price spread)
            apys = [v.get("estimated_apy_pct", 0) for v in venues]
            if len(apys) > 1:
                spread = max(apys) - min(apys)
                best_venue["arbitrage_opportunity"] = spread > 1.0
                best_venue["yield_spread_pct"] = spread
            
            merged.append(best_venue)
    
    logger.info("Deduplication: %d pools → %d unique pairs", len(pools), len(merged))
    return merged
```

**Step 2: Wire into `get_market_surface()`**

```python
# After aggregation:
all_pools = _deduplicate_pools(all_pools)
```

**Step 3: Verify**

```bash
curl -s "http://localhost:8003/api/v1/strategies/opportunities" | jq '.opportunities[] | select(.all_venues) | {pair, best_venue, all_venues, aggregated_tvl_usd}'
```

Expected: Some opportunities showing `"all_venues": ["Ekubo", "JediSwap"]`

**Step 4: Commit**

```bash
git add backend/app/services/market_surface_service.py
git commit -m "feat(market): deduplicate and merge multi-venue pairs

- _deduplicate_pools(): merge same pair across DEXes
- Select best venue by TVL
- Add all_venues, aggregated_tvl_usd metadata
- Detect arbitrage opportunities (>1% yield spread)
- Order-agnostic pair matching (ETH/USDC == USDC/ETH)

Oracle now identifies cross-DEX opportunities"
```

---

## Task 3: Add Multi-Venue Display to Oracle UI

**Files:**
- Modify: `frontend/src/components/zkdefi/oracle/types.ts`
- Modify: `frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx`

**Step 1: Extend TypeScript types**

```typescript
// frontend/src/components/zkdefi/oracle/types.ts
export interface OracleOpportunity {
  // ... existing fields ...
  
  // Multi-venue enrichment (Phase 4)
  all_venues?: string[];
  best_venue?: string;
  aggregated_tvl_usd?: number;
  arbitrage_opportunity?: boolean;
  yield_spread_pct?: number;
}
```

**Step 2: Display multi-venue badge in Signals tab**

In opportunity card (line ~139):

```tsx
<div className="flex items-center justify-between mb-2">
  <div className="flex items-center gap-2">
    <span className="font-medium text-white">{name}</span>
    {opp.all_venues && opp.all_venues.length > 1 && (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-600/20 text-purple-300 border border-purple-500/30">
        {opp.all_venues.length} venues
      </span>
    )}
    {opp.arbitrage_opportunity && (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-600/20 text-amber-300 border border-amber-500/30">
        Arb {opp.yield_spread_pct?.toFixed(1)}%
      </span>
    )}
  </div>
  <span className="text-xs text-emerald-400">{yieldTrend(apy)}</span>
</div>
```

**Step 3: Show venue details**

```tsx
{opp.all_venues && opp.all_venues.length > 1 && (
  <div className="mt-2 text-xs text-zinc-500">
    Available on: {opp.all_venues.join(", ")} · Best: {opp.best_venue}
  </div>
)}
```

**Step 4: Verify**

Open `http://localhost:3001/?v=oracle&sub=signals`, check for "2 venues" and "Arb X%" badges on multi-venue opportunities.

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/types.ts frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx
git commit -m "feat(oracle): display multi-venue and arbitrage badges

- Show '2 venues' badge for cross-DEX pairs
- Display 'Arb X%' badge for arbitrage opportunities
- List all available venues + best venue
- Extended OracleOpportunity type with enrichment fields

Users now see cross-protocol opportunities and arbitrage"
```

---

## Task 4: Test End-to-End Multi-DEX Flow

**Verification checklist:**

```bash
# 1. Backend aggregation
curl -s "http://localhost:8003/api/v1/strategies/opportunities" | jq '{
  total: .opportunities | length,
  protocols: [.opportunities[].protocol] | unique,
  multi_venue: [.opportunities[] | select(.all_venues)] | length
}'

# Expected:
# {
#   "total": 80+,
#   "protocols": ["Ekubo", "JediSwap", "10KSwap"],
#   "multi_venue": 10+
# }

# 2. Arbitrage detection
curl -s "http://localhost:8003/api/v1/strategies/opportunities" | jq '[.opportunities[] | select(.arbitrage_opportunity)] | length'

# Expected: 3+

# 3. Recommendations now use multi-DEX data
curl -s "http://localhost:8003/api/v1/strategies/recommendations?limit=3" | jq '.recommendations[0] | {label, strategy_name}'

# 4. Frontend Oracle (manual)
# Open http://localhost:3001/?v=oracle&sub=signals
# Should see:
#   - Opportunities from multiple protocols
#   - "2 venues" badges on cross-DEX pairs
#   - "Arb X%" badges where applicable
#   - Increased opportunity count (80+ vs 50)
```

**Step 6: Commit verification**

```bash
git commit --allow-empty -m "test: Phase 4 multi-DEX enrichment verified

Backend aggregation:
✓ 80+ opportunities from 3 protocols (Ekubo, JediSwap, 10KSwap)
✓ 10+ multi-venue pairs identified
✓ 3+ arbitrage opportunities detected

Frontend display:
✓ Multi-venue badges showing '2 venues'
✓ Arbitrage badges showing yield spread
✓ Best venue selection by TVL

Phase 4 complete: Oracle now aggregates real-time data across 
multiple DEXes, identifies arbitrage, and displays enriched opportunities"
```

---

## Success Criteria

✅ JediSwap and 10KSwap integrated into market surface  
✅ Multi-venue pairs deduplicated and merged  
✅ Arbitrage opportunities detected (>1% spread)  
✅ Oracle UI displays multi-venue badges  
✅ Recommendations benefit from expanded opportunity set  

---

## Still Out of Scope (Phase 5+)

- Off-chain data enrichment (CoinGecko, DeFi Llama) — requires API keys
- mySwap and Nostra integration — API availability TBD
- zkGraph integration (obsqra.fi zkRAG) — requires external service
- Cross-chain arbitrage (L1 ↔ L2) — complex infrastructure
- Historical price tracking — requires persistent time-series DB

---

**Estimate:** 4 tasks, ~45 minutes implementation + testing.
