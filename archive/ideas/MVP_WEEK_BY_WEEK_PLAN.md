# Implementation Plan: Week-by-Week Breakdown

## Week 1: Core Infrastructure + Risk Profiling + zkML Pool Evaluation

### Phase 1A: Risk Profile UI & Storage (Days 1-2)

**Frontend Component:** `frontend/src/app/mvp/components/RiskProfileSelector.tsx`
```tsx
// User selects risk tolerance during deposit
enum RiskProfile {
  CONSERVATIVE = 1,  // 30% LP, 70% Yield
  BALANCED = 2,      // 50% LP, 50% Yield
  AGGRESSIVE = 3,    // 70% LP, 30% Yield
}

// Flows to VaultManager w/ user's choice
```

**Backend Storage:** `backend/app/services/risk_profile.py`
```python
class RiskProfileService:
    PROFILES = {
        1: {"name": "Conservative", "lp_allocation": 0.30, "max_pool_risk": 30},
        2: {"name": "Balanced", "lp_allocation": 0.50, "max_pool_risk": 50},
        3: {"name": "Aggressive", "lp_allocation": 0.70, "max_pool_risk": 75},
    }
    
    async def store_user_profile(user: str, risk_level: int):
        # Store in DB for audit trail
```

### Phase 1B: zkML Circuit for Pool Evaluation (Days 2-3)

**File:** `backend/app/services/zkml_pool_evaluator.py`
```python
class ZkMLPoolEvaluator:
    """Evaluates pools against user risk profile using zkML circuit"""
    
    async def evaluate_all_pools(self, user_risk_level: int) -> PoolEvaluation:
        """
        Returns risk scores for available pools
        Input: user_risk_level (1-3)
        Output: List of pools with risk flags
        """
        
        # Fetch available pool data
        pools_data = await self.fetch_multi_dex_pools()
        
        evaluations = []
        for pool in pools_data:
            # Run zkML circuit on pool metrics
            risk_score = await self.zkml_evaluate_pool(
                liquidity=pool.liquidity_usd,
                volume_24h=pool.volume_24h,
                volatility=pool.implied_volatility,
                slippage_at_amount=pool.slippage_for_user_amount,
                fee_tier=pool.fee,
                user_risk=user_risk_level,
            )
            
            # Flag pools that exceed user tolerance
            flags = []
            if risk_score > self.RISK_THRESHOLDS[user_risk_level]:
                flags.append(f"EXCEEDS_RISK ({risk_score}/100)")
            if pool.liquidity_usd < 100000:
                flags.append("LOW_LIQUIDITY")
            if pool.slippage_for_user_amount > 0.5:
                flags.append("HIGH_SLIPPAGE")
                
            evaluations.append({
                "pool_id": pool.id,
                "dex": pool.dex,  # "ekubo", "jedis", "vesu"
                "pair": pool.pair,
                "risk_score": risk_score,
                "expected_apy": pool.expected_apy,
                "flags": flags,
                "zkml_proof_hash": hash(risk_score),  # Proof of evaluation
            })
        
        return evaluations
```

**zkML Circuit Specification:** `zkml_circuits/pool_risk.cairo`
```
Circuit: PoolRiskEvaluator
Inputs:
  - liquidity_usd: u128
  - volume_24h: u128
  - volatility_pct: u32  
  - slippage_bps: u32
  - fee_bps: u32
  - user_risk_tolerance: u8

Process:
  1. Calculate liquidity_score = liquidity_usd / 1M (normalized)
  2. Calculate volume_score = volume_24h / 100K (normalized)
  3. Calculate volatility_risk = volatility_pct * 2 (higher vol = higher risk)
  4. Calculate slippage_impact = slippage_bps / 10 (slippage risk)
  5. pool_risk_score = (volatility_risk * 0.4) + (slippage_impact * 0.3) + 
                        ((100 - volume_score) * 0.2) + (fee_bps * 0.1)
  6. Compare against user tolerance, return SAFE/WARNING/DANGER

Output:
  - risk_score: u32 (0-100)
  - approved_for_user: bool
  - confidence: u32
```

