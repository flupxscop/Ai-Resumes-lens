"""Deterministic ATS scoring service independent of AI providers."""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from dataclasses import dataclass

from rapidfuzz import fuzz, process

from app.models import ATSResult, ResumeSchema, ScoreBreakdown


STOP_WORDS = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of",
        "on", "or", "the", "to", "with", "will", "you", "your", "we", "our", "this", "that",
        "have", "has", "using", "role", "work", "years", "experience", "required", "preferred",
        "into", "such", "building", "business", "knowledge", "solutions", "solution", "processes",
        "process", "technologies", "technology", "improvement", "key", "including", "across", "within",
        "applications", "data", "deployment", "engineering", "language", "monitoring", "performance",
        "requirements", "software", "tools", "model", "models", "responsibilities", "time",
    }
)
SKILL_PATTERN = re.compile(r"\b(?:python|java(?:script)?|typescript|sql|aws|azure|gcp|docker|kubernetes|"
    r"fastapi|django|flask|react|angular|vue|node(?:\.js)?|postgres(?:ql)?|mongodb|redis|"
    r"machine learning|deep learning|nlp|spacy|pandas|tensorflow|pytorch|git|linux|graphql)\b", re.I)
ACHIEVEMENT_PATTERN = re.compile(
    r"(?:\d+(?:\.\d+)?\s*(?:%|\+)|\$[\d,.]+|\b(?:increased|reduced|saved|grew|improved|delivered|generated|executed|measured)\b)",
    re.I,
)


@dataclass(frozen=True)
class ATSWeights:
    keyword: float = 0.20
    skill: float = 0.20
    experience: float = 0.15
    education: float = 0.10
    project: float = 0.10
    formatting: float = 0.10
    grammar: float = 0.05
    achievement: float = 0.10

    def __post_init__(self) -> None:
        total = sum(self.__dict__.values())
        if abs(total - 1.0) > 0.0001:
            raise ValueError("ATS weights must sum to 1.0")


