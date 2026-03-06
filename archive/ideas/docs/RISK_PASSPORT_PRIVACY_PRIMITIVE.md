# Risk Passport as a Privacy-Focused Primitive

**Date:** 2026-03-02  
**Purpose:** Research and design for making the Risk Passport (and credit scores) a **privacy-focused, composable primitive**: transparent aggregation, Starknet explorer links for proofs, and selective disclosure so the passport can be shared without leaking identity or full history.

Related: [RISK_PASSPORT_PRODUCT_SCOPE.md](RISK_PASSPORT_PRODUCT_SCOPE.md), [SRC_8004_ALIGNMENT.md](SRC_8004_ALIGNMENT.md), [plans/2026-03-02-profile-unified-vision.md](plans/2026-03-02-profile-unified-vision.md).

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Explorer links for proofs** | Every proof receipt that has a `tx_hash` or on-chain commitment should link to Starknet explorer (Starkscan/Voyager). Optionally link `fact_hash` to Obsqra fact registry or equivalent. |
| **Transparent aggregation** | Make it clear **where** the passport aggregated its data: which APIs, which chains/contracts, without revealing user identity or full history. Enables verifiability and composability. |
| **Selective disclosure** | Allow sharing a **minimal attestation** (e.g. "letter >= B", "composite >= 60", "credit_tier present") or a **source attestation** without exposing full proof payload or address. Makes the Risk Passport composable across protocols and UIs. |
| **Privacy-first primitive** | The passport should be usable as a trust primitive: other contracts or UIs can consume "this user meets threshold X" or "this passport was built from sources Y" without learning more than necessary. |

---

## 2. Current state

### 2.1 Risk Passport API

- **Endpoint:** `GET /api/v1/zkdefi/risk_passport/user/{address}`
- **Response:** `composite_score`, `letter_rating`, `tier`, `tier_name`, `credit_tier`, `credit_score`, `proof_receipts[]`.
- **Aggregation (implicit):** Backend composes: (1) Reputation, (2) Credit via onboarding/identity, (3) Proof receipts from ReceiptService. Response does not expose which sources were used, chain, or fact_hash links.

### 2.2 Proof receipts

- **Fields:** `receipt_id`, `user`, `proof_type`, `threshold_or_model`, `result`, `timestamp`, `snapshot_hash`, `tx_hash`, `fact_hash`, `model_hash`, `pool_id`, `on_chain`.
- **Frontend:** ProofTimeline shows tx link via ExplorerLink (Starkscan Sepolia). No link for fact_hash; no chain selector; no source per receipt.

### 2.3 Selective disclosure today

- CompliancePanel productized disclosure types; full privacy balance_above / pool_membership. ERC-8004 portable identity shape exists but no minimal "shareable attestation" for the Risk Passport itself.

---

## 3. Research: privacy-focused reputation primitives

- **ZK reputation:** Prove "score >= X" or "tier >= B" without revealing full score or history (e.g. zkCreditScore-style tiers).
- **W3C Verifiable Credentials:** Attestations with selective disclosure and embedded proofs; composable across systems.
- **ERC-8004 / SRC-8004:** Identity + Reputation + Validation registries; Risk Passport as read model aggregating from these and receipts.
- **Transparency without identity:** Source attestation = list of source types (reputation, identity, proof_receipts) and optional chain/contract hints; no user address or full history.

---

## 4. Design

### 4.1 Backend: aggregation_sources and receipt metadata

**Risk Passport response** — add:

- `aggregation_sources`: list of `{ id, description, chain?, contract_hint? }` (e.g. reputation, identity, proof_receipts).
- `chain_id`: so frontend can build correct explorer URLs (Sepolia vs mainnet).

**Receipts** — optional `chain_id` or `explorer_base` per receipt; optional `fact_registry_url` (env) for fact_hash links. ReceiptService can enrich with `explorer_tx_url` or leave to frontend using chain_id.

### 4.2 Frontend: explorer links and sources

- **ProofTimeline:** Chain-aware tx link (Sepolia vs mainnet from passport/receipt). Add "View fact" link when fact_hash + fact_registry base URL present.
- **Risk Passport card:** "Data sources" / "Aggregation" section from `aggregation_sources` when present.

### 4.3 Selective disclosure: shareable attestation

Minimal attestation: letter_rating >= X, composite_score >= N, credit_tier present, source list. Options: (1) API `GET /risk_passport/user/{address}/attestation?letter_min=B&composite_min=60` returning attestation payload; (2) Frontend "Export attestation" button building JSON with letter, composite, credit_tier, aggregation_sources, chain_id. Makes passport composable for other apps/contracts.

### 4.4 Privacy properties

- aggregation_sources: no identity; only what was used and optional chain/contract.
- Explorer links (tx_hash): public on-chain; no extra leakage.
- Fact link: reveals fact exists, not underlying data.
- Selective attestation: only thresholds and source list; no address or full receipts.

---

## 5. Implementation checklist

- [ ] Backend risk_passport: add aggregation_sources and chain_id to GET user passport.
- [ ] Backend receipt: optional chain_id in append/response; optional fact_registry_base_url from config.
- [ ] Frontend explorer: chain-aware base (Sepolia vs mainnet); use in ProofTimeline and ExplorerLink.
- [ ] ProofTimeline: chain from passport/receipt; fact_hash link when fact_registry URL configured.
- [ ] Risk Passport card: show Data sources from aggregation_sources.
- [ ] Optional: attestation API or frontend Export attestation.
- [ ] Docs: update RISK_PASSPORT_PRODUCT_SCOPE and SRC_8004_ALIGNMENT to reference this primitive.

---

## 6. References

- RISK_PASSPORT_PRODUCT_SCOPE.md, SRC_8004_ALIGNMENT.md, GATING_FROM_PROFILE.md, plans/2026-03-02-profile-unified-vision.md.
- External: ZK reputation (zkCreditScore, zkLoans), W3C Verifiable Credentials, ERC-8004.
