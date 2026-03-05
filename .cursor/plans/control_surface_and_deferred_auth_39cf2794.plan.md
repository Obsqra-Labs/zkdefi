---
name: Control surface and deferred auth
overview: Save the zkde.fi Control Surface plan to docs/plans/2026-02-19-zkdefi-control-surface.md and add a deep dive and implementation tasks for deferred sign-in/onboarding (no sign-in or onboard until the user does something onchain or needs identity).
todos: []
isProject: false
---

# Control Surface Plan + Deferred Sign-In / Onboard

## 1. Save the plan document

Create [docs/plans/2026-02-19-zkdefi-control-surface.md](docs/plans/2026-02-19-zkdefi-control-surface.md) with the full control-surface content (phases below) **and** a new section for deferred auth (Section 2 of this plan).

**Control-surface phases to include in the doc:**

- **Phase 1:** Execution types and `ExecutionContextProvider` (manual_wallet, paymaster, orchestrated; single source for gas mode and wallet state).
- **Phase 2:** Gate overlay (AI → Policy → zkML → Execute → Receipt) and triggers; ExecutionControlRail as the control surface entry point.
- **Phase 3:** Tabs as projections (Vault, AI Pool, Activity, Privacy, Brain, Trust, System, Developer) with single source of truth = `receipt_service`; Brain labels aligned to real APIs.
- **Phase 4:** Cross-tab invalidation and optional React Query/SWR caching.
- **Phase 5:** Optional backend (LLM in recommend, verbose; GET system/metrics).
- **Phase 6:** Gate “AI suggested” / “Gate denied” and advisory copy.

---

## 2. Deferred sign-in / onboard (deep dive)

**Goal:** Users do **not** need to sign in (connect wallet) or complete onboarding until they want to do something onchain or view identity-dependent data.

### Current behavior

- **Agent page** ([frontend/src/app/agent/page.tsx](frontend/src/app/agent/page.tsx)): `showLoading` when no wallet or not settled; `showConnectGate` when mounted and no address (wallet settled) → full-screen “Connect wallet”. Once connected, it fetches `GET /api/v1/zkdefi/onboarding/status/{address}`; if `has_agent` is false, it shows **full-screen OnboardingWizard** and the user never sees the main tabs until onboarding is complete.
- **Profile page** ([frontend/src/app/profile/page.tsx](frontend/src/app/profile/page.tsx)): Uses `useOnboardingStatus(address)` and shows “Connect wallet” when no address; profile content is identity/address-dependent.
- **Backend:** [backend/app/api/routes/onboarding.py](backend/app/api/routes/onboarding.py) stores `identity_commitment`, `fact_hash`, `agent_initialized`. [backend/app/api/risk_passport.py](backend/app/api/risk_passport.py) composes reputation + onboarding (identity_commitment) + receipts; credit tier/score come from identity service. No backend change is required for “deferred” logic; the change is frontend gating.

### Desired behavior


| State                               | Allowed                                                                                                                                                             | Blocked / Prompt                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No wallet**                       | Land on /agent; see nav, tabs, read-only or empty content (e.g. “Connect wallet to see your Vault / Activity”). System tab, docs, landing can work without address. | Onchain actions and identity views: prompt “Connect wallet” (or open connect flow).                                                                                                                                      |
| **Wallet connected, not onboarded** | Same as above: full tab bar and panels; Vault/Activity can show empty or placeholders.                                                                              | **Onchain actions** (deposit, withdraw, allocate, deploy, execute) and **identity views** (Trust tab, Profile) → prompt onboarding (modal or redirect to onboarding) instead of executing or showing full identity data. |
| **Onboarded**                       | Full flow: all actions and identity views.                                                                                                                          | —                                                                                                                                                                                                                        |


### Trigger points (when to require connect or onboard)

- **Require wallet only:** Any button or flow that sends a transaction (Deposit, Withdraw, Allocate to AI Pool, Deploy, Execute swap/LP, etc.). Components already do `if (!address) { toast / message }` in many places; unify so that the first time the user hits such an action without a wallet, we open Connect (or show a clear “Connect wallet to continue”).
- **Require onboarding (has_agent):**  
  - Same onchain actions: backend flows (e.g. submit_agent, vault policy, relayer) assume identity exists after onboarding; so before **submitting** an onchain action, if `address` is set but `!hasOnboarded`, show onboarding prompt (e.g. “Complete one-time setup to use the agent”) and redirect to `?tab=onboarding` or open onboarding modal.  
  - **Identity views:** Opening “Trust” tab (risk passport, credit) or **Profile** page. If wallet connected but not onboarded, show a friendly block: “Complete onboarding to see your Trust / Profile” with CTA to onboarding.
