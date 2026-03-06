# Risk Profile & zkML Pool Evaluation Implementation Plan

**Status:** Ready to implement  
**Date:** February 17, 2026  
**Duration:** 4 weeks (Week 1-4)

---

## Overview

Instead of predefined allocations, users now:
1. Choose their risk profile (Conservative/Balanced/Aggressive)
2. zkML circuit evaluates all available pools
3. LLM recommends best allocation for their risk level
4. Contracts execute across multiple DEXs (Ekubo, JediSwap, Vesu)
5. System flags pools that don't meet risk criteria

---

## Week 1: Risk Profiles & Pool Analysis

### 1.1 Risk Profile Definition (Frontend)

**File:** `zkdefi/frontend/src/components/RiskProfileSelector.tsx`

```tsx
enum RiskProfile {
  CONSERVATIVE = "conservative",  // Low volatility, lower returns
  BALANCED = "balanced",          // Moderate risk/return
  AGGRESSIVE = "aggressive",      // High risk, high return
}

interface RiskProfileData {
  name: string;
  description: string;
  targetAllocation: {
    yield: number;      // % to Vesu/stable yield
    lp: number;         // % to LP positions
    minLiquidity: number; // Minimum pool liquidity required (USD)
    maxSlippage: number; // Max acceptable slippage (%)
    maxVolatility: number; // Max 7-day volatility (%)
  };
  expectedAPY: {
    min: number;
    max: number;
  };
}

const RISK_PROFILES: Record<RiskProfile, RiskProfileData> = {
  [RiskProfile.CONSERVATIVE]: {
    name: "Conservative",
    description: "Safe yields, lower volatility",
    targetAllocation: {
      yield: 70,        // 70% to Vesu
      lp: 30,           // 30% to LP (stable pairs only)
      minLiquidity: 100000,  // Need $100k+ liquidity
      maxSlippage: 0.5,      // Max 0.5% slippage
      maxVolatility: 15,     // Max 15% 7-day volatility
    },
    expectedAPY: { min: 4, max: 8 },
  },
  [RiskProfile.BALANCED]: {
    name: "Balanced",
    description: "Mix of growth and stability",
    targetAllocation: {
      yield: 50,
      lp: 50,
      minLiquidity: 50000,   // Need $50k+ liquidity
      maxSlippage: 1.0,      // Max 1% slippage
      maxVolatility: 30,     // Max 30% volatility
    },
    expectedAPY: { min: 10, max: 20 },
  },
  [RiskProfile.AGGRESSIVE]: {
    name: "Aggressive",
    description: "High growth potential, more volatility",
    targetAllocation: {
      yield: 20,
      lp: 80,
      minLiquidity: 10000,   // Accept lower liquidity pools
      maxSlippage: 3.0,      // Max 3% slippage
      maxVolatility: 60,     // Max 60% volatility
    },
    expectedAPY: { min: 20, max: 50 },
  },
};
```

### 1.2 zkML Circuit: Pool Risk Evaluation

**File:** `zkdefi/backend/app/services/zkml_pool_evaluator.py`

