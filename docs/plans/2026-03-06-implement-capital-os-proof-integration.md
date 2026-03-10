# Implementation Plan: Capital OS Proof Integration

**Date:** 2026-03-06  
**Target:** Integrate strategies, proofs, and intelligent data into new Capital OS layout  
**Batch Size:** 3 tasks per batch  
**Verification:** Run build, check console, verify data flow

---

## Tasks

### Task 1: Create Capital Ledger Component with Proof-Backed Data
**Goal:** Build left rail showing vault, dark ledger, deployed positions with proof validation

**Steps:**
1. Create `frontend/src/components/zkdefi/mission-control/CapitalLedger.tsx`
2. Add sections: Vault Balance, Dark Ledger, Deployed Positions (with genome factors), Health
3. Each section fetches from:
   - `/api/v1/vault/balance` (vault)
   - `/api/v1/zkdefi/ledger/notes/{address}` (dark ledger)
   - `/api/v1/vault/positions/{address}` (deployed with strategy genome)
   - `/api/v1/zkdefi/reputation/user/{address}` (health/tier)
4. Display proof hashes next to APY values
5. Import and use in agent/page.tsx

**Verification:**
- Build succeeds: `npm run build` in frontend
- No TypeScript errors
- Console shows no 404s for ledger endpoints
- Vault balance displays correctly

---

### Task 2: Create Execution Flow Component with Proof Package Status
**Goal:** Build center stage showing Intent → Policy → Proof Package → Execution flow

**Steps:**
1. Create `frontend/src/components/zkdefi/mission-control/ExecutionFlow.tsx`
2. Add collapsible steps:
   - [1] INTENT - Current intent with status
   - [2] POLICY - Policy constraints applied
   - [3] PROOF PACKAGE - Display all proof hashes (risk, anomaly, solvency, integrity)
   - [4] EXECUTION - Result or pending status
3. Fetch from `/api/v1/zkdefi/rebalancer/autonomous/status/{address}`
4. Display [Inspect Proof Set] button to show full proof details
5. Add expand/collapse for each step

**Verification:**
- Build succeeds
- No console errors
- Proof hashes display (or show placeholder if not available)
- Steps show correct status states

---

### Task 3: Create Oracle Intelligence Strip (Signals/Radar/Genome)
**Goal:** Integrate Oracle Surface into center as collapsible intelligence section

**Steps:**
1. Create `frontend/src/components/zkdefi/mission-control/OracleIntelligenceStrip.tsx`
2. Make it collapsible/minimizable
3. Import OracleSignalsTab, OracleRadarTab, OracleGenomeTab
4. Render as tabs within the strip (not separate page)
5. Pass address and handlers
6. Style to fit 3-column layout (not full-width)
7. Add to center stage between ExecutionFlow and Memory Lane

**Verification:**
- Build succeeds
- Oracle tabs render without errors
- Can click tabs to switch views
- Data loads from `/api/v1/strategies/opportunities`
- Proof hashes visible in Signals recommendations

---

### Task 4: Create Header Strip Component
**Goal:** Build persistent header showing agent status, gate, proof package, tier

**Steps:**
1. Create `frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx`
2. Three sections:
   - Left: Brand (zkde.fi / Capital OS)
   - Center: Agent ID + Gate Status (PASS/BLOCKED/DEFERRED) + Proof Package (Ready/Pending)
   - Right: Network mode + Tier badge + Wallet connect
3. Fetch from:
   - `/api/v1/zkdefi/rebalancer/autonomous/status/{address}` (agent ID, gate)
   - `/api/v1/zkdefi/proofs/stats` (proof package status)
   - `/api/v1/zkdefi/reputation/user/{address}` (tier)
4. Make thin and persistent across all views
5. Add styling to match Mission Control design

**Verification:**
- Build succeeds
- Header displays with correct data
- Gate status shows correctly (PASS/BLOCKED/DEFERRED)
- Tier badge displays user tier

---

### Task 5: Integrate All Components into Agent Page
**Goal:** Wire all new components into /app/agent/page.tsx with 3-column layout

**Steps:**
1. Update `frontend/src/app/agent/page.tsx`
2. Import: HeaderStrip, CapitalLedger, ExecutionFlow, OracleIntelligenceStrip, ControlPlane
3. Implement layout:
   ```jsx
   <HeaderStrip address={address} />
   <div className="flex gap-4">
     <CapitalLedger address={address} />
     <div className="flex-1">
       <ExecutionFlow address={address} />
       <OracleIntelligenceStrip address={address} />
     </div>
     <ControlPlane address={address} />
   </div>
   ```
4. Pass all necessary props and handlers
5. Add responsive styling for 3-column layout
6. Test that all components render without overlapping

