# Phase 2: Relayer Integration & Persistent Execution History

**Date:** March 8, 2026  
**Status:** STARTING (Phase 1 ✅ COMPLETE + Capital OS V2 ✅ LANDED)  
**Duration:** 4-8 hours estimated

---

## Executive Summary

Phase 1-3 completed:
- ✅ Real data aggregation
- ✅ Predictive models
- ✅ Oracle gating & event tracking
- ✅ Orchestration API
- ✅ Capital OS V2 reputation integration (landed by parallel agent)

**Phase 2 Goal:** Make the signal → execution → receipt flow **REAL** (on-chain)

---

## What Phase 1 Left as Mocks

Currently in Phase 1 (Mocked):

```python
# backend/app/services/agent_orchestrator.py
submission = {
    "call_id": call.id,
    "tx_hash": f"0x{call.id[:62]}",  # ← FAKE
    "submitted_at": datetime.now(timezone.utc).isoformat(),
    "status": "pending",  # ← Never confirms
    "relayer": "mock-relayer-v1",
}
```

**Phase 2 Requirements:**
1. Real relayer service integration
2. Transaction confirmation polling
3. Execution history persistence
4. Event archival & cleanup

---

## Phase 2 Work Breakdown

### 2.1: Relayer Service Integration (2 hours)

**Objective:** Replace mock relayer with real contract submission

**Files to Create/Update:**
- `backend/app/services/relayer_client.py` (NEW)
- `backend/app/services/agent_orchestrator.py` (UPDATE)
- `backend/app/api/routes/agent_execution.py` (UPDATE)

**Implementation Steps:**

1. **Create Relayer Client Service**

```python
# backend/app/services/relayer_client.py

class RelayerClient:
    """Interface to Starknet relayer service."""
    
    def __init__(self, relayer_url: str = "http://localhost:8004"):
        self.relayer_url = relayer_url
        self.timeout = 10.0
    
    async def submit_call(
        self,
        call: ContractCall,
        max_fee: int = 1000000000000000,  # 0.001 ETH
    ) -> dict[str, Any]:
        """
        Submit contract call to relayer.
        
        Args:
            call: ContractCall from orchestrator
            max_fee: Max fee in wei
            
        Returns:
            {
                "tx_hash": "0x...",
                "status": "pending|rejected",
                "error": null|string,
                "submitted_at": iso_timestamp
            }
        """
        payload = {
            "call": call.calldata,
            "address": call.address,
            "adapter": call.adapter,
            "max_fee": max_fee,
            "nonce": await self._get_nonce(call.address),
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.relayer_url}/execute",
                json=payload,
            )
            
            if response.status_code != 200:
                return {
                    "tx_hash": None,
                    "status": "rejected",
                    "error": response.text,
                    "submitted_at": datetime.now(timezone.utc).isoformat(),
                }
            
            data = response.json()
            return {
                "tx_hash": data.get("tx_hash"),
                "status": "pending",
                "error": None,
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            }
    
    async def get_tx_status(self, tx_hash: str) -> dict[str, Any]:
        """Poll tx confirmation from relayer."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.relayer_url}/tx/{tx_hash}",
            )
            
            if response.status_code != 200:
                return {"tx_hash": tx_hash, "status": "unknown"}
            
            data = response.json()
            return {
                "tx_hash": tx_hash,
                "status": data.get("status"),  # pending|confirmed|failed
                "block": data.get("block_number"),
                "confirmed_at": data.get("confirmed_at"),
            }
    
    async def _get_nonce(self, address: str) -> int:
        """Get account nonce from relayer."""
        # Implementation depends on relayer API
        return 1  # placeholder
```

2. **Update AgentOrchestrator to use RelayerClient**

```python
# In backend/app/services/agent_orchestrator.py

class AgentOrchestrator:
    def __init__(self):
        self._execution_store = JsonStore("execution_queue")
        self._execution_history = JsonStore("execution_history")
        self._relayer = RelayerClient()  # NEW
    
    async def submit_execution(
        self,
        call: ContractCall,
    ) -> dict[str, Any]:
        """Submit to REAL relayer instead of mocking."""
        try:
            # Call real relayer
            submission = await self._relayer.submit_call(call)
            
            # Store with real tx_hash
            execution_record = self._call_to_dict(call)
            execution_record.update(submission)
            self._execution_history.set(call.id, execution_record)
            
            logger.info(f"Submitted execution {call.id}: {submission['tx_hash']}")
            return submission
            
        except Exception as e:
            logger.error(f"Relayer submission failed: {e}")
            raise
```

