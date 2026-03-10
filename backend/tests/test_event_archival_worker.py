"""
Unit tests for EventArchivalWorker.
"""

import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
import tempfile

from app.workers.event_archival_worker import EventArchivalWorker, get_archival_worker


@pytest.fixture
def temp_db():
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = str(Path(tmpdir) / "test_archival.db")
        
        # Initialize the database with schema
        with sqlite3.connect(db_path) as conn:
            conn.execute("""
                CREATE TABLE executions (
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
                    last_checked TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE execution_events (
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
            
            conn.commit()
        
        yield db_path


@pytest.fixture
def archival_worker(temp_db):
    """Create an EventArchivalWorker with temp database."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = temp_db
    return worker


@pytest.mark.asyncio
async def test_archival_worker_lifecycle(archival_worker):
    """Test worker start and stop."""
    # Start worker
    task = asyncio.create_task(archival_worker.start())
    await asyncio.sleep(0.1)  # Let it initialize
    
    # Verify running
    assert archival_worker.running is True
    
    # Stop worker
    await archival_worker.stop()
    
    try:
        await asyncio.wait_for(task, timeout=2.0)
    except asyncio.TimeoutError:
        task.cancel()


@pytest.mark.asyncio
async def test_archival_creates_archive_table(temp_db):
    """Test that archive table is created."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = temp_db
    
    # Run cleanup (creates archive table)
    await worker._cleanup_old_events()
    
    # Verify archive table exists
    with sqlite3.connect(temp_db) as conn:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='execution_events_archive'"
        )
        assert cursor.fetchone() is not None


@pytest.mark.asyncio
async def test_archival_moves_old_events(temp_db):
    """Test that old events are moved to archive."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = temp_db
    
    # Insert old events
    now = datetime.now(timezone.utc)
    old_date = (now - timedelta(days=40)).isoformat()
    recent_date = now.isoformat()
    
    with sqlite3.connect(temp_db) as conn:
        # Insert execution
        conn.execute("""
            INSERT INTO executions (call_id, address, signal_id, adapter, method, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, ("call1", "0xabc", "sig1", "adapter1", "method1", old_date, "confirmed"))
        
        # Insert old signal_gated event (30-day retention)
        conn.execute("""
            INSERT INTO execution_events (event_id, call_id, event_type, data, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, ("event1", "call1", "signal_gated", json.dumps({"test": "data"}), old_date))
        
        # Insert recent signal_gated event (should not be archived)
        conn.execute("""
            INSERT INTO execution_events (event_id, call_id, event_type, data, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, ("event2", "call1", "signal_gated", json.dumps({"test": "data"}), recent_date))
        
        conn.commit()
    
    # Run archival
    await worker._cleanup_old_events()
    
    # Verify old event was archived
    with sqlite3.connect(temp_db) as conn:
        # Check main table
        cursor = conn.execute("SELECT COUNT(*) FROM execution_events WHERE event_type = 'signal_gated'")
        main_count = cursor.fetchone()[0]
        assert main_count == 1  # Only recent event remains
        
        # Check archive table
        cursor = conn.execute("SELECT COUNT(*) FROM execution_events_archive WHERE event_type = 'signal_gated'")
        archive_count = cursor.fetchone()[0]
        assert archive_count == 1  # Old event archived


@pytest.mark.asyncio
async def test_archival_respects_retention_days(temp_db):
    """Test that different event types have different retention periods."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = temp_db
    
    now = datetime.now(timezone.utc)
    
    # Insert events at different ages
    events = [
        # (event_type, days_old, should_archive)
        ("execution_confirmed", 400, True),   # 1+ years old, should archive
        ("execution_confirmed", 300, False),  # ~10 months, should keep
        ("signal_gated", 40, True),            # 40 days old, should archive (30-day retention)
        ("signal_gated", 20, False),           # 20 days old, should keep
    ]
    
    with sqlite3.connect(temp_db) as conn:
        for i, (event_type, days_old, _) in enumerate(events):
            event_date = (now - timedelta(days=days_old)).isoformat()
            
            conn.execute("""
                INSERT INTO executions (call_id, address, signal_id, adapter, method, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (f"call{i}", "0xabc", f"sig{i}", "adapter1", "method1", event_date, "confirmed"))
            
            conn.execute("""
                INSERT INTO execution_events (event_id, call_id, event_type, data, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (f"event{i}", f"call{i}", event_type, json.dumps({}), event_date))
        
        conn.commit()
    
    # Run archival
    await worker._cleanup_old_events()
    
    # Verify correct events were archived
    with sqlite3.connect(temp_db) as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM execution_events_archive")
        archived_count = cursor.fetchone()[0]
        assert archived_count == 2  # 2 events should be archived


@pytest.mark.asyncio
async def test_database_stats_collection(temp_db):
    """Test database statistics collection."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = temp_db
    
    # Insert some test data
    with sqlite3.connect(temp_db) as conn:
        for i in range(5):
            conn.execute("""
                INSERT INTO executions (call_id, address, signal_id, adapter, method, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (f"call{i}", "0xabc", f"sig{i}", "adapter1", "method1", datetime.now(timezone.utc).isoformat(), "confirmed"))
        conn.commit()
    
    # Get stats
    stats = await worker._get_database_stats()
    
    assert "executions_count" in stats
    assert stats["executions_count"] == 5
    assert "database_size_mb" in stats
    assert stats["database_size_mb"] > 0


@pytest.mark.asyncio
async def test_archival_preserves_event_data(temp_db):
    """Test that archived events preserve their data."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = temp_db
    
    now = datetime.now(timezone.utc)
    old_date = (now - timedelta(days=40)).isoformat()
    
    test_data = {"key": "value", "nested": {"data": 123}}
    
    with sqlite3.connect(temp_db) as conn:
        conn.execute("""
            INSERT INTO executions (call_id, address, signal_id, adapter, method, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, ("call1", "0xabc", "sig1", "adapter1", "method1", old_date, "confirmed"))
        
        conn.execute("""
            INSERT INTO execution_events (event_id, call_id, event_type, data, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, ("event1", "call1", "signal_gated", json.dumps(test_data), old_date))
        
        conn.commit()
    
    # Run archival
    await worker._cleanup_old_events()
    
    # Verify archived data is intact
    with sqlite3.connect(temp_db) as conn:
        cursor = conn.execute("""
            SELECT data FROM execution_events_archive WHERE event_id = 'event1'
        """)
        row = cursor.fetchone()
        assert row is not None
        archived_data = json.loads(row[0])
        assert archived_data == test_data


@pytest.mark.asyncio
async def test_singleton_pattern():
    """Test that get_archival_worker returns same instance."""
    worker1 = get_archival_worker()
    worker2 = get_archival_worker()
    
    assert worker1 is worker2


@pytest.mark.asyncio
async def test_archival_error_handling(temp_db):
    """Test that archival handles errors gracefully."""
    worker = EventArchivalWorker()
    worker._execution_store.db_path = "/nonexistent/path/db.db"
    
    # Should not raise, just log
    await worker._cleanup_old_events()
