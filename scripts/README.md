# Scripts

Operational and deployment scripts for zkde.fi.

---

## Live research report

- Public readout: [https://zkde.fi/test](https://zkde.fi/test)
- Local latest HTML: `artifacts/hackathon_showcase/latest.html`
- Local latest JSON: `artifacts/hackathon_showcase/latest.json`
- Path A latest receipt: `artifacts/hackathon_showcase/patha_latest.json`
- Path A V2 latest receipt: `artifacts/hackathon_showcase/patha_v2_latest.json`
- Path B latest receipt: `artifacts/hackathon_showcase/pathb_latest.json`
- Path A V2 deploy record: `.noir_ezkl_bridge_v2_honk.deployed`

The `/test` page mirrors what `hackathon_backend_showcase.py` generates and is the fastest way to validate Obsqra Labs research claims with backend + on-chain receipts.

---

## Index

| Script | Purpose |
|--------|---------|
| **hackathon_backend_showcase.py** | Terminal-first demo runner for hackathon judging: validates proofs, agent execution, privacy commitment flow, policy controls, receipts, on-chain/RPC checks, AI advisory + badge screening flow, and can emit a local HTML/JSON report with Voyager links when requested. |
| **warm_kzg_bundle_catalog.py** | Path B utility: runs real EZKL proof + local verify per model and warms/caches `kzg_mpcheck_bundle` coverage across the local model catalog, writing a JSON coverage report. |
| **ci_showcase_gate.py** | CI gate: runs Path B warm-up with minimum coverage, then strict showcase; fails if coverage or bridge lane checks regress. |
| **daily_live_research_build.sh** | Server-side daily runner for `/test`: executes `ci_showcase_gate.py`, refreshes `latest.html/json`, and writes timestamped logs under `artifacts/hackathon_showcase/daily_logs/`. |
| **precompute_kzg_mpcheck_sidecars.py** | Refreshes `mpcheck_hint_felts` + `precomputed_line_felts` sidecars for local EZKL models so native KZG can stay on `kzg_mpcheck_v3` without re-deriving lines on every request. |
| **capture_pathc_live_receipt.py** | Operational Path C helper: submit a real `verifyAndBridge` call to the parent backend, optionally wait for L2 confirmation, and write `artifacts/hackathon_showcase/pathc_latest.json` for the report. |
| **deploy_noir_ezkl_bridge_v2_honk_verifier_l3.py** | Declare + deploy only the versioned `NoirEzklBridgeV2` HONK verifier to Madara L3 and print `L3_NOIR_EZKL_BRIDGE_V2_HONK_VERIFIER_ADDRESS=...`. |
| **register_verifiers.sh** | Register reputation verifiers (Solvency, RiskPassport, TraderPerformance, StrategyIntegrity, ExecutionIntegrity) with ObsqraFactRegistry. Uses `.env.verifiers`. |
| **deploy_reputation_verifiers.sh** | Deploy Garaga verifiers to Starknet (if present). |
| **test_dao_proposal.sh** | End-to-end test: create DAO proposal, cast vote (`POST /api/v1/dao/vote/cast`). |
| **test_emergency_controls.sh** | Test emergency pause/unpause DAO; requires RPC and keystore. |
| **smoke_test_reputation_proofs.sh** | Smoke test all 5 reputation proof endpoints. Usage: `./scripts/smoke_test_reputation_proofs.sh [BASE_URL]` (default `http://127.0.0.1:8003`). Uses `test_data/*_test.json`. |
| **import_grafana_dashboard.sh** | Import the reputation Grafana dashboard via API. Set `GRAFANA_URL` and `GRAFANA_API_KEY` (or `GRAFANA_USER`/`GRAFANA_PASSWORD`). |
| **rewrite_history_single_commit.sh** | (Maintainer) Rewrite repo to a single commit; used for history squash. |

Run from repo root. Ensure backend is up for smoke tests; for deploy/register scripts, Starknet RPC and keystore must be configured.

### Hackathon showcase quick start

```bash
python3 scripts/hackathon_backend_showcase.py
```

Optional flags:

- `--base-url http://127.0.0.1:8003`
- `--wallet 0x...`
- `--skip-onchain` (useful if RPC is flaky/offline)
- `--judge-mode` (compact terminal output for live judging)
- `--fast` (skip heaviest proof/advisory checks for quicker routine validation)
- `--strict-bridge` (requires strict `200` ModelBridge + dual-lane evidence; no transient pass)
- `--bridge-only` (runs only bridge-critical checks: health, manifest, RPC presence, receipt visibility, ModelBridge lanes, recursive path status)
- `--skip-heavy-stark` (skip heavy STARK reputation call while keeping strict bridge checks)
- `--skip-ai-marketplace` (skip advisory + badge proof section)
- `--emit-report` (opt-in HTML/JSON artifacts; default is skip for faster runs)
- `--emit-report-force` (override final-stage gate and write report even if required proof lanes are not all green)
- `--skip-report` (explicitly skip HTML/JSON artifact generation)
- `--artifact-dir artifacts/hackathon_showcase`

`--emit-report` now writes artifacts only when final-stage readiness is met (`--strict-bridge`, full claim pass, and key bridge/recursive/heavy-STARK steps green). Use `--emit-report-force` only for debugging.

`--fast` also marks the two bridge-heavy core claims as `SKIP` in the claim matrix instead of failing the run score.

Path B reproducibility:

- `python3 scripts/warm_kzg_bundle_catalog.py --bootstrap-known-models --verify-onchain-native-kzg --native-kzg-execution-chain dual`
- The warm flow can now train + EZKL-setup supported first-party models (`llm_fallback`, `timing_predictor`) when their `vk.key` / `settings.json` / `kzg.srs` artifacts are missing.
- Use `--bootstrap-force` only when you want to retrain those models instead of reusing existing ONNX/training metadata.

Bridge execution is prioritized before optional proof checks so ModelBridge receipt attempts do not lose budget to other endpoints under load.
Dual bridge validation uses `proof_mode=1` (EZKL_BRIDGE) to test chain mirroring reliability without adding execution-proof latency from `FULL_DUAL_PROVER`.
Mirror semantics: `mirrored` = L2 mirror verified, `mirror_unavailable` = parent L2 registry endpoint unavailable, `mirror_failed` = mirror attempted but failed.

Versioned Path A lane:

- `GET /api/v1/zkdefi/proofs/bridge-lanes` now exposes `NoirEzklBridgeV2` alongside the legacy `NoirEzklBridge`.
- The parent L3 verifier route now supports `L3_NOIR_EZKL_BRIDGE_V2_HONK_VERIFIER_ADDRESS`.
- Current live V2 deploy:
  - class hash `0x161e48066a133fb8daf704c70d33abf8da10074cf97e498a4237444d14122fd`
  - contract `0x48d7af1f9de06b4888e2f451e197c85eb048ab75c40e358803d67225c3e97cf`
  - first live L3 receipt `0x2aadcebbd5af9942a71514bb46f1571988fcbdc0088f88a32afa902d15d9fe8`

Native KZG strictness defaults (backend):

- `NATIVE_KZG_REQUIRE_REAL_EZKL=true` (block `EzklNativeKzg` execution if only synthetic/placeholder proof is available)
- `NATIVE_KZG_REQUIRE_MPCHECK=true` (block `EzklNativeKzg` execution if `ezkl_kzg_v1` payload has no `kzg_mpcheck_v1` trailer)
- `NATIVE_KZG_WARM_ON_REAL_PROVE=true` (after each real EZKL proof verify, warm/cache `kzg_mpcheck_bundle` metadata for future native-kzg runs)
- `EZKL_PROVER_WARM_KZG_ON_PROVE=true` (service-level default; warm/cache `kzg_mpcheck_bundle` metadata as soon as a real EZKL proof is generated)
- `EZKL_AUTO_SETUP_ON_DEMAND=true` (auto-discover local ONNX artifacts and attempt `setup_model(..., force=False)` before fallback)

ModelBridge real-EZKL bridge toggles (backend):

- `MODELBRIDGE_TRY_REAL_EZKL=true` (attempt real local EZKL proof generation for `ModelBridge`, `ModelBridgeHeavy`, and `NoirEzklBridge` before synthetic fallback)
- `MODELBRIDGE_REQUIRE_REAL_EZKL=false` (when `true`, block those bridge lanes if no locally verified EZKL proof is available)
- `MODELBRIDGE_REQUIRE_REAL_GROTH16=true` (default strict mode; when Groth16 bridge proof generation fails, block execution instead of sending placeholder calldata)

Native KZG bundle injection hooks (Path B progression):

- `EZKL_KZG_BUNDLE_FILE=/abs/path/kzg_mpcheck_bundle.json` (or multiple files split by `:`) — sidecar bundle source.
- `EZKL_KZG_BUNDLE_DIR=/abs/path/to/model_bundle_dir` — auto-reads `kzg_mpcheck_bundle.json`, `kzg_pairing_bundle.json`, or `kzg_bundle.json`.
- `EZKL_KZG_BUNDLE_EXTRACTOR_CMD=\"/abs/path/extractor\"` — optional command that receives env (`EZKL_RAW_PROOF_JSON_PATH`, `EZKL_PROOF_HASH`, `EZKL_MODEL_NAME`, `EZKL_MODEL_DIR`) and prints JSON bundle to stdout.
- `EZKL_KZG_BUNDLE_AUTO_EXTRACT=true` — when no extractor command is set, auto-use `scripts/extract_ezkl_kzg_mpcheck_bundle.py` if model artifacts (`vk.key`, `settings.json`, `kzg.srs`) exist.
- `EZKL_KZG_BUNDLE_EXTRACTOR_TIMEOUT=180` — extractor timeout seconds.

When extractor injection succeeds, serializer writes/updates `<model_dir>/kzg_mpcheck_bundle.json` keyed by proof hash for faster reuse.

Real extractor command (Path B, non-placeholder):

- `EZKL_KZG_BUNDLE_EXTRACTOR_CMD=\"python3 /opt/obsqra.starknet/zkdefi/scripts/extract_ezkl_kzg_mpcheck_bundle.py\"`

What this extractor does:

- Generates an EZKL model-matched Solidity verifier from local `vk/settings/srs`
- Compiles verifier with Foundry (stack-safe fallback)
- Encodes EVM calldata from the real proof JSON
- Traces `bn256Pairing` precompile input from local Anvil execution
- Emits `kzg_mpcheck_bundle` JSON for serializer injection

Path B catalog warm-up:

```bash
python3 scripts/warm_kzg_bundle_catalog.py
```

Optional:

- `--model yield` (filter by model name substring; repeatable)
- `--limit 2`
- `--output artifacts/hackathon_showcase/pathb_bundle_warm.json`
- `--history-file artifacts/hackathon_showcase/pathb_bundle_history.jsonl`
- `--daily-delta-hours 24` (window used for day-over-day coverage deltas)
- `--verify-onchain-native-kzg` (after warming each model, call backend `proofs/ml-bridge` with `bridge_circuit=EzklNativeKzg` and record live receipt status)
- `--base-url http://127.0.0.1:8003` (backend base URL for `--verify-onchain-native-kzg`)
- `--wallet 0x...` (wallet used for `--verify-onchain-native-kzg`)
- `--request-timeout 120`
- `--include-non-ezkl` (also include model folders without `vk.key/settings.json/kzg.srs`; default is proving-capable EZKL models only)
- `--min-coverage 1.0` (optional hard gate; exits non-zero if `models_with_bundle/models_total` is below threshold)

Warm report now includes triage helpers:

- `models_failed`
- `failed_models[]` (model + error + attempted widths + `recommended_action`)
- `error_buckets` (grouped failure reasons)
- `action_buckets` (grouped remediation hints)
- `cadence` (previous-run and daily delta percentage points, plus exact new/regressed bundle model lists)
- `native_kzg_onchain` (optional per-model native-KZG receipt matrix: attempted / verified / tx-backed)

Path B cadence history file:

- `artifacts/hackathon_showcase/pathb_bundle_history.jsonl` (one snapshot per warm run)

Strict gate:

- `PATHB_WARM_MIN_COVERAGE=1.0` (default) enforces minimum `models_with_bundle/models_total` for strict showcase pass on Native KZG + Recursive Path B status.

CI gate (local or GitHub Actions):

```bash
python3 scripts/ci_showcase_gate.py
```

Env knobs:

- `SHOWCASE_BASE_URL` (default `http://127.0.0.1:8003`)
- `SHOWCASE_TIMEOUT_SECONDS` (default `50`)
- `SHOWCASE_BRIDGE_TIMEOUT_SECONDS` (optional; override timeout for the baseline `ModelBridge` L3 lane in bridge-only strict runs; useful when the report would otherwise probe with synthetic timing assumptions that are tighter than the live prover path)
- `SHOWCASE_DUAL_BRIDGE_TIMEOUT_SECONDS` (optional; override timeout for `execution_chain=dual`, useful when strict mode times out under load)
- `SHOWCASE_NOIR_BRIDGE_TIMEOUT_SECONDS` (optional; override timeout for Noir HONK lanes; default strict budget is `75s` in bridge-only mode and `max(timeout, 75s)` otherwise)
- `SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS` (default `2` in CI gate; limits strict bridge retry loops)
- `SHOWCASE_REQUIRE_NOIR_LANE` (default `false`; when `true`, CI gate hard-requires Noir lane `noir_honk` + on-chain verify)
- `SHOWCASE_REQUIRE_NOIR_V2_LANE` (default `false`; when `true`, CI gate hard-requires `NoirEzklBridgeV2` to verify on L3 and mirror onto public Starknet L2)
- `SHOWCASE_BENCHMARK_WINDOW_RUNS` (default `40`; rolling history window used for stability/gas trend table)
- `PATHB_WARM_MIN_COVERAGE` (default `1.0`)
- `SHOWCASE_WARM_OUTPUT` (default `artifacts/hackathon_showcase/pathb_bundle_warm.json`)
- `SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG` (default `true`; require live Path B native-KZG receipts during gate)
- `SHOWCASE_WARM_EXECUTION_CHAIN` (default `dual`; use `l3` only if mirror infrastructure is intentionally out of scope)
- `SHOWCASE_WARM_REQUEST_TIMEOUT_SECONDS` (default `180`)
- `SHOWCASE_GATE_BRIDGE_ONLY` (default `false` in raw gate; run only bridge-critical showcase sections)
- `SHOWCASE_REQUIRE_PATHC_LIVE` (default `false` in raw gate; require a fresh Path C receipt artifact)
- `SHOWCASE_PATHC_MAX_AGE_HOURS` (default `36`; freshness window for `pathc_latest.json`)

Daily build for `/test` (same-server cron):

```bash
scripts/daily_live_research_build.sh
```

Default daily build sequence:

1. precompute native-KZG sidecars for proving-capable local EZKL models
2. run `ci_showcase_gate.py`
3. refresh `/test` artifacts if the gate reaches final-stage readiness

Example crontab (UTC 06:15 daily):

```cron
15 6 * * * cd /opt/obsqra.starknet/zkdefi && /opt/obsqra.starknet/zkdefi/scripts/daily_live_research_build.sh
```

By default the daily script **always refreshes** `latest.html/json` even if strict lanes partially fail (`daily_build_status=WARN` in log).  
Set `DAILY_BUILD_STRICT_EXIT=true` to make cron fail on strict-lane regressions.

Daily build env knobs:

- `PATHB_PRECOMPUTE_SIDECARS=true` (default)
- `PATHB_PRECOMPUTE_MODELS="yield_forecast creditworthiness anomaly_detector llm_fallback timing_predictor"` (default)
- `SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG=true` (default in daily build)
- `SHOWCASE_WARM_EXECUTION_CHAIN=dual` (default in daily build)
- `SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS=true` (default in daily build; provision supported first-party models if their EZKL artifacts are missing)
- `SHOWCASE_WARM_BOOTSTRAP_FORCE=false` (default in daily build; set `true` only when you explicitly want retraining)
- `SHOWCASE_WARM_REQUEST_TIMEOUT_SECONDS=180`
- `SHOWCASE_GATE_BRIDGE_ONLY=false` (default in daily build; render the full report unless you intentionally want bridge-only gating)
- `SHOWCASE_GATE_SKIP_HEAVY_STARK=false` (default in daily build; set `true` only if you intentionally want to skip heavy STARK sections)
- `SHOWCASE_GATE_SKIP_AI_MARKETPLACE=false` (default in daily build; set `true` only if you intentionally want to skip AI marketplace sections)
- `SHOWCASE_REQUIRE_NOIR_LANE=true` (default in daily build; Path A is now part of the strict bridge bar)
- `SHOWCASE_REQUIRE_NOIR_V2_LANE=false` (default in daily build; set `true` when you want the strict gate to treat `NoirEzklBridgeV2` as part of the required mirrored bridge bar)
- `SHOWCASE_REQUIRE_PATHC_LIVE=true` (default in daily build; Path C artifact must remain live and fresh)
- `SHOWCASE_PATHC_MAX_AGE_HOURS=36` (default freshness window for `pathc_latest.json`)
- `PATHC_PAYLOAD_JSON=/abs/path/to/pathc_payload.json` (optional; capture a fresh Path C receipt before gating)
- `PATHC_REFRESH_EXISTING=true` (default; refresh the existing `pathc_latest.json` artifact in place when no payload is set)
- `PATHC_REFRESH_PENDING_EXISTING=true` (default; refresh `pathc_pending_latest.json` first so an already-enqueued L1 tx can auto-promote into `pathc_latest.json` once L2 confirmation lands)
- `PATHC_CAPTURE_ROTATING_MODEL=false` (set `true` to mint a fresh Path C receipt from a rotating verifier-compatible EZKL model instead of only refreshing the pinned artifact)
- `PATHC_ROTATE_MODELS="creditworthiness yield_forecast anomaly_detector llm_fallback timing_predictor"` (rotation order / least-recently-used pool for Path C capture; models explicitly present in `L1_EZKL_ROUTE_MAP` are tried first, then the script falls back to compatibility discovery by preflight)
- `PARENT_BASE_URL=http://127.0.0.1:8002` (parent backend base URL used for Path C capture/refresh)
- `L1_EZKL_ROUTE_MAP='{"creditworthiness":{"bridge_sender_address":"0x...","receiver_address":"0x...","verifier_address":"0x...","mode":"verify_and_bridge"}}'` (optional parent-backend env; lets Path C choose an L1 verifier/sender/receiver by model name, raw model hash, or bridged model hash instead of assuming a single global route)

Path A V2 / public mirror notes:

- `NoirEzklBridgeV2` now runs as a `dual` lane in the bridge readout, not L3-only.
- `patha_v2_latest.json` is expected to carry both `l3_tx_hash` and `l2_tx_hash` when the lane is healthy.
- The public proof dashboard will include V2 only when the mirrored Starknet receipt is real and explorer-safe.
- The strict showcase probe now prefers model-local `calibration.json` input for bridge lanes before it falls back to a generic seeded matrix. This avoids false negatives where a live lane was healthy but the generic probe payload did not match the model’s expected input shape.

Path C live receipt capture from an existing payload:

```bash
python3 scripts/capture_pathc_live_receipt.py \
  --payload-json /abs/path/to/pathc_payload.json
```

Path C live receipt capture from a local first-party EZKL model:

```bash
python3 scripts/capture_pathc_live_receipt.py \
  --model-name creditworthiness \
  --no-wait-for-l2
```

Notes:

- The currently deployed Sepolia Halo2 verifier was generated from the `creditworthiness` EZKL model, so that is the correct first-party model to use unless you redeploy the L1 verifier for a different VK.
- `--model-name` writes `artifacts/hackathon_showcase/pathc_payload_latest.json` before submission, so the exact `proof_hex` / `public_inputs` / `model_hash` / `output_commitment` bundle is pinned for reruns and receipts.
- Raw EZKL `instances` are normalized from little-endian limbs into canonical `uint256` hex before the proof is submitted to the L1 verifier.
- If the parent HTTP API on `8002` is blocked or times out, the helper can fall back to the local parent backend service on the same host. Use `--no-local-parent-fallback` to disable that.

Path C recurring monitor refresh:

```bash
python3 scripts/capture_pathc_live_receipt.py \
  --refresh-artifact artifacts/hackathon_showcase/pathc_latest.json
```

Expected payload JSON fields:

- `proof_hex`
- `public_inputs`
- `model_hash`
- `output_commitment`

The script calls the parent backend `POST /api/v1/aggregation/l1/verify`, uses the returned `used_nonce` / `verification_status_query`, optionally polls L2, and writes `artifacts/hackathon_showcase/pathc_latest.json` in the shape consumed by the showcase.
If the parent API has not been restarted with the newer Path C response fields yet, the script can still recover `used_nonce` and `message_hash` by decoding the `EzklVerifiedAndBridged` event from the L1 tx receipt.
When run with `--refresh-artifact`, it does not submit a new proof. It re-checks the saved L1 tx receipt, re-polls `verification-status`, updates `last_checked_at`, and keeps Path C usable as a recurring monitor stage. If the refreshed receipt is sitting in `pathc_pending_latest.json` and now has real L2 confirmation, the helper promotes it into `pathc_latest.json` and removes the stale pending artifact automatically.

### Hackathon showcase artifacts

Report files are written only when `--emit-report` is set (or `SHOWCASE_EMIT_REPORT=true`):

- `artifacts/hackathon_showcase/showcase-YYYYMMDD-HHMMSS.html`
- `artifacts/hackathon_showcase/showcase-YYYYMMDD-HHMMSS.json`
- `artifacts/hackathon_showcase/latest.html`
- `artifacts/hackathon_showcase/latest.json`
- `artifacts/hackathon_showcase/patha_latest.json` (latest Path A `NoirEzklBridge` / `noir_honk` receipt artifact used by recursive stage check-ins and strict Noir gate)
- `artifacts/hackathon_showcase/pathb_latest.json` (latest Path B `EzklNativeKzg` runtime/verifier coverage artifact used by recursive stage check-ins and strict bridge gate)

Path A hardening track:

- `circuits/noir_ezkl_bridge_v2/` is the versioned Noir package that adds `timestamp` and `ezkl_proof_hash` binding without mutating the currently deployed Path A verifier.
- `bash circuits/build_noir_ezkl_bridge_v2.sh` builds that package locally.
- `bash circuits/generate_noir_ezkl_bridge_v2_honk_verifier.sh` generates the corresponding Garaga HONK verifier project for the future V2 lane.
- Generated verifier project path: `circuits/contracts/src/garaga_verifier_noir_ezkl_bridge_v2/`
- `artifacts/hackathon_showcase/pathc_latest.json` (latest confirmed Path C receipt kept safe for strict gate / report readiness)
- `artifacts/hackathon_showcase/pathc_pending_latest.json` (newest pending Path C receipt when a fresh L1 tx has not confirmed on L2 yet)
- `artifacts/hackathon_showcase/pathc_history.jsonl` (append-only Path C receipt history keyed by live L1 tx, used for model-coverage reporting and rotation)
- `artifacts/hackathon_showcase/pathc_payload_latest.json` (latest first-party Path C payload bundle generated from a local EZKL proof)

The HTML report includes:

- Tabbed + subtabbed readout for judges (`Overview`, `ModelBridge`, `AI + Badges`, `Privacy + Voting`, `Infra + On-chain`) with a compact default **Overview -> Snapshot** view
- Top-level executive cards to reduce initial scroll/load and highlight immediate state (`core claims`, `ModelBridge`, `Native KZG strict`, `recursive stages`)
- Core claim matrix and step-by-step terminal evidence
- Dedicated **ModelBridge + ModelBridgeHeavy live L3 receipt** sections: proof hash, calldata size, lane mode, tx link (if emitted), and retry timeline
- Dual-lane mirror status now distinguishes `mirror_underfunded` from generic mirror failure, so low Sepolia wallet balance is reported as an infra constraint rather than a fake protocol error
- Dedicated **Lane Health + Degradation Notes** matrix so any unstable lane (for example Noir calldata availability) is explicit in the report
- Dedicated **Bridge Benchmark Receipts** compact table: per-lane HTTP/mode/backend/verified flag + duration + fee + gas + explorer tx
- Dedicated **Rolling Stability + Gas Trend** table from `artifacts/hackathon_showcase/history.jsonl` (verified-rate + p50/p95 latency/cost by lane; `FRI` for L3 lanes, `gas` for Path C L1 bridge)
- Dedicated **StarkHeavyReputation (Stone -> L3)** section: heavy STARK proof hash/fact hash, L3 mode, and tx/error evidence
- Open-source ModelBridge deep dive: bridge artifacts, STARK/SNARK proving lanes, uniqueness unlock matrix, and ecosystem comparison
- Recursive EZKL path status panel (Phase 2/3/4): Path A Noir HONK completion signals, Path C L1 bridge sender/receiver wiring (`verifyAndBridge` + poll), Path B native KZG routing signals, plus env readiness, **stage completion check-ins**, and **GitHub version gates**
- Top-level **Operational Benchmark Snapshot** now includes `PathCBridge` with live confirmation latency and L1 gas usage sourced from the current strict run instead of waiting for the next history window
- Dedicated **Path A Live Receipt** table sourced from `patha_latest.json`, so Path A is tracked as a receipt-backed stage instead of just a listed lane
- Dedicated Path B live artifact sourced from `pathb_latest.json`, so Path B stage readiness is pinned to live catalog receipts plus verifier ABI/runtime checks instead of only the in-memory warm report
- Dedicated **Path C Recent Receipt History** table sourced from `pathc_history.jsonl`, so the report can show verifier-compatible model coverage instead of one pinned L1->L2 example
- Path C route visibility in the report: route source/key plus the active L1 sender/verifier/receiver are shown in the live receipt section, so `/test` makes the current verifier selection explicit instead of implying a single hardcoded L1 route
- Path C capture safety: fresh pending captures are written to `pathc_pending_latest.json` and only promoted over `pathc_latest.json` once L2 confirmation is real, so strict gate readiness does not regress during experimentation
- Voyager links for deployed contracts/classes and receipt tx hashes (when present)
- Deep circuit inventory (`31` first-party Circom circuits) with artifact readiness
- AI + marketplace snapshot: opportunities, advisory calls, strategy badge screening
- AI circuit-skills evidence: per-opportunity zkML skill passes/fails, recommendation rationale, and proof receipt trail ("I used skill X" -> receipt endpoint)
- Privacy rails demo: shielded/nullifier/hash/relayer withdraw + Madara L3 settlement probes
- Private governance/lending backend probes (proposal/vote path + lending policy/call-data flows)
- Private prediction market primitive (forecaster): commit/reveal, scoring receipt, explainability snapshot
- Generated LLM + circuit-skill config packs (conservative/balanced/aggressive)
