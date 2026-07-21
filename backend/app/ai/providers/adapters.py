from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.ai.provider import (
    HttpAIProvider,
    ProviderError,
    ProviderNotFoundError,
    ProviderResponseError,
    TransientProviderError,
)
from app.core.config import ProviderName
from app.models import ProviderRequest, ProviderResponse, TokenUsage


def _usage(payload: dict[str, Any], input_key: str = "prompt_tokens", output_key: str = "completion_tokens") -> TokenUsage:
    usage = payload.get("usage", {})
    return TokenUsage.from_counts(int(usage.get(input_key, 0)), int(usage.get(output_key, 0)))


class OpenAICompatibleProvider(HttpAIProvider):
    """Shared adapter implementation for Chat Completions-compatible APIs."""

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key()}", "Content-Type": "application/json"}

    def _payload(self, request: ProviderRequest, model: str) -> dict[str, Any]:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "response_format": {"type": "json_object"},
        }

    def _extract_response(self, payload: dict[str, Any]) -> tuple[str, TokenUsage]:
        content = payload["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            raise ProviderResponseError("Provider returned non-text chat content")
        return content, _usage(payload)


class OpenAIProvider(HttpAIProvider):
    name = ProviderName.OPENAI
    endpoint = "https://api.openai.com/v1/responses"
    default_model = "gpt-5"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key()}", "Content-Type": "application/json"}

    def _payload(self, request: ProviderRequest, model: str) -> dict[str, Any]:
        return {
            "model": model,
            "input": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
            "temperature": request.temperature,
            "max_output_tokens": request.max_tokens,
            "store": False,
        }

    def _extract_response(self, payload: dict[str, Any]) -> tuple[str, TokenUsage]:
        if isinstance(payload.get("output_text"), str):
            content = payload["output_text"]
        else:
            content = next(
                item["text"]
                for output in payload["output"]
                for item in output.get("content", [])
                if item.get("type") == "output_text"
            )
        usage = payload.get("usage", {})
        return content, TokenUsage.from_counts(
            int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        )


class GroqProvider(OpenAICompatibleProvider):
    name = ProviderName.GROQ
    endpoint = "https://api.groq.com/openai/v1/chat/completions"
    default_model = "llama-3.3-70b-versatile"


class DeepSeekProvider(OpenAICompatibleProvider):
    name = ProviderName.DEEPSEEK
    endpoint = "https://api.deepseek.com/chat/completions"
    default_model = "deepseek-chat"


class OpenRouterProvider(OpenAICompatibleProvider):
    name = ProviderName.OPENROUTER
    endpoint = "https://openrouter.ai/api/v1/chat/completions"
    default_model = "openai/gpt-4o-mini"

    def _headers(self) -> dict[str, str]:
        headers = super()._headers()
        headers["HTTP-Referer"] = "https://resume-reviewer.local"
        headers["X-Title"] = "AI Resume Reviewer"
        return headers


class ClaudeProvider(HttpAIProvider):
    name = ProviderName.CLAUDE
    endpoint = "https://api.anthropic.com/v1/messages"
    default_model = "claude-3-5-sonnet-latest"

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self._api_key(),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _payload(self, request: ProviderRequest, model: str) -> dict[str, Any]:
        return {
            "model": model,
            "system": request.system_prompt,
            "messages": [{"role": "user", "content": request.user_prompt}],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }

    def _extract_response(self, payload: dict[str, Any]) -> tuple[str, TokenUsage]:
        content = "".join(item["text"] for item in payload["content"] if item["type"] == "text")
        usage = payload.get("usage", {})
        return content, TokenUsage.from_counts(
            int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        )


class GeminiProvider(HttpAIProvider):
    name = ProviderName.GEMINI
    default_model = "gemini-2.5-flash"
    endpoint = ""

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    def _payload(self, request: ProviderRequest, model: str) -> dict[str, Any]:
        return {
            "systemInstruction": {"parts": [{"text": request.system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": request.user_prompt}]}],
            "generationConfig": {"temperature": request.temperature, "maxOutputTokens": request.max_tokens, "responseMimeType": "application/json"},
        }

    def _endpoint_for_model(self, model: str) -> str:
        return (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{quote(model)}:generateContent?key={quote(self._api_key())}"
        )

    def _extract_response(self, payload: dict[str, Any]) -> tuple[str, TokenUsage]:
        content = payload["candidates"][0]["content"]["parts"][0]["text"]
        usage = payload.get("usageMetadata", {})
        return content, TokenUsage.from_counts(
            int(usage.get("promptTokenCount", 0)), int(usage.get("candidatesTokenCount", 0))
        )


class OllamaProvider(HttpAIProvider):
    name = ProviderName.OLLAMA
    default_model = "llama3.2"
    endpoint = ""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.endpoint = f"{self._settings.ollama_base_url.rstrip('/')}/api/chat"

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    def _payload(self, request: ProviderRequest, model: str) -> dict[str, Any]:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
            "stream": False,
            "format": request.response_schema or "json",
            "options": {"temperature": request.temperature, "num_predict": request.max_tokens},
        }

    def _extract_response(self, payload: dict[str, Any]) -> tuple[str, TokenUsage]:
        content = payload["message"]["content"]
        return content, TokenUsage.from_counts(
            int(payload.get("prompt_eval_count", 0)), int(payload.get("eval_count", 0))
        )

    async def _invoke(self, request: ProviderRequest) -> ProviderResponse:
        """Use native Ollama first, then its OpenAI-compatible endpoint on a 404."""
        try:
            return await super()._invoke(request)
        except ProviderNotFoundError:
            return await self._invoke_openai_compatible(request)

    async def _invoke_openai_compatible(self, request: ProviderRequest) -> ProviderResponse:
        model = request.model or self.default_model
        endpoint = f"{self._settings.ollama_base_url.rstrip('/')}/v1/chat/completions"
        response = await self._client.post(
            endpoint,
            headers={"Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": request.system_prompt},
                    {"role": "user", "content": request.user_prompt},
                ],
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
                "response_format": (
                    {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "resume_feedback",
                            "schema": request.response_schema,
                            "strict": True,
                        },
                    }
                    if request.response_schema
                    else {"type": "json_object"}
                ),
            },
        )
        if response.status_code in {408, 409, 425, 429} or response.status_code >= 500:
            raise TransientProviderError(
                f"Ollama compatibility endpoint temporarily failed with status {response.status_code}"
            )
        if response.is_error:
            raise ProviderError(
                f"Ollama compatibility endpoint failed with status {response.status_code}"
            )
        try:
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
        except (ValueError, KeyError, TypeError, IndexError) as exc:
            raise ProviderResponseError("Unable to parse Ollama compatibility response") from exc
        if not isinstance(content, str):
            raise ProviderResponseError("Ollama compatibility endpoint returned non-text content")
        return ProviderResponse(
            provider=self.name,
            model=model,
            content=content,
            usage=_usage(payload),
            raw_response=payload,
        )
