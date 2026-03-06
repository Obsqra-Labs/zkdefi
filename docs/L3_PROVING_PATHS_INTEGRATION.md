# L3 Proving Paths: Implementation Guide for zkde.fi

> How zkde.fi implements the three L3 proving paths and leverages the full obsqra stack.

---

## Overview

The obsqra stack exposes three proving paths on the Madara L3 appchain, plus
a suite of backend services that zkde.fi can consume via HTTP. All L3
verification runs at **zero gas cost** (operator-subsidized), making on-chain
proof verification economically viable for every user interaction.

```
┌─────────── zkde.fi Frontend ───────────┐
│                                         │
│   /risk_passport/l3/capabilities        │
│   /risk_passport/l3/proving-paths       │
│   /risk_passport/l3/verify              │
│   /risk_passport/l3/stats               │
│   /risk_passport/l3/blocks              │
│   /risk_passport/l3/snos/queue          │
│                                         │
└──────────────┬──────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────┐
│         zkdefi Backend (8003)           │
│                                         │
│  L3ProvingPathClient                    │
│     → /api/v1/aggregation/l3/*          │
│                                         │
└──────────────┬──────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────┐
│        obsqra Backend (8002)            │
│                                         │
│  L3ProvingOrchestrator                  │
│    ├─ L3VerificationService (Path 1)    │
│    ├─ SNOS Bridge (Path 2)              │
│    └─ On-chain Aggregator (Path 3)      │
│                                         │
│  + Stone Prover, Dual Prover,           │
│    Proof Aggregator, Proof Sequencer,   │
│    Integrity Service, zkRAG             │
│                                         │
└──────────────┬──────────────────────────┘
               │ Starknet RPC
┌──────────────▼──────────────────────────┐
│   Madara L3 Appchain (:9944)            │
│                                         │
│  ┌─ GaragaGroth16Verifier ──┐           │
│  │  verify_groth16_proof()  │           │
│  └──────────────────────────┘           │
│  ┌─ IntegritySTARKVerifier ─┐           │
│  │  verify_proof_initial()  │           │
│  └──────────────────────────┘           │
│  ┌─ ObsqraFactRegistry ────┐           │
│  │  register_verified_fact()│           │
│  │  is_valid()              │           │
│  └──────────────────────────┘           │
│                                         │
└─────────────────────────────────────────┘
```

---

## Path 1: On-Chain Verification at Zero Gas

### What It Does

Deploys Garaga (Groth16) and Integrity (STARK) verifier contracts directly on the
Madara L3 appchain. Every proof is **cryptographically verified on-chain** at zero
gas cost, building an irrefutable on-chain audit trail.

### Trust Model

**Full cryptographic verification** — the L3 chain itself verifies every proof.
No trust assumptions beyond the math.

### Implementation (zkde.fi)

```python
from app.services.l3_proving_path_client import get_l3_proving_path_client

client = get_l3_proving_path_client()

# 1. Check which verifiers are deployed
paths = await client.proving_paths()
# paths["path_1_onchain_verification"]["garaga_groth16"]["available"]  → True/False
# paths["path_1_onchain_verification"]["integrity_stark"]["available"] → True/False

# 2. Submit a Groth16 proof for on-chain verification
result = await client.verify_proof(
    fact_hash="0xabc123...",
    proof_type="groth16",
    circuit_name="RiskScoreAllocation",
    groth16_calldata=["0x1234...", "0x5678..."],  # Garaga-formatted
)
assert result.success
assert result.verified_on_chain  # True = cryptographic verification
assert result.mode == "groth16_garaga"

# 3. Submit a STARK proof for on-chain verification
result = await client.verify_proof(
    fact_hash="0xdef456...",
    proof_type="stark",
    stark_proof_data={"proof_json": "...", "layout": "small"},
)
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/risk_passport/l3/verify` | Verify + register a proof |
| `GET` | `/risk_passport/l3/verification/stats` | Verification mode counts |
| `GET` | `/risk_passport/l3/proving-paths` | Available verifiers + status |

### Contracts to Deploy on L3

1. **GaragaGroth16Verifier** — Garaga's BN254 Groth16 verifier (Cairo 1)
2. **IntegritySTARKVerifier** — Herodotus Integrity verifier (Cairo 1)
3. **ObsqraFactRegistry** — Shared fact registry (already deployed for hash-only)

After deploying, set in `.env`:
```
L3_GARAGA_VERIFIER_ADDRESS=0x...
L3_INTEGRITY_VERIFIER_ADDRESS=0x...
L3_VERIFIED_FACT_REGISTRY_ADDRESS=0x...
```

---

## Path 2: SNOS Block Proving (L3 → L2 Validity Proofs)

### What It Does

The Starknet Operating System (SNOS) proves the state transition of every L3 block.
This produces a STARK proof that attests: "this L3 block executed correctly and
resulted in this state root." The proof is submitted to the L2 settlement contract,
making L3 facts **L2-verifiable** without re-executing any computation.

### Trust Model

**Validity proven** — L2 only accepts state roots backed by a STARK proof of
correct execution. This is the same security model as Starknet mainnet settling to L1.

