# LLM Decision Engine: Strategy Recommendation

**Date:** February 16, 2026  
**Purpose:** Use small LLM to recommend optimal allocation based on pools + risk profile  
**Status:** Ready to Implement

---

## Why Use LLM?

Instead of hardcoding allocation logic, use LLM because:
- ✅ Can handle edge cases ("What if Vesu is down?")
- ✅ Generates user-readable reasoning ("I recommend this because...")
- ✅ Adapts to new pools without code changes
- ✅ Explains its decision (transparency)
- ✅ Can be fine-tuned over time
- ❌ NOT replacing on-chain execution (still deterministic contracts)

**Critical:** LLM is for recommendation only. User confirms before execution.

---

## LLM Options

### Option 1: ChatGPT-mini (Recommended for MVP)
```python
# Cheapest, fastest, good at reasoning
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def get_strategy_recommendation(
    user_risk_profile: str,
    pools_analysis: List[PoolEvaluation],
    user_amount: float
) -> StrategyRecommendation:
    
    prompt = f"""
    User is a {user_risk_profile} risk investor depositing ${user_amount}.
    
    Available pools:
    {format_pools_for_prompt(pools_analysis)}
    
    Recommend allocation across these pools. Consider:
    - User risk tolerance
    - Pool safety scores
    - Available APY
    - Diversification
    
    Return JSON:
    {{
        "allocation": {{
            "pool_1": 0.30,
            "pool_2": 0.50,
            "pool_3": 0.20
        }},
        "reasoning": "...",
        "expected_apy": 0.15,
        "confidence": 0.92
    }}
    """
    
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",  # Cheapest
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        temperature=0.2,  # Low randomness, consistent decisions
    )
    
    return parse_response(response.choices[0].message.content)
```

**Cost:** ~$0.001 per decision (negligible)  
**Speed:** ~500ms  
**Quality:** Excellent reasoning

### Option 2: Local Fine-tuned Model
```python
# More control, no API dependency
from transformers import AutoTokenizer, AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained("./models/allocation-recommender-v1")
tokenizer = AutoTokenizer.from_pretrained("./models/allocation-recommender-v1")

def get_strategy_recommendation(
    user_risk_profile: str,
    pools_analysis: List[PoolEvaluation],
    user_amount: float
) -> StrategyRecommendation:
    
    input_text = format_pools_for_model(user_risk_profile, pools_analysis, user_amount)
    inputs = tokenizer(input_text, return_tensors="pt")
    
    output = model.generate(**inputs, max_length=200)
    response = tokenizer.decode(output[0])
    
    return parse_response(response)
```

**Cost:** $0 (runs locally)  
**Speed:** ~100-200ms  
**Quality:** Good (depends on training data)  
**Complexity:** Requires model training

### Option 3: Deterministic Logic (Fallback)
```python
# If LLM not available, fall back to rules
def get_strategy_recommendation(
    user_risk_profile: str,
    pools_analysis: List[PoolEvaluation],
) -> StrategyRecommendation:
    
    best_safe_pool = max(
        [p for p in pools_analysis if p.risk_score < 40],
        key=lambda p: p.expected_apy
    )
    
    if user_risk_profile == "Conservative":
        return {
            "allocation": {best_safe_pool.id: 0.70, "vesu": 0.30},
            "reasoning": "Conservative selection: prioritize safety",
            "confidence": 0.9
        }
    # ... more rules
```

**Cost:** $0  
**Speed:** <10ms  
**Quality:** Basic  
**Flexibility:** Low

---

## Recommendation Format

