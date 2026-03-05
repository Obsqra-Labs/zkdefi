# Current State Audit — obsqra.fi Proven Index & Prover Network

> **Date:** 2026-03-05  
> **Purpose:** Snapshot of the live state of the obsqra infrastructure that zkdefi will consume

---

## Database State (PostgreSQL `obsqra`)

| Table | Rows | Size | Notes |
|-------|------|------|-------|
| `indexed_blocks` | 4,843,697 | 420 MB | Healthy — indexer is actively polling Juno |
| `indexed_facts` | 11,116 | 2.9 MB | 11K attested snapshots. **Recent all have `proof_path = 'registration_failed'`** |
| `indexed_events` | 0 | 48 KB | **Empty** — indexed contracts haven't emitted matching events |
| `proof_jobs` | 219 | 20 MB | 36 VERIFIED, 55 SUBMITTED, 18 GENERATED, 110 FAILED |

### indexed_facts Sample (Most Recent)

```
fact_hash: 0x6aed34e6bddff5e1d872b5d7d5698a7b73abd6f3b33402732edc73ab9ffb9c70
block_range: 4836601-4836900
proof_path: registration_failed  (×3 consecutive)
```

The same `fact_hash` appears repeatedly because the events haven't changed (empty `indexed_events`), so the Merkle root is identical.

### proof_jobs Sample (Verified)

```
id: fa05f722... | status: VERIFIED | l2_verified_at: 2026-01-27 20:44:39
id: ec5d384d... | status: VERIFIED | l2_verified_at: 2026-01-27 20:40:00
id: e60fb1cc... | status: VERIFIED | l2_verified_at: 2026-01-28 20:49:21
```

Last verified proofs are from January 27–28. No recent verifications.

---

## PM2 Services

| Service | Status | Port | Purpose |
|---------|--------|------|---------|
| `obsqra-backend` | Running | 8002 | Main backend (hosts zkRAG, indexer, proofs) |
| `obsqra-frontend` | Running | 3003 | Next.js frontend (hosts /zkrag chat UI) |
| `obsqra-verifier` | Running | — | Verifier node (polls snapshots, attests facts) |
| `ai-service` | Running | 8000 | EVM risk model (legacy) |
| `zkdefi-backend` | Running | — | zkdefi backend |
| `zkdefi-frontend` | Running | — | zkdefi frontend |
| `zkdefi-market-sim` | Running | — | Market simulator |
| `zkdefi-relayer-runner` | Running | — | Relayer runner |

---

## Deployed Contracts (Sepolia)

| Contract | Address | Used by |
|----------|---------|---------|
| Obsqra FactRegistry | `0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8` | Indexer, IntegrityService, Verifier |
| RiskEngine v4 | `0x052fe4c3f3913f6be76677104980bff78d224d5760b91f02700e8c8275ac6e68` | Indexed by Indexer |
| StrategyRouter v3.5 | `0x07ec6aa6f5499e9490cce33152c9f9058f18e90d353032fcb3ca1bfe30c98c73` | Indexed by Indexer |
| AgentOrchestrator | `0x050a35c0f4f42e7b3fcf1186d2465d5a14f7c17054bf4d3da4ac8ca8f5f8bb23` | Indexed by Indexer |
| VaultController (zkdefi) | `0x6c5b17eab7f20da1ab69e98db6f3f63cbcefa28992a17787883c76dd13498d1` | New — not yet indexed |
| EkuboLpAdapter (zkdefi) | `0x74febeff7301aa58d786b01756e36f20ab7208a52ce94a82b425af8f9933a0` | New — not yet indexed |

---

## API Endpoints (obsqra backend, port 8002)

### zkRAG
- `POST /api/v1/zkrag/query` — NL query → response + provenance
- `GET /api/v1/zkrag/audit/{query_id}` — Full audit trail
- `POST /api/v1/zkrag/verify/{query_id}` — Verify provenance chain

### Proven Index
- `GET /api/v1/index/events` — Query indexed events
- `GET /api/v1/index/health` — Indexer health/lag
- `GET /api/v1/index/snapshots` — Recent attested snapshots

### Proof Aggregation
- `POST /api/v1/aggregation/submit` — Submit proof for batching
- `GET /api/v1/aggregation/stats` — Sequencer stats

### Proofs
- `POST /api/v1/proofs/generate` — Generate STARK proof (StoneProver)
- Various other proof lifecycle endpoints

---

## Known Issues

1. **Fact registration failing** — All recent `indexed_facts` show `proof_path = 'registration_failed'`. The `IntegrityService.register_fact_in_obsqra_registry()` is failing on-chain. Likely wallet balance/nonce issue.

2. **Empty event index** — `indexed_events` has 0 rows. The 4 indexed contracts haven't emitted events that match the indexer's filter. Snapshots are generated over empty event sets, producing identical Merkle roots.

3. **Stale proof verifications** — Last `VERIFIED` proof job is from Jan 28. No recent proofs have completed verification.

4. **zkRAG returns "no indexed data"** — Since `indexed_events` is empty, zkRAG queries return "No indexed data found" responses, though provenance from `indexed_facts` is still attached.

---

## Config Reference

```
# obsqra backend .env (relevant keys)
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/...
OBSQRA_FACT_REGISTRY_ADDRESS=0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8
BACKEND_WALLET_ADDRESS=0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
INTEGRITY_LAYOUT=small
INTEGRITY_STONE_VERSION=stone6
ALLOW_UNVERIFIED_EXECUTION=False
DATABASE_URL=postgresql://obsqra:obsqra@localhost:5432/obsqra

# zkdefi backend .env (relevant keys)
OBSQRA_PROVER_API_URL=http://localhost:8002/api/v1
# (OBSQRA_API_URL and OBSQRA_LOCAL_API_URL resolved at runtime)
```
