# Phase 1B: Connect zkML Intelligence to Opportunities — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Date:** 2026-03-05  
**Status:** Draft  
**Goal:** Replace basic TVL/confidence scoring in `/opportunities` with real zkML circuit intelligence (IL prediction, yield optimality, slippage bounds, risk evaluation, proof hashes).

---

## Current State Problems

The `/opportunities` endpoint (line 1666 in `backend/app/api/routes/strategies.py`) currently:
- ❌ Uses simple heuristic: `risk = 20 if conf == "high" else 40 if conf == "medium" else 60`
- ❌ Adds arbitrary +15 risk points for TVL < $10k
- ❌ No zkML circuit integration
- ❌ No proof hashes or verification claims
- ❌ Ranking by basic `apy * (1.0 - risk/200)` score

We HAVE the intelligence layer:
- ✅ `signal_pass_service.compute_signals()` — runs IL/yield/slippage/liquidation/correlation circuits
- ✅ `PoolRiskEvaluator` — deterministic 0-100 risk scoring with liquidity/volatility/volume/slippage factors
- ✅ `SignalReport` — typed circuit outputs with proof hashes
- ✅ `receipt_service` — records proofs for auditability

But they're only used in `/allocate` and `/execute-allocation`, not `/opportunities`.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  POST /api/v1/strategies/opportunities          │
│  ┌──────────────────────────────────────────┐   │
│  │ 1. Fetch market_surface (Ekubo pools)   │   │
│  └──────────────┬───────────────────────────┘   │
│                 ▼                                │
│  ┌──────────────────────────────────────────┐   │
│  │ 2. Run PoolRiskEvaluator on each pool   │   │
│  │    (liquidity/volatility/volume/slippage)│   │
│  └──────────────┬───────────────────────────┘   │
│                 ▼                                │
│  ┌──────────────────────────────────────────┐   │
│  │ 3. Run compute_signals (zkML circuits)  │   │
│  │    - ImpermanentLossPredictor            │   │
│  │    - YieldOptimality                     │   │
│  │    - SlippageBound                       │   │
│  │    - (Skip Liquidation/Correlation)      │   │
│  └──────────────┬───────────────────────────┘   │
│                 ▼                                │
│  ┌──────────────────────────────────────────┐   │
│  │ 4. Merge into enhanced opportunity row  │   │
│  │    + risk_score (0-100 from evaluator)   │   │
│  │    + zkml_signals (IL/yield/slippage)    │   │
│  │    + proof_hash (from SignalReport)      │   │
│  │    + confidence (from circuit gates)     │   │
│  │    + flags (from evaluator + circuits)   │   │
│  └──────────────┬───────────────────────────┘   │
│                 ▼                                │
│  ┌──────────────────────────────────────────┐   │
│  │ 5. Rank by zkML-informed score          │   │
│  │    score = apy * signal_quality *        │   │
│  │            (1 - risk_score/200)          │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Key principle:** Existing `/opportunities` response schema stays compatible; we add optional zkML fields that frontends can progressively enhance.

---

## Task 1: Extend OpportunityRow with zkML fields

**Files:**
- Modify: `backend/app/api/routes/strategies.py`

**Step 1: Add zkML-enhanced fields to response models**

After line 1646 (`class OpportunityRow(BaseModel)`), add optional zkML fields:

```python
class OpportunityRow(BaseModel):
    pair: str
    best_venue: str
    estimated_apy_pct: float
    risk_score: float
    confidence: str
    tvl_usd: float
    volume_24h_usd: float
    spread_bps: int = 0
    flags: List[str] = []
    data_source: str = "live"
    
    # ── zkML enhancement fields (Phase 1B) ──
    zkml_risk_score: Optional[int] = None          # 0-100 from PoolRiskEvaluator
    zkml_confidence: Optional[float] = None        # 0-1 from circuit gates
    zkml_signals: Optional[Dict[str, Any]] = None  # {il_acceptable, yield_optimal, slippage_ok, gates_passed}
    zkml_proof_hash: Optional[str] = None          # Receipt proof hash
    zkml_flags: Optional[List[str]] = []           # Additional flags from evaluator
```

