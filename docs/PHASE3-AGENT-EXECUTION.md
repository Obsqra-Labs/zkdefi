# Phase 3.3-3.6: Agent Orchestration, Execution & Observability

**Completion Date:** March 8, 2026  
**Status:** IMPLEMENTED & INTEGRATED

## Overview

This phase extends the oracle gating engine with:
- **Agent Orchestrator** - converts signals to executable contract calls
- **Agent Execution Routes** - API for signal execution + relayer submission
- **Event Tracking** - telemetry for debugging and user activity feeds

## Implemented Components

### 1. Agent Orchestrator Service
**File:** `backend/app/services/agent_orchestrator.py`

Responsibilities:
- Signal → ContractCall mapping per opportunity type (lending, staking, dex, dca, limits)
- Parameter generation (amount, slippage, privacy mode)
- Relayer submission and status tracking

Key Methods:
- `prepare_execution()` - prepare a contract call from signal
- `submit_execution()` - submit to relayer (mock for Phase 1)
- `get_execution_status()` - track execution status
- `_generate_calldata()` - adapter-specific calldata generation

### 2. Agent Execution API Routes
**File:** `backend/app/api/routes/agent_execution.py`

Endpoints:
```
POST   /api/v1/zkdefi/oracle/execute
       Submit signal for execution (with policy re-gating)
       
GET    /api/v1/zkdefi/oracle/execution/{call_id}
       Get execution status
       
GET    /api/v1/zkdefi/oracle/execution/history/{address}
       User execution history (Phase 1: placeholder)
       
POST   /api/v1/zkdefi/oracle/execution/simulate
       Simulate execution without submitting (for preview/testing)
```

Integration Points:
- Calls `ExecutionPolicyService.evaluate_signal()` for gating
- Calls `AgentOrchestrator.prepare_execution()` for calldata generation
- Calls `AgentOrchestrator.submit_execution()` for relayer submission

### 3. Agent Event Tracking Service
**File:** `backend/app/services/agent_event_tracker.py`

Event Types:
- `SIGNAL_DISCOVERED` - new signal found
- `SIGNAL_EVALUATED` - signal evaluated against policy
- `SIGNAL_GATED` - signal passed/rejected by gate
- `EXECUTION_PREPARED` - contract call prepared
- `EXECUTION_SUBMITTED` - execution submitted to relayer
- `EXECUTION_CONFIRMED` - execution confirmed on-chain
- `EXECUTION_FAILED` - execution failed
- `POLICY_UPDATED` - policy changed
- `AGENT_ERROR` - agent encountered error

Key Methods:
- `track_event()` - record a single event
- `track_signal_gated()` - specialized signal gating event
- `track_execution_submitted()` - specialized execution event
- `get_user_events()` - fetch user's recent events
- `get_metrics()` - compute aggregate metrics

### 4. Backend Registration
**File:** `backend/app/main.py`

Registered routers:
```python
agent_execution_router = _optional_router("app.api.routes.agent_execution")
if agent_execution_router:
    app.include_router(agent_execution_router)
```

Integrated services:
- `EventTracker` instantiated globally in `signals.py`
- Ready for additional event tracking in oracle_gating.py

## System Flow: Signal to Execution

```
1. User/AI discovers signal from /api/v1/zkdefi/signals/top
   ↓ Event: SIGNAL_DISCOVERED

2. Signal sent to /api/v1/zkdefi/oracle/execute with execution_params
   ↓ Event: SIGNAL_EVALUATED

3. ExecutionPolicyService gates signal
   ↓ Event: SIGNAL_GATED (allowed/rejected)
   
4. If allowed, AgentOrchestrator.prepare_execution()
   - Maps signal type → adapter/method
   - Generates adapter-specific calldata
   - Creates ContractCall
   ↓ Event: EXECUTION_PREPARED

5. AgentOrchestrator.submit_execution()
   - Submits to relayer (Phase 1: mock)
   - Returns tx_hash
   ↓ Event: EXECUTION_SUBMITTED

6. User polls /api/v1/zkdefi/oracle/execution/{call_id}
   - Status: pending → confirmed → settled
   ↓ Event: EXECUTION_CONFIRMED (when mined)

7. Event logged for user dashboard, analytics, debugging
```

