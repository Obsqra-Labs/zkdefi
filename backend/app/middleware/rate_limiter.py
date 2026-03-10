"""
In-memory rate limiter middleware for FastAPI.

Uses a sliding window counter per IP + path. No Redis dependency.
Thread-safe via asyncio lock.
"""

import asyncio
import time
import logging
from collections import defaultdict
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

_RATE_LIMITS: dict[str, tuple[int, int]] = {
    "/api/v1/zkdefi/privacy/vault/deposit": (10, 60),
    "/api/v1/zkdefi/privacy/vault/withdraw": (10, 60),
    "/api/v1/zkdefi/credit/lines/open": (5, 60),
    "/api/v1/zkdefi/collateral/deposit": (10, 60),
    "/api/v1/zkdefi/collateral/withdraw": (10, 60),
    "/api/v1/zkdefi/collateral/liquidate": (3, 60),
    "/api/v1/zkdefi/batch/verify": (20, 60),
    "/api/v1/zkdefi/trade-desk/v2/execute/submit": (10, 60),
    "/api/v1/zkdefi/trade-desk/v2/execute/simulate": (30, 60),
    "/api/v1/zkdefi/trade-desk/v2/execute/prepare": (20, 60),
    "/api/v1/zkdefi/dao/vote/cast": (5, 60),
    "/api/v1/zkdefi/dao/proposals": (10, 60),
    "/api/v1/zkdefi/lending/supply/calldata": (10, 60),
    "/api/v1/zkdefi/lending/borrow/calldata": (10, 60),
}

_DEFAULT_LIMIT = (60, 60)


class _SlidingWindowCounter:
    """Per-key sliding window rate counter."""

    __slots__ = ("_windows", "_lock")

    def __init__(self) -> None:
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds

        async with self._lock:
            timestamps = self._windows[key]
            self._windows[key] = [t for t in timestamps if t > cutoff]

            if len(self._windows[key]) >= max_requests:
                return False

            self._windows[key].append(now)
            return True

    async def cleanup(self, max_age: int = 300) -> int:
        now = time.monotonic()
        cutoff = now - max_age
        removed = 0
        async with self._lock:
            stale_keys = [k for k, v in self._windows.items() if all(t < cutoff for t in v)]
            for k in stale_keys:
                del self._windows[k]
                removed += 1
        return removed


_counter = _SlidingWindowCounter()


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    return f"{ip}:{request.url.path}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Applies per-IP rate limits on configured paths."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        max_requests, window = _DEFAULT_LIMIT
        for prefix, limits in _RATE_LIMITS.items():
            if path.startswith(prefix):
                max_requests, window = limits
                break

        key = _client_key(request)
        allowed = await _counter.is_allowed(key, max_requests, window)

        if not allowed:
            logger.warning("Rate limited: %s", key)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please try again later.",
                    "retry_after_seconds": window,
                },
                headers={"Retry-After": str(window)},
            )

        return await call_next(request)
