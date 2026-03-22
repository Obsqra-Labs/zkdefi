"""
Read-only API for the explorer-safe public proof dashboard emitted by /test.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.services.showcase_artifacts import (
    load_public_proof_dashboard,
    load_public_proof_dashboard_markdown,
    showcase_artifact_dir,
)

router = APIRouter(prefix="/public-proof-dashboard", tags=["showcase"])


@router.get("")
def get_public_proof_dashboard() -> dict:
    dashboard = load_public_proof_dashboard()
    if dashboard:
        return dashboard
    return {
        "status": "empty",
        "summary": {
            "public_entries_total": 0,
            "excluded_entries_total": 0,
            "notes": [
                "No public proof dashboard artifact is available yet.",
            ],
        },
        "entries": [],
        "excluded_lanes": [],
        "sources": {
            "artifact_dir": str(showcase_artifact_dir()),
        },
    }


@router.get("/markdown", response_class=PlainTextResponse)
def get_public_proof_dashboard_markdown() -> PlainTextResponse:
    markdown = load_public_proof_dashboard_markdown()
    return PlainTextResponse(markdown, media_type="text/markdown")