- **No trigger (guest-friendly):** Dashboard summary cards can show “—” or “Connect wallet”; Activity empty; Brain/System/Developer can show public or empty state without address.

### Key files to change

- **[frontend/src/app/agent/page.tsx](frontend/src/app/agent/page.tsx)**  
  - Remove the rule that forces full-screen OnboardingWizard when `hasAccount && !hasOnboarded`.  
  - Instead: when `hasAccount && !hasOnboarded`, render the **main layout and tabs** (dashboard, pools, dex, agent, etc.). Optionally show a non-blocking banner: “Complete one-time setup to use the agent and Trust.”  
  - Only show OnboardingWizard when user explicitly chooses “Complete setup” or lands with `?tab=onboarding`, or when an **action** or **Trust** is gated (see below).
- **Onboarding “gate” at action time:** In components that perform onchain actions (e.g. [VaultFundingCard](frontend/src/components/zkdefi/VaultFundingCard.tsx), [UnifiedWithdrawCard](frontend/src/components/zkdefi/UnifiedWithdrawCard.tsx), [DeployToEkuboCard](frontend/src/components/zkdefi/DeployToEkuboCard.tsx), [AgentRebalancer](frontend/src/components/zkdefi/AgentRebalancer.tsx), [EkuboSwapPanel](frontend/src/components/zkdefi/EkuboSwapPanel.tsx) / [EkuboLpPanel](frontend/src/components/zkdefi/EkuboLpPanel.tsx)): before building/submitting tx, if `address` exists but onboarding status is “not completed”, show inline prompt or modal: “Complete one-time agent setup to continue” with link to `?tab=onboarding` (or open onboarding flow). Either pass `hasOnboarded` from agent page via context or use a small hook that calls `GET onboarding/status/{address}` when `address` is set.
- **Trust tab / Profile:** When rendering Trust tab content or [profile/page.tsx](frontend/src/app/profile/page.tsx): if `address` is set but `!hasOnboarded`, show a clear message and CTA to onboarding instead of full passport/profile.
- **Connect gate:** Optionally relax the agent page so that when there is **no** wallet, instead of full-screen “Connect wallet”, show the same main layout with nav and tabs, with panels showing “Connect wallet to see your Vault / Activity” (or similar). ConnectButton remains in header; user can connect when they want to act or view identity. If you prefer to keep the current “Connect wallet” full-screen when no wallet, that’s a product choice; the minimum is to **not** force onboarding until an onchain or identity action.

### Data flow

- **Agent page** already fetches `onboarding/status/{address}` when `mounted && isConnected && address`. Keep that; use `hasOnboarded` to control:  
  - Whether to show full-screen OnboardingWizard (only when `?tab=onboarding` or when user clicks “Complete setup”).  
  - Whether to show “Complete setup” banner and whether action components should block and prompt onboarding.
- Expose `hasOnboarded` (and optionally `onboardingStatus`) via React context (e.g. extend [AppContext](frontend/src/lib/AppContext.tsx) or a small AgentPage-scoped context) so that VaultFundingCard, UnifiedWithdrawCard, DeployToEkuboCard, Trust tab, etc. can check “has wallet but not onboarded” and show the onboarding prompt instead of submitting.
- **Profile page:** Already uses `useOnboardingStatus(address)`. When `address` is set and `!onboardingStatus?.has_agent`, show the “Complete onboarding to view full profile” block and CTA to `/agent?tab=onboarding`.

### Summary for the doc

In [docs/plans/2026-02-19-zkdefi-control-surface.md](docs/plans/2026-02-19-zkdefi-control-surface.md), add a section **“Deferred sign-in and onboarding”** that includes:

- The table above (state vs allowed/blocked).
- Trigger points (require wallet vs require onboarding).
- Key files and the one-line change per file.
- Data flow (when to fetch onboarding status, how to expose `hasOnboarded` to action components and Trust/Profile).
- Optional: guest mode (show main layout without wallet) vs keep current connect gate; document the chosen behavior.

---

## 3. Execution (after plan confirm)

- Use the **executing-plans** skill: load the plan file, create TodoWrite, execute in batches (e.g. first save the doc and implement agent-page onboarding gate; then connect gate and action-level onboarding prompts; then Trust/Profile).
- After each batch: report and “Ready for feedback.”
- When complete: use **finishing-a-development-branch** for merge/PR/cleanup.

