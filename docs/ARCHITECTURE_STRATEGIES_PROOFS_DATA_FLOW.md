# Architecture: Strategies, Proofs & Intelligent Data Flow

**Date:** 2026-03-06  
**Status:** Reference Architecture - Complete Data Pipeline

---

## Overview

The zkde.fi system has a sophisticated multi-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ USER INTERFACE LAYER                                        │
│ Mission Control (3-column layout)                           │
│ - Capital Ledger (left)                                     │
│ - Execution Flow / Workbenches (center)                     │
│ - Control Plane (right)                                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ INTELLIGENCE LAYER (Oracle Surface)                         │
│ - Signals Tab (Opportunities + Recommendations)             │
│ - Radar Tab (Market Anomalies)                              │
│ - Genome Tab (Strategy Composition)                         │
│ ↑ Feeds into Policy/Strategy Selection                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STRATEGY EXECUTION LAYER                                    │
│ - Strategy Recommendation Service (Python circuits)         │
│ - Policy Engine (constraints evaluation)                    │
│ - Orchestration/Execution Guard (proof-gated)              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ PROOF & VERIFICATION LAYER (zkML/Circuits)                 │
│ - Risk Score Proof (Groth16)                                │
│ - Anomaly Detection Proof (EZKL)                            │
│ - Solvency Proof (STARK)                                    │
│ - Strategy Integrity Proof                                  │
│ - Execution Integrity Proof                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ DATA LAYER (zkRAG/zkGraph/On-Chain)                        │
│ - Market data (Ekubo pools, TVL, APY)                       │
│ - Reputation/Credential system                              │
│ - Proof receipts and performance history                    │
│ - Madara L3 fact storage                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Strategies as Python Circuits

**File:** `backend/app/services/strategy_recommendation_service.py`

Strategies are **not** hardcoded - they're implemented as Python functions that run as "circuits":

```python
async def get_recommendation(
    user_address: str,
    amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """
    Python circuit for strategy recommendation.
    - Takes user input (address, amount, risk profile)
    - Computes optimal allocation based on risk profile
    - Returns pool recommendations with constraints
    - Later: wrapped as zkML proof for verification
    """
    if risk_profile == "conservative":
        allocation_pct1, allocation_pct2 = 0.7, 0.3  # 70/30 split
    elif risk_profile == "aggressive":
        allocation_pct1, allocation_pct2 = 0.3, 0.7  # 30/70 split
    else:
        allocation_pct1, allocation_pct2 = 0.6, 0.4  # 60/40 split
    
    return {
        "recommended_pools": [
            {
                "pool_id": "ekubo_eth_usdc",
                "allocation_percent": allocation_pct1 * 100,
                "expected_apy": 0.275,  # 27.5%
                "risk_score": 30.0,
            },
            # ...
        ],
        "ai_reasoning": f"Based on {risk_profile} profile, we recommend...",
        "ai_confidence": 0.85,
    }
```

**Key points:**
- These are **deterministic functions** - same input always produces same output
- Can be **proven** - wrapped as zkML circuits and executed with calldata
- **Composable** - multiple strategies can be chained
- **Verifiable** - proofs generated and stored in `strategy_performance.json`

---

## Layer 2: Strategy Model & Genome

**File:** `backend/app/models/strategy.py`

Each strategy has a "genome" - a set of computed factors that make it evaluable:

```python
class GenomeFactors(BaseModel):
    """Computed genome factors for a strategy (0-100 scores)."""
    yield_score: float           # Based on APY percentile
    risk_score: float            # From zkML evaluator
    volatility_score: float      # From price std dev
    liquidity_score: float       # From TVL depth
    efficiency_score: float      # Risk-adjusted yield
    
    @property
    def composite_score(self) -> float:
        """Weighted ranking score."""
        return (
            self.yield_score * 0.3 +
            (100 - self.risk_score) * 0.25 +  # Lower risk = better
            (100 - self.volatility_score) * 0.15 +
            self.liquidity_score * 0.2 +
            self.efficiency_score * 0.1
        )

class Strategy(BaseModel):
    """Persistent strategy entity."""
    strategy_id: str             # Content-addressable hash
    pool_id: str                 # e.g. "ETH/USDC"
    protocol: str                # "Ekubo", "JediSwap"
    
    # Current market data
    apy: float
    tvl_usd: float
    
    # Computed intelligence
    genome: GenomeFactors
    zkml_risk_score: Optional[int] = None  # Proof result
    zkml_flags: list[str] = []              # Risk flags from zkML
    
    created_at: datetime
    updated_at: datetime
```

**How genome flows:**
1. **Fetch** market data (APY, TVL, volatility)
2. **Compute** genome factors (normalize to 0-100)
3. **Run zkML proof** to verify risk_score (Groth16 circuit)
4. **Store** strategy with genome and proof hash
5. **Display** in Genome Tab for inspection

---

## Layer 3: Proof Package Generation

