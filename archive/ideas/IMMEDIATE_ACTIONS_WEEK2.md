# IMMEDIATE ACTION ITEMS - Week 2 (Feb 18-24)

**Current Date:** February 18, 2026  
**Status:** Frontend + Services ready, need to connect and compile contracts  
**Timeline:** 6 days to Week 2 completion

---

## 🚨 CRITICAL PATH (Must Do First)

### 1️⃣ Smart Contract Compilation & Deployment (TODAY/TOMORROW)

**Files to create/update:**
```
contracts/src/vault_manager_v2.cairo       ← Use template
contracts/src/strategy_router_v4.cairo     ← Use template
contracts/src/audit_trail_v2.cairo         ← Use template
```

**Commands:**
```bash
cd /opt/obsqra.starknet/contracts
scarb build

# Deploy to Sepolia (requires account setup)
sncast declare --contract-class VaultManager
sncast deploy VaultManager <token> <audit_trail_addr>
```

**Expected Output:**
```
Deployed VaultManager: 0x0123...
Deployed StrategyRouter: 0x4567...
Deployed AuditTrail: 0x89ab...
```

**Deadline:** ⏰ Wednesday Feb 20 EOD

---

### 2️⃣ Implement Actual Contract Calls (Wednesday-Thursday)

**File:** `backend/app/services/contract_executor.py`  
**Current Status:** MOCKS  
**Action:** Replace with real Starknet RPC calls

**Critical Methods to Fix:**
```python
# Line ~150
async def _call_vault_deposit(self, user, amount, risk_profile):
    # CHANGE FROM: return "0x0", 1  (mock)
    # TO: actual Starknet contract call
    pass

# Line ~180
async def _record_analysis_in_audit_trail(self, ...):
    # CHANGE FROM: return 1  (mock)
    # TO: actual AuditTrail.record_analysis() call
    pass

# Line ~210
async def _create_ekubo_position(self, user, pool_id, amount):
    # CHANGE FROM: return "0x0"  (mock)
    # TO: actual Ekubo.mint_and_deposit() call
    pass

# Line ~230
async def _create_vesu_deposit(self, user, pool_id, amount):
    # CHANGE FROM: return "0x0"  (mock)
    # TO: actual Vesu.supply() call
    pass
```

**Deadline:** ⏰ Thursday Feb 21 EOD

---

### 3️⃣ Frontend Integration with Execution (Wednesday-Thursday)

**File:** `frontend/src/app/mvp/page.tsx`  
**Current Status:** Missing execute button wireup  
**Action:** Add handler + button

**Search for:** `// Deploy Strategy Handler` (line ~150)

**Add this button to render:**
```tsx
{step === "strategy" && strategyRecommendation && (
  <button 
    onClick={handleConfirmAndExecute}
    className="btn-primary w-full py-3"
  >
    Execute Strategy ({strategyRecommendation.total_expected_apy.toFixed(1)}% APY)
  </button>
)}

{step === "deploying" && (
  <div className="text-center">
    <div className="spinner"></div>
    <p>Deploying strategy...</p>
  </div>
)}
```

**Deadline:** ⏰ Thursday Feb 21 EOD

---

## 📋 CHECKLIST - Files Status

### ✅ COMPLETED (Don't touch)
- [x] `frontend/src/app/mvp/components/RiskProfileSelector.tsx` - Done
- [x] `frontend/src/app/mvp/components/PoolAnalysisDisplay.tsx` - Done
- [x] `frontend/src/app/mvp/components/StrategyRecommendation.tsx` - Done
- [x] `backend/app/services/zkml_pool_evaluator.py` - Done
- [x] `backend/app/services/llm_decision_engine.py` - Done
- [x] `backend/app/services/pool_aggregator.py` - Done
- [x] `backend/app/api/routes/risk_profile.py` - Done

### 🔴 CRITICAL (In progress)
- [x] `backend/app/services/contract_executor.py` - CREATED (need to implement calls)
- [x] `backend/app/services/allocation_executor.py` - CREATED (need to implement calls)
- [x] `backend/app/api/routes/deposits.py` - CREATED (wired correctly)
- [ ] `contracts/src/vault_manager_v2.cairo` - COMPILE & DEPLOY
- [ ] `contracts/src/strategy_router_v4.cairo` - COMPILE & DEPLOY
- [ ] `contracts/src/audit_trail_v2.cairo` - COMPILE & DEPLOY