### Input to LLM
```python
{
    "user_risk_profile": "balanced",
    "user_amount": 1000,
    "available_pools": [
        {
            "id": "ekubo_strk_eth_0.3",
            "protocol": "Ekubo",
            "pair": "STRK/ETH",
            "risk_score": 58,
            "expected_apy": 28.0,
            "liquidity": 250000,
            "volatility": 0.08,
            "flags": ["moderate_volatility"]
        },
        {
            "id": "ekubo_eth_usdc_0.3",
            "protocol": "Ekubo",
            "pair": "ETH/USDC",
            "risk_score": 25,
            "expected_apy": 12.0,
            "liquidity": 500000,
            "volatility": 0.03,
            "flags": ["stable_pair", "high_liquidity"]
        },
        {
            "id": "vesu_usdc",
            "protocol": "Vesu",
            "asset": "USDC",
            "risk_score": 15,
            "expected_apy": 5.0,
            "flags": ["safe", "lending"]
        }
    ],
    "constraints": {
        "min_liquidity": 50000,
        "max_daily_volatility": 0.05,
        "preferred_diversification": "across protocols"
    }
}
```

### Output from LLM
```json
{
    "allocation": {
        "ekubo_eth_usdc_0.3": 0.40,
        "ekubo_strk_eth_0.3": 0.30,
        "vesu_usdc": 0.30
    },
    "reasoning": "For a balanced investor, I recommend: 40% in stable ETH/USDC LP (good liquidity, low volatility), 30% in STRK/ETH (higher APY, manageable risk), 30% in Vesu lending (safe yield). This balances high returns with risk management.",
    "confidence": 0.87,
    "expected_apy": 0.148,
    "risk_assessment": "Portfolio risk: 38/100 (matches balanced profile)",
    "alternatives": [
        {
            "name": "Conservative",
            "allocation": {"vesu_usdc": 0.6, "ekubo_eth_usdc_0.3": 0.4},
            "expected_apy": 0.08
        }
    ]
}
```

---

## Implementation: Week 1

### 1. Backend Service

```python
# File: backend/app/services/llm_decision_engine.py

from openai import OpenAI
import json
import logging

logger = logging.getLogger(__name__)

class LLMDecisionEngine:
    def __init__(self):
        self.client = OpenAI()
        self.system_prompt = """
You are an expert DeFi portfolio manager. Your job is to recommend 
optimal capital allocation across different protocols and pools based on 
user risk profile and market conditions.

Rules:
1. Always consider user risk tolerance
2. Recommend diversification across protocols (not all in one)
3. Prefer pools with high liquidity and low volatility for conservative users
4. Accept higher risk for aggressive users in exchange for APY
5. Explain reasoning in plain language
6. Return valid JSON only, no extra text

Always return exactly this JSON structure with no markdown or code fences:
{
    "allocation": {pool_id: percentage, ...},
    "reasoning": "...",
    "confidence": 0.0-1.0,
    "expected_apy": 0.0-1.0,
    "risk_assessment": "description"
}
"""

    async def recommend_allocation(
        self,
        user_risk_profile: str,
        pools_analysis: List[PoolEvaluation],
        user_amount: float
    ) -> StrategyRecommendation:
        """Get LLM recommendation for capital allocation"""
        
        try:
            prompt = self._format_prompt(
                user_risk_profile,
                pools_analysis,
                user_amount
            )
            
            response = self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=800,
                response_format={"type": "json_object"}
            )
            
            # Parse response
            content = response.choices[0].message.content
            result = json.loads(content)
            
            # Validate and normalize
            return self._validate_recommendation(result, pools_analysis)
            
        except Exception as e:
            logger.error(f"LLM error: {e}")
            # Fallback to deterministic logic
            return self._fallback_recommendation(user_risk_profile, pools_analysis)

    def _format_prompt(self, user_risk_profile: str, pools: List, amount: float) -> str:
        pools_text = "\n".join([
            f"  - {p.pool_id}: {p.protocol} {p.pair}, "
            f"Risk {p.risk_score}/100, APY {p.expected_apy:.1f}%, "
            f"Liquidity ${p.total_liquidity_usd:,}, "
            f"Volatility {p.volatility_24h:.1%}"
            for p in pools
        ])
        
        return f"""
User Profile: {user_risk_profile}
Deposit Amount: ${amount:,.0f}

Available Pools:
{pools_text}

Please recommend allocation. User is {user_risk_profile.lower()} risk tolerance.
"""

    def _validate_recommendation(
        self,
        result: dict,
        pools_analysis: List
    ) -> StrategyRecommendation:
        """Validate LLM output and ensure it sums to 100%"""
        
        allocation = result.get("allocation", {})
        
        # Normalize to 100%
        total = sum(allocation.values())
        if total > 0:
            allocation = {k: v/total for k, v in allocation.items()}
        
        # Verify pools exist
        valid_pools = {p.pool_id for p in pools_analysis}
        allocation = {k: v for k, v in allocation.items() if k in valid_pools}
        
        # Ensure sums to 1.0
        remaining = 1.0 - sum(allocation.values())
        if abs(remaining) > 0.01:
            # Add to largest pool
            largest = max(allocation, key=allocation.get)
            allocation[largest] += remaining
        
        return StrategyRecommendation(
            allocation=allocation,
            reasoning=result.get("reasoning", ""),
            confidence=result.get("confidence", 0.5),
            expected_apy=result.get("expected_apy", 0.1),
        )

    def _fallback_recommendation(self, user_risk: str, pools: List) -> StrategyRecommendation:
        """Deterministic fallback if LLM fails"""
        
        if user_risk == "Conservative":
            return {
                "allocation": {
                    pools[0].pool_id: 0.7,  # Assuming first is safest
                    pools[2].pool_id: 0.3,  # Vesu or similar
                },
                "reasoning": "LLM unavailable. Conservative allocation: 70% safe, 30% yield.",
                "confidence": 0.6,
                "expected_apy": 0.06,
            }
        # ... more fallbacks
```

