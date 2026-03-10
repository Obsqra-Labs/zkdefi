"""
Unit tests for Phase 4 components.

Covers archive compression, Redis nonce manager, and analytics service.
"""

import pytest
import tempfile
import sqlite3
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock

from app.services.archive_compression import ArchiveCompressionService
from app.services.analytics_service import AnalyticsService


class TestArchiveCompression:
    """Tests for archive compression service."""
    
    @pytest.fixture
    def temp_db(self):
        """Create temporary database for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = str(Path(tmpdir) / "test_archive.db")
            
            with sqlite3.connect(db_path) as conn:
                conn.execute("""
                    CREATE TABLE execution_events_archive (
                        event_id TEXT PRIMARY KEY,
                        call_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        data TEXT,
                        compressed_data BLOB,
                        is_compressed INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL,
                        archived_at TEXT NOT NULL,
                        compressed_at TEXT
                    )
                """)
                conn.commit()
            
            yield db_path
    
    def test_compress_old_events(self, temp_db):
        """Test compression of old events."""
        service = ArchiveCompressionService(db_path=temp_db)
        
        now = datetime.now(timezone.utc)
        old_date = (now - timedelta(days=40)).isoformat()
        
        # Insert old uncompressed event
        with sqlite3.connect(temp_db) as conn:
            conn.execute("""
                INSERT INTO execution_events_archive
                (event_id, call_id, event_type, data, is_compressed, created_at, archived_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, ("evt1", "call1", "test", json.dumps({"key": "value"}), 0, old_date, now.isoformat()))
            conn.commit()
        
        # Compress
        count = service.compress_old_events(older_than_days=30)
        
        assert count == 1
        
        # Verify compressed in database
        with sqlite3.connect(temp_db) as conn:
            cursor = conn.execute("""
                SELECT is_compressed, compressed_data, data FROM execution_events_archive WHERE event_id = 'evt1'
            """)
            row = cursor.fetchone()
            assert row[0] == 1  # is_compressed = 1
            assert row[1] is not None  # compressed_data exists
            assert row[2] is None  # data cleared
    
    def test_get_compressed_event(self, temp_db):
        """Test retrieving and decompressing event."""
        import zlib
        
        service = ArchiveCompressionService(db_path=temp_db)
        test_data = {"key": "value", "nested": {"data": 123}}
        compressed = zlib.compress(json.dumps(test_data).encode('utf-8'))
        
        now = datetime.now(timezone.utc)
        old_date = (now - timedelta(days=40)).isoformat()
        
        # Insert compressed event
        with sqlite3.connect(temp_db) as conn:
            conn.execute("""
                INSERT INTO execution_events_archive
                (event_id, call_id, event_type, compressed_data, is_compressed, created_at, archived_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, ("evt1", "call1", "test", compressed, 1, old_date, now.isoformat()))
            conn.commit()
        
        # Retrieve and decompress
        event = service.get_compressed_event("evt1")
        
        assert event is not None
        assert event["data"] == test_data
    
    def test_compression_stats(self, temp_db):
        """Test compression statistics."""
        service = ArchiveCompressionService(db_path=temp_db)
        
        now = datetime.now(timezone.utc)
        old_date = (now - timedelta(days=40)).isoformat()
        
        # Insert mix of compressed and uncompressed
        with sqlite3.connect(temp_db) as conn:
            for i in range(5):
                conn.execute("""
                    INSERT INTO execution_events_archive
                    (event_id, call_id, event_type, data, is_compressed, created_at, archived_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (f"evt{i}", "call1", "test", json.dumps({}), i % 2, old_date, now.isoformat()))
            conn.commit()
        
        stats = service.get_compression_stats()
        
        assert stats["total_events"] == 5
        assert stats["compressed_events"] == 2
        assert stats["uncompressed_events"] == 3


class TestAnalyticsService:
    """Tests for analytics service."""
    
    @pytest.fixture
    def temp_db_with_data(self):
        """Create database with test execution data."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = str(Path(tmpdir) / "test_analytics.db")
            
            with sqlite3.connect(db_path) as conn:
                conn.execute("""
                    CREATE TABLE executions (
                        call_id TEXT PRIMARY KEY,
                        address TEXT NOT NULL,
                        adapter TEXT NOT NULL,
                        status TEXT,
                        error TEXT,
                        created_at TEXT,
                        submitted_at TEXT,
                        confirmed_at TEXT
                    )
                """)

                conn.execute("""
                    CREATE TABLE execution_events_archive (
                        event_id TEXT PRIMARY KEY,
                        call_id TEXT,
                        event_type TEXT,
                        data TEXT,
                        compressed_data BLOB,
                        is_compressed INTEGER DEFAULT 0,
                        created_at TEXT,
                        archived_at TEXT
                    )
                """)
                
                now = datetime.now(timezone.utc)
                day_ago = (now - timedelta(days=1)).isoformat()
                
                # Insert test data
                test_data = [
                    ("call1", "addr1", "ekubo", "confirmed", None, day_ago, day_ago, now.isoformat()),
                    ("call2", "addr1", "ekubo", "confirmed", None, day_ago, day_ago, now.isoformat()),
                    ("call3", "addr2", "lending", "failed", "timeout", day_ago, day_ago, now.isoformat()),
                    ("call4", "addr2", "staking", "pending", None, day_ago, day_ago, None),
                ]
                
                for call_id, addr, adapter, status, error, created, submitted, confirmed in test_data:
                    conn.execute("""
                        INSERT INTO executions
                        (call_id, address, adapter, status, error, created_at, submitted_at, confirmed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (call_id, addr, adapter, status, error, created, submitted, confirmed))
                
                conn.commit()
            
            yield db_path
    
    def test_summary_analytics(self, temp_db_with_data):
        """Test summary analytics."""
        service = AnalyticsService(db_path=temp_db_with_data)
        summary = service.get_summary_analytics()
        
        assert summary["total_executions"] == 4
        assert summary["success_rate"] == 0.5  # 2/4 confirmed
        assert len(summary["top_adapters"]) > 0
    
    def test_performance_analytics(self, temp_db_with_data):
        """Test performance analytics."""
        service = AnalyticsService(db_path=temp_db_with_data)
        perf = service.get_performance_analytics()
        
        assert "execution_rate_per_min" in perf
        assert "p50_confirmation_time" in perf
        assert "database_health" in perf
    
    def test_timeline_analytics(self, temp_db_with_data):
        """Test timeline analytics."""
        service = AnalyticsService(db_path=temp_db_with_data)
        timeline = service.get_timeline_analytics(days=7)
        
        assert isinstance(timeline, list)
        assert len(timeline) > 0
        
        # Check structure
        if len(timeline) > 0:
            item = timeline[0]
            assert "hour" in item
            assert "executions" in item
            assert "success_rate" in item


class TestRedisNonceManager:
    """Tests for Redis nonce manager (with mocking)."""
    
    @pytest.mark.asyncio
    async def test_nonce_manager_initialization(self):
        """Test nonce manager initialization."""
        from app.services.redis_nonce_manager import RedisNonceManager
        
        manager = RedisNonceManager()
        
        # Should initialize without Redis (graceful)
        assert manager.redis_client is None
        assert not manager._initialized
    
    @pytest.mark.asyncio
    async def test_get_nonce_fallback(self):
        """Test fallback behavior when Redis unavailable."""
        from app.services.redis_nonce_manager import RedisNonceManager
        
        manager = RedisNonceManager()
        # Without Redis, should return None gracefully
        nonce = await manager.get_nonce("0xabc")
        assert nonce is None
    
    @pytest.mark.asyncio
    async def test_reset_nonce_gracefully(self):
        """Test nonce reset when Redis unavailable."""
        from app.services.redis_nonce_manager import RedisNonceManager
        
        manager = RedisNonceManager()
        # Should not raise error
        await manager.reset_nonce("0xabc")
        assert True  # Didn't crash
    
    @pytest.mark.asyncio
    async def test_get_stats_gracefully(self):
        """Test stats retrieval when Redis unavailable."""
        from app.services.redis_nonce_manager import RedisNonceManager
        
        manager = RedisNonceManager()
        stats = await manager.get_stats()
        
        assert stats.get("status") == "unavailable"


# Integration tests
class TestPhase4Integration:
    """Integration tests for Phase 4 components."""
    
    @pytest.fixture
    def temp_db(self):
        """Create temporary database with archive table."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = str(Path(tmpdir) / "test_archive.db")
            with sqlite3.connect(db_path) as conn:
                conn.execute("""
                    CREATE TABLE execution_events_archive (
                        event_id TEXT PRIMARY KEY,
                        call_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        data TEXT,
                        compressed_data BLOB,
                        is_compressed INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL,
                        archived_at TEXT NOT NULL,
                        compressed_at TEXT
                    )
                """)
                conn.commit()
            yield db_path

    def test_archive_compression_workflow(self, temp_db):
        """Test full compression workflow."""
        service = ArchiveCompressionService(db_path=temp_db)
        
        # Insert events at different ages
        now = datetime.now(timezone.utc)
        
        for days_old in [5, 25, 35, 45]:
            date = (now - timedelta(days=days_old)).isoformat()
            with sqlite3.connect(temp_db) as conn:
                conn.execute("""
                    INSERT INTO execution_events_archive
                    (event_id, call_id, event_type, data, is_compressed, created_at, archived_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (f"evt_day{days_old}", "call1", "test", json.dumps({"day": days_old}), 
                      0, date, now.isoformat()))
                conn.commit()
        
        # Compress (30+ days)
        compressed = service.compress_old_events(older_than_days=30)
        
        # Should compress 2 events (35, 45 days old)
        assert compressed == 2
        
        # Verify stats
        stats = service.get_compression_stats()
        assert stats["compressed_events"] == 2
        assert stats["uncompressed_events"] == 2