**Verification:**
- Build succeeds
- Layout is 3-column with proper spacing
- All components render
- No console errors
- Window resize doesn't break layout

---

### Task 6: Wire Proof Hash Display in Strategy Recommendations
**Goal:** Show proof validation for every strategy recommendation

**Steps:**
1. Update `frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx`
2. For each opportunity in response, display:
   - Pool name + APY
   - Strategy ID
   - Genome factors (yield_score, risk_score, efficiency_score)
   - **Proof hash** (risk_score_proof, anomaly_proof)
   - AI reasoning
3. Add [Verify Proof] button to show proof details on Madara L3
4. Color-code proof status: ✓ Valid (green) / ⚠ Pending (yellow) / ✗ Failed (red)

**Verification:**
- Build succeeds
- Proof hashes display next to opportunities
- Proof status indicators show correctly
- [Verify Proof] button doesn't crash

---

### Task 7: Connect Reputation System to Proof Success
**Goal:** Show how successful executions increase reputation tier

**Steps:**
1. Update `frontend/src/components/zkdefi/mission-control/CapitalLedger.tsx` Health section
2. Add progress bar to next tier:
   - Current tier: "Intermediate" (Tier 2)
   - Proofs submitted: 42
   - Proofs verified: 40
   - Success rate: 95.2%
   - Progress to Tier 3: 8/10 verified proofs needed
3. Fetch from `/api/v1/zkdefi/reputation/tiers` (tier requirements)
4. Fetch from `/api/v1/zkdefi/reputation/user/{address}` (user progress)
5. Display badges (zkML awards) if any

**Verification:**
- Build succeeds
- Tier progress bar displays correctly
- Shows correct proof count and success rate
- Badges display if user has any

---

### Task 8: Add Live Data Polling for Proof Status
**Goal:** Auto-update proof package and execution status in real-time

**Steps:**
1. Create `frontend/src/hooks/useProofStatusPoller.ts`
2. Poll `/api/v1/zkdefi/rebalancer/autonomous/status/{address}` every 3 seconds
3. Update ExecutionFlow component state when proofs complete
4. Add [Refresh] button to manually trigger fetch
5. Handle network errors gracefully (show retry UI)
6. Stop polling when component unmounts

**Verification:**
- Build succeeds
- Proof status updates without page reload
- No console errors or excessive API calls
- Polling stops on unmount

---

### Task 9: Create Memory Lane / Proof History
**Goal:** Show historical proof execution timeline in center-bottom

**Steps:**
1. Create `frontend/src/components/zkdefi/mission-control/MemoryLane.tsx`
2. Fetch from `/api/v1/zkdefi/mc/stream/{address}?types=all&limit=30` (execution history)
3. Display timeline of:
   - Intent submitted
   - Policy applied
   - Proofs generated (show type: risk, anomaly, solvency, integrity)
   - Execution completed/failed
   - Tier progress (if tier increased)
4. Each entry shows timestamp + proof hash (clickable)
5. Virtualize for scrolling performance

**Verification:**
- Build succeeds
- Timeline displays historical executions
- Proof hashes are clickable
- Scrolling is smooth (virtualization works)

---

### Task 10: Final Build & Verification
**Goal:** Full build and end-to-end verification

**Steps:**
1. Run `npm run build` in frontend
2. Run `pm2 restart zkdefi-frontend --update-env`
3. Wait 5 seconds for frontend to start
4. Open https://zkde.fi in browser
5. Check:
   - Header strip shows correctly
   - Left rail (Capital Ledger) populated with data
   - Center stage showing execution flow with proof hashes
   - Oracle intelligence strip accessible
   - Console has no errors or warnings
   - All data loads within 5 seconds
   - No CSP violations or 404s

**Verification:**
- No console errors
- All 3 columns render
- Data loads from all endpoints
- Proof hashes visible
- Can navigate oracle tabs
- Performance acceptable (no lag)

---

## Success Criteria

✅ All 10 tasks completed  
✅ Full 3-column layout renders without errors  
✅ Proof hashes displayed for strategies  
✅ Oracle Intelligence tabs accessible  
✅ Reputation tier progress visible  
✅ No console errors or CSP violations  
✅ All data flows from correct API endpoints  
✅ Responsive design works on smaller screens  

---

## Rollback Plan

If critical issues arise:
1. Restore `frontend/src/app/agent/page.tsx` from git
2. Restore `frontend/src/components/zkdefi/mission-control/` from git
3. Run `npm run build && pm2 restart zkdefi-frontend --update-env`

---

## Notes

- All components use proof hashes as source of truth, not mock data
- Proof verification can happen by checking Madara L3 fact store
- Strategy recommendations come from deterministic Python circuits
- Reputation system automatically updates on successful executions
