# zkGraph / zkRAG — Decision Log & Open Questions

> **Date:** 2026-03-05 (initial)  
> **Purpose:** Track decisions, risks, and open questions as we iterate

---

## Decisions Made

### D1: Client-only integration (no obsqra breaking changes in Phase 1)

**Decision:** zkdefi adds a new HTTP client (`ZkGraphClient`) that calls existing obsqra zkRAG endpoints. No changes to obsqra API surface in Phase 1.

**Rationale:** De-risk the integration. If something goes wrong, only zkdefi is affected. obsqra continues serving its own zkrag demo and other consumers unchanged.

### D2: Deterministic SQL retrieval, not vector/embedding

**Decision:** Accept that obsqra's zkRAG is SQL-based (not vector search). The "RAG" is retrieval from the proven index via structured queries, not semantic similarity.

**Rationale:** This is actually *better* for verifiability. SQL queries are deterministic and reproducible. Vector similarity is non-deterministic and hard to prove. The proven index design is intentional.

**Future:** If we want semantic similarity, we add it on the zkdefi side (local embeddings of zkRAG responses), not the obsqra side.

### D3: Feature-flagged enrichment

**Decision:** Every integration point is behind `ZKGRAPH_ENABLED` flag. When disabled, all intelligence services work exactly as before.

**Rationale:** Operational safety. We can disable zkGraph with one env var change if it causes issues, without redeploying.

### D4: Cache-first, verify-critical

**Decision:** Cache all zkRAG responses locally. Only call `verify_provenance()` for proof-generating decisions, not for display-only queries.

**Rationale:** Performance. Verification involves an on-chain RPC call (slow). UI display can tolerate unverified provenance. Proof pipeline cannot.

---

## Open Questions

### Q1: Should zkdefi share its own data back to obsqra?

**Current answer:** No. Data flow is strictly one-directional (obsqra → zkdefi). 

**But:** zkdefi has real market data from Ekubo/JediSwap and ML inference results that could enrich the proven index. Future consideration: a "contribution" endpoint where zkdefi submits attested inference results back to obsqra for indexing.

**Impact:** Major — would require new obsqra endpoints and trust model changes. Park for v2.

### Q2: What happens when indexed_events gets populated?

**Current answer:** The ZkGraphClient will start getting real results instead of "no indexed data" responses. The structured format will need testing against actual event data.

**Action needed:** When we fix Task 0.2 (populate indexed_events), run integration tests to ensure the client parses real responses correctly.

### Q3: Should zkdefi have its own local proven index?

**Current answer:** No. We rely on obsqra's PostgreSQL. Adding a local index would be duplicating the prover infrastructure.

**But:** If obsqra becomes a bottleneck or single point of failure, a local read replica could improve availability. For now, the caching layer + graceful fallback is sufficient.

### Q4: How do we handle the fact that fact_hash is the same across recent snapshots?

**Problem:** Since `indexed_events` is empty, every snapshot has the same Merkle root → same fact_hash (`0x6aed34e6...`). Multiple queries will return provenance pointing to the same fact_hash.

**Answer:** This is correct behavior — the provenance is honest. It says "the index had no events in this block range." When events start appearing, fact_hashes will diverge. Our code should handle the case where `source_count = 0` and display it appropriately ("index pending").

### Q5: Should we expose zkRAG queries to end users or keep it internal?

**Current plan:** Initially internal only (AI services query zkRAG). Phase 3 potentially adds a Brain surface tab.

**Consideration:** Exposing user-facing zkRAG queries would essentially add a "chat with chain data" feature to zkdefi. Cool but scope creep. Keep it AI-internal for now.

### Q6: What about the Madara appchain path?

**Status: IMPLEMENTED** (2026-03-05).

**What was built:**
- `MadaraSettlementService` (`backend/app/services/madara_settlement_service.py`) — register_fact/verify_fact on Madara L3
- `ProofSequencer._seal_block()` now tries Madara L3 first, falls back to Starknet L2
- `MadaraSettlementClient` on zkdefi side for status queries
- 5 new obsqra API routes + 3 new zkdefi routes for Madara health/verify/config
- Chain config: `OBSQRA_PROOF_CHAIN`, 5s blocks, zero gas, RPC :9944
- Deploy + startup scripts for Madara node and FactRegistry

**Impact on zkGraph:** None. The zkRAG API is unchanged (HTTP). The settlement layer is transparent to all consumers. `ProofSequencerClient` talks to the HTTP layer, not directly to any settlement layer.

See [MADARA_L3_APPCHAIN_ARCHITECTURE.md](../MADARA_L3_APPCHAIN_ARCHITECTURE.md) for full details.

---

## Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R1 | obsqra backend goes down | Medium | Low | Graceful fallback — intelligence works without zkRAG |
| R2 | indexed_events stays empty | High (current state) | Medium | Use indexed_facts as fallback; fix indexer contract list |
| R3 | Fact registration stays broken | High (current state) | Medium | Fix wallet balance/nonce; provenance still shows fact_hash, just unverified on-chain |
| R4 | zkRAG responses are too slow | Low | Low | 5s timeout + cache |
| R5 | Circular proof storms | Very Low | High | Rate limit (10 RPM), no hot-loop queries |
| R6 | LLM prompt becomes too large with zkRAG context | Medium | Low | Limit to 3 pools, truncate context to 500 chars each |
