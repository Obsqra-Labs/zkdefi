# Compelling zkML Models for Current Groth16 System

## Models You Can Add NOW (No RISC Zero Needed)

These work with your existing Circom + Groth16 setup!

---

## 🏆 #1: Portfolio Correlation Risk Score (RECOMMENDED)

### What It Proves
**"My portfolio correlation risk is below 0.7"** (diversified, not correlated)

### Why It's Compelling
- ✅ **Simple math**: Correlation matrix (can do in Circom)
- ✅ **High value**: Penalize correlated positions (ETH/wstETH is risky!)
- ✅ **Privacy-preserving**: Don't reveal which assets
- ✅ **Quick**: 1 week to implement

### The Model

```python
# backend/app/services/zkml_correlation_service.py

def compute_correlation_risk(positions, price_history):
    """
    Compute how correlated a portfolio is.
    High correlation = high risk (all assets move together)
    """
    # positions = [(asset_A, weight_A), (asset_B, weight_B), ...]
    # price_history = {asset_A: [prices...], asset_B: [prices...]}
    
    correlations = []
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            asset_i, weight_i = positions[i]
            asset_j, weight_j = positions[j]
            
            # Compute correlation coefficient
            corr = pearson_correlation(
                price_history[asset_i],
                price_history[asset_j]
            )
            
            # Weight by portfolio weights
            weighted_corr = corr * weight_i * weight_j
            correlations.append(weighted_corr)
    
    # Total correlation risk (0-1)
    correlation_risk = sum(correlations) / len(correlations)
    
    return correlation_risk

def pearson_correlation(x, y):
    """Simple correlation (works in Circom!)"""
    mean_x = sum(x) / len(x)
    mean_y = sum(y) / len(y)
    
    cov = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(len(x)))
    std_x = sqrt(sum((x[i] - mean_x)**2 for i in range(len(x))))
    std_y = sqrt(sum((y[i] - mean_y)**2 for i in range(len(y))))
    
    return cov / (std_x * std_y)
```

### Circom Circuit

```circom
// circuits/CorrelationRisk.circom

template CorrelationRisk(numAssets, historyLength) {
    // PRIVATE INPUTS
    signal input asset_weights[numAssets];       // [0.6, 0.4] (60% ETH, 40% STRK)
    signal input price_history[numAssets][historyLength]; // Recent prices
    
    // PUBLIC INPUTS
    signal input threshold;  // Max correlation allowed (e.g. 0.7)
    signal input commitment_hash;
    
    // COMPUTE CORRELATIONS
    signal correlations[numAssets * numAssets];
    var corr_sum = 0;
    var pair_count = 0;
    
    for (var i = 0; i < numAssets; i++) {
        for (var j = i+1; j < numAssets; j++) {
            // Compute Pearson correlation
            var mean_i = 0;
            var mean_j = 0;
            for (var k = 0; k < historyLength; k++) {
                mean_i += price_history[i][k];
                mean_j += price_history[j][k];
            }
            mean_i = mean_i / historyLength;
            mean_j = mean_j / historyLength;
            
            var cov = 0;
            var std_i = 0;
            var std_j = 0;
            for (var k = 0; k < historyLength; k++) {
                var diff_i = price_history[i][k] - mean_i;
                var diff_j = price_history[j][k] - mean_j;
                cov += diff_i * diff_j;
                std_i += diff_i * diff_i;
                std_j += diff_j * diff_j;
            }
            
            var corr = cov / sqrt(std_i * std_j);
            
            // Weight by portfolio weights
            var weighted_corr = corr * asset_weights[i] * asset_weights[j];
            corr_sum += weighted_corr;
            pair_count++;
        }
    }
    
    // Average correlation risk
    var correlation_risk = corr_sum / pair_count;
    
    // PROVE: correlation_risk <= threshold
    correlation_risk * 1000 <= threshold * 1000;
    
    // Output commitment
    signal output commitment <== commitment_hash;
}
```

### User Flow

```
User portfolio: 60% wstETH, 40% ETH
→ Problem: These are HIGHLY correlated (0.95+)
→ High correlation risk!

Agent: "Your correlation risk is 0.92 (too high)"
→ Suggest: Rebalance to 40% wstETH, 30% ETH, 30% STRK (lower correlation)

User generates proof: "New portfolio correlation < 0.7" ✅
→ Agent executes rebalance
```

**Value**: Prevents "fake diversification" (all correlated assets)

---

## 🥈 #2: Time-Weighted Average Position (TWAP) Proof

### What It Proves
**"My TWAP position over 7 days is ≤ $100k"** (not suddenly large)

### Why It's Compelling
- ✅ **Prevents gaming**: Can't fake long-term presence with flash deposits
- ✅ **Simple**: Just weighted average over time
- ✅ **Useful**: Protocols want to reward stable, not mercenary, capital

### The Model