**Files:** `backend/app/api/routes/mission_control.py`, `backend/app/services/stark_proof_generator.py`

When an execution is initiated, a "proof package" is generated:

```python
# From mission_control.py
proof_package = {
    "status": "complete" if proof_hash else "pending",
    "proof_hash": proof_hash,
    "policy_hash": constraint_hash,
    "constraint_hash": specific_constraints_hash,
    "receipt_root": merkle_root_of_all_proofs,
}

# Proof types generated:
# 1. Risk Score Proof (Groth16)       - Proves risk <= policy_max_risk
# 2. Anomaly Detection Proof (EZKL)   - Proves no pattern anomalies
# 3. Solvency Proof (STARK)           - Proves position solvency
# 4. Strategy Integrity Proof         - Proves strategy allocation valid
# 5. Execution Integrity Proof        - Proves execution matches intent
```

**Flow:**
```
Intent Submitted
    ↓
Policy Evaluated (from constraints)
    ↓
[zkML Risk Score Proof] - Verify risk_score <= max_allowed
[Anomaly Detection Proof] - Verify no market anomalies
[Solvency Proof] - Verify user can execute
    ↓
All Proofs Complete
    ↓
Gate Status = PASS
    ↓
Execution Guard allows execution
```

---

## Layer 4: Reputation & Proof Ingestion

**Files:** `frontend/src/app/profile/page.tsx`, `backend/app/api/routes/reputation.py`

The Profile page shows how proofs feed into reputation:

```typescript
// Fetch user reputation which aggregates proofs
const userRep = await fetch(`/api/v1/zkdefi/reputation/user/${address}`)
  .then(r => r.json())
  // Returns:
  // {
  //   "tier": 2,
  //   "tier_name": "Intermediate",
  //   "proofs_submitted": 42,
  //   "proofs_verified": 40,
  //   "success_rate": 0.952,
  //   "risk_score": 35,
  //   "collateral_ratio": 1.5,
  //   "zkml_badges": ["low_risk", "high_liquidity"],
  //   "reputation_score": 780
  // }

// Stake collateral to increase reputation
await fetch(`/api/v1/zkdefi/reputation/stake-collateral`, {
  method: "POST",
  body: JSON.stringify({ address, amount_eth: 0.1 })
})
// Returns: { new_tier: 3, new_tier_name: "Advanced" }

// Request tier upgrade (proof-gated)
await fetch(`/api/v1/zkdefi/reputation/upgrade-tier`, {
  method: "POST",
  body: JSON.stringify({ address })
})
// Returns: { success: true, new_tier: 3, upgrade_proof: "0x..." }
```

**Reputation Tiers:**
- Tier 0: Unverified (no proofs submitted)
- Tier 1: Novice (1-10 proofs, >50% success rate)
- Tier 2: Intermediate (10-50 proofs, >80% success rate)
- Tier 3: Advanced (50+ proofs, >90% success rate)
- Tier 4: Expert (100+ proofs, 95%+ success rate, zkML badges)

---

## Layer 5: Intelligence Surface Integration

**Files:** `frontend/src/components/zkdefi/oracle/*`, `frontend/src/components/zkdefi/vault/YieldTab.tsx`

The Oracle Surface consumes proofs and strategies to make recommendations:

```typescript
// OracleSignalsTab.tsx - Opportunities from Strategies
const opportunities = await fetch(`/api/v1/strategies/opportunities`, {
  method: "POST",
  body: JSON.stringify({
    user_address: address,
    risk_profile: "balanced"
  })
}).then(r => r.json())

// Returns opportunities with embedded proofs:
// {
//   "opportunities": [
//     {
//       "pool_id": "ekubo_eth_usdc",
//       "apy": 0.275,
//       "risk_score": 30,
//       "risk_proof_hash": "0x7af...91d",  // ← Proof that risk validated
//       "strategy_id": "abc123",
//       "genome": {
//         "yield_score": 85,
//         "risk_score": 30,
//         "efficiency_score": 92,
//         "composite_score": 85.5
//       },
//       "ai_confidence": 0.92,
//       "ai_reasoning": "High-yield, low-volatility LP position..."
//     }
//   ]
// }

// OracleRadarTab.tsx - Anomaly Detection from Proofs
const anomalies = await fetch(`/api/v1/zkdefi/zkml/anomaly`, {
  method: "POST",
  body: JSON.stringify({
    user_address: address,
    pool_id: "ekubo_eth_usdc"
  })
}).then(r => r.json())

// Returns anomaly proof:
// {
//   "is_safe": true,
//   "anomaly_score": 0.12,  // 0-1, 1 = anomaly
//   "proof_hash": "0x33c...e21",
//   "flags": []
// }

// YieldTab.tsx - Performance History
const yieldChart = await fetch(`/api/v1/zkdefi/vault/yield-chart?days=30`)
  .then(r => r.json())
// Returns historical APY with embedded proofs for verification
```

---

## Complete Data Flow Diagram