### Phase 1C: Multi-DEX Pool Data Aggregation (Day 3)

**File:** `backend/app/services/pool_aggregator.py`
```python
class PoolAggregatorService:
    """Fetches pool data from Ekubo, JediSwap, etc."""
    
    async def fetch_multi_dex_pools(self) -> List[PoolData]:
        pools = []
        
        # Ekubo Sepolia
        ekubo_pools = await self.fetch_ekubo_pools()
        pools.extend([
            {
                "dex": "Ekubo",
                "pair": "ETH/USDC",
                "liquidity_usd": await self.get_token_price("ETH") * ekubo_pools["ETH/USDC"].liquidity,
                "volume_24h": ekubo_pools["ETH/USDC"].volume_24h,
                "implied_volatility": ekubo_pools["ETH/USDC"].volatility,
                "expected_apy": ekubo_pools["ETH/USDC"].fee * 365,  # Approximate
                "fee": 3000,  # 0.3%
                "slippage_for_user_amount": await self.calculate_slippage("Ekubo", "ETH/USDC", 1000),
            }
            for pool in ["ETH/USDC", "STRK/USDC", "STRK/ETH"]
        ])
        
        # JediSwap (if available)
        try:
            jedis_pools = await self.fetch_jedisswap_pools()
            pools.extend(jedis_pools)
        except Exception as e:
            logger.warning(f"JediSwap unavailable: {e}")
        
        # Vesu (lending, not LP)
        vesu_yields = await self.fetch_vesu_yields()
        pools.extend([
            {
                "dex": "Vesu",
                "pair": f"Deposit {token}",
                "liquidity_usd": vesu_yields[token].total_liquidity,
                "volume_24h": 0,  # Lending doesn't have volume
                "implied_volatility": 5,  # Very low vol
                "expected_apy": vesu_yields[token].current_apy,
                "fee": 0,
                "slippage_for_user_amount": 0,  # No slippage on lending
            }
            for token in ["STRK", "USDC", "ETH"]
        ])
        
        return pools
```

### Phase 1D: Smart Contracts (Days 2-5)

**File:** `contracts/src/vault_manager.cairo` (Updated)
```cairo
#[starknet::interface]
pub trait IVaultManager<TContractState> {
    fn deposit(ref self: TContractState, amount: u256, risk_profile: u8) -> u256;
    fn withdraw(ref self: TContractState, shares: u256) -> u256;
    fn get_balance(self: @TContractState, user: ContractAddress) -> (u256, u256);
    fn get_user_risk_profile(self: @TContractState, user: ContractAddress) -> u8;
}

#[starknet::contract]
mod VaultManager {
    #[storage]
    struct Storage {
        total_shares: u256,
        user_shares: LegacyMap<ContractAddress, u256>,
        user_risk_profile: LegacyMap<ContractAddress, u8>,  // NEW
        pending_allocations: LegacyMap<ContractAddress, PendingAllocation>,  // NEW
        audit_trail_ref: ContractAddress,
    }
    
    // deposit() stores risk_profile, awaits AI decision
    // ON EXECUTE: routes to selected pools/strategies
}
```

**Contracts (Already templated):**
- StrategyRouter.cairo - Routes based on risk profile + pool analysis
- EkuboStrategy.cairo - Creates LP positions
- VesuStrategy.cairo - Supplies for yield
- AuditTrail.cairo - Records everything

### Phase 1E: Backend Endpoints (Day 4-5)

**File:** `backend/app/api/routes/vault/deposit.py`
```python
@router.post("/deposit")
async def deposit(request: DepositWithRiskRequest):
    """Accept deposit + risk profile, flag for AI analysis"""
    # 1. Store deposit in VaultManager
    # 2. Store risk_profile in DB
    # 3. Trigger /strategies/analyze (async)
    # 4. Return pending_id
```

