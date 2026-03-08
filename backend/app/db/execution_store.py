"""
Execution Store - SQLite persistence for execution history.

Replaces JSON stores with indexed SQLite for fast queries.
"""

import sqlite3
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Any

logger = logging.getLogger(__name__)


class ExecutionStore:
    """SQLite persistence for execution history and status tracking."""
    
    def __init__(self, db_path: str = "backend/data/executions.db"):
        """Initialize execution store with SQLite."""
        self.db_path = db_path
        self._init_schema()
    
    def _init_schema(self):
        """Create tables if they don't exist."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                # Executions table
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS executions (
                        call_id TEXT PRIMARY KEY,
                        address TEXT NOT NULL,
                        signal_id TEXT NOT NULL,
                        adapter TEXT NOT NULL,
                        method TEXT NOT NULL,
                        calldata TEXT,
                        tx_hash TEXT,
                        status TEXT DEFAULT 'pending',
                        error TEXT,
                        created_at TEXT NOT NULL,
                        submitted_at TEXT,
                        confirmed_at TEXT,
                        block_number INTEGER,
                        last_checked TEXT,
                        
                        INDEX idx_address (address),
                        INDEX idx_status (status),
                        INDEX idx_created_at (created_at),
                        INDEX idx_tx_hash (tx_hash)
                    )
                """)
                
                # Events table for tracking
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS execution_events (
                        event_id TEXT PRIMARY KEY,
                        call_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        data TEXT,
                        created_at TEXT NOT NULL,
                        
                        FOREIGN KEY (call_id) REFERENCES executions(call_id),
                        INDEX idx_call_id (call_id),
                        INDEX idx_event_type (event_type),
                        INDEX idx_created_at (created_at)
                    )
                """)
                
                # Archive table for old events
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS execution_events_archive (
                        event_id TEXT PRIMARY KEY,
                        call_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        data TEXT,
                        created_at TEXT NOT NULL,
                        archived_at TEXT NOT NULL,
                        
                        INDEX idx_created_at (created_at),
                        INDEX idx_archived_at (archived_at)
                    )
                """)
                
                conn.commit()
                logger.info(f"Execution store initialized: {db_path}")
                
        except Exception as e:
            logger.error(f"Failed to initialize execution store: {e}")
            raise
    
    def save_execution(self, execution: dict[str, Any]) -> None:
        """Save or update an execution."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO executions
                    (call_id, address, signal_id, adapter, method, calldata,
                     tx_hash, status, error, created_at, submitted_at,
                     confirmed_at, block_number, last_checked)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    execution.get("id") or execution.get("call_id"),
                    execution.get("address"),
                    execution.get("signal_id"),
                    execution.get("adapter"),
                    execution.get("method"),
                    json.dumps(execution.get("calldata", {})),
                    execution.get("tx_hash"),
                    execution.get("status", "pending"),
                    execution.get("error"),
                    execution.get("created_at"),
                    execution.get("submitted_at"),
                    execution.get("confirmed_at"),
                    execution.get("block_number"),
                    execution.get("last_checked"),
                ))
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to save execution: {e}")
            raise
    
    def get_execution(self, call_id: str) -> Optional[dict[str, Any]]:
        """Get execution by call ID."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM executions WHERE call_id = ?",
                    (call_id,)
                )
                row = cursor.fetchone()
                
                if row:
                    return self._row_to_dict(row)
                return None
                
        except Exception as e:
            logger.error(f"Failed to get execution: {e}")
            return None
    
    def get_user_executions(
        self,
        address: str,
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Get user's execution history with optional filtering."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                query = "SELECT * FROM executions WHERE address = ?"
                params = [address]
                
                if status:
                    query += " AND status = ?"
                    params.append(status)
                
                query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
                params.extend([limit, offset])
                
                cursor = conn.execute(query, params)
                return [self._row_to_dict(row) for row in cursor.fetchall()]
                
        except Exception as e:
            logger.error(f"Failed to get user executions: {e}")
            return []
    
    def get_pending_executions(self) -> list[dict[str, Any]]:
        """Get all pending executions for polling."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM executions WHERE status IN ('pending', 'submitted')"
                )
                return [self._row_to_dict(row) for row in cursor.fetchall()]
                
        except Exception as e:
            logger.error(f"Failed to get pending executions: {e}")
            return []
    
    def update_execution_status(
        self,
        call_id: str,
        status: str,
        **kwargs
    ) -> None:
        """Update execution status."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                updates = ["status = ?"]
                params = [status]
                
                # Add optional fields
                if "tx_hash" in kwargs:
                    updates.append("tx_hash = ?")
                    params.append(kwargs["tx_hash"])
                
                if "confirmed_at" in kwargs:
                    updates.append("confirmed_at = ?")
                    params.append(kwargs["confirmed_at"])
                
                if "block_number" in kwargs:
                    updates.append("block_number = ?")
                    params.append(kwargs["block_number"])
                
                if "error" in kwargs:
                    updates.append("error = ?")
                    params.append(kwargs["error"])
                
                updates.append("last_checked = ?")
                params.append(datetime.now(timezone.utc).isoformat())
                
                params.append(call_id)
                
                conn.execute(
                    f"UPDATE executions SET {', '.join(updates)} WHERE call_id = ?",
                    params
                )
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to update execution status: {e}")
    
    def log_event(
        self,
        event_id: str,
        call_id: str,
        event_type: str,
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        """Log an execution event."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT INTO execution_events
                    (event_id, call_id, event_type, data, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    event_id,
                    call_id,
                    event_type,
                    json.dumps(data or {}),
                    datetime.now(timezone.utc).isoformat(),
                ))
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to log event: {e}")
    
    def get_execution_events(self, call_id: str) -> list[dict[str, Any]]:
        """Get all events for an execution."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM execution_events WHERE call_id = ? ORDER BY created_at",
                    (call_id,)
                )
                
                events = []
                for row in cursor.fetchall():
                    event = dict(row)
                    if event.get("data"):
                        event["data"] = json.loads(event["data"])
                    events.append(event)
                return events
                
        except Exception as e:
            logger.error(f"Failed to get execution events: {e}")
            return []
    
    def get_stats(self, address: Optional[str] = None) -> dict[str, Any]:
        """Get statistics on executions."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                where_clause = "WHERE address = ?" if address else ""
                params = [address] if address else []
                
                cursor = conn.execute(
                    f"""
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                    FROM executions
                    {where_clause}
                    """,
                    params
                )
                
                row = cursor.fetchone()
                if row:
                    return {
                        "total": row[0] or 0,
                        "pending": row[1] or 0,
                        "confirmed": row[2] or 0,
                        "failed": row[3] or 0,
                    }
                
                return {"total": 0, "pending": 0, "confirmed": 0, "failed": 0}
                
        except Exception as e:
            logger.error(f"Failed to get stats: {e}")
            return {}
    
    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        """Convert SQLite Row to dict, parsing JSON fields."""
        data = dict(row)
        
        # Parse JSON fields
        if data.get("calldata"):
            try:
                data["calldata"] = json.loads(data["calldata"])
            except (json.JSONDecodeError, TypeError):
                pass
        
        return data


# Singleton instance
_execution_store: Optional[ExecutionStore] = None


def get_execution_store(db_path: str = "backend/data/executions.db") -> ExecutionStore:
    """Get or create singleton ExecutionStore."""
    global _execution_store
    if _execution_store is None:
        _execution_store = ExecutionStore(db_path=db_path)
    return _execution_store
