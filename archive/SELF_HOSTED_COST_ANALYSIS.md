# Self-Hosted Cost Analysis & AI Orchestrator Architecture

## Cost Breakdown (Self-Hosted Stone Prover)

### You're Right: If Self-Hosting, Many Costs Disappear!

Since you have your own Stone prover at `starknet.obsqra.fi`, here's the **actual** cost model:

```
┌─────────────────────────────────────────────────────────┐
│            COST SOURCES (SELF-HOSTED)                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. ON-CHAIN GAS (Starknet Sepolia/Mainnet)             │
│    • Layer 1 Cairo checks: ~50k gas → $0.01            │
│    • Verify Giza proofs: ~100k gas → $0.02             │
│    • Execute rebalance: ~200k gas → $0.05              │
│    TOTAL: ~$0.08 per rebalance                          │
│                                                         │
│ 2. GIZA PROVING SERVICE (External)                      │
│    • Risk scoring proof: $0.10-$0.50 per proof         │
│    • Anomaly detection proof: $0.10-$0.50 per proof    │
│    TOTAL: ~$0.20-$1.00 per rebalance                    │
│    (Only if using Giza; can be eliminated - see below)  │
│                                                         │
│ 3. STONE PROVER (SELF-HOSTED) ⚡ FREE!                  │
│    • Compute costs only (your hardware)                 │
│    • Electricity: ~$0.01-$0.05 per proof (2-3 min)     │
│    • No external API fees                               │
│    TOTAL: ~$0.01-$0.05 per rebalance                    │
│                                                         │
│ 4. AI ORCHESTRATOR (SELF-HOSTED) ⚡ FREE!               │
│    • Python/Rust backend service                        │
│    • Runs on your server                                │
│    • Negligible compute cost                            │
│    TOTAL: ~$0.00 per rebalance                          │
│                                                         │
└─────────────────────────────────────────────────────────┘

REVISED TOTAL PER REBALANCE:
• With Giza zkML: $0.29-$1.13
• Without Giza (local models): $0.09-$0.13 ✅
```

---

## Where Costs Actually Come From

### 1. On-Chain Gas (Unavoidable)

**What**: Starknet transaction fees

**Why**: Every on-chain operation costs gas:
- Reading oracle prices from Pragma
- Verifying proofs on-chain
- Executing deposits/withdrawals

**Cost**: ~$0.08/rebalance (on mainnet, much cheaper on Sepolia)

**Your responsibility**: Yes (inherent to blockchain)

---

### 2. Giza Proving Service (Optional - Can Be Eliminated!)

**What**: Giza Actions generates zkML proofs for you

**Why**: Giza charges for:
- Converting ONNX → Cairo
- Generating proofs via their prover
- Hosting verifier contracts

**Cost**: $0.10-$0.50/proof (2 proofs per rebalance = $0.20-$1.00)

**Can you avoid this?** ✅ **YES!**

#### Option A: Use Giza (Easiest)
- Pay per proof
- Fully managed
- Fast integration

#### Option B: DIY zkML (Free, More Work)
```python
# Generate proofs locally using your own circuits

# 1. You already have Groth16 circuits (snarkjs)
from app.services.zkml_risk_service import RiskScoreModel

risk_score = RiskScoreModel.compute_risk_score(features)
proof = generate_groth16_proof(circuit='RiskScore', inputs={...})
# Cost: $0 (local snarkjs execution)

# 2. Verify on-chain via Garaga verifier (already deployed)
garaga_verifier.verify_groth16_proof(proof)
# Cost: Gas only (~$0.02)
```

**So if you use your existing Groth16 setup, Giza costs = $0!**

---

### 3. Stone Prover (Self-Hosted - Almost Free)

**What**: Your Stone prover at `starknet.obsqra.fi`

**Why costs are minimal**:
- Compute: CPU/GPU cycles (2-3 min per proof)
- Electricity: ~$0.01-$0.05 per proof
- No external API fees
- You own the hardware

**Cost**: $0.01-$0.05/proof

**This is already included in your infra costs!**

---

### 4. AI Orchestrator (Self-Hosted - Free)

**What**: Backend service that coordinates everything

**Cost**: $0 (runs on your existing backend)

---

## AI Orchestrator: What Is It?

### It's NOT zkML - It's Traditional Code

The AI orchestrator is a **regular backend service** (Python/Rust/WASM) that:

```
┌──────────────────────────────────────────────────┐
│         AI ORCHESTRATOR (Python/Rust)            │
│         Traditional Backend Service              │
├──────────────────────────────────────────────────┤
│                                                  │
│  RESPONSIBILITIES:                               │
│  1. Monitor oracles (Pragma webhooks)            │
│  2. Fetch portfolio state (RPC calls)            │
│  3. Call zkML models (Giza or local Groth16)    │
│  4. Aggregate signals                            │
│  5. Make decision: "Should rebalance?"           │
│  6. Call Stone prover (your API)                 │
│  7. Submit transaction to Starknet               │
│                                                  │
│  LANGUAGE: Python (recommended) or Rust          │
│  DEPLOYMENT: Your backend server                 │
│  ZKML: No - it CALLS zkML, but isn't zkML itself│
│                                                  │
└──────────────────────────────────────────────────┘
```