```python
from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime
import hashlib

@dataclass
class PoolMetrics:
    """Raw pool data from DEX"""
    pool_id: str
    dex: str  # "EKUBO", "JEDISWAP", "VESU"
    pair: str  # "ETH/USDC"
    liquidity_usd: float
    volume_24h: float
    fee_tier: float  # 0.01, 0.05, 0.3, 1.0
    price: float
    timestamp: datetime

@dataclass
class PoolRiskAnalysis:
    """Output of zkML circuit"""
    pool_id: str
    risk_score: int  # 0-100 (0=safest, 100=riskiest)
    flags: List[str]  # ["low_liquidity", "high_slippage", "new_pool"]
    metrics: dict
    zkml_proof_hash: str  # Hash of analysis
    confidence: float  # 0-1.0
    recommended_allocation_pct: float  # What % of portfolio

class ZkMLPoolEvaluator:
    """Evaluates pool risk using zkML circuit"""
    
    async def evaluate_pool(self, pool: PoolMetrics) -> PoolRiskAnalysis:
        """
        Run zkML circuit on pool metrics.
        In MVP: Use dummy/heuristic scoring.
        In production: Generate actual STARK proof.
        """
        
        # 1. Calculate volatility (7-day price std dev)
        volatility = await self._calculate_volatility(pool.pool_id)
        
        # 2. Evaluate liquidity depth
        slippage_1k = self._estimate_slippage(
            pool.liquidity_usd, 
            1000 * pool.price  # $1000 in tokens
        )
        
        # 3. Assess fee tier appropriateness
        fee_tier_score = self._score_fee_tier(pool.fee_tier, volatility)
        
        # 4. Check newness (market maturity)
        pool_age_days = (datetime.now() - pool.timestamp).days
        maturity_score = min(pool_age_days / 90, 1.0)  # 0-1.0 over 90 days
        
        # 5. Calculate composite risk score
        risk_components = {
            "liquidity": self._score_liquidity(pool.liquidity_usd),  # lower = more risky
            "volume": self._score_volume(pool.volume_24h, pool.liquidity_usd),
            "volatility": volatility,  # higher = more risky
            "slippage": slippage_1k,  # higher = more risky
            "maturity": maturity_score,  # lower = more risky
        }
        
        risk_score = int(sum(risk_components.values()) / len(risk_components))
        
        # 6. Generate flags
        flags = self._generate_flags(risk_components, pool)
        
        # 7. Create proof commitment (hash of analysis)
        proof_input = f"{pool.pool_id}:{risk_score}:{hashlib.sha256(str(risk_components).encode()).hexdigest()}"
        proof_hash = hashlib.sha256(proof_input.encode()).hexdigest()
        
        return PoolRiskAnalysis(
            pool_id=pool.pool_id,
            risk_score=risk_score,
            flags=flags,
            metrics=risk_components,
            zkml_proof_hash=proof_hash,
            confidence=0.9,
            recommended_allocation_pct=self._calculate_allocation(risk_score),
        )
    
    def _score_liquidity(self, liquidity_usd: float) -> int:
        """Score liquidity: 0 (excellent) to 30 (risky)"""
        if liquidity_usd > 1_000_000:
            return 0  # Excellent
        elif liquidity_usd > 100_000:
            return 10  # Good
        elif liquidity_usd > 10_000:
            return 20  # Fair
        else:
            return 30  # Risky
    
    def _score_volume(self, volume_24h: float, liquidity: float) -> int:
        """Score volume relative to liquidity"""
        ratio = volume_24h / liquidity if liquidity > 0 else 0
        if ratio > 5:  # 5x daily volume relative to liquidity
            return 5
        elif ratio > 1:
            return 15
        elif ratio > 0.1:
            return 20
        else:
            return 25  # Low volume = liquidity risk
    
    def _generate_flags(self, components: dict, pool: PoolMetrics) -> List[str]:
        """Generate warning flags"""
        flags = []
        
        if components["liquidity"] > 25:
            flags.append("low_liquidity")
        if components["volatility"] > 40:
            flags.append("high_volatility")
        if components["slippage"] > 2.0:
            flags.append("high_slippage")
        if components["maturity"] < 0.3:  # Less than 27 days old
            flags.append("new_pool")
        if components["volume"] > 20:
            flags.append("low_volume")
        
        return flags
    
    def _calculate_allocation(self, risk_score: int) -> float:
        """Recommend allocation % based on risk score"""
        # Safe pools (score < 30): Can allocate more
        # Risky pools (score > 70): Allocate less
        if risk_score < 30:
            return 1.0  # Can use fully (100%)
        elif risk_score < 50:
            return 0.8  # 80% safe
        elif risk_score < 70:
            return 0.5  # 50% recommended
        else:
            return 0.2  # 20% only for aggressive
```

### 1.3 Available Pools on Sepolia (Query & Store)

**File:** `zkdefi/backend/app/services/pool_aggregator.py`

