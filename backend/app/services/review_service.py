"""Application use case coordinating the complete AI resume-review pipeline."""

from __future__ import annotations

from app.ai import AIProviderFactory
from app.ats import ATSScoringEngine
from app.core.config import ProviderName, Settings
from app.models import FeedbackSchema, PromptRequest, PromptType, ProviderRequest, ReviewResult
from app.parser import ResumeDocument, ResumeParser
from app.prompts import PromptStrategyFactory
from app.response import FeedbackParseError, ResponseParser


class ResumeReviewService:
    """Dependency-injected application service with no HTTP or vendor logic."""

    def __init__(
        self,
        settings: Settings,
        resume_parser: ResumeParser,
        ats_engine: ATSScoringEngine,
        prompt_factory: PromptStrategyFactory,
        provider_factory: AIProviderFactory,
        response_parser: ResponseParser,
    ) -> None:
        self._settings = settings
        self._resume_parser = resume_parser
        self._ats_engine = ats_engine
        self._prompt_factory = prompt_factory
        self._provider_factory = provider_factory
        self._response_parser = response_parser

    async def review(
        self,
        document: ResumeDocument,
        job_description: str,
        prompt_type: PromptType = PromptType.RESUME_REVIEW,
        provider_name: ProviderName | None = None,
        model: str | None = None,
        additional_context: str | None = None,
    ) -> ReviewResult:
        """Execute parse → ATS → prompt → provider → normalization end-to-end."""
        resume = await self._resume_parser.parse(document)
        ats_result = await self._ats_engine.score(resume, job_description)
        prompt = self._prompt_factory.build(
            PromptRequest(
                prompt_type=prompt_type,
                resume=resume,
                ats_result=ats_result,
                job_description=job_description,
                additional_context=additional_context,
            )
        )
        selected_provider = provider_name or self._settings.ai_provider
        provider = self._provider_factory.create(selected_provider)
        try:
            provider_response = await provider.generate_feedback(
                ProviderRequest(
                    provider=selected_provider,
                    system_prompt=prompt.system_prompt,
                    user_prompt=prompt.user_prompt,
                    model=model,
                    temperature=0.0,
                    response_schema=FeedbackSchema.model_json_schema(),
                )
            )
            try:
                feedback = self._response_parser.parse(provider_response)
            except FeedbackParseError:
                repair_system_prompt, repair_user_prompt = self._response_parser.build_repair_prompt(
                    provider_response.content,
                    prompt.system_prompt,
                    prompt.user_prompt,
                )
                provider_response = await provider.generate_feedback(
                    ProviderRequest(
                        provider=selected_provider,
                        system_prompt=repair_system_prompt,
                        user_prompt=repair_user_prompt,
                    model=model,
                    temperature=0.0,
                    response_schema=FeedbackSchema.model_json_schema(),
                    )
                )
                feedback = self._response_parser.parse(provider_response)
            feedback = self._response_parser.remove_present_skills(feedback, resume)
        finally:
            await provider.aclose()
        return ReviewResult(
            resume=resume,
            ats_result=ats_result,
            feedback=feedback,
            provider_response=provider_response,
        )
