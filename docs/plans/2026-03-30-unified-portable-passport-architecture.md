# Unified Portable Passport Architecture (2026-03-30)

## Goal
Create one portable reputation primitive that:
- powers zkde.fi gating and UX,
- is useful to third parties,
- showcases builder + DeFi activity,
- preserves privacy through selective disclosure and proof modes.

## Current Fragmentation (What Is Broken)

### Surface fragmentation
- Multiple frontend trust surfaces with different semantics:
  - /passport style score widgets,
  - /profile risk_profile v2,
  - /credit hub proof summaries,
  - marketing reputation cards.
- Result: users see different scores/tier logic depending on screen.

### Data model fragmentation
- Reputation appears in different shapes:
  - risk_profile bundle/v2,
  - receipt summaries,
  - on-chain registry reads,
  - separate portfolio snapshots.
- No single canonical object that can be exported/imported.

### Proof/circuit fragmentation
- Circuits are rich, but mostly consumed as one-off gate checks.
- Passport portability is not centered around reusable proof attestations.

## Unified Primitive: Portable Passport Profile (PPP)

Define a canonical object consumed by all product surfaces.

```json
{
  "version": "ppp.v1",
  "subject": {
    "starknet_address": "0x...",
    "subject_id": "did:zkdefi:..."
  },
  "identity": {
    "linked_addresses": [],
    "session_state": {},
    "privacy_mode": "public|selective|private"
  },
  "reputation": {
    "tier": 0,
    "tier_name": "Strict|Standard|Express",
    "score": 0,
    "credit_score": null,
    "letter_rating": "D"
  },
  "activity": {
    "builder": {
      "deploy_count": 0,
      "verified_receipt_count": 0,
      "proof_count": 0
    },
    "defi": {
      "tvl_usd": 0,
      "protocol_count": 0,
      "position_count": 0,
      "turnover_30d_usd": 0
    }
  },
  "evidence": {
    "receipt_root": "0x...",
    "portfolio_snapshot_hash": "0x...",
    "proof_registry_refs": []
  },
  "claims": {
    "execution_eligibility": {},
    "lending_eligibility": {},
    "risk_posture": {}
  },
  "provenance": {
    "generated_at": "ISO",
    "policy_hash": "0x...",
    "circuits": [],
    "proof_mode": "groth16|advisory|hybrid"
  }
}
```

## Evidence Strategy (Make It Real + Useful)

### DeFi evidence
- Portfolio scanner summary and snapshot hash become first-class evidence.
- Include normalized protocol and position counts and value buckets.

### Builder evidence
- Include on-chain receipts, proof emission, and attestation counts.
- Add builder-specific badges (deployment consistency, execution integrity, policy adherence).

### Trust decisions as claims
- Embed output of decision engine as explicit machine-readable claims.
- Keep UI labels separate from claim payload for third-party reuse.

## Circuit Packaging (Novel Part)

Instead of showing raw gate results only, emit reusable claim attestations:
- Score Integrity Attestation:
  - binds tier/score to evidence roots.
- Activity Authenticity Attestation:
  - binds DeFi and builder activity summary to snapshot hashes.
- Policy Compliance Attestation:
  - binds decision modes and reason codes to policy hash.

These become the portable claim set. Third parties can verify claims without re-running full app logic.

## Privacy Modes (Flex + Utility)

### Public Card
- Share tier band, selected badges, confidence band, high-level activity totals.
- Hide exact wallet balances and sensitive strategy details.

### Selective Disclosure Pack
- User selects which claim namespaces to reveal (credit, builder, DeFi).
- Include minimal proofs and redacted evidence references.

### Private Verifier Mode
- User shares only proof commitments and verifier endpoints.
- Counterparty can verify eligibility without seeing raw stats.

## Product Surfaces (Unify Existing Routes)

### /profile
- Becomes the canonical full PPP inspector.
- Always source from a single backend PPP endpoint.

### /passport
- Becomes presentation-only wrapper around PPP.
- No independent scoring logic.

### /portfolio and execution gate
- Uses PPP claims for eligibility and trust context.
- Writes receipts that feed back into PPP evidence.

## API Contract Plan

Add canonical endpoint family:
- GET /api/v1/passport/portable/{address}
  - full PPP object
- GET /api/v1/passport/portable/{address}/public
  - redacted public card
- POST /api/v1/passport/portable/{address}/disclosure-pack
  - user-selected claim package
- GET /api/v1/passport/portable/{address}/evidence
  - normalized evidence pointers

## Rollout Phases

### Phase 1: Canonicalization
- Build PPP aggregator service from existing risk_profile, portfolio, receipts, proofs.
- Add stable typing in frontend and backend.

### Phase 2: Surface migration
- Move /profile and /passport to PPP payload.
- Remove duplicated per-view scoring transforms.

### Phase 3: Portable claims
- Emit claim attestations and disclosure-pack endpoint.
- Add signed export payload for third-party consumption.

### Phase 4: Ecosystem utility
- Add verifier SDK snippet and minimal docs for partners.
- Add embeddable public passport card and verification badge.

## Concrete File Touch Targets

Backend (new/updated)
- app/services/portable_passport_service.py (new)
- app/api/routes/passport_portable.py (new)
- app/api/risk_profile.py (adapt to use PPP internals)
- app/services/profile_decision_service.py (claim formatting)

Frontend (new/updated)
- src/hooks/usePortablePassport.ts (new)
- src/lib/passport/portable.ts (new canonical types)
- src/app/profile/page.tsx (read PPP)
- src/app/passport/page.tsx (read PPP)
- existing passport widgets to consume normalized claim fields

ReceiptOS / docs
- receiptos/docs/portable-passport-v1/*
- partner verification examples

## Success Metrics
- One score/tier identity across /profile, /passport, and action surfaces.
- 0 route-specific score drift bugs.
- Exportable disclosure pack consumed by at least one external verifier.
- Increased completion and share rates for public passport card.

## Immediate Next Build Slice (recommended)
1. Implement portable_passport_service aggregator only.
2. Add GET /api/v1/passport/portable/{address}.
3. Switch /profile to this endpoint first.
4. Backfill /passport from same endpoint.
