"""
Request timing and observability middleware.

Logs request duration, status code, path, and method for every request.
Exposes /api/v1/zkdefi/metrics/internal for live latency percentiles.
"""

import time
import logging
from collections import deque
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

_REQUEST_LOG: deque[dict] = deque(maxlen=10000)


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Logs request timing and collects latency data."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000

        path = request.url.path
        method = request.method
        status = response.status_code

        entry = {
            "path": path,
            "method": method,
            "status": status,
            "duration_ms": round(duration_ms, 2),
            "ts": time.time(),
        }
        _REQUEST_LOG.append(entry)

        if duration_ms > 500:
            logger.warning(
                "SLOW %s %s -> %d (%.0fms)", method, path, status, duration_ms
            )
        elif status >= 500:
            logger.error(
                "ERROR %s %s -> %d (%.0fms)", method, path, status, duration_ms
            )

        response.headers["X-Response-Time-Ms"] = str(round(duration_ms, 1))
        return response


def get_latency_percentiles(last_n: int = 1000) -> dict:
    """Compute latency percentiles from recent requests."""
    entries = list(_REQUEST_LOG)[-last_n:]
    if not entries:
        return {"p50": 0, "p95": 0, "p99": 0, "count": 0}

    durations = sorted(e["duration_ms"] for e in entries)
    n = len(durations)

    return {
        "p50": durations[int(n * 0.5)] if n > 0 else 0,
        "p95": durations[int(n * 0.95)] if n > 1 else durations[-1],
        "p99": durations[int(n * 0.99)] if n > 1 else durations[-1],
        "count": n,
        "avg": round(sum(durations) / n, 2),
        "max": durations[-1],
        "error_count": sum(1 for e in entries if e["status"] >= 400),
        "error_rate": round(sum(1 for e in entries if e["status"] >= 400) / n, 4),
    }


def get_path_stats(last_n: int = 5000) -> list[dict]:
    """Get per-path statistics from recent requests."""
    entries = list(_REQUEST_LOG)[-last_n:]
    path_data: dict[str, list[float]] = {}

    for e in entries:
        path_data.setdefault(e["path"], []).append(e["duration_ms"])

    stats = []
    for path, durations in sorted(path_data.items(), key=lambda x: -len(x[1])):
        sorted_d = sorted(durations)
        n = len(sorted_d)
        stats.append({
            "path": path,
            "count": n,
            "avg_ms": round(sum(sorted_d) / n, 1),
            "p95_ms": sorted_d[int(n * 0.95)] if n > 1 else sorted_d[-1],
            "max_ms": sorted_d[-1],
        })

    return stats[:20]
