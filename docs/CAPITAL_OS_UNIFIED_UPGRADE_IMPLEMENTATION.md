# Capital OS Unified Upgrade Implementation

Date: 2026-03-08
Status: In Progress (Builder V2 + Profile/Reputation V2 base preserved, V3/zkFICO additive wiring active)

## Implemented

### 1. Versioning + anti-drift
- Added canonical trust version matrix service:
  - `backend/app/services/trust_version_matrix.py`
- Version matrix now included in additive trust payloads and profile surfaces.

### 2. Portable Reputation / Identity V3 (additive APIs)
- Added V3 routes under `/api/v1/zkdefi`:
  - `GET /identity/graph/{subject}`
  - `POST /identity/graph/{subject}/link`
  - `POST /attributions/query`
  - `POST /claims/derive`
  - `POST /credentials/issue`
  - `POST /credentials/verify`
  - `POST /credentials/revoke`
  - `GET /credentials/revocation/{revocation_id}`
- Added persistent JSON-backed V3 service:
  - `backend/app/services/portable_identity_service.py`
- Added trust timeline event emission for identity/claims/credentials.

### 3. risk_profile v2 additive extension
- `GET /api/v1/zkdefi/risk_profile/v2/{address}` now includes:
  - `version_matrix`
  - `attribution_summary`
  - `credential_summary`
  - enriched `trust_tuple.identity` continuity fields
- Verified-link-only cross-chain contribution remains enforced in attribution path.

### 4. zkFICO finisher (scoped additive layer)
- Added manifest + aggregate routes:
  - `GET /api/v1/zkdefi/reputation/pack/manifest`
  - `GET /api/v1/zkdefi/reputation/zkfico/{address}`
- Added proof endpoint:
  - `POST /api/v1/zkdefi/reputation/proof/credit-eligibility`
- Dual score contract active:
  - canonical trust score `0-100`
  - display score `300-850`
- Hybrid proof envelope active:
  - Groth16 proof generation for UX decisions
  - async STARK-wrapped settlement envelope metadata.

### 5. Profile + onboarding flow alignment
- Added shared trust flow component:
  - `frontend/src/components/zkdefi/TrustFlowChecklist.tsx`
- Integrated checklist into:
  - `/profile` (`frontend/src/app/profile/page.tsx`)
  - onboarding wizard (`frontend/src/components/zkdefi/OnboardingWizard.tsx`)
- `/profile` now shows additive V3 summaries and zkFICO readiness/pack metadata.

### 6. Cross-surface trust selector wiring (flagged)
- Trade Desk:
  - `frontend/src/components/zkdefi/TradeDesk.tsx`
  - trust gate hints + policy checks (execution/lending) with fallback path.
- Intelligence Stream:
  - `frontend/src/components/zkdefi/mission-control/UnifiedStream.tsx`
  - trust strip + deploy guard on execution block.
- Agent/Circuit control surfaces:
  - `frontend/src/components/zkdefi/mission-control/ControlPlane.tsx`
  - `frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx`
  - trust wiring guarded by feature flag fallback.

## Feature Flags

### Frontend
- `NEXT_PUBLIC_PROFILE_V3`
- `NEXT_PUBLIC_PORTABLE_IDENTITY_V3` (also supports `NEXT_PUBLIC_PORTABLE_IDENTITY_V3_ENABLED` alias)
- `NEXT_PUBLIC_ZKFICO_FINISHER`
- `NEXT_PUBLIC_TRUST_SURFACE_WIRING`

### Backend
- `PROFILE_V3`
- `PORTABLE_IDENTITY_V3` (also supports `PORTABLE_IDENTITY_V3_ENABLED` alias)
- `ZKFICO_FINISHER`
- `TRUST_SURFACE_WIRING`

## Contract Safety
- No route removals.
- Existing `/api/v1/agents/*`, `/api/v1/zkdefi/risk_profile/*`, `/api/v1/zkdefi/reputation/*`, `/api/v1/zkdefi/session_keys/*`, `/api/v1/zkdefi/linked_addresses/*` remain canonical.
- All schema/API evolution in this stream is additive.

## Added Tests
- Backend:
  - `backend/tests/test_portable_identity_v3.py`
- Frontend:
  - `frontend/src/lib/trust/__tests__/flags.test.ts`

