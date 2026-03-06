# Week 1 Implementation Plan: Risk Profiles + zkML + LLM

**Date:** February 16, 2026  
**Timeline:** 5 business days  
**Goal:** User can deposit, select risk profile, get AI-recommended allocation, see yield

---

## Day 1: Foundation (Mon)

### Morning: Frontend Risk Profile Form
**Task:** Build React component for risk profile selection  
**Time:** 2 hours

```tsx
// frontend/src/app/mvp/components/RiskProfileForm.tsx
import { useState } from 'react';

export function RiskProfileForm({ onSubmit }) {
  const [amount, setAmount] = useState(1000);
  const [profile, setProfile] = useState('balanced');
  const [submitted, setSubmitted] = useState(false);

  const profiles = [
    {
      id: 'conservative',
      label: 'Conservative',
      description: 'Low risk, stable yields 3-8% APY',
      icon: 🛡️,
      color: 'green',
    },
    {
      id: 'balanced',
      label: 'Balanced',
      description: 'Moderate risk, mixed yields 10-18% APY',
      icon: ⚖️,
      color: 'yellow',
    },
    {
      id: 'aggressive',
      label: 'Aggressive',
      description: 'High risk, high yields 25-50% APY',
      icon: 🚀,
      color: 'red',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Amount Input */}
      <div>
        <label className="block text-sm font-bold mb-2">Deposit Amount</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(parseFloat(e.target.value))}
            className="flex-1 px-4 py-2 border rounded-lg"
            placeholder="1000"
          />
          <span className="font-bold">STRK</span>
        </div>
      </div>

      {/* Profile Selection */}
      <div>
        <label className="block text-sm font-bold mb-4">Select Risk Profile</label>
        <div className="grid grid-cols-3 gap-3">
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => setProfile(p.id)}
              className={`p-4 rounded-lg border-2 transition ${
                profile === p.id 
                  ? `border-${p.color}-500 bg-${p.color}-50`
                  : 'border-gray-300'
              }`}
            >
              <div className="text-2xl mb-2">{p.icon}</div>
              <div className="font-bold text-sm">{p.label}</div>
              <div className="text-xs text-gray-600 mt-1">{p.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={() => {
          onSubmit({ amount, riskProfile: profile });
          setSubmitted(true);
        }}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg"
      >
        Analyze & Recommend Strategy
      </button>

      {submitted && <LoadingState />}
    </div>
  );
}
```

**Files to create:**
- `frontend/src/app/mvp/components/RiskProfileForm.tsx`

**Tests:**
- Form displays 3 profiles
- Amount input changes value
- Profile selection changes state
- Submit button works

### Afternoon: Backend Pool Service (Mock)
**Task:** Create service to fetch and analyze pools  
**Time:** 2 hours

