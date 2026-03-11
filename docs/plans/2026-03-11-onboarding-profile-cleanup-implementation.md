# Onboarding & Profile Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Streamline onboarding (unified wallet verify, optimistic STARK proving), move profile into the main app as a slideout, add “Verify wallet” reuse in Lend/credit flow, and add pool funding with zkdETH/zkDAI plus minimal onchain governance/lending proof.

**Architecture:** (1) Shared `WalletVerifyCTA` + optional backend Starknet-only verify endpoint; (2) Profile as a new slideout type `"profile"` in agent page, reusing current profile page content; (3) Onboarding steps reordered/simplified with verify early and proof non-blocking (backend job + poll or fire-and-forget + status endpoint); (4) Lend tab shows “Verify wallet to unlock credit” when gated and reuses same CTA; (5) Supply (zkdETH/zkDAI) in Lend tab and profile links to onchain tx for governance/lending.

**Tech Stack:** React/Next.js, Starknet React, existing FastAPI backend, linked_addresses store, vault_v2/zkd portfolio APIs.

**Design doc:** `docs/plans/2026-03-11-onboarding-profile-cleanup-design.md`

---

## Phase 0 — Shared wallet verify (backend + component)

### Task 0.1: Backend — Starknet-only verify ownership endpoint

**Files:**
- Modify: `backend/app/api/linked_addresses.py`
- Modify: `backend/app/services/linked_addresses_store.py` (or verification service) to record “Starknet verified” for identity_binding
- Test: `backend/tests/test_linked_addresses.py` (or create)

**Steps:**

1. **Add request/response models** in `linked_addresses.py`:
   - `StarknetVerifyRequest`: `starknet_address: str`, `message: str`, `signature_r: str`, `signature_s: str` (or single `signature` hex).
   - Response: `{ "verified": true, "verified_at": "<iso>" }`.

2. **Add POST `/linked_addresses/verify_starknet`** (or under same router):
   - Validate message contains `starknet_address` (or use fixed format e.g. `zkdefi verify {address} {nonce}`).
   - Verify Starknet signature (reuse existing pattern if any; otherwise use `starknet_py` or pass-through to a small helper that checks signature).
   - On success: persist “Starknet identity verified” for this address (e.g. in linked_addresses_store as a special key `starknet_verified` + timestamp, or in verification service so `verification_status(starknet_address)` includes a `starknet` entry with `verified: true`).
   - Return `{ "verified": true, "verified_at": "..." }`.

3. **Ensure risk_profile / identity_binding** reads this: `getIdentityBindingStatus` / `get_lending_gate` already depend on `linked_addresses` and verification; ensure the adapter considers “Starknet verified” as satisfying identity_binding (e.g. `linkedVerifiedCount >= 1` or new flag `starknet_verified`). If current logic only counts EVM verified links, add a branch: if `starknet_verified` then treat as at least one verified.

4. **Write test:** POST with valid signature (mocked or real) returns 200 and verified; GET linked_addresses includes verification state for starknet.

**Commit:** `feat(backend): add Starknet-only verify ownership endpoint for identity_binding`

---

### Task 0.2: Frontend — WalletVerifyCTA component and hook

**Files:**
- Create: `frontend/src/components/zkdefi/trust-flow/WalletVerifyCTA.tsx`
- Create: `frontend/src/hooks/useWalletVerify.ts` (optional; or logic inside CTA)
- Modify: `frontend/src/lib/api/client.ts` (ensure apiUrl/apiFetch used)

**Steps:**

