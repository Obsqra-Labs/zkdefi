# MVP Implementation Plan: Risk Profiles + zkML Pool Eval + LLM Decision Logic

**Purpose:** Complete scoping document for user-driven, verifiable AI yield optimization

**Status:** Ready to implement (4-week timeline)

---

## 📋 Complete System Overview

### User Journey
```
1. User deposits 1000 STRK
2. Selects risk profile: Conservative / Balanced / Aggressive
3. Frontend calls: POST /strategies/analyze
   - Backend runs zkML pool evaluation
   - Backend calls LLM for recommendations
   - Returns: [Ekubo 60%, Vesu 40%] with confidence + reasoning
4. User confirms allocation
5. Contracts execute
6. Daily yield collection & attribution
7. Dashboard shows earnings with risk flags & proofs
```

---

## Phase 1: Risk Profile Selection (Week 1, Day 1-2)

### 1.1 Frontend Risk Profile Component

**File:** `frontend/src/app/mvp/components/RiskProfileSelector.tsx`

```typescript
type RiskProfile = 'conservative' | 'balanced' | 'aggressive';

interface RiskProfileOption {
  name: RiskProfile;
  label: string;
  description: string;
  targetAllocation: {
    yield: number;      // % to safe yield strategies
    lp: number;         // % to LP strategies
  };
  expectedAPYRange: string;
  riskLevel: string;
}

const RISK_PROFILES: Record<RiskProfile, RiskProfileOption> = {
  conservative: {
    name: 'conservative',
    label: '🛡️ Conservative',
    description: 'Prioritize safety. Prefer stable yields.',
    targetAllocation: { yield: 70, lp: 30 },
    expectedAPYRange: '4-8%',
    riskLevel: 'Low (20-30)',
  },
  balanced: {
    name: 'balanced',
    label: '⚖️ Balanced',
    description: 'Mix of safety and growth.',
    targetAllocation: { yield: 50, lp: 50 },
    expectedAPYRange: '8-16%',
    riskLevel: 'Medium (40-60)',
  },
  aggressive: {
    name: 'aggressive',
    label: '🚀 Aggressive',
    description: 'Maximize returns. Accept higher volatility.',
    targetAllocation: { yield: 30, lp: 70 },
    expectedAPYRange: '15-40%',
    riskLevel: 'High (70-85)',
  },
};

export function RiskProfileSelector({
  onSelect,
  selectedProfile,
}: {
  onSelect: (profile: RiskProfile) => void;
  selectedProfile?: RiskProfile;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {Object.entries(RISK_PROFILES).map(([key, profile]) => (
        <button
          key={key}
          onClick={() => onSelect(profile.name)}
          className={`p-4 border-2 rounded-lg ${
            selectedProfile === key
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300'
          }`}
        >
          <h3 className="font-bold text-lg">{profile.label}</h3>
          <p className="text-sm text-gray-600">{profile.description}</p>
          <div className="mt-3 text-xs">
            <p>Expected APY: {profile.expectedAPYRange}</p>
            <p>Risk Level: {profile.riskLevel}</p>
            <p className="mt-2">
              Allocation: Yield {profile.targetAllocation.yield}% / LP{' '}
              {profile.targetAllocation.lp}%
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
```

---

## Phase 2: zkML Pool Risk Evaluation (Week 1, Day 2-4)

### 2.1 zkML Circuit Definition

**File:** `backend/app/services/zkml/pool_evaluator.py`

