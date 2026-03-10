# Circuit Strategies Reference

**What they are:** ZK circuits that wrap or validate strategy behavior. Each circuit is a Circom program compiled to Groth16 (wasm + zkey); the backend runs them via `circuit_scanner` and exposes them as **agent skills** so the LLM (or the stream) can request a proof before treating an opportunity as recommended.

**Where they live:** `circuits/` (Circom source + build artifacts in `circuits/build/`). Backend wiring: `app/services/zkml/circuit_scanner.py` (registry + proof generation), `app/services/agent_skill_service.py` (skill definitions + execution).

---

## Strategy / allocation circuits

| Circuit | Purpose | Wraps / validates |
|--------|---------|-------------------|
| **StrategyIntegrity** | Proves position weights, leverage, and slippage stay within policy bounds. | Any multi-pool allocation; concentration and max leverage limits. |
| **YieldOptimality** | Proves current allocation is within a threshold of optimal yield (no need to reveal exact allocation). | Allocation strategy vs predicted yields. |
| **ImpermanentLossPredictor** | Proves IL on an LP position is within tolerance vs fees earned. | LP strategy entry/exit. |
| **SlippageBound** | Proves trade slippage will not exceed limit given pool liquidity. | Swap execution. |

These are the ones that **wrap the strategy in a runtime**: you don’t just “assume” an opportunity is good; you run the circuit on the same inputs the strategy would use (allocations, pool IDs, risk scores) and only surface it as “recommended” or “proved” when the proof succeeds.

---

## Execution / safety circuits

| Circuit | Purpose |
|--------|---------|
| **ExecutionIntegrity** | Proves execution met delay and price-deviation bounds (no sandwich / frontrun). |
| **MEVResistanceProof** | Proves the tx was not subject to material MEV extraction. |
| **LiquidationRisk** | Proves no leveraged position is at liquidation threshold. |
| **CrossProtocolArbitrage** | Proves arbitrage is profitable after fees across two venues. |

---

## Identity / reputation circuits

| Circuit | Purpose |
|--------|---------|
| **AgentReputationScore** | Proves agent reputation ≥ threshold without revealing metrics. |
| **HistoricalPerformanceAttestation** | Proves mean return and drawdown bounds over a period. |
| **TraderPerformanceProof** | Proves Sharpe, max drawdown, win-rate thresholds over 30 periods. |
| **SolvencyProof** | Proves assets ≥ liabilities by a minimum ratio. |
| **RiskPassportTier** | Maps volatility, drawdown, concentration, leverage, tenure into a 1–5 tier and proves compliance. |

---

## ML / scoring circuits

| Circuit | Purpose |
|--------|---------|
| **RiskScore** | Portfolio risk score below threshold (8-feature vector). |
| **AnomalyDetector** | Pool anomaly across TVL volatility, concentration, price impact. |
| **CorrelationRisk** | Correlation-based risk. |
| **SafetyDiversification** | Diversification constraints. |

---

## How they’re used today

- **Skills API:** `GET /api/v1/zkdefi/skills/` lists all skills; `POST /api/v1/zkdefi/skills/{skill_id}/run` runs one (builds inputs, runs Groth16, returns proof_hash + compliance).
- **Stream (async proof badges):** For top/trending opportunities, the frontend calls `POST /api/v1/zkdefi/skills/screen/opportunity` with `pool_id`, `apy_bps`, `risk_level`. Backend runs **YieldOptimality** and **StrategyIntegrity**; stream card shows “proving” → “proved” or “flagged” and optional proof hashes in the expanded view.
- **Circuit Board (policy):** Policy is stored per-address; circuits like StrategyIntegrity read max position weight, max leverage, max slippage from that policy.

So: **circuit strategies** = StrategyIntegrity + YieldOptimality (and optionally IL/Slippage) wrapping the strategy in a proof runtime; **other circuits** = execution safety, reputation, and ML scoring, all exposed as skills and usable by the agent or the stream when you want a proof instead of an assumption.
