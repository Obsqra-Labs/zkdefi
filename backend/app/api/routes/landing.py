"""
Landing page stats — read-only payload from hackathon showcase latest.json.
Used by the marketing landing page to show live stats (e.g. from /test report).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.services.showcase_artifacts import load_latest_showcase_report

router = APIRouter(tags=["landing"])

DEFAULT_STATS = {
    "agent_models": 0,
    "advisories": 0,
    "proofs_verified": 0,
    "circuits_ready": 0,
}


def _load_landing_stats() -> dict[str, int]:
    """Read latest.json and extract a small stats subset for the landing page."""
    raw = load_latest_showcase_report()
    if not isinstance(raw, dict):
        return DEFAULT_STATS.copy()

    out = DEFAULT_STATS.copy()
    ai = raw.get("ai_showcase")
    if isinstance(ai, dict):
        models = ai.get("agent_models")
        if isinstance(models, list):
            out["agent_models"] = len(models)
        adv = ai.get("advisories")
        if isinstance(adv, list):
            out["advisories"] = len(adv)

    inv = raw.get("inventory") or raw.get("circuit_inventory")
    if isinstance(inv, dict):
        out["circuits_ready"] = int(inv.get("circuits_ready_dual_artifacts", 0) or inv.get("circuits_ready", 0))

    # Optional: proofs/ml-bridge or similar top-level run result
    for key in ("proofs_verified", "proofs_passed", "fact_count"):
        if key in raw and isinstance(raw[key], (int, float)):
            out["proofs_verified"] = int(raw[key])
            break

    return out


@router.get("/landing-stats")
def get_landing_stats() -> dict[str, int]:
    """Return a small stats payload for the landing page (from showcase latest.json or defaults)."""
    return _load_landing_stats()