```python
from dataclasses import dataclass
from typing import List
import math
from datetime import datetime, timedelta

@dataclass
class PoolMetrics:
    """Metrics for a single pool"""
    pool_id: str
    name: str  # "Ekubo ETH/USDC"
    protocol: str  # "ekubo" | "jediswap" | "vesu"
    liquidity_usd: float
    volume_24h_usd: float
    fee_tier: float  # 0.01, 0.05, 0.3, 1.0
    price_std_dev_24h: float  # volatility
    slippage_at_1000usd: float  # % slippage
    token0: str
    token1: str
    current_apy: float
    timestamp: datetime

@dataclass
class PoolRiskEvaluation:
    """zk-evaluated risk for a pool"""
    pool_id: str
    risk_score: int  # 0-100: 0=safest, 100=riskiest
    confidence: float  # 0-1: how confident in the score
    flags: List[str]  # ["low_liquidity", "high_volatility", ...]
    safety_level: str  # "safe" | "moderate" | "risky"
    recommended_allocation_range: tuple  # (min%, max%) for this pool
    
    def to_dict(self):
        return {
            "pool_id": self.pool_id,
            "risk_score": self.risk_score,
            "confidence": self.confidence,
            "flags": self.flags,
            "safety_level": self.safety_level,
            "recommended_allocation_range": self.recommended_allocation_range,
        }

class PoolRiskEvaluator:
    """
    zkML Circuit: Evaluate pool risk without revealing exact algorithm
    In production, this generates STARK proofs
    For MVP: Mock proofs (just ensure output is deterministic)
    """
    
    def __init__(self):
        # Calibration parameters
        self.min_liquidity_usd = 50_000  # Minimum safe liquidity
        self.max_volatility_safe = 0.15  # 15% std dev max for "safe"
        self.min_volume_to_liquidity_ratio = 0.1  # volume should be 10%+ of liquidity
    
    def evaluate_pool(self, metrics: PoolMetrics) -> PoolRiskEvaluation:
        """
        Evaluate a single pool's risk profile.
        Returns deterministic risk score + flags.
        """
        risk_score = 0
        flags = []
        
        # 1. Liquidity Check (0-30 points)
        liquidity_score = self._evaluate_liquidity(metrics.liquidity_usd)
        risk_score += liquidity_score
        if metrics.liquidity_usd < self.min_liquidity_usd:
            flags.append(f"low_liquidity_${metrics.liquidity_usd:,.0f}")
        
        # 2. Volatility Check (0-25 points)
        volatility_score = self._evaluate_volatility(metrics.price_std_dev_24h)
        risk_score += volatility_score
        if metrics.price_std_dev_24h > self.max_volatility_safe:
            flags.append(f"high_volatility_{metrics.price_std_dev_24h:.1%}")
        
        # 3. Volume/Liquidity Ratio (0-20 points)
        volume_score = self._evaluate_volume(
            metrics.volume_24h_usd,
            metrics.liquidity_usd
        )
        risk_score += volume_score
        ratio = metrics.volume_24h_usd / metrics.liquidity_usd if metrics.liquidity_usd > 0 else 0
        if ratio < self.min_volume_to_liquidity_ratio:
            flags.append(f"low_trading_volume_ratio_{ratio:.2%}")
        
        # 4. Slippage Check (0-15 points)
        slippage_score = self._evaluate_slippage(metrics.slippage_at_1000usd)
        risk_score += slippage_score
        if metrics.slippage_at_1000usd > 0.05:  # >5% is risky
            flags.append(f"high_slippage_{metrics.slippage_at_1000usd:.2%}")
        
        # 5. Fee Tier Appropriateness (0-10 points)
        fee_score = self._evaluate_fee_tier(metrics.fee_tier)
        risk_score += fee_score
        
        # Determine safety level
        if risk_score < 30:
            safety_level = "safe"
            recommended_range = (30, 50)  # Can allocate 30-50% to this pool
        elif risk_score < 60:
            safety_level = "moderate"
            recommended_range = (10, 30)
        else:
            safety_level = "risky"
            recommended_range = (0, 10)
        
        # Generate confidence score: lower risk = higher confidence
        confidence = max(0.5, 1.0 - (risk_score / 150))
        
        return PoolRiskEvaluation(
            pool_id=metrics.pool_id,
            risk_score=min(100, risk_score),  # Cap at 100
            confidence=confidence,
            flags=flags,
            safety_level=safety_level,
            recommended_allocation_range=recommended_range,
        )
    
    def _evaluate_liquidity(self, liquidity_usd: float) -> int:
        """
        0-30 points: More liquidity = safer
        <50k: 30 points (bad)
        50k-100k: 20 points
        100k-500k: 10 points
        >500k: 0 points (good)
        """
        if liquidity_usd < 50_000:
            return 30
        elif liquidity_usd < 100_000:
            return 20
        elif liquidity_usd < 500_000:
            return 10
        else:
            return 0
    
    def _evaluate_volatility(self, std_dev: float) -> int:
        """
        0-25 points: Lower volatility = safer
        <5%: 0 points (stable)
        5-10%: 8 points
        10-15%: 16 points
        >15%: 25 points (risky)
        """
        if std_dev < 0.05:
            return 0
        elif std_dev < 0.10:
            return 8
        elif std_dev < 0.15:
            return 16
        else:
            return 25
    
    def _evaluate_volume(self, volume: float, liquidity: float) -> int:
        """
        0-20 points: Better volume relative to liquidity
        ratio < 0.1: 20 points (illiquid)
        0.1-0.5: 10 points
        >0.5: 0 points (good)
        """
        if liquidity == 0:
            return 20
        ratio = volume / liquidity
        if ratio < 0.1:
            return 20
        elif ratio < 0.5:
            return 10
        else:
            return 0
    
    def _evaluate_slippage(self, slippage_pct: float) -> int:
        """
        0-15 points: Lower slippage = safer
        <1%: 0 points
        1-3%: 5 points
        3-5%: 10 points
        >5%: 15 points
        """
        if slippage_pct < 0.01:
            return 0
        elif slippage_pct < 0.03:
            return 5
        elif slippage_pct < 0.05:
            return 10
        else:
            return 15
    
    def _evaluate_fee_tier(self, fee: float) -> int:
        """
        0-10 points: Is fee tier appropriate?
        For stablecoin pairs (ETH/USDC): 0.01-0.05% is ideal (0 points)
        For volatile pairs (STRK/ETH): 0.3-1.0% is ideal (0 points)
        """
        return 0  # Simplified for MVP
    
    def evaluate_multiple(self, metrics_list: List[PoolMetrics]) -> List[PoolRiskEvaluation]:
        """Evaluate many pools"""
        return [self.evaluate_pool(m) for m in metrics_list]
    
    def rank_by_risk_adjusted_apy(
        self,
        evaluations: List[PoolRiskEvaluation],
        apy_by_pool: dict,  # {pool_id: apy}
    ) -> List[tuple[str, float, float]]:
        """
        Rank pools by risk-adjusted APY
        Returns: [(pool_id, apy, risk_adjusted_score), ...]
        
        Higher risk-adjusted score = better
        """
        rankings = []
        for eval in evaluations:
            if eval.pool_id not in apy_by_pool:
                continue
            
            apy = apy_by_pool[eval.pool_id]
            # Penalize based on risk
            risk_penalty = (eval.risk_score / 100) ** 2  # Quadratic penalty
            risk_adjusted = apy * (1 - risk_penalty) * eval.confidence
            
            rankings.append((eval.pool_id, apy, risk_adjusted))
        
        return sorted(rankings, key=lambda x: x[2], reverse=True)

```

