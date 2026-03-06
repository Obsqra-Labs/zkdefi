# zkGraph Integration

Real-time attested on-chain intelligence from obsqra's proven-index.

## Overview

zkGraph connects zkDeFi Capital OS to obsqra.fi's zkRAG API, injecting cryptographically attested on-chain data into every agent decision.

**Result:** Agent decisions are provably informed by Merkle-rooted, fact-hash-registered, verifiable Starknet state.

---

## Privacy + Verification = zkDeFi

Every vault operation now has:

- ✅ **STARK proof** — cryptographic correctness guarantee
- ✅ **On-chain receipt** — immutable audit trail with proof hash
- ✅ **Privacy option** — shielded pools hide amounts
- ✅ **zkGraph provenance** — attested intelligence with fact_hash → blocks

**Architecture:** Backend generates proof → Submit to FactRegistry → VaultController verifies → Execute → Create receipt → Attach zkGraph provenance

---

## What zkGraph Delivers

### The Three Enrichment Points

#### 1. LLM Engine Enrichment

**What:** Injects attested on-chain context into GPT-4o-mini system prompt

**Impact:** LLM sees real block-level facts instead of just local database metadata.

**Example:**
```
System prompt includes:
"You also have access to attested on-chain data from the obsqra 
proven-index (zkRAG). Use it to ground your recommendation in real 
on-chain activity:

block 4836900: fact_hash=0x6aed34e6... From attested snapshots 
(indexed_facts). Block range: 4836801-4836900."
```

**Result:**
```json
{
  "allocation": {"ekubo_eth_usdc": 0.6, "vesu_steth": 0.4},
  "reasoning": "Based on attested block data showing...",
  "zkrag_provenance": {
    "fact_hash": "0x6aed34e6bddff5e1d872b5d7d5698a7b73abd6f3b33402732edc73ab9ffb9c70",
    "block_range": "4836801-4836900",
    "merkle_root": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "source_count": 10
  }
}
```

#### 2. Oracle Service Enrichment

**What:** Adds historical pattern context to recommendations

**Impact:** Oracle recommendations include cross-block intelligence (TVL divergences, volatility spikes, liquidity drains)

**Example:**
```json
{
  "label": "Allocate 60% to Ekubo ETH/USDC",
  "reasoning": "High liquidity, stable APY...",
  "historical_context": "general: From attested snapshots (blocks 4836801-4836900, confidence 40%). TVL divergence detected in recent blocks.",
  "confidence": "high"
}
```

#### 3. Proof Pipeline Enrichment

**What:** Attaches zkGraph metadata to proof bundles

**Impact:** Every Groth16 proof links to the attested data that informed it

**Example:**
```json
{
  "commitment_hash": "0xabc...",
  "zkml_proofs": { "risk": {...}, "anomaly": {...} },
  "execution_proof": {...},
  "can_execute": true,
  "zkrag": {
    "zkrag_fact_hash": "0x6aed34e6...",
    "zkrag_block_range": "4836801-4836900",
    "zkrag_source_count": 10
  }
}
```

---

## The Provenance Chain

Every agent decision carries an unbroken audit trail:

```
Agent Decision (allocation recommendation)
  └── zkrag_provenance.fact_hash
        └── On-Chain Integrity Registry (Herodotus L2)
              └── Merkle root of indexed_facts snapshot
                    └── Block range: 4836801-4836900
                          └── Attestation Registry (N-of-M verifier quorum)
```

**To verify:**
1. Get `zkrag_provenance.fact_hash` from agent response
2. Query obsqra: `POST /api/v1/zkrag/verify { fact_hash, response_hash }`
3. Check on-chain: Visit Voyager → search fact_hash in Integrity Registry
4. Confirm block range matches provenance
5. Trace back to exact snapshot in `indexed_facts` table

---

## API Reference

### Backend Endpoints (zkde.fi)

```bash
# Health check
GET /api/v1/zkdefi/zkgraph/health

Response:
{
  "available": true,
  "base_url": "http://localhost:8002/api/v1",
  "cache_entries": {
    "market_context": 3,
    "historical": 5
  },
  "rate_limit": {
    "rpm_used": 2,
    "rpm_limit": 10
  }
}
```

```bash
# Market context for pool
GET /api/v1/zkdefi/zkgraph/context/ekubo_eth_usdc

Response:
{
  "pool_id": "ekubo_eth_usdc",
  "source": "zkrag",
  "context_text": "block 4836900: fact_hash=0x6aed... From attested snapshots.",
  "provenance": {
    "fact_hash": "0x6aed34e6...",
    "block_range": "4836801-4836900",
    "merkle_root": "0x00000000...",
    "source_count": 10,
    "verified_on_chain": false
  },
  "verified": true
}
```

```bash
# Historical patterns
GET /api/v1/zkdefi/zkgraph/patterns/general?limit=3

Response:
{
  "pattern_type": "general",
  "patterns": [
    {
      "pattern_type": "tvl_divergence",
      "description": "From attested snapshots",
      "block_range": "4836801-4836900",
      "confidence": 0.4,
      "provenance": { ... }
    }
  ],
  "count": 3
}
```