**Testing:**

```bash
# Test 1: Relayer connectivity
curl http://localhost:8004/health

# Test 2: Submit execution
curl -X POST http://localhost:8003/api/v1/zkdefi/oracle/execute?address=0x... \
  -H "Content-Type: application/json" \
  -d '{"signal": {...}, "execution_params": {...}}'
# Should return real tx_hash, not mocked

# Test 3: Poll status
curl http://localhost:8003/api/v1/zkdefi/oracle/execution/{call_id}
# Status should progress: pending → confirmed → settled
```

---

### 2.2: Transaction Confirmation Polling (2 hours)

**Objective:** Poll relayer for tx confirmations and update status

**Files to Create/Update:**
- `backend/app/workers/tx_confirmation_worker.py` (NEW)
- `backend/app/main.py` (UPDATE - register worker)

**Implementation Steps:**

1. **Create Confirmation Worker**

```python
# backend/app/workers/tx_confirmation_worker.py

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class TxConfirmationWorker:
    """Background worker to poll relayer for tx confirmations."""
    
    def __init__(
        self,
        execution_history: JsonStore,
        relayer_client: RelayerClient,
        poll_interval: int = 5,  # Check every 5 seconds
        max_age_hours: int = 24,  # Stop polling after 24 hours
    ):
        self.execution_history = execution_history
        self.relayer = relayer_client
        self.poll_interval = poll_interval
        self.max_age_hours = max_age_hours
        self.running = False
    
    async def start(self):
        """Start polling loop."""
        self.running = True
        logger.info("TxConfirmationWorker started")
        
        while self.running:
            try:
                await self._poll_pending_executions()
            except Exception as e:
                logger.error(f"Error in confirmation poll: {e}")
            
            await asyncio.sleep(self.poll_interval)
    
    async def stop(self):
        """Stop polling loop."""
        self.running = False
        logger.info("TxConfirmationWorker stopped")
    
    async def _poll_pending_executions(self):
        """Check pending executions for confirmation."""
        executions = self.execution_history.get("executions", [])
        
        for execution in executions:
            if execution.get("status") in ["pending", "submitted"]:
                # Check if too old
                submitted_at = datetime.fromisoformat(
                    execution.get("submitted_at", "")
                )
                age_hours = (datetime.now(timezone.utc) - submitted_at).total_seconds() / 3600
                
                if age_hours > self.max_age_hours:
                    # Stop polling old txs
                    continue
                
                # Poll relayer for status
                tx_hash = execution.get("tx_hash")
                if not tx_hash:
                    continue
                
                try:
                    status_result = await self.relayer.get_tx_status(tx_hash)
                    
                    # Update if changed
                    new_status = status_result.get("status")
                    if new_status != execution.get("status"):
                        execution["status"] = new_status
                        execution["last_checked"] = datetime.now(timezone.utc).isoformat()
                        
                        if new_status == "confirmed":
                            execution["confirmed_at"] = status_result.get("confirmed_at")
                            logger.info(f"Tx confirmed: {tx_hash}")
                        elif new_status == "failed":
                            logger.warning(f"Tx failed: {tx_hash}")
                        
                        # Persist update
                        self.execution_history.set(
                            execution.get("id"),
                            execution,
                        )
                
                except Exception as e:
                    logger.error(f"Failed to check tx {tx_hash}: {e}")
```

2. **Register Worker in main.py**

```python
# In backend/app/main.py

import asyncio
from app.workers.tx_confirmation_worker import TxConfirmationWorker

# Create worker
execution_history = JsonStore("execution_history")
relayer = RelayerClient()
confirmation_worker = TxConfirmationWorker(
    execution_history=execution_history,
    relayer_client=relayer,
    poll_interval=5,
)

# Start on app startup
@app.on_event("startup")
async def start_workers():
    asyncio.create_task(confirmation_worker.start())

@app.on_event("shutdown")
async def stop_workers():
    await confirmation_worker.stop()
```

---

### 2.3: Execution History Persistence (2 hours)

