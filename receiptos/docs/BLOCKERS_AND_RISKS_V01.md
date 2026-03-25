# ReceiptOS v0.1 Blocker Stress-Test (Starknet Reality)

This list is prioritized by execution risk.

## Critical Blockers (must resolve before implementation)

1. Event source uncertainty for signal extraction.
Risk: mainnet protocol contracts may not expose stable, wallet-attributable events for every desired signal.
Impact: protocol breadth and liquidation signals become low-confidence or impossible.
Mitigation:
- Complete Phase 0 coverage table before coding signal logic.
- Lock signal definitions to verified selectors + data layouts only.

2. Wallet-age derivation is not directly available from Starknet RPC.
Risk: `DEPLOY_ACCOUNT` lookup and earliest tx discovery is non-trivial and can be expensive.
Impact: inaccurate or null-heavy `wallet_age_days`.
Mitigation:
- Treat wallet age as best-effort with explicit source field.
- Implement fallback order exactly and document unresolved wallets.

3. Cross-language signature mismatch risk (TypeScript vs Cairo).
Risk: poseidon input encoding or signature shape mismatches invalidate all attested issuance.
Impact: contract cannot accept valid attester signatures.
Mitigation:
- Perform key compatibility test before deployment.
- Pin `starknet` npm version and record exact signing functions used.

## High Risks (likely to cause delay)

1. RPC throughput/rate limits during event scans.
Risk: `getEvents` across broad block ranges can hit throttling and long wall-times.
Impact: vectors exceed UX limits and claim flow times out.
Mitigation:
- Add continuation-token paging, backoff, and request budget counters.
- Cache per-wallet protocol hits and narrow block windows after first pass.

2. Account class-hash mapping drift.
Risk: Argent/Braavos versions evolve; static list goes stale.
Impact: false `unknown` account type values.
Mitigation:
- Keep versioned hash list in config and add periodic refresh job.

3. Contract scope conflict with existing repo contracts.
Risk: current repository already contains multiple receipt/reputation contracts.
Impact: accidental reuse, import confusion, or wrong ABI in integrations.
Mitigation:
- Keep under `receiptos/contracts/receipt_registry_v01` with unique naming.
- Never modify existing contract trees for v0.1 pilot.

## Medium Risks (manageable with process)

1. Frontend coupling risk.
Risk: adding `/passport` directly into current `frontend/` could destabilize live product routes.
Mitigation: keep `receiptos/passport` isolated until Sepolia E2E passes.

2. Mainnet address/selector staleness.
Risk: protocol upgrades invalidate assumptions.
Mitigation: capture `last_verified_block` and sample tx in config; re-verify before launch.

3. Integration readiness ambiguity for partners.
Risk: external teams need ABI and examples in their expected format.
Mitigation: keep `receiptos/integration` package minimal and copy-paste ready.

## Known Repository-Specific Constraints

- Repo is currently multi-stack (Python backend, Next frontend, Cairo contracts) without root workspace orchestration.
- Existing scripts and PM2/nginx setup are focused on current zkde.fi stack, not new package orchestration.
- Therefore ReceiptOS should remain a bounded in-repo slice until it proves value.

## Go/No-Go Criteria

No-Go if any condition below is true:
- Fewer than 4 critical protocol addresses verified.
- Missing selectors for StarkGate deposit, Ekubo swap, Vesu liquidation.
- JS/Cairo signature compatibility test not passing.
- 10-wallet benchmark has any wallet over 30s without mitigation plan.

Go when all above are green and Sepolia end-to-end claim succeeds.
