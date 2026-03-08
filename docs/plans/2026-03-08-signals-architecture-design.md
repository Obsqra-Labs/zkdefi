# Signals Architecture Design

**Date:** 2026-03-08  
**Status:** Approved - Phase 1 (Placeholder), Phase 2+ (Full Implementation)  
**Context:** Layered intelligence stack for oracle actionability: Opportunities → Signals → Oracle Actions

---

## Overview

**Signals** are the deterministic, circuit-verified intelligence layer that feeds the oracle and agents. They transform raw opportunities into actionable insights by applying predictive models, risk gates, and reputation scoring.

### Three-Layer Stack

1. **Layer 1: Opportunities** - Raw discovery from protocols
   - `GET /api/v1/zkdefi/opportunities/list` (currently implemented)
   - All protocol sources: lending, staking, DEX (including Ekubo LP), DCA, limits
   
2. **Layer 2: Signals** - Verified intelligence for oracle consumption
   - `GET /api/v1/zkdefi/signals/top` (placeholder in Phase 1)
   - Applies zkML gates, predictions, constitution reports
   - Ranks by oracle actionability

3. **Layer 3: Oracle Actions** - Future (not in scope yet)
   - Oracle receives signals, evaluates policy gates
   - Agents consume gated signals and execute

---

## Phase 1: Placeholder Signals Endpoint

**Scope:** Create infrastructure, populate with opportunities data, ready for Phase 2 predictions.

### Endpoint: `GET /api/v1/zkdefi/signals/top`

**Response Structure:**
```json
{
  "signals": [
    {
      "id": "signal-lending-supply-xxx",
      "opportunity_id": "lending-supply",
      "type": "lending",
      "name": "Lending Pool Supply",
      "description": "Supply stablecoins and earn yield",
      "currentYield": 3.0,
      "riskScore": 25,
      "privacyMode": "public",
      "rank": 1,
      "constitution": {
        "contract": "0x05ba14536eca827e292bf633c2963abc048f0160a8a3efea6a71ca07d0bb3e64",
        "entity": "zkdefi-lending",
        "asset": "USDC",
        "pool": "primary_lending_pool"
      },
      "predictions": {
        "yieldForecast": {
          "model": "yield-predictor-v1",
          "predicted_apy": 3.2,
          "confidence": 0.78,
          "horizon": "7d"
        },
        "reputationScore": {
          "model": "reputation-v1",
          "score": 85,
          "trustworthiness": "high"
        },
        "marketForecaster": {
          "model": "forecaster-circuit-v1",
          "probability_up_5m": 0.65,
          "probability_up_30m": 0.70,
          "probability_up_4h": 0.74,
          "calibration_score": 0.92
        }
      },
      "zkml_gated": false,
      "circuit_verified": false,
      "source": "zkdefi-aggregation",
      "updatedAt": "2026-03-08T12:00:00Z"
    }
  ],
  "metadata": {
    "total": 5,
    "filtered_by": ["type", "yield", "risk", "privacyMode"],
    "ranking_model": "opportunity-priority-v1"
  }
}
```

### Phase 1 Implementation

- Fetch from `GET /api/v1/zkdefi/opportunities/list`
- Wrap each opportunity as a signal with empty predictions
- Add constitution skeleton (contract, entity, asset, pool)
- Sort by yield/risk (placeholder ranking)
- Add `zkml_gated: false`, `circuit_verified: false` flags

**API Route:** `backend/app/api/routes/signals.py` (new file)

---

## Phase 2: Predictive Models Integration

**Scope:** Wire up actual predictions into signals.

### Models to Integrate

1. **Yield Forecaster**
   - Predicts 7d/30d APY changes
   - Risk adjustment per pool health
   - Source: `backend/app/services/yield_forecast.py` (if exists) or new

2. **Reputation Model**
   - User/protocol trustworthiness scoring
   - Source: `backend/app/api/routes/reputation.py`
   - Maps to signal's `trustworthiness` tier

