# zkGraph / zkRAG — Implementation Plan

> **Status:** Draft  
> **Date:** 2026-03-05  
> **Depends on:** [ARCHITECTURE.md](ARCHITECTURE.md)  
> **Estimated effort:** 2–3 days across both codebases

---

## Phase 0: Pre-Requisites (obsqra side, ~2 hours)

These are non-breaking fixes to the obsqra backend that make the integration useful.

### Task 0.1 — Fix Fact Registration Failures

**Problem:** All recent `indexed_facts` rows have `proof_path = 'registration_failed'`. The `IntegrityService.register_fact_in_obsqra_registry()` call is failing.

**Likely cause:** Backend wallet (`BACKEND_WALLET_ADDRESS` in `.env`) may be out of Sepolia ETH, or nonce is desynchronized.

**Action:**
1. Check wallet balance: `starkli balance 0x05fe81...` on Sepolia
2. If low, faucet more Sepolia ETH
3. If nonce issue, inspect `integrity_service.py` error handling — may need to force nonce refresh
4. Verify fix: watch `indexed_facts` for new rows with `proof_path != 'registration_failed'`

**Files:** `backend/app/services/integrity_service.py`, `backend/.env`  
**Risk:** None — fix doesn't change any API surface

### Task 0.2 — Populate indexed_events (Optional)

**Problem:** `indexed_events` has 0 rows. The IndexerService indexes 4 contracts (`INDEXED_CONTRACTS` list) but none have emitted matching events on Sepolia.

**Action (choose one):**
- **Option A:** Add zkdefi's deployed contracts to `INDEXED_CONTRACTS` (VaultController, adapters) — they may emit events
- **Option B:** Emit a test event from one of the existing contracts (e.g. call RiskEngine.calculate_risk_score or AgentOrchestrator.register_agent)
- **Option C:** Skip for now — the indexer already has `indexed_facts` (11K rows); enhance zkRAG retriever to use `indexed_facts` as a data source when `indexed_events` is empty

**Recommendation:** Option C — least risky, most immediate value

**Files:** `backend/app/services/zkrag_retriever.py` (add `indexed_facts` fallback query)

### Task 0.3 — Add Structured Response Format

**Problem:** zkRAG `/query` returns free text prose. Programmatic parsing is fragile.

**Action:** Add `format` field to `ZkRAGQuery`:
```python
class ZkRAGQuery(BaseModel):
    query: str
    format: str = "text"  # "text" | "structured"
```

When `format="structured"`, return:
```json
{
  "query": "...",
  "results": [
    { "block_number": 123, "contract": "0x...", "event_key": "...", "data": {...} }
  ],
  "provenance": { "fact_hash": "...", "block_range": "...", "merkle_root": "...", "sources": 5 },
  "response_hash": "0x...",
  "query_id": "0x..."
}
```

**Files:** `backend/app/api/routes/zkrag.py`, `backend/app/services/zkrag_retriever.py`  
**Risk:** None — additive field, `format="text"` is the default (backward compatible)

---

## Phase 1: ZkGraph Client (zkdefi side, ~4 hours)

### Task 1.1 — Create Data Models

**File:** `zkdefi/backend/app/models/zkgraph.py`

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class ZkGraphProvenance:
    fact_hash: str = ""
    block_range: str = ""
    merkle_root: str = ""
    source_count: int = 0
    verified_on_chain: bool = False

@dataclass
class ZkGraphResult:
    query: str = ""
    response: str = ""
    query_id: str = ""
    response_hash: str = ""
    provenance: ZkGraphProvenance = field(default_factory=ZkGraphProvenance)
    results: list[dict] = field(default_factory=list)  # structured results
    cached: bool = False

@dataclass
class MarketContext:
    pool_id: str = ""
    source: str = "zkrag"  # "zkrag" | "local_only" | "pending_index"
    context_text: str = ""
    provenance: Optional[ZkGraphProvenance] = None
    enrichments: dict = field(default_factory=dict)
    verified: bool = False

@dataclass
class StrategyMatch:
    strategy_id: str = ""
    similarity_score: float = 0.0
    historical_apy: float = 0.0
    block_range: str = ""
    provenance: Optional[ZkGraphProvenance] = None

@dataclass
class HistoricalPattern:
    pattern_type: str = ""  # "volatility_spike", "tvl_drain", "yield_compression"
    description: str = ""
    block_range: str = ""
    confidence: float = 0.0
    provenance: Optional[ZkGraphProvenance] = None
