# Onboarding & Profile Cleanup — Design

**Date:** 2026-03-11  
**Status:** Design (pre-implementation)  
**Scope:** Streamlined onboarding, profile in-app, optimistic proving, wallet bind reuse, pool funding (zkdETH/zkDAI), governance/lending minimal onchain.

---

## 1. Goals

- **Unified wallet bind:** One action: click → wallet pops up → sign → verify ownership. Reuse in (a) first-time onboarding and (b) “Get credit” / “Verify for lending” elsewhere (e.g. Lend tab, in-app profile).
- **Profile in-app:** Profile is a panel/slideout/tab inside the main app (e.g. agent dashboard), not a standalone `/profile` page.
- **Optimistic proving:** Do not block onboarding on STARK proof. User can continue; proof runs in background (minimized). When proof completes → notification and reputation/credit unlocks.
- **Clean visuals:** Reduce clutter in onboarding (Claims step), clearer CTAs, consistent copy.
- **Pool funding:** Provide a path to fund pools using zkdETH/zkDAI (contracts we control); consider supply-side lending or “fund pool” as part of flows.
- **Governance + lending:** At least one minimal, provable onchain action for governance and one for lending (e.g. vote, supply to pool or borrow with proof).

---

## 2. Current State (Summary)

- **Onboarding:** 7 steps. Step 3 (Claims) contains “Link + Verify Wallets” (per-chain address, start verify → paste EVM signature → complete) and “Bind Scoped Session” (session key, max position, protocols, create request, paste grant tx). Step 4 blocks on STARK proof (~2–3 min). Portable lifecycle (attributions, derive claims, disclosure pack) runs after proof.
- **Profile:** Standalone `/profile` page with Identity / Reputation / Credit / Governance lenses; same linked-address verify UX (start → paste signature → complete).
- **Proving:** `proofState` in OnboardingAuthorizeStep is blocking; no “continue and finish in background.”
- **Lending:** LendTab and Control Plane use `getLendingGate(profileV2)`; identity_binding (linked verified count) gates access. No single “Verify for credit” CTA that reuses the same bind flow.
- **zkdETH/zkDAI:** Token addresses on Sepolia; `deploy_zkd_pools.py` seeds Ekubo pools (zkdAI/zkdETH, STRK/zkdETH, etc.). Backend has `/zkd/portfolio/{address}`. We control these contracts; no in-app “fund pool” with zkdETH/zkDAI yet.

---

## 3. Design Decisions

### 3.1 Unified “Bind & Verify Wallet” (one-click sign)

- **Single entry point:** One primary CTA: “Verify wallet” (or “Sign to verify ownership”). On click:
  1. If not connected: connect Starknet wallet (existing flow).
  2. If connected: trigger one sign request (e.g. sign a deterministic message that includes `starknet_address` and a nonce/challenge from backend).
  3. Backend verifies signature and marks “wallet verified” for that Starknet address (and optionally stores a verified-at timestamp / nonce).
- **EVM linking (optional):** If we keep cross-chain attribution, offer “Link EVM wallet” as a **separate, optional** step: same pattern — “Sign in wallet” → backend sends challenge for that chain → user signs in MetaMask/etc. → paste or wallet_switchEthereumChain + sign; no “start / paste signature / complete” split in the main path. Prefer one flow per chain: “Link Ethereum” → one button that opens MetaMask and completes in one round-trip where possible.
- **Reuse:** Same component/hook used in:
  - Onboarding (after Connect, before or merged with Configure): “Verify ownership” single step.
  - “Get credit” / Lend tab: when `getLendingGate` blocks on identity_binding, show “Verify wallet to unlock credit” with same CTA.
  - In-app profile: “Wallet verification” section with same CTA and status.
- **Backend:** Existing `/linked_addresses/verify/start` and `/verify/complete` can stay; for Starknet-only “verify ownership” we may add a lightweight endpoint that only needs one sign (e.g. sign `starknet_address + nonce`) and marks the Starknet identity as verified for reputation/credit, without requiring an EVM address. If we keep EVM linking, keep start/complete but simplify frontend to one “Sign in wallet” flow per chain (no manual paste if we can use wallet_connect to get signature).

### 3.2 Profile inside main app

