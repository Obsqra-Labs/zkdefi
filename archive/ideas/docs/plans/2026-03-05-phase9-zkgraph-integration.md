# Phase 9A: zkGraph Integration — Real-Time Attested Intelligence

**Created:** March 5, 2026  
**Status:** RECOMMENDED FOR IMMEDIATE IMPLEMENTATION  
**Prerequisites:** Phase 8 complete (proof verification + receipts)  
**Producer:** starknet.obsqra.fi (zkRAG API) — ALREADY LIVE  
**Consumer:** zkde.fi (Capital OS) — INTEGRATION REQUIRED

---

## Executive Decision: Why Now?

**Recommendation: Implement zkGraph integration immediately in Phase 9A** because:

1. **Already Built on Producer Side:** obsqra.fi has live zkRAG API with structured format, indexed_facts fallback, and 11K+ attested snapshots
2. **Addresses Earlier Concern:** User said "we're missing the zkgraph and a ton of other stuff" for "intelligent data to make our Oracle actionable"
3. **Perfect Timing:** Phase 8 added proof verification — zkGraph provides the **attested data** those proofs should reference
4. **Code Exists:** ZkGraphClient (344 lines) is already written and battle-tested on obsqra
5. **Low Risk:** Fail-open design (falls back to local_only), rate-limited, cached — won't break existing agent
6. **High Value:** LLM gets grounded in real on-chain facts, Oracle gets historical patterns, Proofs get provenance metadata

**Alternative (NOT recommended):** Wait for Phase 10+. This delays the intelligence layer the user explicitly requested and leaves a gap between "we have proofs" and "what data informed those proofs?"

---

## What zkGraph Delivers

### The Core Value Proposition

**Before zkGraph:**
```
Agent Decision
  ├── Based on: Local DB (pool TVL, APY, utilization)
  ├── Provenance: None (no link to on-chain state)
  └── Proof: Verifies execution bounds, not data correctness
```

**After zkGraph:**
```
Agent Decision
  ├── Based on: Local DB + Attested On-Chain Data (fact_hash, block_range)
  ├── Provenance: fact_hash → Integrity Registry → Merkle root → Specific blocks
  ├── LLM Context: "You have access to attested on-chain data from blocks 4836801-4836900..."
  ├── Oracle Context: Historical patterns (TVL divergences, volatility spikes)
  └── Proof: Includes zkrag metadata {fact_hash, block_range, source_count}
```

**Result:** Every agent decision now has an unbroken audit trail from "I allocated $1M to Ekubo ETH/USDC" back to "based on attested data from blocks X-Y with fact_hash Z registered on-chain."

---

## The Three Enrichment Points

### 1. LLM Engine Enrichment

**File:** `backend/app/services/llm_engine.py`  
**Method:** `recommend_allocation()`

**What Changes:**
```python
if ZKGRAPH_ENABLED:
    zk = ZkGraphClient.get_instance()
    ctx = await zk.query_market_context(first_pool_id)
    
    if ctx.source == "zkrag" and ctx.context_text:
        # Inject into GPT-4o-mini system prompt:
        zkrag_context = f"""
        You also have access to attested on-chain data from the obsqra
        proven-index (zkRAG). Use it to ground your recommendation in
        real on-chain activity:
        
        {ctx.context_text}
        """
        
        # Attach provenance to result
        recommendation.zkrag_provenance = {
            "fact_hash": ctx.provenance.fact_hash,
            "block_range": ctx.provenance.block_range,
            "merkle_root": ctx.provenance.merkle_root,
            "source_count": ctx.provenance.source_count,
        }
```

**Impact:** LLM sees real block-level facts instead of just local DB metadata. Risk assessments grounded in on-chain reality.

---

### 2. Oracle Service Enrichment

**File:** `backend/app/services/oracle_recommendation_service.py`  
**Method:** `generate_recommendations()`