### 2.2 Pool Data Collection

**File:** `backend/app/services/pool_data_collector.py`

```python
from typing import List
import httpx
from datetime import datetime, timedelta
import statistics

class PoolDataCollector:
    """Fetch real pool metrics from Starknet RPC"""
    
    def __init__(self, rpc_url: str = "https://sepolia.rpc.starknet.io"):
        self.rpc_url = rpc_url
    
    async def get_ekubo_pools(self) -> List[dict]:
        """
        Fetch Ekubo pools and their current metrics
        For MVP: Query Ekubo subgraph or RPC
        """
        # Known pools on Sepolia
        pools = [
            {
                "pool_id": "ekubo_eth_usdc_003",
                "name": "ETH/USDC 0.3%",
                "protocol": "ekubo",
                "fee_tier": 0.003,
                "token0": "ETH",
                "token1": "USDC",
            },
            {
                "pool_id": "ekubo_eth_usdc_001",
                "name": "ETH/USDC 0.01%",
                "protocol": "ekubo",
                "fee_tier": 0.0001,
                "token0": "ETH",
                "token1": "USDC",
            },
            {
                "pool_id": "ekubo_strk_usdc",
                "name": "STRK/USDC 0.3%",
                "protocol": "ekubo",
                "fee_tier": 0.003,
                "token0": "STRK",
                "token1": "USDC",
            },
        ]
        
        # TODO: For each pool:
        # 1. Query current price via Ekubo Core contract
        # 2. Query liquidity from subgraph
        # 3. Calculate 24h volume
        # 4. Calculate price volatility from last 24h data
        
        return pools
    
    async def get_jediswap_pools(self) -> List[dict]:
        """Fetch JediSwap pools"""
        # Similar to Ekubo
        return []
    
    async def get_vesu_rates(self) -> dict:
        """Get Vesu lending rates"""
        return {
            "usdc": 0.04,  # 4% APY for USDC
            "strk": 0.03,  # 3% APY for STRK
        }

```

