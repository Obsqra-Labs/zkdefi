# Option A: End-to-End Testing & Data Pipeline Validation

**Estimated Time:** 2-3 hours  
**Goal:** Validate that all intelligence layers work correctly in the browser and data flows from vault → agent → decisions → opportunities → execution

---

## Phase 1: UI Flows in Browser (45 min)

### 1.1 Navigate to `/agent` and verify layout
- [ ] Header strip loads with network, tier, agent status
- [ ] Left rail (Capital Ledger) shows vault balance + Dark Ledger
- [ ] Center stage shows Execution Flow default view
- [ ] Right rail (Control Plane) shows Agent Insights
- [ ] All icons, text, and colors render correctly

### 1.2 Verify model loading in Circuit Board
- [ ] Open Circuit Board overlay (should show icon in center stage toolbar)
- [ ] MODELS palette expands showing all 24 models
- [ ] Can drag models onto canvas
- [ ] Model nodes render with threshold, confidence
- [ ] Properties panel updates when clicking models

### 1.3 Test Deploy overlay
- [ ] Open Deploy overlay (via OracleDashboardStrip or ControlPlane button)
- [ ] Swap, DCA, LP, Lending, Staking tabs render
- [ ] Can switch between tabs
- [ ] Basic form inputs work (amount, slippage, etc.)

---

## Phase 2: Data Pipeline Validation (90 min)

### 2.1 Backend API Health
- [ ] Check `/api/v1/health` returns `{"status": "ok"}`
- [ ] Check `/api/v1/zkml/risk_score` with test portfolio returns proof + calldata
- [ ] Check `/api/v1/zkml/anomaly` returns proof
- [ ] Check `/api/v1/agents/models/list` returns 24 models

### 2.2 Capital State API
- [ ] Check `/api/v1/zkdefi/vault/balance/{address}` returns STRK, ETH, USD
- [ ] Check `/api/v1/zkdefi/ledger/notes/{address}` returns Dark Ledger notes
- [ ] Check `/api/v1/zkdefi/position` returns deployed positions (Ekubo LP, Lending, Staking)
- [ ] Check `/api/v1/zkdefi/private-yield/vault/stats` returns blended APY

### 2.3 Intelligence Feed APIs
- [ ] Check `/api/v1/zkgraph/health` returns available: true
- [ ] Check `/api/v1/zkgraph/agent/query` returns confidence, action, zkrag_queries
- [ ] Check `/api/v1/strategies/opportunities` returns opportunities with scores
- [ ] Check `/api/v1/zkdefi/zkml/risk_score` returns user risk score

### 2.4 Frontend Data Flow
- [ ] Connect wallet in header strip
- [ ] Capital Ledger populates with real vault balance
- [ ] Deployed Positions section shows real positions (if any)
- [ ] Health section shows correct tier + progress
- [ ] OracleDashboardStrip loads opportunities and displays top 4
- [ ] AgentInsightsStrip loads risk scores and generates insight cards

### 2.5 Stream Data
- [ ] UnifiedStream loads with receipts filter active
- [ ] Receipts display with timestamps, amounts, proof badges
- [ ] Can toggle between receipt/decision/opportunity/privacy/governance/lending/staking filters
- [ ] Activity count updates when applying filters

---

## Phase 3: Issue Identification (30 min)

### 3.1 Document any data gaps
- [ ] Are receipts actually loading or still showing "down"?
- [ ] Are opportunities updating in real-time or stale?
- [ ] Is risk score accurate or placeholder data?
- [ ] Are deployed positions visible or missing?

### 3.2 Check for API errors
- [ ] Open browser DevTools console
- [ ] Note any 404, 500, or CSP errors
- [ ] Check network tab for failed API calls
- [ ] Document exact endpoints failing

### 3.3 Performance check
- [ ] Does CircuitBoard load quickly (< 2s)?
- [ ] Does Deploy overlay respond instantly?
- [ ] Does model palette render 24 items without lag?
- [ ] Any memory leaks or slow intervals?

---

## Phase 4: Fix Data Source Issues (30 min)

### 4.1 Common Issues to Fix

**Issue: JediSwap snapshot data stale**
- Fix: Check if `opportunities_feed_service.py` is caching old data
- Solution: Add cache invalidation or force refresh from Ekubo/oracle

**Issue: Risk scores returning placeholder values**
- Fix: Verify `zkml_risk_service.py` is connected to actual models
- Solution: Confirm EZKL circuit paths and model weights

**Issue: Activity feed "down" / receipts missing**
- Fix: Check `receipt_service.py` and `orchestration_receipts.json`
- Solution: Ensure receipts are being persisted after execution

**Issue: Deployed positions not showing**
- Fix: Verify `vault_positions` endpoint in `mission_control.py`
- Solution: Wire to `real_pool_aggregator` if not already connected

### 4.2 Fix Procedures
1. Identify failing endpoint
2. Check backend service implementation
3. Verify data source (JSON, API, DB)
4. Add logging to service
5. Restart backend
6. Re-test in browser

---

## Success Criteria

✅ All UI elements load without errors  
✅ All 24 models visible and draggable in Circuit Board  
✅ Vault balance and positions visible in Left Rail  
✅ Risk scores loaded in AgentInsights  
✅ Opportunities feed shows current data  
✅ At least 5/8 API endpoints return real data (not placeholders)  
✅ No critical errors in DevTools console  
✅ Browser can interact with all overlays (Deploy, CircuitBoard, etc.)

---

## If Issues Found

Document findings in `TESTING_RESULTS_2026-03-06.md`:
- Which APIs return real vs placeholder data
- Which UI elements are still "down"
- Performance metrics
- Recommended priority for fixing

This will determine order for Options B, C, D (Activity/History, Privacy, Governance).

---

## Proceed to Option A?

**Recommendation:** Yes. E2E validation first ensures the core intelligence pipeline is working before we invest time in the surrounding features.
