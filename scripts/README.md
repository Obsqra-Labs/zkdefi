# Scripts

Operational and deployment scripts for zkde.fi.

---

## Live research report

- Public readout: [https://zkde.fi/test](https://zkde.fi/test)
- Local latest HTML: `artifacts/hackathon_showcase/latest.html`
- Local latest JSON: `artifacts/hackathon_showcase/latest.json`

The `/test` page mirrors what `hackathon_backend_showcase.py` generates and is the fastest way to validate Obsqra Labs research claims with backend + on-chain receipts.

---

## Index

| Script | Purpose |
|--------|---------|
| **hackathon_backend_showcase.py** | Terminal-first demo runner for hackathon judging: validates proofs, agent execution, privacy commitment flow, policy controls, receipts, on-chain/RPC checks, AI advisory + badge screening flow, and can emit a local HTML/JSON report with Voyager links when requested. |
| **warm_kzg_bundle_catalog.py** | Path B utility: runs real EZKL proof + local verify per model and warms/caches `kzg_mpcheck_bundle` coverage across the local model catalog, writing a JSON coverage report. |
| **ci_showcase_gate.py** | CI gate: runs Path B warm-up with minimum coverage, then strict showcase; fails if coverage or bridge lane checks regress. |
| **daily_live_research_build.sh** | Server-side daily runner for `/test`: executes `ci_showcase_gate.py`, refreshes `latest.html/json`, and writes timestamped logs under `artifacts/hackathon_showcase/daily_logs/`. |
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

Bridge execution is prioritized before optional proof checks so ModelBridge receipt attempts do not lose budget to other endpoints under load.
Dual bridge validation uses `proof_mode=1` (EZKL_BRIDGE) to test chain mirroring reliability without adding execution-proof latency from `FULL_DUAL_PROVER`.
Mirror semantics: `mirrored` = L2 mirror verified, `mirror_unavailable` = parent L2 registry endpoint unavailable, `mirror_failed` = mirror attempted but failed.

Native KZG strictness defaults (backend):

- `NATIVE_KZG_REQUIRE_REAL_EZKL=true` (block `EzklNativeKzg` execution if only synthetic/placeholder proof is available)
- `NATIVE_KZG_REQUIRE_MPCHECK=true` (block `EzklNativeKzg` execution if `ezkl_kzg_v1` payload has no `kzg_mpcheck_v1` trailer)
- `NATIVE_KZG_WARM_ON_REAL_PROVE=true` (after each real EZKL proof verify, warm/cache `kzg_mpcheck_bundle` metadata for future native-kzg runs)
- `EZKL_PROVER_WARM_KZG_ON_PROVE=true` (service-level default; warm/cache `kzg_mpcheck_bundle` metadata as soon as a real EZKL proof is generated)
- `EZKL_AUTO_SETUP_ON_DEMAND=true` (auto-discover local ONNX artifacts and attempt `setup_model(..., force=False)` before fallback)

ModelBridge real-EZKL bridge toggles (backend):

- `MODELBRIDGE_TRY_REAL_EZKL=true` (attempt real local EZKL proof generation for `ModelBridge` and `ModelBridgeHeavy` before synthetic fallback)
- `MODELBRIDGE_REQUIRE_REAL_EZKL=false` (when `true`, block ModelBridge execution if no locally verified EZKL proof is available)
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
- `SHOWCASE_DUAL_BRIDGE_TIMEOUT_SECONDS` (optional; override timeout for `execution_chain=dual`, useful when strict mode times out under load)
- `SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS` (default `2` in CI gate; limits strict bridge retry loops)
- `SHOWCASE_REQUIRE_NOIR_LANE` (default `false`; when `true`, CI gate hard-requires Noir lane `noir_honk` + on-chain verify)
- `SHOWCASE_BENCHMARK_WINDOW_RUNS` (default `40`; rolling history window used for stability/gas trend table)
- `PATHB_WARM_MIN_COVERAGE` (default `1.0`)
- `SHOWCASE_WARM_OUTPUT` (default `artifacts/hackathon_showcase/pathb_bundle_warm.json`)

Daily build for `/test` (same-server cron):

```bash
scripts/daily_live_research_build.sh
```

Example crontab (UTC 06:15 daily):

```cron
15 6 * * * cd /opt/obsqra.starknet/zkdefi && /opt/obsqra.starknet/zkdefi/scripts/daily_live_research_build.sh
```

By default the daily script **always refreshes** `latest.html/json` even if strict lanes partially fail (`daily_build_status=WARN` in log).  
Set `DAILY_BUILD_STRICT_EXIT=true` to make cron fail on strict-lane regressions.

### Hackathon showcase artifacts

Report files are written only when `--emit-report` is set (or `SHOWCASE_EMIT_REPORT=true`):

- `artifacts/hackathon_showcase/showcase-YYYYMMDD-HHMMSS.html`
- `artifacts/hackathon_showcase/showcase-YYYYMMDD-HHMMSS.json`
- `artifacts/hackathon_showcase/latest.html`
- `artifacts/hackathon_showcase/latest.json`

The HTML report includes:

- Tabbed + subtabbed readout for judges (`Overview`, `ModelBridge`, `AI + Badges`, `Privacy + Voting`, `Infra + On-chain`) with a compact default **Overview -> Snapshot** view
- Top-level executive cards to reduce initial scroll/load and highlight immediate state (`core claims`, `ModelBridge`, `Native KZG strict`, `recursive stages`)
- Core claim matrix and step-by-step terminal evidence
- Dedicated **ModelBridge + ModelBridgeHeavy live L3 receipt** sections: proof hash, calldata size, lane mode, tx link (if emitted), and retry timeline
- Dual-lane mirror status now distinguishes `mirror_underfunded` from generic mirror failure, so low Sepolia wallet balance is reported as an infra constraint rather than a fake protocol error
- Dedicated **Lane Health + Degradation Notes** matrix so any unstable lane (for example Noir calldata availability) is explicit in the report
- Dedicated **Bridge Benchmark Receipts** compact table: per-lane HTTP/mode/backend/verified flag + duration + fee + gas + explorer tx
- Dedicated **Rolling Stability + Gas Trend** table from `artifacts/hackathon_showcase/history.jsonl` (verified-rate + p50/p95 latency/fee by lane)
- Dedicated **StarkHeavyReputation (Stone -> L3)** section: heavy STARK proof hash/fact hash, L3 mode, and tx/error evidence
- Open-source ModelBridge deep dive: bridge artifacts, STARK/SNARK proving lanes, uniqueness unlock matrix, and ecosystem comparison
- Recursive EZKL path status panel (Phase 2/3/4): Path A Noir HONK completion signals, Path C L1 bridge sender/receiver wiring (`verifyAndBridge` + poll), Path B native KZG routing signals, plus env readiness, **stage completion check-ins**, and **GitHub version gates**
- Voyager links for deployed contracts/classes and receipt tx hashes (when present)
- Deep circuit inventory (`31` first-party Circom circuits) with artifact readiness
- AI + marketplace snapshot: opportunities, advisory calls, strategy badge screening
- AI circuit-skills evidence: per-opportunity zkML skill passes/fails, recommendation rationale, and proof receipt trail ("I used skill X" -> receipt endpoint)
- Privacy rails demo: shielded/nullifier/hash/relayer withdraw + Madara L3 settlement probes
- Private governance/lending backend probes (proposal/vote path + lending policy/call-data flows)
- Private prediction market primitive (forecaster): commit/reveal, scoring receipt, explainability snapshot
- Generated LLM + circuit-skill config packs (conservative/balanced/aggressive)
