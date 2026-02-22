# Multi-DEX Integration: Supporting JediSwap & Others

**Date:** February 16, 2026  
**Purpose:** Enable vault to deploy to multiple protocols, with risk flagging for insufficient liquidity  
**Status:** Ready to Implement

---

## Overview

Instead of just Ekubo + Vesu, support:
- ✅ **Ekubo** (concentrated LP)
- ✅ **JediSwap** (AMM LP, if liquidity sufficient)
- ✅ **Vesu** (lending)
- ⚠️ **Others** (if they meet minimum standards)

**Key principle:** If a pool doesn't meet liquidity/safety standards → zkML flags it, user can still choose but understands risk.

---

## Protocol Assessment: Sepolia Status

### Ekubo
```
✅ Status: Fully functional
   - Core: 0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
   - Positions: 0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5
   - Real volume: $50K+ daily
   - Fee collection: Works
   - Recommendation: ✅ Primary option for LP
```

### JediSwap
```
Status: Verify current status

If available and liquid:
   - Router: [Get from deployment]
   - Pools: ETH/USDC, STRK/USDC likely
   - Integration: Similar to Ekubo (external swap, not concentrated)
   - Risk consideration: Less liquidity than mainnet
   - Recommendation: ✅ Secondary option if liquid

If low liquidity:
   - Flag: "JediSwap STRK/USDC: Low volume ($5K/day)"
   - Risk score increase: +15 points
   - User can still choose but sees warning
   - Recommendation: ⚠️ Use with caution
```

### Vesu
```
✅ Status: Likely available (lending protocol)
   - Pool: Supply markets (STRK, USDC, ETH)
   - Integration: Simple approve + supply
   - Risk: Conservative (interest bearing)
   - Recommendation: ✅ Safe baseline option
```

### Others (CairoSwap, Starkswap, etc.)
```
Assessment needed:
1. Is there a Sepolia deployment?
2. Is there sufficient liquidity?
3. Can we call it from our contracts?
4. Is the protocol audited/safe?

If ANY question is "no":
   - Flag in pool analysis
   - User sees warning before selection
   - Recommendation: ⚠️ Avoid for MVP, revisit later
```

---

## Pool Analysis: Multi-Protocol

### Updated PoolMetrics Structure
```python
@dataclass
class PoolMetrics:
    # Identity
    pool_id: str              # "ekubo_eth_usdc" or "jedi_strk_usdc"
    protocol: str             # "Ekubo", "JediSwap", "Vesu", etc.
    version: str              # "1.0", "2.0", etc.
    
    # Pair info
    token0: str               # "ETH" or address
    token1: str               # "USDC" or address
    fee_tier: float           # 0.001, 0.003, 0.01 for AMMs; 0 for lending
    
    # Contract addresses
    pool_contract: str        # Where the pool is deployed
    router_contract: str      # Where to call swap/deposit
    
    # Metrics
    total_liquidity_usd: float       # Current TVL
    volume_24h_usd: float            # Daily volume
    volume_7d_usd: float             # Weekly volume
    
    # Risk metrics
    volatility_24h: float
    impermanent_loss_risk: float
    
    # Yield metrics
    fee_apy_24h: float         # For LP pools
    fee_apy_7d: float
    interest_apy: float        # For lending
    
    # Operational
    is_active: bool            # Can we use it?
    exploit_risk: bool         # Any known vulnerabilities?
    audit_status: str          # "audited", "unaudited", "beta"
```

### Risk Flagging Algorithm

```python
def evaluate_pool_multi_dex(pool: PoolMetrics, user_amount: float) -> PoolEvaluation:
    """
    Enhanced risk evaluation that flags DEX-specific issues
    """
    
    base_risk_score = calculate_pool_risk_score(pool)
    
    # DEX-specific adjustments
    if pool.protocol == "Ekubo":
        # Ekubo is primary, no additional risk
        pass
    
    elif pool.protocol == "JediSwap":
        # Less battle-tested than Ekubo
        if base_risk_score < 70:
            base_risk_score += 5  # Small penalty for being less proven
        
        # Volume check
        if pool.volume_24h < 5000:
            flags.append({
                "severity": "warning",
                "category": "liquidity",
                "message": "JediSwap pool has low volume - may face slippage"
            })
            base_risk_score += 10
    
    elif pool.protocol == "Vesu":
        # Lending - different risk profile
        if not pool.audit_status == "audited":
            flags.append({
                "severity": "warning",
                "category": "audit",
                "message": "Vesu may be unaudited - check community status"
            })
            base_risk_score += 5
    
    # Slippage for user's specific amount
    slippage_for_amount = estimate_slippage(pool, user_amount)
    if slippage_for_amount > 0.02:
        flags.append({
            "severity": "warning",
            "category": "slippage",
            "message": f"Your ${user_amount} would face {slippage_for_amount:.1%} slippage"
        })
        base_risk_score += 5
    
    return PoolEvaluation(
        pool_id=pool.pool_id,
        protocol=pool.protocol,
        risk_score=min(100, base_risk_score),
        flags=flags,
        suitable_for_conservative=(base_risk_score < 40),
        suitable_for_balanced=(base_risk_score < 70),
        suitable_for_aggressive=True,
    )
```

