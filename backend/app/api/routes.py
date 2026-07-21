from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.dependencies import get_review_service
from app.core.config import ProviderName
from app.models import PromptType, ReviewResult
from app.parser import ResumeDocument, ResumeParseError
from app.services import ResumeReviewService


router = APIRouter(prefix="/api/v1", tags=["resume-review"])
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_SUFFIXES = {".pdf", ".docx"}


@router.get("/health", status_code=status.HTTP_200_OK)
async def health() -> dict[str, str]:
    """Lightweight liveness endpoint."""
    return {"status": "ok"}


@router.post("/reviews", response_model=ReviewResult, status_code=status.HTTP_200_OK)
async def create_review(
    resume: Annotated[UploadFile, File(description="PDF or DOCX resume, maximum 10 MB")],
    job_description: Annotated[str, Form(min_length=20)],
    prompt_type: Annotated[PromptType, Form()] = PromptType.RESUME_REVIEW,
    provider: Annotated[ProviderName | None, Form()] = None,
    model: Annotated[str | None, Form(max_length=120)] = None,
    additional_context: Annotated[str | None, Form(max_length=4_000)] = None,
    service: ResumeReviewService = Depends(get_review_service),
) -> ReviewResult:
    """Upload a resume and receive ATS scoring plus AI-normalized feedback."""
    filename = resume.filename or "resume"
    suffix = f".{filename.rsplit('.', 1)[-1].lower()}" if "." in filename else ""
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX resumes are supported")

    content = await resume.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=422, detail="Resume file cannot be empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Resume file must not exceed 10 MB")
    try:
        return await service.review(
            document=ResumeDocument(filename=filename, content=content),
            job_description=job_description,
            prompt_type=prompt_type,
            provider_name=provider,
            model=model,
            additional_context=additional_context,
        )
    except ResumeParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await resume.close()
