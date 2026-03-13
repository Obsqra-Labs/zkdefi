# Recursive Multichain Proving Core

_Last updated: 2026-03-13 (UTC)_

This page defines zkde.fi's proving core as a layered multichain system:

1. **Execution proof depth** (`ProofMode`) decides how hard each action is proven.
2. **Verification lane** decides which verifier runs (`groth16_garaga`, `stark_integrity`, `noir_honk`, `native_kzg`).
3. **Settlement recursion path** decides how verified facts propagate across L3/L2/L1 over time.

Together, these are the core layer that turns private strategy execution into auditable, cryptographic state.

## 1) Execution Proof Modes (runtime `proof_mode`)

Source of truth: `backend/app/services/proof_mode.py`

| ProofMode | What is proven | Typical verifier mode | L2 gas profile | Primary unlock |
|---|---|---|---|---|
| `EZKL_ONLY` (0) | EZKL verification off-chain only | n/a | `0` | Fast, low-cost exploration and advisory previews |
| `EZKL_BRIDGE` (1) | EZKL output is bound into bridge circuit commitment | `groth16_garaga` | ~34M | On-chain verifiable model-identity + bounded output gating |
| `FULL_DUAL_PROVER` (2) | `EZKL_BRIDGE` + independent STARK/integrity lane | `groth16_garaga` + `stark_integrity` | ~77M | Defense-in-depth: independent SNARK + STARK trust posture |

## 2) Bridge Circuits and Lanes

Source of truth: `backend/app/services/proof_pipeline.py` (`bridge_circuit` routing)

| Bridge circuit | Proof payload type | Lane intent | Current status |
|---|---|---|---|
| `ModelBridge` | Groth16 calldata | Baseline EZKL -> Groth16 bridge on Starknet | Live |
| `ModelBridgeHeavy` | Groth16 calldata | Heavier bridge constraints for stronger policy gating | Live lane + local heavy verifier artifacts |
| `NoirEzklBridge` | HONK calldata (`proof_type=noir_honk`) | Path A high-assurance Noir/HONK lane | Live lane with on-chain receipt evidence |
| `EzklNativeKzg` | `ezkl_kzg_v1` payload (`proof_type=native_kzg`) | Path B native KZG semantics in Cairo | In progress (strict non-placeholder gating active) |

## 3) Verifier Modes Returned by L3

Source of truth: `backend/app/services/l3_proving_path_client.py`

| `l3.mode` | Meaning | Trust posture |
|---|---|---|
| `groth16_garaga` | Garaga verifier accepted Groth16 proof | Cryptographically verified on-chain |
| `stark_integrity` | Integrity verifier accepted STARK proof | Cryptographically verified on-chain |
| `noir_honk` | HONK verifier accepted Noir proof | Cryptographically verified on-chain |
| `native_kzg` | KZG verifier accepted `ezkl_kzg_v1` proof payload | Cryptographically verified on-chain |
| `hash_only` | Fact hash registered without cryptographic verifier call | Availability fallback only |

## 4) Recursive Multichain Paths

### Path model (L3 recursion stack)

- **Path 1: On-chain verification on L3**
  - Proofs are verified in Cairo verifiers, then facts are registered.
  - This is the active production lane for most flows.
- **Path 2: SNOS block proving (L3 -> L2)**
  - L3 blocks are validity-proven so L2 can trust L3 state root transitions.
  - Queue and integration surfaces exist; full operational proving flow is staged.
- **Path 3: On-chain recursive aggregation on L3**
  - Aggregation logic moves from backend service into L3 contracts.
  - Planned path for fully on-chain aggregation semantics.

### EZKL roadmap mapping