## API Examples

### Execute Signal
```bash
POST /api/v1/zkdefi/oracle/execute
{
  "address": "0x05fe...",
  "signal": {
    "id": "sig_lending_001",
    "type": "lending",
    "protocol": "aave",
    "constitution": {
      "contract": "0xabc...",
      "asset": "USDC",
      "pool": "3"
    },
    "yieldForecast": 8.5,
    "reputationScore": 0.95
  },
  "execution_params": {
    "amount": 1000000000000000000,
    "slippage": 50,
    "privacyLevel": "public"
  }
}

Response:
{
  "success": true,
  "call_id": "0xabc...",
  "tx_hash": "0xdef...",
  "status": "pending",
  "submitted_at": "2026-03-08T...",
  "address": "0x05fe...",
  "signal_id": "sig_lending_001"
}
```

### Simulate Execution
```bash
POST /api/v1/zkdefi/oracle/execution/simulate
{
  "address": "0x05fe...",
  "signal": {...},
  "execution_params": {...}
}

Response:
{
  "success": true,
  "simulation": {
    "call_id": "0xabc...",
    "adapter": "lending",
    "method": "supply",
    "calldata": {...},
    "estimated_gas": 180000,
    "estimated_cost_eth": 0.009
  }
}
```

### Get Execution History
```bash
GET /api/v1/zkdefi/oracle/execution/history/0x05fe...?limit=50

Response:
{
  "address": "0x05fe...",
  "executions": [],
  "total": 0,
  "metadata": {
    "phase": "phase-1-placeholder",
    "message": "Execution history tracking coming in Phase 2"
  }
}
```

### Get User Events
```bash
GET /api/v1/zkdefi/agent/events/0x05fe...?limit=100

Response:
{
  "address": "0x05fe...",
  "events": [
    {
      "event_type": "signal:gated",
      "data": {
        "signal_id": "sig_...",
        "allowed": true,
        "reason": null
      },
      "timestamp": "2026-03-08T..."
    }
  ]
}
```

## Phase 1 Boundaries

What's included:
- ✅ Signal-to-calldata mapping
- ✅ Relayer submission interface (mocked)
- ✅ Event tracking infrastructure
- ✅ Execution simulation for preview

What's deferred to Phase 2+:
- Persistent execution history (database)
- On-chain confirmation polling
- Event aggregation dashboards
- Agent performance metrics
- Async relayer updates

## Testing Checklist

- [ ] `AgentOrchestrator.prepare_execution()` generates correct calldata per adapter
- [ ] `execute_signal()` re-gates signals against current policy
- [ ] `simulate_execution()` previews without submitting
- [ ] Event tracker logs all event types
- [ ] User can retrieve own events and metrics
- [ ] Phase 1 placeholders clearly marked

## Integration Points for Future Work

1. **Relayer Service** - Replace mock submission in `AgentOrchestrator.submit_execution()`
2. **On-Chain Confirmation** - Poll relayer for tx status → emit `EXECUTION_CONFIRMED`
3. **Database Persistence** - Store execution history in SQLite instead of JSON
4. **Dashboard Integration** - Wire event streams to user activity feed
5. **Agent Performance** - Analyze metrics for AI/agent optimization

## Files Modified

- `backend/app/services/agent_orchestrator.py` - NEW
- `backend/app/api/routes/agent_execution.py` - NEW
- `backend/app/services/agent_event_tracker.py` - NEW
- `backend/app/main.py` - Added agent_execution_router registration
- `backend/app/api/routes/signals.py` - Added event tracker integration

## Deployment Checklist

- [x] Code paths registered in main.py
- [x] Services instantiated with singletons
- [x] JSON store paths created
- [x] Error handling for missing adapters
- [x] Logging configured
- [ ] Event retention policy documented
- [ ] Relayer integration specs finalized

---

**Next Phase:** Wire event streams to frontend dashboards and confirm agent execution completeness.
