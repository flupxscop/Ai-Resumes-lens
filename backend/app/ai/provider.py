from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx

from app.core.config import ProviderName, Settings
from app.models import ProviderRequest, ProviderResponse, TokenUsage
from app.repositories import CacheRepository
from app.utils import AsyncRateLimiter, build_cache_key, retry_async


logger = logging.getLogger(__name__)


class ProviderError(RuntimeError):
    """Base error exposed by a provider adapter."""


class ProviderConfigurationError(ProviderError):
    """Raised when the selected provider has incomplete configuration."""


class ProviderResponseError(ProviderError):
    """Raised when a provider response cannot be normalized."""


class TransientProviderError(ProviderError):
    """Raised for retryable provider-side failures."""


class ProviderNotFoundError(ProviderError):
    """Raised when a provider does not expose the requested endpoint."""


class AIProvider(ABC):
    """Strategy port used by business services for AI feedback generation."""

    name: ProviderName

    @abstractmethod
    async def generate_feedback(self, request: ProviderRequest) -> ProviderResponse:
        """Generate raw provider feedback in the normalized provider-response contract."""

    @abstractmethod
    async def aclose(self) -> None:
        """Release resources owned by this provider."""


class HttpAIProvider(AIProvider):
    """Shared retrying, rate-limited, cached HTTP transport for provider adapters."""

    endpoint: str
    default_model: str

    def __init__(
        self,
        settings: Settings,
        cache: CacheRepository[ProviderResponse],
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._cache = cache
        self._client = client or httpx.AsyncClient(timeout=settings.request_timeout_seconds)
        self._owns_client = client is None
        self._rate_limiter = AsyncRateLimiter(settings.rate_limit_requests_per_minute)

    async def generate_feedback(self, request: ProviderRequest) -> ProviderResponse:
        if request.provider is not self.name:
            raise ProviderConfigurationError(
                f"{self.__class__.__name__} cannot handle {request.provider.value} requests"
            )
        cache_key = build_cache_key(
            f"provider:{self.name.value}", request.model_dump(mode="json")
        )
        cached = await self._cache.get(cache_key)
        if cached is not None:
            logger.info("provider_response_cache_hit", extra={"provider": self.name.value})
            return cached.model_copy(update={"cached": True})

        await self._rate_limiter.acquire()
        response = await retry_async(
            self._invoke,
            request,
            attempts=self._settings.max_retries,
            base_delay_seconds=self._settings.retry_base_delay_seconds,
            retryable_exceptions=(
                httpx.TimeoutException,
                httpx.NetworkError,
                TransientProviderError,
            ),
        )
        await self._cache.set(cache_key, response, self._settings.cache_ttl_seconds)
        return response

    async def _invoke(self, request: ProviderRequest) -> ProviderResponse:
        model = request.model or self.default_model
        try:
            response = await self._client.post(
                self._endpoint_for_model(model),
                headers=self._headers(),
                json=self._payload(request, model),
            )
        except httpx.HTTPError:
            logger.exception("provider_network_error", extra={"provider": self.name.value})
            raise

        if response.status_code in {408, 409, 425, 429} or response.status_code >= 500:
            raise TransientProviderError(
                f"{self.name.value} temporarily failed with status {response.status_code}"
            )
        if response.status_code == 404:
            raise ProviderNotFoundError(
                f"{self.name.value} endpoint was not found: {self._endpoint_for_model(model)}"
            )
        if response.is_error:
            raise ProviderError(f"{self.name.value} failed with status {response.status_code}")
        try:
            raw_response = response.json()
            content, usage = self._extract_response(raw_response)
        except (ValueError, KeyError, TypeError, IndexError) as exc:
            raise ProviderResponseError(
                f"Unable to parse {self.name.value} response"
            ) from exc
        logger.info("provider_response_generated", extra={"provider": self.name.value, "model": model})
        return ProviderResponse(
            provider=self.name,
            model=model,
            content=content,
            usage=usage,
            raw_response=raw_response,
        )

    def _endpoint_for_model(self, model: str) -> str:
        """Return the request endpoint; override when URLs include a model identifier."""
        return self.endpoint

    def _api_key(self) -> str:
        api_key = self._settings.api_key_for(self.name)
        if not api_key:
            raise ProviderConfigurationError(f"API key is required for {self.name.value}")
        return api_key

    @abstractmethod
    def _headers(self) -> dict[str, str]:
        """Build provider authentication and content-negotiation headers."""

    @abstractmethod
    def _payload(self, request: ProviderRequest, model: str) -> dict[str, Any]:
        """Translate the common request contract into a provider payload."""

    @abstractmethod
    def _extract_response(self, payload: dict[str, Any]) -> tuple[str, TokenUsage]:
        """Extract generated content and usage from a provider payload."""

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()
