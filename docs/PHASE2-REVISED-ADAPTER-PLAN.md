# Phase 2: Prediction Model Integration Plan (REVISED)

**Date:** 2026-03-08  
**Status:** Ready for implementation  
**Constraint:** Respect no-touch boundaries (TradeDesk/oracle/mission-control)

---

## Discovery: Services Already Built ✅

### Existing: Snapshot Forecaster Service
- **File:** `backend/app/services/snapshot_forecaster_service.py` (2,400+ lines)
- **Capabilities:**
  - Full commit/reveal prediction lifecycle
  - Market predictions (5m/30m/240m horizons)
  - Calibration tracking (ECE, Brier score, MAE)
  - Model leaderboarding & drift analytics
  - PnL simulation & probability scoring
  - Multi-network support (Starknet Sepolia/Mainnet, Ethereum Mainnet)
- **Status:** Production-ready, comprehensive
- **API Endpoint:** Already has routes at `backend/app/api/routes/snapshot_forecaster.py`

### Existing: Reputation Service
- **File:** `backend/app/api/reputation.py`
- **Status:** Already implemented
- **Reputation Data:** `backend/app/services/reputation_passport_client.py`

---

## Phase 2 Work (SIMPLIFIED)

The job now is **NOT to build forecasters**, but to **wire existing services into signals**.

### Task P2.1: Forecaster Adapter (1 hour)

**What to build:** `backend/app/services/forecaster_adapter.py`

```python
class ForecasterAdapter:
    """Wraps snapshot forecaster service for signals consumption."""
    
    def get_market_forecast(
        self, 
        pair_id: str, 
        network_id: str = "starknet_sepolia"
    ) -> dict:
        """Get market predictions for a token pair."""
        # Create window from current market state
        # Call snapshot_forecaster.suggest_outputs()
        # Transform to signals format
        return {
            "probability_up_5m": ...,
            "probability_up_30m": ...,
            "probability_up_4h": ...,
            "calibration_score": ...,
            "predicted_apy": ...,
        }
```

**Integration:** Update `signals.py` to use this adapter instead of hardcoded placeholders.

### Task P2.2: Reputation Adapter (30 mins)

**What to build:** `backend/app/services/reputation_adapter.py`

```python
class ReputationAdapter:
    """Wraps reputation service for signals consumption."""
    
    def get_protocol_reputation(self, entity: str) -> dict:
        """Get reputation score for a protocol/entity."""
        # Fetch from reputation service
        # Map score (0-100) → trustworthiness tier
        return {
            "score": 85,
            "trustworthiness": "high",
            "reputation_model": "reputation-v1",
        }
```

**Integration:** Update `signals.py` to call this adapter.

### Task P2.3: Update Signals Endpoint (30 mins)

**What to update:** `backend/app/api/routes/signals.py`

Replace hardcoded prediction placeholders with adapter calls:

```python
def opportunity_to_signal(opportunity: dict, index: int) -> dict:
    # ... existing code ...
    
    # Use adapters instead of hardcoded values
    forecaster = ForecasterAdapter()
    reputation = ReputationAdapter()
    
    forecast = forecaster.get_market_forecast(opportunity.get("tokenA"))
    rep = reputation.get_protocol_reputation(opportunity.get("source"))
    
    signal["predictions"] = {
        "yieldForecast": forecast.yield_forecast,
        "reputationScore": rep,
        "marketForecaster": forecast.market_forecast,
    }
```

### Task P2.4: Performance Testing & Caching (1 hour)

- Add Redis/in-memory cache for forecaster output (TTL: 5 mins)
- Add cache for reputation scores (TTL: 1 hour)
- Measure signals/top latency with real models
- Target: <500ms response time

---

## Architecture (No-Touch Compliant)

```
signals.py (GET /api/v1/zkdefi/signals/top)
    ↓
Signals Adapter Layer (NEW)
    ├─ ForecasterAdapter
    │   └─ snapshot_forecaster_service (EXISTING)
    ├─ ReputationAdapter  
    │   └─ reputation_passport_client (EXISTING)
    └─ CapitalOSAdapter (FOR FUTURE POST-MERGE)
        └─ Deferred wiring to TradeDesk/oracle
```

**KEY:** All integration happens via adapters. No changes to TradeDesk/oracle/mission-control paths.

---

## Implementation Sequence

1. **P2.1:** Create forecaster adapter (read forecaster service, wrap outputs)
2. **P2.2:** Create reputation adapter (read reputation service, wrap outputs)
3. **P2.3:** Update signals endpoint to use adapters
4. **P2.4:** Cache + performance testing
5. **Commit:** PR-ready with feature flags for post-merge wiring

---

## What's Deferred (Phase 3)

**Post-merge wiring** (via feature flags):
- Wire signals adapters into TradeDesk surfaces
- Wire signals adapters into oracle banner/tab
- Wire signals adapters into intelligence stream

**This keeps your Capital OS V2 branch clean and merge-safe.**

---

## Total Time Estimate

- **Before:** 4-6 hours (build forecaster + integrations)
- **After Discovery:** 2-3 hours (just wrap existing + cache)

Ready to start P2.1 now?
