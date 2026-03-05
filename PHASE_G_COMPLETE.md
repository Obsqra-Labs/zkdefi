# Phase G — Control Surface Redesign

**Date:** 2025-02-19
**Status:** COMPLETE

---

## What Was Done

### 1. Tab Consolidation: 14 → 6
The agent page (`/agent`) was restructured from 14 loosely-related tabs into 6 coherent surfaces:

| New Tab | Merges From | Purpose |
|---------|------------|---------|
| **Overview** | vault, dashboard, activity | Capital position, Gate hero, portfolio health, pending claims |
| **Strategy** | brain, ai_pool, agent | Allocation pools, LP execution, rebalancer, session keys, AI recommendation |
| **Privacy** | privacy, pools | Execution matrix, policy studio, relayer config, privacy tier |
| **Trust** | trust, disclosure | Compliance panel gated on onboarding |
| **Models** | models | zkML model composer, agent marketplace |
| **System** | system, developer, dex | Proof console + Market research sub-tabs |

**Cut entirely:** Governance tab (premature — no on-chain governance yet).

### 2. LLM Narration Layer
- **Backend:** `backend/app/services/llm_narration.py` — 6 context types (gate_evaluation, strategy_recommendation, idle_capital, gate_rate_explanation, error_decode, pending_claims)
- **Endpoint:** `POST /llm/narrate` in strategies.py router
- **Frontend client:** `fetchNarration()` in `strategies.ts`
- **Pattern:** GPT-3.5-turbo with deterministic fallback templates when no API key. All prompt logic is server-side — the frontend sends structured context, never raw prompts.
- **Used by:** GateVisualizationPanel (gate_evaluation), PendingClaimsCard (pending_claims), useIdleCapitalDetector (idle_capital), Strategy sidebar (strategy_recommendation)

### 3. Gate Visualization Panel (`GateVisualizationPanel.tsx`)
Center hero of the Overview tab. Visualizes the constraint gate pipeline:
- **4 input nodes** (Wallet, Shielded, Pool C, Stealth) → **zkGate shield** → **4 output nodes** (zkVault, Full Privacy, Compliance, Shared Pool)
- **3 states:** idle (static graph), evaluating (pulse + LLM narration), executing (4-step proof progress)
- Status chips: Identity, Session Key, Autopilot
- Risk profile badge, emerald CTA button

### 4. Pending Claims Card (`PendingClaimsCard.tsx`)
Right sidebar of Overview. Detects unclaimed yield from Ekubo positions:
- Fetches yield snapshot, filters unharvested fees > 0
- Gets LLM narration explaining what's claimable
- One-click claim buttons, disabled without active session key

### 5. Idle Capital Detector (`useIdleCapitalDetector.ts`)
React hook that compares vault balance vs deployed capital:
- Threshold: suggests deployment if >10% idle and >$1
- Polls every 60s
- Gets LLM narration for context
- Surfaces as a card in the Overview left column

### 6. Header Additions
- **Session key chip:** Green `Session Active` or gray `No Session` in the header bar
- **Settings gear:** Opens ExpertDrawer with ExecutionControlRail

### 7. Live Constraints (not hardcoded)
Strategy tab's "Active Constraints" panel now pulls from `getUserConstraints()` endpoint (the Phase F constraint gate), instead of hardcoded "Max Drawdown 10%" placeholders. Displays: risk profile, max position, session duration, session validity, identity status, claims.

### 8. Deep Links Preserved
All legacy `?tab=xxx` deep links map to the new 6-tab structure. `?tab=brain` → Strategy, `?tab=developer` → System, etc.

---

## What Was Learned

1. **Full-file replace_string_in_file fails on 1000+ line files** — the exact-match approach breaks with large content. Backup → empty → create_file is a reliable fallback pattern.

2. **LLM narration must be server-side** — keeping prompts and templates on the backend means the frontend API surface stays clean (just send structured context, get back a sentence). Also lets us swap models without frontend changes.

3. **Constraint gate data is the glue** — the Phase F `getUserConstraints()` endpoint feeds the Strategy sidebar, the Gate Visualization, and the header chips. Investing in that single endpoint pays off across the entire UI.

4. **Tab count is cognitive load** — 14 tabs meant users had to guess where things lived. 6 tabs with clear labels (Overview = your money, Strategy = how it moves, Privacy = who knows, Trust = legal, Models = AI, System = infra) maps to actual user intent.

5. **Idle capital detection creates pull** — instead of waiting for users to notice undeployed funds, the hook proactively surfaces suggestions. This turns a passive dashboard into an active control surface.

---

## What It Unlocks

- **Autopilot mode:** The session key chip + gate visualization + idle capital detector are the building blocks. Next step: wire autopilot toggle that auto-deploys when session is active and idle capital is detected.
- **Narration everywhere:** Any new card can call `fetchNarration()` with its context type. Adding "error_decode" narration to failed transactions is a one-liner.
- **Vault-first UX:** Overview tab focuses on capital state, not protocol mechanics. Users see their money, then drill into strategy/privacy.
- **Proof Console is now accessible:** Moving it to a dedicated System sub-tab (instead of buried in "Developer") makes it usable for power users without cluttering the main flow.
- **Model marketplace ready:** Models tab is isolated and clean — ready for community model submission when we ship on-chain model registry.

---

## Files Changed

| File | Action |
|------|--------|
| `frontend/src/app/agent/page.tsx` | Rewritten (14-tab → 6-tab) |
| `frontend/src/app/agent/page.tsx.bak` | Backup of original |
| `frontend/src/components/zkdefi/GateVisualizationPanel.tsx` | NEW |
| `frontend/src/components/zkdefi/PendingClaimsCard.tsx` | NEW |
| `frontend/src/hooks/useIdleCapitalDetector.ts` | NEW |
| `backend/app/services/llm_narration.py` | NEW |
| `backend/app/api/routes/strategies.py` | Modified (added `/llm/narrate` endpoint) |
| `frontend/src/lib/api/strategies.ts` | Modified (added `fetchNarration()`, types) |
