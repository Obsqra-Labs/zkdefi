# ZK Lending: Cross-Chain Credit, Attestations, and Reputation-Driven Scope

**Date:** 2026-03-02  
**Purpose:** Scope only — no implementation. Define a **reputation-driven, privacy-first ZK lending** experience: cross-chain credit, attestations, session keys, smart wallets, DIDs (e.g. Stark ID), and how **collateral + reputation** mix. The **lending surface** lives in the main app (Agent); the **guts** (eligibility, credit line, attestations) live in **Profile**.

Related: [RISK_PASSPORT_PRIVACY_PRIMITIVE.md](../RISK_PASSPORT_PRIVACY_PRIMITIVE.md), [SRC_8004_ALIGNMENT.md](../SRC_8004_ALIGNMENT.md), [plans/2026-03-01-reputation-credit-system-design.md](2026-03-01-reputation-credit-system-design.md), [plans/2026-03-02-profile-unified-vision.md](2026-03-02-profile-unified-vision.md).

---

## 1. Vision in one sentence

**A simple, privacy-first ZK lending protocol where credit lines and rates are driven by the user’s Risk Profile (reputation + collateral + attestations), exposed as a Lending tab in the main app, with cross-chain credit and attestations so the same “credit identity” can be used across Starknet and eventually other chains.**

---

## 2. Why cross-chain credit and attestations

Today we already have:

- **Risk Profile** — reputation (tier, tenure, volume, collateral), Risk Passport (composite, letter, credit_tier), onboarding (identity_commitment, fact_hash), linked_addresses (ETH, Arb, Base, Opt), compliance summaries.
- **Cross-chain baseline** — reputation can be seeded from Starknet + linked chains (Etherscan, Arbiscan, Basescan) for tenure and tx count; RISC Zero credit uses cross-chain history inside zkVM and outputs only tier/score.
- **Identity commitment** — Poseidon(starknet, eth, arb, base, opt, salt) for Sybil resistance without exposing the mapping.

To make this a **cross-chain credit system** we need:

- **Portable attestations** — Verifiable statements (“letter ≥ B”, “composite ≥ 60”, “credit_tier = AA”, “collateral ≥ X”) that can be consumed by our lending contract and, later, by other protocols or chains. Stored or verifiable on Starknet (e.g. ValidationProofRegistry, fact registry) and optionally bridged or re-attested elsewhere.
- **Attestation format** — Issuer (us), subject (commitment or address), claim (e.g. credit_line_cap, tier), proof or signature, timestamp. Align with W3C Verifiable Credentials or EAS-like semantics so other systems can understand “this is a credit attestation from zkde.fi”.
- **Privacy** — Attestations reveal only what’s needed (e.g. “eligible for tier-2 unsecured line”); full Risk Profile stays in Profile and is not shared. Selective disclosure (already in RISK_PASSPORT_PRIVACY_PRIMITIVE) is the primitive: attestations are the productized output.

---

## 3. Session keys, smart wallets, and DIDs

### 3.1 Session keys (already in app)

We already have:

- **SessionKeyManager** — User grants a session key with constraints: max_position, allowed_protocols (pools, ekubo, jediswap), duration. Agent can execute proof-gated actions within those bounds without per-tx signatures.
- **Proof-gating** — Execution requires valid proof (constraints, risk, etc.); session key does not bypass proof verification.

**Role in lending:**

- **Borrow/repay by agent** — User could grant a session key scoped to “lending only” (e.g. allowed_protocols includes a lending module): agent can service the loan (repay, top-up collateral) within limits without the user signing every tx. Repayment and on-time behavior then feed back into reputation (same as “reputation reflects usage” in reputation-credit-system-design).
- **No new session-key type required for MVP** — Either extend protocol bitmap for “lending” or treat lending as a constrained strategy the agent can execute (rebalance-style) so existing session + proof-gate applies.

### 3.2 Smart wallets on Starknet

Starknet has **native account abstraction**: every account is a smart contract. We already assume AA (ArgentX, Braavos, etc.) for:

- Granting session keys (user signs once; contract stores session config).
- Proof-gated execution (contract checks proof then executes).

**For lending:**

- **Borrower** = same AA account; no “special” wallet. Collateral can be held in the same account or in our vault/ledger; repayment from the same account.
- **Lending contract** — Can validate attestations (e.g. from ValidationProofRegistry or our fact registry) and enforce terms (LTV, liquidation) in contract logic. Session key can be the caller for “agent repays on my behalf” flows.

No additional smart-wallet research is required for scope; we stay within existing AA + session keys.

### 3.3 DIDs and Stark ID

**Starknet ID** — Decentralized identity on Starknet: .stark names, Identity NFT, verifiable profile (social, personhood). Used by many Starknet dApps for human-readable identity.

**How we can use it (optional, later):**

