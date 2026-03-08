# Capital OS Reputation, Identity, and Governance Upgrade (V2)

## Objective
Unify the profile and trust stack into a single Capital OS flow where:
- reputation (behavioral trust),
- credit (lending underwriting),
- governance voting power (participation influence)

are separate, explainable, and composable signals backed by verified identity links, proof receipts, and session-bound execution.

## Current State Deep Dive (as of 2026-03-08)

### What Exists and Is Strong
- `backend/app/api/risk_profile.py` already composes a usable profile bundle and a V2 decision payload.
- `backend/app/services/profile_decision_service.py` already separates gate decisions (`relayer`, `execution`, `lending`) and logs outcomes.
- `backend/app/services/attestation_service.py` already issues portable credit attestations and VC-style exports.
- `backend/app/services/linked_address_verification_service.py` already supports signature-verified EVM address linking.
- Historic profile implementation in `a49d5346` contains a stronger `/profile` UX pattern to reuse.

### Regressions / Gaps Identified
- `backend/app/main.py` had code for risk profile and auth session in repo but not mounted in current runtime path.
- `backend/app/api/linked_addresses.py` had regressed to basic GET/PUT, losing verify/start and verify/complete ownership proof endpoints.
- `backend/app/api/reputation.py` used in-memory user state (`_user_data`), causing non-persistent reputation history across restarts.
- `backend/app/api/reputation.py` currently exposes a reduced route surface vs `a49d5346` (missing staking/proof status and proof generation endpoints), creating product regression in profile trust UX.
- `frontend/src/app/profile/page.tsx` remained V1-style and used fragile API path construction.
- `frontend/src/lib/sessionKeys.ts` had a broken `getUserSessions` URL call.
- `frontend/src/components/zkdefi/CreditReputationHub.tsx` pointed to deprecated endpoint paths.

## Immediate Foundation Fixes Applied
- Mounted `risk_profile` and `auth_session` routers in `backend/app/main.py`.
- Restored linked address verification API surface in `backend/app/api/linked_addresses.py`:
  - `POST /linked_addresses/verify/start`
  - `POST /linked_addresses/verify/complete`
  - verification metadata in GET/PUT payloads.
- Switched reputation user state to `JsonStore` persistence in `backend/app/api/reputation.py`.
- Enforced verified linked addresses for cross-chain reputation baseline in `backend/app/api/reputation.py`.
- Fixed timezone import bug in `backend/app/services/session_key_service.py`.
- Replaced in-memory session-key state with `JsonStore` persistence in `backend/app/services/session_key_service.py`.
- Fixed `getUserSessions` fetch wiring in `frontend/src/lib/sessionKeys.ts`.
- Rewired `/profile` V1 API calls to canonical `apiUrl(...)` in `frontend/src/app/profile/page.tsx`.
- Re-enabled richer profile hooks (`useRiskProfile`, `useRiskProfileV2`) in `frontend/src/hooks/useProfile.ts`.
- Extended risk profile composition to include governance voting power in `backend/app/api/risk_profile.py` and `frontend/src/hooks/useProfile.ts`.
- Updated `CreditReputationHub` to use `risk_profile/v2` instead of stale routes.
- Fixed receipt aggregation hook API URL normalization in `frontend/src/hooks/useReceiptAggregator.ts`.

## Target Architecture (Capital OS)

### 1) Identity Plane (Portable + Verifiable)
- Root identity: Starknet address + identity commitment.
- Linked identities: EVM addresses per chain (`ethereum`, `arbitrum`, `base`, `optimism`) with mandatory signature verification.
- Session identity: dual-wallet auth session + Starknet typed bind proof.
- Portable output:
  - `risk_profile?format=erc8004` for machine-consumable profile cards.
  - VC export for third-party protocol ingestion.

### 2) Trust Plane (Three Explicit Scores)
- Reputation Score:
  - behavior and consistency (tenure, successful tx count, proof cadence, execution quality).
  - used for protocol access posture and disclosure comfort.
- Credit Score:
  - underwriting and lending-specific signal (LTV, rate, unsecured cap, collateralized line).
  - used only for lending/risk pricing.
- Governance Voting Power:
  - participation + stake + delegated trust signals.
  - used only in governance weighting.

No shared “magic score” across these domains.

### 3) Proof Plane (Selective Disclosure by Policy)
- Every sensitive profile claim is resolved through claim templates:
  - `is_verified_multichain`
  - `credit_line_above_threshold`
  - `reputation_tier_at_least`
  - `governance_eligibility`
- Capital OS services request only required claims, not full profile payloads.

### 4) Execution Plane (Smart Wallet + Session Keys)
- Session keys become explicit execution capability objects:
  - scope (`protocols`, `max_position`, `duration`),
  - identity binding hash,
  - current trust gate mode (`allow/advisory/block`),
  - revocation state.