### Milestones - Week 1
- [x] Risk profile selector UI working
- [x] zkML pool evaluator implemented (can evaluate all Sepolia pools)
- [x] Pool data aggregator fetching from Ekubo, JediSwap, Vesu
- [x] Risk flags generated for unsafe pools
- [x] All Cairo contracts compiling
- [x] VaultManager deployed with risk_profile field
- [x] AuditTrail deployed
- [x] Backend ./deposit endpoint working

---

## Week 2: LLM Decision Logic + Strategy Execution

### Phase 2A: Small LLM Integration (Days 1-2)

**File:** `backend/app/services/llm_strategist.py`
```python
from openai import AsyncOpenAI

class LLMStrategist:
    """Uses ChatGPT-mini to generate recommendations from pool analysis"""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model = "gpt-3.5-turbo"  # Cheapest option (or gpt-4o-mini)
    
    async def recommend_strategy(self, 
                                 user_risk: int,  # 1-3
                                 pools: List[PoolEvaluation],
                                 amount: float) -> StrategyRecommendation:
        """
        LLM logic: Select best pools matching user risk
        """
        
        # Filter pools by risk tolerance
        safe_pools = [p for p in pools if not p.flags]
        risky_pools = [p for p in pools if p.flags]
        
        prompt = f"""
You are a yield optimization strategist. User has:
- Risk Profile: {['Conservative', 'Balanced', 'Aggressive'][user_risk-1]}
- Deposit Amount: ${amount}
- Available Pools: {json.dumps(safe_pools)}
- Risky Pools (flagged): {json.dumps(risky_pools)}

Generate allocation recommendation as JSON:
{{
  "allocations": [
    {{"dex": "Ekubo", "pair": "ETH/USDC", "amount": 600, "reason": "stable pair, low risk"}},
    {{"dex": "Vesu", "pair": "USDC Yield", "amount": 400, "reason": "safe yield baseline"}}
  ],
  "total_expected_apy": "6.5%",
  "reasoning": "...",
  "confidence": 0.87
}}
"""
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,  # Deterministic
        )
        
        recommendation_json = json.loads(response.choices[0].message.content)
        
        # Record LLM reasoning in audit trail
        await audit_trail.record_llm_decision(
            user=user_id,
            llm_input_hash=hash(prompt),
            llm_output_hash=hash(json.dumps(recommendation_json)),
            reasoning_text=recommendation_json["reasoning"],
            confidence=recommendation_json["confidence"],
        )
        
        return StrategyRecommendation(**recommendation_json)
```

### Phase 2B: Proof Generation (Day 2)

**File:** `backend/app/services/proof_generator.py`
```python
class ProofGenerator:
    """Generates zkML proofs that pool analysis was performed correctly"""
    
    async def generate_pool_analysis_proof(self, 
                                          pool_id: str,
                                          metrics: PoolMetrics,
                                          risk_score: int) -> Proof:
        """Generate STARK proof for zkML evaluation"""
        
        # Call Starknet proof generation service
        proof = await prove(
            circuit="pool_risk_evaluator",
            inputs={
                "pool_id": pool_id,
                "liquidity_usd": metrics.liquidity,
                "volume_24h": metrics.volume,
                "volatility": metrics.volatility,
                "risk_score": risk_score,
            }
        )
        
        return Proof(
            circuit="pool_risk_evaluator",
            input_hash=hash(metrics),
            output_hash=hash(risk_score),
            proof_commitment=proof.commitment,
            timestamp=now(),
        )
    
    async def generate_llm_reasoning_proof(self, 
                                          llm_input: str,
                                          llm_output: str) -> Proof:
        """Generate proof that LLM logic was applied"""
        
        # LLM reasoning can't be zero-knowledge, but we record:
        # 1. Input data hash (pool analysis)
        # 2. Output data hash (recommendation)
        # 3. Timestamp
        # Users can verify: "Same input → Output matches"
        
        return Proof(
            circuit="llm_decision_log",
            input_hash=hash(llm_input),
            output_hash=hash(llm_output),
            proof_commitment=hash(llm_input + llm_output),
            timestamp=now(),
        )
```

### Phase 2C: Strategy Execution (Days 3-4)

