# Docs

Documentation index for zkde.fi — recursive multi-chain proving fabric on Starknet.

---

## Start Here

| Document | What it covers |
|---|---|
| [ZK OS Reframe](ZK_OS_REFrame.md) | Product vision — zkRAG, zkGraph, zkSyslog, model registry + L3 |
| [Receipts as Primitive](RECEIPTS_AS_PRIMITIVE_STRATEGY.md) | Core thesis — provable receipt layer, record/verify/reputation |
| [Hackathon Build Narrative](HACKATHON_BUILD_NARRATIVE.md) | Build story and milestone timeline |
| [Recursive Multichain Proving](RECURSIVE_MULTICHAIN_PROVING_CORE.md) | How proof lanes compose across L1 ↔ L2 ↔ L3 |

---

## Architecture

| Document | What it covers |
|---|---|
| [Architecture](ARCHITECTURE.md) | High-level system architecture |
| [Architecture — Strategies, Proofs, Data Flow](ARCHITECTURE_STRATEGIES_PROOFS_DATA_FLOW.md) | Detailed proof strategies and data flow |
| [Madara L3 Appchain](MADARA_L3_APPCHAIN_ARCHITECTURE.md) | L3 appchain design and settlement |
| [L3 Proving Paths Integration](L3_PROVING_PATHS_INTEGRATION.md) | EZKL → L3 → L2 pipeline |
| [Circuit Strategies Reference](CIRCUIT_STRATEGIES_REFERENCE.md) | Circuit selection guide |

---

## Reputation & Identity

| Document | What it covers |
|---|---|
| [Reputation v3 Spec](CAPITAL_OS_PORTABLE_REPUTATION_V3_SPEC.md) | Portable reputation from receipt composition |
| [Reputation-Gated Lending + DAO Voting](REPUTATION_GATED_LENDING_DAO_VOTING.md) | Badge-gated DeFi access |
| [Reputation Proof API](REPUTATION_PROOF_API.md) | Backend API for reputation proofs |
| [Trust Onboarding](TRUST_ONBOARDING_SYSTEM_EXTERNAL.md) | External trust model onboarding |

---

## Product & DeFi

| Document | What it covers |
|---|---|
| [Product & MVP](PRODUCT_AND_MVP.md) | Product scope and MVP definition |
| [Concepts](CONCEPTS.md) | Core concepts glossary |
| [Trade Desk Architecture](TRADE_DESK_ARCHITECTURE.md) | Trade execution design |
| [API Overview](API_OVERVIEW.md) | Backend API surface |
| [Deployment](DEPLOYMENT.md) | Deployment guide |
| [Roadmap](ROADMAP.md) | Feature roadmap |

---

## Specs (plans/)

| Spec | What it covers |
|---|---|
| [Cairo KZG Verifier](plans/CAIRO_KZG_VERIFIER_SPEC.md) | Path B — native KZG verification in Cairo |
| [EZKL Proof Bridge](plans/EZKL_TO_PROOF_BRIDGE_SPEC.md) | Path C — EZKL → Groth16 → Garaga |
| [L1 EZKL Bridge](plans/L1_EZKL_BRIDGE_SPEC.md) | L1 Sepolia bridge spec |
| [L1 Sepolia Verifier](plans/L1_SEPOLIA_EZKL_VERIFIER.md) | L1 verifier deployment |
| [ModelBridge Deploy](plans/MODELBRIDGE_VERIFIER_DEPLOY.md) | ModelBridge verifier deployment guide |
| [Unified Privacy Pool](plans/UNIFIED_PRIVACY_POOL_SPEC.md) | Privacy pool specification |

---

## Live Proof Readout