1. **Create `WalletVerifyCTA`**:
   - Props: `address: string | undefined`, `onVerified: () => void`, `variant?: "primary" | "secondary"` (for styling), `label?: string` (default: "Verify wallet").
   - If no `address`, render ConnectButton or “Connect wallet first”.
   - If `address`, render button “Verify wallet”. On click:
     - Call `GET /api/v1/zkdefi/linked_addresses/verify/challenge` or similar to get a nonce/message (or use fixed message `zkdefi verify ${address} ${Date.now()}` if backend accepts).
     - Request Starknet sign message (use `signMessageAsync` or typed data sign from `@starknet-react/core`).
     - POST to `POST /api/v1/zkdefi/linked_addresses/verify_starknet` with `starknet_address`, `message`, `signature_r`, `signature_s` (or whatever backend expects).
     - On success: call `onVerified()`, show toast “Wallet verified”.
     - On error: show toast error.
   - If backend is not ready yet, fallback: open profile panel or existing “link EVM” flow (so we don’t block frontend).

2. **Challenge endpoint (if needed):** Backend may need `GET /linked_addresses/verify/challenge?starknet_address=X` returning `{ message, nonce }` for the user to sign. Add in Task 0.1 or here (small addition to linked_addresses.py).

3. **Export** from `frontend/src/components/zkdefi/trust-flow/index.ts` or from `OnboardingSteps.tsx` so onboarding and profile can import.

**Commit:** `feat(frontend): add WalletVerifyCTA for one-click verify ownership`

---

## Phase 1 — Profile in-app (slideout)

### Task 1.1: Add "profile" to SlideoutModeV2 and open from header

**Files:**
- Modify: `frontend/src/lib/agentState.ts`
- Modify: `frontend/src/components/zkdefi/mission-control/UnifiedHeader.tsx`
- Modify: `frontend/src/app/agent/page.tsx`

**Steps:**

1. **agentState.ts:** Add `"profile"` to union `SlideoutModeV2`:
   ```ts
   export type SlideoutModeV2 =
     | null
     | "fund"
     | "deposit"
     | "withdraw"
     | "privacy"
     | "shielded"
     | "zkrag"
     | "agent-builder"
     | "execute"
     | "profile";
   ```

2. **UnifiedHeader.tsx:** Change Profile nav item from `<Link href="/profile">` to a button that calls a new callback `onOpenProfile?: () => void`. When `onOpenProfile` is provided (e.g. on agent page), clicking Profile triggers it; otherwise keep Link to `/profile` for non-agent pages. Pass `onOpenProfile` from agent page.

3. **agent/page.tsx:** Add `onOpenProfile={() => openSlideout("profile")}` (or setSlideout("profile")) and pass to UnifiedHeader. In the slideout content block, add branch for `slideout === "profile"`: render `ProfilePanel` (next task). Set slideout title to "Profile".

**Commit:** `feat(frontend): add profile slideout and open from header`

---

### Task 1.2: ProfilePanel component (extract from profile page)

**Files:**
- Create: `frontend/src/components/zkdefi/profile/ProfilePanel.tsx`
- Modify: `frontend/src/app/profile/page.tsx`

**Steps:**

1. **Create ProfilePanel.tsx:** Accept props `address: string | undefined`, `onClose?: () => void` (for optional close button inside panel). Move the main content of `frontend/src/app/profile/page.tsx` (lenses: Identity, Reputation, Credit, Governance; all state and handlers) into this component. Reuse existing hooks: `useRiskProfile`, `useRiskProfileV2`, `useLinkedAddresses`, etc. Do not include full-page layout (no `<main className="min-h-screen">`); only the inner content (tabs + lens content). Use a compact header inside the panel: “Profile” + short address.

2. **Profile page:** Replace current content with redirect to agent + open profile:
   - `redirect(/agent?panel=profile)` or use `useEffect` + `router.replace('/agent?panel=profile')` and in agent page read `panel=profile` from searchParams to open profile slideout on load (see Task 1.3).

3. **Wire WalletVerifyCTA:** In ProfilePanel, in the Identity (or verification) section, use `WalletVerifyCTA` with `onVerified` refetching linked addresses / risk profile so the panel updates.

**Commit:** `feat(frontend): extract ProfilePanel and redirect /profile to agent?panel=profile`

