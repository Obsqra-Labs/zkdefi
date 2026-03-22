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
_PATHB_BUNDLE_WARM_JSON = _ARTIFACT_DIR / "pathb_bundle_warm.json"
_PATHC_LATEST_JSON = _ARTIFACT_DIR / "pathc_latest.json"
_PATHC_HISTORY_JSONL = _ARTIFACT_DIR / "pathc_history.jsonl"


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


def load_pathb_bundle_warm_report() -> dict[str, Any]:
    if not _PATHB_BUNDLE_WARM_JSON.exists():
        return {}
    try:
        raw = json.loads(_PATHB_BUNDLE_WARM_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return raw if isinstance(raw, dict) else {}


def load_pathc_latest_report() -> dict[str, Any]:
    if not _PATHC_LATEST_JSON.exists():
        return {}
    try:
        raw = json.loads(_PATHC_LATEST_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return raw if isinstance(raw, dict) else {}


def load_pathc_history() -> list[dict[str, Any]]:
    if not _PATHC_HISTORY_JSONL.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        for line in _PATHC_HISTORY_JSONL.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if not text:
                continue
            try:
                raw = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(raw, dict):
                rows.append(raw)
    except OSError:
        return []
    return rows
