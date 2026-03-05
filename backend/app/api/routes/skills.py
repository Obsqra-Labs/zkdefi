"""
Agent Skills API — Expose zkML circuit skills for direct invocation.

Provides:
  GET  /skills           — List all available skills + circuit status
  GET  /skills/{id}      — Get details for a single skill
  POST /skills/{id}/run  — Execute a skill (generate Groth16 proof)
  POST /skills/batch     — Execute multiple skills in parallel
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.agent_skill_service import get_skill_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Request / Response Models ────────────────────────────────────────────────


class SkillRunRequest(BaseModel):
    """Parameters for executing a single skill."""
    params: dict[str, Any] = Field(default_factory=dict, description="Input parameters for the skill")
    user_address: str = Field(default="0x0", description="User Starknet address (hex or int)")


class BatchSkillRequest(BaseModel):
    """Execute multiple skills in one call."""
    skill_ids: list[str] = Field(..., description="List of skill IDs to execute")
    params: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="Per-skill params: { skill_id: { ...params } }",
    )
    user_address: str = Field(default="0x0", description="User Starknet address")


class SkillRunResponse(BaseModel):
    skill_id: str
    circuit_name: str | None = None
    success: bool
    is_compliant: bool | None = None
    proof_hash: str | None = None
    public_signals: list[str] | None = None
    duration_ms: int = 0
    error: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_address(raw: str) -> int:
    """Parse hex or decimal address string to int."""
    try:
        v = raw.strip()
        return int(v, 16) if v.startswith("0x") else int(v)
    except Exception:
        return 0


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/skills", summary="List available agent skills")
async def list_skills(
    category: str | None = None,
    max_tier: int = 2,
):
    """Return all registered agent skills with circuit readiness status."""
    svc = get_skill_service()
    skills = svc.list_skills(category=category, max_tier=max_tier)
    return {"skills": skills, "count": len(skills)}


@router.get("/skills/{skill_id}", summary="Get skill details")
async def get_skill(skill_id: str):
    """Return details for a single skill."""
    svc = get_skill_service()
    all_skills = svc.list_skills()
    match = next((s for s in all_skills if s["skill_id"] == skill_id), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    return match


@router.post(
    "/skills/{skill_id}/run",
    response_model=SkillRunResponse,
    summary="Execute a skill (generate ZK proof)",
)
async def run_skill(skill_id: str, body: SkillRunRequest):
    """Execute a single agent skill — builds inputs, runs the circuit, returns proof."""
    svc = get_skill_service()
    addr = _parse_address(body.user_address)

    result = await svc.execute_skill(
        skill_id=skill_id,
        params=body.params,
        user_address=addr,
    )
    if result.get("error") and not result.get("success"):
        # Still return 200 with error payload so callers can inspect
        pass

    return SkillRunResponse(
        skill_id=result.get("skill_id", skill_id),
        circuit_name=result.get("circuit_name"),
        success=result.get("success", False),
        is_compliant=result.get("is_compliant"),
        proof_hash=result.get("proof_hash"),
        public_signals=result.get("public_signals"),
        duration_ms=result.get("duration_ms", 0),
        error=result.get("error"),
    )


@router.post("/skills/batch", summary="Execute multiple skills in parallel")
async def run_skills_batch(body: BatchSkillRequest):
    """Execute several skills concurrently and return all results."""
    import asyncio

    svc = get_skill_service()
    addr = _parse_address(body.user_address)

    async def _run_one(sid: str) -> dict[str, Any]:
        skill_params = body.params.get(sid, {})
        return await svc.execute_skill(skill_id=sid, params=skill_params, user_address=addr)

    tasks = [_run_one(sid) for sid in body.skill_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output = []
    for sid, r in zip(body.skill_ids, results):
        if isinstance(r, Exception):
            output.append({"skill_id": sid, "success": False, "error": str(r)})
        else:
            output.append(r)

    succeeded = sum(1 for o in output if o.get("success"))
    return {
        "results": output,
        "total": len(output),
        "succeeded": succeeded,
        "failed": len(output) - succeeded,
    }
