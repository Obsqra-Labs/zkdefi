# ReceiptOS v0.1 Implementation Checklist (Repo-Native)

This checklist translates the execution plan into repository-local steps and gates.

## Phase 0: Setup and Verification

1. Add fixture wallets in `receiptos/indexer/test/fixtures/test-wallets.json`.
Gate: exactly 10 real mainnet addresses with profile notes.
Command snippet:
```bash
jq length receiptos/indexer/test/fixtures/test-wallets.json
```

2. Resolve protocol contract addresses into `receiptos/config/mainnet-contracts.json`.
Gate: at least StarkGate + Ekubo + Vesu + one of Endur/Nostra marked `verified: true`.
Command snippet:
```bash
jq '. | to_entries[] | {name: .key, verified: .value.verified}' receiptos/config/mainnet-contracts.json
```

3. Resolve event selectors into `receiptos/config/event-selectors.json` with sample tx hashes.
Gate: StarkGate deposit, Ekubo swap, Vesu supply + liquidation all have selector + sample tx.
Command snippet:
```bash
jq '.' receiptos/config/event-selectors.json
```

4. Resolve account class hashes in `receiptos/config/account-class-hashes.json`.
Gate: Argent and Braavos each confirmed from 2+ wallets.

5. Save manual RPC query results in `receiptos/indexer/test/fixtures/rpc-test-results.json`.
Gate: `starknet_getNonce`, `starknet_getClassHashAt`, `starknet_getEvents` all confirmed.

6. Fill `receiptos/docs/COVERAGE_TABLE.md`.
Gate: 6+ rows fully verified (address + selector + sample tx + block).

## Phase 1: Indexer Core

1. Install indexer deps and compile.
Command snippet:
```bash
cd receiptos/indexer
npm install
npm run build
```
Gate: build succeeds.

2. Implement signals in `receiptos/indexer/src/signals/` one by one in this order:
`tx-count.ts`, `account-type.ts`, `wallet-age.ts`, `protocol-breadth.ts`, `liquidations.ts`, `bridge-inflow.ts`.
Gate: each signal has fixture-backed test coverage.

Status (2026-03-25):
- `tx-count.ts`, `account-type.ts`, `wallet-age.ts`, `protocol-breadth.ts`, `liquidations.ts`, and `bridge-inflow.ts` are fully implemented.
- Vitest suite: 17 tests, 34 assertions — all passing. Test gate: PASS.

3. Implement vector assembly in `receiptos/indexer/src/index.ts`.
Gate: vectors generated for all fixture wallets under `receiptos/indexer/test/fixtures/vector-outputs/`.

