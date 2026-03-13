# Docs

Focused documentation index for zkde.fi.

---

## Start here

- **zk OS reframe (product):** [ZK_OS_REFrame.md](ZK_OS_REFrame.md) — zkRAG, zkGraph, zkSyslog; capital as one flavor; model registry + L3.
- **Receipts as primitive:** [RECEIPTS_AS_PRIMITIVE_STRATEGY.md](RECEIPTS_AS_PRIMITIVE_STRATEGY.md) — zkSyslog = provable receipt layer; record/verify/reputation wedge.
- Build narrative (hackathon): [HACKATHON_BUILD_NARRATIVE.md](HACKATHON_BUILD_NARRATIVE.md)
- Recursive multichain proving core: [RECURSIVE_MULTICHAIN_PROVING_CORE.md](RECURSIVE_MULTICHAIN_PROVING_CORE.md)
- Proof API (reputation + receipts): [REPUTATION_PROOF_API.md](REPUTATION_PROOF_API.md)
- L3 architecture (Madara): [MADARA_L3_APPCHAIN_ARCHITECTURE.md](MADARA_L3_APPCHAIN_ARCHITECTURE.md)
- L3 proving integration: [L3_PROVING_PATHS_INTEGRATION.md](L3_PROVING_PATHS_INTEGRATION.md)
- Trust onboarding/external model: [TRUST_ONBOARDING_SYSTEM_EXTERNAL.md](TRUST_ONBOARDING_SYSTEM_EXTERNAL.md)

---

## Obsqra Labs Live research readout