---

### Task 1.3: URL param panel=profile opens profile slideout

**Files:**
- Modify: `frontend/src/lib/agentState.ts` (resolveViewOverlayV2)
- Modify: `frontend/src/app/agent/page.tsx`

**Steps:**

1. **agentState.ts:** In `resolveViewOverlayV2`, if `v` or a new param `panel=profile` (use searchParams in page), return `{ slideout: "profile" }`. Easiest: in page, read `searchParams.get("panel") === "profile"` and set initial slideout to "profile" when mounted.

2. **agent/page.tsx:** In `useEffect` that runs on mount/searchParams, if `searchParams.get("panel") === "profile"`, call `setSlideout("profile")`. Ensure this runs after layout is ready so the slideout opens.

**Commit:** `feat(frontend): open profile slideout when ?panel=profile`

---

## Phase 2 — Onboarding simplification

### Task 2.1: Onboarding step 2 — Verify ownership only (WalletVerifyCTA)

**Files:**
- Modify: `frontend/src/components/zkdefi/OnboardingWizard.tsx`
- Modify: `frontend/src/components/zkdefi/trust-flow/OnboardingSteps.tsx`

**Steps:**

1. **Add step 2 “Verify ownership”** (if not merging with step 1): After Connect (step 1), new step 2 shows only:
   - Title: “Verify ownership”
   - Short copy: “Sign in your wallet to verify ownership. This unlocks credit and reputation.”
   - `WalletVerifyCTA` with `address`, `onVerified={() => setStep(3)}`.
   - Optional expandable “Link EVM wallets (optional)” that shows current per-chain link/verify UI (simplified later); collapse by default.

2. **Rename/renumber steps:** Current step 2 (Configure) becomes step 3; Claims step 4; Authorize 5; Review 6; Submit 7; Complete 8. Or keep 7 steps by merging “Connect” and “Verify” into one step (Connect + “Verify wallet” button visible once connected). Design says “step count can stay 7 by merging Verify into Connect”. Choose one: either “Connect & verify” as step 1 with two CTAs (Connect + Verify wallet), or separate step 2 for verify. Recommendation: separate step 2 for verify so copy is clear.

3. **Remove** from current Claims step (old step 3): the “Link + Verify Wallets” and “Bind Scoped Session” blocks; move session binding to an optional “Later” or to Configure step (small section). So Claims step only shows reputation claims (compliance, tenure).

4. **Update OnboardingStepProgress** in OnboardingSteps.tsx: add one step “Verify” with icon (e.g. ShieldCheck) and update `ONBOARDING_STEPS` array so progress dots match.

**Commit:** `feat(onboarding): add Verify ownership step and remove link/session from Claims step`

---

### Task 2.2: Optimistic proof — allow Continue while proof generates

**Files:**
- Modify: `backend/app/api/routes/onboarding.py` (optional async job)
- Modify: `frontend/src/components/zkdefi/OnboardingWizard.tsx`
- Modify: `frontend/src/components/zkdefi/trust-flow/OnboardingSteps.tsx` (OnboardingAuthorizeStep)

**Steps:**

1. **Backend (minimal):** Option A — Keep synchronous `generate_authorization`; frontend calls it in background (fire-and-forget), then polls a new endpoint `GET /onboarding/authorization_status/{address}` that returns `{ status: "pending" | "ready", fact_hash?, identity_commitment? }`. Backend stores “pending” when a job is started and “ready” + data when done (in-memory or Redis/key-value). Option B — `generate_authorization` accepts a query `async=1`; returns immediately with `job_id`; background task does proof; `GET /onboarding/authorization_status/{job_id}` or `.../address` returns result when done. Implement Option A or B (recommend A with in-memory store keyed by address for now).