```python
class PoolAggregator:
    """Fetch and cache pool data from multiple DEXs"""
    
    async def fetch_all_pools(self) -> List[PoolMetrics]:
        """Fetch available pools from all DEXs"""
        pools = []
        
        # 1. Ekubo pools
        ekubo_pools = await self._fetch_ekubo_pools()
        pools.extend(ekubo_pools)
        
        # 2. JediSwap pools
        jediswap_pools = await self._fetch_jediswap_pools()
        pools.extend(jediswap_pools)
        
        # 3. Vesu (lending, not LP)
        vesu_pools = await self._fetch_vesu_pools()
        pools.extend(vesu_pools)
        
        # 4. Other DEXs (as available)
        other_pools = await self._fetch_other_dexes()
        pools.extend(other_pools)
        
        return pools
    
    async def _fetch_ekubo_pools(self) -> List[PoolMetrics]:
        """Query Ekubo Sepolia pools"""
        # Via RPC call or API
        return [
            PoolMetrics(
                pool_id="ekubo_eth_usdc_0.3",
                dex="EKUBO",
                pair="ETH/USDC",
                liquidity_usd=250000,  # ~$250k on testnet
                volume_24h=50000,
                fee_tier=0.3,
                price=2500,  # ETH price
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_strk_usdc_0.3",
                dex="EKUBO",
                pair="STRK/USDC",
                liquidity_usd=150000,
                volume_24h=30000,
                fee_tier=0.3,
                price=0.8,  # STRK price
                timestamp=datetime.now(),
            ),
            # ... more Ekubo pools
        ]
    
    async def _fetch_jediswap_pools(self) -> List[PoolMetrics]:
        """Query JediSwap if available on Sepolia"""
        # Check current JediSwap Sepolia status
        # If available, fetch similar structure
        return []  # TODO: Verify JediSwap Sepolia support
```

### 1.4 Backend API: Risk Profile + Pool Analysis

**File:** `zkdefi/backend/app/api/routes/risk_profile.py`

```python
from fastapi import APIRouter, HTTPException
from typing import List
from app.services.zkml_pool_evaluator import ZkMLPoolEvaluator, PoolRiskAnalysis
from app.services.pool_aggregator import PoolAggregator

router = APIRouter(prefix="/risk", tags=["risk-profile"])

pool_aggregator = PoolAggregator()
zkml_evaluator = ZkMLPoolEvaluator()

@router.get("/profiles")
async def get_risk_profiles():
    """Get all available risk profiles"""
    return {
        "conservative": {
            "description": "Safe yields, lower volatility",
            "targetAllocation": {"yield": 70, "lp": 30},
            "expectedAPY": {"min": 4, "max": 8},
        },
        "balanced": {
            "description": "Mix of growth and stability",
            "targetAllocation": {"yield": 50, "lp": 50},
            "expectedAPY": {"min": 10, "max": 20},
        },
        "aggressive": {
            "description": "High growth, more volatility",
            "targetAllocation": {"yield": 20, "lp": 80},
            "expectedAPY": {"min": 20, "max": 50},
        },
    }

@router.post("/analyze")
async def analyze_pools_for_risk_profile(risk_profile: str):
    """
    1. Fetch all available pools
    2. Run zkML evaluation on each
    3. Filter pools matching user's risk tolerance
    4. Return ranked recommendations
    """
    
    # Get all pools
    all_pools = await pool_aggregator.fetch_all_pools()
    
    # Evaluate each pool with zkML
    evaluations: List[PoolRiskAnalysis] = []
    for pool in all_pools:
        analysis = await zkml_evaluator.evaluate_pool(pool)
        evaluations.append(analysis)
    
    # Filter based on risk profile
    profile_constraints = {
        "conservative": {"max_risk": 40, "min_liquidity": 100000},
        "balanced": {"max_risk": 60, "min_liquidity": 50000},
        "aggressive": {"max_risk": 100, "min_liquidity": 10000},
    }
    
    constraints = profile_constraints.get(risk_profile)
    if not constraints:
        raise HTTPException(status_code=400, detail="Invalid risk profile")
    
    # Filter pools
    suitable_pools = [
        e for e in evaluations
        if e.risk_score <= constraints["max_risk"]
        and e.metrics.get("liquidity", 0) >= constraints["min_liquidity"]
    ]
    
    # Sort by risk score (safest first)
    suitable_pools.sort(key=lambda x: x.risk_score)
    
    return {
        "risk_profile": risk_profile,
        "available_pools": [
            {
                "pool_id": p.pool_id,
                "risk_score": p.risk_score,
                "flags": p.flags,
                "metrics": p.metrics,
                "zkml_proof_hash": p.zkml_proof_hash,
                "recommended_allocation": p.recommended_allocation_pct,
            }
            for p in suitable_pools[:5]  # Top 5 pools
        ],
        "count": len(suitable_pools),
    }
```