Source of truth: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md`

| Roadmap path | Objective | Stage |
|---|---|---|
| **Path A** | Noir HONK bridge (`NoirEzklBridge`) | Implemented and live (receipt evidence captured); next is stability benchmarking/runbook |
| **Path C** | L1 Solidity verifier + L1->L2 bridge | Implemented in code and contracts; production operations are live-bridge hardening |
| **Path B** | Native Cairo KZG verification | In progress; strict payload and trailer validation active, final end-to-end pass coverage remains |

## 5) Live Receipts and On-Chain Evidence

### Starknet Sepolia (Voyager)

- ModelBridge verifier contract:
  - `0x037c42e8734271aca0c3c1bdf1746d9ccc098ddfd5ee211c94bbb8786fa4626f`
  - <https://sepolia.voyager.online/contract/0x037c42e8734271aca0c3c1bdf1746d9ccc098ddfd5ee211c94bbb8786fa4626f>
- ModelBridge verifier class:
  - `0x04745a6bcd5a3306d7ed2eac2a5f5a53f66cfd7afee4c7a7d1d18cb5574257f8`
  - <https://sepolia.voyager.online/class/0x04745a6bcd5a3306d7ed2eac2a5f5a53f66cfd7afee4c7a7d1d18cb5574257f8>
- ModelBridge-capable `ZkmlVerifier`:
  - `0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923`
  - <https://sepolia.voyager.online/contract/0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923>

### Recent proof receipts (`artifacts/hackathon_showcase/latest.json`)

- ModelBridge L3 verify (`groth16_garaga`, `verified_on_chain=true`):
  - `0x2c8ea7551f965f4c73292cd3d00745d088b5572c7154bf6b3746c9f66a0679b`
  - <https://sepolia.voyager.online/tx/0x2c8ea7551f965f4c73292cd3d00745d088b5572c7154bf6b3746c9f66a0679b>
- ModelBridgeHeavy lane receipt (`groth16_garaga`, `verified_on_chain=true`):
  - `0x49226ffb495953f1a981020ebb61e8ac462410b750ac672dd21d3f0a8f5b59c`
  - <https://sepolia.voyager.online/tx/0x49226ffb495953f1a981020ebb61e8ac462410b750ac672dd21d3f0a8f5b59c>
- Heavy STARK reputation (`stark_integrity`, `verified_on_chain=true`):
  - `0x7249f4a0dc41f12dd5249f4e7284c0f4d392ec69740396d1de4e0f83126739d`
  - <https://sepolia.voyager.online/tx/0x7249f4a0dc41f12dd5249f4e7284c0f4d392ec69740396d1de4e0f83126739d>
- Noir HONK lane (`noir_honk`, `verified_on_chain=true`):
  - `0x55f1d6cf06ed5e2deaf90c86479c2f03b27ed631478447d14af808f33963475`
  - <https://sepolia.voyager.online/tx/0x55f1d6cf06ed5e2deaf90c86479c2f03b27ed631478447d14af808f33963475>
- Native KZG strict lane (`native_kzg`, `verified_on_chain=true`):
  - `0x5c9e21abd2119600421872f0baad9988ea7082eec54bacea8657649a8cf5f42`
  - <https://sepolia.voyager.online/tx/0x5c9e21abd2119600421872f0baad9988ea7082eec54bacea8657649a8cf5f42>

### L1 Sepolia bridge evidence

- EZKL verifier (Ethereum Sepolia):
  - `0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9`
  - <https://sepolia.etherscan.io/address/0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9>
- L1 bridge sender deploy tx:
  - `0x7da0788d72a7801db854ec8ad8400bef0b4f86a7ec032118c59f4c3b98e76aa5`
  - <https://sepolia.etherscan.io/tx/0x7da0788d72a7801db854ec8ad8400bef0b4f86a7ec032118c59f4c3b98e76aa5>
- Starknet L1 bridge receiver deploy tx:
  - `0x07025809c24146895a085e0acf89ccc5e731a80114c5f7e70271dbffd8eeef0a`
  - <https://sepolia.voyager.online/tx/0x07025809c24146895a085e0acf89ccc5e731a80114c5f7e70271dbffd8eeef0a>

## 6) What This Unlocks for the Product

- **Private execution, public assurance:** users keep strategy/privacy context off-chain while proving gating constraints before execution.
- **AI recommendations with cryptographic accountability:** advisory output can be promoted to executable only after circuit/verifier checks pass.
- **Multichain portability:** same intent can route through L3 proof lanes today, with L1 bridge and native KZG paths for stronger trust envelopes.
- **Composable trust tiers:** one stack can serve low-friction UX and high-assurance flows by selecting stronger proof/lane combinations.

## 7) Remaining Work for Full Recursive Coverage

1. **Path B completion:** universal extraction/build of `kzg_mpcheck_v1` witness bundle in all live EZKL model flows and end-to-end strict-mode coverage benchmarks.
2. **Path A hardening:** collect recurring HONK receipt cadence + gas/latency benchmarks and lock into runbook automation.
3. **Path 2/3 progression:** run SNOS proving pipeline and move aggregation-critical logic into L3 contracts for full recursive closure.

## 8) Related Docs

- [L3 proving paths integration](L3_PROVING_PATHS_INTEGRATION.md)
- [Madara L3 architecture](MADARA_L3_APPCHAIN_ARCHITECTURE.md)
- [Advanced L3 + EZKL implementation plan](plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md)
- [Recursive EZKL roadmap](../archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md)
- [Cairo KZG verifier spec](plans/CAIRO_KZG_VERIFIER_SPEC.md)
- [Public live readout (`/test`)](https://zkde.fi/test)