```python
# File: backend/app/services/pool_analyzer.py

from dataclasses import dataclass
from typing import List
import logging

logger = logging.getLogger(__name__)

@dataclass
class PoolMetrics:
    pool_id: str
    protocol: str
    pair: str
    total_liquidity_usd: float
    volume_24h: float
    volatility_24h: float
    max_slippage_1pct: float
    impermanent_loss_risk: float
    expected_apy: float

def get_test_pools() -> List[PoolMetrics]:
    """Return test pool data for MVP (Week 1)"""
    return [
        PoolMetrics(
            pool_id="ekubo_strk_eth_0.3",
            protocol="Ekubo",
            pair="STRK/ETH",
            total_liquidity_usd=250_000,
            volume_24h=50_000,
            volatility_24h=0.08,
            max_slippage_1pct=0.005,
            impermanent_loss_risk=0.12,
            expected_apy=0.28,
        ),
        PoolMetrics(
            pool_id="ekubo_eth_usdc_0.3",
            protocol="Ekubo",
            pair="ETH/USDC",
            total_liquidity_usd=500_000,
            volume_24h=100_000,
            volatility_24h=0.03,
            max_slippage_1pct=0.002,
            impermanent_loss_risk=0.05,
            expected_apy=0.12,
        ),
        PoolMetrics(
            pool_id="vesu_usdc",
            protocol="Vesu",
            pair="USDC Lending",
            total_liquidity_usd=1_000_000,
            volume_24h=0,
            volatility_24h=0.0,
            max_slippage_1pct=0.0,
            impermanent_loss_risk=0.0,
            expected_apy=0.05,
        ),
    ]

def calculate_risk_score(pool: PoolMetrics) -> int:
    """Calculate pool risk score 0-100"""
    score = 0
    
    # Liquidity (0-20)
    if pool.total_liquidity_usd < 50_000:
        score += 15
    elif pool.total_liquidity_usd < 200_000:
        score += 8
    elif pool.total_liquidity_usd < 1_000_000:
        score += 3
    
    # Volume (0-20)
    volume_ratio = pool.volume_24h / max(pool.total_liquidity_usd, 1)
    if volume_ratio < 0.1:
        score += 15
    elif volume_ratio < 0.3:
        score += 8
    elif volume_ratio < 0.8:
        score += 3
    
    # Volatility (0-30)
    if pool.volatility_24h > 0.2:
        score += 25
    elif pool.volatility_24h > 0.12:
        score += 15
    elif pool.volatility_24h > 0.05:
        score += 8
    
    # Slippage (0-20)
    if pool.max_slippage_1pct > 0.05:
        score += 15
    elif pool.max_slippage_1pct > 0.02:
        score += 8
    elif pool.max_slippage_1pct > 0.005:
        score += 3
    
    # IL (0-10)
    if pool.impermanent_loss_risk > 0.2:
        score += 8
    elif pool.impermanent_loss_risk > 0.1:
        score += 4
    
    return min(100, score)

async def analyze_pools(risk_profile: str) -> List[dict]:
    """Analyze pools and return evaluations"""
    pools = get_test_pools()
    
    evaluations = []
    for pool in pools:
        risk_score = calculate_risk_score(pool)
        
        evaluation = {
            "pool_id": pool.pool_id,
            "protocol": pool.protocol,
            "pair": pool.pair,
            "risk_score": risk_score,
            "expected_apy": pool.expected_apy,
            "suitable_for_conservative": risk_score < 40,
            "suitable_for_balanced": risk_score < 70,
            "suitable_for_aggressive": True,
            "liquidity": pool.total_liquidity_usd,
            "volume_24h": pool.volume_24h,
        }
        evaluations.append(evaluation)
    
    # Sort by risk score
    evaluations.sort(key=lambda x: x["risk_score"])
    
    return evaluations
```

**Files to create:**
- `backend/app/services/pool_analyzer.py`

**Tests:**
- Calculate risk scores for test pools
- Sort by risk correctly
- Filter by profile

---

## Day 2: LLM Integration (Tue)

### Morning: LLM Wrapper
**Task:** Set up ChatGPT-mini integration  
**Time:** 2 hours

```python
# File: backend/app/services/llm_engine.py

import os
from openai import OpenAI
import json
import logging

logger = logging.getLogger(__name__)

class LLMEngine:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OPENAI_API_KEY not set - will use mock responses")
            self.client = None
        else:
            self.client = OpenAI(api_key=api_key)
    
    async def recommend_allocation(self, risk_profile: str, pools: List[dict]) -> dict:
        """Get LLM recommendation for allocation"""
        
        if not self.client:
            return self._mock_recommendation(risk_profile, pools)
        
        prompt = self._format_prompt(risk_profile, pools)
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a DeFi portfolio manager. Recommend capital allocation."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=500,
            )
            
            content = response.choices[0].message.content
            result = json.loads(content)
            return self._validate_allocation(result, pools)
            
        except Exception as e:
            logger.error(f"LLM error: {e}")
            return self._mock_recommendation(risk_profile, pools)
    
    def _format_prompt(self, risk_profile: str, pools: List[dict]) -> str:
        pools_text = "\n".join([
            f"  - {p['pool_id']}: {p['protocol']} {p['pair']}, "
            f"Risk {p['risk_score']}/100, APY {p['expected_apy']*100:.1f}%"
            for p in pools
        ])
        
        return f"""
User Risk Profile: {risk_profile}
Available Pools:
{pools_text}

Recommend allocation percentages across these pools for a {risk_profile} investor.
Return JSON:
{{
    "allocation": {{"pool_id": 0.30, "pool_id2": 0.70}},
    "reasoning": "...",
    "confidence": 0.85,
    "expected_apy": 0.15
}}
"""
    
    def _validate_allocation(self, result: dict, pools: List[dict]) -> dict:
        """Ensure allocation sums to 100%"""
        allocation = result.get("allocation", {})
        total = sum(allocation.values())
        
        if total > 0:
            allocation = {k: v/total for k, v in allocation.items()}
        
        return {
            "allocation": allocation,
            "reasoning": result.get("reasoning", ""),
            "confidence": result.get("confidence", 0.5),
            "expected_apy": result.get("expected_apy", 0.1),
        }
    
    def _mock_recommendation(self, risk_profile: str, pools: List[dict]) -> dict:
        """Fallback if LLM unavailable"""
        
        if risk_profile == "conservative":
            return {
                "allocation": {
                    pools[2]["pool_id"]: 0.7,  # Vesu
                    pools[1]["pool_id"]: 0.3,  # ETH/USDC
                },
                "reasoning": "Conservative: 70% safe lending, 30% stable LP",
                "confidence": 0.8,
                "expected_apy": 0.08,
            }
        elif risk_profile == "balanced":
            return {
                "allocation": {
                    pools[1]["pool_id"]: 0.4,  # ETH/USDC
                    pools[0]["pool_id"]: 0.3,  # STRK/ETH
                    pools[2]["pool_id"]: 0.3,  # Vesu
                },
                "reasoning": "Balanced: mix of yields and LP",
                "confidence": 0.85,
                "expected_apy": 0.15,
            }
        else:  # aggressive
            return {
                "allocation": {
                    pools[0]["pool_id"]: 0.7,  # STRK/ETH
                    pools[1]["pool_id"]: 0.2,  # ETH/USDC
                    pools[2]["pool_id"]: 0.1,  # Vesu
                },
                "reasoning": "Aggressive: maximize yield with concentrated LP",
                "confidence": 0.8,
                "expected_apy": 0.25,
            }
```