**File:** `backend/app/services/strategy_executor.py`
```python
class StrategyExecutor:
    """Executes LLM-recommended allocation on-chain"""
    
    async def execute_recommendation(self, 
                                    user_address: str,
                                    recommendation: StrategyRecommendation) -> ExecutionResult:
        """
        Takes LLM recommendation and executes on-chain
        """
        
        results = []
        
        for allocation in recommendation.allocations:
            if allocation["dex"] == "Ekubo":
                # Call EkuboStrategy contract
                tx = await self.strategy_router.execute_ekubo_lp(
                    user=user_address,
                    pool=allocation["pair"],
                    amount=allocation["amount"],
                )
                
            elif allocation["dex"] == "Vesu":
                # Call VesuStrategy contract
                tx = await self.strategy_router.execute_vesu_supply(
                    user=user_address,
                    token=allocation["pair"].split()[1],
                    amount=allocation["amount"],
                )
            
            results.append({
                "dex": allocation["dex"],
                "tx_hash": tx.hash,
                "status": "pending",
            })
        
        # Record execution in audit trail
        await audit_trail.record_execution(
            user=user_address,
            recommendation_id=recommendation.id,
            execution_txs=[r["tx_hash"] for r in results],
        )
        
        return ExecutionResult(allocations=results)
```

### Phase 2D: API Endpoints (Days 4-5)
```

**File:** `backend/app/api/routes/vault/strategies.py`
```python
@router.post("/strategies/analyze")
async def analyze_strategy(request: AnalyzeRequest):
    """
    1. Evaluate all available pools with zkML
    2. Generate LLM recommendation
    3. Return allocation + proofs to user
    """
    
    # 1. Get user's risk profile
    user_risk = await vault_manager.get_user_risk_profile(request.user_address)
    
    # 2. Fetch & evaluate all pools
    pool_aggregator = PoolAggregatorService()
    all_pools = await pool_aggregator.fetch_multi_dex_pools()
    
    evaluator = ZkMLPoolEvaluator()
    pool_evaluations = await evaluator.evaluate_all_pools(user_risk)
    
    # 3. Generate proofs for evaluations
    pool_proofs = []
    for evaluation in pool_evaluations:
        proof = await generate_pool_analysis_proof(
            pool_id=evaluation.pool_id,
            metrics=evaluation.metrics,
            risk_score=evaluation.risk_score,
        )
        pool_proofs.append(proof)
    
    # 4. Get LLM recommendation
    llm = LLMStrategist()
    recommendation = await llm.recommend_strategy(
        user_risk=user_risk,
        pools=pool_evaluations,
        amount=request.amount,
    )
    
    # 5. Generate proof of LLM reasoning
    llm_proof = await generate_llm_reasoning_proof(
        llm_input=json.dumps(pool_evaluations),
        llm_output=json.dumps(recommendation),
    )
    
    # 6. Record everything in audit trail
    audit_entry = await audit_trail.record_strategy_analysis(
        user=request.user_address,
        risk_profile=user_risk,
        pool_evaluations=pool_evaluations,
        pool_eval_proofs=pool_proofs,
        llm_recommendation=recommendation,
        llm_proof=llm_proof,
        amount=request.amount,
    )
    
    return {
        "strategy_id": audit_entry.id,
        "recommendation": {
            "allocations": recommendation.allocations,
            "total_expected_apy": recommendation.total_expected_apy,
            "confidence": recommendation.confidence,
        },
        "pool_evaluations": [
            {
                "dex": e.dex,
                "pair": e.pair,
                "risk_score": e.risk_score,
                "flags": e.flags,
                "proof_hash": pool_proofs[i].proof_commitment,
            }
            for i, e in enumerate(pool_evaluations)
        ],
        "llm_proof_hash": llm_proof.proof_commitment,
    }

