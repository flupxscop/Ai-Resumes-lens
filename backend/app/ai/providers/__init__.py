"""Concrete provider adapters and the standard provider registry."""

from app.ai.providers.adapters import (
    ClaudeProvider,
    DeepSeekProvider,
    GeminiProvider,
    GroqProvider,
    OllamaProvider,
    OpenAIProvider,
    OpenRouterProvider,
)
from app.ai.registry import ProviderRegistry
from app.core.config import ProviderName


def build_default_registry() -> ProviderRegistry:
    """Return a registry containing every supported provider adapter."""
    registry = ProviderRegistry()
    registry.register(ProviderName.GEMINI, GeminiProvider)
    registry.register(ProviderName.OPENAI, OpenAIProvider)
    registry.register(ProviderName.CLAUDE, ClaudeProvider)
    registry.register(ProviderName.GROQ, GroqProvider)
    registry.register(ProviderName.DEEPSEEK, DeepSeekProvider)
    registry.register(ProviderName.OLLAMA, OllamaProvider)
    registry.register(ProviderName.OPENROUTER, OpenRouterProvider)
    return registry


__all__ = [
    "ClaudeProvider", "DeepSeekProvider", "GeminiProvider", "GroqProvider", "OllamaProvider",
    "OpenAIProvider", "OpenRouterProvider", "build_default_registry",
]