---

## Phase 3: LLM Decision Logic (Week 1, Day 4-5 / Week 2, Day 1-2)

### 3.1 LLM Integration for Strategy Recommendation

**File:** `backend/app/services/llm_strategy_engine.py`

```python
import openai
import json
from typing import Optional

class LLMStrategyEngine:
    """
    Uses small LLM (ChatGPT-mini or local) to generate strategy recommendations
    based on user risk profile + pool evaluations
    """
    
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4-turbo"):
        self.api_key = api_key
        self.model = model
        if api_key:
            openai.api_key = api_key
    
    def generate_recommendation(
        self,
        user_risk_profile: str,  # "conservative" | "balanced" | "aggressive"
        deposit_amount: float,
        pool_evaluations: dict,  # {pool_id: PoolRiskEvaluation}
        apy_by_pool: dict,  # {pool_id: apy}
    ) -> dict:
        """
        Query LLM to generate allocation recommendation
        
        Returns:
        {
            "allocation": {"ekubo_eth_usdc": 0.60, "vesu_usdc": 0.40},
            "reasoning": "Based on your balanced profile...",
            "confidence": 0.87,
            "expected_apy_blended": 0.12,
        }
        """
        
        # Build context for LLM
        pool_info = self._format_pool_info(pool_evaluations, apy_by_pool)
        
        prompt = f"""
You are a DeFi yield optimizer for a user-controlled vault system.

User Profile:
- Risk Preference: {user_risk_profile.upper()}
- Deposit Amount: ${deposit_amount:,.2f}

Available Pools & Evaluations:
{pool_info}

Guidelines:
1. Conservative users: Prefer pools with risk_score < 40, allocate to yield strategies
2. Balanced users: Mix pools with risk_score 30-70, balance LP and yield
3. Aggressive users: Can use risk_score up to 85, favor higher APY L pools

Task: Generate an allocation recommendation.

Return valid JSON:
{{
    "allocation": {{"pool_id_1": 0.60, "pool_id_2": 0.40}},
    "reasoning": "text explaining why this allocation matches the user's profile",
    "confidence": 0.85,
    "expected_apy_blended": 0.12,
    "risk_considerations": ["item1", "item2"]
}}
"""
        
        response = openai.ChatCompletion.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a yield optimization AI."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,  # Low temperature for consistency
            max_tokens=500,
        )
        
        result_text = response.choices[0].message.content
        
        # Parse JSON from response
        try:
            result = json.loads(result_text)
        except json.JSONDecodeError:
            # Fallback if LLM doesn't return valid JSON
            result = self._generate_fallback_recommendation(
                user_risk_profile, pool_evaluations, apy_by_pool
            )
        
        return result
    
    def _format_pool_info(self, evaluations: dict, apy_by_pool: dict) -> str:
        """Format pool evaluation data for LLM"""
        lines = []
        for pool_id, eval in evaluations.items():
            apy = apy_by_pool.get(pool_id, 0)
            flags_str = ", ".join(eval.flags) if eval.flags else "none"
            
            lines.append(f"""
Pool: {pool_id}
  Risk Score: {eval.risk_score}/100
  Safety Level: {eval.safety_level}
  Current APY: {apy:.2%}
  Flags: {flags_str}
  Recommended Allocation: {eval.recommended_allocation_range[0]}-{eval.recommended_allocation_range[1]}%
            """)
        
        return "\n".join(lines)
    
    def _generate_fallback_recommendation(
        self,
        user_risk_profile: str,
        evaluations: dict,
        apy_by_pool: dict,
    ) -> dict:
        """
        Deterministic fallback if LLM fails or for MVP testing
        """
        allocation = {}
        
        if user_risk_profile == "conservative":
            # Sort by risk score (ascending = safer)
            sorted_pools = sorted(
                evaluations.items(),
                key=lambda x: x[1].risk_score
            )
            # Allocate to safest pools
            safe_pools = [p for p in sorted_pools if p[1].risk_score < 40]
            if safe_pools:
                for pool_id, eval in safe_pools[:2]:
                    allocation[pool_id] = 0.5
        
        elif user_risk_profile == "balanced":
            # Mix of safe and moderate
            for pool_id, eval in evaluations.items():
                if eval.risk_score < 60:
                    allocation[pool_id] = 0.33
        
        else:  # aggressive
            # Favor high APY
            sorted_by_apy = sorted(
                apy_by_pool.items(),
                key=lambda x: x[1],
                reverse=True
            )
            for pool_id, apy in sorted_by_apy[:2]:
                allocation[pool_id] = 0.5
        
        # Normalize to 1.0
        total = sum(allocation.values())
        if total > 0:
            allocation = {k: v/total for k, v in allocation.items()}
        
        return {
            "allocation": allocation,
            "reasoning": f"Deterministic allocation for {user_risk_profile} profile",
            "confidence": 0.70,
            "expected_apy_blended": 0.10,
        }

```

