# Week 2 Connection Guide - Everything Wired Together

**Status:** Frontend components + Backend services + Smart contracts all ready  
**Timeline:** Feb 18-24  
**Goal:** User can deposit → see recommendation → execute → track

---

## What We Have (Week 1 Complete)

### ✅ Frontend (Already Built)
```
frontend/src/app/mvp/page.tsx
├─ RiskProfileSelector ✅ (user picks Conservative/Balanced/Aggressive)
├─ PoolAnalysisDisplay ✅ (shows evaluated pools with flags)
├─ StrategyRecommendation ✅ (shows LLM recommendation)
└─ PortfolioDisplay ✅ (shows active positions)
```

### ✅ Backend Services (Ready to Wire)
```
backend/app/services/
├─ zkml_pool_evaluator.py ✅ (scores pool risk 0-100)
├─ llm_decision_engine.py ✅ (recommends allocation)
├─ pool_aggregator.py ✅ (fetches real pool data)
├─ contract_executor.py ✅ (NEW - executes deposits)
├─ allocation_executor.py ✅ (NEW - creates LP/yield positions)
└─ audit_trail_service.py ✅ (NEW - records all decisions)
```

### ✅ Backend Routes (Ready)
```
backend/app/api/routes/
├─ risk_profile.py ✅ (/risk/analyze, /risk/recommend)
├─ strategies.py ✅ (/strategies/recommend)
├─ deposits.py ✅ (NEW - /deposits/submit)
└─ audit_trail.py (TODO - /audit endpoints)
```

### ⏳ Smart Contracts (Week 1-2)
```
contracts/src/
├─ vault_manager_v2.cairo (TODO - compile & deploy)
├─ strategy_router_v4.cairo (TODO - compile & deploy)
└─ audit_trail_v2.cairo (TODO - compile & deploy)
```

---

## The Complete Data Flow

### Step 1: User Deposits + Selects Risk

**Frontend:**
```typescript
// frontend/src/app/mvp/page.tsx

const handleRiskProfileSelect = async (profile: RiskProfileType) => {
  setSelectedProfile(profile);
  
  // Call API to analyze pools for this risk profile
  const response = await fetch("/api/v1/risk/analyze", {
    method: "POST",
    body: JSON.stringify({ risk_profile: profile })
  });
  
  const data = await response.json();
  setAvailablePools(data.recommended_pools);
  
  // Auto-get strategy recommendation
  const recResponse = await fetch("/api/v1/risk/recommend", {
    method: "POST",
    body: JSON.stringify({
      risk_profile: profile,
      amount: depositAmount,
      available_pools: data.recommended_pools
    })
  });
  
  const recommendation = await recResponse.json();
  setStrategyRecommendation(recommendation);
  setStep("strategy");
};
```

**Backend (`backend/app/api/routes/risk_profile.py`):**
```python
@router.post("/analyze")
async def analyze_pools(request: AnalyzeRequest):
    """
    1. Fetch pool data from Ekubo, JediSwap, Vesu
    2. Run zkML evaluator on each pool
    3. Return evaluated pools with risk scores
    """
    
    # Step 1: Get pool data
    ekubo_pools = await ekubo_aggregator.get_pools()
    vesu_rates = await vesu_aggregator.get_rates()
    
    # Step 2: Evaluate with zkML
    evaluator = ZkMLPoolEvaluator()
    evaluated = []
    for pool in ekubo_pools:
        analysis = await evaluator.evaluate_pool(pool)
        evaluated.append(analysis)
    
    # Step 3: Return to frontend
    return {
        "recommended_pools": evaluated,
        "timestamp": datetime.now()
    }

@router.post("/recommend")
async def recommend_strategy(request: RecommendationRequest):
    """
    1. Receive pool evaluations from frontend
    2. Call LLM decision engine
    3. Return allocation recommendation
    """
    
    # Step 1: Parse request
    pool_evals = {p.pool_id: p for p in request.available_pools}
    
    # Step 2: Call LLM
    llm = LLMDecisionEngine()
    recommendation = await llm.recommend_strategy(
        user_risk_profile=request.risk_profile,
        deposit_amount=request.amount,
        pool_evaluations=pool_evals
    )
    
    # Step 3: Generate proof hash
    proof_hash = hashlib.sha256(
        json.dumps(recommendation).encode()
    ).hexdigest()
    
    # Step 4: Return to frontend
    return {
        "allocations": recommendation["allocation"],
        "reasoning": recommendation["reasoning"],
        "confidence": recommendation["confidence"],
        "expected_apy": recommendation["expected_apy"],
        "proof_hash": proof_hash  # User sees this for verification
    }
```

---

### Step 2: User Confirms & Executes