Public report: [zkde.fi/test](https://zkde.fi/test)

Backend bridge lane metadata: `GET /api/v1/zkdefi/proofs/bridge-lanes`
Public proof dashboard API: `GET /api/v1/zkdefi/public-proof-dashboard`
Public proof dashboard markdown: `GET /api/v1/zkdefi/public-proof-dashboard/markdown`
Proof lookup with public settlement provenance: `GET /api/v1/zkdefi/proofs/{proof_hash}` (accepts full digest or felt-safe on-chain alias)
Indexed public proof feed: `GET /api/v1/zkdefi/proofs/?source=indexed&public_only=true&user_address=...`
Indexed public proof feed cursor mode: `GET /api/v1/zkdefi/proofs/?source=indexed&sort_by=latest_public_settlement&limit=...&cursor_timestamp=...&cursor_proof_hash=...` (returns `next_cursor`)
Forge proof views now consume that indexed proof path for public-settled proof jobs.
Forge `receipt`, `fact`, and `proof_job` detail views now resolve through the same indexed proof/public-settlement provenance path when a linked proof exists.
Forge proof-scope search now passes through the same settlement cursor contract, so paging no longer depends on proof-feed offsets.
Forge `transaction` detail now resolves linked proof/fact/model provenance when the tx is a public settlement, instead of showing only raw RPC receipt data.
Dedicated Forge proof feed: `GET /api/v1/zkdefi/forge/proofs`
Dedicated Forge proof page: `GET /api/v1/zkdefi/forge/proofs/page`
Public-only receipt feeds:
- `GET /api/v1/zkdefi/receipts?address=...&public_only=true`
- `GET /api/v1/zkdefi/receipts/on-chain/{address}?public_only=true`

Daily `/test` builds now target the full showcase by default, not bridge-only mode. The bridge lanes still remain part of the strict gate, but the scheduled report is expected to render the broader readout unless you explicitly override it back down to bridge-only.

Bridge artifacts tracked by the readout:
- `artifacts/hackathon_showcase/patha_latest.json` for Path A (`noir_honk`)
- `artifacts/hackathon_showcase/patha_v2_latest.json` for Path A V2 (`NoirEzklBridgeV2` / `noir_honk_v2`)
- `artifacts/hackathon_showcase/pathb_latest.json` for Path B (native KZG)
- `artifacts/hackathon_showcase/pathc_latest.json` for Path C (`verifyAndBridge` + recurring monitor freshness)
- `artifacts/hackathon_showcase/pathc_pending_latest.json` for the newest pending Path C capture that has not reached L2 confirmation yet
- `artifacts/hackathon_showcase/pathc_history.jsonl` for Path C receipt history across captured first-party models
- `artifacts/hackathon_showcase/pathc_payload_latest.json` for the fresh first-party EZKL payload used to mint the latest Path C receipt
- `circuits/noir_ezkl_bridge_v2/` for the versioned Path A hardening package (adds proof-hash + timestamp binding without replacing the live Noir verifier lane)
- `circuits/contracts/src/garaga_verifier_noir_ezkl_bridge_v2/` for the generated Cairo verifier project corresponding to that versioned Path A lane
- `.noir_ezkl_bridge_v2_honk.deployed` for the deployed Madara L3 V2 verifier address/class hash and the first live V2 receipt reference

Current Path A V2 live state:
- verifier class hash: `0x161e48066a133fb8daf704c70d33abf8da10074cf97e498a4237444d14122fd`
- verifier address: `0x48d7af1f9de06b4888e2f451e197c85eb048ab75c40e358803d67225c3e97cf`
- current promotion policy: `SHOWCASE_PREFER_NOIR_V2=true` in the daily build, so the strict readout treats V2 as the primary Path A lane while legacy Noir remains visible as fallback evidence
- current report-backed V2 lane mode: `dual`
- current report-backed V2 L3 tx: `0x283371249484dbf90afd188224fa1d7ec1a4b169d2d74d5e9769bfedd583f0c`
- current report-backed V2 L2 tx: `0x5581017e0678281da2cbeb9251caf359fce3ceb1b9bfdbb19dc3d11f2942163`
- current report-backed V2 mirror status: `mirrored`
- reproducible one-off deploy helper: `python3 scripts/deploy_noir_ezkl_bridge_v2_honk_verifier_l3.py`

Operational note:
- The daily build now refreshes `pathc_pending_latest.json` before it attempts a new Path C capture, so an already-mined L1 receipt can promote itself into `pathc_latest.json` as soon as Starknet confirms it.
- The parent backend can optionally select the L1 verifier / bridge sender / receiver by model via `L1_EZKL_ROUTE_MAP`, which is useful once Path C spans more than one verifier-compatible EZKL model.
- When Path C rotation is enabled, the daily build prefers models explicitly named in `L1_EZKL_ROUTE_MAP` before it falls back to compatibility discovery by preflight.
- The `/test` Path C live receipt section now shows the chosen route source/key alongside the active L1 sender/verifier/receiver so the verifier path is explainable in the report itself.
- The bridge readout now probes the baseline `ModelBridge` lane with model-local calibration input when available instead of a generic seeded matrix. That change matters because the strict report is supposed to validate the live bridge stack, not fail due to a synthetic input shape that the selected model would never see in production.
- `SHOWCASE_REQUIRE_NOIR_V2_LANE=true` is supported in the local gate/daily scripts if you want to enforce V2 explicitly in addition to the primary Path A check.
- `SHOWCASE_PREFER_NOIR_V2=true` is the cleaner promotion switch: it moves the primary Path A claim/gate/report semantics to V2 without removing the legacy Noir lane from the readout.

The top summary in `/test` now treats Path C as a benchmarked bridge lane, not just a status badge:
- `PathCBridge` appears in the operational benchmark snapshot
- latency is reported from initial Path C generation to L2 confirmation
- cost is reported as L1 gas used (`gas`), while L3 bridge lanes remain in `FRI`
- recent verifier-compatible Path C model coverage is shown separately from the strict gate’s pinned latest receipt