**Objective:** Replace JSON stores with SQLite for persistent history

**Files to Create/Update:**
- `backend/app/db/execution_store.py` (NEW)
- `backend/app/services/agent_orchestrator.py` (UPDATE)
- `backend/app/main.py` (UPDATE - initialize DB)

**Implementation Steps:**

1. **Create SQLite Execution Store**

```python
# backend/app/db/execution_store.py

import sqlite3
from datetime import datetime, timezone
from typing import Optional

class ExecutionStore:
    """SQLite persistence for execution history."""
    
    def __init__(self, db_path: str = "backend/data/executions.db"):
        self.db_path = db_path
        self._init_schema()
    
    def _init_schema(self):
        """Create tables if not exist."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS executions (
                    call_id TEXT PRIMARY KEY,
                    address TEXT NOT NULL,
                    signal_id TEXT NOT NULL,
                    adapter TEXT NOT NULL,
                    method TEXT NOT NULL,
                    calldata JSON,
                    tx_hash TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    submitted_at TEXT,
                    confirmed_at TEXT,
                    error TEXT,
                    INDEX idx_address (address),
                    INDEX idx_status (status),
                    INDEX idx_created_at (created_at)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS execution_events (
                    event_id TEXT PRIMARY KEY,
                    call_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    data JSON,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (call_id) REFERENCES executions(call_id),
                    INDEX idx_call_id (call_id),
                    INDEX idx_created_at (created_at)
                )
            """)
            conn.commit()
    
    def save_execution(self, call_id: str, execution: dict) -> None:
        """Save execution to database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO executions
                (call_id, address, signal_id, adapter, method, calldata,
                 tx_hash, status, created_at, submitted_at, confirmed_at, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                call_id,
                execution.get("address"),
                execution.get("signal_id"),
                execution.get("adapter"),
                execution.get("method"),
                json.dumps(execution.get("calldata", {})),
                execution.get("tx_hash"),
                execution.get("status", "pending"),
                execution.get("created_at"),
                execution.get("submitted_at"),
                execution.get("confirmed_at"),
                execution.get("error"),
            ))
            conn.commit()
    
    def get_execution(self, call_id: str) -> Optional[dict]:
        """Get execution by ID."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM executions WHERE call_id = ?",
                (call_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_user_executions(
        self,
        address: str,
        limit: int = 50,
    ) -> list[dict]:
        """Get user's execution history."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT * FROM executions
                WHERE address = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (address, limit)
            )
            return [dict(row) for row in cursor.fetchall()]
    
    def get_pending_executions(self) -> list[dict]:
        """Get all pending executions."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM executions WHERE status = 'pending'"
            )
            return [dict(row) for row in cursor.fetchall()]
```

2. **Update Orchestrator to use SQLite**

```python
# In backend/app/services/agent_orchestrator.py

class AgentOrchestrator:
    def __init__(self, db: ExecutionStore):
        self._db = db
        self._relayer = RelayerClient()
    
    def submit_execution(self, call: ContractCall) -> dict:
        submission = await self._relayer.submit_call(call)
        
        # Persist to database
        execution_record = self._call_to_dict(call)
        execution_record.update(submission)
        self._db.save_execution(call.id, execution_record)
        
        return submission
```

**Testing:**

```bash
# Verify database created
ls -la backend/data/executions.db

# Query execution history directly
sqlite3 backend/data/executions.db "SELECT * FROM executions LIMIT 5"

# Via API
curl http://localhost:8003/api/v1/zkdefi/oracle/execution/history/0x...
# Should return all user executions from database, not empty
```

---

### 2.4: Event Archival & Cleanup Policy (1 hour)

**Objective:** Implement data retention policies to prevent unbounded growth

**Files to Create:**
- `backend/app/workers/event_archival_worker.py` (NEW)

**Implementation:**

```python
# backend/app/workers/event_archival_worker.py

class EventArchivalWorker:
    """Manages event retention and cleanup."""
    
    RETENTION_DAYS = {
        "execution_submitted": 90,  # Keep 3 months
        "execution_confirmed": 365,  # Keep 1 year
        "signal_gated": 30,         # Keep 1 month
        "error": 365,               # Keep 1 year
    }
    
    async def cleanup(self):
        """Remove old events based on retention policy."""
        now = datetime.now(timezone.utc)
        
        for event_type, retention_days in self.RETENTION_DAYS.items():
            cutoff_date = now - timedelta(days=retention_days)
            
            # Archive events older than cutoff
            await self._archive_events(event_type, cutoff_date)
            # Delete from active store
            await self._delete_events(event_type, cutoff_date)
```

