"""Normalize heterogeneous provider output into the frontend feedback contract."""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import ValidationError

from app.models import FeedbackSchema, ProviderResponse, UnifiedFeedbackSchema
from app.models import ResumeSchema


class FeedbackParseError(ValueError):
    """Raised when a provider response cannot be converted to useful feedback."""


class ResponseParser:
    """Converts JSON and best-effort text feedback into a unified schema."""

    _fields = frozenset(FeedbackSchema.model_fields)

    def parse(self, response: ProviderResponse) -> UnifiedFeedbackSchema:
        """Normalize a raw provider response without leaking provider-specific structure."""
        payload = self._parse_json(response.content)
        if payload is not None:
            try:
                normalized = self._normalize_payload(payload)
                if not any(
                    field in normalized
                    for field in self._fields - {"overall_summary"}
                ):
                    raise FeedbackParseError("Provider JSON does not match the feedback contract")
                return FeedbackSchema.model_validate(normalized)
            except ValidationError as exc:
                raise FeedbackParseError("Provider JSON does not match the feedback contract") from exc
        return self._parse_text(response.content)

    @staticmethod
    def build_repair_prompt(
        content: str,
        original_system_prompt: str,
        original_user_prompt: str,
    ) -> tuple[str, str]:
        """Create a schema-repair request when a provider emits unrelated JSON."""
        system_prompt = (
            "Return only a JSON object with exactly these keys: overall_summary, strengths, "
            "weaknesses, recommendations, keyword_suggestions, resume_rewrite_suggestions, "
            "missing_skills, interview_preparation. overall_summary must be a string; every "
            "other key must be an array of strings. strengths, weaknesses, recommendations, "
            "keyword_suggestions, resume_rewrite_suggestions, and interview_preparation must "
            "each contain at least two specific items. Do not "
            "extract or return resume fields."
        )
        user_prompt = (
            "Use the original task context below as the only source of truth. Return useful, "
            "specific feedback; do not claim that a skill already present in the parsed resume "
            "is missing.\n\n"
            f"Original system instructions:\n{original_system_prompt}\n\n"
            f"Original task context:\n{original_user_prompt}\n\n"
            f"Previous invalid response to replace:\n{content}"
        )
        return system_prompt, user_prompt

    @staticmethod
    def remove_present_skills(
        feedback: UnifiedFeedbackSchema,
        resume: ResumeSchema,
    ) -> UnifiedFeedbackSchema:
        """Prevent provider hallucinations from marking documented skills as missing."""
        known_skills = {ResponseParser._skill_key(skill) for skill in resume.skills}
        known_skills.update(ResponseParser._skill_key(skill) for skill in resume.raw_text.splitlines())
        missing_skills = [
            skill
            for skill in feedback.missing_skills
            if not ResponseParser._is_documented_skill(ResponseParser._skill_key(skill), known_skills)
        ]
        return feedback.model_copy(update={"missing_skills": missing_skills})

    @staticmethod
    def _skill_key(value: str) -> str:
        return re.sub(r"\([^)]*\)|[^a-z0-9+# ]", "", value.lower()).strip()

    @staticmethod
    def _is_documented_skill(candidate: str, known_skills: set[str]) -> bool:
        if not candidate:
            return False
        return any(
            candidate == known or candidate in known or known in candidate
            for known in known_skills
            if known
        )

    @staticmethod
    def _parse_json(content: str) -> dict[str, Any] | None:
        candidates = [content.strip()]
        candidates.extend(re.findall(r"```(?:json)?\s*(.*?)\s*```", content, flags=re.I | re.S))
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
        return None

    def _normalize_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        aliases = {
            "summary": "overall_summary",
            "overall summary": "overall_summary",
            "keywords": "keyword_suggestions",
            "resume rewrites": "resume_rewrite_suggestions",
            "rewrite suggestions": "resume_rewrite_suggestions",
            "interview prep": "interview_preparation",
            "interview preparation": "interview_preparation",
        }
        normalized: dict[str, Any] = {}
        for key, value in payload.items():
            snake_key = re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower().replace("-", "_").strip()
            canonical_key = aliases.get(snake_key.replace("_", " "), snake_key)
            if canonical_key not in self._fields:
                continue
            if canonical_key == "overall_summary":
                normalized[canonical_key] = str(value)
            elif isinstance(value, list):
                normalized[canonical_key] = [str(item) for item in value]
            else:
                normalized[canonical_key] = [str(value)]
        normalized.setdefault("overall_summary", "The provider did not return a structured summary.")
        return normalized

    @staticmethod
    def _parse_text(content: str) -> UnifiedFeedbackSchema:
        cleaned = re.sub(r"```(?:json)?|```", "", content, flags=re.I).strip()
        if not cleaned:
            raise FeedbackParseError("Provider returned an empty response")
        sections: dict[str, list[str]] = {}
        current = "overall_summary"
        sections[current] = []
        headings = {
            "strengths": "strengths",
            "weaknesses": "weaknesses",
            "recommendations": "recommendations",
            "keyword suggestions": "keyword_suggestions",
            "resume rewrite suggestions": "resume_rewrite_suggestions",
            "missing skills": "missing_skills",
            "interview preparation": "interview_preparation",
        }
        for raw_line in cleaned.splitlines():
            line = raw_line.strip()
            candidate = line.rstrip(":").lower()
            if candidate in headings:
                current = headings[candidate]
                sections.setdefault(current, [])
            elif line:
                sections.setdefault(current, []).append(line.lstrip("•-* "))

        summary = " ".join(sections.pop("overall_summary", [])) or cleaned
        return FeedbackSchema(
            overall_summary=summary,
            strengths=sections.get("strengths", []),
            weaknesses=sections.get("weaknesses", []),
            recommendations=sections.get("recommendations", []),
            keyword_suggestions=sections.get("keyword_suggestions", []),
            resume_rewrite_suggestions=sections.get("resume_rewrite_suggestions", []),
            missing_skills=sections.get("missing_skills", []),
            interview_preparation=sections.get("interview_preparation", []),
        )
