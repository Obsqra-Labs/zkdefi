# Madara L3 Appchain — Architecture & Integration Guide

> **Status:** Implemented (binary building, not yet live)  
> **Date:** 2026-03-05  
> **Scope:** How the Obsqra Proof Chain (Madara L3) integrates with obsqra.fi and zkde.fi

---

## 1. What Is This and Why

### The Problem

The current proof settlement path is:

```
zkdefi proof → obsqra ProofSequencer → batches into blocks (30s)
  → Stone STARK recursive proof per block
  → register_fact() on Starknet Sepolia L2 (ObsqraFactRegistry)
```

Every sealed block = 1 Starknet L2 transaction. At scale this means:
- Gas costs grow linearly with proof volume
- 6-minute Starknet finality per proof batch
- No control over block space — competes with all other Starknet traffic
- No custom execution environment for proof-specific logic

### The Solution: Dedicated Proof Chain

**Madara** is a Starknet-compatible sequencer framework. We run it as an **L3 appchain** — a dedicated chain specifically for proof-fact registration that settles state-diffs back to Starknet L2.

```
zkdefi proofs → obsqra ProofSequencer → Madara L3 (5s blocks, zero gas)
                                             ↓
                                    Starknet L2 (state-diff settlement)
                                             ↓
                                    Ethereum L1 (finality)
```

| Benefit | Detail |
|---------|--------|
| Dedicated block space | Proof registrations don't compete with other Starknet traffic |
| 5-second blocks | Near-instant finality on L3 vs 6min on Starknet |
| Zero/subsidized gas | Operator controls gas pricing; proof registration is free |
| Batched L2 settlement | Hundreds of L3 blocks → one L2 state-diff proof |
| Same contract interface | `register_fact()` / `is_valid()` — identical on L2 and L3 |

---

