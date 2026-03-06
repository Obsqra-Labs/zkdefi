# Capital OS Intelligence Gaps — Comprehensive Analysis

**Date:** 2026-03-05  
**Status:** Analysis complete, Phase 2 plan needed  
**Context:** After completing Phase 1B (zkML risk scoring in opportunities), identified critical missing intelligence layers

---

## Phase 1B: What We Built (COMPLETED ✅)

### Backend:
1. ✅ `PoolRiskEvaluator` — 5-factor risk scoring (liquidity, volatility, volume, slippage, fee tier)
2. ✅ `/api/v1/strategies/opportunities` enhanced with `zkml_risk_score`, `zkml_flags`
3. ✅ `compute_signals` integration (IL/yield/slippage circuits)
4. ✅ `signal_report.py` and `signal_pass_service.py` exist and work

### Frontend:
5. ✅ Oracle Signals tab displays zkML risk scores, flags, circuit details
6. ✅ Oracle Genome tab shows zkML verification panel

### What Works:
- **Risk scoring:** 0-100 scores with color coding (green <30, amber 30-60, red >60)
- **Multi-factor evaluation:** Considers liquidity depth, trading activity, price stability, slippage
- **Flags:** "low_trading_volume_ratio", "high_volatility", etc.

### Known Limitation:
- ⚠️ Full circuit execution (IL/yield/slippage zkML proofs) requires **Poseidon cryptographic bridge** setup
- Currently falls back to evaluator-only scoring (which IS working)

---

## Critical Gaps Identified

### 1. **No Strategy Intelligence Service** ❌

**Current state:**
- Genome factors (Yield, Risk, Volatility, Liquidity, Efficiency) are **computed in frontend** from basic opportunity data
- No persistent Strategy entities in backend
- No historical tracking of strategy performance
- No strategy evolution over time
- No "intelligence" — just reactive display of current data

**What's missing:**
```python
# backend/app/services/strategy_intelligence_service.py — DOES NOT EXIST
class StrategyIntelligenceService:
    def compute_genome(strategy_id) -> GenomeFactors
    def track_performance(strategy_id, timeframe) -> PerformanceMetrics
    def rank_strategies(filters, user_profile) -> List[RankedStrategy]
    def predict_il_risk(pool_id, amount) -> ILPrediction
    def compute_yield_optimality(allocation) -> YieldScore
```

**Impact:** Oracle shows "data" but has no real "intelligence" — it's a glorified data viewer, not an intelligent capital allocation system.

---

### 2. **No zkGraph Integration** ❌

**Current state:**
- Market data comes ONLY from `market_surface_service` (Ekubo pools)
- No real-time enrichment from obsqra.fi zkRAG
- No zkGraph vector retrieval for similar strategies
- No contextual intelligence from historical patterns

**What's missing:**
```python
# backend/app/services/zkgraph_service.py — DOES NOT EXIST
class ZkGraphService:
    def query_similar_strategies(genome_vector) -> List[Strategy]
    def get_market_context(pool_id) -> MarketContext
    def retrieve_historical_patterns(strategy_type) -> Patterns
    def enrich_opportunity(opp_data) -> EnrichedOpportunity
```

**References in docs:**
- `docs/plans/2026-03-05-capital-os-oracle-design.md:176` — "zkGraph integration (obsqra.fi zkRAG/zkGraph) — Phase 2"
- `docs/plans/2026-03-05-phase1b-zkml-opportunities-implementation.md:587` — "zkGraph integration (obsqra.fi zkRAG)"

**Impact:** No "learning" from past performance, no pattern recognition, no contextual recommendations — Oracle is blind to history.

---

### 3. **No Real-Time Data Enrichment** ❌

**Current state:**
- Single data source: Ekubo market surface
- No aggregation from multiple DEXes (JediSwap, mySwap, Nostra, etc.)
- No off-chain data (Coingecko prices, DeFi Llama TVL, etc.)
- No cross-chain context (L1 prices, CEX data)
- Stale data not actively refreshed

