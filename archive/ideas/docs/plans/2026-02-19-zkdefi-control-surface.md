# zkde.fi Control Surface Plan

Control surface architecture for zkde.fi agent UX and deferred authentication/onboarding behavior.

## 1) Control-surface phases

### Phase 1: Execution types + ExecutionContextProvider

- Define execution context types:
	- `manual_wallet`
	- `paymaster`
	- `orchestrated`
- Centralize wallet state + execution mode in one provider so gas mode and signer requirements are consistent across tabs.
- Make this provider the single source of truth for:
	- wallet connected/disconnected
	- execution intent
	- action gating prerequisites

### Phase 2: Gate overlay + triggers

- Standardize pipeline visualization and runtime flow as:
	- `AI → Policy → zkML → Execute → Receipt`
- Use `ExecutionControlRail` as control-surface entry point for gate state and advisories.
- Ensure triggers are consistent across actions (manual deploy, rebalance, withdraw, swap/LP):
	- run gate checks before execution
	- display allow/deny + reason
	- route to receipt/audit output

### Phase 3: Tabs as projections of one authority

- Tabs: `Vault`, `AI Pool`, `Activity`, `Privacy`, `Brain`, `Trust`, `System`, `Developer`.
- Treat tabs as read/write projections over a shared execution/receipt substrate.
- Single source of truth for execution outcomes: `receipt_service`.
- Align Brain labels with real APIs/endpoints to avoid placeholder naming drift.

### Phase 4: Cross-tab invalidation and caching

- When one tab executes an action, dependent tabs invalidate and refresh relevant sections.
- Add optional React Query/SWR for:
	- normalized cache keys
	- stale-time control
	- optimistic updates where safe

### Phase 5: Optional backend enhancements

- Keep backend optional where UX can function from existing services.
- Backend additions when needed:
	- LLM `recommend` + verbose rationale mode
	- `GET /system/metrics` for control-surface system tab

### Phase 6: Advisory copy and UX outcomes

- Standard gate outcomes:
	- `AI suggested`
	- `Gate denied`
- Provide actionable advisory copy (why denied, what to do next).
- Ensure message consistency across all action cards.

## 2) Deferred sign-in and onboarding

### Goal

Users do not need to connect wallet or complete onboarding until they attempt an onchain action or open identity-dependent views.

### Current behavior (baseline)

- Agent page (`frontend/src/app/agent/page.tsx`): historically gated to connect and onboarding before main tabs.
- Profile page (`frontend/src/app/profile/page.tsx`): identity/address-dependent data via onboarding + passport hooks.
- Backend onboarding + risk passport endpoints already provide required status fields; no backend change required.

### Desired behavior matrix

| State | Allowed | Blocked / Prompt |
|---|---|---|
| No wallet | Land on `/agent`, see nav + tabs, read-only or empty cards (e.g., connect wallet prompts in panel copy). Public/system docs can render. | Onchain actions and identity views prompt connect wallet. |
| Wallet connected, not onboarded | Same tab shell + non-blocking usage for non-identity views. | Onchain actions and identity views (`Trust`, `Profile`) prompt onboarding with CTA to `?tab=onboarding`. |
| Onboarded | Full flow enabled. | — |

### Trigger points

#### Require wallet

- Any action that submits a transaction:
	- deposit
	- withdraw
	- allocate/deploy
	- swap/LP
	- execute/rebalance
- First touch without wallet should open/connect flow or show clear prompt.

#### Require onboarding (`has_agent`)

- Same onchain actions above, when wallet exists but onboarding is incomplete.
- Identity views:
	- Trust tab
	- Profile page
- Prompt text: complete one-time setup with CTA to onboarding.

#### No trigger (guest-friendly)

- Dashboard summary, activity empty states, Brain/System/Developer public/empty cards can render without address.

### Key files and one-line change intent

- `frontend/src/app/agent/page.tsx`
	- Keep main layout visible for connected-not-onboarded users; only open `OnboardingWizard` explicitly (`?tab=onboarding` or setup CTA).
	- Relax no-wallet full-screen gate to guest-friendly shell with in-panel connect prompts.
- `frontend/src/components/zkdefi/VaultFundingCard.tsx`
	- Gate submit at action time when wallet exists and `hasOnboarded === false`.
- `frontend/src/components/zkdefi/UnifiedWithdrawCard.tsx`
	- Gate withdraw execution at action time when wallet exists and `hasOnboarded === false`.
- `frontend/src/components/zkdefi/DeployToEkuboCard.tsx`
	- Gate deploy/sign execution when wallet exists and `hasOnboarded === false`.
- `frontend/src/components/zkdefi/AgentRebalancer.tsx`
	- Gate propose/start autonomous execution when wallet exists and `hasOnboarded === false`.