---

## Phase 4: Smart Contract Deployment (Week 2)

### 4.1 Updated VaultManager with Risk Profile

**File:** `contracts/src/vault_manager_v2.cairo`

```cairo
use starknet::ContractAddress;
use starknet::get_caller_address;

#[derive(Copy, Drop, Serde)]
pub enum RiskProfile {
    CONSERVATIVE: (),   // 0
    BALANCED: (),       // 1
    AGGRESSIVE: (),     // 2
}

#[starknet::interface]
pub trait IVaultManager<TContractState> {
    fn deposit(
        ref self: TContractState,
        amount: u256,
        risk_profile: RiskProfile,
    ) -> u256;  // Returns deposit_id
    
    fn get_user_deposit(
        self: @TContractState,
        user: ContractAddress,
        deposit_id: u256,
    ) -> (u256, RiskProfile, felt252);  // (amount, risk_profile, status)
    
    fn get_pending_deposits(
        self: @TContractState,
        user: ContractAddress,
    ) -> Array<u256>;  // deposit_ids waiting for strategy allocation
}

#[starknet::contract]
mod VaultManager {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use super::{RiskProfile};

    #[storage]
    struct Storage {
        token: ContractAddress,
        next_deposit_id: u256,
        deposits: LegacyMap<(ContractAddress, u256), (u256, u8)>,  // (amount, risk_profile)
        pending: LegacyMap<ContractAddress, Array<u256>>,
        audit_trail: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DepositReceived: DepositReceived,
    }

    #[derive(Drop, starknet::Event)]
    struct DepositReceived {
        user: ContractAddress,
        deposit_id: u256,
        amount: u256,
        risk_profile: u8,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        audit_trail: ContractAddress,
    ) {
        self.token.write(token);
        self.audit_trail.write(audit_trail);
        self.next_deposit_id.write(1);
    }

    #[abi(embed_v0)]
    impl VaultManagerImpl of super::IVaultManager<ContractState> {
        fn deposit(
            ref self: ContractState,
            amount: u256,
            risk_profile: RiskProfile,
        ) -> u256 {
            let caller = get_caller_address();
            let deposit_id = self.next_deposit_id.read();
            
            // Store deposit
            let profile_u8 = match risk_profile {
                RiskProfile::CONSERVATIVE(()) => 0,
                RiskProfile::BALANCED(()) => 1,
                RiskProfile::AGGRESSIVE(()) => 2,
            };
            
            self.deposits.write((caller, deposit_id), (amount, profile_u8));
            self.next_deposit_id.write(deposit_id + 1);
            
            self.emit(DepositReceived {
                user: caller,
                deposit_id,
                amount,
                risk_profile: profile_u8,
            });
            
            deposit_id
        }

        fn get_user_deposit(
            self: @ContractState,
            user: ContractAddress,
            deposit_id: u256,
        ) -> (u256, RiskProfile, felt252) {
            let (amount, profile_u8) = self.deposits.read((user, deposit_id));
            let risk_profile = match profile_u8 {
                0 => RiskProfile::CONSERVATIVE(()),
                1 => RiskProfile::BALANCED(()),
                2 => RiskProfile::AGGRESSIVE(()),
                _ => RiskProfile::BALANCED(()),
            };
            
            (amount, risk_profile, 'PENDING')
        }

        fn get_pending_deposits(
            self: @ContractState,
            user: ContractAddress,
        ) -> Array<u256> {
            // TODO: Iterate through all deposits for user that are PENDING
            array![]
        }
    }
}
```

