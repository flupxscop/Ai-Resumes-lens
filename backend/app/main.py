"""FastAPI application factory and exception-to-HTTP mapping."""

from __future__ import annotations

import logging
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.ai.provider import ProviderError
from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.response import FeedbackParseError


def create_app(settings: Settings | None = None) -> FastAPI:
    
    """Create the independently testable FastAPI application."""
    runtime_settings = settings or get_settings()
    configure_logging(runtime_settings.log_level)
    app = FastAPI(title="AI Resume Reviewer", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.exception_handler(ProviderError)
    async def provider_error_handler(_: Request, exc: ProviderError) -> JSONResponse:
        logging.getLogger(__name__).warning("provider_error", exc_info=exc)
        return JSONResponse(status_code=502, content={"detail": "AI provider request failed"})

    @app.exception_handler(FeedbackParseError)
    async def feedback_error_handler(_: Request, exc: FeedbackParseError) -> JSONResponse:
        logging.getLogger(__name__).warning("feedback_parse_error", exc_info=exc)
        return JSONResponse(status_code=502, content={"detail": "AI provider returned invalid feedback"})


    

    return app


app = create_app()
