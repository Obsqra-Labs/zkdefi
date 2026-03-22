"""
Helpers for reading the latest showcase artifacts produced by /test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_REPO_ROOT = Path(__file__).resolve().parents[3]
_ARTIFACT_DIR = _REPO_ROOT / "artifacts" / "hackathon_showcase"
_LATEST_JSON = _ARTIFACT_DIR / "latest.json"
_PUBLIC_PROOF_DASHBOARD_MD = _ARTIFACT_DIR / "public_proof_dashboard.md"


def showcase_artifact_dir() -> Path:
    return _ARTIFACT_DIR


def load_latest_showcase_report() -> dict[str, Any]:
    if not _LATEST_JSON.exists():
        return {}
    try:
        raw = json.loads(_LATEST_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return raw if isinstance(raw, dict) else {}


def load_public_proof_dashboard() -> dict[str, Any]:
    report = load_latest_showcase_report()
    dashboard = report.get("public_proof_dashboard")
    return dashboard if isinstance(dashboard, dict) else {}


def load_public_proof_dashboard_markdown() -> str:
    if _PUBLIC_PROOF_DASHBOARD_MD.exists():
        try:
            return _PUBLIC_PROOF_DASHBOARD_MD.read_text(encoding="utf-8")
        except OSError:
            return ""
    return ""
