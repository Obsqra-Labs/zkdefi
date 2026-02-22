# Agent / Deploy to Ekubo — Holistic UX Plan

**Date:** 2026-02-19  
**By:** Obsqra Labs (zkde.fi)  
**Status:** Plan approved; implementation in progress.

---

## 1. Current /agent UI flow (summary)

- **Tabs:** Dashboard | Allocation Pools | DEX | Agent Controls | zkML Models | Disclosure.
- **Dashboard:** Live Market Data (JediSwap/Ekubo), Current Allocation (AllocationPools), Private Transfer (PrivateTransferPanel). Sidebar: Reputation Tier, Relayer Health, PositionChart, ActivityLog.
- **Pools:** Shielded (A), Full Privacy (B/C), Hashed Withdraw (D). Each panel has deposit/withdraw; Full Privacy has note-unlinkable flow.
- **DEX:** DexPanel — Ekubo Sepolia pairs, swap UI.
- **Agent Controls:** BrainVisualizer, SessionKeyManager, AgentRebalancer (propose → zkML check → prepare → execute).
- **MVP page:** risk → recommendation → deploy via `strategies/execute-advanced`; success shows positions and "When does AI redeploy?" + link to /agent.

**Gap:** No first-class "Deploy to Ekubo" flow on /agent. Orchestration backend (`POST /api/v1/zkdefi/orchestration/deploy`) is implemented; frontend does not call it or surface it.

---

## 2. Holistic design

**Principle:** One clear path for "I want to deploy (my deployable amount) to Ekubo Sepolia" that uses the orchestration layer (recommend → execute → receipt), without exposing private balance. User supplies amount; backend does Ekubo-only recommend + execute + receipt.

**Primary surface:** Dashboard on /agent — new **"Deploy to Ekubo"** card between Current Allocation and Private Transfer.

- **Copy:** "Deploy to Ekubo — Recommend → execute → receipt. Ekubo Sepolia only."
- **Inputs:** Deployable amount (number, required), Risk profile (conservative | balanced | aggressive).
- **Action:** "Deploy" → `POST /api/v1/zkdefi/orchestration/deploy` with `user_address`, `deployable_amount`, `risk_profile`.
- **Result:** Show `deployment_id`, positions (strategy, amount, status), `receipt_id`. Optional: "View receipt" link when receipt/passport UI exists.

**Secondary surface:** Pools tab — CTA under Full Privacy (Pool B): "Deploy from Full Privacy → Ekubo" that links to Dashboard and scrolls to the Deploy card (`/agent` + `#deploy-to-ekubo` or `?tab=dashboard` + scroll to id).

**Optional:** MVP page — after recommendation, add secondary button "Deploy via Ekubo orchestration" that calls `orchestration/deploy` with `recommendation.total_amount` and `recommendation.risk_profile`, and shows the same result shape (deployment_id, positions, receipt_id). Keeps MVP simple; power users get Ekubo-only + receipt in one click.

**Agent rebalancer:** No change in this phase. Later, autonomous mode can call orchestration when it decides to "deploy to Ekubo" (Phase 2).

---

## 3. Implementation tasks

| # | Task | Files |
|---|------|--------|
| 1 | Create `DeployToEkuboCard` component: form (amount, risk_profile), submit → orchestration/deploy, show result | `frontend/src/components/zkdefi/DeployToEkuboCard.tsx` |
| 2 | Add DeployToEkuboCard to Agent page Dashboard tab (with id="deploy-to-ekubo") | `frontend/src/app/agent/page.tsx` |
| 3 | Pools tab: add CTA "Deploy from Full Privacy → Ekubo" linking to `#deploy-to-ekubo` on /agent | `frontend/src/app/agent/page.tsx` |
| 4 | Deep link: when `?highlight=deploy` or hash `#deploy-to-ekubo`, ensure Dashboard tab is active and scroll to card | `frontend/src/app/agent/page.tsx` |
| 5 | (Optional) MVP: add "Or deploy via Ekubo orchestration" button calling orchestration/deploy with recommendation | `frontend/src/app/mvp/page.tsx` |
| 6 | (Optional) Backend/docs: EKUBO_CHAIN_ID in .env.example and ENV.md | `.env.example`, `docs/ENV.md` |

---

## 4. API contract

- **Request:** `POST /api/v1/zkdefi/orchestration/deploy`  
  Body: `{ "user_address": string, "deployable_amount": number, "risk_profile": "conservative" | "balanced" | "aggressive" }`
- **Response (200):** `{ "deployment_id": string, "positions": [{ "strategy": string, "amount": number, "status": string }], "receipt_id": string, "target": "ekubo", "recommendation_id"?: string }`
- **Error (400):** `{ "detail": string }` (e.g. deployable_amount must be positive, no Ekubo pools).

---

## 5. References

- Backend orchestration: `docs/plans/2026-02-19-privacy-ekubo-orchestration-implementation.md`
- Design: `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md`
- PROJECT_STATUS: `docs/PROJECT_STATUS.md`
