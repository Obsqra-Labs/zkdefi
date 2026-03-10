# Hackathon MVP Wrap — Design

**Date:** 2026-03-10
**Timeline:** ~1 week
**Approach:** Parallel tracks (backend + frontend simultaneously)
**Priority:** Privacy is the product. Infra + core value first, then UI/UX.

---

## Constraints

- All three privacy paths must work end-to-end: deposit→pool→adapter, private DAO voting, selective disclosure + portable identity
- Consolidate everything into Capital OS (`/agent`) as the single app surface
- Fleet/dashboard is the market maker sim — out of scope for this work
- Credit line contracts don't exist on Sepolia — keep stubs but label them `"execution": "simulated"`

---

## Schedule

| Days | Track A (Backend) | Track B (Frontend) |
|------|-------------------|--------------------|
| 1–2 | A. Privacy infrastructure | D. Capital OS consolidation |
| 3–4 | B. Three privacy paths end-to-end | D (cont.) + E. Wire to backend, loading states |
| 5 | C. Hardening | E (cont.) Demo path smoke test |
| 6–7 | F. Integration, polish, demo prep | F. Same — tracks converge |

---

## Section A: Backend Privacy Infrastructure (Days 1–2)

### A1. Privacy vault admin account
- Document required env vars (`FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS`, `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY`) in deployment checklist
- `privacy_vault_service.py`: when admin is `None`, raise 503 with `"Privacy vault admin not configured"` instead of silently returning `0xmock_deposit_tx` / `0xmock_withdraw_tx`
- `/health` already surfaces `privacy_vault_admin_configured` — keep it
- Result: no silent mock transactions

### A2. Server-side proof generation
- `STARKProofGenerator`: flip `use_mock` default to `False`; raise 503 when circuits aren't available (gated by `ALLOW_SIMULATED_PROOFS`)
- `dao_voting_service.py`: tighten mock fallback so it only fires when `ALLOW_SIMULATED_PROOFS=true`; real snarkjs path runs when artifacts exist
- `groth16_prover.py`: ensure `generate_proof()` calls snarkjs with voting circuit artifacts; browser-facing paths return 501 with clear message
- Result: production proofs are real when artifacts exist; dev mode still works

### A3. Contract call stubs → real calls
- `privacy_vault_service.py` `deposit()` / `withdraw()`: when admin account is configured, build real calldata and submit via `admin_account.execute()` (same pattern as `ekubo.py` and `onboarding.py`)
- `ekubo_executor.py`: `_approve_token()`, `_build_mint_calldata()`, `_send_transaction()` — replace mock returns with real RPC calls
- `credit_line_service.py`: keep stubs but make API responses clearly state `"execution": "simulated"` — lending contracts don't exist on Sepolia yet
- Result: privacy pool and Ekubo LP are real on-chain; credit is honestly labeled

---

## Section B: Three Privacy Paths End-to-End (Days 3–4)

### B1. Deposit → privacy pool → adapter execution
- Wire `privacy_ekubo_orchestrator` to read from the real privacy vault balance (nullifier store + ledger) and build real adapter calls
- Ensure `/api/v1/zkdefi/orchestration/deploy` calls real executor, not mock
- Result: full deposit → pool → Ekubo LP with real on-chain proof and tx hash

### B2. Private DAO voting
- Ensure snarkjs artifacts for voting circuit are present and the server-side proof path works (from A2)
- Wire voting power to the same position/ledger stores used by collateral and vault
- Ensure `POST /api/v1/dao/proposals/{id}/vote` returns a real proof hash, not a mock
- Result: cast a vote, get a real ZK proof, verify on-chain that tally is correct without revealing individual votes

### B3. Selective disclosure + portable identity
- Ensure attestation → proof → verify chain works server-side (same snarkjs/proof pipeline as A2)
- Wire `portable_identity` and `linked_addresses` APIs to return real attestations backed by reputation/credit data
- Frontend `CompliancePanel` should show proof status (generating → verified) with real proof hashes
- Result: user generates a selective disclosure proof ("my reputation tier is at least 2") and a verifier endpoint confirms it without seeing raw data

### B4. Reputation feedback loop + lending
- Add tier downgrade in `record_transaction_internal` when default/liquidation drops `successful_txns / transaction_count` below 0.9
- Add "apply tier upgrade" when `upgrade_eligible` is true
- Ensure `compute_credit_line` returns real terms (not hardcoded `ltv=0.5, rate=0.08`); wire any endpoint that returns fixed terms to call `compute_credit_line` / `compute_predictive_credit_line` instead
- Result: reputation is dynamic; lending terms are computed from real data

---

## Section C: Backend Hardening (Day 5)

### C1. Input validation
- Pydantic validators on all POST request models: amount > 0, addresses are valid hex, proof strings non-empty, term_days > 0
- Key targets: `CollateralService.deposit()`, `PrivacyVaultService.withdrawShielded()`, `CreditLineService.borrow()`, all deposit/withdraw endpoints
- Return 422 with field-level errors

### C2. Rate limiting on write endpoints
- Apply existing `RateLimitMiddleware` to sensitive POST routes: privacy vault deposits, credit score queries, proof generation, voting
- Defaults: 10/min deposits, 30/min reads, 5/min proof generation

