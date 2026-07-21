import pytest

from app.core.config import ProviderName
from app.models import ProviderResponse, ResumeSchema
from app.response import FeedbackParseError, ResponseParser


def test_response_parser_normalizes_fenced_json() -> None:
    response = ProviderResponse(
        provider=ProviderName.OLLAMA,
        model="test",
        content=(
            '```json\n{"summary":"Strong backend profile", '
            '"strengths":["Python", "FastAPI"], '
            '"weaknesses":["Limited cloud evidence", "Few quantified outcomes"], '
            '"recommendations":["Add AWS evidence", "Quantify delivery impact"], '
            '"keyword_suggestions":["AWS", "cloud deployment"], '
            '"resume_rewrite_suggestions":["Lead with outcome", "Add a metric"], '
            '"interview_preparation":["Explain an API tradeoff", "Prepare a delivery story"]}\n```'
        ),
    )
    feedback = ResponseParser().parse(response)
    assert feedback.overall_summary == "Strong backend profile"
    assert feedback.strengths == ["Python", "FastAPI"]


def test_response_parser_has_text_fallback() -> None:
    response = ProviderResponse(
        provider=ProviderName.OLLAMA,
        model="test",
        content=(
            "Useful general advice\n\nStrengths:\n- Clear writing\n- Relevant experience\n\n"
            "Weaknesses:\n- Limited metrics\n- Missing cloud evidence\n\n"
            "Recommendations:\n- Add metrics\n- Tailor keywords\n\nKeyword Suggestions:\n"
            "- Cloud deployment\n- AWS\n\nResume Rewrite Suggestions:\n"
            "- Lead with impact\n- Use concise action verbs\n\nInterview Preparation:\n"
            "- Prepare an API tradeoff story\n- Explain a delivery challenge"
        ),
    )
    feedback = ResponseParser().parse(response)
    assert feedback.overall_summary == "Useful general advice"
    assert feedback.strengths == ["Clear writing", "Relevant experience"]


def test_response_parser_rejects_unrelated_json() -> None:
    response = ProviderResponse(
        provider=ProviderName.OLLAMA,
        model="test",
        content='{"name":"Candidate", "experience":[]}',
    )
    with pytest.raises(FeedbackParseError):
        ResponseParser().parse(response)


def test_response_parser_removes_documented_skills_from_missing_skills() -> None:
    response = ProviderResponse(
        provider=ProviderName.OLLAMA,
        model="test",
        content=(
            '{"overall_summary":"Summary", "strengths":["Python", "Computer Vision"], '
            '"weaknesses":["Limited metrics", "Cloud evidence"], '
            '"recommendations":["Add metrics", "Tailor keywords"], '
            '"keyword_suggestions":["MLOps", "model deployment"], '
            '"resume_rewrite_suggestions":["Lead with impact", "Use action verbs"], '
            '"missing_skills":["Computer Vision", "MLOps"], '
            '"interview_preparation":["Explain CV deployment", "Prepare a model tradeoff"]}'
        ),
    )
    parser = ResponseParser()
    feedback = parser.remove_present_skills(
        parser.parse(response),
        ResumeSchema(raw_text="Computer Vision projects", skills=["Computer Vision"]),
    )
    assert feedback.missing_skills == ["MLOps"]