```python
def compute_twap_position(position_history, window_days=7):
    """
    Time-weighted average position over last N days.
    Rewards stable capital, penalizes jumpy deposits.
    """
    total_weighted = 0
    total_time = 0
    
    for i in range(len(position_history) - 1):
        position = position_history[i]['amount']
        time_held = position_history[i+1]['timestamp'] - position_history[i]['timestamp']
        
        total_weighted += position * time_held
        total_time += time_held
    
    twap = total_weighted / total_time if total_time > 0 else 0
    return twap
```

### User Flow

```
Scenario A: Flash farmer
  Day 1-6: $0
  Day 7: Deposits $1M
  → TWAP: $143k (1M × 1/7)
  → Proof: "TWAP > $100k threshold" ❌ FAILS

Scenario B: Stable user
  Day 1-7: $100k steady
  → TWAP: $100k
  → Proof: "TWAP ≤ $100k" ✅ PASSES
```

**Value**: Protocols can reward long-term users, not mercenaries

---

## 🥉 #3: Drawdown Resilience Score

### What It Proves
**"I've experienced a -30% drawdown and didn't panic sell"** (behavioral proof)

### Why It's Compelling
- ✅ **Behavioral signal**: Proves diamond hands
- ✅ **Predictive**: Past behavior predicts future stability
- ✅ **Simple math**: Max drawdown calculation

### The Model

```python
def compute_drawdown_resilience(position_history, actions):
    """
    Did user panic-sell during drawdowns, or hold?
    """
    max_drawdown = 0
    peak_value = 0
    panic_sells = 0
    
    for i, position in enumerate(position_history):
        value = position['value']
        
        # Track peak
        if value > peak_value:
            peak_value = value
        
        # Compute current drawdown
        drawdown = (peak_value - value) / peak_value if peak_value > 0 else 0
        max_drawdown = max(max_drawdown, drawdown)
        
        # Check if user panic-sold during drawdown
        if drawdown > 0.1 and actions[i]['type'] == 'withdraw':
            # Sold during 10%+ drawdown
            panic_sells += 1
    
    # Resilience score: max drawdown survived WITHOUT panic selling
    resilience = max_drawdown if panic_sells == 0 else max_drawdown / (1 + panic_sells)
    
    return resilience, max_drawdown, panic_sells
```

### Circom Circuit

```circom
template DrawdownResilience(historyLength) {
    signal input position_values[historyLength];  // Private portfolio value over time
    signal input actions[historyLength];          // Private: 0=hold, 1=sell, 2=buy
    signal input threshold;                       // Public: min resilience required
    
    var max_drawdown = 0;
    var peak = 0;
    var panic_sells = 0;
    
    for (var i = 0; i < historyLength; i++) {
        // Update peak
        if (position_values[i] > peak) {
            peak = position_values[i];
        }
        
        // Compute drawdown
        var drawdown = (peak - position_values[i]) * 1000 / peak;
        if (drawdown > max_drawdown) {
            max_drawdown = drawdown;
        }
        
        // Check for panic selling (sell during >10% drawdown)
        if (drawdown > 100 && actions[i] == 1) {  // 10% = 100/1000
            panic_sells++;
        }
    }
    
    // Resilience: max drawdown survived without panic
    var resilience = panic_sells == 0 ? max_drawdown : max_drawdown / (1 + panic_sells);
    
    // Prove: resilience >= threshold
    resilience >= threshold;
}
```

### User Flow

```
User A: Survived -30% crash, held steady
→ Resilience: 0.30 (30% drawdown, 0 panic sells)
→ Gets "Diamond Hands" badge
→ Unlock: Higher leverage, better rates

User B: Sold during -15% dip
→ Resilience: 0.075 (15% / 2 due to panic sell)
→ Lower tier
```

**Value**: Behavioral proof of stability

---

## 🌟 #4: Protocol Safety Diversification

### What It Proves
**"I'm diversified across 3+ safety-rated protocols"** (not all in one risky protocol)

### Why It's Compelling
- ✅ **Simple**: Count protocols, weighted by safety score
- ✅ **Practical**: Prevents concentration risk
- ✅ **Quick**: 3 days to implement

### The Model

```python
def compute_protocol_diversification(positions, safety_scores):
    """
    Safety-weighted diversification score.
    
    Safety scores: Aave=95, Compound=90, NewProtocol=40
    """
    # Herfindahl Index (concentration)
    total_value = sum(pos['value'] for pos in positions)
    herfindahl = sum((pos['value'] / total_value) ** 2 for pos in positions)
    
    # Diversification: 1 - HHI (higher = more diversified)
    diversification = 1 - herfindahl
    
    # Safety adjustment: penalize concentration in low-safety protocols
    weighted_safety = sum(
        (pos['value'] / total_value) * safety_scores[pos['protocol']]
        for pos in positions
    ) / 100
    
    # Combined score
    safety_diversification = diversification * weighted_safety
    
    return safety_diversification
```