### Architecture Options

#### Option 1: Python (Recommended)

```python
# backend/app/services/hybrid_risk_orchestrator.py

class HybridRiskOrchestrator:
    """
    Coordinates all risk signals and makes rebalancing decisions.
    
    NOT zkML itself - traditional Python code that orchestrates zkML models.
    """
    
    def __init__(self):
        # Data sources
        self.pragma_monitor = PragmaOracleMonitor()  # Traditional
        self.portfolio_fetcher = PortfolioFetcher()  # Traditional
        
        # zkML models (these ARE zkML)
        self.risk_scorer = RiskScoringModel()  # Groth16 or Giza
        self.anomaly_detector = AnomalyDetectionModel()  # Groth16 or Giza
        
        # Proof generation (self-hosted)
        self.stone_prover = StoneProverClient(url="https://starknet.obsqra.fi")
        
        # Decision logic (traditional ML/rules)
        self.decision_model = DecisionModel()  # Can be ML, but not zkML
    
    async def should_rebalance(self, user_address: str) -> dict:
        """
        Main orchestration logic - NOT zkML, just regular Python.
        """
        # 1. Fetch data (traditional API calls)
        portfolio = await self.portfolio_fetcher.get_portfolio(user_address)
        prices = await self.pragma_monitor.get_latest_prices()
        
        # 2. Generate zkML proofs (THIS is zkML)
        risk_proof = await self.risk_scorer.generate_proof(portfolio)
        anomaly_proof = await self.anomaly_detector.generate_proof(prices)
        
        # 3. Make decision (traditional logic/ML)
        if risk_proof['score'] > 70:
            return {'should_rebalance': False}
        
        if not anomaly_proof['is_safe']:
            return {'should_rebalance': True, 'reason': 'anomaly'}
        
        # Calculate optimal allocation (traditional ML or rules)
        optimal = self._calculate_allocation(portfolio, prices)
        
        # 4. If needed, generate execution proof (STARK via your Stone prover)
        if self._needs_rebalance(portfolio, optimal):
            execution_proof = await self.stone_prover.generate_proof({
                "jediswap_metrics": {...},
                "ekubo_metrics": {...}
            })
            
            return {
                'should_rebalance': True,
                'allocation': optimal,
                'execution_proof': execution_proof,
                'zkml_proofs': [risk_proof, anomaly_proof]
            }
        
        return {'should_rebalance': False}
    
    def _calculate_allocation(self, portfolio, prices):
        """
        Traditional ML or rule-based logic - NOT zkML.
        
        Could be:
        - Simple rules (if risk < 30: aggressive)
        - Scikit-learn model (mean-variance optimization)
        - Reinforcement learning agent
        
        NO zkML needed - this doesn't need to be proven on-chain.
        """
        if portfolio['risk_score'] < 30:
            return {'jedi': 0.6, 'ekubo': 0.4}
        else:
            return {'jedi': 0.4, 'ekubo': 0.6}
```

**Why Python?**
- ✅ Easy integration with FastAPI backend
- ✅ Rich ML libraries (scikit-learn, pandas)
- ✅ Quick iteration
- ✅ Already your backend language

---

#### Option 2: Rust (More Performant)

```rust
// backend/src/services/orchestrator.rs

pub struct HybridRiskOrchestrator {
    pragma_monitor: PragmaMonitor,
    risk_scorer: RiskScoringClient,  // Calls zkML models
    stone_prover: StoneProverClient,
}

impl HybridRiskOrchestrator {
    pub async fn should_rebalance(&self, user: &str) -> RebalanceDecision {
        // 1. Fetch data
        let portfolio = self.fetch_portfolio(user).await?;
        let prices = self.pragma_monitor.get_prices().await?;
        
        // 2. Call zkML models (Groth16 or Giza)
        let risk_proof = self.risk_scorer.generate_proof(&portfolio).await?;
        
        // 3. Make decision (traditional logic)
        if risk_proof.score > 70 {
            return RebalanceDecision::Skip;
        }
        
        // 4. Generate STARK proof (your Stone prover)
        let execution_proof = self.stone_prover.prove(...).await?;
        
        RebalanceDecision::Execute {
            allocation: self.calculate_optimal(&portfolio, &prices),
            proof: execution_proof,
        }
    }
    
    fn calculate_optimal(&self, portfolio: &Portfolio, prices: &Prices) -> Allocation {
        // Traditional optimization logic - NOT zkML
        // ...
    }
}
```

**Why Rust?**
- ✅ Better performance (if orchestrating 1000+ users)
- ✅ Type safety
- ✅ Lower memory footprint
- ⚠️ More complex to integrate with Python backend

---

#### Option 3: WASM (Browser Execution)