2. **Frontend — Authorize step:**
   - User clicks “Generate authorization proof”. Call POST `generate_authorization` (or with `?async=1`). If backend returns immediately with job_id/status pending, set `proofState = 'generating'` and show “Continue” button. If backend returns synchronously with fact_hash (current behavior), set `proofState = 'valid'` and allow Continue as now.
   - “Continue” button: always visible when `proofState === 'generating'` or `proofState === 'valid'`. On click, advance to Review step (or next). If proof still generating, show small inline text: “Proof may take a few minutes. We’ll notify you when it’s ready.”
   - Start polling: when `proofState === 'generating'`, poll `GET authorization_status/{address}` every 10–15 s. When status is “ready”, set fact_hash and identity_commitment, set `proofState = 'valid'`, run portable lifecycle (syncAttributions, deriveClaims, etc.) in background, toast “Authorization proof ready — reputation unlocked”, stop polling.

3. **Submit step:** Enable “Submit agent on-chain” only when `proofState === 'valid'`. If user already left to Dashboard, show “Submit agent” in profile panel or a small banner when proof becomes valid (same polling or global state).

**Commit:** `feat(onboarding): optimistic proof — continue while generating, poll status, unlock on ready`

---

### Task 2.3: Copy and visual cleanup (onboarding)

**Files:**
- Modify: `frontend/src/components/zkdefi/trust-flow/OnboardingSteps.tsx`
- Modify: `frontend/src/components/zkdefi/OnboardingWizard.tsx`

**Steps:**

1. Replace “start” / “complete” / “paste EVM signature” with single “Verify wallet” or “Link Ethereum” (one button per chain) in any remaining verify UI.
2. Authorize step: add short copy “Proof may take a few minutes. You can continue — we’ll notify you when it’s ready.”
3. Reduce clutter in Review step: shorten “Portable Trust Prep” list or move to expandable section.
4. Ensure one primary CTA per step; secondary actions (e.g. “Skip” or “Do this later”) styled as secondary.

**Commit:** `chore(onboarding): copy and visual cleanup for steps`

---

## Phase 3 — Lend tab and credit gate

### Task 3.1: Lend tab — “Verify wallet to unlock credit” when gated

**Files:**
- Modify: `frontend/src/components/zkdefi/tabs/LendTab.tsx`
- Modify: `frontend/src/lib/trust/adapters.ts` (ensure getLendingGate uses identity_binding / starknet_verified)

**Steps:**

1. In LendTab, get lending gate: `const lendingGate = getLendingGate(profileV2)` (or from useTrustFlowState if already used). If `lendingGate.mode === "block"` and reasons mention identity_binding (or “Verify wallet”):
   - Show a clear block state: “Verify wallet to unlock credit” and render `WalletVerifyCTA` with `onVerified` that refetches profile so gate re-evaluates.
   - Optionally add a link “Open profile” that opens profile slideout (`onOpenProfile` passed as prop or via context).

2. Ensure adapters: `getLendingGate` returns block when `linkedVerifiedCount === 0` and no `starknet_verified`; after Task 0.1, when Starknet-only verify is used, `linkedVerifiedCount` or a new flag should satisfy the gate.

**Commit:** `feat(lend): show Verify wallet CTA when lending gate blocks on identity`

---

## Phase 4 — Pool funding (zkdETH / zkdAI)

### Task 4.1: Backend — supply to pool endpoint or calldata

**Files:**
- Modify or create: `backend/app/api/routes/vault_v2.py` or `backend/app/api/routes/lending.py`
- Check: `contracts/src/lending_pool.cairo` or `collateral_vault.cairo` for deposit entrypoint

**Steps:**

1. Confirm which contract and entrypoint accept zkdETH/zkdAI (lending pool, collateral vault, or adapter). If none, document “contract change required” and provide a stub endpoint that returns 501 or mock success for frontend to wire.
2. Add endpoint e.g. `POST /api/v1/zkdefi/pools/supply` body `{ user_address, token: "zkdETH" | "zkdAI", amount_wei }` that either:
   - Returns calldata for frontend to execute (approve + deposit), or
   - Executes via relayer and returns tx_hash.
