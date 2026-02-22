# Autonomous Yield Vault MVP: Quick Reference Guide

**TL;DR:** Users deposit STRK → AI allocates to deposits + LP → yields tracked with verifiable proofs → AI rebalances autonomously. All decisions immutably recorded.

---

## 🎯 THE MISSION

Build a **verifiable AI yield optimization system** where:
1. **User deposits** generic token (STRK)
2. **AI decides** how to allocate across strategies (based on risk profile)
3. **Strategies execute**: deposits to lending protocols + LP on Ekubo
4. **Yield earned** from all sources
5. **AI rebalances** autonomously when market conditions change
6. **Every decision verified** via Stone/STARK proofs
7. **Audit trail immutable** - user can prove "this AI decision led to this yield"

---

## 📊 THREE CORE FLOWS

### Flow 1: DEPOSIT & ALLOCATE (Days 1-3 of MVP)
```
User: "Deposit 1000 STRK, I'm moderate risk (level 6)"
                ↓
AI: "Risk 6 = 50/50 deposits/LP. APYs are Nostra 4%, Ekubo 12%"
                ↓
AI: "Fine-tune: 45% Nostra (450 STRK), 55% Ekubo (550 STRK)"
                ↓
Proof: decision_hash=0x555, proof_hash=0x789
                ↓
Execute:
  - 450 STRK → Nostra
  - 550 STRK → Ekubo position #7
                ↓
Record: SmartVault.execute_allocation(decision_hash=0x555, proof_hash=0x789)
                ↓
Result: User earns ~8.3% blended APY (verifiable AI decision)
```

### Flow 2: YIELD COLLECTION (Daily)
```
Scheduler: "It's 00:00 UTC, collect yields"
                ↓
Nostra: +2 STRK since yesterday
Ekubo: +5.2 STRK in trading fees
                ↓
Record: SmartVault.record_yield(user=0x123, protocol="nostra", amount=2, decision_hash=0x555)
        SmartVault.record_yield(user=0x123, protocol="ekubo", amount=5.2, decision_hash=0x555)
                ↓
Query: GET /vault/yield-breakdown/0x123
  → Total: 7.2 STRK
  → By protocol: Nostra 2, Ekubo 5.2
  → By decision: all from 0x555 (which allocated 450/0/550)
```

### Flow 3: REBALANCE (When needed)
```
Triggers:
  ✓ Time: 7 days since last rebalance
  ✓ Volatility: changed >10%
  ✓ Yield: better opportunity exists
                ↓
Close old positions (receive 452 + 555.2 = 1007.2 STRK)
                ↓
AI: "New metrics: Nostra 4.2%, zkLend 6.5%, Ekubo 10.5%"
AI: "New allocation: 40% Nostra (406), 25% zkLend (252), 35% Ekubo (349)"
AI: decision_hash=0x888, proof_hash=0x999
                ↓
Execute new positions
                ↓
Record: SmartVault.rebalance(old=0x555, new=0x888)
                ↓
Audit: Shows decision 0x555 earned 7.2 STRK, now on decision 0x888
```

---

## 🔑 KEY DECISIONS (Architecture)

### Decision 1: Dual Strategies
- **Deposits (safe):** Nostra + zkLend, ~4-6% APY, stable
- **LP (risky):** Ekubo, 5-15% APY, trading fees, volatile
- **Why:** Blend risk/reward based on user preference

### Decision 2: Verifiable AI
- **Every allocation decision** gets a hash (0x555...)
- **Every hash** gets a Stone/STARK proof (0x789...)
- **Every proof** is cryptographically valid
- **Every yield** links back to decision hash
- **Why:** Prove AI decision actually led to yield (trustless verification)

### Decision 3: Autonomous Rebalancing
- **Automatic triggers:** time (7 days), volatility (>10%), yield opportunity (>2%)
- **Run AI model again** with current metrics
- **Execute new positions** (close old, open new)
- **Record new decision** with new proof
- **Why:** Optimize yield continuously without manual intervention

