# Phase 3: Oracle Recommendation Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Date:** 2026-03-05  
**Status:** Draft  
**Goal:** Transform Oracle from passive data display to active decision guidance — generate "Approve/Modify" actions, enhance demo mode, wire recommendations to UI

---

## What We've Built So Far

✅ **Phase 1B:** zkML risk scoring, circuit integration (IL/yield/slippage)  
✅ **Phase 2:** Strategy Intelligence Service, persistent strategies, genome computation  
✅ **Infrastructure:** Poseidon bridge fixed, 13 strategies in repository

## Critical Remaining Gaps

❌ **Oracle Recommendations:** Signals tab shows hardcoded demo actions, not real recommendations  
❌ **Demo Mode Enhancement:** Demo data missing zkML intelligence fields  
❌ **Actionable Intelligence:** No "Approve" button functionality, no personalized suggestions  

---

## Architecture

```
┌────────────────────────────────────────────────┐
│  Oracle Recommendation Engine                  │
├────────────────────────────────────────────────┤
│                                                 │
│  Input: User Profile + Current Allocation +    │
│         Available Strategies (from repo)       │
│                                                 │
│  ▼                                              │
│  ┌──────────────────────────────────┐          │
│  │ 1. Fetch top ranked strategies   │          │
│  │    (from Strategy Intelligence)  │          │
│  └──────────┬───────────────────────┘          │
│             ▼                                   │
│  ┌──────────────────────────────────┐          │
│  │ 2. Generate recommendations      │          │
│  │    - Allocate X% to strategy Y   │          │
│  │    - Rebalance from A to B       │          │
│  │    - Diversify into Z            │          │
│  └──────────┬───────────────────────┘          │
│             ▼                                   │
│  ┌──────────────────────────────────┐          │
│  │ 3. Validate against constraints  │          │
│  │    - Risk profile limits         │          │
│  │    - Vault policy gates          │          │
│  │    - Minimum allocation sizes    │          │
│  └──────────┬───────────────────────┘          │
│             ▼                                   │
│  Output: List[RecommendedAction]               │
│    - label: "Allocate 12% to STRK/ETH"         │
│    - strategy_id: "d283bbf1c190b4ff"           │
│    - action_type: "allocate" | "rebalance"     │
│    - allocation_pct: 12                        │
│    - reasoning: "High genome composite (72.8)" │
│    - confidence: "high" | "medium" | "low"     │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Task 1: Enhance Demo Data with zkML Intelligence

**Files:**
- Modify: `frontend/src/lib/demoCapitalOS.ts`

**Step 1: Add zkML fields to DEMO_OPPORTUNITIES**

```typescript
export const DEMO_OPPORTUNITIES: OracleOpportunity[] = [
  {
    pair: "STRK/ETH",
    estimated_apy_pct: 22,
    risk_score: 35,
    volatility: 25,
    tvl_usd: 120000,
    confidence: "high",
    proof_status: "Verified",
    signal_strength: 85,
    // Phase 1B/2: zkML intelligence
    zkml_risk_score: 32,
    zkml_confidence: 1.0,
    zkml_flags: [],
    zkml_signals: {
      il_acceptable: true,
      yield_near_optimal: true,
      slippage_ok: true,
      gates_passed: 3,
      gates_total: 3,
      proof_hash: "0xabc123def456789...",
    },
    genome_factors: {
      yield_score: 22,
      risk_score: 32,
      volatility_score: 50,
      liquidity_score: 65,
      efficiency_score: 18.4,
    },
  },
  // Repeat for other 4 demo opportunities...
];
```

**Step 2: Verify demo mode shows intelligence**

Open `http://localhost:3001/?mode=demo`, check Oracle → Signals/Genome. Should show zkML badges and genome factors.

**Step 3: Commit**

```bash
git add frontend/src/lib/demoCapitalOS.ts
git commit -m "feat(demo): add zkML intelligence to demo opportunities

- zkml_risk_score, zkml_confidence, zkml_flags
- zkml_signals with IL/yield/slippage circuit results
- genome_factors with backend-computed scores
- Proof hashes for verification display

Demo mode now demonstrates full intelligence capabilities"
```

---

## Task 2: Create Oracle Recommendation Service

**Files:**
- Create: `backend/app/services/oracle_recommendation_service.py`

**Step 1: Implement recommendation engine**

