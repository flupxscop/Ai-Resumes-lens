"""Tests for deterministic ATS scoring."""

import asyncio

from app.ats import ATSScoringEngine
from app.models import ResumeSchema


def test_ats_engine_identifies_matching_and_missing_skills() -> None:
    async def scenario() -> None:
        resume = ResumeSchema(
            raw_text="Jane Doe\njane@example.com\nPython FastAPI Docker\nImproved API speed by 30%.",
            skills=["Python", "FastAPI", "Docker"],
        )
        result = await ATSScoringEngine().score(
            resume,
            "Seeking a Python engineer with FastAPI, Docker, Kubernetes, and AWS experience.",
        )
        assert result.overall_score > 0
        assert "python" in result.matched_skills
        assert "kubernetes" in result.missing_skills

    asyncio.run(scenario())