### Decision 4: Immutable Audit Trail
- **SmartVault records:** every decision, every yield, every rebalance
- **On-chain storage:** decision_hash + proof_hash only (efficient)
- **Off-chain storage:** full decision data (queryable)
- **Why:** Users can reconstruct/verify any decision

---

## 🛠️ TECH STACK (Simple Version)

| Component | Tech | Purpose |
|-----------|------|---------|
| **Contracts** | Cairo | SmartYieldVault, RiskProfileManager, YieldTracker |
| **Backend API** | FastAPI | 6 endpoints (/deposit, /yield-breakdown, etc.) |
| **AI Services** | Python classes | RiskEngine, PoolMetrics, AIAllocationEngine, etc. |
| **Proofs** | Stone/STARK | Verify AI computations |
| **Blockchain** | Starknet Sepolia | Deploy contracts, record decisions |
| **Protocols** | Nostra, zkLend, Ekubo | Yield sources |
| **Frontend** | React/Next.js | Dashboard, deposit form, audit trail |
| **Database** | SQLite | Store decisions, yields, user profiles |

---

## 📋 THE 6 ENDPOINTS (MVP)

```python
POST   /vault/deposit                 # User deposits, AI allocates
  Input:  {amount: 1000, risk_level: 6, token: STRK}
  Output: {decision_hash: 0x555, proof_hash: 0x789, allocation: [450,0,550]}

GET    /vault/yield-breakdown/{user}  # How much earned from where
  Output: {total: 7.2, by_protocol: {nostra: 2, ekubo: 5.2}, by_decision: {0x555: 7.2}}

GET    /vault/ai-decision/{hash}      # View decision with proof + results
  Output: {decision_hash, inputs, outputs, proof, actual_yield, verified: true}

GET    /vault/audit/{user}            # Full history (decisions → yields → rebalances)
  Output: [{timestamp, decision_hash, allocation, resulting_yield}, ...]

POST   /vault/rebalance               # Manual or auto trigger
  Input:  {user_address, optional_new_allocation}
  Output: {old_decision, new_decision, rebalance_executed: true}

GET    /vault/verify-proof/{hash}     # Verify a Stone proof
  Output: {verified: true, proof_type: "Stone/STARK"}
```

---

## 📅 6-WEEK TIMELINE

| Week | What | Status |
|------|------|--------|
| **1** | Deploy contracts, build risk engine | ← START HERE |
| **2** | AI allocation model, proof generation | Build AI |
| **3** | Execute deposits to protocols, LP creation | Execute |
| **4** | Collect yields, build audit trail | Track |
| **5** | Rebalancing, frontend UI | UI + Rebalance |
| **6** | Testing, security, launch | ✅ LAUNCH |

**Total Effort:** 123 hours (3-4 devs × 6 weeks)  
**Deliverable:** Production-ready verifiable AI vault  

---

## 🎓 WHAT MAKES THIS SPECIAL

### 1. Verifiable AI (First in DeFi?)
- AI decision → Stone proof → actual yield
- Can query: "which decision am I in?" + "how much did it earn?"
- All cryptographically linked

### 2. Autonomous Operation
- No manual management
- Rebalances automatically when market changes
- Set-and-forget yield optimization

### 3. Complete Audit Trail
- Every decision recorded on-chain (hashes only)
- Every yield linked to decision
- Users can reconstruct/verify full history

### 4. Modular Design
- Easy to add more protocols (Aave, Lido, others)
- Easy to improve AI model
- Easy to extend to other chains

---

## ⚠️ RISKS & HOW WE HANDLE THEM

| Risk | Mitigation |
|------|-----------|
| Ekubo address unknown | Research first, use testnet |
| Stone prover slow/unavailable | Hardcode test proofs, integrate real prover later |
| Yield collection bugs | Use both events + manual balance checks |
| Rebalancing loops | Add 24h cooldown between rebalances |
| Proof verification fails | Heavy testing, cryptographic audit |
| **User funds at risk** | Use official contracts only, no custody, manual override |

---

## 📱 USER JOURNEY