**Files to create:**
- `backend/app/services/llm_engine.py`

**Environment setup:**
```bash
# Add to .env
OPENAI_API_KEY=sk_test_...  # Optional for MVP - will use mock
```

**Tests:**
- Mock recommendations work
- Allocation sums to 100%
- Reasoning is provided

### Afternoon: API Endpoint & Wire
**Task:** Create `/strategies/recommend` endpoint  
**Time:** 2 hours

```python
# File: backend/app/api/routes/strategies.py

from fastapi import APIRouter, HTTPException
from app.services.pool_analyzer import analyze_pools
from app.services.llm_engine import LLMEngine

router = APIRouter(prefix="/api/v1/strategies", tags=["strategies"])
llm_engine = LLMEngine()

@router.post("/recommend")
async def recommend_strategy(request: dict) -> dict:
    """
    Analyze pools and recommend allocation
    
    Request:
    {
        "user_address": "0x...",
        "risk_profile": "conservative|balanced|aggressive",
        "amount": 1000
    }
    """
    
    try:
        # 1. Analyze pools
        pools = await analyze_pools(request["risk_profile"])
        
        # 2. Get LLM recommendation
        recommendation = await llm_engine.recommend_allocation(
            request["risk_profile"],
            pools
        )
        
        # 3. Return result
        return {
            "pools_analyzed": pools,
            "recommendation": recommendation,
            "audit_entry_id": "aud_mock_" + str(int(time.time())),
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Files to modify:**
- `backend/app/api/main.py` - Include router

**Update routes:**
```python
from app.api.routes import strategies

app.include_router(strategies.router)
```

---

## Day 3: Frontend Integration (Wed)

### Morning: Connect to Backend
**Task:** Wire frontend to `/strategies/recommend` endpoint  
**Time:** 2 hours

```tsx
// File: frontend/src/app/mvp/components/StrategyRecommendation.tsx

import { useState, useEffect } from 'react';
import { useAccount } from '@starknet-react/core';

