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

Daily `/test` builds now target the full showcase by default, not bridge-only mode. The bridge lanes still remain part of the strict gate, but the scheduled report is expected to render the broader readout unless you explicitly override it back down to bridge-only.

Bridge artifacts tracked by the readout:
- `artifacts/hackathon_showcase/patha_latest.json` for Path A (`noir_honk`)
- `artifacts/hackathon_showcase/pathb_latest.json` for Path B (native KZG)
- `artifacts/hackathon_showcase/pathc_latest.json` for Path C (`verifyAndBridge` + recurring monitor freshness)
- `artifacts/hackathon_showcase/pathc_pending_latest.json` for the newest pending Path C capture that has not reached L2 confirmation yet
- `artifacts/hackathon_showcase/pathc_history.jsonl` for Path C receipt history across captured first-party models
- `artifacts/hackathon_showcase/pathc_payload_latest.json` for the fresh first-party EZKL payload used to mint the latest Path C receipt

Operational note:
- The daily build now refreshes `pathc_pending_latest.json` before it attempts a new Path C capture, so an already-mined L1 receipt can promote itself into `pathc_latest.json` as soon as Starknet confirms it.
- The parent backend can optionally select the L1 verifier / bridge sender by model via `L1_EZKL_ROUTE_MAP`, which is useful once Path C spans more than one verifier-compatible EZKL model.
- When Path C rotation is enabled, the daily build prefers models explicitly named in `L1_EZKL_ROUTE_MAP` before it falls back to compatibility discovery by preflight.
- The `/test` Path C live receipt section now shows the chosen route source/key alongside the active L1 sender/verifier so the verifier path is explainable in the report itself.

The top summary in `/test` now treats Path C as a benchmarked bridge lane, not just a status badge:
- `PathCBridge` appears in the operational benchmark snapshot
- latency is reported from initial Path C generation to L2 confirmation
- cost is reported as L1 gas used (`gas`), while L3 bridge lanes remain in `FRI`
- recent verifier-compatible Path C model coverage is shown separately from the strict gate’s pinned latest receipt
