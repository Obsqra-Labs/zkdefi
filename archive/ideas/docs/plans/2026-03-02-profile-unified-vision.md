# Profile Deep Dive: Unified Vision and Composable Risk Profile

**Date:** 2026-03-02  
**Purpose:** Product audit of [zkde.fi/profile](https://zkde.fi/profile), unification plan, and Risk Profile as a composable primitive aligned with ERC-8004 / SRC-8004.

---

## 1. Current state: tab and component audit

### 1.1 Tabs (four)

| Tab | URL | What it contains |
|-----|-----|------------------|
| **Trust & Identity** | `?tab=trust` | Portable Identity (ERC-8004) card, ProfileJourneyBanner, ProfileProtocolStatus, “No activity yet” banner, Stats grid (tier, age, txns, collateral), Risk Passport card, Credit Score card, Linked addresses, Onboarding & proofs, Tier Benefits grid, Tier Upgrade. |
| **Reputation** | `?tab=reputation` | Same Stats grid again, Stake Collateral block, same Tier Benefits grid again, same Tier Upgrade block again. |
| **Compliance** | `?tab=compliance` | CompliancePanel (selective disclosure), Compliance Profiles list, “Available Profile Types” (KYC, Risk, Performance, Portfolio), Pool Safety (link to Agent). |
| **Connections** | `?tab=connections` | Linked addresses (same form as Trust tab), Private Relayer (request form + pending relays) or “Relayer Access Locked”. |

### 1.2 Components (by tab)

**Trust & Identity (11 blocks):**

1. **Portable Identity (ERC-8004)** — Agent name, Reputation Score, Privacy Tier, Active Sessions, capabilities badges, attestations count. Fetched via `usePortableIdentity` → `getPortableIdentity()` (adapts passport + reputation + sessions + compliance).
2. **ProfileJourneyBanner** — Connect → Onboard → Build passport → Use protocol; next-step CTA.
3. **ProfileProtocolStatus** — 4 cells: Tier, Collateral, Relayer (Available/Locked), Upgrade (Eligible / message).
4. **No activity yet** — Shown when tenure_days, successful_txns, collateral all zero; explains where to start.
5. **Stats grid** — Access Tier, Account Age, Transactions, Collateral (same data as ProtocolStatus, different layout).
6. **Risk Passport** — Letter (A/B/C/D), composite score 0–100, tier, credit_tier; ProofTimeline (proof receipts); “Run proofs” CTA when empty.
7. **Credit Score** — AAA/AA/A/B/C, score 300–850, “ZK-Proven”; “Get Credit Tier” → onboarding.
8. **Linked addresses** — ETH/Arb/Base/Opt inputs, Save; “improves credit baseline”.
9. **Onboarding & proofs** — has_agent, identity_commitment, fact_hash; “Complete onboarding” CTA.
10. **Tier Benefits** — 3 cards (Strict, Standard, Express): proof mode, deposits/day, max position, relayer, fee.
11. **Tier Upgrade** — “Upgrade Tier” button or “X more txns for next tier”.

**Reputation:** Stats grid (duplicate), Stake Collateral, Tier Benefits (duplicate), Tier Upgrade (duplicate).

**Connections:** Linked addresses (duplicate), Relayer request form + Pending Relays.

**Compliance:** CompliancePanel, Compliance Profiles, Profile Types (static), Pool Safety (link out).

### 1.3 Data sources (scatter)

| Data | Source | Used in |
|------|--------|--------|
| User reputation | `GET /reputation/user/{address}` | Trust (ProtocolStatus, Stats, Journey, Upgrade), Reputation (Stats, Stake, Upgrade), Connections (relayer lock) |
| Tiers | `GET /reputation/tiers` | Trust (Tier Benefits), Reputation (Tier Benefits) |
| Risk passport | `GET /risk_passport/user/{address}` | Trust (Risk Passport card), Portable Identity adapter |
| Onboarding status | `GET /onboarding/status/{address}` | Trust (Onboarding card, Journey) |
| Credit tier | `GET /identity/...` (resolveCreditTier) | Trust (Credit Score card), Passport (credit_tier) |
| Linked addresses | GET/PUT `/linked_addresses` | Trust (Linked addresses), Connections (same form) |
| Portable identity | `getPortableIdentity()` (internal: passport + reputation + sessions + compliance) | Trust (Portable Identity card) |
| Pending relays | `GET /relayer/pending/{address}` | Connections |
| Compliance profiles | `GET /compliance/profiles/{address}` | Compliance tab |

No single “profile” or “risk profile” API. Each card pulls from one or more endpoints; Portable Identity is the only aggregation layer, and it’s front-end-only (erc8004 adapter).

---

## 2. Why it feels like “scatter” and “misses”

1. **No single artifact** — There is no one “Risk Profile” or “Identity Bundle” that the backend exposes. The UI composes many endpoints; ERC-8004 is an adapter over those. So “on-chain reputation solution” is implied by the sum of parts (ReputationRegistry, AgentIdentity, ValidationProofRegistry, risk_passport, onboarding, credit) but there is no **one** composable object that represents “this user’s risk profile” that other apps or contracts could consume.
2. **Duplication** — Stats grid, Tier Benefits, Tier Upgrade, Linked addresses appear in multiple tabs. Same data, repeated UI.
3. **Two “identities”** — Onboarding (constraints, fact_hash, identity_commitment) and Reputation (tier, tenure, collateral) are separate; only Risk Passport and Portable Identity merge them for **display**. Gating is split (ConstraintGate vs Relayer vs ExecutionGuard). So the “underlying onchain reputation solution” is not one thing; it’s several systems that are stitched in the UI.
4. **Journey vs actions** — Journey banner says “next step,” but the rest of Trust is a long vertical list of cards with no clear “do this next.” Reputation tab is “collateral + tier” again; Connections is “linked + relayer.” No single narrative: “You are here; this is your composable profile; here’s what you can do.”
5. **ERC-8004 / SRC-8004 not the spine** — We have SRC-8004 contracts (AgentIdentity, ReputationRegistry, ValidationProofRegistry) and an ERC-8004 **adapter** in the frontend, but the profile page is not organized around “one portable identity” as the primitive. The Portable Identity card is one block among many; it doesn’t drive the layout or the data model.

---

## 3. Holistic vision: Risk Profile as composable primitive

**Goal:** Treat **Risk Profile** as the single composable artifact that backs both the profile UI and on-chain reputation. Align it with ERC-8004 / SRC-8004 so it can be consumed by us, other UIs, and eventually other protocols.

### 3.1 What “Risk Profile” should be (one object)

A **Risk Profile** is the composable primitive that represents “who this user is and what they can do” in a proof-backed, privacy-aware way. It should:

- **Aggregate** in one place: tier, tenure, collateral, proof receipts, credit tier, onboarding state, linked-address baseline, compliance summaries, session summary.
- **Be exportable** as:
  - **ERC-8004 portable identity** (identity_card + reputation + validations + session_summary + disclosure_summary) for cross-app portability.
  - **SRC-8004** on-chain: ReputationRegistry, ValidationProofRegistry, AgentIdentity — so the same object has an on-chain projection.
- **Drive gating** from one place: tier for relayer, onboarding + constraints for execution, proof receipts for “why did this execute?” So the Risk Profile is the **source of truth** for “what is this user allowed to do?” not a side effect of many separate checks.
- **Be the single API** for the profile page: one `GET /risk_profile/{address}` (or `GET /identity/bundle/{address}`) that returns the full composable object; the UI only renders that object, no parallel fetches for reputation, passport, onboarding, credit, linked, compliance.

### 3.2 Adapting the “8004 standard”

- **ERC-8004** (EVM): Identity + Reputation + Validation registries; agent card; bounded scores.
- **SRC-8004** (our Starknet): AgentIdentity, ReputationRegistry, ValidationProofRegistry; ZK credit tier; proof-gated execution.

**Unification:** The **Risk Profile** is the **canonical bundle** that:

1. **Backend** builds from: reputation user, risk_passport (composite + receipts), onboarding status, identity/credit, linked addresses, compliance profiles, session summary. One service or route that composes these and returns a single JSON (and optionally an ERC-8004-shaped projection).
2. **Frontend** consumes once: Profile page (and Agent header/sidebar) call `GET /risk_profile/{address}` (or `/identity/bundle`) and derive all tabs from that object. No separate useProfileReputation, useRiskPassport, useOnboardingStatus, useLinkedAddresses, etc. for the same address on the same page.
3. **On-chain** reflects the same object: where we already write to ReputationRegistry / ValidationProofRegistry / AgentIdentity, those writes are driven from the same Risk Profile (tier, proofs, credit). So “one artifact” in the backend, one on-chain projection, one UI consumption.

### 3.3 Profile page: unified structure

**One narrative, one data source:**

- **Hero / summary** — One “Risk Profile” card at the top: portrait (letter rating, composite score, tier, credit tier, active sessions). This is the composable artifact; everything else is detail or actions.
- **Tabs as “slices” of the same object** — Not “different data per tab,” but “same Risk Profile, different view”:
  - **Identity** — Portable Identity (ERC-8004) view of the profile; attestations; capabilities; “Export” or “Use in another app.”
  - **Reputation** — Tier, collateral, tenure, txns; stake collateral; upgrade path. All from the same profile.
  - **Proofs & compliance** — Proof timeline (receipts from profile); compliance profiles; selective disclosure (CompliancePanel). One place for “what have I proven?”
  - **Connections** — Linked addresses, relayer (pending, request). Still part of profile; no duplicate linked-address form.

**Remove duplication:** Stats grid, Tier Benefits, Tier Upgrade, Linked addresses appear **once** each, in the tab that fits best (e.g. Stats in Reputation; Tier Benefits in Reputation or as a modal; Linked addresses only in Connections). Journey banner stays; “No activity yet” once.

**Deep links:** `?tab=trust|reputation|compliance|connections` already exist; ensure they map to the single-data views above.

---

## 4. Concrete steps (prioritized)

| # | What | Outcome |
|---|------|--------|
| 1 | **Backend: Risk Profile bundle endpoint** | `GET /api/v1/zkdefi/risk_profile/{address}` (or `/identity/bundle/{address}`) that composes: reputation user, risk_passport, onboarding status, credit tier, linked addresses, compliance summary, session summary. Returns one JSON. Optional query `?format=erc8004` for portable-identity shape. |
| 2 | **Frontend: single profile hook** | e.g. `useRiskProfile(address)` that fetches the bundle once; expose slices (reputation, passport, onboarding, credit, linked, compliance, sessions). Profile page and Agent (if needed) use this instead of 6+ separate hooks. |
| 3 | **Profile page: one summary card** | Top of page: one “Risk Profile” summary (letter, score, tier, credit, sessions). Tabs below = same data, different slice. Remove duplicate Stats/Tier Benefits/Tier Upgrade/Linked blocks. |
| 4 | **ERC-8004 as view, not adapter** | Portable Identity becomes the “Identity” tab view of the same bundle (backend can return erc8004 shape, or frontend derives from bundle). No separate getPortableIdentity() that re-fetches passport + reputation + sessions + compliance. |
| 5 | **Gating from profile** | Document (and optionally implement) that ExecutionGuard / ConstraintGate / Relayer all take “tier, onboarding, proof_receipts” from the same Risk Profile or from the same backend service that builds the profile. So one source of truth for “can this user do X?” |
| 6 | **SRC-8004 alignment** | Ensure ReputationRegistry, ValidationProofRegistry, AgentIdentity writes are driven by the same Risk Profile (e.g. after onboarding, after proof, after tier upgrade). So the composable artifact and the on-chain registries stay in sync. |

**Step 5 (Gating):** See [GATING_FROM_PROFILE.md](../GATING_FROM_PROFILE.md) for the doc and optional tier-from–risk-profile in Relayer.

---

## 5. Onboarding and profile: mutual alignment

Profile should be **mindful of onboarding**, and onboarding can be **changed to support the new profile flow**. Both directions matter.

### 5.1 How onboarding fits into the Risk Profile

**Today:**

- Onboarding is a **separate flow** (Agent page: OnboardingWizard, 7 steps — Connect, Configure, Claims, Authorize, Review, Submit, Complete). It produces: `fact_hash`, `identity_commitment`, `agent_initialized`, `pending_constraints` (max_position, risk_tolerance, session_duration, claims). Stored in backend `onboarding_state.json`; ConstraintGate and vault_policy_service read it for gating.
- Profile **consumes** onboarding only via `GET /onboarding/status/{address}`: it shows “Complete onboarding” when `!has_agent`, passes `hasOnboarded` to ProfileJourneyBanner, and has a dedicated “Onboarding & proofs” card with fact_hash/identity_commitment. So profile is “aware” of onboarding but onboarding is not framed as “building your Risk Profile”; it’s one card among many and a step in the journey.

**In the unified model:**

- **Onboarding is the identity/constraint source** for the Risk Profile. The Risk Profile **aggregates** onboarding state (has_agent, fact_hash, identity_commitment, constraints summary) together with reputation, passport, credit, linked addresses, compliance, sessions. So onboarding is not a separate “thing” the profile displays — it’s a **slice** of the single artifact. When the backend builds the Risk Profile bundle, it includes onboarding from the same source (onboarding_state + on-chain constraints) that ConstraintGate uses.
- **Journey stays:** Connect → **Onboard** → Build passport → Use protocol. “Onboard” means “complete onboarding”; that step **creates** the identity and constraints that later appear in the Risk Profile. So profile is mindful of onboarding by (1) making “Onboard” the second step in the journey, (2) showing one summary card that reflects onboarding state as part of the profile, and (3) driving all gating (including ConstraintGate) from the same profile/onboarding data.

### 5.2 Profile mindful of onboarding (concrete)

- **When not onboarded:** The profile hero or journey banner should make “Complete onboarding” the primary next step — not buried in the middle of the page. The Risk Profile summary card can show a minimal state: “No identity yet — complete onboarding to build your Risk Profile.” No need to show empty tier/passport/credit until the user has at least completed onboarding (or show them as “—” with tooltip “Complete onboarding first”).
- **When onboarded:** The Risk Profile summary includes “Identity: verified” (or similar) and the onboarding slice (constraints summary, fact_hash for power users). The “Onboarding & proofs” card becomes **“Identity & constraints”** — one section of the profile that shows what onboarding produced, with a link to “Re-run onboarding” or “Update constraints” if we support that later. So onboarding is not a separate concept; it’s “how your identity and constraints were set,” visible as part of the single profile.
- **Single source:** Once `GET /risk_profile/{address}` exists, it includes `onboarding: { has_agent, fact_hash, identity_commitment, constraints_summary }`. Profile page uses that; no separate `useOnboardingStatus` for the same address. Journey banner and “Identity & constraints” block both read from the same Risk Profile object.

### 5.3 Onboarding changed to support the new profile flow

So that onboarding and profile feel like one story, onboarding can be adapted as follows:

| Change | Description |
|--------|-------------|
| **Entry from Profile** | Profile is the natural “who I am” place. “Complete onboarding” and “Get Credit Tier” should link to the onboarding flow (e.g. `/agent?tab=onboarding` or a dedicated `/onboarding` route). Keep Agent as alternative entry; add or emphasize entry from Profile (e.g. “Build your Risk Profile” CTA on Profile when not onboarded). |
| **Copy: “Building your Risk Profile”** | In the OnboardingWizard, frame steps as building your **Risk Profile**: e.g. “Step 2: Configure — set constraints that will appear on your Risk Profile,” “Step 5: Authorize — generate the proof that backs your profile.” Completion screen: “Your Risk Profile is ready” with a link to **Profile** (and optionally “Go to Agent” secondary). So the user understands that onboarding is the first step of “having a profile,” not a one-off setup. |
| **Optional: redirect to Profile on complete** | After the user completes onboarding (Submit + Complete), offer “View your Risk Profile” as primary CTA and redirect to `/profile` (or open in new tab). Agent remains available; Profile becomes the place to see the result of onboarding (identity, constraints, and later passport/reputation as they build). |
| **Backend: onboarding inside Risk Profile bundle** | The Risk Profile bundle endpoint composes onboarding state (from `onboarding_state.json` + on-chain `get_constraints`) so that the profile page never needs a separate onboarding fetch. When onboarding completes, the next load of the profile already shows the new identity and constraints. Optionally: after `submit_agent`, backend could trigger a reputation seed or a “profile_initialized” event so that the first Risk Profile fetch after onboarding is consistent. |
| **Optional: onboarding “progress” on Profile** | If we ever support partial onboarding (e.g. configured but not yet proved), Profile could show “Onboarding: 2 of 4 steps” and a single CTA to continue, instead of only “Complete onboarding.” For now, binary has_agent is enough; the journey banner already shows “Onboard” as the next step until done. |

### 5.4 Single narrative

- **Connect** (wallet) → **Onboard** (constraints + proof + agent init) → **Build passport** (run proofs, get letter) → **Use protocol** (relayer, execute).
- Onboarding is the **gate** for “you have an identity and constraints.” The Risk Profile is the **artifact** that contains that identity and constraints plus reputation, passport, credit, linked addresses, compliance, and sessions. Profile is mindful of onboarding by putting it at the top of the journey and by making the Risk Profile summary reflect onboarding state. Onboarding supports the profile flow by framing itself as “building your Risk Profile,” surfacing entry from Profile, and (optionally) redirecting to Profile on completion so the user sees their composable profile as the outcome.

---

## 6. Summary

- **Today:** Profile is many components and many endpoints; no single “risk profile” object; duplication across tabs; ERC-8004 is a front-end adapter; the “on-chain reputation solution” is multiple systems stitched in the UI. Onboarding is a separate wizard; profile shows its status in one card and in the journey.
- **Vision:** **Risk Profile** = one composable primitive (backend bundle + optional ERC-8004/SRC-8004 projection). One API, one hook, one summary card; tabs are views over that object. Gating and on-chain registries consume the same artifact. **Onboarding** is the identity/constraint source for that profile; profile is mindful of onboarding (journey, hero, single artifact); onboarding is reframed as “building your Risk Profile” with entry from Profile and optional redirect to Profile on complete.

**References:** [RISK_PASSPORT_PRODUCT_SCOPE.md](../RISK_PASSPORT_PRODUCT_SCOPE.md), [SRC_8004_ALIGNMENT.md](../SRC_8004_ALIGNMENT.md), [PROFILE_REFACTOR_PLAN.md](../PROFILE_REFACTOR_PLAN.md), [plans/2026-03-01-reputation-credit-system-design.md](2026-03-01-reputation-credit-system-design.md).
