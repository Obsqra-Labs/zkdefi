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

Status (2026-03-25): PENDING.
- Blocked on deployer account/private key, funded Sepolia address, and target RPC/env configuration in this workspace.

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
