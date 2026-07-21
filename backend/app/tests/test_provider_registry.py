"""Tests for provider registration."""

from app.ai.providers import build_default_registry
from app.core.config import ProviderName


def test_default_registry_has_every_configured_provider() -> None:
    registry = build_default_registry()
    assert registry.names == frozenset(ProviderName)
