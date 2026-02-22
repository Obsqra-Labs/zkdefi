# Risk Profile Architecture: User-Driven Allocation

**Date:** February 16, 2026  
**Status:** Ready to Implement

---

## Overview

Instead of predefined allocations, users define their risk tolerance on deposit. The system then:
1. **Analyzes available pools** with zkML circuit
2. **Recommends allocation** via LLM logic
3. **User confirms or adjusts** before deployment
4. **Executes autonomously** with full audit trail

---

## Risk Profile Selection

### User Interface Flow
```
User clicks "Deposit"
    ↓
Enter amount: [input] STRK
    ↓
Select Risk Profile:
  ○ Conservative (Low Risk, 3-8% APY)
  ○ Balanced (Moderate Risk, 10-18% APY)
  ○ Aggressive (High Risk, 20-50% APY)
    ↓
[Optional] Exclude certain protocols
    ↓
"Analyzing pools for your profile..."
    ↓
[Show AI recommendation with reasoning]
    ↓
[Confirm] or [Adjust Manually]
    ↓
Execute Deployment
```

### Risk Profile Definitions

#### Conservative (0-35 Risk Score)
```
User Intent: Maximize safety, accept lower returns
Characteristics:
- Risk tolerance: Low
- Volatility preference: Prefer stable pairs
- Liquidity requirement: High (> $1M)
- Slippage tolerance: < 0.5%
- Preferred yield source: Lending (Vesu), stable LPs

Target Allocation:
- 70% Vesu (or similar lending protocol)
- 20% Ekubo stable-pair LP (USDC/DAI)
- 10% Cash buffer

Expected APY: 4-8%
Risk Metrics:
- Max daily volatility: 2%
- Max drawdown acceptable: 5%
- Liquidity requirement: High
```

#### Balanced (35-65 Risk Score)
```
User Intent: Balance risk and reward
Characteristics:
- Risk tolerance: Moderate
- Volatility preference: Mixed
- Liquidity requirement: Medium (> $50K)
- Slippage tolerance: 1-2%
- Preferred yield source: Mix of LP + lending

Target Allocation:
- 50% Ekubo ETH/USDC or STRK/USDC LP (medium range)
- 40% Vesu yield
- 10% Concentrated LP (if feeling lucky)

Expected APY: 10-18%
Risk Metrics:
- Max daily volatility: 5%
- Max drawdown acceptable: 15%
- Liquidity requirement: Medium
```

#### Aggressive (65-100 Risk Score)
```
User Intent: Maximize returns, accept volatility
Characteristics:
- Risk tolerance: High
- Volatility preference: High-volatility pairs
- Liquidity requirement: Low
- Slippage tolerance: 3%+
- Preferred yield source: Concentrated LP, high-fee pools

Target Allocation:
- 70% Ekubo tight-range LP (STRK/ETH 1% fee)
- 20% Ekubo concentrated swaps
- 10% Vesu safety net

Expected APY: 25-50%
Risk Metrics:
- Max daily volatility: 10%+
- Max drawdown acceptable: 30%
- Liquidity requirement: Low
```

---

## Pool Evaluation Criteria

### Data Points Per Pool

```javascript
PoolAnalysis = {
  // Identity
  pool_id: "ekubo_strk_eth_0.3",
  protocol: "Ekubo",
  token_pair: ["STRK", "ETH"],
  fee_tier: 0.003,
  
  // Liquidity Metrics
  total_liquidity_usd: 250000,
  volume_24h: 50000,
  volume_7d: 350000,
  concentration_ratio: 0.65,  // How concentrated is liquidity?
  
  // Volatility Metrics
  volatility_24h: 0.08,      // 8% price volatility
  volatility_7d: 0.12,
  volatility_30d: 0.15,
  max_slippage_1pct: 0.005,  // 0.5% slippage for 1% of pool volume
  max_slippage_5pct: 0.025,  // 2.5% slippage for 5%
  
  // Yield Metrics
  fee_apy_24h: 45.0,         // Annual fee collection at current volume
  fee_apy_7d: 42.0,
  fee_apy_30d: 38.0,
  impermanent_loss_risk: 0.12, // Est IL at current volatility
  
  // Risk Flags
  flags: [
    { severity: "info", message: "Moderate volatility" },
    { severity: "warning", message: "Concentrated liquidity above pool" },
    { severity: "ok", message: "Sufficient for $1000 deposit" }
  ]
}
```

### Risk Scoring Algorithm

```python
def calculate_pool_risk_score(pool: PoolAnalysis) -> float:
    """
    Returns 0-100 score where:
    - 0-35: Conservative suitable
    - 35-65: Balanced suitable
    - 65-100: Aggressive suitable
    """
    
    score = 0.0
    
    # Liquidity score (0-20 points)
    if pool.total_liquidity_usd < 50_000:
        score += 15  # Risky
    elif pool.total_liquidity_usd < 200_000:
        score += 8   # Caution
    elif pool.total_liquidity_usd < 1_000_000:
        score += 3   # Acceptable
    else:
        score += 0   # Good
    
    # Volume score (0-20 points)
    volume_ratio = pool.volume_24h / pool.total_liquidity_usd
    if volume_ratio < 0.1:
        score += 15  # Low volume = risky
    elif volume_ratio < 0.3:
        score += 8
    elif volume_ratio < 0.8:
        score += 3
    else:
        score += 0
    
    # Volatility score (0-30 points)
    if pool.volatility_24h > 0.2:
        score += 25  # Very volatile
    elif pool.volatility_24h > 0.12:
        score += 15  # Somewhat volatile
    elif pool.volatility_24h > 0.05:
        score += 8   # Moderate
    else:
        score += 0   # Stable
    
    # Slippage score (0-20 points)
    slippage_1pct = pool.max_slippage_1pct
    if slippage_1pct > 0.05:
        score += 15  # High slippage
    elif slippage_1pct > 0.02:
        score += 8
    elif slippage_1pct > 0.005:
        score += 3
    else:
        score += 0
    
    # IL Risk score (0-10 points)
    if pool.impermanent_loss_risk > 0.2:
        score += 8   # High IL
    elif pool.impermanent_loss_risk > 0.1:
        score += 4
    else:
        score += 0
    
    return min(100, score)
```