---

## Frontend Integration

### Display Provenance

```tsx
import { ProvenanceDisplay } from "@/components/zkdefi/ProvenanceDisplay";

// Full provenance panel
<ProvenanceDisplay 
  provenance={{
    fact_hash: "0x6aed34e6...",
    block_range: "4836801-4836900",
    merkle_root: "0x000000...",
    source_count: 10,
    verified_on_chain: true
  }}
  variant="full"
/>

// Compact badge
<ProvenanceDisplay provenance={data} variant="compact" />

// Inline single-line
<InlineProvenance provenance={data} />
```

### zkGraph Widget

```tsx
import { ZkGraphWidget } from "@/components/zkdefi/ZkGraphWidget";

// Full widget (Oracle surface)
<ZkGraphWidget poolId="ekubo_eth_usdc" variant="full" />

// Compact status
<ZkGraphWidget poolId="ekubo_eth_usdc" variant="compact" />
```

**Features:**
- Auto-refreshes every 60s
- Shows market context + historical patterns
- System health display
- Links to full zkGraph dashboard on obsqra.fi

---

## Configuration

### Backend (.env)

```bash
# zkGraph Integration
ZKGRAPH_ENABLED=true                              # Master switch
OBSQRA_PROVER_API_URL=http://localhost:8002/api/v1  # obsqra backend URL
```

**Fallback Behavior:** When `ZKGRAPH_ENABLED=false` or obsqra unreachable:
- All three enrichment points return `source="local_only"`
- Agent continues with local database only
- No errors, no crashes - graceful degradation

### Frontend (.env.local)

No frontend configuration needed - zkGraph is backend-only.

---

## Trust Model

### What zkGraph Proves

✅ **Data provenance:**
- The data came from specific Starknet blocks (provenance.block_range)
- The data was Merkle-rooted (provenance.merkle_root)
- The root was hashed and registered on-chain (provenance.fact_hash)
- The response wasn't tampered with (response_hash verification)

✅ **Attestation:**
- Independent verifier nodes attested the fact (N-of-M quorum)
- Fact hash is queryable on-chain via Integrity Registry
- Anyone can verify the provenance chain

### What zkGraph Does NOT Prove

❌ **LLM reasoning:** GPT-4o-mini's allocation logic is advisory (ZK circuits enforce bounds)  
❌ **Semantic correctness:** zkRAG query interpretation is keyword-based, not embedding search  
❌ **Data completeness:** Indexes what the Juno node provides

**The trust boundary:** obsqra.fi provides attested data, ZK circuits prove execution correctness, zkGraph bridges the two.

---

## Performance

### Rate Limiting

zkGraph client enforces **10 requests per minute (RPM)** sliding window to respect obsqra's limits.

**When limit hit:**
- Request rejected
- Falls back to `source="local_only"`
- Logged as warning (not error)

### Caching

- **Market context:** 60s TTL (fresh enough for real-time decisions)
- **Historical patterns:** 300s TTL (stable over 5 minutes)

**Cache hit ratio:** ~80% under normal load (most pools queried repeatedly)

### API Latency

- **obsqra zkRAG query:** ~200-500ms (depends on indexed_facts size)
- **Cache hit:** <1ms (in-memory)
- **zkGraph client total:** ~300-600ms per decision (with cache misses)

---

## Monitoring

### Health Check

```bash
curl http://localhost:8003/api/v1/zkdefi/zkgraph/health
```

**Watch for:**
- `available: false` - zkGraph disabled or misconfigured
- `rpm_used >= rpm_limit` - rate limit hit (throttling active)
- `cache_entries.market_context = 0` - cache cold (first requests slow)

### Alerts

**Set up monitoring for:**
- `source="local_only"` for >10 minutes → obsqra unreachable
- `rpm_used > 8` sustained → approaching rate limit
- `response_time > 2s` → obsqra slow (check indexer)

---

## Troubleshooting

### "zkGraph unavailable" in UI

**Cause:** Backend can't reach obsqra.fi  
**Fix:**
1. Check obsqra backend: `curl http://localhost:8002/api/v1/zkrag/audit/latest`
2. Verify network: `ping localhost` or check firewall
3. Check backend logs: `pm2 logs zkdefi-backend | grep zkGraph`

### "Local data only" shown

**Normal:** zkGraph disabled or obsqra down  
**Fix:** Set `ZKGRAPH_ENABLED=true` in backend `.env`, restart

### Rate limit exceeded

**Cause:** More than 10 requests in 60s  
**Fix:** Increase cache TTLs or reduce polling frequency

---

## Resources

- **obsqra zkGraph Dashboard:** https://starknet.obsqra.fi/zkgraph
- **obsqra zkRAG Chat:** https://starknet.obsqra.fi/zkrag
- **Voyager Explorer (Sepolia):** https://sepolia.voyager.online
- **Integrity Verifier:** (Herodotus on Starknet L2)
- **zkDeFi API Docs:** https://zkde.fi/docs/api-overview

---

**Last Updated:** March 5, 2026  
**Phase:** 9A (zkGraph Backend) + 9B (Frontend UI)  
**Status:** Live and integrated