Status (2026-03-25): COMPLETE. All 10 fixture vectors generated. Outputs in vector-outputs/*.json.

4. Benchmark 10-wallet run.
Gate: each wallet completes in under 30s and under target RPC budget.

Status (2026-03-25): COMPLETE. max=25.9s, total_rpc_requests=413, 10/10 OK. See _benchmark.json.

## Phase 1.5: Mainnet Footprint

1. Run the protocol-footprint CLI against verified mainnet addresses only.
Command snippet:
```bash
cd receiptos/indexer
npm run footprint -- --from-block 0
```
Gate: output shows deployed status for `receipt_registry_v01`, `receipt_archive_v01`, and `mist_chamber`.

2. Persist the latest full-history snapshot for repeatable review.
Command snippet:
```bash
cd receiptos/indexer
npm run footprint:full
```
Gate: `out/mainnet-footprint.latest.json` is written successfully.

3. Verify receipt event coverage before any user-facing protocol KPI claim.
Gate: receipt metrics are event-derived; public notional is route-attributed from Ekubo swap deltas in raw felt units; private notional is trace-derived from MIST chamber calldata.

Status (2026-04-05): COMPLETE for v0.1 event footprint + route attribution slice.
- CLI added at `receiptos/indexer/src/footprint/cli.ts`.
- Full-history live scan returned 3 deployed contracts, 12 `ReceiptIssued`, 0 `ReceiptConsumed`, 12 `CidAnchored`, and 12 unique receipt IDs touched.
- Snapshot now includes `gross_public_execution_notional` from Ekubo route attribution in raw felt units.
- USD normalization and cross-venue aggregation remain pending.

4. Run bounded MIST chamber trace windows to compute private deposit and recovery-withdraw raw totals.
Command snippet:
```bash
cd receiptos/indexer
FOOTPRINT_TRACE_MAX_BLOCKS=500 npm run footprint -- --from-block 8433000 --to-block 8433500
```
Gate: `private_mist_notional` is present when the scanned window is within the configured trace bound.

Status (2026-04-04): PARTIAL.
- Chamber ABI verified from installed `@mistcash/config` package.
- Chamber-specific events do not exist; trace scanning is required.
- Bounded trace support is implemented in the indexer, but full-history private-volume remains blocked without an archival trace index.

5. Run chunked MIST chamber trace aggregation when the desired window exceeds the default trace bound.
Command snippet:
```bash
cd receiptos/indexer
npx tsx src/footprint/cli.ts --from-block 8433000 --to-block 8433600 --trace-chunk-size 100 --trace-checkpoint-dir out/mist-trace-checkpoints
```
Gate: `mist_chamber.trace_window` remains computed for multi-chunk runs and one checkpoint file is written per processed chunk.

Status (2026-04-04): COMPLETE for chunked aggregation support.
- CLI supports `--trace-chunk-size` and `--trace-checkpoint-dir`.
- MIST totals aggregate across multiple bounded trace chunks instead of forcing a single small window.
- Snapshot payload now includes normalized token totals using `receiptos/config/mist-token-metadata.json` so private MIST amounts are presentation-ready.

6. Resume an interrupted chunked MIST scan from its saved manifest and checkpoints.
Command snippet:
```bash
cd receiptos/indexer
npx tsx src/footprint/cli.ts --from-block 8433000 --to-block 8433600 --trace-chunk-size 100 --trace-checkpoint-dir out/mist-trace-checkpoints --trace-manifest-path out/mist-trace-checkpoints/manifest.json --resume-trace-manifest
```
Gate: previously completed chunks are loaded from disk and not traced again, while the final snapshot still covers the full requested window.

Status (2026-04-04): COMPLETE for local resume support.
- CLI can persist a manifest at `--trace-manifest-path`.
- Resume mode reloads saved checkpoints and skips rescanning matching chunks.

## Phase 2: Attester + Contract

1. Build and test attester.
Command snippet:
```bash
cd receiptos/attester
npm install
npm run build
```
Gate: policy hash deterministic, signature verify passes in JS.

Status (2026-03-25): COMPLETE.
- `receiptos/attester` builds and type-checks cleanly.
- Vitest: 6/6 tests passing.
- Deterministic policy hash confirmed.
- Local Stark key sign + verify confirmed in JS.

2. Implement Cairo contract in `receiptos/contracts/receipt_registry_v01/src/`.
Command snippet:
```bash
cd receiptos/contracts/receipt_registry_v01
scarb build
scarb test
```
Gate: minimum 20 tests pass including invalid signature and replay/nullifier checks.

Status (2026-03-25): COMPLETE.
- `receiptos/contracts/receipt_registry_v01`: `scarb build` passes.
- `scarb test` passes via `snforge test` script wiring.
- Snforge: 23/23 tests passing.
- Coverage includes invalid signature, policy-hash replay, nullifier reuse, receipt verify semantics, and admin-only upgrade.

3. Cross-language key compatibility test (JS sign, Cairo verify).
Gate: same key/hash/signature verify in Cairo.

Status (2026-03-25): COMPLETE.
- TypeScript-generated Stark signature fixture verifies in Cairo with `check_ecdsa_signature`.
- Fixture documented in attester tests and receipt registry snforge tests.

4. Deploy to Sepolia and record deployment metadata in `receiptos/docs/DEPLOYMENTS.md`.
Gate: `issue_attested_receipt` + `verify_receipt` pass on live contract.

Status (2026-03-25): COMPLETE ✅
- ReceiptRegistry declared and deployed on Starknet Sepolia.
- Deployment metadata recorded in `receiptos/docs/DEPLOYMENTS.md`.
- Live `issue_attested_receipt` tx: `0x0111dea9b11048e000bcdc583bbeae1e5646ac5ad5f8f9f457f7fc6799f2b2c6` (receipt ID 1).
- `verify_receipt(1)` returns `true` on-chain. Phase 2 live E2E gate passes.

## Phase 3: Passport

1. Create isolated passport app under `receiptos/passport/`.
Gate: wallet connect + vector display works.

2. Add server-side claim flow that recomputes vectors.
Gate: Sepolia receipt claim works end-to-end from UI.

3. Only after success, wire route into existing infra (`nginx/zkde.fi.conf`, `scripts/setup-nginx-pm2.sh`).
Gate: `https://zkde.fi/passport` reachable and functional.

## Phase 4: Mist Integration

1. Complete `receiptos/integration/*` package with ABI, examples, addresses.
Gate: external developer can run integration in under one hour.

2. Validate first Sepolia protocol call to `verify_receipt` from integrator contract.
Gate: tx hash evidence recorded.

3. Promote to mainnet only after Sepolia stability.

## Phase 5: Post-Launch

1. Add monitoring counters for issuance, claim latency, and errors.
2. Log outreach and integration outcomes.
3. Draft v0.2 only from observed demand and data availability.

## Commit Cadence

- Commit every gate pass.
- Suggested commit format:
`receiptos(v0.1): <phase.step> <result>`
- Do not batch multiple gates into one commit.