```

### Task 1.2 — Create ZkGraphClient

**File:** `zkdefi/backend/app/services/zkgraph_client.py`

Pattern: Exactly like `ObsqraProverClient` — singleton, httpx async, local:8002 → remote fallback.

Key design decisions:
- **TTL cache:** In-memory dict with expiry timestamps (no Redis dependency)
- **Graceful fallback:** Every method returns a "local_only" result on failure
- **Max 10 req/min:** Token bucket rate limiter
- **5s timeout:** Per call (vs ObsqraProverClient's 300s for proofs)
- **Structured format:** Always request `format=structured` from zkRAG

```python
class ZkGraphClient:
    def __init__(self):
        self.base_url = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")
        self.remote_url = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")
        self._cache: dict[str, tuple[float, Any]] = {}  # key → (expiry_ts, value)
        self._client: httpx.AsyncClient | None = None

    async def query_market_context(self, pool_id: str) -> MarketContext: ...
    async def query_similar_strategies(self, genome: GenomeFactors) -> list[StrategyMatch]: ...
    async def query_historical_patterns(self, strategy_type: str, lookback_blocks: int = 1000) -> list[HistoricalPattern]: ...
    async def verify_provenance(self, query_id: str, fact_hash: str) -> bool: ...
```

### Task 1.3 — Add Environment Variables

**File:** `zkdefi/backend/.env`

```
# zkGraph / zkRAG integration
ZKGRAPH_ENABLED=true
ZKGRAPH_CACHE_TTL_MARKET=60
ZKGRAPH_CACHE_TTL_HISTORICAL=300
ZKGRAPH_MAX_RPM=10
ZKGRAPH_TIMEOUT=5
```

### Task 1.4 — Unit Tests

**File:** `zkdefi/backend/tests/test_zkgraph_client.py`

- Mock httpx responses for all 3 zkRAG endpoints
- Test cache hit / miss / expiry
- Test graceful fallback when obsqra is down
- Test rate limiting
- Test provenance parsing

---

## Phase 2: Intelligence Enrichment (zkdefi side, ~6 hours)

### Task 2.1 — Enrich LLM Engine

**File:** `zkdefi/backend/app/services/llm_engine.py`

**Change:** Before calling OpenAI, query zkRAG for market context and inject it into the system prompt.

```python
# In recommend_allocation(), before the LLM call:
if ZKGRAPH_ENABLED:
    zkgraph = get_zkgraph_client()
    contexts = []
    for pool in pools[:3]:  # Top 3 pools only to limit prompt size
        ctx = await zkgraph.query_market_context(pool.get("pool_id", ""))
        if ctx.source != "local_only":
            contexts.append(ctx)
    
    if contexts:
        context_block = "\n".join([
            f"[Verified on-chain context for {c.pool_id}] "
            f"(fact_hash={c.provenance.fact_hash[:16]}..., "
            f"blocks={c.provenance.block_range}): {c.context_text}"
            for c in contexts if c.provenance
        ])
        system_prompt += f"\n\nVerified on-chain intelligence:\n{context_block}"
```

**Guard:** Feature-flagged via `ZKGRAPH_ENABLED`. If disabled or zkRAG fails, LLM works exactly as before.

### Task 2.2 — Enrich Oracle Recommendations

**File:** `zkdefi/backend/app/services/oracle_recommendation_service.py`

**Change:** After ranking strategies, query zkRAG for historical patterns on the top candidates.

```python
# After generating initial recommendations:
if ZKGRAPH_ENABLED:
    for rec in recommendations[:3]:
        patterns = await zkgraph.query_historical_patterns(rec.strategy_id)
        if patterns:
            rec.reasoning += f" Historical: {patterns[0].description}"
```

### Task 2.3 — Enrich Strategy Intelligence

**File:** `zkdefi/backend/app/services/strategy_intelligence_service.py`

**Change:** When computing genome, provide historical performance context.

```python
# In compute_genome() or create_or_update_strategy():
# Add an optional `historical_context` field to GenomeFactors
# Populated via ZkGraphClient when available
```

### Task 2.4 — Add zkRAG Context to Proof Pipeline

**File:** `zkdefi/backend/app/services/proof_pipeline.py`

**Change:** Before `_generate_execution_proof()`, query zkRAG for context and include the `fact_hash` in proof metadata.

```python
# In generate_rebalancing_proofs():
zkrag_context = None
if ZKGRAPH_ENABLED:
    zkgraph = get_zkgraph_client()
    zkrag_context = await zkgraph.query_market_context(pool_id)
    if zkrag_context.provenance and zkrag_context.verified:
        proof_metadata["zkrag_fact_hash"] = zkrag_context.provenance.fact_hash
        proof_metadata["zkrag_block_range"] = zkrag_context.provenance.block_range