## 2. Architecture

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        zkde.fi (port 8003)                       │
│                                                                  │
│  ProofPipeline ──→ ProofSequencerClient ──→ obsqra /aggregation/submit  │
│  MadaraSettlementClient ──→ obsqra /aggregation/madara/*         │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      obsqra.fi (port 8002)                       │
│                                                                  │
│  ProofSequencer._seal_block()                                    │
│    ├─ Stone STARK proof (reputation_passport program)            │
│    ├─ if MADARA_SETTLE_ENABLED:                                  │
│    │     MadaraSettlementService.register_fact() → Madara L3     │
│    │     (if fails → fallback to L2)                             │
│    └─ else / fallback:                                           │
│          IntegrityService.register_fact_in_obsqra_registry() → L2│
│                                                                  │
│  API Routes:                                                     │
│    GET  /aggregation/madara/health                               │
│    GET  /aggregation/madara/stats                                │
│    POST /aggregation/madara/verify                               │
│    GET  /aggregation/madara/fact-count                           │
│    GET  /aggregation/settlement/config                           │
└──────────────────────────┬───────────────────────────────────────┘
                           │ starknet_py (JSON-RPC)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Madara L3 — Obsqra Proof Chain                      │
│                                                                  │
│  Chain ID:    OBSQRA_PROOF_CHAIN                                 │
│  RPC:         http://127.0.0.1:9944                              │
│  Block time:  5 seconds                                          │
│  Gas price:   0 (operator-subsidized)                            │
│  Contract:    ObsqraFactRegistry (same as L2)                    │
│                                                                  │
│  State-diff settlement → Starknet L2                             │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Starknet Sepolia (L2)                         │
│                                                                  │
│  ObsqraFactRegistry: 0x059b65...a664a8                           │
│  Integrity Verifier:  0x4ce785...1b8c                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Map

| Component | Path | Role |
|-----------|------|------|
| **MadaraSettlementService** | `backend/app/services/madara_settlement_service.py` | Core service: `register_fact()`, `verify_fact()`, `health_check()`, `get_fact_count()` on Madara L3 |
| **ProofSequencer** (upgraded) | `backend/app/services/proof_sequencer.py` | `_seal_block()` tries Madara L3 first, falls back to Starknet L2 |
| **Aggregation API** (upgraded) | `backend/app/api/routes/aggregation.py` | 5 new endpoints for Madara health, stats, verify, fact-count, settlement config |
| **MadaraSettlementClient** | `zkdefi/backend/app/services/madara_settlement_client.py` | HTTP bridge: zkdefi → obsqra → Madara L3 status queries |
| **Risk Passport API** (upgraded) | `zkdefi/backend/app/api/risk_passport.py` | 3 new endpoints: `/settlement/config`, `/settlement/madara/health`, `/settlement/madara/verify` |
| **Chain Config** | `madara/configs/presets/obsqra_proof_chain.yaml` | 5s blocks, zero gas, chain_id=OBSQRA_PROOF_CHAIN |
| **Sequencer Config** | `madara/configs/obsqra_sequencer_config.yaml` | RPC :9944, gateway :8080, L1 sync disabled |
| **Deploy Script** | `deploy_madara_fact_registry.sh` | `starkli declare + deploy` ObsqraFactRegistry on Madara L3 |
| **Startup Script** | `start_madara_appchain.sh` | Start Madara node (foreground or PM2) |

### 2.3 Config Settings

All in `backend/app/config.py` (pydantic Settings, env-overridable):

| Setting | Default | Purpose |
|---------|---------|---------|
| `MADARA_APPCHAIN_RPC` | `""` | Madara L3 JSON-RPC URL (e.g. `http://127.0.0.1:9944`) |
| `MADARA_SETTLE_ENABLED` | `false` | Enable Madara as primary settlement layer |
| `MADARA_CHAIN_ID` | `OBSQRA_PROOF_CHAIN` | Chain ID configured in Madara genesis |
| `MADARA_FACT_REGISTRY_ADDRESS` | `""` | ObsqraFactRegistry deployed on Madara L3 |
| `MADARA_WALLET_ADDRESS` | `""` | Sequencer wallet on Madara (falls back to `BACKEND_WALLET_ADDRESS`) |
| `MADARA_WALLET_PRIVATE_KEY` | `""` | Sequencer wallet key (falls back to `BACKEND_WALLET_PRIVATE_KEY`) |
| `MADARA_BLOCK_TIME` | `5s` | Target block time |
| `MADARA_L2_SETTLEMENT_CONTRACT` | `""` | L2 contract for L3→L2 state-diff settlement |

---

## 3. Settlement Flow

### 3.1 Happy Path (Madara Enabled)

```
1. ProofSequencer._seal_block() fires every 30s
2. Batch of proofs → Stone STARK recursive proof (or SHA-256 fallback)
3. MADARA_SETTLE_ENABLED=true → MadaraSettlementService.register_fact()
4. starknet_py invoke: register_fact(fact_hash, 96, 0x1) on Madara L3
5. Madara block confirms in ~5s
6. Block marked settled: settlement_tx = "madara_l3:{tx_hash}"
7. Madara automatically batches L3 state-diffs → settles to Starknet L2
```

### 3.2 Fallback Path (Madara Down)

```
1. ProofSequencer._seal_block() fires every 30s
2. Batch → STARK proof
3. MADARA_SETTLE_ENABLED=true but MadaraSettlementService.register_fact() fails
4. Log warning, fall through
5. IntegrityService.register_fact_in_obsqra_registry() on Starknet L2 directly
6. Block marked settled: settlement_tx = "starknet_l2:settled_block_{n}"
```

### 3.3 Default Path (Madara Disabled)

```
1. MADARA_SETTLE_ENABLED=false (current state)
2. ProofSequencer._seal_block() skips Madara entirely
3. IntegrityService.register_fact_in_obsqra_registry() on Starknet L2
4. Same as production behavior pre-Madara
```

---

## 4. How zkde.fi Integrates

### 4.1 What zkde.fi Already Does (Unchanged)

- `ProofSequencerClient` POSTs proofs to `obsqra /aggregation/submit` — **no change needed**
- `ObsqraProverClient` requests Stone STARK proofs — **no change needed**
- `ReputationPassportClient` requests passport aggregation — **no change needed**

The key insight: **zkde.fi never talks directly to the settlement layer**. It submits proofs via HTTP to obsqra, and obsqra handles where they land (L2 or L3). This means zkde.fi is settlement-agnostic by design.

### 4.2 What zkde.fi Gets from Madara (New)

Three new endpoints on the zkde.fi API give the frontend visibility into settlement:

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/risk_passport/settlement/config` | GET | Which settlement layer is primary (madara_l3 or starknet_l2), enabled status |
| `/risk_passport/settlement/madara/health` | GET | Madara node health, latest block number, chain ID |
| `/risk_passport/settlement/madara/verify` | POST | Whether a specific fact_hash is registered on Madara L3 |

These are proxied through the `MadaraSettlementClient` → obsqra API → Madara RPC.

### 4.3 Frontend Implications

The frontend can now:
1. Show a "Settlement: Madara L3" or "Settlement: Starknet L2" badge
2. Link to the correct explorer for proof verification
3. Show Madara block height in agent/proof dashboards
4. Verify individual facts on L3

No frontend code changes are required yet — just new API endpoints ready for consumption.

---

## 5. Potential Proving Path on L3

Madara is a **sequencer**, not a prover — it produces blocks and executes Cairo contracts. But because it's Starknet-compatible, it opens three distinct proving paths that don't exist when settling directly to L2.

### 5.1 SNOS Block Proving (L3 → L2 Validity Proofs)

Starknet OS (SNOS) can process Madara blocks to produce STARK proofs of the entire L3 state transition. This is how Starknet itself settles to Ethereum.

```
Madara L3 blocks → SNOS execution trace → Stone/STWO prover → STARK proof
  → Submit to L2 Starknet core contract → State-diff accepted with validity proof
```

**What this gives us:** Every fact registered on L3 becomes provably included in an L2-verified state root. The L3→L2 bridge is secured by a validity proof, not just a trusted sequencer.

**Current state:** Madara saves Bouncer Weights for SNOS during block production (the hook is in `block_production/src/lib.rs`). The SNOS + prover pipeline needs to be configured externally — Madara doesn't bundle a prover, but its blocks are designed to be provable.

**What's needed:**
- SNOS compiled for our chain config (`OBSQRA_PROOF_CHAIN`)
- Stone or STWO prover instance pointed at L3 block traces
- L2 settlement contract that accepts these proofs (Madara's `settlement_client` crate handles this)

### 5.2 On-Chain Verification at Zero Gas

This is the most immediately useful proving path. Since L3 gas is zero (operator-subsidized), we can deploy **verification contracts** on L3 that would be prohibitively expensive on L2:

| Verifier | L2 Cost | L3 Cost | Why it matters |
|----------|---------|---------|----------------|
| **Garaga Groth16 BN254** | ~200K gas | **0** | Verify all 31 SNARK circuits on-chain for free |
| **STARK verifier** | ~500K gas | **0** | Verify Stone STARK proofs directly on L3 |
| **Recursive verifier** | ~1M gas | **0** | Verify aggregated proofs of proofs |
| **zkML model verifier** | ~300K gas | **0** | Full on-chain verification of ML inference proofs |

```
Current:   proof → register_fact(hash) on L3  (trust: "the obsqra backend verified it")
Potential: proof → verify_groth16_proof(calldata) on L3  (trust: "the L3 contract verified it")
           → register_fact(hash) on L3 only if verification passes
```

**What this gives us:** Facts on L3 aren't merely registered — they're **verified on-chain**. The trust model shifts from "obsqra backend says it's valid" to "the L3 Cairo VM cryptographically verified it."

**What's needed:**
- Deploy Garaga verifier contract on L3 (same contract used on Starknet, just redeploy)
- Modify `MadaraSettlementService.register_fact()` to call verify-then-register instead of just register
- Deploy a `VerifiedFactRegistry` contract that only accepts facts with passing verification

### 5.3 Recursive Aggregation on L3

Combining paths 5.1 and 5.2: run the entire proof aggregation pipeline as L3 contracts rather than off-chain services.

```
Current (off-chain):
  Individual proofs → Python ProofAggregator → Stone STARK → register_fact()

Potential (on-chain L3):
  Individual proofs → L3 verifier contracts (free) → L3 aggregation contract
    → Aggregate fact hash computed on-chain → SNOS proves the whole L3 block
    → Single STARK proof settles to L2
```

**What this gives us:** The entire aggregation pipeline becomes verifiable. Instead of trusting the Python ProofAggregator, the L3 chain itself becomes the aggregation engine. SNOS then proves the aggregation was done correctly.

**Practical timeline:**
- **Phase 1 (done ✅):** Settlement only — `register_fact()` on L3
- **Phase 2 (done ✅):** On-chain verification — `L3VerificationService` verifies via Garaga/Integrity before registering. `L3ProvingOrchestrator` coordinates all paths. ProofSequencer upgraded to use orchestrator.
- **Phase 3 (infrastructure ready 🔄):** SNOS proving — SNOS block queue operational, external prover pipeline needs configuration
- **Phase 4 (planned):** On-chain aggregation — move ProofAggregator logic into L3 contracts

> **See [L3_PROVING_PATHS_INTEGRATION.md](L3_PROVING_PATHS_INTEGRATION.md)** for the complete implementation guide, API reference, and zkde.fi frontend cookbook.

### 5.4 Why This Matters

The proving path transforms Madara from a "cheap database for fact hashes" into a **verifiable computation layer**:

| Without Proving | With Proving |
|----------------|-------------|
| L3 stores fact hashes (no verification) | L3 verifies proofs then stores facts |
| Trust the sequencer operator | Trust the Cairo VM + STARK proofs |
| L2 just sees state-diffs | L2 gets validity-proven state roots |
| Off-chain aggregation | On-chain aggregation (provable) |

The zero-gas property makes this practical. On L2, running a Groth16 verifier costs real money per proof. On L3, it costs nothing — the operator absorbs execution cost, and the chain proves it was done correctly via SNOS.

---

## 6. Gap Analysis

### 6.1 What's Done (✅)

| Item | Status |
|------|--------|
| MadaraSettlementService (register, verify, health, stats) | ✅ Tested |
| ProofSequencer Madara→L2 fallback wiring | ✅ Tested (live Starknet L2 settlement confirmed) |
| ProofSequencer → L3ProvingOrchestrator upgrade | ✅ Orchestrator-first → raw Madara → L2 fallback |
| L3VerificationService (Garaga + Integrity + hash-only) | ✅ 3 verification modes, stats, discovery |
| L3ProvingOrchestrator (coordinates all 3 paths) | ✅ Block processing, SNOS queue, capabilities |
| obsqra API routes (5 Madara + 8 L3 endpoints) | ✅ Zero errors |
| zkdefi L3ProvingPathClient | ✅ Full HTTP client for all L3 endpoints |
| zkdefi risk_passport L3 endpoints (6 endpoints) | ✅ Zero errors |
| Config settings (8 MADARA_* + 3 L3_* vars) | ✅ In pydantic Settings |
| L3 Proving Paths Integration Doc | ✅ Complete with API ref + frontend cookbook |
| Madara chain config (5s blocks, zero gas) | ✅ Written |
| Madara sequencer config (RPC :9944) | ✅ Written |
| FactRegistry deploy script | ✅ Written |
| Startup script (foreground + PM2) | ✅ Written |

### 6.2 What's Pending (🔄)

| Item | Blocker | ETA |
|------|---------|-----|
| Madara binary build | Compiling (LLVM 19 + OpenSSL installed, build running) | ~45 min |
| FactRegistry deployment on L3 | Needs running Madara node | After build |
| Live settlement test on L3 | Needs running node + deployed contract | After deploy |
| PM2 ecosystem entry for Madara | Trivial — one line in ecosystem.config.cjs | 2 min |

### 6.3 Known Gaps (❌)

| Gap | Severity | Description |
|-----|----------|-------------|
| **L3→L2 state-diff settlement** | Medium | Madara's built-in orchestrator handles this, but we haven't configured the L2 settlement contract yet. Facts are provable on L3 but not automatically bridged to L2 until this is configured. |
| **Wallet funding on L3** | Low | Madara devnet pre-funds known accounts, but if we use a custom genesis we need to ensure the sequencer wallet has balance. |
| **No monitoring/alerts** | Low | No Prometheus metrics or alerting for Madara node health. The `health_check()` endpoint exists but nothing polls it automatically. |
| **No frontend settlement badge** | Low | Endpoints ready but frontend doesn't render settlement layer info yet. |
| **No block explorer** | Low | No Voyager/Starkscan equivalent for the L3. Would need to deploy a lightweight explorer or use Madara's built-in gateway. |
| **FactRegistry admin key rotation** | Low | Same wallet is admin+registrar on L3. Should separate for production. |
| **Madara version pinning** | Low | Using latest `main` branch. Should pin to a tagged release for stability. |

### 6.4 What Does NOT Need Madara

These are explicitly out of scope — Madara is only for settlement:

- zkML model inference — stays in zkde.fi backend
- EZKL/Circom proof generation — stays in zkde.fi
- Stone STARK proof generation — stays in obsqra
- Reputation passport aggregation — stays in obsqra
- All HTTP API communication — unchanged
- Frontend — unchanged (new endpoints available but not consumed yet)

---

## 7. Operations

### 7.1 Starting Madara

```bash
# Build (one-time, ~45 min)
cd /opt/obsqra.starknet/madara/madara
export LLVM_SYS_191_PREFIX=/usr/lib64/llvm19
export LLVM_CONFIG=/usr/bin/llvm-config-19
cargo build --release -p madara

# Start
./start_madara_appchain.sh        # foreground
./start_madara_appchain.sh --bg   # PM2 background
```

### 7.2 Deploying FactRegistry on L3

```bash
# Ensure Madara is running first
./deploy_madara_fact_registry.sh
# Outputs contract address → add to .env
```

### 7.3 Enabling Settlement

Add to `backend/.env`:
```
MADARA_APPCHAIN_RPC=http://127.0.0.1:9944
MADARA_SETTLE_ENABLED=true
MADARA_FACT_REGISTRY_ADDRESS=<from deploy output>
MADARA_CHAIN_ID=OBSQRA_PROOF_CHAIN
```

Restart obsqra backend. ProofSequencer will now settle to Madara L3 automatically.

### 7.4 Monitoring

```bash
# Health check
curl http://127.0.0.1:8002/api/v1/aggregation/madara/health

# Stats
curl http://127.0.0.1:8002/api/v1/aggregation/madara/stats

# Settlement config
curl http://127.0.0.1:8002/api/v1/aggregation/settlement/config

# Fact count
curl http://127.0.0.1:8002/api/v1/aggregation/madara/fact-count

# L3 Proving Paths
curl http://127.0.0.1:8002/api/v1/aggregation/l3/capabilities
curl http://127.0.0.1:8002/api/v1/aggregation/l3/proving-paths
curl http://127.0.0.1:8002/api/v1/aggregation/l3/stats
curl http://127.0.0.1:8002/api/v1/aggregation/l3/blocks
curl http://127.0.0.1:8002/api/v1/aggregation/l3/snos/queue

# zkde.fi side (all proxied to obsqra)
curl http://127.0.0.1:8003/api/v1/risk_passport/l3/capabilities
curl http://127.0.0.1:8003/api/v1/risk_passport/l3/proving-paths
curl http://127.0.0.1:8003/api/v1/risk_passport/l3/stats
```

---

## 8. Relationship to Existing Infrastructure

| Existing | Relationship to Madara |
|----------|----------------------|
| **IntegrityService** | Madara-deployed FactRegistry uses same `register_fact()` / `is_valid()` interface. IntegrityService remains as L2 fallback. |
| **ProofAggregator** | Unchanged. Batches proofs, feeds them to ProofSequencer. |
| **ProofSequencer** | Primary consumer. `_seal_block()` calls MadaraSettlement first, L2 second. |
| **VerifierNode** | Could be extended to poll L3 FactRegistry in addition to L2. Not yet wired. |
| **Stone Prover** | Unchanged. STARK proofs are generated identically regardless of settlement layer. |
| **ReputationPassportAggregator** | Unchanged. Aggregation result's fact_hash is what gets settled. |
| **ObsqraFactRegistry (L2)** | Still deployed on Starknet Sepolia. Remains the authoritative registry when Madara is disabled. |