**Frontend (UPDATED SECTION):**
```typescript
// Add to frontend/src/app/mvp/page.tsx

const handleConfirmAndExecute = async () => {
  if (!address || !strategyRecommendation) return;
  
  setStep("deploying");
  
  try {
    // Call backend /deposits/submit endpoint
    const response = await fetch("/api/v1/deposits/submit", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        user_address: address,
        deposit_amount: depositAmount,
        risk_profile: selectedProfile,
        allocations: strategyRecommendation.allocations.map((alloc, i) => ({
          pool_id: alloc.pool_id,
          percentage: alloc.percentage,
          amount: Math.floor(depositAmount * alloc.percentage / 100),
          expected_apy: alloc.expected_apy
        })),
        proof_hash: strategyRecommendation.proof_hash,
        llm_reasoning_hash: strategyRecommendation.llm_reasoning_hash,
        total_expected_apy: strategyRecommendation.total_expected_apy,
        confidence: strategyRecommendation.confidence
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail);
    }
    
    const result = await response.json();
    console.log("Deployment successful:", result);
    
    setDeploymentId(result.deposit_id);
    setExecutionTxHash(result.vault_tx_hash);
    setAllocationTxs(result.allocation_txs);
    setStep("positions-view");
    
  } catch (error) {
    setStrategyError(error.message);
    setStep("strategy");
  }
};

// Update button in render to call this
<button onClick={handleConfirmAndExecute} className="btn-primary">
  Confirm & Execute Strategy
</button>
```

**Backend (`backend/app/api/routes/deposits.py`):**
```python
@router.post("/submit", response_model=DepositSubmissionResponse)
async def submit_deposit(request: DepositSubmissionRequest):
    """
    THE CRITICAL EXECUTION ENDPOINT
    
    This is where everything comes together:
    1. Contract deposits funds into vault
    2. Allocation executor creates LP + yield positions
    3. Audit trail records everything
    4. Frontend gets TX hashes for user to see
    """
    
    executor = get_executor()
    
    # Build allocation dict
    allocation = {
        item.pool_id: item.percentage / 100.0
        for item in request.allocations
    }
    
    # EXECUTE: This calls the contract, creates positions, logs audit
    result = await executor.execute_deposit_and_allocation(
        user_address=request.user_address,
        deposit_amount=request.deposit_amount,
        risk_profile=request.risk_profile,
        allocation=allocation,
        llm_reasoning_hash=request.llm_reasoning_hash,
        expected_apy=request.total_expected_apy,
    )
    
    if not result.success:
        raise HTTPException(status_code=500, detail=result.error)
    
    return DepositSubmissionResponse(
        success=True,
        deposit_id=result.deposit_id,
        vault_tx_hash=result.vault_tx_hash,  <- User can click to verify
        allocation_txs=result.allocation_tx_hashes,  <- See fees being collected
        audit_trail_id=result.audit_trail_id,  <- Proof of decision
        status="completed",
        message="Strategy deployed successfully",
        expected_apy=result.total_expected_apy,
    )
```

---

### Step 3: Execution Service Chain

**Flow Inside `contract_executor.py`:**

```python
async def execute_deposit_and_allocation(
    user_address,
    deposit_amount,
    risk_profile,
    allocation,
    llm_reasoning_hash,
    expected_apy,
):
    # 1. DEPOSIT TO VAULT
    vault_tx_hash, deposit_id = await self._call_vault_deposit(
        user_address, 
        deposit_amount, 
        risk_profile
    )
    # Calls: VaultManager.deposit(amount, risk_profile)
    # Returns: vault_tx_hash, deposit_id
    
    # 2. RECORD IN AUDIT TRAIL
    audit_trail_id = await self._record_analysis_in_audit_trail(
        user=user_address,
        deposit_id=deposit_id,
        risk_profile=risk_profile,
        llm_reasoning_hash=llm_reasoning_hash,
        expected_apy=expected_apy
    )
    # Calls: AuditTrail.record_analysis(...)
    # Stores: Complete decision + proof hash on-chain
    
    # 3. EXECUTE ALLOCATION
    allocation_txs = await self._execute_allocation(
        user=user_address,
        deposit_id=deposit_id,
        allocation=allocation,
        deposit_amount=deposit_amount
    )
    # For each pool in allocation:
    #   if Ekubo: EkuboStrategy.create_position(amount, pool_key, bounds)
    #   if Vesu: VesuStrategy.deposit_for_yield(amount, token)
    # Returns: {pool_id: tx_hash}
    
    # 4. MARK EXECUTED
    await self._mark_audit_executed(
        audit_trail_id=audit_trail_id,
        execution_tx_hash=vault_tx_hash
    )
    # Calls: AuditTrail.mark_executed(audit_id, tx_hash)
    # Confirms: Decision was executed as planned
    
    # Return results to API
    return DeploymentResult(
        success=True,
        deposit_id=deposit_id,
        vault_tx_hash=vault_tx_hash,  # Main deposit TX
        allocation_tx_hashes=allocation_txs,  # Each pool's TX
        total_expected_apy=expected_apy,
        audit_trail_id=audit_trail_id,
        error=None
    )
```

---