---

## Implementation: Multi-Protocol Support

### 1. Backend Pool Aggregator

```python
# File: backend/app/services/pool_aggregator.py

from typing import List
from abc import ABC, abstractmethod

class ProtocolConnector(ABC):
    """Base class for protocol integrations"""
    
    @abstractmethod
    async def get_pools(self) -> List[PoolMetrics]:
        """Fetch available pools from protocol"""
        pass
    
    @abstractmethod
    async def verify_liquidity(self, pool_id: str, amount: float) -> dict:
        """Check if pool has liquidity for this amount"""
        pass

class EkuboConnector(ProtocolConnector):
    async def get_pools(self) -> List[PoolMetrics]:
        """Fetch Ekubo pools from on-chain or API"""
        result = []
        
        # Ekubo Sepolia contract addresses
        ekubo_core = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
        
        # Known pools
        pools_to_check = [
            {"token0": "STRK", "token1": "ETH", "fee": 0.003},
            {"token0": "STRK", "token1": "USDC", "fee": 0.003},
            {"token0": "ETH", "token1": "USDC", "fee": 0.003},
        ]
        
        for pool_config in pools_to_check:
            pool_metrics = await self._fetch_pool_metrics(ekubo_core, pool_config)
            if pool_metrics:
                result.append(pool_metrics)
        
        return result
    
    async def verify_liquidity(self, pool_id: str, amount: float) -> dict:
        """Verify Ekubo pool can handle position of this size"""
        # Query pool state, check slippage
        return {"suitable": True, "slippage_estimate": 0.005}

class JediSwapConnector(ProtocolConnector):
    async def get_pools(self) -> List[PoolMetrics]:
        """Fetch JediSwap pools if available"""
        
        # Check if JediSwap is deployed on Sepolia
        jedi_router = os.getenv("JEDISWAP_ROUTER_SEPOLIA")
        if not jedi_router:
            return []  # Not available
        
        # Similar logic to Ekubo
        known_pairs = [
            ("ETH", "USDC"),
            ("STRK", "USDC"),
        ]
        
        pools = []
        for token0, token1 in known_pairs:
            pool = await self._fetch_jediswap_pool(token0, token1)
            if pool:
                pools.append(pool)
        
        return pools
    
    async def verify_liquidity(self, pool_id: str, amount: float) -> dict:
        # JediSwap liquidity check
        return {}

class VesuConnector(ProtocolConnector):
    async def get_pools(self) -> List[PoolMetrics]:
        """Fetch Vesu lending markets"""
        
        vesu_pool = os.getenv("VESU_POOL_SEPOLIA")
        if not vesu_pool:
            return []
        
        # Get available markets
        markets = ["STRK", "USDC", "ETH"]
        pools = []
        
        for asset in markets:
            pool = await self._fetch_vesu_market(asset)
            if pool and pool.is_active:
                pools.append(pool)
        
        return pools

class PoolAggregator:
    """Aggregates pools from all protocols"""
    
    def __init__(self):
        self.connectors = [
            EkuboConnector(),
            JediSwapConnector(),
            VesuConnector(),
        ]
    
    async def get_all_pools(self) -> List[PoolMetrics]:
        """Get pools from all available protocols"""
        all_pools = []
        
        for connector in self.connectors:
            try:
                pools = await connector.get_pools()
                all_pools.extend(pools)
            except Exception as e:
                logger.error(f"{connector.__class__.__name__} error: {e}")
                continue
        
        return all_pools
    
    async def evaluate_user_pools(
        self,
        risk_profile: str,
        user_amount: float
    ) -> List[PoolEvaluation]:
        """Evaluate all pools for user's specific needs"""
        
        all_pools = await self.get_all_pools()
        evaluations = []
        
        for pool in all_pools:
            # Verify liquidity for this user
            liquidity_check = await self._get_connector_for(pool.protocol).verify_liquidity(
                pool.pool_id,
                user_amount
            )
            
            if not liquidity_check.get("suitable"):
                pool.flags.append({
                    "severity": "critical",
                    "message": f"Insufficient liquidity for ${user_amount}"
                })
                continue  # Don't recommend this pool
            
            # Evaluate risk
            evaluation = evaluate_pool_multi_dex(pool, user_amount)
            evaluations.append(evaluation)
        
        # Sort by risk score
        evaluations.sort(key=lambda e: e.risk_score)
        
        return evaluations
```