- **Placement:** Profile as a **slideout/drawer or a tab** in the main app shell (e.g. agent dashboard). Examples:
  - **Option A — Slideout:** “Profile” in header/nav opens a slideout (same pattern as Deposit/Withdraw). Content = current profile page content (Identity, Reputation, Credit, Governance) in a panel. No route change; URL can stay `/agent` or `/agent?panel=profile`.
  - **Option B — Tab:** Agent dashboard has a top-level tab “Profile” next to Vault / Trade / etc.; selecting it shows profile content in the main content area. Route e.g. `/agent?tab=profile` or `/agent/profile`.
- **Recommendation:** Option A (slideout) keeps “Dashboard” as the default view and matches existing Deposit/Withdraw pattern; Profile is one panel among others. Nav item “Profile” opens the slideout instead of navigating to `/profile`.
- **Migration:** Current `/profile` page can redirect to `/agent?panel=profile` (or equivalent) and open the profile panel, so old links still work. Remove or deprecate standalone profile route once in-app profile is default.
- **Content:** Reuse existing profile logic (risk profile, linked addresses, sessions, disclosure, governance power, lending gate). Only the container and entry point change.

### 3.3 Optimistic proving (STARK in background)

- **Trigger:** From Authorize step, user clicks “Generate authorization proof.” Backend starts proof generation (existing `generate_authorization`).
- **Non-blocking:** Do not wait for proof. Immediately:
  - Set local state to “proof generating” (e.g. `proofState: 'generating'`).
  - Allow user to click “Continue” (or “Explore while proof generates”). Advance to next step (e.g. Review) or optionally to “Complete (proof pending)” and then “Go to Dashboard.”
- **Background:** Frontend polls or uses SSE/WebSocket for proof status (if backend supports). When proof completes: store `fact_hash` / `identity_commitment`, run portable lifecycle (attributions, derive claims, disclosure) in background, then update UI (toast: “Authorization proof ready — reputation unlocked”).
- **Minimized UX:** If user has moved to Dashboard, show a small persistent indicator (e.g. “Proof generating…”) that can minimize to a corner or header chip; when done, replace with “Proof ready” and refresh trust/reputation state so gates (execution, lending) update.
- **Proving lane:** No change to how proof is generated or verified; only the UX is non-blocking. Backend contract submission (submit_agent) still requires proof; so “Submit agent on-chain” in step 6 is only enabled when proof is valid (or we allow “submit when ready” later from Dashboard if proof completed in background).

### 3.4 Onboarding flow (simplified)

- **Step 1 — Connect:** Unchanged (Starknet connect).
- **Step 2 — Verify ownership:** Single CTA “Verify wallet” → sign → verify. Optional “Link EVM wallets” expandable section (one button per chain: “Link Ethereum”, etc.) with simplified one-round sign where possible.
- **Step 3 — Configure:** Constraints (max position, risk, session duration). Optional: bind scoped session moved here or to a “Later” path so step 3 is shorter.
- **Step 4 — Claims:** Reputation claims (compliance, tenure, etc.); no wallet link/verify/session UI here (moved to step 2).
- **Step 5 — Authorize:** “Generate authorization proof” → start proof, then “Continue” immediately (optimistic). Proof runs in background; user can go to next step or Dashboard.
- **Step 6 — Review:** Sign risk disclosure (unchanged).
- **Step 7 — Submit:** Submit agent on-chain when proof is ready (button enabled when `proofState === 'valid'`; if user already on Dashboard, show “Submit agent” in profile or a small banner until done).
- **Step 8 — Complete:** Success; “Go to Dashboard.” If proof was still generating, show “Proof generating” chip that resolves when done.

Step count can stay 7 by merging “Verify” into Connect (e.g. “Connect & verify” as one step) and keeping the rest. Exact numbering is an implementation detail.

### 3.5 Pool funding (zkdETH / zkdAI)

- **Intent:** Use zkdETH and zkdAI (contracts we control) so users or the protocol can “fund the pool” — e.g. supply side of lending or liquidity to designated pools.
- **Options:**
  - **A — Lending supply:** In Lend tab, add “Supply” or “Fund pool”: user selects amount of zkdETH or zkdAI to supply to the lending pool; transaction deposits to the pool contract we control. Requires lending pool contract to accept these tokens (or wrapped variant).
  - **B — Vault deposit in zkd assets:** Allow “Fund vault” or “Deposit to pool” in zkdETH/zkdAI in addition to ETH/STRK (if vault/pool contracts support it).
  - **C — Onboarding “seed” step:** Optional step after Complete: “Fund the pool to get started” — small amount of zkdETH or zkdAI into a designated pool; proves onchain participation.