```typescript
// frontend/src/services/orchestrator.wasm.ts

import init, { HybridOrchestrator } from './orchestrator_wasm';

async function runOrchestrator(userAddress: string) {
    await init();
    
    const orchestrator = new HybridOrchestrator();
    
    // Fetch data client-side
    const portfolio = await fetchPortfolio(userAddress);
    const prices = await fetchOraclePrices();
    
    // Call zkML models (still via API)
    const riskProof = await generateRiskProof(portfolio);
    
    // Make decision in browser (WASM)
    const decision = orchestrator.decide(portfolio, prices, riskProof);
    
    if (decision.shouldRebalance) {
        // Generate STARK proof (still server-side)
        const proof = await fetchExecutionProof(decision.allocation);
        await executeRebalance(proof);
    }
}
```

**Why WASM?**
- ✅ No server needed (runs in browser)
- ✅ User privacy (local computation)
- ⚠️ Limited for proof generation (still need server for STARK)
- ⚠️ Complex setup

---

## What IS zkML vs What ISN'T

```
┌─────────────────────────────────────────────────────────┐
│                    zkML COMPONENTS                      │
│              (Need to be proven on-chain)               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. RISK SCORING MODEL                                  │
│     • ML inference: features → risk_score               │
│     • Groth16 proof: "score ≤ threshold"                │
│     • On-chain verifier checks proof                    │
│     → zkML ✅                                            │
│                                                         │
│  2. ANOMALY DETECTION MODEL                             │
│     • ML inference: pool_metrics → is_safe              │
│     • Groth16 proof: "anomaly_flag = 0"                 │
│     • On-chain verifier checks proof                    │
│     → zkML ✅                                            │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│               NOT zkML (Traditional Code)               │
│              (Doesn't need to be proven)                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. AI ORCHESTRATOR                                     │
│     • Fetches data from APIs                            │
│     • Calls zkML models                                 │
│     • Aggregates results                                │
│     • Makes final decision                              │
│     → Traditional Python/Rust ✅                         │
│                                                         │
│  2. ALLOCATION OPTIMIZER                                │
│     • Calculates optimal portfolio allocation           │
│     • Can use ML (scikit-learn, RL)                     │
│     • But doesn't need to be proven                     │
│     → Traditional ML ✅                                  │
│                                                         │
│  3. ORACLE MONITORING                                   │
│     • Listens to Pragma webhooks                        │
│     • Fetches price data                                │
│     → Traditional API client ✅                          │
│                                                         │
│  4. STONE PROVER CLIENT                                 │
│     • Calls your Stone prover API                       │
│     • Submits proofs to Integrity                       │
│     → Traditional API client ✅                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Revised Cost Model (Self-Hosted)

### Scenario 1: Full DIY (Cheapest)

```
Components:
• Layer 1: Cairo on-chain checks ($0.01)
• Layer 2: Local Groth16 proofs ($0.02 gas)
• Layer 3: Your Stone prover ($0.01 electricity)
• Orchestrator: Python on your server ($0.00)

TOTAL: $0.04 per rebalance
```

**100 users, 1 rebalance/week = 400/mo → $16/mo**

### Scenario 2: With Giza zkML (Easier, More Expensive)

```
Components:
• Layer 1: Cairo on-chain checks ($0.01)
• Layer 2: Giza proofs ($0.50)
• Layer 3: Your Stone prover ($0.01)
• Orchestrator: Python on your server ($0.00)

TOTAL: $0.52 per rebalance
```

**100 users, 1 rebalance/week = 400/mo → $208/mo**

---

## My Recommendation: DIY zkML

**Since you already have**:
1. ✅ Stone prover (self-hosted)
2. ✅ Groth16 circuits (snarkjs)
3. ✅ Garaga verifier (deployed)

**You DON'T need Giza!**

Keep using your existing setup:
- Risk scoring: Your `zkml_risk_service.py` + snarkjs
- Anomaly detection: Your `zkml_anomaly_service.py` + snarkjs
- Execution proofs: Your Stone prover at `starknet.obsqra.fi`

**Cost**: ~$0.04/rebalance instead of $0.52

---

## AI Orchestrator: Implementation

### Recommended Stack

```
┌────────────────────────────────────────┐
│   AI Orchestrator (Python)             │
│   Location: Your FastAPI backend       │
├────────────────────────────────────────┤
│                                        │
│  Files:                                │
│  • orchestrator.py (main logic)        │
│  • pragma_monitor.py (oracle feeds)    │
│  • decision_engine.py (ML/rules)       │
│  • stone_client.py (proof generation)  │
│                                        │
│  Dependencies:                         │
│  • httpx (API calls)                   │
│  • starknet-py (RPC)                   │
│  • pandas (data processing)            │
│  • scikit-learn (optional ML)          │
│                                        │
│  Deployment:                           │
│  • Same server as backend              │
│  • Runs as background task             │
│  • Triggered by webhooks/cron          │
│                                        │
└────────────────────────────────────────┘
```

Want me to implement this? I can:
1. Build the Python orchestrator (uses your existing infra)
2. Set up Pragma webhook integration
3. Wire everything together

No Giza needed - all self-hosted, ~$0.04/rebalance!