**Step 2: Verify**

```bash
cd backend && python3 -c "from app.api.routes.strategies import OpportunityRow; print(OpportunityRow.__fields__.keys())"
```

Should show new zkML fields.

**Step 3: Commit**

```bash
git add backend/app/api/routes/strategies.py
git commit -m "feat(opportunities): add zkML enhancement fields to OpportunityRow

- zkml_risk_score: 0-100 from PoolRiskEvaluator
- zkml_signals: IL/yield/slippage circuit outputs
- zkml_proof_hash: receipt hash for verification
- zkml_confidence: circuit gate pass rate
- Backward compatible: all fields Optional"
```

---

## Task 2: Wire PoolRiskEvaluator into /opportunities

**Files:**
- Modify: `backend/app/api/routes/strategies.py` (line 1666+, `/opportunities` endpoint)

**Step 1: Import evaluator and build PoolMetrics**

At top of file (after existing imports):

```python
from app.services.zkml.pool_evaluator import PoolRiskEvaluator, PoolMetrics
from datetime import datetime as _dt
```

**Step 2: Initialize evaluator in endpoint**

Inside `/opportunities` endpoint (after line 1683, before scoring loop):

```python
evaluator = PoolRiskEvaluator()
evaluations: dict[str, Any] = {}  # pool_id -> evaluation result
```

**Step 3: Run evaluator on each pool**

Replace the simple scoring loop (lines 1704-1742) with:

```python
scored: list[dict] = []
for opp in opps:
    conf = opp.get("confidence", "low")
    conf_val = confidence_levels.get(conf, 0)
    if conf_val < min_conf_val:
        continue

    tvl = float(opp.get("tvl_usd", 0))
    if tvl < req.min_tvl_usd:
        continue

    # ── Phase 1B: Run PoolRiskEvaluator ──
    try:
        metrics = PoolMetrics(
            pool_id=opp.get("pair", "unknown"),
            name=opp.get("pair", ""),
            protocol=opp.get("best_venue", "ekubo"),
            liquidity_usd=tvl,
            volume_24h_usd=float(opp.get("volume_24h_usd", 0)),
            fee_tier=float(opp.get("spread_bps", 0)) / 10000.0,  # bps -> decimal
            price_std_dev_24h=abs(float(opp.get("change_24h_pct", 0)) / 100.0),  # use 24h change as proxy
            slippage_at_1000usd=0.01,  # default 1% if not in surface
            token0=opp.get("token0", ""),
            token1=opp.get("token1", ""),
            current_apy=float(opp.get("estimated_apy_pct", 0)),
            timestamp=_dt.utcnow(),
        )
        evaluation = evaluator.evaluate_pool(metrics)
        evaluations[opp.get("pair", "")] = evaluation
        risk = evaluation.risk_score
        zkml_flags = evaluation.flags
    except Exception as exc:
        logger.warning("evaluator failed for %s: %s", opp.get("pair"), exc)
        # Fallback to simple scoring
        risk = 20 if conf == "high" else (40 if conf == "medium" else 60)
        if tvl < 10_000:
            risk += 15
        elif tvl < 50_000:
            risk += 5
        zkml_flags = []

    if risk > max_risk:
        continue

    # Compute opportunity score for ranking
    apy = float(opp.get("estimated_apy_pct", 0))
    opp_score = apy * (1.0 - risk / 200.0)

    flags: list[str] = []
    if conf == "low":
        flags.append("low_confidence")
    if opp.get("stale"):
        flags.append("stale_data")
    if tvl < 25_000:
        flags.append("low_tvl")

    scored.append({
        **opp,
        "risk_score": risk,
        "flags": flags,
        "zkml_risk_score": risk if opp.get("pair") in evaluations else None,
        "zkml_flags": zkml_flags,
        "data_source": data_source,
        "_score": opp_score,
    })
```

**Step 4: Verify**