**What's missing:**
```python
# backend/app/services/market_enrichment_service.py — DOES NOT EXIST
class MarketEnrichmentService:
    def aggregate_dex_prices(token_pair) -> AggregatedPrice
    def fetch_tvl_trends(pool_id) -> TVLTrend
    def get_cross_chain_arbitrage(pool) -> ArbitrageOpportunity
    def enrich_with_off_chain_data(opp) -> EnrichedOpp
```

**Impact:** Oracle shows limited Ekubo-only data, misses better opportunities on other protocols, can't detect arbitrage, can't validate on-chain data against off-chain sources.

---

### 4. **Execution Proof Pipeline Incomplete** ❌

**Found in code:**
```python
# backend/app/services/proof_pipeline.py:356
# Execution proof not yet implemented — log but don't block
logger.warning(
    "Execution proof generation not yet implemented",
)
```

**What's missing:**
- Proof generation for vault deposits/withdrawals
- Proof verification for strategy allocations
- zkML proof integration with circuit outputs
- Receipt linkage to on-chain proofs

**Impact:** Claims of "proof-gated" and "verifiable" are not fully backed by actual proofs — it's mostly logging and simulation.

---

### 5. **No Oracle Service / Recommendation Engine** ❌

**Current state:**
- `/opportunities` returns raw pool data with risk scores
- No "recommended actions" generation (just hardcoded demo data)
- No personalized suggestions based on user profile/history
- No actionable insights — user must interpret raw data themselves

**What's missing:**
```python
# backend/app/services/oracle_service.py — DOES NOT EXIST
class OracleService:
    def generate_recommendations(user_profile, opportunities) -> List[Action]
    def suggest_rebalance(current_allocation, market_state) -> RebalanceAction
    def detect_risk_events(user_positions) -> List[RiskAlert]
    def optimize_capital_efficiency(constraints) -> Allocation
```

**Impact:** Oracle is passive — shows data but doesn't actively guide user decisions. No proactive "you should do X" intelligence.

---

### 6. **Poseidon Bridge for zkML Circuits** ⚠️

**Current state:**
- `compute_signals` call fails with "Poseidon bridge error"
- Circuits can't generate real proofs without cryptographic primitives
- Falls back to evaluator-based scoring only

**What's missing:**
- Poseidon hash function bridge (Rust/Python FFI or external service)
- zkML circuit witness generation infrastructure
- Proof verification service integration

**Impact:** zkML circuits exist but can't run — "zkML intelligence" is currently just deterministic scoring, not real zero-knowledge proofs.

---

### 7. **No Strategy Persistence & Historical Tracking** ❌

**Current state:**
- Strategies are ephemeral — computed on-demand from market surface
- No database of strategies, no IDs, no versioning
- Can't track "this strategy performed X% over 30 days"
- Can't compare "Strategy A vs Strategy B historically"

**What's missing:**
```python
# backend/app/models/strategy.py — EXISTS but minimal
# backend/app/services/strategy_repository.py — DOES NOT EXIST
class StrategyRepository:
    def save_strategy(genome, metadata) -> StrategyId
    def get_strategy(strategy_id) -> Strategy
    def track_performance(strategy_id, timestamp, metrics)
    def query_strategies(filters) -> List[Strategy]
```

**Impact:** Genome tab can't show "evolution over time", can't persist user's strategy choices, can't learn from which strategies worked.

---

### 8. **Demo Mode Incomplete** ⚠️

**Current state:**
- Demo opportunities exist (`DEMO_OPPORTUNITIES`)
- But demo data doesn't include zkML intelligence fields
- Demo recommendations are hardcoded, not generated
- No demo "next step" flow guidance

**What's missing:**
- Demo data with zkML fields (zkml_risk_score, zkml_signals, zkml_flags)
- Simulated "Approve" actions that update UI state
- Demo ledger entries that show proof hashes
- Demo Brain tab that shows zkML model transparency

