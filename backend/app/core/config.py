"""Environment-backed, dependency-injectable application settings."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache


class ProviderName(str, Enum):
    """Supported AI provider identifiers."""

    GEMINI = "gemini"
    OPENAI = "openai"
    CLAUDE = "claude"
    GROQ = "groq"
    DEEPSEEK = "deepseek"
    OLLAMA = "ollama"
    OPENROUTER = "openrouter"


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _positive_float(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


@dataclass(frozen=True)
class Settings:
    """Immutable runtime configuration loaded from environment variables."""

    ai_provider: ProviderName
    request_timeout_seconds: float
    max_retries: int
    retry_base_delay_seconds: float
    rate_limit_requests_per_minute: int
    cache_ttl_seconds: int
    log_level: str
    gemini_api_key: str | None
    openai_api_key: str | None
    claude_api_key: str | None
    groq_api_key: str | None
    deepseek_api_key: str | None
    openrouter_api_key: str | None
    ollama_base_url: str

    @classmethod
    def from_environment(cls) -> "Settings":
        """Create validated settings using environment variables and safe defaults."""
        provider_value = os.getenv("AI_PROVIDER", ProviderName.OPENAI.value).lower()
        try:
            provider = ProviderName(provider_value)
        except ValueError as exc:
            options = ", ".join(item.value for item in ProviderName)
            raise ValueError(f"AI_PROVIDER must be one of: {options}") from exc

        return cls(
            ai_provider=provider,
            request_timeout_seconds=_positive_float("REQUEST_TIMEOUT_SECONDS", 30.0),
            max_retries=_positive_int("MAX_RETRIES", 3),
            retry_base_delay_seconds=_positive_float("RETRY_BASE_DELAY_SECONDS", 0.5),
            rate_limit_requests_per_minute=_positive_int(
                "RATE_LIMIT_REQUESTS_PER_MINUTE", 60
            ),
            cache_ttl_seconds=_positive_int("CACHE_TTL_SECONDS", 3600),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
            gemini_api_key=os.getenv("GEMINI_API_KEY"),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            claude_api_key=os.getenv("ANTHROPIC_API_KEY"),
            groq_api_key=os.getenv("GROQ_API_KEY"),
            deepseek_api_key=os.getenv("DEEPSEEK_API_KEY"),
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        )

    def api_key_for(self, provider: ProviderName) -> str | None:
        """Return the configured API key for a remote provider."""
        keys = {
            ProviderName.GEMINI: self.gemini_api_key,
            ProviderName.OPENAI: self.openai_api_key,
            ProviderName.CLAUDE: self.claude_api_key,
            ProviderName.GROQ: self.groq_api_key,
            ProviderName.DEEPSEEK: self.deepseek_api_key,
            ProviderName.OPENROUTER: self.openrouter_api_key,
            ProviderName.OLLAMA: None,
        }
        return keys[provider]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance; easy to override in tests."""
    return Settings.from_environment()