class ATSScoringEngine:
    """Produces explainable, weighted ATS scores from resume and job-description data."""

    def __init__(self, weights: ATSWeights | None = None) -> None:
        self._weights = weights or ATSWeights()

    async def score(self, resume: ResumeSchema, job_description: str) -> ATSResult:
        """Calculate a score off the event loop to preserve FastAPI responsiveness."""
        if not job_description.strip():
            raise ValueError("job_description cannot be empty")
        return await asyncio.to_thread(self._score_sync, resume, job_description)

    def _score_sync(self, resume: ResumeSchema, job_description: str) -> ATSResult:
        resume_text = resume.raw_text.lower()
        job_keywords = self._keywords(job_description)
        matched_keywords, missing_keywords = self._match_keywords(job_keywords, resume_text)
        required_skills = self._skills(job_description)
        resume_skills = set(skill.lower() for skill in resume.skills) | set(self._skills(resume.raw_text))
        matched_skills, missing_skills = self._match_skills(required_skills, resume_skills)

        breakdown = ScoreBreakdown(
            keyword_score=self._ratio(len(matched_keywords), len(job_keywords)),
            skill_score=self._ratio(len(matched_skills), len(required_skills), default=70.0),
            experience_score=self._experience_score(resume, job_keywords),
            education_score=100.0 if resume.education else 35.0,
            project_score=self._project_score(resume, job_keywords),
            formatting_score=self._formatting_score(resume),
            grammar_score=self._grammar_score(resume.raw_text),
            achievement_score=self._achievement_score(resume),
        )
        overall = sum(
            score * weight
            for score, weight in (
                (breakdown.keyword_score, self._weights.keyword),
                (breakdown.skill_score, self._weights.skill),
                (breakdown.experience_score, self._weights.experience),
                (breakdown.education_score, self._weights.education),
                (breakdown.project_score, self._weights.project),
                (breakdown.formatting_score, self._weights.formatting),
                (breakdown.grammar_score, self._weights.grammar),
                (breakdown.achievement_score, self._weights.achievement),
            )
        )
        return ATSResult(
            overall_score=round(overall, 2),
            breakdown=breakdown,
            matched_keywords=sorted(matched_keywords),
            missing_keywords=sorted(missing_keywords),
            matched_skills=sorted(matched_skills),
            missing_skills=sorted(missing_skills),
            improvement_notes=self._improvement_notes(breakdown, missing_skills),
        )

    @staticmethod
    def _keywords(text: str) -> set[str]:
        words = re.findall(r"[a-zA-Z][a-zA-Z+#-]{2,}", text.lower())
        counts = Counter(word for word in words if word not in STOP_WORDS)
        return {word for word, _ in counts.most_common(40)}

    @staticmethod
    def _skills(text: str) -> set[str]:
        return {match.group(0).lower() for match in SKILL_PATTERN.finditer(text)}

    @staticmethod
    def _match_keywords(keywords: set[str], resume_text: str) -> tuple[set[str], set[str]]:
        matched = {keyword for keyword in keywords if re.search(rf"\b{re.escape(keyword)}\b", resume_text)}
        return matched, keywords - matched

    @staticmethod
    def _match_skills(required: set[str], available: set[str]) -> tuple[set[str], set[str]]:
        if not required:
            return set(), set()
        matched: set[str] = set()
        for skill in required:
            candidate = process.extractOne(skill, available, scorer=fuzz.ratio, score_cutoff=85)
            if candidate:
                matched.add(skill)
        return matched, required - matched

    @staticmethod
    def _ratio(numerator: int, denominator: int, default: float = 0.0) -> float:
        return round((numerator / denominator * 100) if denominator else default, 2)

    @staticmethod
    def _formatting_score(resume: ResumeSchema) -> float:
        score = 30.0
        score += 15.0 if resume.name else 0.0
        score += 15.0 if resume.contact.email else 0.0
        score += min(25.0, len(resume.sections) * 5.0)
        score += 15.0 if len(resume.raw_text) >= 300 else 0.0
        return min(score, 100.0)

    @classmethod
    def _experience_score(cls, resume: ResumeSchema, job_keywords: set[str]) -> float:
        if not resume.experience:
            return 0.0
        experience_text = " ".join(
            " ".join([role.title, role.company, *role.description]) for role in resume.experience
        ).lower()
        relevant = sum(
            bool(re.search(rf"\b{re.escape(keyword)}\b", experience_text))
            for keyword in job_keywords
        )
        relevance = cls._ratio(relevant, len(job_keywords))
        role_coverage = min(35.0, len(resume.experience) * 8.75)
        return round(min(100.0, role_coverage + relevance * 0.65), 2)

    @classmethod
    def _project_score(cls, resume: ResumeSchema, job_keywords: set[str]) -> float:
        if not resume.projects:
            return 0.0
        project_text = " ".join(
            " ".join([project.name, *project.description]) for project in resume.projects
        ).lower()
        relevant = sum(
            bool(re.search(rf"\b{re.escape(keyword)}\b", project_text))
            for keyword in job_keywords
        )
        relevance = cls._ratio(relevant, len(job_keywords))
        coverage = min(45.0, len(resume.projects) * 15.0)
        return round(min(100.0, 20.0 + coverage + relevance * 0.35), 2)

    @staticmethod
    def _grammar_score(text: str) -> float:
        """Conservative writing-quality heuristic; not a replacement for grammar checking."""
        sentences = [part.strip() for part in re.split(r"[.!?]+", text) if part.strip()]
        if not sentences:
            return 0.0
        capitalized = sum(sentence[0].isupper() for sentence in sentences)
        whitespace_penalty = min(15.0, len(re.findall(r"\s{3,}", text)) * 2.0)
        fragment_penalty = min(20.0, sum(len(sentence.split()) < 3 for sentence in sentences) * 2.0)
        return round(max(0.0, 60.0 + capitalized / len(sentences) * 25 - whitespace_penalty - fragment_penalty), 2)

    @staticmethod
    def _achievement_score(resume: ResumeSchema) -> float:
        bullets = [item for role in resume.experience for item in role.description]
        bullets.extend(item for project in resume.projects for item in project.description)
        if not bullets:
            return 0.0
        quantified = sum(bool(ACHIEVEMENT_PATTERN.search(bullet)) for bullet in bullets)
        return min(100.0, round(quantified / len(bullets) * 100, 2))

    @staticmethod
    def _improvement_notes(breakdown: ScoreBreakdown, missing_skills: set[str]) -> list[str]:
        notes = [f"Add evidence of {skill} where you have relevant experience." for skill in sorted(missing_skills)]
        checks = {
            "keywords": breakdown.keyword_score,
            "experience": breakdown.experience_score,
            "projects": breakdown.project_score,
            "quantified achievements": breakdown.achievement_score,
        }
        notes.extend(f"Strengthen the {name} section with role-specific evidence." for name, score in checks.items() if score < 60)
        return notes
