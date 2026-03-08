"""
Event Archival & Cleanup Worker.

Manages data retention and archival policies to prevent unbounded growth.
Archives old events and maintains database health.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.db.execution_store import get_execution_store

logger = logging.getLogger(__name__)


class EventArchivalWorker:
    """Background worker for event archival and cleanup."""
    
    # Retention policies per event type (in days)
    RETENTION_DAYS = {
        "execution_submitted": 90,   # Keep 3 months
        "execution_confirmed": 365,  # Keep 1 year
        "execution_failed": 365,     # Keep 1 year
        "signal_gated": 30,          # Keep 1 month
        "policy_updated": 90,        # Keep 3 months
        "error": 365,                # Keep 1 year
    }
    
    # Cleanup runs every 24 hours
    CLEANUP_INTERVAL = 86400  # seconds
    
    def __init__(self):
        """Initialize archival worker."""
        self._execution_store = get_execution_store()
        self.running = False
    
    async def start(self):
        """Start the archival cleanup loop."""
        self.running = True
        logger.info("EventArchivalWorker started (24-hour cleanup interval)")
        
        while self.running:
            try:
                await self._cleanup_old_events()
                # After archival, compress old archived events
                await self._compress_archived_events()
            except Exception as e:
                logger.error(f"Error in cleanup cycle: {e}")
            
            await asyncio.sleep(self.CLEANUP_INTERVAL)
    
    async def stop(self):
        """Stop the archival cleanup loop."""
        self.running = False
        logger.info("EventArchivalWorker stopping")
    
    async def _cleanup_old_events(self):
        """Remove old events based on retention policy."""
        try:
            now = datetime.now(timezone.utc)
            
            for event_type, retention_days in self.RETENTION_DAYS.items():
                cutoff_date = now - timedelta(days=retention_days)
                
                try:
                    # Archive events older than cutoff
                    archived_count = await self._archive_events(
                        event_type=event_type,
                        cutoff_date=cutoff_date,
                    )
                    
                    if archived_count > 0:
                        logger.info(
                            f"Archived {archived_count} {event_type} events "
                            f"(older than {retention_days} days)"
                        )
                    
                except Exception as e:
                    logger.error(f"Failed to archive {event_type} events: {e}")
            
            # Get database stats
            stats = await self._get_database_stats()
            logger.info(f"Database cleanup complete - Stats: {stats}")
            
        except Exception as e:
            logger.error(f"Cleanup cycle failed: {e}")
    
    async def _archive_events(
        self,
        event_type: str,
        cutoff_date: datetime,
    ) -> int:
        """
        Archive old events from main table to archive table.
        
        Args:
            event_type: Type of event to archive
            cutoff_date: Archive events older than this
            
        Returns:
            Number of events archived
        """
        try:
            import sqlite3
            
            db_path = self._execution_store.db_path
            
            with sqlite3.connect(db_path) as conn:
                # Create archive table if not exists
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
                
                cutoff_iso = cutoff_date.isoformat()
                
                # Move events to archive
                cursor = conn.execute(f"""
                    SELECT event_id, call_id, event_type, data, created_at
                    FROM execution_events
                    WHERE event_type = ? AND created_at < ?
                """, (event_type, cutoff_iso))
                
                events = cursor.fetchall()
                archived_count = 0
                
                for event in events:
                    conn.execute("""
                        INSERT INTO execution_events_archive
                        (event_id, call_id, event_type, data, created_at, archived_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        event[0],  # event_id
                        event[1],  # call_id
                        event[2],  # event_type
                        event[3],  # data
                        event[4],  # created_at
                        datetime.now(timezone.utc).isoformat(),
                    ))
                    archived_count += 1
                
                # Delete archived events from main table
                if archived_count > 0:
                    conn.execute("""
                        DELETE FROM execution_events
                        WHERE event_type = ? AND created_at < ?
                    """, (event_type, cutoff_iso))
                
                conn.commit()
                
                return archived_count
                
        except Exception as e:
            logger.error(f"Failed to archive {event_type} events: {e}")
            return 0
    
    async def _get_database_stats(self) -> dict[str, int]:
        """Get database statistics."""
        try:
            import sqlite3
            
            db_path = self._execution_store.db_path
            
            with sqlite3.connect(db_path) as conn:
                # Get table sizes
                stats = {}
                
                for table_name in ["executions", "execution_events", "execution_events_archive"]:
                    cursor = conn.execute(f"SELECT COUNT(*) FROM {table_name}")
                    count = cursor.fetchone()[0]
                    stats[f"{table_name}_count"] = count
                
                # Get database file size
                import os
                db_size = os.path.getsize(db_path) / (1024 * 1024)  # MB
                stats["database_size_mb"] = round(db_size, 2)
                
                return stats
                
        except Exception as e:
            logger.error(f"Failed to get database stats: {e}")
            return {}
    
    async def _compress_archived_events(self):
        """Compress old archived events to reduce disk usage."""
        try:
            from app.services.archive_compression import get_compression_service
            
            service = get_compression_service(self._execution_store.db_path)
            compressed = service.compress_old_events(older_than_days=30)
            
            if compressed > 0:
                stats = service.get_compression_stats()
                logger.info(
                    f"Archive compression: {compressed} events compressed. "
                    f"Rate: {stats.get('compression_rate', 0):.1f}%, "
                    f"DB size: {stats.get('database_size_mb', 0):.1f}MB"
                )
        
        except Exception as e:
            logger.error(f"Archive compression failed: {e}")


# Singleton instance
_archival_worker: Optional[EventArchivalWorker] = None


def get_archival_worker() -> EventArchivalWorker:
    """Get or create singleton EventArchivalWorker."""
    global _archival_worker
    if _archival_worker is None:
        _archival_worker = EventArchivalWorker()
    return _archival_worker