---

## Phase 5: Backend API Endpoint (Week 2)

### 5.1 Strategy Analysis Endpoint

**File:** `backend/app/api/routes/strategies/analyze.py`

```python
from fastapi import Router, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

router = Router()

class AnalyzeStrategyRequest(BaseModel):
    user_address: str
    deposit_amount: float
    risk_profile: str  # "conservative" | "balanced" | "aggressive"
    deposit_id: int
    token: str = "STRK"

class PoolAnalysisResult(BaseModel):
    pool_id: str
    protocol: str
    name: str
    risk_score: int
    safety_level: str
    current_apy: float
    recommended_allocation_range: tuple

class StrategyRecommendation(BaseModel):
    allocation: dict  # {pool_id: percentage}
    reasoning: str
    confidence: float
    expected_apy_blended: float
    risk_considerations: List[str]
    pool_analysis: List[PoolAnalysisResult]
    proof_hash: str  # Hash of analysis for audit trail

class AnalyzeStrategyResponse(BaseModel):
    recommendation: StrategyRecommendation
    audit_entry_id: int
    timestamp: str

@router.post("/analyze", response_model=AnalyzeStrategyResponse)
async def analyze_strategy(request: AnalyzeStrategyRequest):
    """
    Complete analysis pipeline:
    1. Fetch pool data
    2. Run zkML evaluation on each pool
    3. Rank by risk-adjusted APY
    4. Call LLM for recommendation
    5. Record in audit trail
    6. Return complete analysis to frontend
    """
    
    logger = logging.getLogger(__name__)
    
    try:
        # Step 1: Fetch current pool metrics
        logger.info(f"Fetching pool data for {request.token}")
        pool_collector = PoolDataCollector()
        
        ekubo_pools = await pool_collector.get_ekubo_pools()
        jediswap_pools = await pool_collector.get_jediswap_pools()
        vesu_rates = await pool_collector.get_vesu_rates()
        
        all_pools = ekubo_pools + jediswap_pools
        
        # Step 2: Convert to PoolMetrics and evaluate with zkML
        logger.info("Running zkML pool evaluations")
        evaluator = PoolRiskEvaluator()
        pool_metrics_list = [
            PoolMetrics(
                pool_id=p["pool_id"],
                name=p["name"],
                protocol=p["protocol"],
                liquidity_usd=p.get("liquidity_usd", 100_000),
                volume_24h_usd=p.get("volume_24h_usd", 50_000),
                fee_tier=p["fee_tier"],
                price_std_dev_24h=p.get("volatility", 0.08),
                slippage_at_1000usd=p.get("slippage", 0.02),
                token0=p["token0"],
                token1=p["token1"],
                current_apy=p.get("apy", 0.10),
                timestamp=datetime.now(),
            )
            for p in all_pools
        ]
        
        evaluations = evaluator.evaluate_multiple(pool_metrics_list)
        evaluations_dict = {e.pool_id: e for e in evaluations}
        
        # Build APY dict
        apy_by_pool = {m.pool_id: m.current_apy for m in pool_metrics_list}
        apy_by_pool.update({
            "vesu_usdc": vesu_rates["usdc"],
            "vesu_strk": vesu_rates["strk"],
        })
        
        # Step 3: Rank pools
        rankings = evaluator.rank_by_risk_adjusted_apy(evaluations, apy_by_pool)
        logger.info(f"Top pools: {[r[0] for r in rankings[:3]]}")
        
        # Step 4: Call LLM for recommendation
        logger.info("Calling LLM for strategy recommendation")
        llm_engine = LLMStrategyEngine()
        llm_recommendation = llm_engine.generate_recommendation(
            user_risk_profile=request.risk_profile,
            deposit_amount=request.deposit_amount,
            pool_evaluations=evaluations_dict,
            apy_by_pool=apy_by_pool,
        )
        
        # Step 5: Record in audit trail
        logger.info("Recording analysis in audit trail")
        audit_entry = await audit_trail_service.record_strategy_analysis(
            user_address=request.user_address,
            deposit_id=request.deposit_id,
            risk_profile=request.risk_profile,
            pool_evaluations=[e.to_dict() for e in evaluations],
            llm_recommendation=llm_recommendation,
        )
        
        # Step 6: Build response
        pool_analysis = [
            PoolAnalysisResult(
                pool_id=e.pool_id,
                protocol=evaluations_dict[e.pool_id].pool_id.split("_")[0],
                name=evaluations_dict[e.pool_id].pool_id,
                risk_score=e.risk_score,
                safety_level=e.safety_level,
                current_apy=apy_by_pool.get(e.pool_id, 0),
                recommended_allocation_range=e.recommended_allocation_range,
            )
            for e in evaluations
        ]
        
        recommendation = StrategyRecommendation(
            allocation=llm_recommendation["allocation"],
            reasoning=llm_recommendation["reasoning"],
            confidence=llm_recommendation["confidence"],
            expected_apy_blended=llm_recommendation["expected_apy_blended"],
            risk_considerations=llm_recommendation.get("risk_considerations", []),
            pool_analysis=pool_analysis,
            proof_hash=audit_entry["proof_hash"],  # Hash of all analysis data
        )
        
        return AnalyzeStrategyResponse(
            recommendation=recommendation,
            audit_entry_id=audit_entry["id"],
            timestamp=datetime.now().isoformat(),
        )
    
    except Exception as e:
        logger.error(f"Error analyzing strategy: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
```

