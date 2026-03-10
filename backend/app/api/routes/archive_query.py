"""
Archive Query API for Phase 3 enhancements.

Allows querying archived events by date range, event type, and other filters.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, Query

from app.db.execution_store import get_execution_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["archive-query"])


@router.get("/api/v1/zkdefi/oracle/archive/events")
async def query_archive_events(
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    start_date: Optional[str] = Query(None, description="ISO8601 start date"),
    end_date: Optional[str] = Query(None, description="ISO8601 end date"),
    limit: int = Query(100, ge=1, le=1000, description="Max results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> dict[str, Any]:
    """
    Query archived events with optional filtering.
    
    Args:
        event_type: Filter by event type (e.g., 'execution_confirmed', 'signal_gated')
        start_date: ISO8601 start date for range query
        end_date: ISO8601 end date for range query
        limit: Max results (1-1000, default 100)
        offset: Pagination offset (default 0)
    
    Returns:
        {
            "events": [...],
            "total": 1250,
            "limit": 100,
            "offset": 0,
            "date_range": {
                "from": "2026-03-01T00:00:00Z",
                "to": "2026-03-08T10:00:00Z"
            }
        }
    """
    try:
        import sqlite3
        
        store = get_execution_store()
        db_path = store.db_path
        
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            
            # Build query
            query = "SELECT * FROM execution_events_archive WHERE 1=1"
            params: list[Any] = []
            
            if event_type:
                query += " AND event_type = ?"
                params.append(event_type)
            
            if start_date:
                query += " AND created_at >= ?"
                params.append(start_date)
            
            if end_date:
                query += " AND created_at <= ?"
                params.append(end_date)
            
            # Get total count
            count_query = query.replace("SELECT *", "SELECT COUNT(*)")
            cursor = conn.execute(count_query, params)
            total = cursor.fetchone()[0]
            
            # Get paginated results
            query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            
            # Format events
            import json
            events = []
            for row in rows:
                event = dict(row)
                if event.get("data"):
                    try:
                        event["data"] = json.loads(event["data"])
                    except (json.JSONDecodeError, TypeError):
                        pass
                events.append(event)
            
            date_range = {}
            if start_date or end_date:
                date_range["from"] = start_date or "N/A"
                date_range["to"] = end_date or "N/A"
            
            return {
                "events": events,
                "total": total,
                "limit": limit,
                "offset": offset,
                "date_range": date_range if date_range else None,
            }
    
    except Exception as e:
        logger.error(f"Archive query failed: {e}")
        return {
            "events": [],
            "total": 0,
            "error": str(e),
        }


@router.get("/api/v1/zkdefi/oracle/health/database")
async def get_database_health() -> dict[str, Any]:
    """
    Get database health metrics.
    
    Returns:
        {
            "status": "healthy|warning|critical",
            "executions_count": 5234,
            "events_count": 12043,
            "archived_events_count": 89304,
            "database_size_mb": 145.3,
            "pending_executions": 23,
            "success_rate": 0.967,
            "last_cleanup_at": "2026-03-08T10:00:00Z",
            "cleanup_interval_hours": 24,
            "recommendations": []
        }
    """
    try:
        import sqlite3
        import os
        
        store = get_execution_store()
        db_path = store.db_path
        
        with sqlite3.connect(db_path) as conn:
            # Get counts
            tables_query = """
                SELECT
                    (SELECT COUNT(*) FROM executions) as executions,
                    (SELECT COUNT(*) FROM execution_events) as events,
                    (SELECT COUNT(*) FROM execution_events_archive) as archived,
                    (SELECT COUNT(*) FROM executions WHERE status = 'pending') as pending,
                    (SELECT COUNT(*) FILTER (WHERE status = 'confirmed') * 100.0 / COUNT(*) 
                     FROM executions WHERE status IN ('confirmed', 'failed')) as success_rate
            """
            
            cursor = conn.execute(tables_query)
            row = cursor.fetchone()
            
            executions_count = row[0] or 0
            events_count = row[1] or 0
            archived_count = row[2] or 0
            pending = row[3] or 0
            success_rate = (row[4] or 0.0) / 100.0
        
        # Database size
        db_size_mb = os.path.getsize(db_path) / (1024 * 1024)
        
        # Health status determination
        recommendations = []
        status = "healthy"
        
        if db_size_mb > 500:
            status = "warning"
            recommendations.append(f"Database size {db_size_mb:.1f}MB exceeds 500MB threshold")
        
        if success_rate < 0.90:
            status = "warning"
            recommendations.append(f"Success rate {success_rate*100:.1f}% below 90% threshold")
        
        if pending > 1000:
            status = "warning"
            recommendations.append(f"High pending executions ({pending}) - relayer may be slow")
        
        if db_size_mb > 1000:
            status = "critical"
        
        if success_rate < 0.70:
            status = "critical"
        
        return {
            "status": status,
            "executions_count": executions_count,
            "events_count": events_count,
            "archived_events_count": archived_count,
            "database_size_mb": round(db_size_mb, 2),
            "pending_executions": pending,
            "success_rate": round(success_rate, 3),
            "last_cleanup_at": datetime.now(timezone.utc).isoformat(),
            "cleanup_interval_hours": 24,
            "recommendations": recommendations,
        }
    
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "error",
            "error": str(e),
        }