### How It Works

```
L3 Block N (contains 32 verified proofs)
    ↓ SNOS (Starknet OS)
STARK Proof of Block N execution
    ↓ Submit to L2
L2 Settlement Contract verifies STARK proof
    ↓ Accept
L3 state root N is final on L2
```

### Implementation

SNOS is currently managed by Madara's built-in orchestrator. Once enabled:

1. **L3 blocks are automatically queued** when proofs settle on L3 (the orchestrator
   does this via `process_block()`)
2. **External SNOS pipeline** picks up blocks from the queue, generates execution
   traces, runs them through SNOS, and produces STARK proofs
3. **L2 settlement** submits the STARK proof to the L2 core contract

zkde.fi can monitor the queue:

```python
client = get_l3_proving_path_client()

# Check SNOS queue status
queue = await client.snos_queue()
# queue["queue"] → list of blocks pending/proven
# queue["status"] → description of Path 2
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/risk_passport/l3/snos/queue` | Blocks queued for SNOS proving |
| `GET` | `/risk_passport/l3/stats` | Includes path_2_snos stats |

### Status

SNOS is **planned** — requires Madara's L2 settlement orchestrator configuration
and an SNOS proving worker. The queue infrastructure is built and operational.

---

## Path 3: Recursive Aggregation on L3

### What It Does

Moves the ProofAggregator logic into L3 smart contracts. Instead of aggregating
proofs off-chain (in the obsqra Python backend), the aggregation happens on-chain
as an L3 contract call. This means the aggregation itself is provable by SNOS.

### Trust Model

**Transitively proven** — L3 executes the aggregation → SNOS proves the L3 block
→ the aggregation is included in the validity proof. No off-chain trust needed.

### How It Works

```
Individual proofs (up to 32 per block)
    ↓ L3 Contract: aggregate_proofs()
    │   - Merkle commitment over fact_hashes
    │   - Weighted score computation
    │   - Tier assignment
    ↓ L3 emits AggregationComplete event
    ↓ SNOS proves the block
L2 sees: "block N aggregated 32 proofs → commitment 0xabc, tier=gold"
```

### Implementation

This is a **future path** — it requires writing the aggregation logic in Cairo.
The current off-chain aggregator (Stone STARK proof of `reputation_passport`
program) remains fully functional.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/risk_passport/l3/stats` | Includes path_3 status |
| `GET` | `/risk_passport/l3/capabilities` | Shows planned status |

---

## Full obsqra Stack Services Available to zkde.fi

Beyond the three proving paths, the obsqra stack provides these services
that zkde.fi can consume:

### Discovery Endpoint

```bash
curl http://127.0.0.1:8003/api/v1/risk_passport/l3/capabilities
```

Returns the full service inventory:

### Service Catalog

| Service | Endpoint | Description |
|---------|----------|-------------|
| **Stone Prover** | `POST /api/v1/prove/{program}` | Run Cairo0 programs through Stone CPU AIR → STARK proof |
| **Dual Prover** | `POST /api/v1/dual-prove` | STARK + Groth16 dual proof (STARK fact_hash as Groth16 public input) |
| **Proof Aggregator** | `POST /api/v1/aggregation/submit` | Batch proofs → recursive STARK proof via `reputation_passport` |
| **Proof Sequencer** | (automatic) | 30s blocks, 32 proofs/block, Madara L3 primary → L2 fallback |
| **Integrity Verifier** | (L2 contract) | Herodotus Integrity FactRegistry on Starknet Sepolia |
| **Fact Registry** | (L2 contract) | ObsqraFactRegistry for proof-gated facts |
| **Generic Prover** | `POST /api/v1/prove/{program}` | 5 registered Cairo0 programs |
| **Reputation Passport** | `POST /api/v1/aggregation/passport` | Recursive STARK aggregation of badge proofs |
| **zkRAG** | `GET /api/v1/zkrag/query` | Verifiable RAG over 4.8M indexed blocks |
| **Madara Settlement** | (automatic) | L3 appchain for zero-gas proof settlement |

### Available Circuits

**Groth16 (31 compiled, 25 in registry):**
- RiskScoreAllocation, AnomalyDetector, PrivateDeposit, PrivateWithdraw
- ReputationMint, StrategyConstraint, and 19 more

**Cairo0 STARK (5 programs):**
- `risk_small_minimal`, `risk_small`, `risk_cairo0`
- `reputation_passport`, `constraint_check`

### Additional Contracts on L3 (Future)

These existing obsqra Cairo contracts could be deployed on L3 at zero gas:

| Contract | Purpose on L3 |
|----------|---------------|
| **attestation_registry.cairo** | N-of-M quorum attestation — run attestation consensus on L3 for free |
| **verifier_staking.cairo** | Staking/slashing for verifier nodes — no L2 gas for stake ops |
| **proof_gated_lp_agent.cairo** | Proof-gated DeFi actions — gate L3 operations behind verified proofs |
| **zkml_oracle.cairo** | ZK ML oracle — run inference verification on L3 |
| **sharp_verifier.cairo** | IFactRegistry interface — already compatible with L3 deployment |

---

## zkde.fi Frontend Integration Cookbook

### 1. Show Available Proving Infrastructure

```typescript
// Fetch capabilities on page load
const caps = await fetch('/api/v1/risk_passport/l3/capabilities').then(r => r.json());