### 2. API Endpoint

```python
# File: backend/app/api/routes/strategies.py

from fastapi import APIRouter, HTTPException
from app.services.llm_decision_engine import LLMDecisionEngine
from app.services.pool_analysis import analyze_pool

router = APIRouter(prefix="/api/v1/strategies", tags=["strategies"])
llm_engine = LLMDecisionEngine()

@router.post("/recommend")
async def recommend_strategy(request: StrategyRequest) -> StrategyResponse:
    """
    Analyze pools and recommend allocation based on user risk profile.
    
    Request:
    {
        "user_address": "0x...",
        "risk_profile": "conservative|balanced|aggressive",
        "amount": 1000
    }
    
    Response:
    {
        "allocation": {...},
        "reasoning": "...",
        "confidence": 0.92,
        "pools_analyzed": [...],
        "audit_entry_id": "aud_123"
    }
    """
    
    try:
        # 1. Fetch available pools
        pools = await fetch_available_pools()
        
        # 2. Analyze each pool
        pool_analyses = []
        for pool in pools:
            analysis = await analyze_pool(pool)
            pool_analyses.append(analysis)
        
        # 3. Get LLM recommendation
        recommendation = await llm_engine.recommend_allocation(
            user_risk_profile=request.risk_profile,
            pools_analysis=pool_analyses,
            user_amount=request.amount
        )
        
        # 4. Record in audit trail
        audit_entry = await audit_trail_service.record_strategy_analysis(
            user=request.user_address,
            risk_profile=request.risk_profile,
            pools_analyzed=pool_analyses,
            llm_recommendation=recommendation,
        )
        
        # 5. Return result
        return StrategyResponse(
            allocation=recommendation.allocation,
            reasoning=recommendation.reasoning,
            confidence=recommendation.confidence,
            expected_apy=recommendation.expected_apy,
            pools_analyzed=pool_analyses,
            audit_entry_id=audit_entry.id,
        )
        
    except Exception as e:
        logger.error(f"Strategy recommendation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

### 3. Frontend Integration

```tsx
// File: frontend/src/app/mvp/components/StrategyRecommendation.tsx

import { useState, useEffect } from 'react';
import { StrategyRecommendationResponse } from '@/services/api';

