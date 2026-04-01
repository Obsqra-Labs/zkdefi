# Unified Portable Passport Execution Checklist

## Week 1: Canonical Model
- [ ] Define PPP v1 schema in backend and frontend types.
- [ ] Build portable passport aggregator service over existing risk_profile + portfolio + receipts.
- [ ] Add deterministic evidence hash composition rules.
- [ ] Add unit tests for schema stability and missing-source behavior.

## Week 2: API + Migration
- [ ] Add GET /api/v1/passport/portable/{address}.
- [ ] Add GET /api/v1/passport/portable/{address}/public.
- [ ] Migrate /profile to PPP endpoint.
- [ ] Migrate /passport to PPP endpoint.
- [ ] Remove duplicate per-view score composition logic.

## Week 3: Claims + Privacy
- [ ] Add claim namespace mapping (execution, lending, builder, activity).
- [ ] Add disclosure-pack endpoint with selective claim inclusion.
- [ ] Add redaction policy for sensitive value fields.
- [ ] Add audit logs for disclosure-pack generation.

## Week 4: Portability + Ecosystem
- [ ] Add signed export envelope for third-party verification.
- [ ] Add verifier doc and sample verifier payload.
- [ ] Add embeddable public card configuration.
- [ ] Track adoption metrics and mismatch regression checks.

## Non-Negotiable Quality Gates
- [ ] /profile and /passport show identical tier/score/claims from same payload.
- [ ] If one evidence source is down, endpoint still returns partial PPP with explicit source health.
- [ ] Circuit/proof references are traceable to receipt/proof registry IDs.
- [ ] Privacy mode defaults to selective disclosure, never full raw balances for public views.

## Test Matrix
- [ ] Cold wallet, no activity.
- [ ] Active DeFi wallet, no builder history.
- [ ] Builder-only wallet, low TVL.
- [ ] High-activity wallet with linked addresses.
- [ ] Degraded dependencies (portfolio timeout, receipt store unavailable).

## Ship Criteria
- [ ] One canonical payload in prod powering all trust surfaces.
- [ ] Third party can verify at least one exported disclosure pack.
- [ ] No score drift between /profile and /passport for 7 days.