---

## Phase 2 Testing Strategy

### Unit Tests

```python
# backend/tests/test_relayer_client.py
def test_submit_call_success():
    """Real relayer submission returns tx_hash."""

def test_relayer_timeout_graceful():
    """Timeout handled gracefully."""

# backend/tests/test_tx_confirmation_worker.py
def test_poll_pending_executions():
    """Worker polls and updates statuses."""

def test_stop_polling_old_txs():
    """Stop polling after max_age."""

# backend/tests/test_execution_store.py
def test_save_and_retrieve_execution():
    """SQLite persistence working."""

def test_get_user_executions_ordered():
    """History returned in correct order."""
```

### Integration Tests

```bash
# Test complete flow: signal → execution → confirmation
./scripts/test_complete_signal_flow.sh

# Test database persistence
./scripts/test_execution_persistence.sh

# Test worker polling
./scripts/test_tx_confirmation_polling.sh
```

---

## Phase 2 Deployment Checklist

- [ ] Relayer service running on port 8004 (or configured)
- [ ] RelayerClient tests passing
- [ ] TxConfirmationWorker tests passing
- [ ] ExecutionStore tests passing
- [ ] Database initialized (executions.db created)
- [ ] Backend restart with workers active
- [ ] Verify: Complete signal → execution → confirmed flow
- [ ] Monitor: `pm2 logs zkdefi-backend` for worker activity
- [ ] Verify: Execution history persisted to database

---

## Phase 2 Success Criteria

✅ **Complete:**
- [ ] Real relayer submissions (no more mocked tx_hash)
- [ ] Transaction confirmation polling working
- [ ] Execution history persisted to SQLite
- [ ] Event archival policy working
- [ ] All Phase 1 endpoints still working (backward compatible)
- [ ] Performance: <500ms for execution submission
- [ ] Performance: <100ms for execution history queries

**Result:** Full signal → execution → on-chain → receipt → tracking loop operational

---

## Files to Deliver (Phase 2)

**New Files:**
- `backend/app/services/relayer_client.py`
- `backend/app/workers/tx_confirmation_worker.py`
- `backend/app/db/execution_store.py`
- `backend/app/workers/event_archival_worker.py`
- `backend/tests/test_relayer_client.py`
- `backend/tests/test_tx_confirmation_worker.py`
- `backend/tests/test_execution_store.py`

**Modified Files:**
- `backend/app/services/agent_orchestrator.py`
- `backend/app/api/routes/agent_execution.py`
- `backend/app/main.py`

**Docs:**
- `docs/PHASE2-RELAYER-INTEGRATION.md`

---

## Timeline

| Task | Duration | Status |
|------|----------|--------|
| Relayer Client | 2 hrs | ⏳ STARTING |
| Confirmation Polling | 2 hrs | ⏳ NEXT |
| Execution Persistence | 2 hrs | ⏳ NEXT |
| Event Archival | 1 hr | ⏳ NEXT |
| Testing & Verification | 1 hr | ⏳ NEXT |
| **Total** | **8 hrs** | |

**Estimated Completion:** March 8, 2026 - 12:00 UTC (4 hours from now)

---

## Success Definition

When Phase 2 is complete:

```
User Flow:
1. User sees signal (from Phase 1 ✅)
2. Signal passes policy (Phase 3 ✅)
3. User clicks "Execute"
4. System calls real relayer ← **Phase 2 NEW**
5. Relayer returns real tx_hash ← **Phase 2 NEW**
6. Worker polls for confirmation ← **Phase 2 NEW**
7. Status updates: pending → confirmed ← **Phase 2 NEW**
8. Receipt generated with on-chain proof ← **Phase 2 NEW**
9. Event tracked in database ← **Phase 2 NEW**
10. User sees execution in history ← **Phase 2 NEW**
```

**System becomes:** Production-ready with real on-chain execution ✅

---

Should I proceed with Phase 2 implementation? I'll start with the Relayer Client integration.