**What Changes:**
```python
if ZKGRAPH_ENABLED:
    zk = ZkGraphClient.get_instance()
    patterns = await zk.query_historical_patterns("general", limit=3)
    
    # Build pattern summary
    for action in recommendations:
        action.historical_context = "\n".join([
            f"{p.pattern_type}: {p.description} "
            f"(blocks {p.block_range}, confidence {p.confidence}%)"
            for p in patterns
        ])
```

**Impact:** Oracle recommendations include cross-block intelligence (TVL divergences, volatility spikes, liquidity drains) from proven index.

---

### 3. Proof Pipeline Enrichment

**File:** `backend/app/services/proof_pipeline.py`  
**Method:** `generate_rebalancing_proofs()`

**What Changes:**
```python
if ZKGRAPH_ENABLED:
    zk = ZkGraphClient.get_instance()
    ctx = await zk.query_market_context(pool_id)
    
    if ctx.source == "zkrag" and ctx.provenance:
        proof_result["zkrag"] = {
            "zkrag_fact_hash": ctx.provenance.fact_hash,
            "zkrag_block_range": ctx.provenance.block_range,
            "zkrag_source_count": ctx.provenance.source_count,
        }
```

**Impact:** Proof bundles carry metadata linking them to attested data. Creates end-to-end audit trail.

---

## Implementation Tasks

### Task 1: Copy ZkGraph Client from obsqra Codebase

**Source:** `starknet.obsqra.fi/backend/app/services/zkgraph_client.py` (344 lines)  
**Destination:** `zkde.fi/backend/app/services/zkgraph_client.py`

**What to Copy:**
- `ZkGraphClient` class (singleton, rate-limited, cached)
- Data models: `ZkGraphProvenance`, `ZkGraphResult`, `MarketContext`, `HistoricalPattern`, `StrategyMatch`
- Methods: `query_market_context()`, `query_historical_patterns()`, `query_similar_strategies()`, `verify_provenance()`, `health_check()`

**Verification:**
```bash
cd backend
python3 -c "from app.services.zkgraph_client import ZkGraphClient; print('✓ ZkGraphClient imported')"
```

---

### Task 2: Add API Routes

**File:** `backend/app/api/routes/zkgraph.py` (new)

**Routes to Add:**
- `GET /api/v1/zkdefi/zkgraph/health` - client health check
- `GET /api/v1/zkdefi/zkgraph/context/{pool_id}` - market context for pool
- `GET /api/v1/zkdefi/zkgraph/patterns/{pattern_type}` - historical patterns
- `GET /api/v1/zkdefi/zkgraph/strategies/{strategy_id}` - similar strategies
- `POST /api/v1/zkdefi/zkgraph/verify` - verify fact_hash + response_hash

**Register in `main.py`:**
```python
from app.api.routes.zkgraph import router as zkgraph_router
app.include_router(zkgraph_router, prefix="/api/v1/zkdefi/zkgraph", tags=["zkgraph"])
```

---

### Task 3: Enrich LLM Engine

**File:** `backend/app/services/llm_engine.py`  
**Method:** `recommend_allocation()`

**Changes:**
1. Import `ZkGraphClient`
2. Check `ZKGRAPH_ENABLED` env var
3. Call `query_market_context(pools[0].pool_id)`
4. If `source == "zkrag"`: inject `context_text` into system prompt
5. Attach `zkrag_provenance` to `AllocationRecommendation`

**Test:**
```bash
curl http://localhost:8003/api/v1/zkdefi/agent/allocate \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"goal": "allocate $1000 conservatively", "pool_ids": ["ekubo_eth_usdc"]}'

# Check response includes zkrag_provenance field
```

---

### Task 4: Enrich Oracle Service

**File:** `backend/app/services/oracle_recommendation_service.py`  
**Method:** `generate_recommendations()`

**Changes:**
1. Check `ZKGRAPH_ENABLED`
2. Call `query_historical_patterns("general", limit=3)`
3. Build pattern summary string
4. Attach to each `RecommendedAction.historical_context`

**Test:**
```bash
curl http://localhost:8003/api/v1/zkdefi/agent/oracle/recommend \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"strategy_id": "conservative", "allocation": {"ekubo_eth_usdc": 0.6, "vesu_steth": 0.4}}'

# Check response includes historical_context in recommendations
```

