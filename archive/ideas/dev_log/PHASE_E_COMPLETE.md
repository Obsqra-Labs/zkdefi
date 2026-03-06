# Phase E Complete — Rebalancing + Frontend

**Date:** 2025-02-25  
**Status:** ✅ COMPLETE

---

## What was built

### 1. Rebalancing Service (`backend/app/services/rebalancer.py` — ~210 lines)

Core function: `compute_rebalance_plan(owner, risk_profile, deposit_amount, drift_threshold_pct)`

**Pipeline:**
1. Lists current LP positions via `ekubo_lp_service.list_positions(owner)`
2. Aggregates by pair (sums USD across position IDs belonging to same pair)
3. Generates a fresh target allocation via `generate_allocation()` from ai_allocation
4. Computes per-pool drift: |current_weight% − target_weight%|
5. If max_drift > threshold (default 10%), flags `needs_rebalance = true`
6. Generates actions:
   - **remove** — drift too high, calldata for `withdraw_and_burn` on Ekubo Positions contract
   - **add** — pool not represented but should be
   - **keep** — drift within bounds

### 2. POST /strategies/rebalance endpoint

Request:
```json
{
  "owner_address": "0x05fe...",
  "risk_profile": "balanced",
  "deposit_amount": null,    // optional, auto-sums positions
  "drift_threshold_pct": 10  // optional, default 10
}
```

Response:
```json
{
  "timestamp": "...",
  "risk_profile": "balanced",
  "deposit_amount": 46999.99,
  "drift_threshold_pct": 10.0,
  "max_drift_pct": 35.74,
  "needs_rebalance": true,
  "actions": [
    {"action": "keep",   "pair": "STRK/USDC", "drift_pct": 0.0},
    {"action": "keep",   "pair": "ETH/USDC",  "drift_pct": 5.74, "current_weight_pct": 4.26, "target_weight_pct": 10.0},
    {"action": "remove", "pair": "WBTC/USDT", "drift_pct": 35.74, "current_weight_pct": 95.74, "target_weight_pct": 60.0,
     "calldata": {"calls": [{"entrypoint": "withdraw_and_burn", ...}]}}
  ],
  "new_attestation_hash": "e52ada..."
}
```

### 3. Frontend Strategies API Client (`frontend/src/lib/api/strategies.ts` — ~160 lines)

New typed client hitting `/api/v1/strategies/*` endpoints:
- `getYieldSnapshot(owner)` → `YieldSnapshotResponse`
- `getRebalancePlan(owner, profile)` → `RebalancePlanResponse`
- `getAuditTrail(user)` → `AuditTrailResponse`
- `getVaultSummary(user)` → `VaultSummaryResponse`
- `executeAllocation(amount, profile, user)` → `ExecuteAllocationResponse`

### 4. Upgraded VaultDashboardPanel.tsx (462 → ~620 lines)

Added two new modes to the vault dashboard:

**Yield Mode:**
- Total fees earned (USD)
- Per-position breakdown: pair, APR, status (estimated/on-chain), fees
- Harvest status indicator
- Refresh button with spinner

**Rebalance Mode:**
- Status banner: green "balanced" or amber "drift detected" with max drift %
- Per-pool action cards color-coded: red (remove), green (add), gray (keep)
- Current weight → target weight with drift percentage
- Attestation hash display

**Overview additions:**
- Two new quick-link cards: "Yield" (shows cumulative fees) and "Rebalance" (shows drift status)
- Both fetch data on click and navigate to their respective modes

---

## What was learned

### 1. Drift is real and immediate
With positions from Phase C (2× WBTC/USDT, 1× ETH/USDC, 1× STRK/USDC with $0), drift hit **35.74%** immediately. In production with live prices, the rebalancer would trigger within hours of initial deployment.

### 2. Next.js pre-build pattern
The frontend uses `(test -f .next/BUILD_ID || next build) && next start`. New files require deleting BUILD_ID and restarting PM2 to trigger a fresh build. Hot reload doesn't apply in production mode.

### 3. Strategy vs Vault API namespacing
The vault endpoints use `/api/v1/zkdefi/vault/*` while strategy endpoints use `/api/v1/strategies/*`. The frontend needed a separate `stratFetch` helper with different base URL. This matters for reverse proxy routing in production.

### 4. Position aggregation matters
The rebalancer aggregates multiple positions in the same pair before computing drift. Without this, a user with 3 WBTC/USDT positions at different fee tiers would see misleading per-position drift.

### 5. Calldata is ready but gated
Remove calldata (`withdraw_and_burn`) is pre-computed and returned in the response, but actual execution is gated behind `EXECUTOR_LIVE_SUBMIT=true`. This allows the UI to show the plan without risk.

---

## What it unlocks

### Immediate
- **Full vault lifecycle visible in UI:** deposit → allocate → monitor yield → detect drift → rebalance
- **Operator monitoring:** backend can run rebalance checks on a cron and alert when drift exceeds threshold
- **Audit-ready:** every allocation, yield event, and rebalance plan is recorded with attestation hashes

### Next steps enabled
- **Auto-rebalancer cron:** Schedule `compute_rebalance_plan()` every N hours, auto-execute if `needs_rebalance && drift > 15%`
- **User-triggered rebalance:** UI rebalance mode already shows the plan; add an "Execute" button that calls `/execute-allocation` with the new targets
- **Multi-strategy comparison:** UI could show side-by-side plans for conservative/balanced/aggressive profiles
- **Real yield tracking:** Once positions age and Ekubo has claimable fees, `yield_collector` on-chain reads will populate real data replacing estimates
- **Production deploy:** All 5 phases are self-contained; deploy backend + rebuild frontend

---

## Files created/modified

| File | Action | Lines |
|------|--------|-------|
| `backend/app/services/rebalancer.py` | Created | ~210 |
| `backend/app/api/routes/strategies.py` | Modified | +70 (rebalance endpoint) |
| `frontend/src/lib/api/strategies.ts` | Created | ~160 |
| `frontend/src/components/zkdefi/VaultDashboardPanel.tsx` | Modified | +160 (yield + rebalance modes) |

## Verified

- ✅ `POST /strategies/rebalance` returns correct drift analysis with remove calldata
- ✅ Frontend builds with no TypeScript errors
- ✅ Agent page loads (HTTP 200) after rebuild
- ✅ All Phase A-D endpoints still functional