### Flag Generation

```python
def generate_pool_flags(pool: PoolAnalysis, user_risk_profile: str) -> List[Flag]:
    """Generate user-specific warnings and recommendations"""
    
    flags = []
    
    # Liquidity warnings
    if pool.total_liquidity_usd < 50_000:
        flags.append({
            "severity": "critical",
            "category": "liquidity",
            "message": "Pool has very low liquidity - high risk of slippage"
        })
    
    # Volatility warnings
    if pool.volatility_24h > 0.20:
        flags.append({
            "severity": "warning",
            "category": "volatility",
            "message": f"High volatility (20%+) - price can swing significantly"
        })
    
    # Profile mismatch warnings
    risk_score = calculate_pool_risk_score(pool)
    if user_risk_profile == "Conservative" and risk_score > 50:
        flags.append({
            "severity": "warning",
            "category": "profile_mismatch",
            "message": "Pool risk score (58/100) exceeds your conservative preference"
        })
    
    # Concentration warnings
    if pool.concentration_ratio > 0.8:
        flags.append({
            "severity": "info",
            "category": "concentration",
            "message": "80% of liquidity concentrated - may face higher IL"
        })
    
    # Positive assessments
    if pool.liquidity_usd > 500_000 and pool.volatility_24h < 0.1:
        flags.append({
            "severity": "ok",
            "category": "quality",
            "message": "Good liquidity and stable - suitable for conservative users"
        })
    
    return flags
```

---

## Implementation Checklist: Risk Profiles (Week 1)

### Frontend (React)
```
- [ ] Component: RiskProfileSelector
  - [ ] Three profile cards (Conservative/Balanced/Aggressive)
  - [ ] Display risk score, expected APY, characteristics
  - [ ] Selection validation
  
- [ ] Component: PoolAnalysisDisplay
  - [ ] Show pool evaluation results
  - [ ] Display risk score with visualization
  - [ ] Show flags with severity colors
  - [ ] Display recommended allocation %
  
- [ ] Component: AllocationConfirmation
  - [ ] Show finalized allocation (edited if user changed)
  - [ ] Confirm before deployment
  - [ ] Show expected yield range
  - [ ] Show risk assessment
```

### Backend (Python)

```
- [ ] Endpoint: POST /profiles/analyze
  Input: {
    user_address,
    risk_profile: "conservative|balanced|aggressive",
    amount: uint256,
    deposit_token: "STRK"
  }
  Output: {
    pools_analyzed: [
      {
        pool_id,
        risk_score,
        recommended_allocation_percent,
        expected_apy_range,
        flags: [...]
      }
    ],
    llm_recommendation: {
      suggested_allocation: {...},
      reasoning: "...",
      confidence: 0.92
    },
    audit_entry_id
  }

- [ ] Service: pool_analysis_service.py
  - [ ] Fetch pool data from Ekubo/JediSwap APIs
  - [ ] Calculate risk scores
  - [ ] Generate flags
  
- [ ] Service: llm_decision_engine.py
  - [ ] Call ChatGPT-mini with pool analysis
  - [ ] Parse recommendation
  - [ ] Return allocation %s
```

### Smart Contracts (Cairo)

```
- [ ] Update VaultManager
  - [ ] Add risk_profile field to DepositRecord
  - [ ] Store user_selected_allocation
  - [ ] Validate allocation matches risk profile (on-chain)
  
- [ ] Update AuditTrail
  - [ ] Record risk_profile selected
  - [ ] Record pool_analysis_results
  - [ ] Record llm_recommendation
  - [ ] Record user_final_confirmation
```

---

## Integration Points

### Risk Profile → Pool Analysis → LLM → Execution

```
┌─────────────────────────────────────────────────────────┐
│ User Selects Risk Profile                               │
│ Input: Conservative                                     │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Backend: Fetch & Analyze Available Pools                │
│ - Query Ekubo STRK/USDC, ETH/USDC, STRK/ETH           │
│ - Query JediSwap STRK/USDC, ETH/USDC                  │
│ - Query Vesu lending rates                             │
│ - Calculate risk scores                                │
│ - Generate flags                                       │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ LLM Decision Engine (ChatGPT-mini)                     │
│ Input: Risk profile + pool analysis                     │
│ Output: Recommended allocation:                         │
│   - 70% Vesu STRK lending                             │
│   - 20% Ekubo ETH/USDC LP                             │
│   - 10% Cash buffer                                    │
│ Reasoning: "Vesu is safest, ETH/USDC is stable pair"  │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Frontend: Show Recommendation & Confirmation            │
│ - Display allocation breakdown                          │
│ - Show expected yield for each component               │
│ - Allow manual adjustment                              │
│ - Confirm before execution                             │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ On-Chain Execution                                      │
│ - VaultManager routes capital to strategies            │
│ - EkuboStrategy creates LP position (20%)              │
│ - VersuStrategy deposits for yield (70%)               │
│ - AuditTrail records all decisions & proofs           │
└─────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. Implement RiskProfileSelector component (1 day)
2. Create pool_analysis_service backend (1 day)
3. Integrate LLM decision engine (0.5 days)
4. Wire frontend to backend (1 day)
5. Deploy and test end-to-end (1 day)

Ready to implement? 🚀