---

## Week 2: LLM Decision Engine & Multi-DEX Routing

### 2.1 LLM Decision Logic

**File:** `zkdefi/backend/app/services/llm_decision_engine.py`

```python
import openai
import json
from typing import Dict, List

class LLMDecisionEngine:
    """Uses small LLM (ChatGPT-mini) to decide optimal allocation"""
    
    def __init__(self, api_key: str):
        openai.api_key = api_key
    
    async def recommend_allocation(
        self,
        risk_profile: str,
        user_risk_score: int,  # 0-100
        available_pools: List[Dict],
        user_amount: float,
    ) -> Dict:
        """
        Given risk profile and available pools,
        LLM recommends allocation strategy.
        """
        
        prompt = f"""
You are a yield optimization expert. A user wants to invest ${user_amount}.

User Profile:
- Risk Tolerance: {risk_profile} (score: {user_risk_score}/100)

Available Pools (evaluated by zkML):
{json.dumps(available_pools, indent=2)}

Rules for {risk_profile} profile:
- Target allocation: Yield (%) / LP (%)
- Only recommend pools with risk_score below constraints
- Prefer safe, high-liquidity pools
- Diversify across 2-3 pools if possible

Respond with JSON:
{{
    "allocation": [
        {{"pool_id": "...", "amount": 1000, "reasoning": "..."}},
        ...
    ],
    "total_allocated": 1000,
    "expected_apy": 12.5,
    "key_risks": ["low_volume", "high_slippage"],
    "confidence": 0.85,
    "explanation": "Investment strategy breakdown"
}}
"""
        
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",  # Or GPT-4-mini when available
            messages=[
                {"role": "system", "content": "You are a yield optimization expert."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,  # Stable, non-creative
            top_p=0.8,
        )
        
        recommendation = json.loads(response.choices[0].message.content)
        
        # Hash the reasoning for audit trail
        import hashlib
        reasoning_hash = hashlib.sha256(
            json.dumps(recommendation).encode()
        ).hexdigest()
        
        recommendation["reasoning_hash"] = reasoning_hash
        
        return recommendation
```

### 2.2 Updated StrategyRouter for Multi-DEX

**File:** `zkdefi/contracts/src/strategy_router.cairo`

