
# TradeDesk Real Data Aggregation Plan

**Date:** 2026-03-08  
**Goal:** Replace mock data in Trade Desk with REAL aggregation from backend services  
**Status:** Planned

---

## Context

The TradeDesk backend (`backend/app/api/routes/trade_desk.py`) currently returns HARDCODED MOCK opportunities, market context, and receipts. This prevents the frontend from discovering actual protocol opportunities (swaps, LP, lending, staking, DCA, limits).

**Root Cause:** Post-refactor, TradeDesk was stubbed with mock data instead of being wired to real services.

**User Intent:** "I think you just mocked stuff... look at the legacy build and take inspiration and find those real data sources and tools"

---

## Real Data Sources (Already Available & Tested)

### Working Backend Endpoints:
1. **Lending**: `GET /api/v1/zkdefi/lending/pool` - pool stats (supply/borrow APY, TVL, utilization)
2. **Staking**: `GET /api/v1/zkdefi/staking/pools` - available pools with APR, commission, validator names
3. **DEX/Swaps**: `GET /api/v1/zkdefi/dex/pairs` - available trading pairs with volume & liquidity
4. **Ekubo LP**: `GET /api/v1/zkdefi/ekubo/positions` - user positions (if available)
5. **Receipts**: Mission Control endpoints or dedicated receipts API

**Fixed in Latest Commit (7d2cc605):**
- Removed duplicate path prefixes from lending & staking routers
- Verified all endpoints now return real data ✓

---

## Implementation Steps

### Phase 1: Opportunities Aggregation

**File:** `backend/app/api/routes/trade_desk.py`

**Task 1.1:** Replace mock OPPORTUNITIES with aggregation function

```python
async def aggregate_opportunities() -> list[dict]:
    """
    Aggregates REAL opportunities from:
    - Lending pool stats → creates supply + borrow opportunities
    - Staking pools → creates delegate opportunities per pool
    - DEX pairs → creates swap opportunities
    - Adds hardcoded DCA & Limit Order templates (protocol-specific)
    """
    opportunities = []
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Lending: supply + borrow opportunities
        try:
            pool = await client.get(f"{BACKEND_BASE}/api/v1/zkdefi/lending/pool")
            # Extract supply_apy_bps, borrow_apy_bps, total_supplied, etc.
            # Create opportunity entries for supply yield & borrow access
        except Exception as e:
            logger.warning(f"Lending aggregation failed: {e}")
        
        # 2. Staking: per-pool delegation opportunities  
        try:
            pools = await client.get(f"{BACKEND_BASE}/api/v1/zkdefi/staking/pools")
            # For each pool: create opportunity with name, commission, APR
        except Exception as e:
            logger.warning(f"Staking aggregation failed: {e}")
        
        # 3. DEX: swap pair opportunities
        try:
            pairs = await client.get(f"{BACKEND_BASE}/api/v1/zkdefi/dex/pairs?limit=5")
            # For top 5 pairs: create swap opportunities with volume & TVL
        except Exception as e:
            logger.warning(f"DEX aggregation failed: {e}")
        
        # 4. Add DCA & Limits as template opportunities (always available)
        opportunities.append(DCA_TEMPLATE)
        opportunities.append(LIMITS_TEMPLATE)
    
    return opportunities or FALLBACK_OPPORTUNITIES
```

**Task 1.2:** Update `/api/v1/zkdefi/opportunities/list` endpoint to use aggregation

```python
@router.get("/api/v1/zkdefi/opportunities/list")
async def get_opportunities(
    type: Optional[str] = None,
    minYield: Optional[float] = None,
    maxRisk: Optional[float] = None,
    privacyMode: Optional[str] = None
):
    """Fetch REAL opportunities from protocol aggregation with optional filtering."""
    # CHANGED: Call aggregate_opportunities() instead of returning mock OPPORTUNITIES
    opps = await aggregate_opportunities()
    
    # Apply existing filters
    if type:
        opps = [o for o in opps if o["type"] == type]
    if minYield:
        opps = [o for o in opps if o.get("currentYield", 0) >= minYield]
    if maxRisk:
        opps = [o for o in opps if o.get("riskScore", 100) <= maxRisk]
    if privacyMode:
        opps = [o for o in opps if privacyMode in o.get("privacyModes", [])]
    
    return {"opportunities": opps}
```

### Phase 2: Market Context

**Task 2.1:** Enhance market context with real data

```python
async def get_market_context() -> dict:
    """
    Fetch real market context from:
    - Lending utilization → contributes to risk assessment
    - DEX volume trends → informs volatility
    - Staking commission trends → opportunity analysis
    """
    context = {
        "volatilityIndex": 42,  # TODO: compute from price volatility
        "sentiment": "neutral",  # TODO: derive from yield vs risk
        "riskWarnings": [],  # TODO: populate from pool health checks
        "trendingPairs": [],  # TODO: top pairs by volume
        "timestamp": datetime.utcnow().isoformat()
    }
    
    try:
        async with httpx.AsyncClient() as client:
            # Fetch recent volume, utilization, etc. to inform context
            pass
    except Exception as e:
        logger.warning(f"Market context aggregation failed: {e}")
    
    return context
```