- `frontend/src/app/profile/page.tsx`
	- If wallet connected and not onboarded, show onboarding-required block + CTA instead of full identity profile.

### Data flow

- Agent page fetches `GET /api/v1/zkdefi/onboarding/status/{address}` when connected.
- Publish onboarding state (`hasOnboarded`) via app context for downstream action components.
- Action components check:
	- no wallet → connect prompt
	- wallet + not onboarded → onboarding prompt
	- onboarded → proceed
- Profile page reuses onboarding hook; if `!has_agent`, show onboarding-required UI with CTA.

### Chosen behavior: guest mode on agent page

- Chosen for this plan: keep `/agent` shell visible without wallet.
- Wallet connect becomes action-triggered instead of full-screen blocked at first load.
- Onboarding remains deferred until identity-dependent views or onchain actions.

## Implementation status (aligned with plan)

- **Deferred auth (§2):** Done. Agent page no longer full-screen onboarding when `hasAccount && !hasOnboarded`; banner + CTA; OnboardingWizard only for `?tab=onboarding` or "Complete setup". AppContext exposes `hasOnboarded`/`setHasOnboarded`. Trust tab and Profile show "Complete onboarding" block when not onboarded. Action-level onboarding gates: VaultFundingCard (deposit), UnifiedWithdrawCard (shielded + full-privacy withdraw), DeployToEkuboCard (sign & execute), AgentRebalancer (propose, prepareAndExecute, startAutonomous).
- **Control Surface UI (Phase 3 tabs):** Done. Header "zkde.fi Control Surface"; tabs Vault, AI Pool, Activity, Privacy, Brain, Trust, System, Developer (+ Profile link). Vault = three-panel (left: VaultOverviewPanel, Privacy Control card, Disclosure Events; center: GATE + AI Recommendation + Activity; right: Trust card, System Monitor, ExecutionControlRail). Legacy tab names map to new tabs. Duplicate Pools-only block removed; Privacy tab is single source.
- **Phase 2:** ExecutionControlRail present in Vault right panel, AI Pool sidebar, System tab.
- **Phase 6 (gate advisory copy):** Done. Shared `frontend/src/lib/gateCopy.ts`: `GATE_DENIED_LABEL`, `AI_SUGGESTED_LABEL`, `formatGateDenied`, `formatAdvisoryPass`, `formatAdvisoryElevatedRisk`. DeployToEkuboCard, EkuboLpPanel, EkuboSwapPanel, EkuboOperateHub use consistent "Gate denied" / "AI suggested" text and actionable advisory copy.
- **Phase 1 (ExecutionContextProvider):** Done. `ExecutionIntent` type: manual_wallet, paymaster, orchestrated, autonomous. `frontend/src/contexts/ExecutionContext.tsx`: ExecutionContextProvider holds wallet connected, gas mode, paymaster/controller state, fallback; single source of truth; `executionIntentFromStatus()` for gate/signer consistency. Root layout: StarknetProvider → ExecutionContextProvider → AppProvider. `useExecutionInfra()` reads from context (optional fallback when no provider).
- **Phase 4 (cross-tab invalidation):** Done. AppContext: `invalidateKey` (number) and `invalidateTabs()`; when any action completes (deposit, withdraw, deploy, propose, execute), call `invalidateTabs()`. useHistoryTimeline(address, invalidateKey) refetches when invalidateKey changes; ActivityLog passes invalidateKey. Agent page: position fetch and MyAgents depend on invalidateKey. VaultFundingCard, UnifiedWithdrawCard, DeployToEkuboCard, AgentRebalancer call invalidateTabs() on success. Optional React Query/SWR not added; single global invalidation key is sufficient.
- **Phase 5:** Implemented. Backend `GET /api/v1/zkdefi/system/metrics` (TVL from oracle, profits_24h null, zkml_status); frontend System tab and Vault right-panel SYSTEM MONITOR fetch and display metrics; Refresh on System tab. LLM recommend/verbose rationale optional follow-up.

### Deterministic verification (before moving on)

1. Start frontend: `cd frontend && npm run dev` (port 3001).
2. Run: `./scripts/verify_agent_control_surface.sh http://localhost:3001` — asserts `/agent` and all tab routes return 200 and app shell contains `zkde.fi`.
3. Open **http://localhost:3001/agent** (or **https://zkde.fi/agent** after deploy) in a browser to confirm:
   - Header: "zkde.fi Control Surface"; tabs Vault, AI Pool, Activity, Privacy, Brain, Trust, System, Developer.
   - Vault tab: three-panel layout; Execution Control rail in right panel.
   - Without wallet: no full-screen block; Connect in header.
   - With wallet, not onboarded: "Complete one-time setup" banner; Trust/Profile gated.