```
Day 1:
  1. User visits vault page
  2. Deposits 1000 STRK
  3. Selects risk level (slider 1-10)
  4. Clicks "Deposit & Allocate"
  5. Sees: "Your allocation: 450 Nostra, 550 Ekubo"
  6. Sees: "Expected yield: 8.3% APY"
  7. Sees: "AI decision: 0x555... (verified ✓)"

Day 3-7:
  1. User checks dashboard
  2. Sees: "Total earned: 7.2 STRK"
  3. Breakdown: "Nostra: 2, Ekubo: 5.2"
  4. By decision: "From allocation 0x555...: 7.2"
  5. Clicks "View AI Decision 0x555"
  6. Sees: inputs (risk=6, APYs), outputs (allocation), proof, results
  7. Clicks "Verify Proof" → sees ✓ Valid

Week 2:
  1. System triggers rebalance (volatility spike)
  2. User notification: "Rebalancing to 406/252/349"
  3. New decision: 0x888 (verified ✓)
  4. Audit trail updated
  5. Yields from old decision (0x555) still show correct amount
```

---

## 🚀 LAUNCH READINESS

✅ **Specification:** 100% complete (91 KB docs)  
✅ **Architecture:** Validated and documented  
✅ **Task breakdown:** 47 tasks with effort estimates  
✅ **Tech decisions:** All made (Cairo, FastAPI, Stone, Starknet)  
✅ **Contract design:** Complete (3 contracts, all functions)  
✅ **API design:** Complete (6 endpoints, all request/response)  
✅ **Data models:** Complete (user, decision, yield, position)  

🔄 **In Progress:** None (spec phase complete)  
⏸️ **Pending:** Implementation (ready to start)  

---

## 💡 THE ELEVATOR PITCH

"Autonomous yield vault that uses AI to allocate your deposits across lending protocols and liquidity pools. Every allocation decision is cryptographically verified and linked to actual results. The system automatically rebalances when market conditions change. Complete audit trail proves which AI decisions earned which yields."

---

## 📞 KEY CONTACTS

**Architecture:** [Contact architect]  
**Contracts:** [Contact Cairo dev]  
**Backend:** [Contact backend lead]  
**Frontend:** [Contact frontend lead]  
**Project Manager:** [Contact PM]  

---

## 🎯 SUCCESS CRITERIA (SIMPLE VERSION)

✅ User can deposit  
✅ AI allocates to 2+ strategies  
✅ Yields earned from all sources  
✅ Proofs are verifiable  
✅ Rebalancing works  
✅ Audit trail complete  
✅ No fund loss  

---

## 📖 FULL DOCUMENTATION

1. [LAUNCH_READY_SPECIFICATION.md](./LAUNCH_READY_SPECIFICATION.md) - This file (overview)
2. [MVP_AUTONOMOUS_VAULT_SYSTEM.md](./MVP_AUTONOMOUS_VAULT_SYSTEM.md) - System design + flows
3. [IMPLEMENTATION_ROADMAP_6WEEKS.md](./IMPLEMENTATION_ROADMAP_6WEEKS.md) - Sprint planning
4. [TASK_LIST_DETAILED_47_TASKS.md](./TASK_LIST_DETAILED_47_TASKS.md) - Individual tasks
5. [SYSTEM_ARCHITECTURE_COMPLETE.md](./SYSTEM_ARCHITECTURE_COMPLETE.md) - Technical deep-dive

**Start with:** This file (overview)  
**Then read:** System design for context  
**Then code:** Follow task list + roadmap  

---

## ✨ FINAL NOTES

- **This is not theoretical.** Every detail planned, every component designed.
- **This is achievable.** 6 weeks with 3-4 developers.
- **This is important.** First verifiable AI + yield system. Foundation for Obsqra's main product.
- **This is ready.** Start coding now.

---

**Document Version:** 1.0  
**Created:** February 16, 2026  
**Status:** ✅ READY FOR TEAM  
**Next Step:** Print/share with team, assign Week 1 tasks, start coding!