```bash
cd backend
curl -X POST http://localhost:8003/api/v1/strategies/opportunities \
  -H "Content-Type: application/json" \
  -d '{"risk_profile":"BALANCED","limit":3}' | python3 -m json.tool | grep zkml
```

Should see `zkml_risk_score` and `zkml_flags` in response.

**Step 5: Commit**

```bash
git add backend/app/api/routes/strategies.py
git commit -m "feat(opportunities): integrate PoolRiskEvaluator for zkML risk scoring

- Replace simple TVL heuristic with 5-factor evaluator
- Score liquidity, volatility, volume ratio, slippage, fee tier
- Surface zkml_risk_score (0-100) and zkml_flags
- Graceful fallback to heuristic on evaluator errors
- Risk filtering still uses max_risk from profile"
```

---

## Task 3: Run zkML circuits (compute_signals) for top opportunities

**Files:**
- Modify: `backend/app/api/routes/strategies.py`

**Step 1: Import signal_pass_service**

At top of file:

```python
from app.services.signal_pass_service import compute_signals
```

**Step 2: Run circuits on top N pools (after initial scoring)**

After `scored.sort(...)` (around line 1744), before final results loop:

```python
# ── Phase 1B: Run zkML circuits on top 10 candidates ──
top_candidates = scored[:10]  # Run circuits on top 10 only (expensive)
circuit_reports: dict[str, Any] = {}

if top_candidates:
    try:
        # Build candidate pool list for signal_pass
        candidate_pools = []
        for opp in top_candidates:
            candidate_pools.append({
                "pool_id": opp.get("pair", ""),
                "pair": opp.get("pair", ""),
                "token0": opp.get("token0", ""),
                "token1": opp.get("token1", ""),
                "apy_pct": opp.get("estimated_apy_pct", 0),
                "tvl_usd": opp.get("tvl_usd", 0),
                "liquidity_usd": opp.get("tvl_usd", 0),  # use TVL as liquidity proxy
            })
        
        # Run circuits (IL, Yield, Slippage only; skip Liquidation/Correlation for opportunities)
        amount_wei = int(10_000 * 1e18)  # Simulate $10k deployment for circuit inputs
        signals = await compute_signals(
            candidate_pools,
            amount_wei=amount_wei,
            token_decimals=18,
            circuits=["il", "yield", "slippage"],  # Skip liquidation/correlation
        )
        
        # Index by pool_id
        for pool_id, report in signals.items():
            circuit_reports[pool_id] = {
                "il_acceptable": report.il_acceptable,
                "yield_near_optimal": report.yield_near_optimal,
                "slippage_ok": report.slippage_ok,
                "gates_passed": report.gates_passed,
                "gates_total": report.gates_total,
                "proof_hash": report.receipt_id if hasattr(report, "receipt_id") else None,
            }
            
    except Exception as exc:
        logger.warning("compute_signals failed: %s", exc)
        # Continue without circuit data
```

**Step 3: Merge circuit data into final results**

In the final results loop (line 1747+):

```python
results = []
for s in scored[: req.limit]:
    s.pop("_score", None)
    
    # Merge zkML circuit signals if available
    pool_id = s.get("pair", "")
    if pool_id in circuit_reports:
        report = circuit_reports[pool_id]
        s["zkml_signals"] = report
        s["zkml_proof_hash"] = report.get("proof_hash")
        s["zkml_confidence"] = report["gates_passed"] / report["gates_total"] if report["gates_total"] > 0 else None
        
        # Adjust opportunity score based on circuit pass rate
        if report["gates_passed"] < report["gates_total"]:
            # Penalty for failed gates
            penalty = (report["gates_total"] - report["gates_passed"]) * 0.1
            if not s.get("flags"):
                s["flags"] = []
            s["flags"].append(f"circuit_warnings_{report['gates_passed']}/{report['gates_total']}")
    
    results.append(s)
```

**Step 4: Verify**

```bash
curl -X POST http://localhost:8003/api/v1/strategies/opportunities \
  -H "Content-Type: application/json" \
  -d '{"risk_profile":"BALANCED","limit":3}' | python3 -m json.tool | jq '.opportunities[0].zkml_signals'
```

