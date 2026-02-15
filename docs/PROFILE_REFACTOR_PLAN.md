# Profile Section: Deep Evaluation and Refactor Plan

**Goal:** Refactor `/profile` into an onboarding-aware, protocol-aware, mission-aware section with clear primitives and a single narrative. Plan only; no implementation until approved.

---

## 1. Current State

### 1.1 Structure

- Single page: `frontend/src/app/profile/page.tsx` (~857 lines).
- Tabs: Overview | Collateral | Private Relayer | My Agents | Compliance.
- No URL state: active tab is React state only; no `?tab=` for deep links.

### 1.2 Data and APIs (all in one page)

- User reputation: `GET /api/v1/zkdefi/reputation/user/{address}` — Overview, Collateral, Relayer.
- Tiers: `GET /api/v1/zkdefi/reputation/tiers` — Tier Benefits.
- Pending relays: `GET /api/v1/zkdefi/relayer/pending/{address}` — Relayer tab.
- Credit tier: onboarding status then `GET identity/commitment/{id}` — Credit Score card.
- Compliance profiles: `GET /api/v1/zkdefi/compliance/profiles/{address}` — Compliance tab.
- Risk Passport: `GET /api/v1/zkdefi/risk_passport/user/{address}` — Risk Passport card.
- Onboarding status: `GET /api/v1/zkdefi/onboarding/status/{address}` — Onboarding card.
- Linked addresses: GET/PUT `linked_addresses` — Linked addresses card.
- Agents: inside MyAgents, `GET /api/v1/agents/user/{address}` — Agents tab.

All in separate useEffects; no shared cache with Agent page (which re-fetches tier, relayer).

### 1.3 Overview Tab (inline only)

Order: (1) No activity yet banner, (2) Stats grid (tier, age, txns, collateral), (3) Risk Passport card, (4) Credit Score card, (5) Linked addresses, (6) Onboarding and proofs, (7) Tier Benefits grid, (8) Tier Upgrade. No extracted components.

### 1.4 Other Tabs

- Collateral: inline stake form and slashing warning.
- Relayer: locked message or request form plus pending relays.
- Agents: MyAgents plus "Compose Custom Agents" link to `/agent?tab=models`.
- Compliance: profiles list, "Available Profile Types" (static), "Pool Safety Analysis" (hardcoded placeholders).

### 1.5 Cross-Links Issue

Profile links: `/agent?tab=onboarding`, `/agent?tab=privacy`, `/agent?tab=models`. Agent page does not read `?tab=`. Onboarding is shown only when localStorage says not completed. So `?tab=onboarding` and `?tab=privacy` have no effect; `?tab=models` is not applied. Links are misleading.

---

## 2. Problems

1. **No single narrative** — Overview is a long list of unrelated cards; order does not follow journey or "what you need first."
2. **Onboarding buried** — One card among many; should drive "next step" and optionally gate the rest.
3. **Protocol scattered** — Tier, collateral, relayer, upgrade appear in different places; no single "protocol status" view.
4. **Mission not visible** — Journey (connect, onboard, build passport, use protocol) is not surfaced.
5. **Duplication with Agent** — Tier and relayer fetched again on Agent; no shared hooks/context.
6. **Compliance** — Link to `?tab=privacy` but agent tab is "Disclosure"; Pool Safety is static.
7. **Monolithic page** — Many useEffects, no code-split, no reusable card components.
8. **Deep links broken** — Profile and Agent do not use URL tab state.

---

## 3. System View

- Reputation: Profile and Agent both use it; fetched separately.
- Risk Passport, Credit tier, Linked addresses: Profile only.
- Onboarding: Profile shows status; Agent shows full-page wizard when not completed.
- Relayer: Profile has request and pending; Agent has relayer stats.
- Compliance / Disclosure: Profile lists profiles; Agent has CompliancePanel on Disclosure tab.
- My Agents: same component on Profile (Agents tab) and Agent.

Documented journey (RISK_PASSPORT_PRODUCT_SCOPE): Onboarding then Identity then Reputation then Profile; passport ties them. Profile should be the canonical "who you are and what you can do" view.

---

## 4. Refactor Plan