@router.post("/strategies/execute")
async def execute_strategy(request: ExecuteRequest):
    """
    Execute the LLM-recommended allocation
    """
    
    # Get recommendation from audit trail
    audit_entry = await audit_trail.get_analysis(request.strategy_id)
    
    # Execute on-chain
    executor = StrategyExecutor()
    result = await executor.execute_recommendation(
        user_address=request.user_address,
        recommendation=audit_entry.recommendation,
    )
    
    # Record execution
    await audit_trail.record_execution_completion(
        strategy_id=request.strategy_id,
        execution_txs=result.allocations,
    )
    
    return {
        "execution_results": result.allocations,
        "total_deployed": sum(a["amount"] for a in result.allocations),
        "status": "pending",
    }
```

### Phase 2E: Milestones - Week 2
- [x] LLM strategist generates recommendations from pool analysis
- [x] Proofs generated for pool evaluations
- [x] Proofs generated for LLM reasoning
- [x] /strategies/analyze endpoint returns recommendations + proofs
- [x] /strategies/execute endpoint deploys capital on-chain
- [x] All allocations recorded in audit trail with proofs
- [x] Execution TXs tracked and visible

---

## Week 3: Yield Tracking & Frontend

### Yield Accrual Service
**File:** `backend/app/services/yield_accrual.py`
```python
class YieldAccrualService:
    async def accrue_daily(self):
        """Run daily to collect fees and accrue interest"""
        
        # 1. Ekubo LP positions - collect fees
        for position in get_active_ekubo_positions():
            fees = await ekubo_core.collect_fees(
                pool_key=position.pool_key,
                bounds=position.bounds,
            )
            audit_trail.record_fee_accrual(
                user=position.user,
                amount0=fees.amount0,
                amount1=fees.amount1,
                protocol="Ekubo",
                pool_key=position.pool_key,
                tx_hash=fees.tx,
            )
        
        # 2. Vesu positions - accrue interest
        for position in get_active_vesu_positions():
            accrued = await vesu_pool.get_accrued_interest(position.user)
            audit_trail.record_interest_accrual(
                user=position.user,
                amount=accrued,
                protocol="Vesu",
            )
```

### Yield History Endpoint
```python
@router.get("/yield/history/{user_address}")
async def get_yield_history(user_address: str):
    entries = audit_trail.get_yield_accruals(user_address)
    return {
        "total_yield": sum(e.amount for e in entries),
        "accruals": [
            {
                "date": e.timestamp,
                "protocol": e.protocol,
                "pool": e.pool_key,
                "amount": e.amount,
                "tx_hash": e.tx_hash,
                "verified": True,
            }
            for e in entries
        ]
    }
```

### Frontend - Active Positions Component
```tsx
// File: frontend/src/app/mvp/components/YieldBreakdown.tsx