```cairo
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub enum DEX {
    EKUBO: (),
    JEDISWAP: (),
    VESU: (),
}

#[derive(Copy, Drop, Serde)]
pub struct PoolAllocation {
    pub dex: DEX,
    pub pool_id: felt252,
    pub amount: u256,
    pub risk_score: u8,  // zkML risk evaluation
    pub expected_apy: u32,  // percentage * 100
}

#[starknet::interface]
pub trait IStrategyRouter<TContractState> {
    fn route_allocation(
        ref self: TContractState,
        user: ContractAddress,
        allocations: Array<PoolAllocation>,
        llm_reasoning_hash: felt252,
    ) -> bool;
}

#[starknet::contract]
mod StrategyRouter {
    use starknet::ContractAddress;
    use super::{DEX, PoolAllocation};

    #[storage]
    struct Storage {
        ekubo_dispatcher: ContractAddress,
        jediswap_dispatcher: ContractAddress,
        vesu_dispatcher: ContractAddress,
        audit_trail: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AllocationRouted: AllocationRouted,
    }

    #[derive(Drop, starknet::Event)]
    struct AllocationRouted {
        user: ContractAddress,
        allocation_count: u32,
        total_amount: u256,
        llm_reasoning_hash: felt252,
    }

    #[abi(embed_v0)]
    impl StrategyRouterImpl of super::IStrategyRouter<ContractState> {
        fn route_allocation(
            ref self: ContractState,
            user: ContractAddress,
            allocations: Array<PoolAllocation>,
            llm_reasoning_hash: felt252,
        ) -> bool {
            // Route each allocation to appropriate DEX
            for allocation in allocations {
                match allocation.dex {
                    DEX::EKUBO(()) => {
                        // Call Ekubo contract
                        // Execute LP position creation
                    },
                    DEX::JEDISWAP(()) => {
                        // Call JediSwap contract
                    },
                    DEX::VESU(()) => {
                        // Call Vesu lending contract
                    }
                }
            }
            
            // Record in audit trail
            // audit_trail.record_llm_allocation(user, allocations, llm_reasoning_hash)
            
            self.emit(AllocationRouted {
                user,
                allocation_count: allocations.len(),
                total_amount: 0,  // Sum of all allocations
                llm_reasoning_hash,
            });
            
            true
        }
    }
}
```

---

## Week 3: Execution & Risk Flagging

### 3.1 Risk Flag Recording

**File:** `zkdefi/backend/app/services/risk_flag_service.py`

```python
from enum import Enum
from datetime import datetime

class RiskFlagType(str, Enum):
    LOW_LIQUIDITY = "low_liquidity"
    HIGH_VOLATILITY = "high_volatility"
    HIGH_SLIPPAGE = "high_slippage"
    NEW_POOL = "new_pool"
    LOW_VOLUME = "low_volume"
    PRICE_DRIFT = "price_drift"
    ORACLE_STALE = "oracle_stale"

class RiskFlagService:
    """Records and tracks risk flags for user awareness"""
    
    async def record_allocation_flags(
        self,
        user: str,
        pool_id: str,
        allocations: List[Dict],
        flags: List[RiskFlagType],
    ):
        """Store risk flags in database with timestamp"""
        
        for flag in flags:
            db_entry = {
                "user": user,
                "pool_id": pool_id,
                "flag_type": flag.value,
                "timestamp": datetime.now(),
                "severity": self._flag_severity(flag),
                "recommendation": self._flag_recommendation(flag),
            }
            
            # Store in database
            # db.risk_flags.insert_one(db_entry)
    
    def _flag_severity(self, flag: RiskFlagType) -> str:
        """0-100 severity score"""
        severity_map = {
            RiskFlagType.LOW_LIQUIDITY: "high",      # Can't exit position
            RiskFlagType.HIGH_VOLATILITY: "medium",  # Risky but can exit
            RiskFlagType.HIGH_SLIPPAGE: "medium",    # Lossy but possible
            RiskFlagType.NEW_POOL: "low",            # Unproven but exists
            RiskFlagType.LOW_VOLUME: "low",          # Illiquid but safe
            RiskFlagType.PRICE_DRIFT: "high",        # Indicates issue
            RiskFlagType.ORACLE_STALE: "high",       # Can't price accurately
        }
        return severity_map[flag]
    
    def _flag_recommendation(self, flag: RiskFlagType) -> str:
        """User-facing recommendation"""
        recommendations = {
            RiskFlagType.LOW_LIQUIDITY: "Pool has low liquidity. Consider smaller allocation.",
            RiskFlagType.HIGH_VOLATILITY: "High volatility detected. This pool is risky today.",
            RiskFlagType.HIGH_SLIPPAGE: "Slippage is high. Large trades may lose more.",
            RiskFlagType.NEW_POOL: "This pool is new to the market. Unproven track record.",
            RiskFlagType.LOW_VOLUME: "Low trading volume. May be hard to exit.",
            RiskFlagType.PRICE_DRIFT: "Price has moved significantly. Proceed cautiously.",
            RiskFlagType.ORACLE_STALE: "Price data is outdated. Wait for refresh.",
        }
        return recommendations[flag]
```