- **Recommendation:** Start with **A** (Supply in Lend tab with zkdETH/zkdAI) as the minimal provable onchain lending action; add **C** as optional post-onboarding CTA if we want every user to have one onchain “fund pool” tx. Backend and contracts must support deposit of zkdETH/zkdAI into the lending pool (or a dedicated “supply” contract).
- **Contracts:** Confirm lending pool (or collateral vault) accepts zkdETH/zkdAI; if not, add a small adapter or extend existing deposit entrypoint. We already have token addresses and deploy_zkd_pools; next is wiring deposit from frontend to the correct contract and tracking supply per user.

### 3.6 Governance and lending — minimal onchain

- **Governance:** At least one provable onchain action: e.g. “Cast vote” on a DAO proposal (existing or new). If we already have proposal list and vote tx, ensure one vote is visible and recorded onchain; profile “Governance” section shows “Voted on proposal X” with tx link.
- **Lending:** At least one provable onchain action: e.g. “Supply zkdETH/zkdAI to pool” (see 3.5) or “Borrow against collateral” that results in an onchain tx. LendTab already has borrow flow; ensure it (or the new Supply flow) hits a contract and stores proof (tx hash + pool/amount). Profile “Credit” or “Lending” section shows last supply/borrow and link to explorer.

---

## 4. Visual and copy cleanup

- **Onboarding:** One primary CTA per step. Replace “start” / “complete” / “paste signature” with “Verify wallet” (and for EVM “Link Ethereum” etc.). Short copy: “Sign in your wallet to verify ownership” instead of long explanations.
- **Proof step:** “Proof may take a few minutes. You can continue — we’ll notify you when it’s ready.”
- **Profile (in-app):** Same lenses (Identity, Reputation, Credit, Governance); compact header; “Verify wallet” and “Link EVM” reuse same components as onboarding. Remove duplicate copy between profile and onboarding.
- **Lend tab:** When lending gate blocks: clear message “Verify wallet to unlock credit” and single CTA that opens the shared verify flow (or opens profile panel with verify section).

---

## 5. Implementation notes (high level)

- **Shared component:** `WalletVerifyCTA` (or similar) that: (1) if not connected, show Connect; (2) if connected, show “Verify wallet” → on click request signature (backend provides nonce/message) → submit to backend → on success refresh identity/reputation and close or update state. Used in Onboarding (step 2), Lend tab (gate message), and Profile panel.
- **Backend:** Optional: endpoint “verify_starknet_ownership” (message + signature) that marks Starknet address as verified for identity_binding without EVM. Or keep using existing linked_addresses with a “virtual” or same-address link for Starknet-only verification.
- **Profile panel:** New component `ProfilePanel` (content of current profile page); `ProfileSlideout` or `ProfileDrawer` that wraps it; nav “Profile” opens slideout. Route: `/agent?panel=profile` or hash `#profile`.
- **Optimistic proof:** Backend may need “status” or “job” endpoint for proof generation so frontend can poll. Frontend: after calling generate_authorization, if response is “accepted, job_id X”, poll until done; when done, run portable lifecycle (or backend does it) and update proofState to ‘valid’.
- **Pool funding:** New “Supply” section in Lend tab (or new “Fund pool” modal): asset = zkdETH or zkdAI, amount, approve + deposit to pool contract; success shows tx link and updates supply balance. Backend endpoint for “supply to pool” that returns calldata or executes via relayer if needed.

---

## 6. Success criteria

- User can complete “verify ownership” with one click (wallet opens, sign, done) in onboarding and in “Get credit” / Lend flow.
- Profile is reachable from main app (slideout or tab) without leaving to `/profile`.
- User can proceed past the proof step without waiting; proof completes in background and reputation/credit unlocks when ready.
- At least one onchain governance action (e.g. vote) and one onchain lending action (e.g. supply zkdETH/zkdAI or borrow) are available and visible in profile/explorer.
- Pool funding path using zkdETH/zkDAI exists (supply in Lend tab or equivalent).

---

## 7. Out of scope for this design

- Changing how STARK proof is generated or verified (only UX is optimistic).
- Full DAO proposal creation or multi-step governance flows (only “minimal provable” vote/supply).
- Changing token contracts for zkdETH/zkdAI (only integration for deposit/supply).

---

**Next step:** Implementation plan (tasks, order, and acceptance criteria) via writing-plans skill.