export function StrategyRecommendation({
  riskProfile,
  amount,
  onConfirm,
}: {
  riskProfile: string;
  amount: number;
  onConfirm: (allocation: any) => void;
}) {
  const { address } = useAccount();
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchRecommendation() {
      try {
        const response = await fetch('/api/v1/strategies/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_address: address,
            risk_profile: riskProfile,
            amount: amount,
          }),
        });

        if (!response.ok) throw new Error('Failed to get recommendation');

        const data = await response.json();
        setRecommendation(data);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    }

    if (address) {
      fetchRecommendation();
    }
  }, [address, riskProfile, amount]);

  if (loading) return <div className="animate-pulse">Analyzing pools...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-6">
      {/* AI Recommendation */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-bold text-blue-900">AI Recommendation</h3>
        <p className="text-sm text-blue-700 mt-2">{recommendation.recommendation.reasoning}</p>
        <div className="flex items-center gap-2 mt-2">
          <div className="h-2 w-32 bg-gray-200 rounded">
            <div
              className="h-2 bg-green-500 rounded"
              style={{ width: `${recommendation.recommendation.confidence * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono">
            {Math.round(recommendation.recommendation.confidence * 100)}% confidence
          </span>
        </div>
      </div>

      {/* Pools Analyzed */}
      <div>
        <h4 className="font-bold mb-2">Pools Analyzed</h4>
        {recommendation.pools_analyzed.map(pool => (
          <div key={pool.pool_id} className="p-2 border rounded flex justify-between">
            <div>
              <div className="font-medium">{pool.pair}</div>
              <div className="text-xs text-gray-600">{pool.protocol}</div>
            </div>
            <div className="text-right">
              <div className="font-bold">{(pool.expected_apy * 100).toFixed(1)}% APY</div>
              <div className="text-xs">Risk: {pool.risk_score}/100</div>
            </div>
          </div>
        ))}
      </div>

      {/* Expected Yield */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="text-sm font-medium text-green-900">
          Expected APY: {(recommendation.recommendation.expected_apy * 100).toFixed(1)}%
        </div>
      </div>

      {/* Confirm Button */}
      <button
        onClick={() => onConfirm(recommendation.recommendation.allocation)}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
      >
        Confirm & Deploy
      </button>
    </div>
  );
}
```

**Files to modify:**
- `frontend/src/app/mvp/page.tsx` - Include new component

### Afternoon: Full Flow Test
**Task:** Test deposit → risk profile → recommendation → confirm  
**Time:** 2 hours

**Test sequence:**
1. User enters deposit amount (1000 STRK)
2. User selects risk profile (balanced)
3. Frontend calls `/strategies/recommend`
4. Backend analyzes pools
5. LLM recommends allocation
6. Frontend displays recommendation
7. User clicks confirm
8. (Day 4-5: actual execution)

---

## Day 4: Smart Contract Updates (Thu)

### Morning: Update VaultManager
**Task:** Add risk profile tracking to contracts  
**Time:** 2 hours

```cairo
// File: contracts/src/vault_manager.cairo

#[derive(Copy, Drop, Serde)]
pub struct DepositRecord {
    pub user: ContractAddress,
    pub amount: u256,
    pub risk_profile: felt252,  // "conservative", "balanced", "aggressive"
    pub timestamp: u64,
    pub status: u8,  // 0 = pending, 1 = deployed, 2 = yielding
}

#[abi(embed_v0)]
pub fn deposit_with_profile(
    ref self: ContractState,
    amount: u256,
    risk_profile: felt252,
) -> u256 {
    // Record deposit with risk profile
    let user = get_caller_address();
    let record = DepositRecord {
        user,
        amount,
        risk_profile,
        timestamp: get_block_timestamp(),
        status: 0,  // Pending
    };
    
    self.deposit_records.write(next_id, record);
    
    // Return receipt ID
    next_id
}
```

### Afternoon: Deploy & Test
**Task:** Verify contracts compile  
**Time:** 2 hours

```bash
# Compile contracts
scarb build

# Run tests
scarb test

# Verify no errors
```

---

## Day 5: Polish & Integration (Fri)

### Morning: End-to-End Test
**Task:** Full flow from deposit to recommendation  
**Time:** 2 hours

**Checklist:**
- [ ] Deposit form accepts input
- [ ] Risk profile selection works
- [ ] Backend receives request
- [ ] Pool analysis runs
- [ ] LLM recommendation generated
- [ ] Frontend displays result
- [ ] User can confirm allocation

### Afternoon: Docs & Deploy
**Task:** Document and deploy MVP  
**Time:** 2 hours

**Create:**
- Week 1 completion summary
- Known issues / limitations
- Next steps for Week 2

---

## Week 1 Success Criteria

✅ **Frontend:**
- [ ] Risk profile selector component
- [ ] Recommendation display
- [ ] Confirmation flow

✅ **Backend:**
- [ ] Pool analyzer service
- [ ] LLM integration (with fallback)
- [ ] `/strategies/recommend` endpoint

✅ **Smart Contracts:**
- [ ] VaultManager accepts risk profile
- [ ] Audit trail records decisions
- [ ] Contracts compile & deploy

✅ **Integration:**
- [ ] End-to-end flow works
- [ ] Allocation recommenda displayed
- [ ] User can confirm deployment (even if execution deferred to Week 2)

---

## Deliverables

### Code
- 3 new frontend components
- 3 new backend services
- 2 contract updates
- 1 new API router

### Documentation
- Implementation notes
- Known issues
- Testing results

### Demo
- Show deposit form
- Show risk profile selection
- Show AI recommendation
- Show user confirmation

---

## Known Limitations (Address in Week 2+)

⏸️ Contracts not yet deploying capital  
⏸️ zkML using mock (non-verifiable) proofs  
⏸️ Only test pools (no real Sepolia data)  
⏸️ No Jediswap integration yet  
⏸️ Vesu not yet tested  

---

## Next: Week 2

- Deploy contract execution
- Connect to real Ekubo pools
- Implement fee collection
- Real zkML circuit

Ready to build? 🚀