### 3.2 Audit Trail: Recording zkML + LLM Analysis

**File:** `zkdefi/contracts/src/audit_trail.cairo`

```cairo
use starknet::ContractAddress;
use starknet::get_block_timestamp;

#[derive(Copy, Drop, Serde)]
pub struct AllocationDecision {
    pub id: u256,
    pub user: ContractAddress,
    pub risk_profile: felt252,  // "conservative", "balanced", "aggressive"
    pub amount: u256,
    pub zkml_pool_analysis: felt252,  // Hash of pool evaluation
    pub llm_recommendation: felt252,   // Hash of LLM reasoning
    pub allocations: Array<(felt252, u256)>,  // (pool_id, amount)
    pub risk_flags: Array<felt252>,  // Risk flags detected
    pub timestamp: u64,
    pub executed: bool,
}

#[starknet::interface]
pub trait IAuditTrail<TContractState> {
    fn record_allocation_decision(
        ref self: TContractState,
        user: ContractAddress,
        risk_profile: felt252,
        amount: u256,
        zkml_hash: felt252,
        llm_hash: felt252,
        flags: Array<felt252>,
    ) -> u256;  // Returns decision_id
}

#[starknet::contract]
mod AuditTrail {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use super::AllocationDecision;

    #[storage]
    struct Storage {
        next_id: u256,
        decisions: LegacyMap<u256, AllocationDecision>,
    }

    #[abi(embed_v0)]
    impl AuditTrailImpl of super::IAuditTrail<ContractState> {
        fn record_allocation_decision(
            ref self: ContractState,
            user: ContractAddress,
            risk_profile: felt252,
            amount: u256,
            zkml_hash: felt252,
            llm_hash: felt252,
            flags: Array<felt252>,
        ) -> u256 {
            let decision_id = self.next_id.read();
            
            let decision = AllocationDecision {
                id: decision_id,
                user,
                risk_profile,
                amount,
                zkml_pool_analysis: zkml_hash,
                llm_recommendation: llm_hash,
                allocations: array![],  // Filled by StrategyRouter
                risk_flags: flags,
                timestamp: get_block_timestamp(),
                executed: false,
            };
            
            self.decisions.write(decision_id, decision);
            self.next_id.write(decision_id + 1);
            
            decision_id
        }
    }
}
```

---

## Week 4: Frontend Display & Risk Flag UI

### 4.1 Risk Profile Selector Component

**File:** `zkdefi/frontend/src/app/mvp/components/RiskProfileSelector.tsx`