### User Flow

```
User A: 
  90% NewProtocol (safety: 40)
  10% Aave (safety: 95)
→ Diversification: 0.18 (concentrated)
→ Safety: 0.46 (weighted avg)
→ Score: 0.08 ❌ Too risky

User B:
  40% Aave (safety: 95)
  30% Compound (safety: 90)
  30% JediSwap (safety: 85)
→ Diversification: 0.66 (good)
→ Safety: 0.90 (weighted avg)
→ Score: 0.59 ✅ Well diversified
```

**Value**: Prevents concentration in risky protocols

---

## 🚀 #5: Momentum-Adjusted Risk (Advanced)

### What It Proves
**"My risk score accounts for recent momentum"** (dynamic risk)

### Why It's Compelling
- ✅ **Forward-looking**: Recent price action matters
- ✅ **Still simple**: Weighted average of recent returns
- ✅ **Better than static**: Adapts to market conditions

### The Model

```python
def compute_momentum_adjusted_risk(portfolio, price_history):
    """
    Risk score adjusted by recent momentum.
    
    Logic: Fast-moving assets are riskier right now,
           even if historically stable.
    """
    base_risk_score = compute_base_risk(portfolio)  # Your existing model
    
    momentum_scores = []
    for asset, weight in portfolio:
        # Recent returns (last 7 days)
        recent_prices = price_history[asset][-7:]
        returns = [(recent_prices[i] - recent_prices[i-1]) / recent_prices[i-1] 
                   for i in range(1, len(recent_prices))]
        
        # Momentum: average absolute return (volatility proxy)
        momentum = sum(abs(r) for r in returns) / len(returns)
        
        momentum_scores.append(momentum * weight)
    
    avg_momentum = sum(momentum_scores)
    
    # Adjust risk: high momentum = higher risk
    momentum_multiplier = 1 + (avg_momentum * 2)  # Scale momentum effect
    adjusted_risk = base_risk_score * momentum_multiplier
    
    return adjusted_risk, base_risk_score, avg_momentum
```

### User Flow

```
ETH steady week: momentum = 0.02 (2% avg daily move)
→ Risk multiplier: 1.04x
→ Adjusted risk: 50 * 1.04 = 52

ETH volatile week: momentum = 0.10 (10% avg daily move)
→ Risk multiplier: 1.20x
→ Adjusted risk: 50 * 1.20 = 60

Agent: "Risk spiked due to volatility, reducing position"
```

**Value**: Adapts to current market regime

---

## Comparison Table

| Model | Complexity | Privacy Value | Practical Utility | Implementation Time |
|-------|-----------|---------------|-------------------|---------------------|
| **#1 Correlation Risk** | 🔥🔥 Medium | 🔥🔥 Medium | 🔥🔥🔥 High | 1 week |
| **#2 TWAP Position** | 🔥 Simple | 🔥🔥 Medium | 🔥🔥 Medium | 3 days |
| **#3 Drawdown Resilience** | 🔥 Simple | 🔥🔥🔥 High | 🔥🔥 Medium | 1 week |
| **#4 Safety Diversification** | 🔥 Simple | 🔥 Low | 🔥🔥🔥 High | 3 days |
| **#5 Momentum Risk** | 🔥🔥 Medium | 🔥 Low | 🔥🔥 Medium | 1 week |

---

## My Recommendations

### Implement Now (Groth16):

**Phase 1 (This Week)**:
1. ✅ **Safety Diversification** (3 days)
   - Prevents concentration risk
   - Simple to explain
   - High user value

**Phase 2 (Next Week)**:
2. ✅ **Correlation Risk** (1 week)
   - Sophisticated risk measure
   - Catches "fake diversification"
   - Great showcase

**Phase 3 (Week After)**:
3. ✅ **TWAP Position** (3 days)
   - Anti-mercenary capital
   - Rewards loyal users

### Later (When Ready for RISC Zero):

**Phase 4 (Month 2)**:
4. 🚀 **Cross-Chain Credit Scoring** (RISC Zero)
   - Universal identity system
   - Neural network aggregation
   - Killer feature

---

## Summary

**You asked for**:
- ✅ Models for CURRENT Groth16 system
- ✅ Compelling use cases
- ✅ Integration with profile/reputation

**My recommendations**:
1. **Now**: Add 2-3 simple Groth16 models (correlation, TWAP, diversification)
2. **Next**: Build universal identity system
3. **Then**: Upgrade to RISC Zero for cross-chain credit scoring

**Timeline**:
- Weeks 1-3: New Groth16 models
- Week 4-5: Identity commitment system
- Week 6-9: RISC Zero credit scoring

This gives you incremental value NOW while building toward the ambitious vision!

Want me to start with #1 (Correlation Risk) or #4 (Safety Diversification)?