---

## Phase 6: Audit Trail with Proofs (Week 3)

### 6.1 Audit Trail Contract

**File:** `contracts/src/audit_trail_v2.cairo`

```cairo
use starknet::ContractAddress;
use starknet::get_block_timestamp;

#[derive(Copy, Drop, Serde)]
pub struct StrategyAnalysisRecord {
    pub id: u256,
    pub user: ContractAddress,
    pub deposit_id: u256,
    pub risk_profile: u8,  // 0=conservative, 1=balanced, 2=aggressive
    pub timestamp: u64,
    pub pool_evaluations_hash: felt252,  // Hash of zkML results
    pub llm_reasoning_hash: felt252,     // Hash of LLM decision
    pub allocation_executed: bool,
    pub execution_tx_hash: felt252,
}

#[starknet::interface]
pub trait IAuditTrail<TContractState> {
    fn record_analysis(
        ref self: TContractState,
        user: ContractAddress,
        deposit_id: u256,
        risk_profile: u8,
        pool_evaluations_hash: felt252,
        llm_reasoning_hash: felt252,
    ) -> u256;  // Returns record_id
    
    fn mark_executed(
        ref self: TContractState,
        record_id: u256,
        execution_tx_hash: felt252,
    );
    
    fn get_record(self: @TContractState, record_id: u256) -> StrategyAnalysisRecord;
}

#[starknet::contract]
mod AuditTrail {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use super::StrategyAnalysisRecord;

    #[storage]
    struct Storage {
        next_id: u256,
        records: LegacyMap<u256, StrategyAnalysisRecord>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AnalysisRecorded: AnalysisRecorded,
    }

    #[derive(Drop, starknet::Event)]
    struct AnalysisRecorded {
        record_id: u256,
        user: ContractAddress,
        risk_profile: u8,
        timestamp: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl AuditTrailImpl of super::IAuditTrail<ContractState> {
        fn record_analysis(
            ref self: ContractState,
            user: ContractAddress,
            deposit_id: u256,
            risk_profile: u8,
            pool_evaluations_hash: felt252,
            llm_reasoning_hash: felt252,
        ) -> u256 {
            let record_id = self.next_id.read();
            
            let record = StrategyAnalysisRecord {
                id: record_id,
                user,
                deposit_id,
                risk_profile,
                timestamp: get_block_timestamp(),
                pool_evaluations_hash,
                llm_reasoning_hash,
                allocation_executed: false,
                execution_tx_hash: 0,
            };
            
            self.records.write(record_id, record);
            self.next_id.write(record_id + 1);
            
            self.emit(AnalysisRecorded {
                record_id,
                user,
                risk_profile,
                timestamp: record.timestamp,
            });
            
            record_id
        }

        fn mark_executed(
            ref self: ContractState,
            record_id: u256,
            execution_tx_hash: felt252,
        ) {
            let mut record = self.records.read(record_id);
            record.allocation_executed = true;
            record.execution_tx_hash = execution_tx_hash;
            self.records.write(record_id, record);
        }

        fn get_record(self: @ContractState, record_id: u256) -> StrategyAnalysisRecord {
            self.records.read(record_id)
        }
    }
}
```

