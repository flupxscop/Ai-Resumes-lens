"""Typed, provider-neutral contracts shared across application layers."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from app.core.config import ProviderName


class Schema(BaseModel):
    """Base schema with strict input handling and whitespace normalization."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ContactSchema(Schema):
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: HttpUrl | None = None
    portfolio_url: HttpUrl | None = None


class EducationSchema(Schema):
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    grade: str | None = None


class ExperienceSchema(Schema):
    company: str
    title: str
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    description: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


class ProjectSchema(Schema):
    name: str
    description: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)
    url: HttpUrl | None = None


class CertificationSchema(Schema):
    name: str
    issuer: str | None = None
    issued_date: str | None = None
    credential_id: str | None = None


class ResumeSchema(Schema):
    """Normalized information extracted from an uploaded resume."""

    name: str | None = None
    contact: ContactSchema = Field(default_factory=ContactSchema)
    summary: str | None = None
    skills: list[str] = Field(default_factory=list)
    education: list[EducationSchema] = Field(default_factory=list)
    experience: list[ExperienceSchema] = Field(default_factory=list)
    projects: list[ProjectSchema] = Field(default_factory=list)
    certifications: list[CertificationSchema] = Field(default_factory=list)
    sections: dict[str, str] = Field(default_factory=dict)
    raw_text: str = Field(min_length=1)
    source_filename: str | None = None

    @field_validator("skills")
    @classmethod
    def deduplicate_skills(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(skill for skill in value if skill))


class ScoreBreakdown(Schema):
    keyword_score: float = Field(ge=0, le=100)
    skill_score: float = Field(ge=0, le=100)
    experience_score: float = Field(ge=0, le=100)
    education_score: float = Field(ge=0, le=100)
    project_score: float = Field(ge=0, le=100)
    formatting_score: float = Field(ge=0, le=100)
    grammar_score: float = Field(ge=0, le=100)
    achievement_score: float = Field(ge=0, le=100)


class ATSResult(Schema):
    """Deterministic ATS evaluation and supporting evidence."""

    overall_score: float = Field(ge=0, le=100)
    breakdown: ScoreBreakdown
    matched_keywords: list[str] = Field(default_factory=list)
    missing_keywords: list[str] = Field(default_factory=list)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    improvement_notes: list[str] = Field(default_factory=list)


class PromptType(str, Enum):
    RESUME_REVIEW = "resume_review"
    COVER_LETTER = "cover_letter"
    INTERVIEW_PREP = "interview_prep"
    CAREER_ADVICE = "career_advice"


class PromptRequest(Schema):
    prompt_type: PromptType
    resume: ResumeSchema
    ats_result: ATSResult
    job_description: str = Field(min_length=1)
    additional_context: str | None = None


class PromptResponse(Schema):
    prompt_type: PromptType
    system_prompt: str
    user_prompt: str


class ProviderRequest(Schema):
    provider: ProviderName
    system_prompt: str
    user_prompt: str
    model: str | None = None
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=2_000, ge=1, le=16_384)
    response_schema: dict[str, Any] | None = None


class TokenUsage(Schema):
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)

    @classmethod
    def from_counts(cls, prompt_tokens: int = 0, completion_tokens: int = 0) -> "TokenUsage":
        return cls(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        )


class ProviderResponse(Schema):
    provider: ProviderName
    model: str
    content: str
    usage: TokenUsage = Field(default_factory=TokenUsage)
    raw_response: dict[str, Any] = Field(default_factory=dict)
    cached: bool = False
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class FeedbackSchema(Schema):
    """Normalized feedback returned to frontend consumers."""

    overall_summary: str
    strengths: list[str] = Field(min_length=2)
    weaknesses: list[str] = Field(min_length=2)
    recommendations: list[str] = Field(min_length=2)
    keyword_suggestions: list[str] = Field(min_length=2)
    resume_rewrite_suggestions: list[str] = Field(min_length=2)
    missing_skills: list[str] = Field(default_factory=list)
    interview_preparation: list[str] = Field(min_length=2)


UnifiedFeedbackSchema = FeedbackSchema


class ReviewResult(Schema):
    """Complete frontend-facing result of a resume-review pipeline execution."""

    resume: ResumeSchema
    ats_result: ATSResult
    feedback: FeedbackSchema
    provider_response: ProviderResponse