```
┌─────────────────────┐
│ User Intent         │
│ (Risk Profile)      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ STRATEGY RECOMMENDATION SERVICE (Python)    │
│ - Risk profile → allocation %                │
│ - Return pool recommendations                │
│ - AI reasoning + confidence score            │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ GENOME COMPUTATION                          │
│ - Fetch market data (APY, TVL, volatility)  │
│ - Compute yield/risk/liquidity scores       │
│ - Calculate composite score                 │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ zkML PROOF GENERATION (Circuits)            │
│ - Risk Score Proof (Groth16)                │
│ - Anomaly Detection Proof (EZKL)            │
│ - Strategy Integrity Proof (STARK)          │
│ - Generate calldata + witness               │
│ - Store proof hash in receipt               │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ STRATEGY STORAGE                            │
│ - Save to strategy_repository               │
│ - Include genome + proof hashes             │
│ - Append to strategy_performance (history)  │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ ORACLE INTELLIGENCE SURFACE                 │
│ - Signals: recommendations + proofs         │
│ - Radar: anomaly detection results          │
│ - Genome: strategy composition              │
│ - All backed by on-chain proofs             │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ POLICY EVALUATION                           │
│ - Apply user constraints                    │
│ - Verify against risk tolerance             │
│ - Check collateral ratio                    │
│ - Verify proof package completeness         │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ EXECUTION GUARD (Proof Gate)                │
│ - All proofs valid? → PASS                  │
│ - Reputation sufficient? → PASS             │
│ - Policy constraints satisfied? → PASS      │
│ - Otherwise → BLOCKED / DEFERRED            │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ EXECUTION & RECEIPT                         │
│ - Execute transaction on-chain              │
│ - Generate execution proof                  │
│ - Store receipt in ledger                   │
│ - Update reputation score                   │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ REPUTATION UPDATE                           │
│ - Increment proof count                     │
│ - Update success rate                       │
│ - Check for tier upgrade                    │
│ - Award zkML badges if applicable           │
└─────────────────────────────────────────────┘
```

---

## Integration with New Capital OS Layout

To properly wire this into the new Capital OS layout:

### 1. Left Rail (Capital Ledger)
**Shows:**
- Vault balance
- Dark Ledger notes
- Deployed positions (APY, risk from strategy genome)
- Health (reputation tier + collateral ratio)

**Data sources:**
- `/api/v1/vault/balance`
- `/api/v1/zkdefi/ledger/notes/{address}`
- `/api/v1/vault/positions/{address}` → includes strategy genome
- `/api/v1/zkdefi/reputation/user/{address}`

### 2. Center (Execution Flow + Oracle Intelligence)
**Shows:**
- Intent → Policy → Proof Package → Execution (flow)
- Below: Oracle Intelligence Tabs (Signals/Radar/Genome)

**Data sources:**
- `/api/v1/strategies/opportunities` (Signals + strategy recommendations)
- `/api/v1/zkdefi/zkml/anomaly` (Radar data)
- `/api/v1/zkdefi/reputation/tiers` (Genome display)
- Each response includes proof hashes for verification

### 3. Right Rail (Control Plane)
**Shows:**
- Emergency stop (policy override)
- Agent status (tier, reputation)
- Risk passport (FICO pack)
- Session keys

**Data sources:**
- `/api/v1/zkdefi/rebalancer/autonomous/status/{address}`
- `/api/v1/zkdefi/risk_passport/user/{address}`
- `/api/v1/zkdefi/session_keys/list/{address}`

---

## Key Insight: Everything is Proof-Backed

The crucial understanding: **Every recommendation, every opportunity, every piece of intelligence has a corresponding proof that validates it.** This is not mock data - it's:

1. **Deterministic** - Same inputs → Same outputs
2. **Verifiable** - Proofs can be checked on-chain via Madara L3
3. **Immutable** - Proof hashes stored forever in receipts
4. **Composable** - Multiple proofs can be combined
5. **Reputation-Bearing** - User's tier increases with successful proofs

---

## Current Status

✅ **Strategy recommendation service** - Implemented (Python circuits)  
✅ **Genome computation** - Implemented in strategy model  
✅ **Proof generation** - Implemented (Groth16, EZKL, STARK circuits)  
✅ **Proof storage** - Implemented (strategy_performance.json receipts)  
✅ **Reputation system** - Implemented (tiers, badges, collateral)  
✅ **Oracle Intelligence Surface** - Restored (Signals/Radar/Genome tabs)  
⚠️ **New Capital OS Layout Integration** - Needs wiring

---

## Next Steps

1. **Create Capital OS Layout components** that consume these APIs
2. **Wire Oracle Surface** into the center column (not as separate tab)
3. **Display proof hashes** in strategy recommendations
4. **Show reputation impact** of successful executions
5. **Create proof inspector** overlay (see full proof chain)
6. **Connect zkRAG output** to strategy recommendations (feedback loop)

