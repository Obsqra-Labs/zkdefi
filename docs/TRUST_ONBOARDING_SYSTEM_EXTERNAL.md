# Trust and Onboarding System (External)

Date: 2026-03-08
Status: Active
Audience: integrators, partners, and protocol teams

## Overview

zkde.fi uses a subject-centric trust model where identity, reputation, credit, and governance are separate but composable domains.

The onboarding flow is not a one-time UI form. It is a trust bootstrap pipeline:

1. Connect root identity (Starknet account + identity commitment)
2. Link wallets across chains
3. Verify wallet ownership
4. Sync attributed activity
5. Derive trust claims
6. Issue selective disclosure credentials
7. Bind scoped execution session keys

No single score is used as a universal gate. Domain-specific policies consume domain-specific trust signals.

## Trust Domains

### Identity
- Subject anchor and wallet-link confidence
- Verified links only are eligible for score-impacting attribution
- Session authority lifecycle (grant, confirm, revoke)

### Reputation
- Behavioral and consistency signals from attributed activity
- Proof lifecycle status and trust-tier progression

### Credit
- Lending-focused model outputs and gates
- Separate from governance and execution authority

### Governance
- Voting power model and capital basis
- Kept independent from lending and reputation policy outputs

## Execution Model

The system uses a hybrid proving model:
- Fast UX verification path for immediate user feedback
- Canonical settlement envelope path for durable verification lifecycle

This supports practical interaction speed while preserving a cryptographic audit trail.

## Canonical API Baseline

Existing canonical routes remain stable:
- `/api/v1/zkdefi/risk_profile/*`
- `/api/v1/zkdefi/reputation/*`
- `/api/v1/zkdefi/session_keys/*`
- `/api/v1/zkdefi/linked_addresses/*`

Additive Portable Identity/Trust routes:
- `GET /api/v1/zkdefi/identity/graph/{subject}`
- `POST /api/v1/zkdefi/identity/graph/{subject}/link`
- `POST /api/v1/zkdefi/attributions/query`
- `POST /api/v1/zkdefi/claims/derive`
- `POST /api/v1/zkdefi/credentials/issue`
- `POST /api/v1/zkdefi/credentials/verify`
- `POST /api/v1/zkdefi/credentials/revoke`
- `GET /api/v1/zkdefi/credentials/revocation/{revocation_id}`

## Selective Disclosure

Integrations can request only needed claims. For example:
- execution systems: execution gate + identity binding claims
- lending systems: credit-grade claims + revocation status
- governance systems: governance power claims

This minimizes over-disclosure and keeps policy checks explicit.

## Frontend Integration Pattern

The frontend uses one shared trust-flow state model for `/agent` and `/profile`.

Shared trust state computes:
- root identity connected
- wallets linked
- wallets verified
- attributions synced
- claims derived
- disclosure pack issued
- scoped session bound

This avoids drift between onboarding and profile surfaces.

Shared UI modules:
- `frontend/src/components/zkdefi/trust-flow/OnboardingSteps.tsx`
- `frontend/src/components/zkdefi/trust-flow/TrustFlowProgressSummary.tsx`
- `frontend/src/components/zkdefi/TrustFlowChecklist.tsx`

Shared state modules:
- `frontend/src/lib/trust/trustFlow.ts`
- `frontend/src/lib/trust/useTrustFlowState.ts`
- `frontend/src/lib/trust/onboardingState.ts`
- `frontend/src/lib/trust/lifecycle.ts`

Identity lens operational actions (Profile V2):
- load identity graph snapshot
- sync attribution events from verified links
- derive portable trust claims
- issue selective disclosure credentials
- verify and revoke credentials by id

Onboarding parity behavior:
- onboarding now triggers portable trust lifecycle actions after authorization:
- attribution sync (non-blocking)
- claim derivation (non-blocking)
- disclosure credential issue on successful agent submit (non-blocking)
- if a lifecycle call is unavailable, onboarding still completes and profile can retry actions.
- onboarding includes in-flow controls for:
- linked wallet challenge/verification
- saving verified links to identity graph inputs
- session grant request + tx-hash confirmation for scoped execution binding

## Safety and Compatibility

- All trust/profile changes are additive.
- Existing routes are not removed.
- Legacy onboarding markers are migrated to canonical onboarding state.
- Policy consumers can keep using V2 while progressively adopting V3 trust primitives.

## Feature Flags

Frontend:
- `NEXT_PUBLIC_PROFILE_V3`
- `NEXT_PUBLIC_PORTABLE_IDENTITY_V3`
- `NEXT_PUBLIC_ZKFICO_FINISHER`
- `NEXT_PUBLIC_TRUST_SURFACE_WIRING`

Backend:
- `PROFILE_V3`
- `PORTABLE_IDENTITY_V3`
- `ZKFICO_FINISHER`
- `TRUST_SURFACE_WIRING`

## What Integrators Should Build Against

1. Treat `/risk_profile/v2` as current aggregate source.
2. Use identity/credential V3 routes for portable claim workflows.
3. Enforce revocation checks for any policy-critical credential.
4. Keep domain boundaries explicit (`reputation != credit != governance`).