**Impact:** Demo mode shows "pretty UI" but not the actual intelligence — can't demo the value prop to users.

---

## Gap Summary Table

| Component | Status | Backend Service | Frontend Display | Intelligence Level |
|-----------|--------|----------------|------------------|-------------------|
| **zkML Risk Scoring** | ✅ Working | PoolRiskEvaluator | Oracle Signals/Genome | Basic (deterministic) |
| **zkML Circuit Proofs** | ⚠️ Partial | compute_signals exists, Poseidon blocked | Circuit details shown | Blocked by crypto bridge |
| **Strategy Intelligence** | ❌ Missing | NO SERVICE | Frontend-computed genome | None — reactive only |
| **zkGraph RAG** | ❌ Missing | NO SERVICE | N/A | None — no context |
| **Market Enrichment** | ❌ Missing | Single source (Ekubo) | Raw pool data only | None — limited data |
| **Oracle Recommendations** | ❌ Missing | NO SERVICE | Hardcoded demo data | None — passive |
| **Execution Proofs** | ⚠️ Partial | proof_pipeline (incomplete) | Proof hashes shown | Logging only, no real proofs |
| **Strategy Persistence** | ❌ Missing | NO REPOSITORY | Ephemeral display | None — no history |

---

## User's Criticism Validated

> "pretty fucking pathetic, no functionality, just widgets that look ugly"

**Analysis:** The user is correct. What we've built is:
- ✅ Beautiful UI components (Oracle tabs, Genome bars, Signal cards)
- ✅ API wiring (backend → frontend data flow)
- ✅ Basic risk scoring (evaluator-based, deterministic)

**But missing:**
- ❌ Real intelligence (no learning, no patterns, no recommendations)
- ❌ Actionable insights (passive data display, not active guidance)
- ❌ Proof-backed claims (circuits blocked, execution proofs unimplemented)
- ❌ Context from zkGraph (no historical intelligence)
- ❌ Multi-source data (single DEX only)

**Verdict:** We built the "presentation layer" but not the "intelligence layer" — it's a dashboard, not an oracle.

---

## Phase 2 Priorities (Ordered by Impact)

### Must-Have (Critical for "real Capital OS"):
1. **Strategy Intelligence Service** — compute real genome factors, rank strategies, track performance
2. **Oracle Recommendation Engine** — generate actionable "Approve/Modify" suggestions, not just data
3. **Market Enrichment** — aggregate data from multiple sources (Ekubo + JediSwap + mySwap + off-chain)

### High Value (Enables learning/context):
4. **zkGraph Integration** — obsqra.fi zkRAG for pattern retrieval, similar strategy discovery, historical context
5. **Strategy Repository** — persist strategies, track performance over time, enable evolution tracking

### Infrastructure (Unblocks features):
6. **Poseidon Bridge** — enable real zkML circuit proof generation (unblocks IL/yield/slippage circuits)
7. **Execution Proof Pipeline** — complete proof generation for deposits/withdrawals/allocations

### Polish (Improves demo/UX):
8. **Enhanced Demo Mode** — full zkML intelligence in demo data, simulated "Approve" flows, model transparency

---

## Next Steps

1. **Create Phase 2 implementation plan** for Strategy Intelligence Service + Oracle Recommendations + Market Enrichment
2. **Investigate Poseidon bridge** — check if obsqra.fi provides this, or if we need to build it
3. **Audit existing zkML circuits** — verify they're ready for production once Poseidon is available
4. **Design Strategy persistence schema** — database models for Strategy entity, performance tracking
5. **Research zkGraph API** — understand obsqra.fi zkRAG endpoints, authentication, rate limits

---

**Recommendation:** Proceed with Phase 2 focused on **Strategy Intelligence Service** first (biggest impact), then **Oracle Recommendations**, then **Market Enrichment**. Poseidon bridge and zkGraph can be parallelized as infrastructure work.