```

This way, every proof in the registry carries a reference to the historical context that informed it.

### Task 2.5 — (Optional) Expose via zkdefi API

**File:** `zkdefi/backend/app/api/routes/zkgraph.py`

Optional: Expose zkGraph enrichment to the frontend for display in the Oracle surface.

```python
@router.get("/context/{pool_id}")
async def get_pool_context(pool_id: str):
    """Get zkRAG-enriched context for a pool."""
    client = get_zkgraph_client()
    ctx = await client.query_market_context(pool_id)
    return {
        "pool_id": ctx.pool_id,
        "source": ctx.source,
        "context": ctx.context_text,
        "provenance": asdict(ctx.provenance) if ctx.provenance else None,
        "verified": ctx.verified,
    }
```

---

## Phase 3: Frontend Display (zkdefi side, ~3 hours)

### Task 3.1 — Provenance Badge Component

**File:** `zkdefi/frontend/src/components/zkdefi/ProvenanceBadge.tsx`

Small component showing provenance status:
- Green shield icon + "Verified" when `verified_on_chain = true`
- Yellow icon + "Attested" when provenance exists but not verified
- Gray icon + "Local" when no zkRAG data available
- Tooltip showing fact_hash, block_range on hover

### Task 3.2 — Oracle Surface Enrichment

**Files:** Oracle sub-tab components

Add provenance badges to:
- Strategy cards in Signals tab
- Recommendation cards in Oracle
- Risk scores in Genome tab

### Task 3.3 — Brain Surface: zkRAG Tab

**File:** `zkdefi/frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx`

Add a "zkRAG" sub-tab in the Brain surface that shows:
- Recent zkRAG queries made by the intelligence services
- Provenance chain for each query
- Verification status

---

## Phase 4: Hardening (both sides, ~2 hours)

### Task 4.1 — Monitor Integration Health

Add a health check endpoint in zkdefi:
```python
@router.get("/zkgraph/health")
async def zkgraph_health():
    client = get_zkgraph_client()
    reachable = await client.health_check()
    return {
        "zkrag_reachable": reachable,
        "cache_size": len(client._cache),
        "last_query_age_seconds": ...,
        "fact_registration_healthy": ...,
    }
```

### Task 4.2 — Logging & Metrics

- Log every zkRAG query with timing, cache hit/miss, provenance fact_hash
- Track failed queries (obsqra down, timeout, empty response)
- Alert if >50% queries return "no indexed data"

### Task 4.3 — Integration Test

End-to-end test:
1. zkdefi backend calls obsqra zkRAG → gets response with provenance
2. Verifies fact_hash on-chain
3. Uses context in LLM call
4. Generates proof with zkRAG fact_hash in metadata
5. Submits proof to sequencer

---

## Execution Order

```
Phase 0 (obsqra prep)     ── 0.1 Fix fact reg ── 0.3 Structured format ──┐
                                                                          │
Phase 1 (zkdefi client)   ── 1.1 Models ── 1.2 Client ── 1.3 Env ── 1.4 Tests
                                                                          │
Phase 2 (enrichment)      ── 2.1 LLM ── 2.2 Oracle ── 2.3 Strategy ── 2.4 Pipeline
                                                                          │
Phase 3 (frontend)        ── 3.1 Badge ── 3.2 Oracle ── 3.3 Brain        │
                                                                          │
Phase 4 (hardening)       ── 4.1 Health ── 4.2 Logging ── 4.3 E2E test ──┘
```

**Phase 0 and Phase 1 can be parallelized:** obsqra fixes happen independently of zkdefi client construction.

**Phase 2 must follow Phase 1:** Intelligence services depend on `ZkGraphClient`.

**Phase 3 can start after 2.5 (API):** Frontend depends on the zkdefi API exposing zkGraph data.

---

## Acceptance Criteria

- [ ] `ZkGraphClient` successfully queries obsqra zkRAG and returns structured data
- [ ] Cache prevents >10 RPM to obsqra
- [ ] LLM allocation decisions include attested context when available
- [ ] Oracle recommendations show provenance badges
- [ ] Proof pipeline records `zkrag_fact_hash` in proof metadata
- [ ] Integration health endpoint shows connectivity status
- [ ] All existing tests still pass (no regressions)
- [ ] obsqra backend unmodified for Phase 1 integration (no breaking changes)