Should see IL/yield/slippage circuit outputs.

**Step 5: Commit**

```bash
git add backend/app/api/routes/strategies.py
git commit -m "feat(opportunities): integrate zkML circuits for top candidates

- Run compute_signals on top 10 opportunities
- Include IL prediction, yield optimality, slippage bounds
- Surface proof hashes and gate pass rates
- Add circuit warning flags when gates fail
- Circuits only run on top candidates (performance)
- Graceful degradation if circuits timeout/fail"
```

---

## Task 4: Update frontend Oracle to display zkML intelligence

**Files:**
- Modify: `frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx`
- Modify: `frontend/src/components/zkdefi/oracle/types.ts` (if exists, else create)

**Step 1: Extend OracleOpportunity type**

Create or modify `frontend/src/components/zkdefi/oracle/types.ts`:

```typescript
export interface OracleOpportunity {
  pair: string;
  best_venue: string;
  estimated_apy_pct: number;
  risk_score: number;
  confidence: string;
  tvl_usd: number;
  volume_24h_usd: number;
  spread_bps?: number;
  flags?: string[];
  data_source?: string;
  
  // Phase 1B: zkML enhancement
  zkml_risk_score?: number;
  zkml_confidence?: number;
  zkml_signals?: {
    il_acceptable?: boolean;
    yield_near_optimal?: boolean;
    slippage_ok?: boolean;
    gates_passed?: number;
    gates_total?: number;
    proof_hash?: string | null;
  };
  zkml_flags?: string[];
  zkml_proof_hash?: string;
}
```

**Step 2: Display zkML proof status in SignalsTab**

In `OracleSignalsTab.tsx`, after the existing signal card rendering (around line 130), add proof status badge:

```tsx
{/* Proof verification badge */}
{opp.zkml_signals && (
  <div className="flex items-center gap-2 text-xs">
    {opp.zkml_signals.gates_passed === opp.zkml_signals.gates_total ? (
      <span className="flex items-center gap-1 text-emerald-400">
        <Check className="w-3 h-3" />
        Verified ({opp.zkml_signals.gates_passed}/{opp.zkml_signals.gates_total} proofs)
      </span>
    ) : (
      <span className="flex items-center gap-1 text-amber-400">
        <AlertTriangle className="w-3 h-3" />
        Partial ({opp.zkml_signals.gates_passed}/{opp.zkml_signals.gates_total} proofs)
      </span>
    )}
    {opp.zkml_proof_hash && (
      <span className="text-zinc-500" title={opp.zkml_proof_hash}>
        Proof: {opp.zkml_proof_hash.slice(0, 8)}...
      </span>
    )}
  </div>
)}
```

**Step 3: Add circuit detail tooltip/popover**

Add expandable zkML details:

```tsx
{opp.zkml_signals && (
  <details className="mt-2">
    <summary className="text-xs text-blue-400 cursor-pointer hover:text-blue-300">
      zkML Circuit Details
    </summary>
    <div className="mt-2 pl-4 space-y-1 text-xs text-zinc-400">
      <div className="flex items-center gap-2">
        <span className={opp.zkml_signals.il_acceptable ? "text-emerald-400" : "text-red-400"}>
          {opp.zkml_signals.il_acceptable ? "✓" : "✗"}
        </span>
        <span>IL Prediction: {opp.zkml_signals.il_acceptable ? "Acceptable" : "High risk"}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={opp.zkml_signals.yield_near_optimal ? "text-emerald-400" : "text-amber-400"}>
          {opp.zkml_signals.yield_near_optimal ? "✓" : "~"}
        </span>
        <span>Yield: {opp.zkml_signals.yield_near_optimal ? "Near optimal" : "Suboptimal"}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={opp.zkml_signals.slippage_ok ? "text-emerald-400" : "text-red-400"}>
          {opp.zkml_signals.slippage_ok ? "✓" : "✗"}
        </span>
        <span>Slippage: {opp.zkml_signals.slippage_ok ? "Within bounds" : "High"}</span>
      </div>
    </div>
  </details>
)}
```