---

## Phase 7: Yield Attribution (Week 3-4)

### 7.1 Yield Tracking

**File:** `backend/app/services/yield_tracker.py`

```python
from datetime import datetime
from typing import List
from dataclasses import dataclass

@dataclass
class YieldRecord:
    """Record of a single yield accrual event"""
    id: u256
    user: str
    strategy_allocation_id: u256
    pool_id: str
    protocol: str
    amount: float
    token: str
    date: datetime
    source_tx_hash: str
    risk_flag: Optional[str]  # e.g., "high_slippage" if applicable

class YieldTracker:
    """Track and attribute all yield to source pools"""
    
    async def accrue_ekubo_fees(self):
        """Daily task: Collect fees from all active Ekubo positions"""
        logger = logging.getLogger(__name__)
        
        # Get all active Ekubo positions
        positions = await db.get_active_ekubo_positions()
        
        for position in positions:
            try:
                # Call Ekubo Core.collect_fees()
                fees = await ekubo_api.collect_fees(
                    pool_key=position.pool_key,
                    bounds=position.bounds,
                )
                
                # Log to yield table
                for token, amount in fees.items():
                    yield_record = YieldRecord(
                        user=position.user,
                        strategy_allocation_id=position.allocation_id,
                        pool_id=position.pool_id,
                        protocol="ekubo",
                        amount=amount,
                        token=token,
                        date=datetime.now(),
                        source_tx_hash=fees.tx_hash,
                        risk_flag=None,  # Could flag if slippage > expected
                    )
                    await db.create_yield_record(yield_record)
                    
                    logger.info(
                        f"Recorded {amount} {token} fee for {position.user} "
                        f"from {position.pool_id}"
                    )
            
            except Exception as e:
                logger.error(f"Error collecting fees for position {position.id}: {e}")
    
    async def accrue_vesu_interest(self):
        """Daily task: Accrue interest from all active Vesu deposits"""
        # Similar to above but for lending interest
        pass
    
    async def get_yield_history(
        self,
        user: str,
        days: int = 30,
    ) -> List[YieldRecord]:
        """Get yield for user over last N days"""
        return await db.get_yield_records(
            user=user,
            days=days,
        )
    
    async def get_yield_breakdown(
        self,
        user: str,
    ) -> dict:
        """Get yield breakdown by protocol/pool"""
        records = await self.get_yield_history(user)
        
        breakdown = {}
        total = 0.0
        
        for record in records:
            key = f"{record.protocol}_{record.pool_id}"
            if key not in breakdown:
                breakdown[key] = {
                    "protocol": record.protocol,
                    "pool_id": record.pool_id,
                    "amount": 0.0,
                    "token": record.token,
                    "transactions": [],
                }
            
            breakdown[key]["amount"] += record.amount
            breakdown[key]["transactions"].append({
                "date": record.date.isoformat(),
                "amount": record.amount,
                "tx_hash": record.source_tx_hash,
                "risk_flag": record.risk_flag,
            })
            total += record.amount
        
        return {
            "total_yield": total,
            "by_pool": breakdown,
        }
```

---

## 4-Week Timeline Summary

| Week | Phase | Deliverables |
|------|-------|--------------|
| **1** | Risk Profile + zkML | Risk selector UI, Pool evaluator circuit, zkML mocking, Backend pool data |
| **2** | LLM + Contracts | LLM integration, Strategy analysis API, VaultManager v2, Audit trail |
| **3** | Execution + Tracking | Deploy all contracts, Fee collection working, Yield tracking DB |
| **4** | Frontend + Polish | Dashboard with yield breakdown, Proof verification UI, Testing & demo |

---

## Success Criteria

- [ ] User can select risk profile and see pool evaluations
- [ ] zkML circuit scores pools, LLM recommends allocation
- [ ] Allocation is recorded on-chain with proof hash
- [ ] Contracts execute allocation (Ekubo LP + Vesu yield)
- [ ] Daily yield collection working
- [ ] Dashboard shows yield with risk flags and source TX links
- [ ] User can verify: "This yield came from this pool on this date"

---

**Next Step:** Begin Week 1 contract compilation and backend pool data setup