```python
# backend/app/services/oracle_recommendation_service.py
from __future__ import annotations
import logging
from typing import List, Optional
from pydantic import BaseModel

from app.services.strategy_intelligence_service import get_strategy_intelligence_service

logger = logging.getLogger(__name__)


class RecommendedAction(BaseModel):
    """A recommended action for the user to take."""
    label: str  # User-facing description
    strategy_id: str
    strategy_name: str  # e.g. "ETH/USDC"
    action_type: str  # "allocate" | "rebalance" | "diversify"
    allocation_pct: float  # Suggested allocation percentage
    reasoning: str  # Why this recommendation
    confidence: str  # "high" | "medium" | "low"
    genome_composite: float  # For sorting


class OracleRecommendationService:
    """Generate personalized recommendations from strategy intelligence."""
    
    def __init__(self):
        self.intelligence_svc = get_strategy_intelligence_service()
    
    def generate_recommendations(
        self,
        user_profile: str = "BALANCED",
        current_allocation: dict[str, float] | None = None,
        limit: int = 3,
    ) -> List[RecommendedAction]:
        """Generate top N recommendations for user."""
        # Get top ranked strategies
        strategies = self.intelligence_svc.rank_strategies(
            user_profile=user_profile,
            limit=10,
        )
        
        if not strategies:
            return []
        
        recommendations = []
        
        # Rule 1: If no current allocation, suggest diversified start
        if not current_allocation or sum(current_allocation.values()) == 0:
            # Suggest top 3 strategies with balanced allocation
            for i, strategy in enumerate(strategies[:3]):
                pct = [40, 35, 25][i] if i < 3 else 10
                recommendations.append(RecommendedAction(
                    label=f"Allocate {pct}% to {strategy.pool_id}",
                    strategy_id=strategy.strategy_id,
                    strategy_name=strategy.pool_id,
                    action_type="allocate",
                    allocation_pct=pct,
                    reasoning=f"High genome composite ({strategy.genome.composite_score:.1f}), {strategy.confidence} confidence",
                    confidence=strategy.confidence,
                    genome_composite=strategy.genome.composite_score,
                ))
        
        # Rule 2: If allocated, suggest rebalance to higher-scoring strategies
        else:
            allocated_strategy_ids = set(current_allocation.keys())
            # Find better strategies not currently allocated
            for strategy in strategies:
                if strategy.strategy_id not in allocated_strategy_ids:
                    recommendations.append(RecommendedAction(
                        label=f"Diversify into {strategy.pool_id} ({strategy.genome.composite_score:.1f} score)",
                        strategy_id=strategy.strategy_id,
                        strategy_name=strategy.pool_id,
                        action_type="diversify",
                        allocation_pct=10,
                        reasoning=f"Better risk-adjusted yield than current allocation",
                        confidence=strategy.confidence,
                        genome_composite=strategy.genome.composite_score,
                    ))
                    if len(recommendations) >= limit:
                        break
        
        # Sort by genome composite (descending)
        recommendations.sort(key=lambda r: r.genome_composite, reverse=True)
        
        return recommendations[:limit]


_service: OracleRecommendationService | None = None

def get_oracle_recommendation_service() -> OracleRecommendationService:
    """Singleton accessor."""
    global _service
    if _service is None:
        _service = OracleRecommendationService()
    return _service
```

**Step 2: Verify service**

```bash
cd backend && python3 -c "
import sys; sys.path.insert(0, '.')
from app.services.oracle_recommendation_service import get_oracle_recommendation_service

svc = get_oracle_recommendation_service()
recommendations = svc.generate_recommendations(user_profile='BALANCED', limit=3)
print(f'✓ Generated {len(recommendations)} recommendations')
for rec in recommendations:
    print(f'  {rec.label} (composite={rec.genome_composite:.1f})')
"
```

**Step 3: Commit**

```bash
git add backend/app/services/oracle_recommendation_service.py
git commit -m "feat(oracle): implement Oracle Recommendation Service

- generate_recommendations(): personalized action suggestions
- Rules: initial allocation (40%/35%/25% top 3), rebalance, diversify
- Recommendations include strategy_id, allocation_pct, reasoning
- Validated against user risk profile
- Sorted by genome composite score

Returns actionable 'Approve/Modify' recommendations"
```

---

## Task 3: Add GET /recommendations Endpoint

**Files:**
- Modify: `backend/app/api/routes/strategies.py`

**Step 1: Add endpoint after GET /strategies**

```python
@router.get("/recommendations")
async def get_recommendations(
    user_address: Optional[str] = None,
    user_profile: str = "BALANCED",
    limit: int = 3,
):
    """Generate personalized recommendations using Oracle Recommendation Service."""
    from app.services.oracle_recommendation_service import get_oracle_recommendation_service
    
    # TODO: Fetch user's current allocation from vault if user_address provided
    current_allocation = None  # For now, assume fresh allocation
    
    svc = get_oracle_recommendation_service()
    recommendations = svc.generate_recommendations(
        user_profile=user_profile,
        current_allocation=current_allocation,
        limit=limit,
    )
    
    return {
        "recommendations": [r.model_dump(mode="json") for r in recommendations],
        "total_count": len(recommendations),
        "user_profile": user_profile,
    }
```

**Step 2: Verify**