3. Add optional `GET /api/v1/zkdefi/pools/supply/balance/{address}` to return user’s supply balance per token (if contract tracks it).

**Commit:** `feat(backend): supply-to-pool endpoint for zkdETH/zkdAI`

---

### Task 4.2: Lend tab — Supply section (zkdETH / zkdAI)

**Files:**
- Modify: `frontend/src/components/zkdefi/tabs/LendTab.tsx`

**Steps:**

1. Add a “Supply” or “Fund pool” section: dropdown or tabs for asset (zkdETH, zkdAI), amount input, “Supply” button.
2. On submit: call backend supply endpoint (or build approve + deposit calldata and send via wallet). On success: show tx link (Starkscan), toast, refresh supply balance if endpoint exists.
3. Use token addresses from env or constants (zkdETH/zkdAI Sepolia addresses from deploy_zkd_pools.py).

**Commit:** `feat(lend): add Supply (zkdETH/zkdAI) section to Lend tab`

---

## Phase 5 — Governance and lending proof in profile

### Task 5.1: Profile — show last governance vote and lending tx

**Files:**
- Modify: `frontend/src/components/zkdefi/profile/ProfilePanel.tsx` (or Governance/Credit lens content)
- Backend: ensure we have or add lightweight endpoints that return last vote tx and last supply/borrow tx for address (or derive from existing DAO/lending APIs)

**Steps:**

1. **Governance:** In ProfilePanel Governance lens, if we have proposal/vote API, show “Last vote: proposal X” with tx link (from existing DAO routes or event store). If no data, show “No votes yet” and link to govern tab or proposals.
2. **Lending:** In Credit or Lend section, show “Last supply” / “Last borrow” with tx hash link when available (from supply endpoint response or lending history). Ensure LendTab supply/borrow flows store or return tx_hash so it can be displayed here.
3. Minimal provable: one vote and one supply (or borrow) with explorer link satisfies “minimal onchain” for design.

**Commit:** `feat(profile): show last governance vote and lending tx with explorer links`

---

## Phase 6 — Profile redirect and nav consistency

### Task 6.1: /profile redirect and AppNavbar Profile link

**Files:**
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/components/zkdefi/AppNavbar.tsx` (if used elsewhere)

**Steps:**

1. **profile/page.tsx:** If not already done in Task 1.2, ensure default export redirects to `/agent?panel=profile` (e.g. `redirect()` or `router.replace`) so bookmarks to `/profile` open agent with profile slideout.
2. **AppNavbar:** Where Profile link appears, change from `href="/profile"` to `href="/agent?panel=profile"` so in-app nav opens profile in agent context. Or use the same callback pattern as UnifiedHeader (open profile slideout when on agent, else link to /agent?panel=profile).

**Commit:** `chore(routing): redirect /profile to agent?panel=profile and update nav`

---

## Testing and verification

- **Manual:** Run through onboarding: Connect → Verify (one click) → Configure → Claims → Authorize (click Generate, then Continue) → Review → Submit → Complete. Confirm proof can complete in background and toast appears.
- **Manual:** Open Profile from header on agent page; confirm slideout shows Identity/Reputation/Credit/Governance; verify WalletVerifyCTA works in panel.
- **Manual:** Lend tab: with unverified wallet, see “Verify wallet to unlock credit” and complete verify; then see lending UI. Supply zkdETH/zkdAI if backend and contracts are ready.
- **Unit:** Backend tests for verify_starknet and authorization_status (if added). Frontend: optional unit test for WalletVerifyCTA (mock api and sign).

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-11-onboarding-profile-cleanup-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task (or per phase), review between tasks, fast iteration.
2. **Parallel Session (separate)** — You open a new session in the same worktree and use the executing-plans skill for batch execution with checkpoints.

Which approach do you want?
