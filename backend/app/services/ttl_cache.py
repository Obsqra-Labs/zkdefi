"""
In-memory TTL cache for API responses.

Provides a simple async-safe cache with per-key TTL, automatic cleanup,
and hit/miss tracking. No Redis dependency.
"""

import asyncio
import time
import logging
from typing import Any, Callable, Awaitable, TypeVar
from functools import wraps

logger = logging.getLogger(__name__)

T = TypeVar("T")


class TTLCache:
    """Simple in-memory cache with per-key TTL and automatic eviction."""

    def __init__(self, default_ttl: int = 60, max_entries: int = 10000) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
        self._default_ttl = default_ttl
        self._max_entries = max_entries
        self._hits = 0
        self._misses = 0
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self._misses += 1
                return None

            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                self._misses += 1
                return None

            self._hits += 1
            return value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        async with self._lock:
            if len(self._store) >= self._max_entries:
                self._evict_expired()

            expires_at = time.monotonic() + (ttl or self._default_ttl)
            self._store[key] = (value, expires_at)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()

    def _evict_expired(self) -> None:
        now = time.monotonic()
        expired = [k for k, (_, exp) in self._store.items() if now > exp]
        for k in expired:
            del self._store[k]

    @property
    def stats(self) -> dict[str, Any]:
        total = self._hits + self._misses
        return {
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": self._hits / total if total > 0 else 0,
            "size": len(self._store),
        }


# Pre-configured caches for different data categories
fico_cache = TTLCache(default_ttl=86400, max_entries=5000)      # 24h for credit scores
market_cache = TTLCache(default_ttl=30, max_entries=200)        # 30s for market data
collateral_cache = TTLCache(default_ttl=300, max_entries=2000)  # 5min for collateral
opportunity_cache = TTLCache(default_ttl=30, max_entries=500)   # 30s for opportunities


def cached(cache: TTLCache, key_func: Callable[..., str], ttl: int | None = None):
    """Decorator to cache async function results."""
    def decorator(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            cache_key = key_func(*args, **kwargs)
            result = await cache.get(cache_key)
            if result is not None:
                return result

            result = await func(*args, **kwargs)
            await cache.set(cache_key, result, ttl)
            return result
        return wrapper
    return decorator