- Public report (`/test`): [https://zkde.fi/test](https://zkde.fi/test)
- Local latest HTML: `artifacts/hackathon_showcase/latest.html`
- Local latest JSON: `artifacts/hackathon_showcase/latest.json`
- Path A latest receipt: `artifacts/hackathon_showcase/patha_latest.json`
- Path B latest receipt: `artifacts/hackathon_showcase/pathb_latest.json`

Use `/test` for the current Obsqra Labs research evidence: ModelBridge lanes, AI advisory + badge screening, privacy tier probes, and explorer-linked receipts.
The report now also includes rolling stability/gas benchmarks by lane (verified-rate + p50/p95) from `artifacts/hackathon_showcase/history.jsonl`.
Path A now persists its latest Noir HONK receipt to `artifacts/hackathon_showcase/patha_latest.json`, and the recursive stage check-ins treat Path A as `implemented_live` only when that receipt is present and verified.
Path B now persists its latest native-KZG coverage/runtime snapshot to `artifacts/hackathon_showcase/pathb_latest.json`, and the recursive stage check-ins treat Path B as `implemented_live` only when the proving-ready catalog is receipt-backed and the live verifier ABI is confirmed.
Path B extraction cadence is tracked in `artifacts/hackathon_showcase/pathb_bundle_history.jsonl` with daily coverage deltas and exact per-model bundle regressions/additions.
The Path B warm report can now optionally probe real `EzklNativeKzg` receipts per model, so the catalog tracks not only bundle presence but actual backend-native-KZG execution evidence.
The Path B warm flow can also bootstrap supported first-party models (`llm_fallback`, `timing_predictor`) when their EZKL artifacts are missing, and the report now surfaces that provenance separately from the live native-KZG receipt counts.
The daily `/test` build now precomputes native-KZG sidecars before the strict gate, which keeps the serializer on `kzg_mpcheck_v3` and avoids silently drifting back to weaker payload shapes.
The daily `/test` build now also passes `SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS=true` by default, so supported first-party Path B models can be provisioned on-demand instead of failing the catalog purely because their local EZKL artifacts were never generated on that machine.
For faster `/test` health checks, `python3 scripts/hackathon_backend_showcase.py --strict-bridge --bridge-only --emit-report` runs only the bridge-critical matrix instead of the full privacy/agent demo suite.
Dual mirror status now reports `mirror_underfunded` when the parent Sepolia wallet cannot afford the L3->L2 registry write, which keeps the failure mode honest.

Daily refresh on the same server (recommended for `/test`):

- `scripts/daily_live_research_build.sh`
- Example cron (UTC 06:15):
  - `15 6 * * * cd /opt/obsqra.starknet/zkdefi && /opt/obsqra.starknet/zkdefi/scripts/daily_live_research_build.sh`
- Default behavior: `/test` is refreshed even if one strict lane is flaky (`daily_build_status=WARN` in log); set `DAILY_BUILD_STRICT_EXIT=true` for hard-fail cron behavior.
- Default bridge posture in the daily build:
  - precompute Path B sidecars for local EZKL models
  - run Path B warm-up with live native-KZG verification
  - bootstrap supported first-party Path B models on-demand if their local EZKL artifacts are missing
  - use `execution_chain=dual` so `/test` reflects both L3 receipt evidence and mirror health
  - require the Noir HONK lane as part of the strict bridge gate
  - render bridge-only showcase by default; run the full privacy/agent suite manually when you need the broader readout

ModelBridge runtime defaults now attempt real local EZKL for `ModelBridge` / `ModelBridgeHeavy` before synthetic fallback:

- `MODELBRIDGE_TRY_REAL_EZKL=true`
- `MODELBRIDGE_REQUIRE_REAL_EZKL=false` (set `true` to enforce real-EZKL-only bridge runs)
- `MODELBRIDGE_REQUIRE_REAL_GROTH16=true` (block execution when Groth16 bridge proof generation fails; set `false` only for local placeholder demos)

Path B native KZG defaults now auto-attempt KZG MPCheck bundle extraction when artifacts are present:

- `EZKL_KZG_BUNDLE_AUTO_EXTRACT=true`
- Uses `scripts/extract_ezkl_kzg_mpcheck_bundle.py` automatically if no custom extractor command is set.
- `EZKL_PROVER_WARM_KZG_ON_PROVE=true` (default) warms/caches `kzg_mpcheck_bundle` metadata after each successful real EZKL proof generation.

### Recursive stage check-ins + versioning

When a recursive proving stage reaches E2E, log it in the showcase first, then tag it.

1. Regenerate readout:
   - `python3 scripts/hackathon_backend_showcase.py --strict-bridge --emit-report`
   - Report artifacts are gated to final-stage readiness; use `--emit-report-force` only for debug snapshots.
2. Review `/test`:
   - `Overview -> Snapshot -> Recursive Stage Check-ins`
   - `Bridge -> Phase 2-4 Status -> Stage Completion Check-ins`
   - `Bridge -> Phase 2-4 Status -> Path A Live Receipt (Noir HONK)`
3. If a stage is `complete` with explorer TX evidence, do a short doc check-in in the relevant plan file and create a GitHub tag/release note.
4. CI gate (Path B + strict showcase):
   - `python3 scripts/ci_showcase_gate.py`
   - Fails on Path B coverage regression (`PATHB_WARM_MIN_COVERAGE`) or strict bridge lane regressions.
   - Noir lane enforcement is configurable: set `SHOWCASE_REQUIRE_NOIR_LANE=true` to hard-require Noir in gate.

Suggested tag cadence from the report:
- `vYYYY.MM.DD-stage0-backbone`
- `vYYYY.MM.DD-stage1-path-a-noir`
- `vYYYY.MM.DD-stage2-path-c-l1`
- `vYYYY.MM.DD-stage3-path-b-native-kzg`

---

## Core technical docs

- Architecture and data flow: [ARCHITECTURE_STRATEGIES_PROOFS_DATA_FLOW.md](ARCHITECTURE_STRATEGIES_PROOFS_DATA_FLOW.md)
- Capital OS reputation v2 upgrade: [CAPITAL_OS_REPUTATION_IDENTITY_V2_UPGRADE.md](CAPITAL_OS_REPUTATION_IDENTITY_V2_UPGRADE.md)
- Capital OS portable reputation v3: [CAPITAL_OS_PORTABLE_REPUTATION_V3_SPEC.md](CAPITAL_OS_PORTABLE_REPUTATION_V3_SPEC.md)
- Capital OS builder v2: [CAPITAL_OS_BUILDER_V2_UPGRADE.md](CAPITAL_OS_BUILDER_V2_UPGRADE.md)
- Unified upgrade implementation: [CAPITAL_OS_UNIFIED_UPGRADE_IMPLEMENTATION.md](CAPITAL_OS_UNIFIED_UPGRADE_IMPLEMENTATION.md)
- Market data design: [CAPITAL_OS_MARKET_DATA_INTEGRATION_DESIGN.md](CAPITAL_OS_MARKET_DATA_INTEGRATION_DESIGN.md)
- Trade desk architecture: [TRADE_DESK_ARCHITECTURE.md](TRADE_DESK_ARCHITECTURE.md)
- Circuit strategy reference: [CIRCUIT_STRATEGIES_REFERENCE.md](CIRCUIT_STRATEGIES_REFERENCE.md)
- Reputation-gated lending + DAO voting: [REPUTATION_GATED_LENDING_DAO_VOTING.md](REPUTATION_GATED_LENDING_DAO_VOTING.md)
- Agent brief for Madara settlement: [AGENT_BRIEF_MADARA_SETTLEMENT.md](AGENT_BRIEF_MADARA_SETTLEMENT.md)

---

## Specs and plans

- Plans index: [`docs/plans/`](plans/)
- L1 EZKL bridge spec: [plans/L1_EZKL_BRIDGE_SPEC.md](plans/L1_EZKL_BRIDGE_SPEC.md)
- EZKL proof bridge spec: [plans/EZKL_TO_PROOF_BRIDGE_SPEC.md](plans/EZKL_TO_PROOF_BRIDGE_SPEC.md)
- Cairo native KZG verifier + Path B notes: [plans/CAIRO_KZG_VERIFIER_SPEC.md](plans/CAIRO_KZG_VERIFIER_SPEC.md)
- L1 Sepolia EZKL verifier: [plans/L1_SEPOLIA_EZKL_VERIFIER.md](plans/L1_SEPOLIA_EZKL_VERIFIER.md)
- ModelBridge verifier deploy: [plans/MODELBRIDGE_VERIFIER_DEPLOY.md](plans/MODELBRIDGE_VERIFIER_DEPLOY.md)
- Unified privacy pool spec: [plans/UNIFIED_PRIVACY_POOL_SPEC.md](plans/UNIFIED_PRIVACY_POOL_SPEC.md)

---

## Archived material

Older notes and superseded writeups live under [archive/](../archive/) and [archive/ideas/](../archive/ideas/).