---

### Task 5: Enrich Proof Pipeline

**File:** `backend/app/services/proof_pipeline.py`  
**Method:** `generate_rebalancing_proofs()`

**Changes:**
1. Check `ZKGRAPH_ENABLED`
2. Call `query_market_context(pool_id)`
3. If `source == "zkrag"`: attach metadata to proof result

**Test:**
```bash
# Generate proof and check it includes zkrag metadata
curl http://localhost:8003/api/v1/vault/execute_live \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"user_address": "0x123", "allocations": [{"pool_id": "ekubo_eth_usdc", "amount": 1000000000000000000}]}'

# Inspect proof result for zkrag.zkrag_fact_hash field
```

---

### Task 6: Configuration

**File:** `.env`

Add:
```bash
ZKGRAPH_ENABLED=true
OBSQRA_PROVER_API_URL=http://localhost:8002/api/v1
```

**Fallback Behavior:** When `ZKGRAPH_ENABLED=false` or unset, all three enrichment points silently skip zkGraph. Agent operates as before with local-only data.

---

### Task 7: Documentation Updates

**Files to Update:**
- `docs-site/docs/intro.md` - Add zkGraph section
- `docs-site/docs/architecture-summary.md` - Add zkGraph to architecture diagram
- `docs-site/docs/api-overview.md` - Document zkGraph endpoints
- `backend/README.md` - Add zkGraph service description