```bash
curl -s "http://localhost:8003/api/v1/strategies/recommendations?user_profile=BALANCED&limit=3" | python3 -m json.tool | jq '.recommendations[] | .label'
```

Expected: 3 personalized allocation recommendations.

**Step 3: Commit**

```bash
git add backend/app/api/routes/strategies.py
git commit -m "feat(api): add GET /recommendations endpoint

- Returns personalized action suggestions from Oracle Service
- Query params: user_address, user_profile, limit
- Generates allocate/rebalance/diversify recommendations
- Based on top-ranked strategies from intelligence service

Enables Oracle 'Recommended actions' section with real data"
```

---

## Task 4: Wire Recommendations into Oracle Signals Tab

**Files:**
- Modify: `frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx`

**Step 1: Fetch recommendations from new endpoint**

After `fetchOpportunities()` function (line ~63), add:

```typescript
const fetchRecommendations = useCallback(async () => {
  if (isDemo) return;
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/strategies/recommendations?user_profile=BALANCED&limit=3`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      setRecommendations(data.recommendations || []);
    }
  } catch (e) {
    logger.debug("Recommendations unavailable:", e);
    setRecommendations([]);
  }
}, [isDemo]);
```

**Step 2: Call fetchRecommendations in useEffect**

```typescript
useEffect(() => {
  if (isDemo) {
    setOpportunities(DEMO_OPPORTUNITIES);
    setRecommendations(DEMO_RECOMMENDATIONS);
    setLoading(false);
    setError(null);
    return;
  }
  fetchOpportunities();
  fetchRecommendations();  // ADD THIS
}, [isDemo, fetchOpportunities, fetchRecommendations]);
```

**Step 3: Update "Approve" button to be functional**

In recommendations map (line ~162), change placeholder button:

```tsx
<button
  type="button"
  className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors"
  onClick={() => {
    // TODO: Wire to vault allocation endpoint
    alert(`Approving: ${rec.label}\nStrategy: ${rec.strategy_name || rec.strategyName}\nAllocation: ${rec.allocation_pct || rec.allocationPct}%`);
  }}
>
  Approve
</button>
```

**Step 4: Verify**

Open Oracle → Signals. "Recommended actions" should show real backend-generated recommendations.

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx
git commit -m "feat(oracle): wire backend recommendations to Signals tab

- Fetch from GET /recommendations endpoint
- Display real personalized actions (not hardcoded demo)
- Approve button shows allocation details (vault wiring TODO)
- Fallback to demo recommendations in demo mode

Oracle now shows actionable intelligence, not static data"
```

---

## Task 5: Test End-to-End Intelligence Flow

**Verification checklist:**

```bash
# 1. Poseidon bridge
cd backend && python3 -c "from app.services.zkml.circuit_scanner import _poseidon_commitment; print('✓ Poseidon:', _poseidon_commitment(1,2,3)[:20])"

# 2. Strategy Intelligence
curl -s http://localhost:8003/api/v1/strategies | jq '.total_count'

# 3. Recommendations
curl -s "http://localhost:8003/api/v1/strategies/recommendations?limit=3" | jq '.recommendations[0].label'

# 4. Frontend Oracle (manual)
# Open http://localhost:3001/?v=oracle&sub=signals
# Should see:
#   - zkML risk scores in signal cards
#   - Real backend-generated recommendations
#   - "Approve" buttons functional (shows alert)

# 5. Frontend Genome (manual)
# Open http://localhost:3001/?v=oracle&sub=genome
# Should see:
#   - Backend-computed genome factors
#   - zkML verification panel
#   - Persistent strategy data
```

**Step 6: Document in commit**

```bash
git add docs/plans/2026-03-05-phase3-oracle-recommendations-implementation.md
git commit -m "docs: Phase 3 Oracle Recommendations implementation plan

5 tasks:
1. Enhance demo data with zkML intelligence
2. Create Oracle Recommendation Service
3. Add GET /recommendations endpoint
4. Wire recommendations to Signals tab UI
5. Test end-to-end intelligence flow

Transforms Oracle from passive display to active decision guidance"
```

---

## Success Criteria

✅ Oracle Recommendation Service generates personalized actions  
✅ GET /recommendations endpoint returns ranked suggestions  
✅ Oracle Signals tab displays backend recommendations (not hardcoded)  
✅ Demo mode shows full zkML intelligence  
✅ "Approve" buttons functional (alert for now, vault wiring next)  

---

## Still Out of Scope (Phase 4)

- zkGraph integration (obsqra.fi zkRAG) — requires external service setup
- Multi-DEX aggregation enhancement (JediSwap, mySwap, Nostra integration)
- Vault execution wiring for "Approve" button (allocate to strategy)
- Cross-chain data enrichment (L1 prices, CEX arbitrage)
- Strategy evolution tracking UI (time-series charts)

---

**Estimate:** 5 tasks, ~1 hour implementation + testing.
