"""
Advanced analytics API endpoints for Phase 4.

Provides dashboard endpoints for system metrics, performance insights, and trending data.
"""

from fastapi import APIRouter, Query
from typing import Any

from app.services.analytics_service import get_analytics_service

router = APIRouter(tags=["analytics"])


@router.get("/api/v1/zkdefi/oracle/analytics/summary")
async def get_analytics_summary() -> dict[str, Any]:
    """
    Get comprehensive system analytics summary.
    
    Includes:
    - Total and time-period execution counts
    - Overall and 24h success rates
    - Average confirmation times
    - Top adapters by volume
    - Error distribution
    
    Returns:
        {
            "total_executions": 5234,
            "executions_24h": 234,
            "executions_7d": 1200,
            "success_rate": 0.967,
            "success_rate_24h": 0.95,
            "avg_confirmation_time_seconds": 45.3,
            "top_adapters": [
                {"adapter": "ekubo", "count": 1200, "success_rate": 0.98}
            ],
            "error_distribution": [
                {"error": "timeout", "count": 50}
            ]
        }
    """
    service = get_analytics_service()
    return service.get_summary_analytics()


@router.get("/api/v1/zkdefi/oracle/analytics/performance")
async def get_performance_analytics() -> dict[str, Any]:
    """
    Get performance metrics and system health.
    
    Includes:
    - Execution rate (executions per minute)
    - Confirmation time percentiles (P50/P95/P99)
    - Archive growth rate
    - Database health status
    
    Returns:
        {
            "execution_rate_per_min": 2.3,
            "p50_confirmation_time": 35.2,
            "p95_confirmation_time": 120.5,
            "p99_confirmation_time": 250.8,
            "archive_growth_rate_mb_per_day": 5.2,
            "database_health": "healthy|warning|critical",
            "database_size_mb": 145.3
        }
    """
    service = get_analytics_service()
    return service.get_performance_analytics()


@router.get("/api/v1/zkdefi/oracle/analytics/timeline")
async def get_timeline_analytics(days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
    """
    Get hourly aggregates for trending and visualization.
    
    Args:
        days: Number of days to look back (1-90, default 7)
    
    Returns:
        {
            "timeline": [
                {
                    "hour": "2026-03-08T14:00:00Z",
                    "executions": 42,
                    "confirmed": 40,
                    "failed": 2,
                    "success_rate": 0.952
                }
            ],
            "period_days": 7
        }
    """
    service = get_analytics_service()
    timeline = service.get_timeline_analytics(days=days)
    
    return {
        "timeline": timeline,
        "period_days": days,
        "data_points": len(timeline),
    }