### C3. Proof verification
- `batch_verification.py`: replace `verify_proof() → return True` with actual Garaga/snarkjs verification against the verification key
- Privacy pool withdraw: verify nullifier proof before accepting

### C4. Pagination on list endpoints
- Add `limit` (default 20, max 100) and `offset` to: opportunities, execution history, credit lines, DAO proposals, receipts
- Return `{ items, total, next_offset }`

### C5. Single source of truth for positions
- Ensure collateral `get_user_positions`, lending positions, DAO `_compute_capital_breakdown`, and vault status all read from the same stores (SQLite-backed)
- Fix health_factor and voting_power to compute from real data rather than returning constants when stores are empty
- When genuinely empty: health_factor = "no debt", voting_power = 0

---

## Section D: Frontend Capital OS Consolidation (Days 1–3)

### D1. Kill standalone page routing
- `/vault`, `/trade`, `/lending`, `/oracle`, `/marketplace` become redirects to `/agent?v=<mode>`
- `CenterStageModes` extended to include vault, oracle, lending, marketplace as center-stage mode tabs
- Result: one URL, one layout, one nav

### D2. Unified nav inside Capital OS
- Replace `HeaderStrip` with proper in-app nav: Capital OS (home), Vault, Trade, Oracle, Lending, Marketplace, Profile
- Mode switches, not page navigations
- Keep overlay triggers (Deploy, Govern, Brain) as actions
- Drop `AppNavbar` — no longer needed
- Keep `SiteHeader` only on landing page (`/`) and `/products`

### D3. Privacy pools as first-class allocation view
- Move `PrivacyPoolsPanel` out of Deploy overlay → "Vault Rails (Advanced)" and into Vault mode center stage as the primary view
- Privacy pools (Conservative / Moderate / Aggressive) are the allocation buckets — visible immediately when you open Vault mode

### D4. Fix PrivacyPoolsPanel stability
- Wrap in error boundary
- Fix `useCallback` dependency bug: remove `rows` from deps, use functional `setRows(prev => ...)` updates
- Handle 404/500 from adapter/liquidity calls gracefully — error state per pool, not crash

### D5. Unify API client usage
- Replace all local `const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api"` instances with the shared `API_BASE` and `apiFetch()` / `apiUrl()` from `@/lib/api/client`
- Affected: ShieldedPoolPanel, CompliancePanel, OnboardingWizard, ProtocolPanel, PrivateTransferPanel, DexPanel, PositionChart, AgentRebalancer, SessionKeyManager, AllocationPools, DeployToEkuboCard, FullPrivacyPoolPanel

---

## Section E: Frontend Wiring + Polish (Days 4–5)

### E1. Wire privacy flows to real backend
- Deposit flow (DepositPanel, VaultStrategyDeposit): commitment generation → real proof status (generating → verified)
- Withdraw flow (WithdrawPanel): nullifier proof and relayer call → real tx hash
- DAO voting (GovernanceOverlay): proof generation status → real proof hash
- Selective disclosure (CompliancePanel): proof lifecycle (generating → verified → exportable) with real proof data

### E2. Loading states + error handling
- Skeleton loaders on: PrivacyPoolsPanel, PoolIntelligencePanel, CapitalLedger, vault mode, ActivityTab
- Component-level error boundaries around each center-stage mode
- Consistent 8s timeout on all API calls via AbortSignal
- "Backend unavailable" state (not blank screen)

### E3. Dead code cleanup
- Remove or archive unused TradeDesk V1 components (grep imports first)
- Remove standalone page components that are now one-liner redirects
- Clean up unused feature flag checks

### E4. Demo path smoke test
- Walk the 3-minute demo script in the browser against real backend
- Every beat: connect wallet → Capital Ledger → deposit → pool intelligence → Trade Desk → simulate/prepare/submit → governance → selective disclosure
- Fix anything that breaks, hangs, or shows mock data where real data should be

---

## Section F: Integration + Polish (Days 6–7)

### F1. Integration testing
- Backend: run existing test suite — ensure nothing regressed
- Frontend: run vitest — fix broken tests from consolidation
- Manual: full deposit → pool → adapter → governance → selective disclosure flow on Sepolia with real wallet

### F2. Backend data coherence check
- Verify all stores (receipts, execution, nullifier SQLite; collateral JsonStore; reputation persistence) are consistent
- Remove any remaining in-memory code paths bypassing persisted stores
- Confirm vault/status, collateral/positions, dao/voting_power return real data

### F3. Demo script alignment
- Update DEMO_SCRIPT_3MIN.md if any UI labels, flow names, or feature names changed
- Ensure every claim is demonstrable
- Prepare fallback: `ALLOW_SIMULATED_PROOFS=true` with "dev mode" indicator if Sepolia RPC is slow during demo

### F4. Final polish
- Favicon (fix 404)
- Title and meta description correct
- Console: no red errors, no uncaught promise rejections
- Tablet: Capital OS should not be broken on iPad
- Performance: lazy load heavy components (React Flow, Recharts) if they cause visible delays