**New Page:** `docs-site/docs/zkgraph-integration.md`
- What is zkGraph/zkRAG
- The three enrichment points
- Trust model (what it proves vs. doesn't)
- Configuration guide
- Example queries

---

## Testing Strategy

### Unit Tests

**File:** `backend/tests/test_zkgraph_integration.py`

```python
def test_zkgraph_client_rate_limiting():
    """Test 10 RPM rate limit enforcement"""
    
def test_zkgraph_client_caching():
    """Test 60s market context cache, 300s historical cache"""
    
def test_zkgraph_fallback_on_obsqra_down():
    """Test source='local_only' when obsqra unreachable"""
    
@pytest.mark.asyncio
async def test_llm_enrichment_with_zkgraph():
    """Test LLM gets zkrag_context in system prompt"""
    
@pytest.mark.asyncio
async def test_oracle_enrichment_with_zkgraph():
    """Test Oracle gets historical_context"""
    
@pytest.mark.asyncio
async def test_proof_enrichment_with_zkgraph():
    """Test Proof bundle includes zkrag metadata"""
```

---

### Integration Tests

**Scenario 1: Full Agent Decision with zkGraph**
1. obsqra.fi running with live indexed_facts
2. zkde.fi with `ZKGRAPH_ENABLED=true`
3. Trigger agent allocation
4. Verify:
   - LLM recommendation has `zkrag_provenance`
   - Oracle recommendations have `historical_context`
   - Proof bundle has `zkrag.zkrag_fact_hash`
   - `fact_hash` matches obsqra's latest snapshot

**Scenario 2: Graceful Degradation**
1. Stop obsqra.fi backend
2. Trigger agent allocation
3. Verify:
   - Agent completes successfully
   - All enrichments have `source="local_only"`
   - No exceptions logged

---

## Architecture Impact

### Before zkGraph
```
zkde.fi Agent
  ├── Local DB (pool metrics)
  ├── LLM (GPT-4o-mini with local context)
  ├── Oracle (strategy ranking on local data)
  └── Proof Pipeline (Groth16 proofs, no data provenance)
```

### After zkGraph
```
zkde.fi Agent
  ├── Local DB
  ├── + zkRAG Client (rate-limited, cached, fail-open)
  │     └── Queries obsqra.fi every 60s per pool
  │
  ├── LLM (GPT-4o-mini + attested on-chain context)
  │   └── zkrag_provenance: {fact_hash, block_range, merkle_root}
  │
  ├── Oracle (strategy ranking + historical patterns)
  │   └── historical_context: "TVL divergence (blocks 4836801-4836900, confidence 40%)"
  │
  └── Proof Pipeline (Groth16 + zkRAG metadata)
      └── zkrag: {zkrag_fact_hash, zkrag_block_range, zkrag_source_count}
```

### Provenance Chain
```
Agent Decision
  └── zkrag_provenance.fact_hash = "0x6aed34e6..."
        └── On-chain Integrity Registry (Herodotus L2)
              └── Merkle root of indexed_facts snapshot
                    └── Block range: 4836801-4836900
                          └── Attestation Registry (N-of-M verifier quorum)
```

---

## Risk Assessment

### Low Risk
- ✅ Fail-open design: obsqra down = agent uses local_only, no crashes
- ✅ Rate-limited: 10 RPM prevents overwhelming obsqra
- ✅ Cached: 60s TTL reduces API load
- ✅ Optional: `ZKGRAPH_ENABLED=false` disables entirely
- ✅ Battle-tested: Code already running on starknet.obsqra.fi

### Medium Risk
- ⚠️ Network dependency: Adds HTTP call to critical path (mitigated by caching + fallback)
- ⚠️ obsqra availability: If obsqra is down long-term, agent gets stale data (acceptable — better than no provenance)

### Mitigation
- Cache TTLs tuned for balance: 60s market (fresh enough), 300s historical (stable)
- Monitoring: Add `/zkgraph/health` to uptime checks
- Alerts: Warn if `source="local_only"` for >10 minutes (indicates obsqra issue)

---

## Timeline Estimate

**Total: ~4 hours** (code is written, just integration work)

| Task | Est. Time | Critical Path |
|------|-----------|---------------|
| Copy ZkGraphClient + models | 30 min | Yes |
| Add API routes | 30 min | No |
| Enrich LLM Engine | 45 min | Yes |
| Enrich Oracle Service | 30 min | Yes |
| Enrich Proof Pipeline | 30 min | Yes |
| Configuration + env vars | 15 min | Yes |
| Documentation updates | 1 hour | No |
| Testing + verification | 30 min | Yes |

**Critical path: ~3 hours** (can parallelize docs + API routes)

---

## Success Criteria

**Phase 9A is complete when:**

1. ✅ ZkGraphClient imports successfully
2. ✅ All 5 API routes return valid responses
3. ✅ LLM recommendations include `zkrag_provenance` when `ZKGRAPH_ENABLED=true`
4. ✅ Oracle recommendations include `historical_context`
5. ✅ Proof bundles include `zkrag` metadata
6. ✅ Agent completes successfully when obsqra is down (fail-open test)
7. ✅ Rate limiting enforced (11th request in 1 minute rejected)
8. ✅ Cache verified (same pool query within 60s = cache hit)
9. ✅ Documentation updated with zkGraph integration guide
10. ✅ `/zkgraph/health` shows `available: true`

---

## Next Phase After zkGraph

**Phase 9B: Frontend Privacy UI + Testing**
- Privacy Vault UI (shielded deposit/withdraw screens)
- zkGraph dashboard widget on Capital OS
- Provenance display (fact_hash → Starkscan link)
- End-to-end testing on Sepolia

**Phase 10: Private DAO Governance**
- Multi-sig emergency controls
- Private voting on constraints
- Quadratic/conviction voting

---

## Recommendation: GO

**Why implement zkGraph now:**
1. Producer (obsqra.fi) ready ✅
2. Consumer code (ZkGraphClient) written ✅
3. Addresses user's "intelligent data" concern ✅
4. Completes the "Privacy + Verification" story ✅
5. Low risk, high value ✅
6. Only 3-4 hours of integration work ✅

**Alternative (wait for Phase 10+) means:**
- Agent makes decisions without attested data provenance ❌
- Oracle lacks historical pattern intelligence ❌
- Proofs have no link to on-chain state that informed them ❌
- Gap between "we verify execution" and "what data did we use?" ❌

**Decision: Integrate zkGraph in Phase 9A before moving to frontend/testing.**
