"""Tests for prompt strategy factory behavior."""

from app.models import ATSResult, PromptRequest, PromptType, ResumeSchema, ScoreBreakdown
from app.prompts import PromptStrategyFactory


def test_resume_prompt_is_provider_neutral() -> None:
    request = PromptRequest(
        prompt_type=PromptType.RESUME_REVIEW,
        resume=ResumeSchema(raw_text="Jane Doe"),
        ats_result=ATSResult(
            overall_score=75,
            breakdown=ScoreBreakdown(
                keyword_score=75, skill_score=75, experience_score=75, education_score=75,
                project_score=75, formatting_score=75, grammar_score=75, achievement_score=75,
            ),
        ),
        job_description="Python backend engineer role.",
    )
    prompt = PromptStrategyFactory().build(request)
    assert prompt.prompt_type is PromptType.RESUME_REVIEW
    assert "OpenAI" not in prompt.system_prompt
    assert "Parsed resume" in prompt.user_prompt
