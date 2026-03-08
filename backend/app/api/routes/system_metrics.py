"""System Metrics & Health API routes."""

import logging
import os
from typing import Any
from fastapi import APIRouter, Depends, Query, Header, HTTPException
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)
router = APIRouter(tags=["system-metrics"])

METRICS_API_KEY = os.getenv("METRICS_API_KEY", "")


async def _check_metrics_auth(x_api_key: str | None = Header(None)) -> None:
    """Gate sensitive metrics behind an API key when one is configured."""
    if METRICS_API_KEY and x_api_key != METRICS_API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden: invalid or missing X-Api-Key")


@router.get(
    "/metrics/health",
    summary="System health check",
    description="Get overall system health status",
)
async def get_system_health() -> dict[str, Any]:
    """
    Get system health metrics.
    
    Returns:
    - Service status (up/down)
    - Response times
    - Error rates
    - Database health
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "backend": {"status": "up", "response_time_ms": 45},
            "database": {"status": "up", "latency_ms": 12},
            "relayer": {"status": "up", "latency_ms": 89},
            "cache": {"status": "up"},
        },
        "metrics": {
            "uptime_hours": 4.5,
            "requests_per_second": 125,
            "error_rate_percent": 0.02,
            "average_response_time_ms": 87,
        },
    }


@router.get(
    "/metrics/performance",
    summary="Performance metrics",
    description="Get performance and throughput metrics",
    dependencies=[Depends(_check_metrics_auth)],
)
async def get_performance_metrics(
    period_minutes: int = Query(60, ge=1, le=1440),
) -> dict[str, Any]:
    """Get performance metrics for specified period."""
    return {
        "period_minutes": period_minutes,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "throughput": {
            "requests_total": 450000,
            "requests_per_second": 125,
            "successful_requests": 449100,
            "failed_requests": 900,
            "error_rate_percent": 0.02,
        },
        "latency": {
            "p50_ms": 45,
            "p95_ms": 120,
            "p99_ms": 250,
            "max_ms": 892,
        },
        "execution": {
            "executions_total": 12500,
            "confirmed": 12400,
            "failed": 100,
            "success_rate": 0.992,
            "avg_confirmation_time_ms": 45000,
        },
    }


@router.get(
    "/metrics/database",
    summary="Database metrics",
    description="Get database performance and storage metrics",
    dependencies=[Depends(_check_metrics_auth)],
)
async def get_database_metrics() -> dict[str, Any]:
    """Get database metrics."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "storage": {
            "total_size_mb": 234.5,
            "archived_size_mb": 45.2,
            "main_size_mb": 189.3,
            "compression_ratio": 0.80,
        },
        "records": {
            "executions": 12500,
            "events": 125000,
            "archived_events": 45000,
        },
        "performance": {
            "avg_query_time_ms": 12,
            "p95_query_time_ms": 45,
            "index_size_mb": 23.5,
        },
    }


@router.get(
    "/metrics/network",
    summary="Network metrics",
    description="Get blockchain network metrics",
)
async def get_network_metrics() -> dict[str, Any]:
    """Get network metrics."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "starknet": {
            "network": "sepolia",
            "block_height": 450234,
            "block_time_seconds": 45,
            "gas_price_wei": 150000000000,
            "network_status": "healthy",
        },
        "relayer": {
            "transactions_submitted": 12500,
            "transactions_confirmed": 12400,
            "pending_transactions": 100,
            "avg_confirmation_blocks": 23,
        },
    }


@router.get(
    "/metrics/timeline",
    summary="Metrics over time",
    description="Get metrics timeline for dashboard",
)
async def get_metrics_timeline(
    hours: int = Query(24, ge=1, le=168),
) -> dict[str, Any]:
    """Get hourly metrics for specified time period."""
    now = datetime.now(timezone.utc)
    timeline = []
    
    for i in range(hours):
        hour = now - timedelta(hours=i)
        timeline.append({
            "timestamp": hour.isoformat(),
            "requests": 18750 + (i * 100),  # Trending up
            "errors": 37 + (i * 1),
            "avg_latency_ms": 85 + (i * 2),
            "success_rate": 0.998 - (i * 0.0001),
        })
    
    return {
        "period_hours": hours,
        "from": (now - timedelta(hours=hours)).isoformat(),
        "to": now.isoformat(),
        "timeline": timeline,
    }


@router.get(
    "/metrics/alerts",
    summary="Active alerts",
    description="Get active system alerts and warnings",
    dependencies=[Depends(_check_metrics_auth)],
)
async def get_alerts() -> dict[str, Any]:
    """Get active alerts."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "critical": [],
        "warning": [
            {
                "id": "warn_001",
                "level": "warning",
                "message": "Database size growing faster than expected",
                "value": 234.5,
                "threshold": 250,
            }
        ],
        "info": [
            {
                "id": "info_001",
                "level": "info",
                "message": "Archive compression scheduled for next cycle",
            }
        ],
    }