export function StrategyRecommendation({
  riskProfile,
  amount,
  onConfirm,
}: {
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  amount: number;
  onConfirm: (allocation: Allocation) => void;
}) {
  const [recommendation, setRecommendation] = useState<StrategyRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [allocation, setAllocation] = useState<Allocation>({});

  useEffect(() => {
    async function fetchRecommendation() {
      const result = await fetch('/api/v1/strategies/recommend', {
        method: 'POST',
        body: JSON.stringify({
          user_address: userAddress,
          risk_profile: riskProfile,
          amount: amount,
        }),
      }).then(r => r.json());
      
      setRecommendation(result);
      setAllocation(result.allocation);
      setLoading(false);
    }

    fetchRecommendation();
  }, [riskProfile, amount]);

  if (loading) {
    return <div className="animate-pulse">Analyzing pools...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Recommendation Header */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-bold text-blue-900">AI Recommendation</h3>
        <p className="text-sm text-blue-700 mt-2">
          {recommendation.reasoning}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <div className="h-2 w-32 bg-gray-200 rounded">
            <div 
              className="h-2 bg-green-500 rounded"
              style={{ width: `${recommendation.confidence * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono">
            {(recommendation.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
      </div>

      {/* Allocation Breakdown */}
      <div className="space-y-2">
        <h4 className="font-bold">Recommended Allocation</h4>
        {Object.entries(allocation).map(([poolId, percent]) => {
          const pool = recommendation.pools_analyzed.find(p => p.pool_id === poolId);
          return (
            <div key={poolId} className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-sm font-medium">{pool?.pair || poolId}</div>
                <div className="text-xs text-gray-500">{pool?.protocol}</div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={percent * 100}
                onChange={(e) => {
                  const newAllocation = { ...allocation, [poolId]: parseFloat(e.target.value) / 100 };
                  const sum = Object.values(newAllocation).reduce((a, b) => a + b, 0);
                  setAllocation(newAllocation);
                }}
                className="w-32"
              />
              <span className="w-12 text-right text-sm">{(percent * 100).toFixed(0)}%</span>
              <div className="text-xs text-gray-500">APY: {pool?.expected_apy.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {/* Expected Yield */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="text-sm font-medium text-green-900">
          Expected APY: {(recommendation.expected_apy * 100).toFixed(1)}%
        </div>
        <div className="text-xs text-green-700 mt-1">
          At current rates, $1000 → ${(1000 * (1 + recommendation.expected_apy)).toFixed(2)} in one year
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(allocation)}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
        >
          Confirm & Deploy
        </button>
        <button
          onClick={() => {/* Show alternatives */}}
          className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-2 px-4 rounded"
        >
          View Alternatives
        </button>
      </div>

      {/* Audit Trail Link */}
      <div className="text-xs text-gray-500 text-center">
        Decision recorded: <code>{recommendation.audit_entry_id}</code>{' '}
        <a href={`/audit/${recommendation.audit_entry_id}`} className="text-blue-500 hover:underline">
          View proof
        </a>
      </div>
    </div>
  );
}
```

---

## Week 1 Deliverables

- [x] LLM integration (ChatGPT-mini)
- [x] system_prompt tuned for DeFi
- [x] Response parsing and validation
- [x] Fallback logic if LLM fails
- [x] API endpoint `/strategies/recommend`
- [x] Frontend StrategyRecommendation component
- [x] Audit trail recording
- [x] Tests for recommendation accuracy

---

## Fine-tuning (Week 2+)

### Collect Training Data
```
User deposits: N times
AI recommends: X allocation
Actual yield: Y
User feedback: "Good/Bad"

Over time:
- If recommendations consistently beat market baseline → Keep current LLM
- If certain recommendations underperform → Fine-tune on that data
- If user patterns emerge → Update system prompt
```

### Optional: Fine-tune Model
```bash
# After collecting 100+ labeled examples
python scripts/finetune_llm.py \
  --training_data=./data/recommendations_feedback.jsonl \
  --base_model=gpt-3.5-turbo \
  --output_model=./models/allocator-v2
```

---

## Cost Analysis

### Monthly Cost (1000 deposits)
| Option | Cost/month | Speed | Quality |
|--------|-----------|-------|---------|
| ChatGPT-mini | $1 | 500ms | Excellent |
| Local model | $0 | 100ms | Good |
| Fallback logic | $0 | 10ms | Basic |

✅ Start with ChatGPT-mini (negligible cost, great UX)  
⏰ Switch to local model after collecting fine-tuning data

---

Next: Let's integrate with pool analysis and wire up the UI! 🚀
