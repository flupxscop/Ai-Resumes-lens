from __future__ import annotations

from functools import lru_cache

from app.ai import AIProviderFactory
from app.ai.providers import build_default_registry
from app.ats import ATSScoringEngine
from app.core.config import get_settings
from app.models import ProviderResponse
from app.parser import ResumeParser
from app.prompts import PromptStrategyFactory
from app.repositories import InMemoryCacheRepository
from app.response import ResponseParser
from app.services import ResumeReviewService


@lru_cache(maxsize=1)
def get_provider_cache() -> InMemoryCacheRepository[ProviderResponse]:
    """Return the process-local provider-response cache."""
    return InMemoryCacheRepository()


@lru_cache(maxsize=1)
def get_provider_registry():
    """Return the standard registry; tests can replace this dependency."""
    return build_default_registry()


def get_review_service() -> ResumeReviewService:
    """Construct a use-case service with concrete production adapters."""
    settings = get_settings()
    return ResumeReviewService(
        settings=settings,
        resume_parser=ResumeParser(),
        ats_engine=ATSScoringEngine(),
        prompt_factory=PromptStrategyFactory(),
        provider_factory=AIProviderFactory(settings, get_provider_cache(), get_provider_registry()),
        response_parser=ResponseParser(),
    )