### 🟡 IMPORTANT (Due Friday)
- [ ] `frontend/src/app/mvp/page.tsx` - UPDATE with execute handler
- [ ] `backend/app/services/contract_executor.py` - IMPLEMENT real calls
- [ ] `backend/app/services/allocation_executor.py` - IMPLEMENT real calls
- [ ] `.env` - UPDATE with deployed contract addresses

### ⏳ NICE-TO-HAVE (After Friday)
- [ ] Database for audit trail (currently in-memory)
- [ ] Proof verification endpoints
- [ ] Yield tracking dashboard

---

## 📞 Where To Get Code

All referenced contracts are already in folder:
```
/opt/obsqra.starknet/contracts/src/
├─ vault_manager_v2.cairo  (use as-is, just compile)
├─ strategy_router_v4.cairo (use as-is, just compile)
└─ audit_trail_v2.cairo    (use as-is, just compile)
```

All referenced services just created:
```
/opt/obsqra.starknet/zkdefi/backend/app/services/
├─ contract_executor.py         (CREATED)
├─ allocation_executor.py        (CREATED)
└─ audit_trail_service.py        (EXISTS - use as-is)
```

All referenced routes:
```
/opt/obsqra.starknet/zkdefi/backend/app/api/routes/
├─ risk_profile.py              (EXISTS - use as-is)
├─ deposits.py                  (CREATED)
└─ strategies.py                (EXISTS - use as-is)
```

---

## 🧪 Testing After Each Step

**After Step 1 (Compile):**
```
contracts/src/target/dev/VaultManager.starknet_artifact.json exists ✓
```

**After Step 2 (Deploy):**
```
VAULT_MANAGER_ADDRESS = 0x... (on Sepolia)
Can check on StarkScan ✓
```

**After Step 3 (Implement):**
```
Test: POST /api/v1/deposits/submit
  Body: { user_address, deposit_amount, risk_profile, allocations, ... }
  Expected: { success: true, deposit_id: 1, vault_tx_hash: "0x..." }
```

**After Step 4 (Frontend):**
```
Open frontend
Select risk profile → See pools → See recommendation → Click Execute → See TX hash
```

---

## 🔑 Key Environment Variables

Create in `.env`:
```
# Starknet
STARKNET_RPC_URL=https://sepolia.api.starknet.io/rpc/v0_7
STARKNET_PRIVATE_KEY=0x...

# Deployed Contracts
VAULT_MANAGER_ADDRESS=0x...
STRATEGY_ROUTER_ADDRESS=0x...
AUDIT_TRAIL_ADDRESS=0x...
TOKEN_ADDRESS=0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7  # ETH on Sepolia

# Ekubo
EKUBO_POSITIONS_ADDRESS=0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5
EKUBO_CORE_ADDRESS=0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
```

---

## ❓ Common Issues

**"Contract not compiled"**
- Solution: Run `scarb build` in contracts directory

**"Invalid JSON in starknet-py call"**
- Solution: Check function signatures match contract ABI

**"Deposit TX not found"**
- Solution: Need to wait for block confirmation, not immediate

**"Event not in receipt"**
- Solution: Parse events correctly:
  ```python
  for event in receipt.events:
      if event.from_address == contract_address:
          data = event.data  # This is the event data
  ```

---

## 📊 Success Metrics

By EOD Friday Feb 23:
- [ ] All 3 contracts compiled without errors
- [ ] All 3 contracts deployed to Sepolia
- [ ] `/deposits/submit` endpoint works end-to-end
- [ ] User can see TX hash for their deposit
- [ ] At least 1 test user can complete full flow
- [ ] Audit trail records all decisions
- [ ] No crashes in frontend or backend

---

## 🎯 The Big Picture

This week we're completing the **User Deposit → Allocation → Execution** loop.

```
Week 1 Done:     Risk Profile Selection + Pool Analysis + LLM Recommendation
Week 2 (NOW):    ADD: Smart Contract Execution + Audit Trail Recording
Week 3:          Yield Collection + Fee Tracking + Dashboard
Week 4:          Proof Verification + Polish + Demo Launch
```

---

**Status:** 🟢 Ready to execute  
**Next Action:** Compile contracts TODAY  
**Questions?** Check WEEK2_CONNECTION_GUIDE.md

LET'S BUILD! 🚀

