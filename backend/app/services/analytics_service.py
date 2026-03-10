"""
Advanced analytics service for Phase 4.

Provides real-time system metrics, performance insights, and trending data.
"""

import sqlite3
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


class AnalyticsService:
    """Computes advanced analytics from execution data."""
    
    def __init__(self, db_path: str = "backend/data/executions.db"):
        """Initialize analytics service."""
        self.db_path = db_path
    
    def get_summary_analytics(self) -> dict[str, Any]:
        """
        Get summary analytics across all time periods.
        
        Returns:
            {
                "total_executions": 5234,
                "executions_24h": 234,
                "executions_7d": 1200,
                "success_rate": 0.967,
                "success_rate_24h": 0.95,
                "avg_confirmation_time_seconds": 45.3,
                "top_adapters": [{"adapter": "ekubo", "count": 1200, "success_rate": 0.98}],
                "error_distribution": [{"error": "timeout", "count": 50}]
            }
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                now = datetime.now(timezone.utc)
                day_ago = (now - timedelta(days=1)).isoformat()
                week_ago = (now - timedelta(days=7)).isoformat()
                
                # Overall stats
                cursor = conn.execute("""
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                        AVG(CASE 
                            WHEN confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
                            THEN (julianday(confirmed_at) - julianday(submitted_at)) * 86400
                            ELSE NULL
                        END) as avg_confirmation_time
                    FROM executions
                """)
                overall = dict(cursor.fetchone() or {})
                
                # 24h stats
                cursor = conn.execute("""
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
                    FROM executions
                    WHERE created_at >= ?
                """, (day_ago,))
                day_stats = dict(cursor.fetchone() or {})
                
                # 7d stats
                cursor = conn.execute("""
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
                    FROM executions
                    WHERE created_at >= ?
                """, (week_ago,))
                week_stats = dict(cursor.fetchone() or {})
                
                # Top adapters
                cursor = conn.execute("""
                    SELECT
                        adapter,
                        COUNT(*) as count,
                        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
                    FROM executions
                    GROUP BY adapter
                    ORDER BY count DESC
                    LIMIT 5
                """)
                top_adapters = [{
                    "adapter": row["adapter"],
                    "count": row["count"],
                    "success_rate": row["confirmed"] / row["count"] if row["count"] > 0 else 0
                } for row in cursor.fetchall()]
                
                # Error distribution
                cursor = conn.execute("""
                    SELECT
                        COALESCE(error, 'unknown') as error,
                        COUNT(*) as count
                    FROM executions
                    WHERE status = 'failed' AND error IS NOT NULL
                    GROUP BY error
                    ORDER BY count DESC
                    LIMIT 5
                """)
                errors = [{"error": row["error"], "count": row["count"]} for row in cursor.fetchall()]
                
                total_execs = overall.get("total") or 0
                confirmed = overall.get("confirmed") or 0
                failed = overall.get("failed") or 0
                
                return {
                    "total_executions": total_execs,
                    "executions_24h": day_stats.get("total") or 0,
                    "executions_7d": week_stats.get("total") or 0,
                    "success_rate": confirmed / total_execs if total_execs > 0 else 0,
                    "success_rate_24h": (day_stats.get("confirmed") or 0) / (day_stats.get("total") or 1),
                    "avg_confirmation_time_seconds": overall.get("avg_confirmation_time") or 0,
                    "top_adapters": top_adapters,
                    "error_distribution": errors,
                }
        
        except Exception as e:
            logger.error(f"Failed to compute summary analytics: {e}")
            return {}
    
    def get_performance_analytics(self) -> dict[str, Any]:
        """
        Get performance metrics and insights.
        
        Returns:
            {
                "execution_rate_per_min": 2.3,
                "p50_confirmation_time": 35.2,
                "p95_confirmation_time": 120.5,
                "p99_confirmation_time": 250.8,
                "archive_growth_rate_mb_per_day": 5.2,
                "database_health": "healthy|warning|critical"
            }
        """
        try:
            import os
            
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                now = datetime.now(timezone.utc)
                hour_ago = (now - timedelta(hours=1)).isoformat()
                
                # Execution rate (last hour)
                cursor = conn.execute("""
                    SELECT COUNT(*) as count FROM executions WHERE created_at >= ?
                """, (hour_ago,))
                hourly_count = cursor.fetchone()["count"] or 0
                exec_rate_per_min = hourly_count / 60.0
                
                # Confirmation time percentiles
                cursor = conn.execute("""
                    SELECT
                        (julianday(confirmed_at) - julianday(submitted_at)) * 86400 as time_seconds
                    FROM executions
                    WHERE confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
                    ORDER BY time_seconds
                """)
                times = [row["time_seconds"] for row in cursor.fetchall()]
                
                p50 = times[len(times) // 2] if len(times) > 0 else 0
                p95 = times[int(len(times) * 0.95)] if len(times) > 0 else 0
                p99 = times[int(len(times) * 0.99)] if len(times) > 0 else 0
                
                # Archive growth
                week_ago = (now - timedelta(days=7)).isoformat()
                cursor = conn.execute("""
                    SELECT COUNT(*) as count FROM execution_events_archive WHERE created_at >= ?
                """, (week_ago,))
                week_archived = cursor.fetchone()["count"] or 0
                archive_growth_per_day = week_archived / 7.0 * 0.002  # ~2KB per event
                
                # Database health
                db_size = os.path.getsize(self.db_path) / (1024 * 1024)
                health = "healthy" if db_size < 500 else ("warning" if db_size < 1000 else "critical")
                
                return {
                    "execution_rate_per_min": round(exec_rate_per_min, 2),
                    "p50_confirmation_time": round(p50, 1),
                    "p95_confirmation_time": round(p95, 1),
                    "p99_confirmation_time": round(p99, 1),
                    "archive_growth_rate_mb_per_day": round(archive_growth_per_day, 2),
                    "database_health": health,
                    "database_size_mb": round(db_size, 2),
                }
        
        except Exception as e:
            logger.error(f"Failed to compute performance analytics: {e}")
            return {}
    
    def get_timeline_analytics(self, days: int = 7) -> list[dict[str, Any]]:
        """
        Get hourly aggregates for the last N days.
        
        Args:
            days: Number of days to look back (default 7)
            
        Returns:
            [
                {
                    "hour": "2026-03-08T14:00:00Z",
                    "executions": 42,
                    "confirmed": 40,
                    "failed": 2,
                    "success_rate": 0.952
                }
            ]
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
                
                # Group by hour
                cursor = conn.execute("""
                    SELECT
                        strftime('%Y-%m-%dT%H:00:00Z', created_at) as hour,
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                    FROM executions
                    WHERE created_at >= ?
                    GROUP BY hour
                    ORDER BY hour DESC
                """, (cutoff,))
                
                timeline = []
                for row in cursor.fetchall():
                    total = row["total"] or 0
                    confirmed = row["confirmed"] or 0
                    
                    timeline.append({
                        "hour": row["hour"],
                        "executions": total,
                        "confirmed": confirmed,
                        "failed": row["failed"] or 0,
                        "success_rate": confirmed / total if total > 0 else 0,
                    })
                
                return timeline
        
        except Exception as e:
            logger.error(f"Failed to compute timeline analytics: {e}")
            return []


# Singleton
_analytics_service: Optional[AnalyticsService] = None


def get_analytics_service(db_path: str = "backend/data/executions.db") -> AnalyticsService:
    """Get or create singleton analytics service."""
    global _analytics_service
    if _analytics_service is None:
        _analytics_service = AnalyticsService(db_path=db_path)
    return _analytics_service
