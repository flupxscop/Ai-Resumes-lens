"""Tests for Ollama native-to-compatible endpoint fallback."""

import asyncio
import json

import httpx

from app.ai.providers import OllamaProvider
from app.core.config import ProviderName, Settings
from app.models import ProviderRequest
from app.repositories import InMemoryCacheRepository


def test_ollama_provider_falls_back_to_openai_compatible_endpoint() -> None:
    async def scenario() -> None:
        requested_paths: list[str] = []
        request_bodies: list[dict[str, object]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            requested_paths.append(request.url.path)
            request_bodies.append(json.loads(request.content))
            if request.url.path == "/api/chat":
                return httpx.Response(404, request=request)
            return httpx.Response(
                200,
                request=request,
                json={
                    "choices": [{"message": {"content": '{"overall_summary":"ok"}'}}],
                    "usage": {"prompt_tokens": 3, "completion_tokens": 2},
                },
            )

        settings = Settings(
            ai_provider=ProviderName.OLLAMA,
            request_timeout_seconds=30,
            max_retries=1,
            retry_base_delay_seconds=0.1,
            rate_limit_requests_per_minute=60,
            cache_ttl_seconds=60,
            log_level="INFO",
            gemini_api_key=None,
            openai_api_key=None,
            claude_api_key=None,
            groq_api_key=None,
            deepseek_api_key=None,
            openrouter_api_key=None,
            ollama_base_url="http://ollama.test",
        )
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        provider = OllamaProvider(settings, InMemoryCacheRepository(), client)
        response = await provider.generate_feedback(
            ProviderRequest(
                provider=ProviderName.OLLAMA,
                system_prompt="system",
                user_prompt="user",
                response_schema={"type": "object", "properties": {"overall_summary": {"type": "string"}}},
            )
        )
        await client.aclose()

        assert requested_paths == ["/api/chat", "/v1/chat/completions"]
        assert request_bodies[0]["format"] == {
            "type": "object", "properties": {"overall_summary": {"type": "string"}}
        }
        assert request_bodies[1]["response_format"]["type"] == "json_schema"
        assert response.content == '{"overall_summary":"ok"}'

    asyncio.run(scenario())
