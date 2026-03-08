"""
Circuit breaker + retry utilities for external API calls.

Circuit breaker prevents cascading failures when an external service is down.
Retry with exponential backoff handles transient failures.
"""

import asyncio
import time
import logging
from enum import Enum
from typing import Any, Callable, Awaitable, TypeVar
from functools import wraps

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(Enum):
    CLOSED = "closed"        # Normal operation
    OPEN = "open"            # Failing, reject all calls
    HALF_OPEN = "half_open"  # Testing recovery


class CircuitBreakerError(Exception):
    """Raised when circuit breaker is open."""
    pass


class CircuitBreaker:
    """
    Async circuit breaker.

    - CLOSED: calls flow normally. After `fail_threshold` consecutive failures,
      transitions to OPEN.
    - OPEN: all calls immediately raise CircuitBreakerError. After `reset_timeout`
      seconds, transitions to HALF_OPEN.
    - HALF_OPEN: next call is allowed through. If it succeeds, transitions to CLOSED.
      If it fails, transitions back to OPEN.
    """

    def __init__(
        self,
        name: str = "default",
        fail_threshold: int = 5,
        reset_timeout: int = 60,
    ) -> None:
        self.name = name
        self.fail_threshold = fail_threshold
        self.reset_timeout = reset_timeout
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float = 0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._last_failure_time >= self.reset_timeout:
                return CircuitState.HALF_OPEN
        return self._state

    async def call(self, func: Callable[..., Awaitable[T]], *args: Any, **kwargs: Any) -> T:
        async with self._lock:
            current_state = self.state

            if current_state == CircuitState.OPEN:
                raise CircuitBreakerError(
                    f"Circuit breaker '{self.name}' is OPEN. "
                    f"Retry after {self.reset_timeout}s"
                )

        try:
            result = await func(*args, **kwargs)
            await self._on_success()
            return result
        except CircuitBreakerError:
            raise
        except Exception as e:
            await self._on_failure()
            raise

    async def _on_success(self) -> None:
        async with self._lock:
            self._failure_count = 0
            if self._state != CircuitState.CLOSED:
                logger.info("Circuit breaker '%s' recovered -> CLOSED", self.name)
            self._state = CircuitState.CLOSED

    async def _on_failure(self) -> None:
        async with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.monotonic()

            if self._failure_count >= self.fail_threshold:
                self._state = CircuitState.OPEN
                logger.warning(
                    "Circuit breaker '%s' tripped -> OPEN after %d failures",
                    self.name, self._failure_count,
                )

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self._failure_count,
            "fail_threshold": self.fail_threshold,
            "reset_timeout": self.reset_timeout,
        }


async def retry_with_backoff(
    func: Callable[..., Awaitable[T]],
    *args: Any,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    **kwargs: Any,
) -> T:
    """
    Retry an async function with exponential backoff.

    Retries on any exception except CircuitBreakerError.
    """
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except CircuitBreakerError:
            raise
        except Exception as e:
            last_exception = e
            if attempt < max_retries:
                delay = min(base_delay * (backoff_factor ** attempt), max_delay)
                logger.warning(
                    "Retry %d/%d for %s after %.1fs: %s",
                    attempt + 1, max_retries, func.__name__, delay, e,
                )
                await asyncio.sleep(delay)

    raise last_exception  # type: ignore[misc]


# Pre-configured circuit breakers for different services
ekubo_breaker = CircuitBreaker(name="ekubo", fail_threshold=5, reset_timeout=60)
starknet_rpc_breaker = CircuitBreaker(name="starknet_rpc", fail_threshold=3, reset_timeout=30)
market_data_breaker = CircuitBreaker(name="market_data", fail_threshold=5, reset_timeout=60)