```tsx
import { useState } from 'react';

interface Props {
  onSelect: (profile: 'conservative' | 'balanced' | 'aggressive') => void;
  loading?: boolean;
}

export function RiskProfileSelector({ onSelect, loading }: Props) {
  const [selected, setSelected] = useState<string>();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Select Your Risk Profile</h2>
      
      {/* Conservative */}
      <button
        onClick={() => {
          setSelected('conservative');
          onSelect('conservative');
        }}
        className={`w-full p-4 rounded-lg border-2 transition ${
          selected === 'conservative'
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="text-left">
          <h3 className="font-semibold">🛡️ Conservative</h3>
          <p className="text-sm text-gray-600">Safe yields, lower volatility</p>
          <p className="text-xs mt-2">70% Yield + 30% LP • 4-8% APY</p>
        </div>
      </button>

      {/* Balanced */}
      <button
        onClick={() => {
          setSelected('balanced');
          onSelect('balanced');
        }}
        className={`w-full p-4 rounded-lg border-2 transition ${
          selected === 'balanced'
            ? 'border-purple-500 bg-purple-50'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="text-left">
          <h3 className="font-semibold">⚖️ Balanced</h3>
          <p className="text-sm text-gray-600">Mix of growth and stability</p>
          <p className="text-xs mt-2">50% Yield + 50% LP • 10-20% APY</p>
        </div>
      </button>

      {/* Aggressive */}
      <button
        onClick={() => {
          setSelected('aggressive');
          onSelect('aggressive');
        }}
        className={`w-full p-4 rounded-lg border-2 transition ${
          selected === 'aggressive'
            ? 'border-red-500 bg-red-50'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="text-left">
          <h3 className="font-semibold">🚀 Aggressive</h3>
          <p className="text-sm text-gray-600">High growth, more volatility</p>
          <p className="text-xs mt-2">20% Yield + 80% LP • 20-50% APY</p>
        </div>
      </button>
    </div>
  );
}
```

### 4.2 Pool Analysis & Risk Flags Display

**File:** `zkdefi/frontend/src/app/mvp/components/PoolAnalysis.tsx`

```tsx
interface PoolAnalysisProps {
  pools: PoolRiskAnalysis[];
  riskProfile: string;
  loading?: boolean;
}

export function PoolAnalysisDisplay({ pools, riskProfile, loading }: PoolAnalysisProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Available Pools (Analyzed by zkML)</h3>
      
      {pools.map((pool) => (
        <div
          key={pool.pool_id}
          className="p-4 border rounded-lg"
        >
          <div className="flex justify-between items-start mb-3">
            <div>
              <h4 className="font-semibold">{pool.pair}</h4>
              <p className="text-sm text-gray-600">{pool.dex}</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{pool.expected_apy}%</div>
              <p className="text-xs text-gray-600">APY</p>
            </div>
          </div>

          {/* Risk Score */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm">Risk Score</span>
              <span className={`font-semibold ${
                pool.risk_score < 40 ? 'text-green-600' :
                pool.risk_score < 70 ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {pool.risk_score}/100
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  pool.risk_score < 40 ? 'bg-green-600' :
                  pool.risk_score < 70 ? 'bg-yellow-600' :
                  'bg-red-600'
                }`}
                style={{ width: `${pool.risk_score}%` }}
              />
            </div>
          </div>

          {/* Risk Flags */}
          {pool.flags && pool.flags.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-semibold mb-2">⚠️ Risk Flags:</p>
              <div className="flex flex-wrap gap-2">
                {pool.flags.map((flag) => (
                  <span
                    key={flag}
                    className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded"
                  >
                    {flag.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Proof Hash */}
          <div className="text-xs text-gray-500 font-mono truncate">
            zkML Proof: {pool.zkml_proof_hash.slice(0, 16)}...
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Implementation Checklist

### Week 1
- [ ] Create RiskProfileSelector.tsx (frontend)
- [ ] Create ZkMLPoolEvaluator service
- [ ] Create PoolAggregator service
- [ ] Create /risk/profiles endpoint
- [ ] Create /risk/analyze endpoint
- [ ] Test pool analysis with mock data

### Week 2
- [ ] Create LLMDecisionEngine service
- [ ] Create /strategies/recommend endpoint
- [ ] Test LLM recommendations
- [ ] Update StrategyRouter for multi-DEX
- [ ] Create pool routing logic
- [ ] Test allocation to multiple pools

### Week 3
- [ ] Create RiskFlagService
- [ ] Create AuditTrail contract
- [ ] Record decisions on-chain
- [ ] Test proof recording
- [ ] Create risk flag database

### Week 4
- [ ] Create PoolAnalysisDisplay component
- [ ] Create risk flag UI
- [ ] Integrate full flow: Deposit → Risk → Analysis → Deploy
- [ ] Frontend testing & polish
- [ ] End-to-end testing

---

## Success Criteria

✅ User selects risk profile (Conservative/Balanced/Aggressive)  
✅ zkML evaluates all available pools (risk scores 0-100)  
✅ System flags pools that don't meet risk criteria  
✅ LLM recommends allocation across multiple DEXs  
✅ User can see: "Pool X has risk Y, flags: Z"  
✅ Allocation is recorded on-chain with proofs  
✅ Yield is attributed to pool/date with proof  

---

**Status:** Ready to implement Week 1 ✅