### 4.1 Principles

- **Onboarding-aware:** Onboarding is step 2. Show "Complete onboarding" prominently when not done; optional progress (Step 1 done, Step 2 pending).
- **Protocol-aware:** One "Protocol status" (tier, collateral, relayer access, upgrade path). Collateral and Relayer stay as tabs but framed as protocol; summary in Overview.
- **Mission-aware:** Reflect journey at top: Connect, Onboard, Build passport, Use protocol. "Next step" section.
- **Primitives:** Reusable components and shared data so Profile (and optionally Agent) use same building blocks.

### 4.2 Proposed Overview Order (Option A)

1. **Journey / next step** — Wallet connected; if not onboarded: CTA "Complete onboarding" and optional progress. If onboarded: "Next: run proofs" or "You are set."
2. **Protocol status** — One block: Tier, Collateral, Relayer access, Upgrade (eligible or "X more txns").
3. **Risk Passport** — Letter, score, last proof, ProofTimeline.
4. **Credit Score** — As now; CTA to onboard or run credit proof.
5. **Linked addresses** — Form and "Why link?"
6. **Onboarding and proofs** — Short status and link to complete if needed.
7. **Tier Benefits** — Grid.
8. **Tier Upgrade** — As now.

Tabs unchanged: Overview | Collateral | Relayer | Agents | Compliance.

### 4.3 Extracted Primitives (components)

- `ProfileJourneyBanner` — Next step or progress.
- `ProfileProtocolStatus` — Tier, collateral, relayer, upgrade in one block.
- `ProfileRiskPassportCard` — Passport load/error/empty and ProofTimeline.
- `ProfileCreditCard` — Credit tier or CTA.
- `ProfileLinkedAddressesCard` — Form and Save.
- `ProfileOnboardingCard` — Status and link.
- `ProfileTierBenefits` — Tiers grid.
- `ProfileTierUpgrade` — Upgrade CTA.
- `ProfileCollateralTab` — Stake form.
- `ProfileRelayerTab` — Request and pending.
- `ProfileComplianceTab` — Profiles, types, pool safety (or link to Agent).

### 4.4 Shared Data Layer

- `useProfileReputation(address)` — userRep, error, refetch.
- `useOnboardingStatus(address)` — status, loading, refetch.
- `useRiskPassport(address)` — passport, loading, error, refetch.
- `useLinkedAddresses(address)` — linked, draft, setDraft, save, loading, saving.

Optional: `ProfileProvider` that fetches once and provides to all profile primitives (and Agent header/sidebar).

### 4.5 Deep Links and Agent

- Profile: support `?tab=overview|collateral|relayer|agents|compliance` and set activeTab from URL.
- Agent: read `?tab=onboarding` and set showOnboarding(true); read `?tab=disclosure` or `privacy` and set mainTab to disclosure; read `?tab=models` and set mainTab to models. Then Profile: "Complete onboarding" to `/agent?tab=onboarding`, "Generate Compliance Proof" to `/agent?tab=disclosure`, "Model Composer" to `/agent?tab=models`.

### 4.6 Compliance Tab

- Replace static Pool Safety with copy: "Pool safety is checked when you run rebalances on the Agent" and link to Agent. Fix Compliance Proof link to `?tab=disclosure`.

### 4.7 Implementation Order

1. Data layer: add hooks (and optional ProfileProvider); use in profile page; remove duplicate useEffects.
2. Agent deep links: Agent reads searchParams.tab; Profile fixes Compliance link.
3. Profile URL state: read and write ?tab= for tabs.
4. Extract primitives: move inline blocks into components; same data.
5. Journey and Protocol: add ProfileJourneyBanner and ProfileProtocolStatus; reorder Overview.
6. Compliance: pool safety copy + link; fix Compliance link.
7. Optional: use same hooks on Agent for tier/onboarding.

---

## 5. Summary

Current: one long profile page, mixed cards, onboarding and protocol not first-class, broken agent links, duplicated data. Direction: make profile onboarding-aware (next step), protocol-aware (one status block), mission-aware (journey at top); extract primitives and shared data; fix deep links on Profile and Agent; clean Compliance tab. Implement in order above after review.
