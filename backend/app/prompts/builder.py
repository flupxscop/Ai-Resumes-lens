"""Reusable provider-neutral prompt strategies and their factory."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod

from app.models import PromptRequest, PromptResponse, PromptType


OUTPUT_CONTRACT = {
    "overall_summary": "string",
    "strengths": ["string"],
    "weaknesses": ["string"],
    "recommendations": ["string"],
    "keyword_suggestions": ["string"],
    "resume_rewrite_suggestions": ["string"],
    "missing_skills": ["string"],
    "interview_preparation": ["string"],
}


class PromptStrategy(ABC):
    """Builds a task-specific prompt from an application-level request."""

    prompt_type: PromptType

    def build(self, request: PromptRequest) -> PromptResponse:
        if request.prompt_type is not self.prompt_type:
            raise ValueError(f"Expected {self.prompt_type.value} request")
        return PromptResponse(
            prompt_type=self.prompt_type,
            system_prompt=self.system_prompt(),
            user_prompt=self.user_prompt(request),
        )

    @staticmethod
    def system_prompt() -> str:
        return (
            "You are an expert career coach and ATS specialist. Be precise, constructive, "
            "and truthful. Do not invent qualifications. Return only one valid JSON object with "
            "exactly the following feedback fields. Never return parsed-resume fields such as "
            "name, title, experience, education, or projects. Every field must exist. Never list "
            "a skill as missing if it appears in the parsed resume. Make recommendations specific "
            "to the supplied job description and resume evidence. You must provide at least two "
            "specific items in strengths, weaknesses, recommendations, keyword_suggestions, "
            "resume_rewrite_suggestions, and interview_preparation; do not return empty arrays "
            "for these six fields: "
            f"{json.dumps(OUTPUT_CONTRACT)}"
        )

    @abstractmethod
    def user_prompt(self, request: PromptRequest) -> str:
        """Build task-specific user content."""

    @staticmethod
    def context(request: PromptRequest) -> str:
        return (
            f"Job description:\n{request.job_description}\n\n"
            f"Parsed resume:\n{request.resume.model_dump_json(indent=2)}\n\n"
            f"ATS analysis:\n{request.ats_result.model_dump_json(indent=2)}\n\n"
            f"Additional context:\n{request.additional_context or 'None'}"
        )


class ResumeReviewPromptStrategy(PromptStrategy):
    prompt_type = PromptType.RESUME_REVIEW

    def user_prompt(self, request: PromptRequest) -> str:
        return (
            "Review this resume against the job description. Prioritize ATS alignment, factual "
            "resume rewrites, missing skills, and the most impactful next actions.\n\n"
            + self.context(request)
        )


class CoverLetterPromptStrategy(PromptStrategy):
    prompt_type = PromptType.COVER_LETTER

    def user_prompt(self, request: PromptRequest) -> str:
        return (
            "Create a tailored cover-letter plan grounded only in the supplied resume. In "
            "resume_rewrite_suggestions, provide a concise draft outline and evidence to use.\n\n"
            + self.context(request)
        )


class InterviewPromptStrategy(PromptStrategy):
    prompt_type = PromptType.INTERVIEW_PREP

    def user_prompt(self, request: PromptRequest) -> str:
        return (
            "Prepare the candidate for interviews for this role. Put likely interview questions, "
            "STAR-story angles, and knowledge gaps in interview_preparation.\n\n"
            + self.context(request)
        )


class CareerAdvicePromptStrategy(PromptStrategy):
    prompt_type = PromptType.CAREER_ADVICE

    def user_prompt(self, request: PromptRequest) -> str:
        return (
            "Provide practical career advice based on the candidate's current profile and target "
            "role. Recommend a prioritized, realistic growth plan.\n\n"
            + self.context(request)
        )


class PromptStrategyFactory:
    """Factory that resolves prompt strategies without service-level branching."""

    def __init__(self, strategies: list[PromptStrategy] | None = None) -> None:
        registered = strategies or [
            ResumeReviewPromptStrategy(),
            CoverLetterPromptStrategy(),
            InterviewPromptStrategy(),
            CareerAdvicePromptStrategy(),
        ]
        self._strategies = {strategy.prompt_type: strategy for strategy in registered}

    def get(self, prompt_type: PromptType) -> PromptStrategy:
        try:
            return self._strategies[prompt_type]
        except KeyError as exc:
            raise ValueError(f"No prompt strategy registered for {prompt_type.value}") from exc

    def build(self, request: PromptRequest) -> PromptResponse:
        return self.get(request.prompt_type).build(request)
