"""Provider-agnostic async retry, rate-limit, and cache-key utilities."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections import deque
from collections.abc import Awaitable, Callable
from time import monotonic
from typing import Any, TypeVar


T = TypeVar("T")


class RateLimitExceededError(RuntimeError):
    """Raised when a caller cannot obtain a request slot in the allowed period."""


class AsyncRateLimiter:
    """Sliding-window limiter that waits asynchronously for available capacity."""

    def __init__(self, max_requests: int, period_seconds: float = 60.0) -> None:
        if max_requests <= 0:
            raise ValueError("max_requests must be greater than zero")
        if period_seconds <= 0:
            raise ValueError("period_seconds must be greater than zero")
        self._max_requests = max_requests
        self._period_seconds = period_seconds
        self._request_times: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Wait until a request can proceed without exceeding the configured limit."""
        while True:
            async with self._lock:
                now = monotonic()
                cutoff = now - self._period_seconds
                while self._request_times and self._request_times[0] <= cutoff:
                    self._request_times.popleft()
                if len(self._request_times) < self._max_requests:
                    self._request_times.append(now)
                    return
                wait_seconds = self._request_times[0] + self._period_seconds - now
            await asyncio.sleep(max(wait_seconds, 0.001))


async def retry_async(
    operation: Callable[..., Awaitable[T]],
    *args: Any,
    attempts: int,
    base_delay_seconds: float,
    retryable_exceptions: tuple[type[Exception], ...],
    **kwargs: Any,
) -> T:
    """Execute an async operation with exponential backoff for transient errors."""
    if attempts <= 0:
        raise ValueError("attempts must be greater than zero")
    if base_delay_seconds <= 0:
        raise ValueError("base_delay_seconds must be greater than zero")

    for attempt in range(attempts):
        try:
            return await operation(*args, **kwargs)
        except retryable_exceptions:
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(base_delay_seconds * (2**attempt))

    raise RuntimeError("retry loop exited unexpectedly")


def build_cache_key(namespace: str, payload: object) -> str:
    """Create a stable SHA-256 cache key from a JSON-serializable payload."""
    if not namespace.strip():
        raise ValueError("namespace cannot be empty")
    encoded_payload = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    digest = hashlib.sha256(encoded_payload).hexdigest()
    return f"{namespace}:{digest}"
