"""Async cache repository abstraction and a concurrency-safe in-memory adapter."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from time import monotonic
from typing import Generic, TypeVar


T = TypeVar("T")


class CacheRepository(ABC, Generic[T]):
    """Port for cache storage; infrastructure adapters implement this contract."""

    @abstractmethod
    async def get(self, key: str) -> T | None:
        """Return an unexpired cached value or ``None`` when it is absent."""

    @abstractmethod
    async def set(self, key: str, value: T, ttl_seconds: int) -> None:
        """Store a value until its requested time-to-live expires."""

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Remove a cached value if it exists."""

    @abstractmethod
    async def clear(self) -> None:
        """Remove every cached value."""


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    expires_at: float


class InMemoryCacheRepository(CacheRepository[T]):
    """Process-local async TTL cache suitable for tests and single-instance deployments."""

    def __init__(self) -> None:
        self._entries: dict[str, _CacheEntry[T]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> T | None:
        async with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= monotonic():
                del self._entries[key]
                return None
            return entry.value

    async def set(self, key: str, value: T, ttl_seconds: int) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be greater than zero")
        async with self._lock:
            self._entries[key] = _CacheEntry(
                value=value,
                expires_at=monotonic() + ttl_seconds,
            )

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._entries.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._entries.clear()