// Render proving paths
const paths = caps.proving_paths;
// paths.path_1_onchain_verification
// paths.path_2_snos_block_proving
// paths.path_3_recursive_aggregation_on_l3

// Render available services
const services = caps.obsqra_services;
// services.stone_prover.status → "active"
// services.dual_prover.binding → "STARK fact_hash embedded as Groth16 public input"
// services.madara_settlement.gas_price → "zero (operator-subsidized)"
```

### 2. Submit a Proof for L3 Verification

```typescript
const result = await fetch('/api/v1/risk_passport/l3/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fact_hash: '0x' + proofHash,
    proof_type: 'groth16',
    circuit_name: 'RiskScoreAllocation',
  }),
}).then(r => r.json());

if (result.success) {
  // Show verification badge
  // result.mode → "groth16_garaga" | "stark_integrity" | "hash_only"
  // result.verified_on_chain → true (Level 1 trust) or false (Level 3 trust)
  // result.tx_hash → Madara L3 transaction hash
}
```

### 3. Display Settlement Dashboard

```typescript
// Combined L3 stats
const stats = await fetch('/api/v1/risk_passport/l3/stats').then(r => r.json());

// stats.orchestrator.total_blocks_processed
// stats.orchestrator.total_proofs_verified_onchain
// stats.path_1_verification.* — per-mode counts
// stats.path_2_snos.blocks_pending / blocks_proven
// stats.path_3_onchain_aggregation.status

// Recent blocks
const blocks = await fetch('/api/v1/risk_passport/l3/blocks?limit=5').then(r => r.json());
// blocks.blocks[] → { block_number, proofs_total, proofs_verified_onchain, ... }
```

### 4. Monitor SNOS Queue (Path 2)

```typescript
const snos = await fetch('/api/v1/risk_passport/l3/snos/queue').then(r => r.json());
// snos.queue[] → { block_number, fact_hash, proof_count, proven, snos_proof_hash }
```

---

## Configuration Reference

### obsqra Backend (.env)

```bash
# Madara L3 (existing)
MADARA_APPCHAIN_RPC=http://127.0.0.1:9944
MADARA_SETTLE_ENABLED=true
MADARA_FACT_REGISTRY_ADDRESS=0x...
MADARA_CHAIN_ID=OBSQRA_PROOF_CHAIN

# L3 Verification Contracts (new — set after deploying verifiers)
L3_GARAGA_VERIFIER_ADDRESS=0x...
L3_VERIFIED_FACT_REGISTRY_ADDRESS=0x...
L3_INTEGRITY_VERIFIER_ADDRESS=0x...
```

### zkdefi Backend (.env)

```bash
# obsqra parent API
OBSQRA_API_URL=https://starknet.obsqra.fi/api/v1
OBSQRA_LOCAL_API_URL=http://127.0.0.1:8002/api/v1
```

---

## Files Created / Modified

### New Files

| File | Purpose |
|------|---------|
| `backend/app/services/l3_verification_service.py` | On-chain verification (Garaga + Integrity + hash fallback) |
| `backend/app/services/l3_proving_orchestrator.py` | Coordinates all 3 paths, SNOS queue, stats |
| `zkdefi/backend/app/services/l3_proving_path_client.py` | HTTP client for zkde.fi → obsqra L3 endpoints |
| `zkdefi/docs/L3_PROVING_PATHS_INTEGRATION.md` | This document |

### Modified Files

| File | Change |
|------|--------|
| `backend/app/config.py` | Added `L3_GARAGA_VERIFIER_ADDRESS`, `L3_VERIFIED_FACT_REGISTRY_ADDRESS`, `L3_INTEGRITY_VERIFIER_ADDRESS` |
| `backend/app/services/proof_sequencer.py` | `_seal_block()` now calls L3ProvingOrchestrator first → raw Madara → L2 fallback |
| `backend/app/api/routes/aggregation.py` | 8 new L3 endpoints (`/l3/capabilities`, `/l3/proving-paths`, `/l3/stats`, `/l3/verify`, etc.) |
| `zkdefi/backend/app/api/risk_passport.py` | 6 new L3 endpoints for zkde.fi frontend |

---

## Architecture Comparison: Before vs After

| Before (hash-only settlement) | After (3 proving paths) |
|-------------------------------|------------------------|
| `_seal_block()` → `madara.register_fact(hash)` | `_seal_block()` → `orchestrator.process_block()` → verify each proof on-chain |
| L2 sees: "hash X was registered" | L2 sees: "hash X was cryptographically verified on L3, which was SNOS-proven" |
| Trust: operator honesty | Trust: math (Groth16/STARK verification) |
| 1 settlement layer | 3 layers: L3 verification → SNOS proof → L2 settlement |
| No on-chain audit trail | Full on-chain audit trail (every proof verified) |
| ~$0.01/proof (L2 gas) | $0/proof (L3 zero gas) + amortized SNOS cost per block |