- **Link identity_commitment ↔ Stark ID** — Attest “this commitment is bound to .stark name X” so that (a) users can show a human-readable identity in lending/partner UIs, and (b) partners can trust “this .stark has a Risk Passport from zkde.fi” without us exposing the raw commitment in the clear. Privacy: we still only disclose attestations (e.g. “letter ≥ B”); the link commitment ↔ .stark can be off-chain or in a ZK statement.
- **Attestations for Stark ID** — Issue attestations that reference “subject = Stark ID” (or commitment derived from it) so that Starknet ID–integrated apps can display “this user has credit tier AA at zkde.fi” without calling our backend. Composable: Stark ID becomes the portable “face” of identity; our Risk Profile remains the source of truth for credit.

**Scope:** Design so that (1) attestations can optionally carry a “Stark ID” or “external DID” field for composability, and (2) Profile could later add “Link Stark ID” and store a binding (commitment ↔ stark_id) for attestation issuance. Not required for MVP lending.

---

## 4. Collateral + reputation mix (simple model)

**Idea:** Credit line = f(collateral, reputation). Pure overcollateralized lending = 100% collateral. As reputation increases (tier, letter, credit_tier), we allow an **uncollateralized (or undercollateralized) slice** of the line.

**Simple formula (illustrative):**

- **Base line (collateral-only):** `credit_line_collateral = collateral_value * LTV_max` (e.g. 80% LTV).
- **Reputation uplift:** `credit_line_uncollateralized = f(tier, letter, credit_tier)` — e.g. tier 2 + letter A + credit_tier AA → “20% of total line can be unsecured,” capped at a max (e.g. 5 ETH equivalent).
- **Total credit line:** `min(collateral_line + unsecured_line, global_cap)`.

**Privacy:**

- **Collateral** — User proves “my collateral ≥ X” via existing **selective disclosure** (balance_above, or vault balance commitment) without revealing exact balance. Lending contract or our backend sees only “eligible” or a range.
- **Reputation** — User proves “my letter ≥ B and tier ≥ Standard” via **Risk Passport attestation** (selective disclosure); we don’t send full passport to the contract, only an attestation payload or proof the contract verifies.
- **Rates** — Can be tiered by risk band (e.g. better rate for letter A or credit_tier AA); rate logic can live in contract or in our relayer/oracle that the contract trusts.

**Where the guts live:** Profile (Risk Profile API) holds reputation, passport, collateral summary, and linked addresses. A **credit-line service** (or contract view) consumes Profile + collateral data and issues **attestations** (e.g. “credit_line_cap = Y”, “unsecured_cap = Z”). The **Lending tab** only reads: “your line is X”, “you can borrow Y”, “rate Z”; it does not compute reputation or attestations itself — it calls an API or contract that was fed by Profile.

---

## 5. Simple ZK lending protocol (product scope)

**Emphasis: privacy-first, reputation-driven, minimal surface.**

### 5.1 In scope (conceptual)

| Area | Scope |
|------|--------|
| **Product** | Single market or single asset pair (e.g. ETH or USDC supply/borrow). No multi-asset baskets or complex oracles in v1. |
| **Eligibility** | Driven by Risk Profile: tier, letter, credit_tier, collateral. Credit line = collateral-based + reputation-based unsecured slice (formula above). |
| **Privacy** | (1) Prove eligibility via attestations (no full passport on-chain). (2) Optional: confidential borrow/supply amounts (commitments + ZK proofs) so positions are not fully public. (3) Repayment history can update reputation without exposing individual tx details. |
| **Attestations** | Issued from Profile/backend when user qualifies; stored or verifiable on Starknet (ValidationProofRegistry or fact registry). Contract or relayer checks attestation before opening/increasing line. |
| **Session keys** | Agent can repay or adjust collateral within session bounds (extend protocol bitmap or strategy scope). Repayment behavior feeds reputation. |
| **Lending tab** | New surface in the main app (Agent): “Lend” or “Borrow” tab. Shows: my credit line, my supply/borrow positions, rates, borrow/repay/supply actions. All eligibility and limits come from Profile; tab is read-only on “why do I have this line?” (link to Profile). |
| **Profile as guts** | Profile holds: Risk Profile bundle, attestation issuance (or triggers), “Build your credit” (onboarding, linked addresses, collateral, proofs). Lending tab shows “Based on your Profile” and deep-links to Profile for improving line (e.g. stake collateral, complete onboarding, get credit tier). |

### 5.2 Out of scope (for this scope doc)

- Full undercollateralized lending without any collateral (we always have at least a collateral-based slice or a clear “unsecured cap” from reputation).
- Complex liquidations (e.g. auction, multiple assets). v1 can be “soft” (relayer/oracle marks position at risk; user tops up or repays) or a single-asset liquidation path.
- Cross-chain borrowing (borrow on Starknet against ETH chain collateral) — future phase; attestations and portable reputation set the foundation.
- Full Stark ID integration — optional later; attestation format should allow DID/Stark ID as subject.
- Implementation details (contract interfaces, API routes, frontend components) — this doc is scope only.

