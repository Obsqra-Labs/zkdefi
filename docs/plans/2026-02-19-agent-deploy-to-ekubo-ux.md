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

## 5. Verification checklist (UI)

Run through with backend (`:8003`) and frontend (`:3001`) up. Wallet connected (Starknet Sepolia).

| # | Step | Expected |
|---|------|----------|
| 1 | Go to `/agent` → **Dashboard** tab | See "Deploy to Ekubo" card between Current Allocation and Private Transfer. |
| 2 | Enter amount (e.g. `100`), select risk (e.g. Balanced), click **Deploy** | Loading → success: deployment_id, positions list, receipt_id; "Deploy again" appears. |
| 3 | Go to **Allocation Pools** tab → scroll to Full Privacy (Pool B) | See CTA "Deploy from Full Privacy → Ekubo". |
| 4 | Click "Deploy from Full Privacy → Ekubo" | Navigate to `/agent` with Dashboard active and view scrolls to "Deploy to Ekubo" card. |
| 5 | Go to `/agent` then append `?highlight=deploy` or `#deploy-to-ekubo` | Dashboard tab active; scroll to Deploy card. |
| 6 | Go to `/mvp` → complete risk + recommendation step | See "Deploy" and "Or deploy via Ekubo (orchestration)" buttons. |
| 7 | Click "Or deploy via Ekubo (orchestration)" | Loading → success: message with receipt_id; positions list; "When does the AI redeploy?" + link to /agent. |

**Backend:** `POST /api/v1/zkdefi/orchestration/deploy` must be mounted (orchestration router in `main.py`). If 404, check backend mounts `app.api.routes.orchestration`.

---

## 6. Extension: real Ekubo execution

**Current state:** Orchestration and vault_execute return placeholder tx hashes; no on-chain swap/LP yet.

**To wire real execution:**

1. **Config / env**
   - Set `EKUBO_CHAIN_ID` for Starknet Sepolia in backend env (see [ENV.md](../ENV.md)). Used by `ekubo_client`, `real_pool_aggregator`, DEX routes.
   - Addresses are in `backend/app/services/ekubo_config.py` (Core, Router, Positions).

2. **Swap path (Router or Core#lock)**
   - Use Ekubo Router V3.0.13 for swaps: build calldata (route from `/pair/.../pools`, amounts, slippage), invoke Router entrypoint from a funded account (user or relayer).
   - Alternative: implement a Cairo contract with `locked` callback that performs approve + swap; call Core#lock from that contract.
   - Wire: `vault_execute_service` or a dedicated `ekubo_swap_executor` → build Router (or lock) calldata → return tx payload for frontend to sign, or use relayer/session key to submit.

3. **LP path (Positions)**
   - `ekubo_executor.EkuboContractExecutor` has `create_lp_position`, `collect_fees`, `remove_liquidity`; currently mock. Replace with real calls: approve token(s), call Positions.mint_and_deposit (pool key, tick range, amounts). Use `ekubo_config.EKUBO_POSITIONS_SEPOLIA` and Core address.
   - Wire: when orchestration/vault_execute allocation is "LP" (e.g. strategy indicates add liquidity), call executor with pool params from API (`/pair/.../pools`); return tx for sign or submit via relayer.

4. **Receipt / proof**
   - Keep orchestration receipt (receipt_id, proof_hash) as-is. When real tx is submitted, optionally update receipt with `tx_hash` via existing receipt confirm flow.

**References:** [EKUBO_SEPOLIA_INTEGRATION_SCOPE.md](../EKUBO_SEPOLIA_INTEGRATION_SCOPE.md), [design §2.3–2.4](2026-02-19-privacy-ekubo-orchestration-design.md), `ekubo_executor.py`, `ekubo_config.py`.

---

## 7. References

- Backend orchestration: `docs/plans/2026-02-19-privacy-ekubo-orchestration-implementation.md`
- Design: `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md`
- PROJECT_STATUS: `docs/PROJECT_STATUS.md`
- Env vars (including EKUBO_CHAIN_ID): `docs/ENV.md`
