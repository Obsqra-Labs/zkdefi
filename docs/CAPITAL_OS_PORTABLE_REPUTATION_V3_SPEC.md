# Capital OS Portable Reputation & Identity V3 Spec

Date: 2026-03-08
Owner: Capital OS / Trust Platform
Status: Draft for implementation

## 1) Objective

Build a portable reputation and identity system that can:
- prove cross-chain protocol attributions (`did X on network Y/protocol Z`),
- unify wallet binding and verification into one guided flow,
- separate trust domains (`reputation`, `credit`, `governance`) with explicit policy boundaries,
- export selective disclosure credentials that third-party protocols can consume safely.

This spec extends existing V2 contracts without breaking current consumers.

## 2) Scope

In scope:
- new additive APIs for identity graph, attributions, claims, and credentials,
- unified binding UX workflow for `/profile`,
- policy-driven disclosure packs,
- adapters for Trade Desk / Intelligence Stream / Agent Builder consumption.

Out of scope:
- replacing current `/api/v1/zkdefi/risk_profile/*` routes,
- destructive schema changes,
- coupling to any single identity vendor implementation.

## 3) Current Baseline (V2)

Existing foundations to preserve:
- `GET /api/v1/zkdefi/risk_profile/{address}`
- `GET /api/v1/zkdefi/risk_profile/v2/{address}`
- linked address verify flow:
  - `POST /api/v1/zkdefi/linked_addresses/verify/start`
  - `POST /api/v1/zkdefi/linked_addresses/verify/complete`
- session authority lifecycle:
  - `POST /api/v1/zkdefi/session_keys/grant`
  - `POST /api/v1/zkdefi/session_keys/grant/confirm`
  - `POST /api/v1/zkdefi/session_keys/revoke`
  - `POST /api/v1/zkdefi/session_keys/revoke/confirm`
  - `GET /api/v1/zkdefi/session_keys/list/{owner}`
- profile explainability:
  - `GET /api/v1/zkdefi/profile/snapshot/{address}`
  - `GET /api/v1/zkdefi/profile/diff/{address}`

## 4) V3 Architecture

### 4.1 Identity Graph

Canonical subject = Starknet root identity.

Identity graph model:
- root subject (`starknet_address`, `identity_commitment`),
- linked identities (`chain`, `address`, `verification_method`, `verified`, `verified_at`, `confidence`),
- session capabilities (`session_id`, `scope`, `expires_at`, `revoked_at`),
- optional naming/profile pointers (`starkid_name`, metadata pointers).

### 4.2 Attribution Verifier

Produces normalized attribution records from chain/protocol adapters:
- `chain`: `starknet|ethereum|arbitrum|base|optimism|...`
- `protocol_id`: canonical protocol key (for example `ekubo`, `uniswap_v3`, `aave_v3`)
- `action_type`: `swap|lp_add|lp_remove|borrow|repay|stake|vote|...`
- `evidence`: tx hash, block number, contract, timestamp
- `confidence`: deterministic confidence score from parser/proof method

### 4.3 Claim Registry

Derives domain claims from attributions and local signals.

Examples:
- Reputation claims:
  - `rep.activity.swap_count_30d`
  - `rep.consistency.active_days_90d`
- Credit claims:
  - `credit.repay_streak_180d`
  - `credit.liquidation_events_365d`
- Governance claims:
  - `gov.voting_participation_180d`
  - `gov.delegated_power_current`

### 4.4 Credential Gateway

Issues signed, selective disclosure packs:
- compact policy-bound credentials for protocol integrations,
- revocable, time-bounded, versioned,
- compatible with current `erc8004` export path.

### 4.5 Trust Domain Policy Engine

Strict separation:
- `reputation` policies cannot infer lending terms,
- `credit` policies cannot silently grant governance weight,
- `governance` policies only control voting influence.

## 5) Unified Binding UX (Profile V3)

Single guided flow in `/profile`:

1. `Connect Root Identity`
- connect Starknet root
- validate root session

2. `Link Wallets`
- add EVM and other chain addresses
- auto-detect chain format

3. `Prove Ownership`
- challenge generation
- signature completion
- verification status with timestamps

4. `Sync Attributions`
- fetch protocol activity by chain
- display parsed attribution counts and evidence health

5. `Publish Claims`
- choose disclosure template (`execution`, `lending`, `governance`, `custom`)
- preview exactly which claims are disclosed
- issue credential pack

