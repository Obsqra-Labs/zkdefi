# zkGraph / zkRAG Integration Architecture

> **Status:** Design — not yet implemented  
> **Date:** 2026-03-05  
> **Author:** Product Engineering (Copilot + Team)  
> **Scope:** How zkdefi ingests verifiable intelligence from obsqra.fi's zkRAG proven-index service

---

## 1. What Exists Today

### 1.1 obsqra.fi Side (Producer)

| Component | Path | State |
|-----------|------|-------|
| **IndexerService** | `/opt/obsqra.starknet/backend/app/services/indexer_service.py` | **Running**. Polls Juno RPC, writes `indexed_blocks` (4.8M rows). Produces attested snapshots every 100 blocks → `indexed_facts` (11.1K rows). |
| **Proven Index DB** | PostgreSQL `obsqra` → `indexed_events`, `indexed_facts`, `proof_jobs` | `indexed_events` = **0 rows** (contracts haven't emitted matching events yet). `indexed_facts` = 11,116 snapshots. Recent snapshots have `proof_path = 'registration_failed'` — on-chain fact registration is currently failing. |
| **ZkRAGRetriever** | `backend/app/services/zkrag_retriever.py` | Deterministic SQL retrieval (not embeddings). Parses NL query → intent → SQL filter → `indexed_events` → `AttestedContext` (fact_hash, block_range, merkle_root, source_count). |
| **zkRAG API** | `backend/app/api/routes/zkrag.py` | 3 endpoints: `POST /query`, `GET /audit/{query_id}`, `POST /verify/{query_id}`. Live at `https://starknet.obsqra.fi/api/v1/zkrag/`. |
| **zkRAG Frontend** | `frontend/src/app/zkrag/page.tsx` | Chat UI at `starknet.obsqra.fi/zkrag`. Posts NL queries, renders provenance metadata. |
| **IntegrityService** | `backend/app/services/integrity_service.py` | Herodotus Integrity Verifier on Starknet L2. `register_fact_in_obsqra_registry()` and `verify_fact_in_obsqra_registry()`. |
| **Proof Aggregator** | `backend/app/services/proof_aggregator.py` | Batches proofs (batch_size=8, timeout=60s), registers aggregate fact hash on-chain. |
| **Proof Sequencer** | `backend/app/services/proof_sequencer.py` | Block-based proof settlement (30s blocks, 32 proofs/block max). Supports Madara appchain future settlement. |
| **Verifier Node** | `/opt/obsqra.starknet/verifier-node/src/verifier.py` (PM2: `obsqra-verifier`) | Polls `/api/v1/index/snapshots`, verifies fact_hash on-chain, submits attestations to `AttestationRegistry`. Supports staking check. |
| **Stone CPU AIR** | `/opt/obsqra.starknet/stone-prover/` | Local STARK proof binary. Used by `stone_prover_service.py`. |
| **Dual Prover** | `backend/app/services/dual_prover_service.py` | STARK + Groth16. The STARK fact_hash is embedded as a public input in the Groth16 proof, binding both systems cryptographically. |
| **Key Contracts** | Cairo in `/opt/obsqra.starknet/contracts/src/` | `AttestationRegistry` (N-of-M quorum), `VerifierStaking` (stake/slash), `RiskEngine`, `StrategyRouter`, `AgentOrchestrator`, `ModelRegistry`, `AuditTrail` |

### 1.2 zkdefi Side (Consumer)

zkdefi already has 3 HTTP clients that talk to obsqra at port 8002:

| Client | File | What it does |
|--------|------|-------------|
| **ObsqraProverClient** | `zkdefi/backend/app/services/obsqra_prover_client.py` | STONE cloud STARK proof generation + Garaga calldata formatting |
| **ProofSequencerClient** | `zkdefi/backend/app/services/proof_sequencer_client.py` | Submits every EZKL proof to obsqra's `/aggregation/submit` for batching → settlement |
| **SnapshotAttestationService** | `zkdefi/backend/app/services/snapshot_attestation_service.py` | Registers `MarketSnapshot` hashes on-chain before ML inference |

zkdefi's intelligence services that would **consume** zkRAG enrichment:

| Service | File | Current source | Gap |
|---------|------|---------------|-----|
| `StrategyIntelligenceService` | `strategy_intelligence_service.py` | In-memory strategy repo | No historical pattern retrieval |
| `OracleRecommendationService` | `oracle_recommendation_service.py` | StrategyIntelligence only | No cross-protocol context |
| `MarketSurfaceService` | `market_surface_service.py` | Ekubo + JediSwap | No verifiable provenance on data |
| `LLMEngine` | `llm_engine.py` | OpenAI GPT-4o-mini | No attested context in prompt |
| `AIAllocation` | `ai_allocation.py` | LLM + deterministic | No historical allocation performance |
| `MainnetOracle` | `mainnet_oracle.py` | JediSwap + Ekubo mainnet | No proven-index enrichment |

### 1.3 Database Landscape

| Database | Location | Owned by | Key tables |
|----------|----------|----------|------------|
| PostgreSQL `obsqra` | localhost:5432 | obsqra backend | `indexed_blocks` (4.8M), `indexed_facts` (11.1K), `indexed_events` (0), `proof_jobs` (219) |
| SQLite `proof_registry.db` | zkdefi/backend/app/data/ | zkdefi | `proofs` (2 rows) |
| SQLite `ledger.db` | zkdefi/backend/data/ | zkdefi | Double-entry ledger |
| SQLite `agents.db` | zkdefi/backend/data/ | zkdefi | Agent registry |
| SQLite `merkle_tree.db` | zkdefi/backend/data/ | zkdefi | Merkle tree state |

---

## 2. The Problem

zkdefi's AI dashboard makes intelligent decisions (allocation, rebalancing, risk scoring) but those decisions are **blind to historical on-chain context**. The data informing decisions comes from live API feeds (Ekubo, JediSwap) with no:

1. **Historical memory** — Can't query "what did allocation performance look like the last time ETH/USDC volatility spiked?"  
2. **Cross-protocol intelligence** — Can't retrieve "which strategies performed best across all indexed contracts?"  
3. **Verifiable provenance** — Data used in decisions has no cryptographic proof of existence at decision time  
4. **Pattern recognition** — No vector similarity or intent-based retrieval of comparable past states

Meanwhile, obsqra.fi has a **proven index** with 11K attested snapshots covering 4.8M blocks, a working zkRAG chat demo, and an API that returns responses with full provenance chains. But it's completely disconnected from zkdefi's intelligence loop.

---

## 3. Design: zkGraph Service

The integration is a **new HTTP client** in zkdefi (the 4th obsqra client), following the same singleton pattern as `ObsqraProverClient`.

### 3.1 Service: `ZkGraphClient`

```
zkdefi/backend/app/services/zkgraph_client.py
```

**Responsibilities:**
1. Query obsqra zkRAG for contextual intelligence (`POST /api/v1/zkrag/query`)
2. Retrieve and cache audit trails (`GET /api/v1/zkrag/audit/{query_id}`)
3. Verify provenance of responses (`POST /api/v1/zkrag/verify/{query_id}`)
4. Expose structured methods for each intelligence use case
5. Cache responses locally to avoid hammering the parent

**Key methods:**

```python
class ZkGraphClient:
    async def query_market_context(pool_id: str) -> MarketContext
    async def query_similar_strategies(genome_vector: GenomeFactors) -> list[StrategyMatch]
    async def query_historical_patterns(strategy_type: str, lookback_blocks: int) -> list[Pattern]
    async def enrich_opportunity(pool_data: dict) -> EnrichedOpportunity
    async def get_allocation_history(risk_profile: str) -> list[AllocationSnapshot]
    async def verify_provenance(query_id: str, fact_hash: str) -> ProvenanceVerification
```

**Data flow:**

```
zkdefi Intelligence Service
  → ZkGraphClient.query_market_context("ETH/USDC")
    → HTTP POST obsqra:8002/api/v1/zkrag/query
       body: {"query": "Recent events for ETH/USDC pool allocation risk"}
    ← { response, provenance: { block_range, fact_hash, merkle_root, sources } }
  → Parse response into structured MarketContext
  → Verify provenance if critical decision
  → Cache locally (TTL: 60s for market, 300s for historical)
  → Return enriched context to caller
```

### 3.2 Integration Points (Where it plugs in)

| Consumer | How it calls ZkGraphClient | What it gets |
|----------|---------------------------|-------------|
| **LLMEngine** | Inject attested context into system prompt before GPT call | "Ground in on-chain facts: [context]. Provenance: fact_hash=0x..." → LLM sees verified data |
| **AIAllocation** | Call `get_allocation_history(risk_profile)` before computing allocation | Historical allocation performance to inform new allocation |
| **OracleRecommendationService** | Call `query_similar_strategies(genome)` to find comparable past strategies | Recommendations enriched with historical outcomes |
| **StrategyIntelligenceService** | Call `enrich_opportunity(pool_data)` when computing genome | Genome factors augmented with on-chain history |
| **MarketSurfaceService** | Call `query_market_context(pool_id)` alongside live feeds | Attested market context merged with live data |
| **ProofPipeline** | After enrichment, `verify_provenance(query_id, fact_hash)` → record in proof registry | Every AI decision that used zkRAG data has a provable audit trail |

### 3.3 Response Model

```python
@dataclass
class ZkGraphResponse:
    """Parsed response from obsqra zkRAG with structured provenance."""
    raw_response: str
    query_id: str
    response_hash: str
    provenance: ZkGraphProvenance
    parsed_data: dict  # Structured extraction from response text
    cached: bool = False
    verified: bool = False

@dataclass
class ZkGraphProvenance:
    """Cryptographic provenance chain from the proven index."""
    fact_hash: str       # SHA-256 registered in Obsqra FactRegistry
    block_range: str     # e.g. "4836601-4836700"
    merkle_root: str     # Merkle root of indexed events in this range
    source_count: int    # Number of on-chain sources in response
    verified_on_chain: bool = False  # Set after verify_provenance() call
```

---

## 4. Data Flow Diagrams

### 4.1 Query Flow (Read Path)

```
┌────────────────────┐    ┌───────────────────┐    ┌────────────────────────┐
│   zkdefi Frontend  │    │   zkdefi Backend   │    │    obsqra Backend      │
│   (Oracle Surface) │    │   (Intelligence)   │    │    (port 8002)         │
└────────┬───────────┘    └─────────┬──────────┘    └───────────┬────────────┘
         │                          │                            │
         │ GET /oracle/signals      │                            │
         │─────────────────────────>│                            │
         │                          │                            │
         │                          │ ZkGraphClient.query_       │
         │                          │  market_context("ETH/USDC")│
         │                          │───────────────────────────>│
         │                          │                            │
         │                          │                  ┌─────────┤
         │                          │                  │ zkRAG   │
         │                          │                  │ Retriever│
         │                          │                  │ → SQL    │
         │                          │                  │ → indexed│
         │                          │                  │   _facts │
         │                          │                  └─────────┤
         │                          │                            │
         │                          │<───────────────────────────│
         │                          │ { response, provenance:    │
         │                          │   { fact_hash, block_range,│
         │                          │     merkle_root, sources } }│
         │                          │                            │
         │                   ┌──────┤                            │
         │                   │Cache │                            │
         │                   │Parse │                            │
         │                   │Merge │                            │
         │                   │with  │                            │
         │                   │live  │                            │
         │                   │data  │                            │
         │                   └──────┤                            │
         │                          │                            │
         │<─────────────────────────│                            │
         │ { signals: [...],        │                            │
         │   provenance: {          │                            │
         │     fact_hash, verified }}│                            │
```

### 4.2 Write Path (Proof Pipeline with zkRAG Attestation)

```
 zkdefi ProofPipeline
       │
       ├─ 1. SnapshotAttestationService.attest_snapshot(market_data_hash)
       │      → obsqra:8002/api/v1/facts/register
       │      ← { fact_hash, tx_hash }
       │
       ├─ 2. ZkGraphClient.query_market_context(pool_id)
       │      → obsqra:8002/api/v1/zkrag/query
       │      ← { response, provenance: { fact_hash, block_range } }
       │
       ├─ 3. ML Inference (EZKL Prover)
       │      Input: market_data + zkRAG_context
       │      Output: allocation + proof
       │
       ├─ 4. ProofSequencerClient.submit_proof(proof_id, fact_hash)
       │      → obsqra:8002/api/v1/aggregation/submit
       │      ← { accepted, block_number }
       │
       └─ 5. ProofRegistryService.register(proof_hash, model, user)
              → Starknet: ValidationProofRegistry.register_proof()
              ← { tx_hash, on_chain_proof_id }
```

The critical addition is **step 2**: before ML inference, the pipeline queries zkRAG for historical context, and that context's `fact_hash` becomes part of the audit trail. The ML decision is now grounded in two attested sources:
- The **live market snapshot** (step 1, attested before inference)
- The **historical context** (step 2, fact_hash from proven index)

---

## 5. What Needs to Happen on the obsqra Side

### 5.1 No Breaking Changes Required

zkdefi will only call existing endpoints:
- `POST /api/v1/zkrag/query` (existing)
- `GET /api/v1/zkrag/audit/{query_id}` (existing)
- `POST /api/v1/zkrag/verify/{query_id}` (existing)

### 5.2 Improvements Needed (Non-Breaking Additions)

| Change | Why | Risk |
|--------|-----|------|
| **Fix fact registration** | Recent snapshots all show `proof_path = 'registration_failed'`. Probably a wallet nonce/balance issue. Without this, provenance verification returns `fact_hash_on_chain = false`. | **Low** — Debug existing wallet tx. No API change. |
| **Populate `indexed_events`** | 0 rows despite 11K snapshots. The indexer generates snapshots over empty event sets. zkRAG queries against `indexed_events` return nothing. Either existing contracts need to emit events, or we add new contracts to the `INDEXED_CONTRACTS` list. | **Medium** — Need to identify which contracts are emitting events on Sepolia and add them. |
| **Add structured response fields** | Currently `generate_response()` returns free text. For programmatic consumption, add optional `?format=structured` to return JSON arrays instead of prose. | **Low** — New optional param, backward compatible. |
| **Rate limiting / API key** | zkdefi will make automated calls; needs auth/rate limiting to prevent self-DDoS. | **Low** — Already has `OBSQRA_API_KEY` plumbing. |

### 5.3 Future: New Endpoints (Phase 2)

These are **additive** — existing endpoints untouched:

```
POST /api/v1/zkrag/query/structured
  → Returns { intent, results: [...], provenance } instead of free text

GET /api/v1/zkrag/context/{contract_address}
  → Returns all indexed events for a contract with provenance

GET /api/v1/zkrag/patterns?type=risk_engine&lookback=1000
  → Returns historical pattern summary
```

---

## 6. Risks and Mitigations

### 6.1 Availability

**Risk:** obsqra backend (port 8002) goes down → zkdefi intelligence degrades.

**Mitigation:** Same pattern as `ObsqraProverClient` — graceful fallback:
```python
async def query_market_context(self, pool_id: str) -> MarketContext:
    try:
        result = await self._query_zkrag(...)
        return self._parse_market_context(result)
    except Exception:
        logger.warning("zkRAG unavailable, using local context only")
        return MarketContext(source="local_only", verified=False)
```

zkdefi **never hard-fails** on zkRAG unavailability. All existing intelligence works without it; zkRAG is pure enrichment.

### 6.2 Stale Data

**Risk:** `indexed_events` has 0 rows — zkRAG returns "no data found" for everything.

**Mitigation:** 
1. Short-term: ZkGraphClient recognizes "no indexed data" responses and marks `source="pending_index"`
2. Medium-term: Fix indexer to populate `indexed_events` (contracts may need to emit events, or add new contracts to INDEXED_CONTRACTS)
3. The `indexed_facts` table (11K rows) *does* have data. The zkRAG retriever could be enhanced to query `indexed_facts` directly when `indexed_events` is empty — it already retrieves the latest snapshot for provenance

### 6.3 Circular Dependency

**Risk:** zkdefi calls obsqra for zkRAG → obsqra calls zkdefi? No — the data flow is strictly one-directional: zkdefi reads from obsqra, never the reverse. But both submit proofs to obsqra — the proof pipeline could theoretically create proof storms.

**Mitigation:** Rate-limit ZkGraphClient to max 10 requests/minute. Cache aggressively (60s TTL for market context, 300s for historical patterns). Never call zkRAG in a hot loop.

### 6.4 Trust Model

**Risk:** zkdefi trusts obsqra's response text — can't verify the response actually came from the proven index.

**Mitigation:** After every critical zkRAG query, call `POST /verify/{query_id}` to verify:
1. `fact_hash` is registered on-chain in Obsqra FactRegistry
2. `merkle_root` exists in `indexed_facts`
3. `response_hash` matches the response content

For non-critical queries (UI display), skip verification. For proof-generating decisions, always verify.

### 6.5 Performance

**Risk:** Adding an HTTP round-trip to intelligence services slows down the dashboard.

**Mitigation:**
1. Aggressive caching with TTLs
2. Pre-fetch in background worker (periodic enrichment, not per-request)
3. Parallelise: call zkRAG in parallel with existing live data fetches
4. Timeout: 5s max per zkRAG call, fallback to local-only on timeout

---

## 7. Contract Implications

### 7.1 No New Contracts

The integration uses existing contracts:
- **Obsqra FactRegistry** (`0x059b65...`): Already stores fact hashes from the indexer
- **AttestationRegistry** (obsqra): Already handles verifier attestations
- **ValidationProofRegistry** (zkdefi, `0x20ea...`): Already stores proof hashes

### 7.2 Future: Cross-Registry Linking

When a zkdefi proof uses zkRAG context, the proof's metadata should include the zkRAG `fact_hash`. This creates a cryptographic link:

```
zkdefi proof_hash → includes zkRAG fact_hash → registered in Obsqra FactRegistry
```

Anyone auditing the zkdefi proof can:
1. Read the `fact_hash` from proof metadata
2. Look it up in the Obsqra FactRegistry on Starkscan
3. Verify the data existed before the decision was made

This doesn't require new contracts — just including `fact_hash` as metadata in the `ProofRegistryService.register()` call.

---

## 8. File Inventory (What Gets Created/Modified)

### New Files (zkdefi side)

| File | Purpose |
|------|---------|
| `backend/app/services/zkgraph_client.py` | HTTP client for zkRAG API (4th obsqra client) |
| `backend/app/services/zkgraph_cache.py` | Local TTL cache for zkRAG responses |
| `backend/app/models/zkgraph.py` | Data models: `ZkGraphResponse`, `ZkGraphProvenance`, `MarketContext`, `StrategyMatch`, `Pattern` |
| `backend/app/api/routes/zkgraph.py` | (Optional) Expose zkGraph enrichment as zkdefi API endpoints for frontend |
| `docs/zkgraph-zkrag/ARCHITECTURE.md` | This document |
| `docs/zkgraph-zkrag/IMPLEMENTATION_PLAN.md` | Step-by-step implementation plan |

### Modified Files (zkdefi side)

| File | Change |
|------|--------|
| `backend/app/services/llm_engine.py` | Inject attested context into LLM system prompt |
| `backend/app/services/ai_allocation.py` | Use zkRAG historical allocation data |
| `backend/app/services/oracle_recommendation_service.py` | Enrich recommendations with zkRAG context |
| `backend/app/services/strategy_intelligence_service.py` | Augment genome with on-chain history |
| `backend/app/services/market_surface_service.py` | Merge zkRAG context with live feeds |
| `backend/app/services/proof_pipeline.py` | Add zkRAG context step before inference |
| `backend/.env` | Add `ZKGRAPH_ENABLED=true`, `ZKGRAPH_CACHE_TTL=60` |

### Modified Files (obsqra side) — Phase 2

| File | Change |
|------|--------|
| `backend/app/services/zkrag_retriever.py` | Add `?format=structured` support; query `indexed_facts` as fallback |
| `backend/app/api/routes/zkrag.py` | Add `/query/structured` endpoint |
| `backend/app/services/indexer_service.py` | Debug fact registration failures; add more contracts to index |

---

## 9. Glossary

| Term | Definition |
|------|-----------|
| **Proven Index** | obsqra's PostgreSQL database of indexed on-chain events and attested snapshots |
| **Attested Snapshot** | A Merkle root of indexed events over a 100-block range, with a SHA-256 `fact_hash` registered on-chain |
| **zkRAG** | "zero-knowledge Retrieval-Augmented Generation" — deterministic SQL retrieval against the proven index, with full provenance chain |
| **zkGraph** | The planned service in zkdefi that queries zkRAG for intelligence (the consumer side) |
| **Fact Hash** | SHA-256(merkle_root) registered in the Obsqra FactRegistry smart contract on Starknet Sepolia |
| **Provenance Chain** | query → response + { fact_hash, block_range, merkle_root, source_count, response_hash } — verifiable end-to-end |
| **AttestedContext** | Data retrieved from the proven index with provenance metadata attached |
| **Integrity Service** | Herodotus Integrity Verifier — verifies STARK proofs on Starknet L2 |
| **Dual Prover** | STARK + Groth16 system where STARK fact_hash is embedded as Groth16 public input |