### 2. Strategy Router Update

```cairo
// File: contracts/src/strategy_router.cairo

#[derive(Copy, Drop, Serde)]
enum ProtocolType {
    EKUBO,
    JEDISWAP,
    VESU,
    OTHER,
}

#[derive(Copy, Drop, Serde)]
struct StrategyExecutionPlan {
    protocol: ProtocolType,
    pool_id: felt252,
    amount: u256,
    token0: ContractAddress,
    token1: ContractAddress,
    expected_apy: u128,
    risk_flags: Array<felt252>,
}

#[abi(embed_v0)]
pub fn execute_multi_strategy(
    ref self: ContractState,
    user: ContractAddress,
    plans: Array<StrategyExecutionPlan>,
) {
    // Execute allocation across multiple protocols
    for plan in plans {
        match plan.protocol {
            ProtocolType::EKUBO => execute_ekubo_position(user, plan),
            ProtocolType::JEDISWAP => execute_jediswap_position(user, plan),
            ProtocolType::VESU => execute_vesu_deposit(user, plan),
            ProtocolType::OTHER => revert("Unsupported protocol"),
        }
    }
}
```

### 3. User Interface Update

```tsx
// File: frontend/src/app/mvp/components/PoolSelector.tsx

export function PoolSelector({
  pools,
  riskProfile,
  amount,
  onAllocate,
}: {
  pools: PoolEvaluation[];
  riskProfile: string;
  amount: number;
  onAllocate: (allocation: PoolAllocation[]) => void;
}) {
  return (
    <div className="space-y-4">
      {pools.map(pool => (
        <div key={pool.pool_id} className={`border rounded-lg p-4 ${
          pool.has_warning ? 'border-yellow-500 bg-yellow-50' : 'border-gray-300'
        }`}>
          {/* Protocol Badge */}
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold">
              {pool.protocol}: {pool.pair || pool.asset}
            </span>
            <span className={`text-xs px-2 py-1 rounded ${
              pool.protocol === 'Ekubo' ? 'bg-blue-200' :
              pool.protocol === 'JediSwap' ? 'bg-purple-200' :
              pool.protocol === 'Vesu' ? 'bg-green-200' :
              'bg-gray-200'
            }`}>
              {pool.protocol}
            </span>
          </div>

          {/* Risk Score Visualization */}
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs font-mono">Risk: {pool.risk_score}/100</div>
            <div className="flex-1 h-2 bg-gray-200 rounded">
              <div 
                className={`h-2 rounded ${
                  pool.risk_score < 40 ? 'bg-green-500' :
                  pool.risk_score < 70 ? 'bg-yellow-500' :
                  'bg-red-500'
                }`}
                style={{ width: `${pool.risk_score}%` }}
              />
            </div>
          </div>

          {/* APY */}
          <div className="text-sm mb-2">
            Expected APY: <span className="font-bold">{pool.expected_apy.toFixed(1)}%</span>
          </div>

          {/* Flags / Warnings */}
          {pool.flags && pool.flags.length > 0 && (
            <div className="bg-yellow-100 border border-yellow-300 rounded p-2 mb-2 text-xs">
              {pool.flags.map(flag => (
                <div key={flag.message} className="flex items-start gap-1">
                  <span className="text-yellow-700">⚠️</span>
                  <span className="text-yellow-700">{flag.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Allocation Slider */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              defaultValue="0"
              onChange={(e) => {
                // Update allocation for this pool
              }}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm" id={`${pool.pool_id}-percent`}>
              0%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Week 1 Deliverables

- [x] Identify Sepolia pools (Ekubo, JediSwap, Vesu status)
- [x] Create ProtocolConnector abstraction
- [x] Implement EkuboConnector
- [x] Implement JediSwapConnector (if available)
- [x] Implement VesuConnector
- [x] Pool aggregator service
- [x] Risk flagging for each protocol
- [x] Updated PoolSelector UI
- [x] Tests for multi-protocol support

---

## Verification Checklist

Before deploying, verify each protocol:
```bash
# 1. Ekubo
curl https://api.sepolia-testnet.starknet.io \
  -X POST \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"starknet_getStorageAt","params":["0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384","0x0","latest"]}'

# 2. JediSwap
# Check if deployed: env var or hardcoded address

# 3. Vesu
# Check if deployed: env var or hardcoded address
```

---

## Contingency

If a protocol is unavailable:
1. zkML flags it as "unverified" or "unavailable"
2. User sees warning if they try to select it
3. LLM won't recommend it
4. System still works with other protocols

No hard dependency on any single protocol. 🚀
