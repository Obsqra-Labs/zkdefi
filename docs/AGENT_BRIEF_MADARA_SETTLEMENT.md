# Agent Brief: Madara L3 Settlement Layer

> **For:** AI coding agent continuing development  
> **Date:** 2026-03-05  
> **Read first:** [MADARA_L3_APPCHAIN_ARCHITECTURE.md](MADARA_L3_APPCHAIN_ARCHITECTURE.md)

---

## What Changed

A Madara L3 appchain ("Obsqra Proof Chain") was added as the primary settlement layer for proof facts. Previously, every sealed proof block went directly to Starknet L2. Now the path is: **Madara L3 (5s, zero gas) → Starknet L2 (state-diff) → Ethereum L1**.

Fallback: if Madara is down, settlement automatically falls through to Starknet L2. Controlled by `MADARA_SETTLE_ENABLED` (currently `false`).

## Files You Need to Know

### obsqra Backend (port 8002)
| File | What |
|------|------|
| `backend/app/services/madara_settlement_service.py` | Core service: `register_fact()`, `verify_fact()`, `health_check()` via starknet_py → Madara RPC |
| `backend/app/services/proof_sequencer.py` | `_seal_block()` tries Madara first, L2 fallback. Settlement tx format: `madara_l3:{hash}` or `starknet_l2:settled_block_{n}` |
| `backend/app/api/routes/aggregation.py` | 5 new endpoints under `/aggregation/madara/*` and `/aggregation/settlement/config` |
| `backend/app/config.py` | 8 new `MADARA_*` settings (all default to empty/false) |

### zkdefi Backend (port 8003)
| File | What |
|------|------|
| `zkdefi/backend/app/services/madara_settlement_client.py` | HTTP bridge: calls obsqra's Madara endpoints |
| `zkdefi/backend/app/api/risk_passport.py` | 3 new endpoints: `/settlement/config`, `/settlement/madara/health`, `/settlement/madara/verify` |

### Infrastructure
| File | What |
|------|------|
| `madara/configs/presets/obsqra_proof_chain.yaml` | Chain config: `OBSQRA_PROOF_CHAIN`, 5s blocks, zero gas |
| `madara/configs/obsqra_sequencer_config.yaml` | Sequencer config: RPC :9944, gateway :8080 |
| `deploy_madara_fact_registry.sh` | Deploy ObsqraFactRegistry on L3 |
| `start_madara_appchain.sh` | Start node (foreground or PM2 `--bg`) |

### Docs Updated
| File | Change |
|------|--------|
| `zkdefi/docs/MADARA_L3_APPCHAIN_ARCHITECTURE.md` | **NEW** — full architecture, gap analysis, operations guide |
| `zkdefi/docs/zkgraph-zkrag/ARCHITECTURE.md` | ProofSequencer row updated (no longer "future") |
| `zkdefi/docs/zkgraph-zkrag/DECISIONS_AND_QUESTIONS.md` | Q6 updated to "IMPLEMENTED" |
| `zkdefi/docs/PROOF_SYSTEM_ARCHITECTURE.md` | Settlement layer section + updated arch diagram |
| `ARCHITECTURE.md` (root) | Madara L3 box added above Smart Contract Layer |

## Current State

- **Code:** Complete and validated (zero errors)
- **Binary:** Building from source at `/opt/obsqra.starknet/madara/madara/` (Rust, ~45 min). Needs `LLVM_SYS_191_PREFIX=/usr/lib64/llvm19`
- **Activation:** `MADARA_SETTLE_ENABLED=false` — not live yet. Flip to `true` after binary builds, node starts, and FactRegistry is deployed on L3

## To Activate (Sequence)

1. Wait for `madara/madara/target/release/madara` binary to exist
2. `./start_madara_appchain.sh` → confirm RPC at `http://127.0.0.1:9944`
3. `./deploy_madara_fact_registry.sh` → get contract address
4. Set in `backend/.env`:
   ```
   MADARA_APPCHAIN_RPC=http://127.0.0.1:9944
   MADARA_SETTLE_ENABLED=true
   MADARA_FACT_REGISTRY_ADDRESS=<from step 3>
   ```
5. Restart obsqra backend
6. Verify: `curl localhost:8002/api/v1/aggregation/madara/health`

## Known Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| L3→L2 state-diff bridge config | Medium | Madara handles this natively but needs the L2 settlement contract address configured |
| PM2 ecosystem entry | Low | Add `madara-node` to `ecosystem.config.cjs` |
| Monitoring/alerting | Low | No auto-polling of `/madara/health`; add to cron or PM2 monitoring |
| Frontend settlement badge | Low | Endpoints ready, frontend not consuming them yet |
| Block explorer for L3 | Low | No Voyager equivalent; could use Madara gateway |
| Key rotation (admin vs registrar) | Low | Same wallet for both roles on L3; separate for production |

## What NOT to Change

- `ProofSequencerClient` on zkdefi — it's settlement-agnostic (HTTP only)
- `IntegrityService` — remains the L2 fallback; don't remove
- `ObsqraProverClient` — Stone STARK proof generation is unchanged
- Any circuit/proof generation code — Madara is settlement only, not proving

## Proving Path (NEW — Section 5 of architecture doc)

Madara doesn't prove, but being Starknet-compatible opens three proving paths:

1. **SNOS Block Proving** — Starknet OS can prove L3 blocks → validity-proven L3→L2 settlement
2. **On-Chain Verification at Zero Gas** — Deploy Garaga/STARK verifiers on L3 (free execution). Transform fact registration from "store hash" to "verify proof + store hash"
3. **Recursive Aggregation on L3** — Move ProofAggregator logic into L3 contracts, let SNOS prove the aggregation

Phase plan: Settlement (now) → On-chain verification (next) → SNOS proving (future) → On-chain aggregation (aspirational)

## Build Status

The Madara binary requires MLIR headers (for Cairo Native execution). MLIR is being built from LLVM 19.1.7 source at `/opt/obsqra.starknet/llvm-project-19.1.7.src/build-mlir/`. After MLIR installs to `/usr/lib64/llvm19`, restart the Madara build with:
```bash
cd /opt/obsqra.starknet/madara/madara
MLIR_SYS_190_PREFIX=/usr/lib64/llvm19 \
LLVM_SYS_191_PREFIX=/usr/lib64/llvm19 \
LLVM_CONFIG=/usr/bin/llvm-config-19 \
LIBCLANG_PATH=/usr/lib64/llvm19/lib \
cargo build --release -p madara
```