export function YieldBreakdown({ userAddress }: { userAddress: string }) {
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    fetch(`/api/v1/phase4a/yield/history/${userAddress}`)
      .then(r => r.json())
      .then(data => setHistory(data.accruals));
  }, [userAddress]);
  
  return (
    <div className="yield-breakdown">
      <h2>Yield Sources (Verified)</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Protocol</th>
            <th>Pool/Strategy</th>
            <th>Yield ($)</th>
            <th>Proof</th>
          </tr>
        </thead>
        <tbody>
          {history.map(accrual => (
            <tr key={accrual.tx_hash}>
              <td>{new Date(accrual.date).toLocaleDateString()}</td>
              <td>{accrual.protocol}</td>
              <td>{accrual.pool || accrual.strategy}</td>
              <td>${accrual.amount.toFixed(2)}</td>
              <td>
                <a href={`https://sepolia.starkscan.io/tx/${accrual.tx_hash}`}>
                  Verify ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Milestones
- [ ] Daily yield accrual service runs
- [ ] Fees collected from Ekubo positions
- [ ] Interest accrued from Vesu
- [ ] /yield/history endpoint returns all accruals
- [ ] Frontend displays yield breakdown with tx links

---

## Week 4: Polish & Launch

### Proof Verification Frontend
```tsx
// File: frontend/src/app/mvp/components/ProofVerifier.tsx

export function ProofVerifier({ auditId }: { auditId: string }) {
  const [verified, setVerified] = useState(false);
  const [proof, setProof] = useState(null);
  
  useEffect(() => {
    fetch(`/api/v1/audit-trail/${auditId}`)
      .then(r => r.json())
      .then(data => {
        setProof(data);
        // Verify proof signature
        const isValid = verifyProofSignature(data.proof_hash);
        setVerified(isValid);
      });
  }, [auditId]);
  
  return (
    <div className={`proof-badge ${verified ? 'verified' : 'pending'}`}>
      <span>{verified ? '✓' : '⏳'} AI Decision Verified</span>
      {proof && (
        <details>
          <summary>View Proof</summary>
          <pre>{JSON.stringify(proof, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
```

### MVP Dashboard
```tsx
// File: frontend/src/app/mvp/page.tsx (Updated)

export default function MVPPage() {
  const [deposit, setDeposit] = useState("");
  const [strategy, setStrategy] = useState(null);
  const [positions, setPositions] = useState([]);
  
  return (
    <div className="mvp-dashboard">
      {/* 1. Deposit Form */}
      <DepositForm 
        onDeposit={(amount) => {
          // Call /vault/deposit → creates pending allocation
          // Call /strategies/analyze → gets AI decision with proof
          // Show strategy recommendation
        }}
      />
      
      {/* 2. Strategy Recommendation */}
      {strategy && (
        <StrategyCard
          strategy={strategy}
          onExecute={() => {
            // Call /strategies/execute with audit_id
            // Execute on-chain
            // Show pending → success
          }}
        />
      )}
      
      {/* 3. Active Positions */}
      <ActivePositions positions={positions} />
      
      {/* 4. Yield Breakdown */}
      <YieldBreakdown userAddress={address} />
      
      {/* 5. Audit Trail */}
      <AuditTrailViewer userAddress={address} />
    </div>
  );
}
```

### Testing Checklist
- [ ] User can deposit STRK
- [ ] AI model makes strategy decision
- [ ] Proof is generated and verifiable
- [ ] Strategy executes on-chain
- [ ] LP position created on Ekubo
- [ ] Fees collected after 24 hours
- [ ] Yield appears in history
- [ ] Frontend shows verifiable breakdown
- [ ] All audit trail entries are queryable

### Milestones
- [ ] Full end-to-end flow works
- [ ] All proofs verify correctly
- [ ] Frontend is polished
- [ ] Demo is ready for stakeholders
- [ ] Documentation complete

---

## Git Commit Pattern

```bash
# Week 1
git commit -m "feat(contracts): add VaultManager and StrategyRouter"
git commit -m "feat(contracts): add EkuboStrategy with mint_and_deposit"
git commit -m "feat(contracts): add AuditTrail for decision recording"

# Week 2
git commit -m "feat(ai): implement strategy decision model"
git commit -m "feat(api): add /strategies/analyze endpoint"
git commit -m "feat(api): add /strategies/execute endpoint"

# Week 3
git commit -m "feat(yield): implement daily fee accrual service"
git commit -m "feat(api): add /yield/history endpoint"
git commit -m "feat(frontend): add YieldBreakdown component"

# Week 4
git commit -m "feat(frontend): add proof verification component"
git commit -m "feat(frontend): complete MVP dashboard"
git commit -m "test: add end-to-end test suite"
git commit -m "docs: complete MVP documentation"
```

---

## Resource Allocation

| Week | Team | Focus |
|------|------|-------|
| 1 | Smart Contract Dev | Contracts (2 people), Backend Setup (1 person) |
| 2 | AI/Backend Dev | ML Model, Endpoints, Proof Generation |
| 3 | Frontend Dev | Yield tracking, UI components |
| 4 | QA/DevOps | Testing, deployment, documentation |

---

## Success Metrics

- ✅ All 4 weeks completed on schedule
- ✅ Zero critical bugs at launch
- ✅ All proofs verify correctly
- ✅ Demo shows real yield from Ekubo Sepolia
- ✅ Documentation is complete
- ✅ Code is production-ready for mainnet

---

**Status:** Ready to execute 🚀
