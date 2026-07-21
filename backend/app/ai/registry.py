from __future__ import annotations

from collections.abc import Callable

from app.ai.provider import AIProvider
from app.core.config import ProviderName, Settings
from app.repositories import CacheRepository
from app.models import ProviderResponse


ProviderBuilder = Callable[[Settings, CacheRepository[ProviderResponse]], AIProvider]


class ProviderRegistry:

    def __init__(self) -> None:
        self._builders: dict[ProviderName, ProviderBuilder] = {}

    def register(self, name: ProviderName, builder: ProviderBuilder) -> None:
        if name in self._builders:
            raise ValueError(f"Provider already registered: {name.value}")
        self._builders[name] = builder

    @property
    def names(self) -> frozenset[ProviderName]:
        """Return registered provider identifiers without exposing registry internals."""
        return frozenset(self._builders)

    def create(
        self,
        name: ProviderName,
        settings: Settings,
        cache: CacheRepository[ProviderResponse],
    ) -> AIProvider:
        try:
            return self._builders[name](settings, cache)
        except KeyError as exc:
            raise ValueError(f"No provider registered for: {name.value}") from exc


class AIProviderFactory:

    def __init__(
        self,
        settings: Settings,
        cache: CacheRepository[ProviderResponse],
        registry: ProviderRegistry,
    ) -> None:
        self._settings = settings
        self._cache = cache
        self._registry = registry

    def create(self, name: ProviderName | None = None) -> AIProvider:
        return self._registry.create(name or self._settings.ai_provider, self._settings, self._cache)
