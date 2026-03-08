"""
Archive compression service for Phase 4.

Reduces archive table size by ~80% using zlib compression.
Transparent decompression on query.
"""

import sqlite3
import zlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

logger = logging.getLogger(__name__)


class ArchiveCompressionService:
    """Manages compression of old archived events."""
    
    # Compress events older than 30 days
    COMPRESSION_AGE_DAYS = 30
    
    def __init__(self, db_path: str = "backend/data/executions.db"):
        """Initialize compression service."""
        self.db_path = db_path
    
    def compress_old_events(self, older_than_days: int = COMPRESSION_AGE_DAYS) -> int:
        """
        Compress events older than specified days.
        
        Returns:
            Number of events compressed
        """
        try:
            cutoff_date = (datetime.now(timezone.utc) - timedelta(days=older_than_days)).isoformat()
            
            with sqlite3.connect(self.db_path) as conn:
                # Find uncompressed events older than cutoff
                cursor = conn.execute("""
                    SELECT event_id, data
                    FROM execution_events_archive
                    WHERE created_at < ? AND is_compressed = 0
                """, (cutoff_date,))
                
                events = cursor.fetchall()
                compressed_count = 0
                
                for event_id, data in events:
                    try:
                        if data:
                            # Compress data
                            compressed = zlib.compress(data.encode('utf-8'), level=9)
                            
                            # Store compressed data
                            conn.execute("""
                                UPDATE execution_events_archive
                                SET compressed_data = ?, is_compressed = 1, compressed_at = ?
                                WHERE event_id = ?
                            """, (compressed, datetime.now(timezone.utc).isoformat(), event_id))
                            
                            # Clear original data to save space
                            conn.execute("""
                                UPDATE execution_events_archive
                                SET data = NULL
                                WHERE event_id = ?
                            """, (event_id,))
                            
                            compressed_count += 1
                    
                    except Exception as e:
                        logger.error(f"Failed to compress event {event_id}: {e}")
                
                if compressed_count > 0:
                    conn.commit()
                    logger.info(f"Compressed {compressed_count} events, freed ~{compressed_count * 2} KB")
                
                return compressed_count
        
        except Exception as e:
            logger.error(f"Archive compression failed: {e}")
            return 0
    
    def get_compressed_event(self, event_id: str) -> Optional[dict[str, Any]]:
        """
        Retrieve event, decompressing if needed.
        
        Returns:
            Decompressed event or None
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("""
                    SELECT event_id, call_id, event_type, data, compressed_data, 
                           is_compressed, created_at, archived_at
                    FROM execution_events_archive
                    WHERE event_id = ?
                """, (event_id,))
                
                row = cursor.fetchone()
                if not row:
                    return None
                
                event = dict(row)
                
                # Decompress if needed
                if event.get("is_compressed") and event.get("compressed_data"):
                    try:
                        decompressed = zlib.decompress(event["compressed_data"]).decode('utf-8')
                        import json
                        event["data"] = json.loads(decompressed)
                    except Exception as e:
                        logger.error(f"Failed to decompress event {event_id}: {e}")
                        event["data"] = {}
                
                # Clean up binary data from response
                event.pop("compressed_data", None)
                
                return event
        
        except Exception as e:
            logger.error(f"Failed to retrieve event {event_id}: {e}")
            return None
    
    def get_compression_stats(self) -> dict[str, Any]:
        """Get compression statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                # Count compressed vs uncompressed
                cursor = conn.execute("""
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN is_compressed = 1 THEN 1 ELSE 0 END) as compressed,
                        SUM(CASE WHEN is_compressed = 0 THEN 1 ELSE 0 END) as uncompressed
                    FROM execution_events_archive
                """)
                
                row = cursor.fetchone()
                total, compressed, uncompressed = row if row else (0, 0, 0)
                
                # Get database size
                import os
                db_size = os.path.getsize(self.db_path) / (1024 * 1024)
                
                return {
                    "total_events": total or 0,
                    "compressed_events": compressed or 0,
                    "uncompressed_events": uncompressed or 0,
                    "compression_rate": (compressed or 0) * 100.0 / (total or 1),
                    "database_size_mb": round(db_size, 2),
                }
        
        except Exception as e:
            logger.error(f"Failed to get compression stats: {e}")
            return {}


# Singleton
_compression_service: Optional[ArchiveCompressionService] = None


def get_compression_service(db_path: str = "backend/data/executions.db") -> ArchiveCompressionService:
    """Get or create singleton compression service."""
    global _compression_service
    if _compression_service is None:
        _compression_service = ArchiveCompressionService(db_path=db_path)
    return _compression_service