**Step 4: Verify**

Open demo mode, check Oracle → Signals. Should see "Verified" badges and circuit details for opportunities.

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/OracleSignalsTab.tsx frontend/src/components/zkdefi/oracle/types.ts
git commit -m "feat(oracle): display zkML circuit intelligence in Signals

- Show proof verification status (gates passed/total)
- Display proof hash with truncation
- Expandable circuit details (IL/yield/slippage)
- Visual indicators for pass/warn/fail states
- Backward compatible with non-zkML opportunities"
```

---

## Task 5: Add zkML intelligence section to Genome tab

**Files:**
- Modify: `frontend/src/components/zkdefi/oracle/OracleGenomeTab.tsx`

**Step 1: Add zkML Intelligence panel**

After the existing factor bars (around line 100), add zkML section:

```tsx
{/* zkML Intelligence */}
{selectedStrategy && opportunities.find(o => o.pair === selectedStrategy)?.zkml_signals && (
  <div className="mt-6 rounded-lg border border-blue-700/30 bg-blue-900/10 p-4">
    <h3 className="text-sm font-semibold text-blue-200 mb-3 flex items-center gap-2">
      <Shield className="w-4 h-4" />
      zkML Verification
    </h3>
    
    {(() => {
      const opp = opportunities.find(o => o.pair === selectedStrategy);
      const signals = opp?.zkml_signals;
      if (!signals) return null;
      
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Proof Status:</span>
            <span className={signals.gates_passed === signals.gates_total ? "text-emerald-400" : "text-amber-400"}>
              {signals.gates_passed}/{signals.gates_total} gates passed
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Risk Score:</span>
            <span className="text-zinc-200">{opp.zkml_risk_score ?? "N/A"}/100</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Confidence:</span>
            <span className="text-zinc-200">
              {opp.zkml_confidence ? `${(opp.zkml_confidence * 100).toFixed(0)}%` : "N/A"}
            </span>
          </div>
          {opp.zkml_proof_hash && (
            <div className="mt-3 p-2 rounded bg-zinc-900/50 font-mono text-xs text-zinc-500 break-all">
              Proof: {opp.zkml_proof_hash}
            </div>
          )}
        </div>
      );
    })()}
  </div>
)}
```

**Step 2: Import Shield icon**

At top of file:

```typescript
import { Dna, TrendingUp, Shield } from "lucide-react";
```

**Step 3: Verify**

Open Oracle → Genome, select a strategy. Should see zkML verification panel with proof status.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/oracle/OracleGenomeTab.tsx
git commit -m "feat(genome): add zkML verification panel

- Display proof gate status and confidence
- Show zkML risk score (0-100)
- Display full proof hash for verification
- Only shown when zkML data available
- Complements existing genome factors"
```

---

## Success Criteria

✅ `/opportunities` endpoint returns zkML-enhanced data:
   - `zkml_risk_score` from PoolRiskEvaluator (liquidity/volatility/volume/slippage factors)
   - `zkml_signals` from compute_signals (IL/yield/slippage circuits)
   - `zkml_proof_hash` for verification
   - `zkml_confidence` from circuit gate pass rate

✅ Frontend Oracle displays intelligence:
   - Signals tab: proof verification badges, circuit details
   - Genome tab: zkML verification panel with proof hash

✅ Ranking uses zkML-informed scores (not just basic APY * TVL)

✅ Graceful degradation: if circuits timeout or fail, falls back to evaluator-only scoring

✅ Performance: circuits only run on top 10 candidates (not all pools)

✅ Backward compatible: existing frontends without zkML support still work

---

## Out of Scope (Phase 2)

- zkGraph integration (obsqra.fi zkRAG)
- Strategy Intelligence Service (persistent genome computation)
- Real-time data enrichment from multiple sources
- Advanced correlation/liquidation analysis for opportunities
- Full 16-circuit suite (only IL/yield/slippage for Phase 1B)

---

**Next:** After Phase 1B complete, proceed to Phase 2 (zkGraph + Strategy Intelligence Service).