---

## 6. Where things live: Lending tab vs Profile

| What | Where | Why |
|------|--------|-----|
| **Credit line, rates, borrow/supply UI** | **Lending tab** (main app / Agent) | User-facing product: “I want to borrow/supply.” |
| **Eligibility, credit line formula, attestation issuance** | **Profile (backend + Risk Profile)** | Single source of truth for identity, reputation, collateral; attestations are derived from Profile. |
| **“Why is my line X?” / “How do I get a better line?”** | **Profile** | User improves tier, letter, credit_tier, collateral in Profile; lending tab only reflects the result. |
| **Session key for “agent repays”** | **Agent (session key manager)** | Same session key flow; lending is one allowed “protocol” or strategy. |
| **Attestation verification** | **Starknet (contract or relayer)** | Contract or relayer verifies attestation before granting/increasing line; attestation issued from our backend from Profile data. |
| **Stark ID / DID binding** | **Profile (future)** | Optional: link commitment to .stark; attestations can reference Stark ID for composability. |

---

## 7. Attestation flow (conceptual)

1. **User** has a Risk Profile (reputation, passport, collateral) — all in Profile.
2. **Backend / credit service** (part of Profile or called by it) computes: credit_line_collateral, credit_line_uncollateralized, total_line, rate_band. If user meets minimum (e.g. tier ≥ Strict, some collateral or reputation), **issue attestation**: e.g. “credit_line_cap = Y”, “unsecured_cap = Z”, “expiry = T”, signed or committed.
3. **Attestation** is stored or verified on Starknet (ValidationProofRegistry, or our fact registry, or a dedicated lending attestation contract). Optionally: attestation payload is ZK so that only “eligible” is revealed, not the exact line.
4. **Lending tab** (or lending contract): when user wants to borrow, contract (or our relayer) checks attestation and current utilization; allows borrow up to attested cap. Optional: confidential borrow amount (commitment) so that only user and contract know size.
5. **Repayment / behavior** — Repayments and on-time behavior are recorded (we already have receipt_service, reputation); they feed into future reputation and thus future attestations. Session key can perform repay on user’s behalf within limits.

---

## 8. Data flow summary

```
Profile (Risk Profile + collateral + onboarding)
    → Credit line service (formula: collateral + reputation)
    → Attestation issuance (signed / ZK)
    → On-chain or verifiable registry

Lending tab (Agent)
    → Reads: credit line, positions, rates (from contract or our API that uses attestation)
    → Actions: supply, borrow, repay (wallet or session key)
    → “Improve your line” → link to Profile

Session key (Agent)
    → Can be scoped to lending (repay, top-up collateral)
    → Repayment success → reputation update (Profile)
```

---

## 9. Phases (high level, no implementation)

| Phase | Focus |
|-------|--------|
| **1. Attestations from Profile** | Define attestation schema (credit line cap, unsecured cap, tier/letter, expiry); issue from backend from Risk Profile + collateral; store or verify on Starknet. No lending UI yet. |
| **2. Credit line formula** | Implement collateral + reputation mix (formula), expose via API or contract view; integrate with attestation issuance. Profile remains source of truth. |
| **3. Lending tab (MVP)** | Add Lending surface in Agent: display line, supply/borrow (single asset or pool), rates; all limits from attestation/Profile. Optional: confidential amounts. |
| **4. Session key for lending** | Extend session key to “lending” protocol/strategy; agent can repay or adjust within bounds; repayment → reputation. |
| **5. Cross-chain and DID** | Portable attestations for other protocols; optional Stark ID binding and attestations that reference .stark for composability. |

---

## 10. References

- **Session keys:** `docs-site/docs/session-keys.md`, `backend/app/services/session_key_service.py`, `contracts/src/session_key_manager.cairo`, `docs/AGENT_FLOW.md`.
- **Reputation and credit:** `docs/plans/2026-03-01-reputation-credit-system-design.md`, `docs/SRC_8004_ALIGNMENT.md`, `docs/REPUTATION_BASELINE.md`.
- **Risk Passport and attestations:** `docs/RISK_PASSPORT_PRIVACY_PRIMITIVE.md`, `docs/RISK_PASSPORT_PRODUCT_SCOPE.md`.
- **Profile as primitive:** `docs/plans/2026-03-02-profile-unified-vision.md`, `docs/GATING_FROM_PROFILE.md`.
- **External:** Starknet account abstraction (starknet.io), Starknet ID (starknet.id), ZK reputation/lending (zkCreditScore, zkLoans, ChainScore), portable reputation (EAS, Verax, Cred.Hub).