### Phase 3: Receipts Integration

**Task 3.1:** Wire receipts endpoint to real Receipt service

```python
@router.get("/api/v1/zkdefi/receipts/timeline")
async def get_receipt_timeline(limit: int = 50):
    """Fetch REAL receipt timeline from receipt service, not mock RECEIPTS."""
    # CHANGED: Replace RECEIPTS[: limit] with real service call
    try:
        receipts = await receipt_service.get_timeline(limit=limit, address=user_address)
        return {"receipts": receipts, "totalCount": len(receipts)}
    except Exception:
        # Fallback if service unavailable
        return {"receipts": [], "totalCount": 0}
```

---

## Acceptance Criteria

### Backend:
- [ ] `GET /api/v1/zkdefi/opportunities/list` returns lending + staking + dex opportunities (NOT mock)
- [ ] Filtering by type, yield, risk, privacyMode works on real data
- [ ] Graceful fallback to minimal data if services unavailable
- [ ] No hardcoded mock arrays in response path

### Frontend:
- [ ] TradeDesk loads opportunities (swap, LP, lending, staking, DCA, limits)
- [ ] User can filter and select opportunities
- [ ] Execute flow proceeds to ExecutionPanel
- [ ] Receipt appears in Memory Lane after execution

### Verification:
```bash
# Test aggregation
curl http://localhost:8003/api/v1/zkdefi/opportunities/list | jq '.opportunities | map(.type) | unique'
# Should output: ["swap", "lending", "staking", "dca", "limit_orders"]

# Test filtering
curl "http://localhost:3001/api/v1/zkdefi/opportunities/list?type=staking" | jq '.opportunities | length'
# Should return staking opportunities only
```

---

## Technical Notes

### API Aggregation Pattern:
- Use `httpx.AsyncClient` for parallel requests to multiple endpoints
- 10-second timeout per request to avoid hanging
- Fallback gracefully if individual service unavailable
- Cache aggregated results briefly (5-10 sec) to avoid hammering backend

### Data Mapping:
Each protocol endpoint returns different schema. Must normalize:

| Protocol | Source | Fields → Opportunity |
|----------|--------|----------------------|
| Lending | pool_stats | supply_apy_bps → currentYield, total_supplied_eth → tvl |
| Staking | pools[] | estimated_apr_pct → currentYield, name → name, commission_pct → riskScore |
| DEX | pairs[] | token pair → tokenA/tokenB, volume24h → liquidity proxy, apy → currentYield |

### Privacy Modes:
- **Lending**: supports ["public", "shielded"] (dark_ledger via contract router)
- **Staking**: ["public"] only (delegation is on-chain)
- **Swaps**: ["public", "shielded"] (Ekubo)
- **DCA/Limits**: all modes per configured contract routers

---

## Execution

This plan is ready for implementation. Recommended approach:

### Batch 1 (Current Phase)
1. **Task 1.1 + 1.2:** Opportunities aggregation ✅ COMPLETED
   - Created `aggregate_opportunities()` with real protocol integration
   - Verified: lending, staking, DEX, DCA, limits flowing through
   
2. **Task 2.1:** Market context enhancement — ~1 hour
   - Add real volatility/sentiment calculation
   - Commit + verify
   
3. **Task 3.1:** Receipts service integration — ~1 hour
   - Wire to actual receipt service
   - Commit + verify

### Batch 2 (Signals Placeholder - NEW)
4. **Task 4.1:** Create signals endpoint — ~2 hours
   - New route: `GET /api/v1/zkdefi/signals/top`
   - Transform opportunities → signals with constitution reports
   - Add prediction JSON structure (empty in Phase 1)
   - Include Ekubo LP in opportunities source
   
5. **Task 4.2:** Frontend signals integration — ~1 hour
   - Wire dashboard to consume signals endpoint
   - Display constitution cards, yield/risk info

**Total estimated time:** 5-6 hours for Phase 1 (opportunities + signals placeholder ready for prediction models).

---

## Related Files

- **Backend:** `backend/app/api/routes/trade_desk.py` (main aggregation logic)
- **Backend:** `backend/app/api/routes/lending.py`, `staking.py`, `dex.py` (data sources - already working)
- **Frontend:** `frontend/src/services/MarketDataService.ts` (already calls correct endpoints)
- **Frontend:** `frontend/src/components/zkdefi/TradeDesk.tsx` (already uses MarketDataService)
- **Verification:** `docs/plans/2026-03-07-gap-analysis-plans-vs-builds.md` (context)

---

## Color Scheme Note

Frontend TradeDesk uses system colors from `globals.css`:
- Base: `bg-zinc-950 text-zinc-100` (dark background, light text)
- Accent: `var(--thumb-bg, #22c55e)` (teal/green, can customize)
- Should verify component matches design (screenshot shows blue/teal bars - verify Tailwind applies correctly)

---

**Next Step:** Implementation ready. Awaiting execution.