## Critical Implementation Details

### 1. Contract Call Implementation (TODO)

Right now `contract_executor.py` uses **MOCKS**. Need to implement actual calls:

```python
# Current (MOCK):
async def _call_vault_deposit(self, user, amount, risk_profile):
    deposit_id = 1
    tx_hash = f"0x{'0'*62}1234"
    return tx_hash, deposit_id

# Need to change to (ACTUAL):
async def _call_vault_deposit(self, user, amount, risk_profile):
    contract = Contract(
        address=self.vault_manager_address,
        abi=self.vault_manager_abi,
        client=self.client
    )
    
    invocation = contract.functions["deposit"].prepare(
        amount=amount,
        risk_profile=self._encode_risk_profile(risk_profile)
    )
    
    tx_hash = await acaller.invoke(invocation)
    
    # Wait for receipt
    receipt = await self.client.wait_for_tx(tx_hash)
    
    # Parse event to get deposit_id
    for event in receipt.events:
        if event.from_address == self.vault_manager_address:
            deposit_id = event.data[0]  # From DepositReceived event
            break
    
    return tx_hash, deposit_id
```

**Action:** Implement actual Starknet RPC calls in `contract_executor.py`

---

### 2. Risk Profile Encoding

Need to encode risk profile as felt for Cairo contract:

```python
def _encode_risk_profile(self, profile: str) -> int:
    mapping = {
        "conservative": 0,
        "balanced": 1,
        "aggressive": 2,
    }
    return mapping.get(profile, 1)  # Default to balanced
```

---

### 3. Database Setup (Optional for MVP)

Currently using in-memory storage. For production:

```python
# audit_trail_service.py can use actual DB:
class AuditTrailService:
    def __init__(self, db_connection):
        self.db = db_connection  # SQLAlchemy, MongoDB, etc.
    
    def record_analysis(self, ...):
        record = AuditTrailRecord(...)
        
        if self.db:
            self.db.session.add(record)
            self.db.session.commit()
        else:
            self.in_memory_store[record.id] = record
```

---

## Smart Contract Deployment Checklist

**MUST DO BEFORE EXECUTING ANY DEPOSITS:**

- [ ] Compile `vault_manager_v2.cairo` with `scarb build`
- [ ] Compile `strategy_router_v4.cairo` with `scarb build`
- [ ] Compile `audit_trail_v2.cairo` with `scarb build`
- [ ] Deploy all 3 to Sepolia testnet
- [ ] Record addresses in `.env`:
  ```
  VAULT_MANAGER_ADDRESS=0x...
  STRATEGY_ROUTER_ADDRESS=0x...
  AUDIT_TRAIL_ADDRESS=0x...
  ```
- [ ] Update `contract_executor.py` to use deployed addresses
- [ ] Update `allocation_executor.py` with Ekubo/Vesu contract addresses

---

## Testing Checklist

Before going live:

- [ ] Deploy 1 test ETH or STRK to Sepolia testnet wallet
- [ ] Test `/risk/analyze` endpoint - should return pool evaluations
- [ ] Test `/risk/recommend` endpoint - should return LLM recommendation
- [ ] Test `/deposits/submit` endpoint - should create TX hash
- [ ] Verify TX hash appears on StarkScan
- [ ] Verify vault contract received funds
- [ ] Verify positions were created in Ekubo/Vesu
- [ ] Verify audit trail recorded the decision
- [ ] Test profit/loss calculation
- [ ] Test with all 3 risk profiles

---

## Next Immediate Actions (TODAY)

1. **Compile contracts** (30 min)
   ```bash
   cd /opt/obsqra.starknet/contracts
   scarb build
   ```

2. **Deploy to Sepolia** (1 hour)
   ```bash
   sncast declare --contract-class VaultManager
   sncast deploy VaultManager <TOKEN_ADDRESS> <AUDIT_TRAIL_ADDRESS>
   ```

3. **Update `.env`** (5 min)
   ```
   VAULT_MANAGER_ADDRESS=<deployed_address>
   STRATEGY_ROUTER_ADDRESS=<deployed_address>
   AUDIT_TRAIL_ADDRESS=<deployed_address>
   ```

4. **Implement contract calls** (2-3 hours)
   - Replace mocks in `contract_executor.py` with real starknet-py calls
   - Replace mocks in `allocation_executor.py` with real contract calls

5. **Test end-to-end** (2-3 hours)
   - Connect wallet → Select risk → See recommendations → Execute → Verify TX

---

## Success Definition

✅ **Minimum for Week 2:**
- User sees pool evaluations with risk scores
- User sees LLM recommendation
- User can execute (even if mocked, TX hash appears)
- Audit trail records decision

🎉 **Ideal for Week 2:**
- All of above + actual LP positions created on Ekubo
- Actual deposits to Vesu working
- Fees start being collected
- Dashboard shows earnings breaking down by pool

---

**Next Step:** Compile contracts and create deployment script

Let's build! 🚀
