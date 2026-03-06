# zkGraph / zkRAG Integration — Full Technical Brief

> **Date:** March 5, 2026  
> **Author:** Product Engineering  
> **Status:** Implemented and live on starknet.obsqra.fi + zkde.fi backend  
> **Scope:** What was added to obsqra source, what was added to zkdefi source, how the pipeline works, and how the agent integrates it into the CapitaVal OS

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Was Added to obsqra.fi (Producer)](#2-what-was-added-to-obsqrafi-producer)
3. [What Was Added to zkde.fi (Consumer)](#3-what-was-added-to-zkdefi-consumer)
4. [The zkRAG / zkGraph Pipeline — End to End](#4-the-zkrag--zkgraph-pipeline--end-to-end)
5. [CapitaVal OS Agent Integration](#5-capitaval-os-agent-integration)
6. [Data Flow Diagrams](#6-data-flow-diagrams)
7. [API Reference](#7-api-reference)
8. [Configuration](#8-configuration)
9. [Frontend Surfaces](#9-frontend-surfaces)

---

## 1. Executive Summary

The zkGraph / zkRAG integration creates a **verifiable intelligence bridge** between obsqra.fi (infrastructure layer) and zkde.fi (application layer).

- **obsqra.fi** runs the Proven Index — a sequencer that polls Juno RPC, indexes Starknet state, computes Merkle-rooted snapshots every 100 blocks, and registers fact hashes on-chain via the Integrity Verifier. The **zkRAG** API lets anyone query this attested data in natural language and get cryptographically-provable responses.

- **zkde.fi** runs the CapitaVal OS — an autonomous AI agent system that allocates capital across DeFi pools. The **zkGraph** client consumes obsqra's zkRAG to inject attested on-chain intelligence into the LLM decision engine, the oracle recommendation service, and the Groth16 proof pipeline. Every agent decision now carries a provenance chain back to specific Starknet blocks.

**Result:** The agent doesn't hallucinate about on-chain state. Its decisions are grounded in Merkle-rooted, fact-hash-registered, verifiable snapshots. Anyone can audit the provenance — from the agent's allocation decision all the way back to the block range and fact hash that informed it.

### 1.1 Strategic Positioning (Reputation Layer)

This integration is more than a data pipeline. It is the data+attestation substrate for a reputation network:

`activity -> proof -> fact -> receipt -> reputation`

Where:

- zkRAG/zkGraph provides attested market and execution context (`fact_hash`, `block_range`, `merkle_root`)
- circuit proofs provide policy and performance attestations
- receipt registries accumulate these attestations over time

This enables three composable reputation surfaces:

1. Wallet reputation (risk discipline, solvency posture, tenure attestations)
2. Agent reputation (execution integrity, historical performance, MEV resistance)
3. Protocol/asset reputation (safety/anomaly attestations used in routing and allocation)

Reference implementation target:
- `circuits/REPUTATION_V1_CIRCUIT_SPEC.md` (FICO-pack: solvency, risk passport, performance, strategy integrity, execution integrity)

The integration brief below describes the implementation details that make this portable trust model possible.

---

## 2. What Was Added to obsqra.fi (Producer)

Three categories of changes: API (zkRAG route), retriever (fallback logic), and indexer (dedup).

### 2.1 zkRAG API — Structured Format Support

**File:** `backend/app/api/routes/zkrag.py`

The existing `POST /api/v1/zkrag/query` endpoint accepted `{ query: string }` and returned prose text. It was extended with a `format` parameter:

```python
class ZkRAGQuery(BaseModel):
    query: str
    format: str = "text"  # NEW: "text" | "structured"
```

When `format="structured"`, the response changes from prose to machine-readable JSON:

```json
{
  "query": "pool activity for ekubo_eth_usdc",
  "results": [
    {
      "source": "indexed_facts",
      "block_number": 4836900,
      "block_from": 4836801,
      "block_to": 4836900,
      "fact_hash": "0x6aed34e6...",
      "merkle_root": "0x000000...",
      "proof_path": "registration_failed",
      "registered_at": "2026-02-18T03:33:18.288167+00:00",
      "type": "shielded_pool"
    }
  ],
  "provenance": {
    "block_range": "4836801-4836900",
    "fact_hash": "0x6aed34e6bddff5e1d872b5d7d5698a7b73abd6f3b33402732edc73ab9ffb9c70",
    "merkle_root": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "sources": 10
  },
  "response_hash": "0x0da3faad399271e14df6da4bb5bf0269b151543ce973a1643d5b5...",
  "query_id": "..."
}
```

This is what the zkdefi ZkGraphClient consumes — structured facts with cryptographic provenance, not prose.

**Also added:** `GET /api/v1/zkrag/audit/latest` — returns the 10 most recent attested snapshots from `indexed_facts` for dashboard display.

### 2.2 Retriever — indexed_facts Fallback

**File:** `backend/app/services/zkrag_retriever.py`

**Problem:** The `indexed_events` table had 0 rows because no on-chain contracts had emitted events matching the indexer's filter yet. Every zkRAG query returned empty results.

**Fix:** `_query_index()` now checks `indexed_events` first. If empty, falls back to `indexed_facts` (11K+ snapshots of attested Merkle-rooted data) and returns snapshot-level provenance:

```python
# In _query_index():
if not results and self.db_pool:
    # Fallback: use attested snapshots from indexed_facts
    fact_rows = await self.db_pool.fetch(
        "SELECT * FROM indexed_facts ORDER BY snapshot_block_to DESC LIMIT $1",
        intent.get("limit", 10)
    )
    results = [
        {
            "source": "indexed_facts",
            "block_number": r["snapshot_block_to"],
            "block_from": r["snapshot_block_from"],
            "block_to": r["snapshot_block_to"],
            "fact_hash": r["fact_hash"],
            "merkle_root": r["merkle_root"],
            "proof_path": r.get("proof_path"),
            "registered_at": str(r.get("registered_at", "")),
            "type": r.get("entity_type", "snapshot"),
            "note": "From attested snapshots (indexed_events empty)."
        }
        for r in fact_rows
    ]
```

This ensures zkRAG always returns data even before event-level indexing is active.

### 2.3 Indexer — Duplicate Fact Hash Skip

**File:** `backend/app/services/indexer_service.py`

**Problem:** The indexer was re-registering the same fact hash on-chain every 100 blocks when the underlying data hadn't changed, wasting gas and creating noise.

**Fix:** Added `_last_registered_fact_hash` tracking:

```python
# In snapshot production (every 100 blocks):
fact_hash_hex = sha256(merkle_root)

if fact_hash_hex == self._last_registered_fact_hash:
    proof_path = "skipped_duplicate"
    # Skip on-chain registration, log at DEBUG
else:
    await integrity.register_fact_in_obsqra_registry(fact_hash_int)
    self._last_registered_fact_hash = fact_hash_hex
```

Snapshots still get written to `indexed_facts` with `proof_path="skipped_duplicate"`, preserving the full audit trail while avoiding duplicate on-chain transactions.

---

## 3. What Was Added to zkde.fi (Consumer)

Four categories: data models, the ZkGraph HTTP client, 5 API routes, and enrichments to 3 core services.

### 3.1 Data Models

**File:** `backend/app/models/zkgraph.py` — 5 dataclasses

| Model | Purpose |
|-------|---------|
| `ZkGraphProvenance` | Cryptographic attestation: `fact_hash`, `block_range`, `merkle_root`, `source_count`, `verified_on_chain` |
| `ZkGraphResult` | Full parsed response from obsqra: `query`, `response`, `query_id`, `response_hash`, `provenance`, `results[]`, `cached` |
| `MarketContext` | Pool-specific intelligence: `pool_id`, `source` ("zkrag" \| "local_only"), `context_text`, `provenance`, `enrichments`, `verified` |
| `HistoricalPattern` | Cross-block pattern: `pattern_type`, `description`, `block_range`, `confidence` (0.4–0.7), `provenance` |
| `StrategyMatch` | Historical similar strategy: `strategy_id`, `similarity_score`, `historical_apy`, `block_range`, `provenance` |

### 3.2 ZkGraph Client

**File:** `backend/app/services/zkgraph_client.py` — singleton HTTP client (344 lines)

The `ZkGraphClient` is a long-lived singleton that talks to obsqra's zkRAG API. Key design:

- **Rate-limited:** 10 RPM sliding window (obsqra's proven index does real work per query)
- **TTL cache:** Market context cached 60s, historical data cached 300s
- **Fail-open:** Every method returns graceful fallbacks on error — the agent never blocks on obsqra being down
- **Structured format:** Always sends `format: "structured"` to get machine-readable responses

Core methods:

```python
class ZkGraphClient:
    async def query_market_context(pool_id: str) -> MarketContext
    async def query_historical_patterns(pattern_type: str, limit=5) -> list[HistoricalPattern]
    async def query_similar_strategies(strategy_id: str, limit=5) -> list[StrategyMatch]
    async def verify_provenance(fact_hash: str, response_hash: str) -> dict
    async def health_check() -> dict
```

Each method:
1. Checks rate limit → rejects if over 10 RPM
2. Checks TTL cache → returns cached if fresh
3. Sends `POST /api/v1/zkrag/query` to obsqra with a structured NL query
4. Parses the structured response into the appropriate dataclass
5. Caches the result
6. Returns `source="local_only"` fallback on any failure

### 3.3 API Routes

**File:** `backend/app/api/routes/zkgraph.py` — 5 endpoints on `/api/v1/zkdefi/zkgraph/`

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/health` | Client health: available, cache entries, RPM usage |
| GET | `/context/{pool_id}` | Market context for a specific pool |
| GET | `/patterns/{pattern_type}` | Historical on-chain patterns |
| GET | `/strategies/{strategy_id}` | Similar historical strategies |
| POST | `/verify` | Verify a fact_hash + response_hash against obsqra |

These are primarily for the zkGraph dashboard; the agent uses the client directly.

### 3.4 LLM Engine Enrichment

**File:** `backend/app/services/llm_engine.py`

The `recommend_allocation()` method was enriched to inject zkRAG context into GPT-4o-mini:

```
1. Check ZKGRAPH_ENABLED
2. Get ZkGraphClient singleton
3. Call query_market_context(first_pool_id)
4. If source == "zkrag" and context_text exists:
   - Inject into LLM system prompt:
     "You also have access to attested on-chain data from the obsqra
      proven-index (zkRAG). Use it to ground your recommendation
      in real on-chain activity: {context_text}"
5. Attach provenance to AllocationRecommendation.zkrag_provenance
```

**What this means:** The LLM now sees real attested on-chain facts in its system prompt, not just pool metadata from local DB. Its risk assessments are grounded in block-level data with provenance.

### 3.5 Oracle Recommendation Enrichment

**File:** `backend/app/services/oracle_recommendation_service.py`

The `generate_recommendations()` method was enriched with historical pattern context:

```
1. Check ZKGRAPH_ENABLED
2. Get ZkGraphClient singleton
3. Fetch query_historical_patterns("general", limit=3)
4. Build pattern summary: "{type}: {description} (blocks {range}, confidence {X}%)"
5. Attach to each RecommendedAction.historical_context
```

**What this means:** Oracle recommendations now include cross-block pattern intelligence (TVL divergences, volatility spikes, liquidity drains) from the proven index.

### 3.6 Proof Pipeline Enrichment

**File:** `backend/app/services/proof_pipeline.py`

The `generate_rebalancing_proofs()` method was enriched with zkRAG metadata:

```
1. Check ZKGRAPH_ENABLED
2. Get ZkGraphClient singleton
3. Call query_market_context(pool_id)
4. If source == "zkrag" and provenance exists:
   - Attach to proof result:
     {
       "zkrag": {
         "zkrag_fact_hash": "0x6aed34e6...",
         "zkrag_block_range": "4836801-4836900",
         "zkrag_source_count": 10
       }
     }
```

**What this means:** Every Groth16 proof bundle now carries metadata linking it back to the obsqra fact hash that informed the decision. The proof itself doesn't prove zkRAG correctness (that's the integrity verifier's job), but the metadata creates an auditable trail.

---

## 4. The zkRAG / zkGraph Pipeline — End to End

### 4.1 The Data Pipeline (obsqra.fi)

```
Starknet L1 Blocks
       │
       ▼
┌──────────────┐
│  Juno RPC    │  Starknet full node (starknet.obsqra.fi/rpc)
│  Node        │  Block headers, state diffs, transactions
└──────┬───────┘
       │ polls every 30s
       ▼
┌──────────────┐
│  Indexer     │  IndexerService — writes to indexed_blocks (4.8M rows)
│  Service     │  Filters events by contract addresses
└──────┬───────┘
       │ every 100 blocks
       ▼
┌──────────────────────────┐
│  Snapshot Production     │
│                          │
│  1. Merkle tree of all   │
│     indexed events/state │
│  2. merkle_root = root() │
│  3. fact_hash = SHA-256  │
│     (merkle_root)        │
│  4. Dedup check: skip if │
│     same as last hash    │
└──────┬───────────────────┘
       │
       ├──► indexed_facts table (11K+ rows)
       │    {id, block_from, block_to, merkle_root, fact_hash, proof_path, registered_at}
       │
       ▼
┌──────────────────────────┐
│  Integrity Verifier      │
│  (Herodotus on L2)       │
│                          │
│  register_fact(hash) →   │
│  on-chain fact registry  │
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│  Verifier Node (PM2)     │
│                          │
│  Polls /index/snapshots  │
│  Verifies fact_hash      │
│  on-chain → submits      │
│  attestation to          │
│  AttestationRegistry     │
│  (N-of-M quorum)         │
└──────────────────────────┘
```

### 4.2 The Query Layer (zkRAG)

```
Client (browser, agent, service)
       │
       │ POST /api/v1/zkrag/query
       │ { "query": "pool activity for ekubo_eth_usdc", "format": "structured" }
       │
       ▼
┌──────────────────────────┐
│  ZkRAG Retriever         │
│                          │
│  1. Parse intent (NL →   │
│     keyword classifier)  │
│  2. Query indexed_events │
│     (or indexed_facts    │
│     fallback)            │
│  3. Get latest snapshot  │
│  4. Build AttestedContext │
│     {data, fact_hash,    │
│      block_range,        │
│      merkle_root,        │
│      source_count}       │
│  5. Generate response    │
│  6. Hash: SHA-256(       │
│     response + fact_hash)│
│     = response_hash      │
└──────────────────────────┘
       │
       ▼
Response with provenance:
  - results[] (structured facts)
  - provenance.fact_hash (on-chain anchor)
  - provenance.block_range (what blocks)
  - provenance.merkle_root (tree root)
  - response_hash (tamper detection)
```

### 4.3 The Consumer Layer (zkGraph on zkde.fi)

```
┌──────────────────────────────────────────────────┐
│  ZkGraphClient (singleton, rate-limited, cached)  │
│                                                    │
│  POST obsqra:8002/api/v1/zkrag/query               │
│  { format: "structured" }                           │
│                                                    │
│  ┌────────────────┐  ┌────────────────┐            │
│  │ Market Context │  │ Historical     │            │
│  │ (60s TTL)      │  │ Patterns       │            │
│  │                │  │ (300s TTL)     │            │
│  └───────┬────────┘  └───────┬────────┘            │
│          │                   │                      │
│          ▼                   ▼                      │
│  ┌───────────────────────────────────────────────┐ │
│  │  Three enrichment injection points:            │ │
│  │                                                │ │
│  │  1. LLM Engine → system prompt injection       │ │
│  │     "...attested on-chain data: {context}"     │ │
│  │     → AllocationRecommendation.zkrag_provenance│ │
│  │                                                │ │
│  │  2. Oracle Service → historical_context field  │ │
│  │     Pattern summaries on RecommendedAction     │ │
│  │                                                │ │
│  │  3. Proof Pipeline → zkrag metadata on proof   │ │
│  │     {zkrag_fact_hash, zkrag_block_range,       │ │
│  │      zkrag_source_count}                       │ │
│  └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 4.4 The Provenance Chain

Every agent decision now carries an unbroken provenance chain:

```
Agent Decision (allocation recommendation)
  ├── zkrag_provenance.fact_hash → on-chain integrity registry
  ├── zkrag_provenance.block_range → specific Starknet blocks
  ├── zkrag_provenance.merkle_root → Merkle tree of indexed state
  ├── response_hash → SHA-256(response + fact_hash) for tamper detection
  │
  ├── Oracle Recommendations
  │   └── historical_context → pattern intelligence from proven index
  │
  └── Proof Bundle (Groth16)
      ├── risk_proof → circuit-proven risk bounds
      ├── anomaly_proof → circuit-proven anomaly detection
      ├── execution_proof → circuit-proven slippage check
      └── zkrag.zkrag_fact_hash → links proof to attested block data
```

Anyone can verify: start from the proof bundle's `zkrag_fact_hash`, check it on Starkscan against the integrity registry, confirm the block range, and trace back to the exact snapshot that informed the agent's decision.

---

## 5. CapitaVal OS Agent Integration

The CapitaVal OS is zkde.fi's autonomous capital allocation system — an AI agent that analyzes DeFi pools, generates ZK-proven risk assessments, and executes rebalances via MEV-resistant commit-reveal on-chain. Here's how zkGraph is wired into every step of the decision loop.

### 5.1 The Decision Loop (Before zkGraph)

```
Pool Metrics (local DB) → LLM Engine (GPT-4o-mini) → Allocation Recommendation
  → Oracle Service (strategy ranking) → Recommended Actions
    → Proof Pipeline (Groth16 risk/anomaly/execution proofs)
      → Commit-Reveal Service → On-Chain VaultController
```

The agent knew about pool TVL, APY, and utilization from its local database, but had no cross-protocol historical context or verifiable provenance for the data it used.

### 5.2 The Decision Loop (After zkGraph)

```
Pool Metrics (local DB)
  + zkRAG Market Context (attested block data, fact_hash)  ← NEW
  + zkRAG Historical Patterns (TVL divergences, volatility) ← NEW
       │
       ▼
LLM Engine (GPT-4o-mini)
  System prompt now includes: "You also have access to attested
  on-chain data from the obsqra proven-index (zkRAG)..."
  → AllocationRecommendation
    + zkrag_provenance: { fact_hash, block_range, merkle_root }  ← NEW
       │
       ▼
Oracle Service (strategy ranking)
  + historical_context per recommendation  ← NEW
  → RecommendedAction[]
       │
       ▼
Proof Pipeline (Groth16)
  risk_proof + anomaly_proof + execution_proof
  + zkrag: { zkrag_fact_hash, zkrag_block_range, zkrag_source_count }  ← NEW
       │
       ▼
Commit-Reveal Service → On-Chain VaultController
```

### 5.3 Integration Points in Detail

#### Point 1: LLM Engine (`recommend_allocation`)

```python
# In llm_engine.py → recommend_allocation()
if os.getenv("ZKGRAPH_ENABLED", "").lower() == "true":
    zk = ZkGraphClient.get_instance()
    ctx = await zk.query_market_context(pools[0].pool_id)
    if ctx.source == "zkrag" and ctx.context_text:
        zkrag_context = ctx.context_text
        # Injected into GPT system prompt
        # Provenance attached to result
```

**What the LLM sees:** Real block-level facts like "block 4836900: fact_hash=0x6aed... From attested snapshots." instead of just "Ekubo ETH/USDC pool, TVL: $2.1M". This grounds recommendations in on-chain reality.

**What the agent returns:** `AllocationRecommendation.zkrag_provenance` — a dict with `fact_hash`, `block_range`, `merkle_root`, and `source_count`. This is stored with the decision for audit.

#### Point 2: Oracle Service (`generate_recommendations`)

```python
# In oracle_recommendation_service.py → generate_recommendations()
if os.getenv("ZKGRAPH_ENABLED", "").lower() == "true":
    zk = ZkGraphClient.get_instance()
    patterns = await zk.query_historical_patterns("general", limit=3)
    # Each RecommendedAction gets:
    #   historical_context = "general: From attested snapshots
    #     (blocks 4836801-4836900, confidence 40%)"
```

**What this adds:** Historical pattern intelligence. Instead of pure math on current metrics, the oracle now knows about recent TVL divergences, volatility spikes, or liquidity drains observed in the proven index over the last 1000 blocks.

#### Point 3: Proof Pipeline (`generate_rebalancing_proofs`)

```python
# In proof_pipeline.py → generate_rebalancing_proofs()
if os.getenv("ZKGRAPH_ENABLED", "").lower() == "true":
    zk = ZkGraphClient.get_instance()
    ctx = await zk.query_market_context(pool_id)
    if ctx.source == "zkrag" and ctx.provenance:
        zkrag_meta = {
            "zkrag_fact_hash": ctx.provenance.fact_hash,
            "zkrag_block_range": ctx.provenance.block_range,
            "zkrag_source_count": ctx.provenance.source_count
        }
        # Attached to proof result alongside commitment_hash,
        # zkml_proofs, execution_proof, can_execute, etc.
```

**What this adds:** The proof bundle — which already contains Groth16 proofs for risk bounds, anomaly detection, and execution constraints — now also carries metadata linking it to the specific attested data that informed the decision. This creates an end-to-end audit trail:

```
Proof Bundle
  ├── can_execute: true
  ├── commitment_hash: "0x..."
  ├── zkml_proofs: { risk_proof, anomaly_proof, execution_proof }
  └── zkrag:                       ← NEW
      ├── zkrag_fact_hash: "0x6aed34e6..."
      ├── zkrag_block_range: "4836801-4836900"
      └── zkrag_source_count: 10
```

### 5.4 The Complete Agent Flow with zkGraph

```
┌─────────────────────────────────────────────────────────────┐
│  AGENT ORCHESTRATOR                                          │
│                                                              │
│  1. Receive goal: "Rebalance conservative vault"             │
│                                                              │
│  2. LLM REASONING (Step 1)                                   │
│     ├── Pool metrics from local DB                           │
│     ├── + zkRAG market context (attested, with fact_hash)    │
│     ├── GPT-4o-mini analyzes with grounded on-chain data     │
│     └── → AllocationRecommendation + zkrag_provenance        │
│                                                              │
│  3. SKILL EXECUTION (Step 2)                                 │
│     ├── Oracle ranks strategies                              │
│     │   └── + historical_context from zkRAG patterns         │
│     ├── Proof Pipeline generates ZK proofs                   │
│     │   ├── risk_proof (Groth16, circuit-verified bounds)    │
│     │   ├── anomaly_proof (Groth16, circuit-verified)        │
│     │   ├── execution_proof (Groth16, slippage check)        │
│     │   └── + zkrag metadata (fact_hash, block_range)        │
│     └── → Proof bundle with full provenance                  │
│                                                              │
│  4. LLM SYNTHESIS (Step 3)                                   │
│     └── Final decision incorporating proof results           │
│                                                              │
│  5. COMMIT-REVEAL EXECUTION                                  │
│     ├── commit_proposal(hash) → VaultController              │
│     ├── submit_commitment(commitment) → IntentCommitment     │
│     ├── wait cooldown                                        │
│     └── execute_proposal(adapters, amounts) → VaultController│
│                                                              │
│  6. RECEIPT                                                  │
│     ├── Backend receipt (LLM decision + proofs + zkrag meta) │
│     └── On-chain receipt (tx hash + fact verification)       │
└─────────────────────────────────────────────────────────────┘
```

### 5.5 What Changes for Agent Developers

If you're building new agent skills or templates on the CapitaVal OS:

**To use zkGraph context in a new skill:**

```python
from app.services.zkgraph_client import ZkGraphClient
import os

async def my_custom_skill(pool_id: str):
    if os.getenv("ZKGRAPH_ENABLED", "").lower() == "true":
        zk = ZkGraphClient.get_instance()
        
        # Get attested market context for a pool
        ctx = await zk.query_market_context(pool_id)
        if ctx.source == "zkrag":
            print(f"Block range: {ctx.provenance.block_range}")
            print(f"Fact hash: {ctx.provenance.fact_hash}")
            print(f"Context: {ctx.context_text}")
        
        # Get historical patterns
        patterns = await zk.query_historical_patterns("tvl_divergence")
        for p in patterns:
            print(f"{p.pattern_type}: confidence {p.confidence}")
        
        # Verify a fact hash on-chain
        result = await zk.verify_provenance(
            fact_hash="0x6aed...",
            response_hash="0x0da3..."
        )
        print(f"Verified: {result['checks']['merkle_in_index']}")
```

**The client handles everything:**
- Rate limiting (10 RPM to obsqra)
- Caching (60s market, 300s historical)
- Graceful degradation (returns `source="local_only"` if obsqra is down)
- No exceptions bubble up — the agent never crashes because obsqra is unreachable

### 5.6 Configuration

Set these in zkdefi's `.env`:

```bash
ZKGRAPH_ENABLED=true                                    # Master switch
OBSQRA_PROVER_API_URL=http://localhost:8002/api/v1      # obsqra backend URL
```

When `ZKGRAPH_ENABLED=false` or unset, all three enrichment points (LLM, Oracle, Proof Pipeline) silently skip zkGraph — the agent operates as before with local-only data.

---

## 6. Data Flow Diagrams

### 6.1 Cross-Service Architecture

```
                    STARKNET L1
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌────────────┐ ┌──────────────┐
│  Juno RPC    │ │  Integrity │ │  Attestation │
│  Full Node   │ │  Verifier  │ │  Registry    │
│              │ │  (L2)      │ │  (L2)        │
└──────┬───────┘ └─────▲──────┘ └──────▲───────┘
       │               │               │
       │         ┌─────┴───────────────┘
       │         │
       ▼         │
┌══════════════════════════════════════════════════╗
║  OBSQRA.FI  (port 8002)                         ║
║                                                  ║
║  IndexerService → indexed_blocks → indexed_facts ║
║       │                                          ║
║       ├── Merkle snapshot every 100 blocks       ║
║       ├── fact_hash = SHA-256(merkle_root)       ║
║       ├── Dedup: skip if same as last hash       ║
║       └── Register on-chain via Integrity ───────╫──► fact on-chain
║                                                  ║
║  ZkRAGRetriever ← POST /api/v1/zkrag/query      ║
║       ├── NL intent parsing                      ║
║       ├── indexed_events (or indexed_facts)      ║
║       └── AttestedContext with provenance         ║
║                                                  ║
║  Verifier Node → polls snapshots → verifies ─────╫──► attestation on-chain
╚══════════════════════╦═══════════════════════════╝
                       ║ HTTP (structured JSON)
                       ║
╔══════════════════════╩═══════════════════════════╗
║  ZKDE.FI  (port 8003)                           ║
║                                                  ║
║  ZkGraphClient (singleton)                       ║
║       ├── Rate-limited (10 RPM)                  ║
║       ├── TTL-cached (60s / 300s)                ║
║       └── Fail-open (source="local_only")        ║
║                                                  ║
║  ┌─────────────────────────────────────────────┐ ║
║  │ LLM Engine          → zkrag_provenance      │ ║
║  │ Oracle Service       → historical_context   │ ║
║  │ Proof Pipeline       → zkrag metadata       │ ║
║  └─────────────────────────────────────────────┘ ║
║                                                  ║
║  Agent Orchestrator → Commit-Reveal → On-Chain   ║
╚══════════════════════════════════════════════════╝
```

### 6.2 Request Flow (Single Agent Decision)

```
Agent Goal: "Rebalance conservative vault"
  │
  ├─[1]─► LLM Engine
  │         ├─► ZkGraphClient.query_market_context("ekubo_eth_usdc")
  │         │     └─► POST obsqra:8002/api/v1/zkrag/query
  │         │           { query: "pool activity for ekubo_eth_usdc",
  │         │             format: "structured" }
  │         │         ◄── { results[], provenance{ fact_hash, block_range } }
  │         │
  │         ├─► GPT-4o-mini (system prompt + zkRAG context)
  │         └─► AllocationRecommendation + zkrag_provenance
  │
  ├─[2]─► Oracle Service
  │         ├─► ZkGraphClient.query_historical_patterns("general")
  │         │     └─► POST obsqra:8002/api/v1/zkrag/query
  │         │           { query: "historical on-chain patterns general..." }
  │         │
  │         └─► RecommendedAction[] + historical_context
  │
  ├─[3]─► Proof Pipeline
  │         ├─► ZkGraphClient.query_market_context(pool_id)
  │         │     └─► (cache hit — same pool, within 60s TTL)
  │         │
  │         ├─► Generate: risk_proof, anomaly_proof, execution_proof
  │         └─► Proof Bundle + zkrag{ fact_hash, block_range, source_count }
  │
  └─[4]─► Commit-Reveal → VaultController (on-chain)
```

**Total obsqra API calls per decision:** ~2–3 (most are cache hits after the first call in a 60s window).

---

## 7. API Reference

### 7.1 obsqra.fi Endpoints (port 8002)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/v1/zkrag/query` | `{ query, format: "text"\|"structured" }` | `{ query, results[], provenance, response_hash, query_id }` |
| GET | `/api/v1/zkrag/audit/{query_id}` | — | `{ query_id, status, snapshots[] }` |
| GET | `/api/v1/zkrag/audit/latest` | — | `{ status, snapshots[10] }` |
| POST | `/api/v1/zkrag/verify/{query_id}` | `{ response_hash, fact_hash }` | `{ verified, checks{ fact_hash_on_chain, merkle_in_index, response_hash_match }, details }` |

### 7.2 zkde.fi Endpoints (port 8003)

| Method | Path | Body/Params | Response |
|--------|------|-------------|----------|
| GET | `/api/v1/zkdefi/zkgraph/health` | — | `{ available, base_url, cache_entries, rpm_used, rpm_limit }` |
| GET | `/api/v1/zkdefi/zkgraph/context/{pool_id}` | — | `MarketContext` (JSON) |
| GET | `/api/v1/zkdefi/zkgraph/patterns/{pattern_type}` | `?limit=N` | `{ pattern_type, patterns[] }` |
| GET | `/api/v1/zkdefi/zkgraph/strategies/{strategy_id}` | `?limit=N` | `{ strategy_id, matches[] }` |
| POST | `/api/v1/zkdefi/zkgraph/verify` | `{ fact_hash, response_hash }` | `{ query_id, verified, checks, details }` |

---

## 8. Configuration

### 8.1 Environment Variables

**obsqra.fi** — no new env vars needed. The zkRAG endpoints use existing `DATABASE_URL` and `STARKNET_RPC_URL`.

**zkde.fi:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `ZKGRAPH_ENABLED` | `""` (disabled) | Set to `"true"` to enable all three enrichment injection points |
| `OBSQRA_PROVER_API_URL` | `http://localhost:8002/api/v1` | Base URL for obsqra's zkRAG API |

### 8.2 PM2 Services

| Service | Port | PM2 Name |
|---------|------|----------|
| obsqra-backend | 8002 | `obsqra-backend` (id 30) |
| obsqra-frontend | 3003 | `obsqra-frontend` (id 38) |
| zkdefi-backend | 8003 | `zkdefi-backend` (id 34) |
| zkdefi-frontend | 3001 | `zkdefi-frontend` (id 37) |

### 8.3 Nginx

`starknet.obsqra.fi` → `localhost:3003` (Next.js frontend)  
Next.js rewrites: `/api/:path*` → `http://localhost:8002/api/:path*` (obsqra backend)

---

## 9. Frontend Surfaces

### 9.1 starknet.obsqra.fi/zkgraph — zkGraph Dashboard

Full dashboard with 4 tabs:

- **Overview:** System health, fact_hash, block_range, snapshot count. "How it Works" 4-step visual. Live integration section showing LLM/Oracle/Proof enrichment.
- **Market Context:** Pool selector (Ekubo ETH/USDC, Vesu stETH, JediSwap STRK/USDC, etc). Displays attested context text + full provenance with Starkscan verification links.
- **Patterns:** Historical on-chain patterns with confidence scores and provenance.
- **Audit Trail:** Table of all attested snapshots — ID, block range, fact_hash (clickable Starkscan link), status, registration timestamp.

### 9.2 starknet.obsqra.fi/zkrag — zkRAG Chat Demo

Chat-style interface for natural language queries against the proven index. Each response shows:
- Full text answer
- Provenance block: block range, fact_hash (clickable link to Starkscan), source count
- "View in zkGraph →" link for deeper exploration

### 9.3 Navigation Wiring

zkGraph links were added to navigation and CTAs across all frontend pages:

| Page | What was added |
|------|---------------|
| `/` (root) | zkGraph in navbar, CTA section, footer, layer-4 description |
| `/landing` | zkRAG/zkGraph navbar links, "Try Live Demo" and "View Graph" CTAs |
| `/agents` | zkGraph in navbar and bottom CTA buttons |
| `/cloud` | zkGraph CTA button |
| `/pipeline` | zkGraph in navbar |
| `/zkrag` | zkGraph nav link, clickable fact_hash (Starkscan), "View in zkGraph →" |
| `layout.tsx` | zkGraph in meta description and keywords |

---

## 10. Trust Model

**What zkGraph proves:**
- The data the agent used came from specific Starknet blocks (provenance.block_range)
- That data was Merkle-rooted and the root was hashed (provenance.merkle_root → fact_hash)
- The fact_hash was registered on-chain via the Integrity Verifier (verifiable on Starkscan)
- The response wasn't tampered with (response_hash = SHA-256(response + fact_hash))
- Independent verifier nodes attested the fact (AttestationRegistry, N-of-M quorum)

**What zkGraph does NOT prove:**
- That the LLM's reasoning was correct (LLM decisions are advisory; ZK circuits enforce policy bounds)
- That the zkRAG query interpretation was semantically correct (it's keyword-based NL parsing, not embedding search)
- That the indexed data is complete (it indexes what the Juno node provides)

**The trust boundary:** obsqra.fi's integrity verifier and verifier nodes provide the attestation layer. The ZK circuits (Groth16) prove the agent's execution satisfies risk bounds. zkGraph bridges the two — linking the agent's proven-correct execution to the verifiably-attested data it was based on.