6. `Bind Execution Session`
- scope session permissions (protocols, limits, duration)
- persist and show revocation controls

## 6) Additive API Contract (V3)

All routes under `/api/v1/zkdefi` and additive only.

### 6.1 Identity Graph

`GET /identity/graph/{subject}`

Response shape:
```json
{
  "subject": "0x...",
  "identity_commitment": "0x...",
  "links": [
    {
      "chain": "ethereum",
      "address": "0x...",
      "verified": true,
      "verified_at": "2026-03-08T12:00:00Z",
      "verification_method": "eip191_signature",
      "confidence": 1.0
    }
  ],
  "sessions": [
    {
      "session_id": "0x...",
      "active": true,
      "scope": {
        "protocols": ["ekubo", "pools"],
        "max_position_wei": 100000000000000000
      },
      "expires_at": "2026-03-09T12:00:00Z"
    }
  ],
  "updated_at": "2026-03-08T12:00:00Z"
}
```

`POST /identity/graph/{subject}/link`

Request shape:
```json
{
  "chain": "arbitrum",
  "address": "0x...",
  "verification_ref": "nonce_id_or_proof_id"
}
```

### 6.2 Attributions

`POST /attributions/query`

Request shape:
```json
{
  "subject": "0x...",
  "window_days": 180,
  "filters": {
    "chains": ["starknet", "ethereum", "arbitrum"],
    "protocols": ["ekubo", "uniswap_v3", "aave_v3"],
    "actions": ["swap", "borrow", "repay"]
  },
  "include_evidence": true
}
```

Response shape:
```json
{
  "subject": "0x...",
  "summary": {
    "total_events": 428,
    "coverage_score": 0.93
  },
  "attributions": [
    {
      "id": "attr_01",
      "chain": "ethereum",
      "protocol_id": "uniswap_v3",
      "action_type": "swap",
      "timestamp": "2026-02-21T14:02:11Z",
      "confidence": 0.99,
      "evidence": {
        "tx_hash": "0x...",
        "block_number": 21900000,
        "contract": "0x..."
      }
    }
  ]
}
```

### 6.3 Claims

`POST /claims/derive`

Request shape:
```json
{
  "subject": "0x...",
  "domains": ["reputation", "credit", "governance"],
  "window_days": 365
}
```

Response shape:
```json
{
  "subject": "0x...",
  "claims_version": "3.0",
  "domains": {
    "reputation": {
      "rep.activity.swap_count_30d": 42,
      "rep.consistency.active_days_90d": 61
    },
    "credit": {
      "credit.repay_streak_180d": 17,
      "credit.liquidation_events_365d": 0
    },
    "governance": {
      "gov.voting_participation_180d": 12,
      "gov.delegated_power_current": 0.84
    }
  },
  "derived_at": "2026-03-08T12:00:00Z"
}
```

### 6.4 Credentials / Selective Disclosure

`POST /credentials/issue`

Request shape:
```json
{
  "subject": "0x...",
  "template": "lending",
  "claims": [
    "credit.repay_streak_180d",
    "credit.liquidation_events_365d",
    "identity.linked_verified_count"
  ],
  "audience": "protocol:aave_v3",
  "ttl_hours": 24
}
```

Response shape:
```json
{
  "credential_id": "cred_0x...",
  "subject": "0x...",
  "template": "lending",
  "audience": "protocol:aave_v3",
  "claims": {
    "credit.repay_streak_180d": 17,
    "credit.liquidation_events_365d": 0,
    "identity.linked_verified_count": 3
  },
  "issued_at": "2026-03-08T12:00:00Z",
  "expires_at": "2026-03-09T12:00:00Z",
  "signature": "0x...",
  "revocation_id": "rev_0x..."
}
```

`POST /credentials/verify`
`POST /credentials/revoke`
`GET /credentials/revocation/{revocation_id}`

### 6.5 Compatibility

- Keep `risk_profile/v2` as current canonical aggregate.
- Add optional `attribution_summary` and `credential_summary` blocks to `risk_profile/v2` (additive).
- Keep `risk_profile?format=erc8004`; extend with optional V3 claim references only.

## 7) Data Model (Additive)

New additive stores/tables:
- `identity_graph_nodes`
- `identity_graph_links`
- `attribution_events`
- `derived_claims`
- `issued_credentials`
- `credential_revocations`

