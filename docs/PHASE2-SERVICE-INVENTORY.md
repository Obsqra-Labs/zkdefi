# Phase 2 Service Inventory

**Date:** 2026-03-08  
**Purpose:** Identify existing services for prediction model integration

---

## What Already Exists

### ✅ Snapshot Forecaster (Market Predictions)
- **Files:** 
  - `backend/app/api/routes/snapshot_forecaster.py` 
  - `backend/app/services/snapshot_forecaster_service.py`
  - `backend/app/services/snapshot_forecaster_worker.py`
- **Status:** Already implemented
- **Data:** `backend/data/snapshot_forecaster_*.json` files with predictions
- **Integration:** Need to wire into signals predictions

### ✅ Reputation Service
- **Files:**
  - `backend/app/api/reputation.py`
  - `backend/app/services/reputation_passport_client.py`
- **Status:** Already implemented
- **Integration:** Need to fetch reputation scores for protocols

### ❓ Yield Forecaster
- **Status:** NOT FOUND
- **Need:** Create basic yield forecaster
  - Input: pool utilization, pool age, protocol reputation
  - Output: predicted APY for 7d/30d horizon

---

## Phase 2 Work Breakdown (Revised)

### P2.1: Yield Forecaster (NEW - need to build)
**Time:** 1.5-2 hours
- Create `backend/app/services/yield_forecaster.py`
- Use lending pool data (utilization, rates) as input
- Apply decay factor based on pool age
- Return prediction with confidence

### P2.2: Forecaster Integration (WIRE UP EXISTING)
**Time:** 1 hour
- Read forecaster service code
- Map forecaster outputs → signals predictions
- Cache predictions (TTL: 5 mins)
- Handle forecaster unavailability

### P2.3: Reputation Integration (WIRE UP EXISTING)
**Time:** 1 hour
- Read reputation service code
- Fetch per-protocol scores
- Map to signal trustworthiness
- Cache reputation (TTL: 1 hour)

### P2.4: Performance Testing
**Time:** 1 hour
- Measure signal transformation latency
- Identify bottlenecks
- Add caching if needed

---

## Action Items for Phase 2 Start

1. ✅ Read `backend/app/services/snapshot_forecaster_service.py` → understand API
2. ✅ Read `backend/app/api/reputation.py` → understand endpoint structure
3. ✅ Create yield forecaster (simple implementation)
4. ✅ Wire all three into signals transformation
5. ✅ Test end-to-end
6. ✅ Performance validate

---

**Estimated Time: 4-5 hours** (not 6, since two services already exist)