- Smart wallet flow:
  - onboarding creates default low-risk session profile.
  - risk upgrades unlock broader session templates.

## Capital OS Integration Flow

### Onboarding
1. Wallet connect (Starknet).
2. Linked address verification (optional at first, required for higher tiers).
3. Identity commitment + first proof receipts.
4. Session template issued.
5. Risk profile bundle generated and cached.

### Profile Surface (`/profile`)
- Replace tab model with 4 lenses:
  - `Identity`
  - `Reputation`
  - `Credit`
  - `Governance`
- Add “What changed” diff cards from previous profile snapshot.
- Add explicit disclosure controls for each claim family.

### Circuit Builder / Agent Builder
- Agent creation consumes profile gates:
  - execution gate for autonomous ops,
  - lending gate for borrow-enabled strategies.
- Agent logs include trust context at execution time:
  - session id,
  - profile version hash,
  - decision mode.

### Mission Control / Trade Desk
- Timeline events include:
  - identity bind/unbind,
  - reputation tier transitions,
  - credit attestation issuance/expiry,
  - governance power changes,
  - session key lifecycle.

## Data Model (Additive, Non-Breaking)

### `identity_links`
- `starknet_address`, `chain`, `linked_address`, `verified`, `verified_at`, `signature_hash`, `source`.

### `profile_snapshots`
- `starknet_address`, `snapshot_id`, `version`, `payload_json`, `created_at`.

### `trust_scores`
- `starknet_address`, `reputation_score`, `credit_score`, `governance_power`, `model_versions`, `updated_at`.

### `session_capabilities`
- `session_id`, `owner`, `scope_json`, `trust_snapshot_id`, `active`, `expires_at`, `revoked_at`.

### `attestations`
- extend current store with `claim_type`, `claim_schema_version`, `revoked`.

## API Contract Evolution (Backward-Compatible)

### Keep
- Existing `/api/v1/zkdefi/reputation/*`
- Existing `/api/v1/zkdefi/risk_profile/*`
- Existing `/api/v1/zkdefi/session_keys/*`

### Add (V2)
- `GET /api/v1/zkdefi/profile/snapshot/{address}`
- `GET /api/v1/zkdefi/profile/diff/{address}?from=...&to=...`
- `POST /api/v1/zkdefi/disclosure/claims`
- `GET /api/v1/zkdefi/governance/power/{address}`
- `GET /api/v1/zkdefi/credit/attestation/{address}`

### Clarify Semantics
- `reputation` endpoints: behavioral trust only.
- `credit` endpoints: lending eligibility only.
- `governance` endpoints: voting power only.

## Rollout Plan

### Phase 0: Stabilize (done in this batch)
- Restore route mounting, persistence, verification APIs, and broken client wiring.

### Phase 1: Profile V2 UI Parity
- Rebuild `/profile` using `useRiskProfile` + `useRiskProfileV2`.
- Reuse strong composition from `a49d5346` while removing stale endpoint calls.

### Phase 2: Trust Domain Separation
- Introduce explicit score cards and policy boundaries.
- Add governance power service + endpoint.

### Phase 3: Portable Identity + Selective Disclosure
- Expose claim-level disclosure API with policy templates.
- Add protocol-consumable profile assertions (ERC-8004 + VC export path).

### Phase 4: Capital OS Native Integration
- Inject profile/trust snapshot references into Circuit Builder, Agent execution logs, and Memory Lane.

## Feature Flags
- `PROFILE_V2_ENABLED` (frontend)
- `TRUST_DOMAIN_SPLIT_ENABLED` (frontend/backend)
- `DISCLOSURE_CLAIMS_ENABLED` (backend)
- `GOVERNANCE_POWER_V2_ENABLED` (backend)

## Test Plan

### Backend
- persistence across restart for reputation records.
- linked-address verification happy path and tamper/failure paths.
- risk profile endpoint availability and schema compatibility.
- session key validation behavior with active/expired sessions.

### Frontend
- `/profile` loads with `apiUrl` on local and proxied environments.
- risk profile fallback behavior when V2 endpoint unavailable.
- credit/reputation hub renders safely on partial payloads.

### E2E
- verify linked address, reload, and confirm persisted verification metadata.
- create session key, list sessions, validate, revoke.
- generate risk profile bundle and confirm decisions + disclosures sections.

## Snapshot Reuse Guidance
- Use `a49d5346` as UI foundation for `/profile` composition patterns.
- Do not reintroduce stale endpoint paths from that snapshot; map all data pulls to current canonical routes.
- Keep V1 response shapes stable while layering V2 fields additively.