Core fields:
- immutable ids (`id`, `subject`, `version`, timestamps),
- provenance (`source_chain`, `source_tx_hash`, parser/proof metadata),
- lifecycle (`issued_at`, `expires_at`, `revoked_at`).

## 8) Integration Contracts (Capital OS)

Read-only selectors for consumers:
- `getExecutionGate(subject)`
- `getLendingGate(subject)`
- `getGovernancePower(subject)`
- `getIdentityBindingStatus(subject)`
- `getDisclosureClaims(subject, template)`
- `getAttributionSummary(subject, filters)`

Usage boundaries:
- Trade Desk: execution + risk/safety claims only.
- Lending flows: credit-only claims and attestation references.
- Governance: governance-only claims and vote eligibility.
- Agent/Circuit builder: template-based minimum trust prerequisites.

## 9) Rollout Plan (Phased + Rollback)

### Phase 0: Contract Prep (internal)
- ship new routes behind flags.
- no frontend switch.

Flags:
- `PORTABLE_IDENTITY_V3_ENABLED` (backend)
- `NEXT_PUBLIC_PROFILE_V3_ENABLED` (frontend)

Rollback: disable flags.

### Phase 1: Identity Graph + Unified Binding
- introduce new profile wizard in shadow mode.
- keep existing V2 panels available.

Success criteria:
- wallet link completion rate >= V2 baseline,
- verification failure rate decreases.

Rollback: route UI back to V2 panels.

### Phase 2: Attribution Engine
- enable protocol attribution sync for selected chains/protocols.
- log parse confidence + evidence completeness.

Success criteria:
- attribution coverage >= 90% for supported protocols.

Rollback: hide attribution widgets; keep core identity flow.

### Phase 3: Claims + Credential Gateway
- enable selective disclosure templates (`execution`, `lending`, `governance`).
- integrate credential issue/verify/revoke APIs.

Success criteria:
- credential verification pass rate >= 99%,
- no trust-domain leakage across templates.

Rollback: disable issue/revoke endpoints via flag.

### Phase 4: Capital OS Surface Wiring
- Trade Desk, Intelligence Stream, Agent Builder consume V3 selectors.
- keep V2 selector fallback paths during transition.

Success criteria:
- no regression in conversion/engagement KPIs,
- policy decision latency within SLO.

Rollback: consumer adapters revert to V2 selectors.

### Phase 5: Default + Hardening
- V3 becomes default.
- V2 stays as compatibility mode for one deprecation window.

## 10) Testing Strategy

Backend:
- identity graph link/unlink/verify contract tests,
- attribution parser accuracy tests per protocol adapter,
- claims derivation determinism tests,
- credential sign/verify/revoke tests,
- restart persistence and migration tests.

Frontend:
- wizard progression + retry safety,
- partial API failure resilience,
- disclosure preview correctness.

E2E:
- bind wallets -> verify -> sync attributions -> issue credential -> verify at consumer endpoint.
- regression coverage for existing `/risk_profile/v2` clients.

## 11) Observability

Emit structured events:
- `identity_linked`, `identity_verified`, `identity_unlinked`,
- `attribution_synced`, `attribution_parse_failed`,
- `claims_derived`,
- `credential_issued`, `credential_verified`, `credential_revoked`,
- `policy_evaluation`.

Track:
- bind completion funnel,
- verification latency/failure rate,
- attribution coverage by chain/protocol,
- credential issuance + verification success rates.

## 12) Vendor/Protocol Integration Criteria (for Starknet identity options)

Evaluate providers (for example `stark.id`) against:
- cryptographic proof of ownership,
- revocation and update model,
- privacy-preserving selective disclosure support,
- compatibility with Starknet root identity model,
- latency and uptime,
- open standards alignment and export portability.

V3 remains vendor-agnostic via adapter interfaces:
- `IdentityResolverAdapter`
- `NameServiceAdapter`
- `CredentialSignerAdapter`

## 13) Immediate Build Order

1. Implement identity graph read/write + migration.
2. Add attribution query endpoint with one Starknet + one EVM protocol adapter.
3. Add claims derivation endpoint + schema registry.
4. Add credential issue/verify/revoke endpoints.
5. Ship unified profile wizard behind feature flag.
6. Wire adapter selectors into Capital OS surfaces with V2 fallback.
