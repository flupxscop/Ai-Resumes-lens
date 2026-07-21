"""Tests for the asynchronous cache adapter."""

import asyncio

from app.repositories import InMemoryCacheRepository


def test_cache_stores_and_deletes_values() -> None:
    async def scenario() -> None:
        cache = InMemoryCacheRepository[str]()
        await cache.set("review:1", "value", 30)
        assert await cache.get("review:1") == "value"
        await cache.delete("review:1")
        assert await cache.get("review:1") is None

    asyncio.run(scenario())