3. **Market Forecaster**
   - Calibrated probability predictions (5m/30m/4h)
   - Built-in via forecaster circuit
   - Source: forecaster service (e.g., `backend/app/services/forecaster.py`)

### Per-Signal Constitution Report

Each signal includes deterministic context:
- **contract**: Smart contract address
- **entity**: Protocol/adapter name
- **asset**: Token symbol
- **pool**: Specific pool/position identifier
- **compliance**: Proof-of-compliance gate status
- **risk_profile**: zkML risk bucketing

---

## Phase 3: Oracle Integration (Future)

- Oracle receives `GET /api/v1/zkdefi/signals/top?limit=10`
- Applies policy gates from constraints/policy endpoints
- Filters by `zkml_gated: true` + `circuit_verified: true` + compliance
- Passes to agent orchestration for execution

---

## Ekubo LP Inclusion

✅ **Ekubo LP is already included** in opportunities aggregation:
- DEX pairs endpoint returns Ekubo pairs (if available)
- Each pair creates a swap opportunity
- Additional Ekubo-specific endpoints can populate:
  - `GET /api/v1/zkdefi/ekubo/positions` (user positions)
  - Specific LP opportunities per position

**For Signals:** Ekubo LP opportunities flow through same pipeline as all other opportunities.

---

## API Contracts

### Current (Phase 1)
- `GET /api/v1/zkdefi/opportunities/list` — Raw opportunities ✅
- `GET /api/v1/zkdefi/signals/top` — Placeholder signals (new)

### Phase 2
- `GET /api/v1/zkdefi/signals/top?type=lending&riskScore=<50` — Filter signals by predictions
- `POST /api/v1/zkdefi/signals/rank` — Re-rank signals by model

### Phase 3 (Oracle)
- `GET /api/v1/zkdefi/signals/gated` — Only circuit-verified signals
- `GET /api/v1/zkdefi/oracle/actions` — Oracle-actionable signals

---

## Frontend Integration

### Phase 1
- Dashboard pulls signals from `GET /api/v1/zkdefi/signals/top`
- Displays ranked opportunities with constitution cards
- Shows `zkml_gated: false` as "placeholder" label

### Phase 2
- Render actual prediction scores
- Show calibration curves, reputation tiers
- Interactive "why this signal?" with constitution details

### Phase 3
- Oracle advisory panel consumes gated signals
- Agent execution panel shows policy-filtered actions

---

## Success Criteria

### Phase 1
- ✅ Endpoint returns 200 with 5+ signals
- ✅ Constitution data populated for each signal
- ✅ Ekubo LP opportunities included
- ✅ Placeholder predictions have correct JSON structure
- ✅ Frontend can render signals dashboard

### Phase 2
- ✅ Real predictions flowing into signals
- ✅ Reputation & yield models integrated
- ✅ Forecaster calibration tracked
- ✅ Signal ranking reflects prediction confidence

### Phase 3
- ✅ Oracle receives only `circuit_verified: true` signals
- ✅ Agent gating policies enforce compliance checks
- ✅ Long-term reputation accumulation working

---

## Implementation Order

1. **Task 3.1:** Create `signals.py` router with placeholder endpoint
2. **Task 3.2:** Wire opportunities → signals transformation
3. **Task 3.3:** Add constitution skeleton
4. **Task 3.4:** Test E2E: opportunities → signals → dashboard
5. **Phase 2 (future):** Integrate actual predictive models
6. **Phase 3 (future):** Oracle consumption & gating

---

## Notes

- Signals are **not** exclusive; multiple signals can reference same opportunity from different angles
- Constitution reports are **deterministic** - same opportunity always produces same contract/entity/asset details
- Predictions are **versioned** - model changes tracked with `model` field for calibration analysis
- Ranking is **pluggable** - can swap `opportunity-priority-v1` for other ranking algorithms

---

**Approved by:** User  
**Next step:** Execute Phase 1 implementation plan
