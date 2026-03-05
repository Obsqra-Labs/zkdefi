"""
Agent Builder API — Create, manage, and execute identity-bound agents.

Endpoints:
  POST   /agents/build          — Create a new agent with skills + LLM binding
  GET    /agents/list            — List agents for an owner
  GET    /agents/{id}            — Get agent details
  POST   /agents/{id}/execute    — Execute a goal via the orchestrator
  GET    /agents/{id}/performance — Get performance history
  GET    /skills                 — List available skills
  GET    /skills/{id}/schema     — Get skill parameter schema
  GET    /providers              — List LLM providers
  POST   /providers/bind         — Bind an agent to an LLM provider
  GET    /leaderboard            — Get agent leaderboard
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.agent_orchestrator import get_orchestrator, AgentConfig
from app.services.agent_skill_service import get_skill_service, SKILL_DEFINITIONS
from app.services.llm_provider_registry import get_llm_registry
from app.services.agent_performance_service import (
    get_performance_service,
    PeriodPerformance,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response Models ────────────────────────────────────────────────

class BuildAgentRequest(BaseModel):
    name: str
    owner_address: str
    identity_commitment: str = "0"
    skills: list[str] = []           # Skill IDs to bind
    llm_provider: str = "onyx"
    llm_model: str | None = None


class BuildAgentResponse(BaseModel):
    agent_id: str
    name: str
    owner_address: str
    skills: list[str]
    llm_provider: str
    llm_config_hash: str
    onchain_tx: str | None = None


class ExecuteGoalRequest(BaseModel):
    goal: str
    context: dict | None = None


class BindProviderRequest(BaseModel):
    agent_id: str
    provider_id: str


class UpdateAgentRequest(BaseModel):
    name: str | None = None
    skills: list[str] | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    active: bool | None = None


class RecordPerformanceRequest(BaseModel):
    agent_id: str
    period_id: str
    return_bps: int = 0
    volume: int = 0
    proof_count: int = 0
    successful_actions: int = 0
    failed_actions: int = 0
    max_drawdown_bps: int = 0


# ── Agent CRUD ───────────────────────────────────────────────────────────────

@router.post("/agents/build")
async def build_agent(req: BuildAgentRequest):
    """Create a new identity-bound agent with skills and LLM binding."""
    orchestrator = get_orchestrator()
    registry = get_llm_registry()

    # Validate skills
    for sid in req.skills:
        if sid not in SKILL_DEFINITIONS:
            raise HTTPException(400, f"Unknown skill: {sid}. Available: {list(SKILL_DEFINITIONS.keys())}")

    # Validate provider
    provider = registry.get_provider(req.llm_provider)
    if not provider:
        available = [p["provider_id"] for p in registry.list_providers()]
        raise HTTPException(400, f"Unknown provider: {req.llm_provider}. Available: {available}")

    # Generate agent ID from name + owner
    import hashlib
    agent_id = hashlib.sha256(f"{req.name}:{req.owner_address}".encode()).hexdigest()[:16]

    resolved_model = req.llm_model or provider.default_model

    config = AgentConfig(
        agent_id=agent_id,
        owner_address=req.owner_address,
        name=req.name,
        identity_commitment=req.identity_commitment,
        bound_skills=req.skills or list(SKILL_DEFINITIONS.keys()),  # All skills if none specified
        llm_provider_id=req.llm_provider,
        llm_model=resolved_model,
    )

    reg_result = orchestrator.register_agent(config)
    config_hash = reg_result.get("config_hash") or registry.bind_agent(agent_id, req.llm_provider)
    onchain = reg_result.get("onchain", {})

    return BuildAgentResponse(
        agent_id=agent_id,
        name=req.name,
        owner_address=req.owner_address,
        skills=config.bound_skills,
        llm_provider=req.llm_provider,
        llm_config_hash=config_hash,
        onchain_tx=onchain.get("tx_hash"),
    )


@router.get("/agents/list")
async def list_agents(owner: str | None = None):
    """List all registered agents, optionally filtered by owner."""
    orchestrator = get_orchestrator()
    agents = orchestrator.list_agents(owner=owner)
    return {"agents": agents, "count": len(agents)}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    """Get detailed agent info including skills and performance."""
    orchestrator = get_orchestrator()
    agent = orchestrator.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {agent_id}")

    perf_service = get_performance_service()
    summary = perf_service.get_summary(agent_id)

    skill_service = get_skill_service()
    skill_details = []
    for sid in agent.bound_skills:
        skill_def = SKILL_DEFINITIONS.get(sid)
        if skill_def:
            skill_details.append({
                "skill_id": sid,
                "name": skill_def.name,
                "category": skill_def.category,
                "description": skill_def.description,
            })

    return {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "owner": agent.owner_address,
        "identity_commitment": agent.identity_commitment,
        "reputation_tier": agent.reputation_tier,
        "llm_provider": agent.llm_provider_id,
        "active": agent.active,
        "skills": skill_details,
        "performance": {
            "total_periods": summary.total_periods if summary else 0,
            "cumulative_return_bps": summary.cumulative_return_bps if summary else 0,
            "mean_return_bps": summary.mean_return_bps if summary else 0,
            "max_drawdown_bps": summary.max_drawdown_bps if summary else 0,
            "win_rate": summary.win_rate if summary else 0,
            "total_proofs": summary.total_proofs if summary else 0,
        },
    }


@router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, req: UpdateAgentRequest):
    """Update an existing agent's config."""
    orchestrator = get_orchestrator()
    agent = orchestrator.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {agent_id}")

    updates: dict = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.skills is not None:
        for sid in req.skills:
            if sid not in SKILL_DEFINITIONS:
                raise HTTPException(400, f"Unknown skill: {sid}")
        updates["bound_skills"] = req.skills
    if req.llm_provider is not None:
        registry = get_llm_registry()
        if not registry.get_provider(req.llm_provider):
            raise HTTPException(400, f"Unknown provider: {req.llm_provider}")
        updates["llm_provider_id"] = req.llm_provider
    if req.llm_model is not None:
        updates["llm_model"] = req.llm_model
    if req.active is not None:
        updates["active"] = req.active

    if not updates:
        raise HTTPException(400, "No valid fields to update")

    ok = orchestrator.update_agent(agent_id, updates)
    if not ok:
        raise HTTPException(500, "Update failed")

    return {"agent_id": agent_id, "updated_fields": list(updates.keys())}


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an agent and all related data."""
    orchestrator = get_orchestrator()
    existed = orchestrator.delete_agent(agent_id)
    if not existed:
        raise HTTPException(404, f"Agent not found: {agent_id}")
    return {"agent_id": agent_id, "deleted": True}


# ── Goal Execution ───────────────────────────────────────────────────────────

@router.post("/agents/{agent_id}/execute")
async def execute_goal(agent_id: str, req: ExecuteGoalRequest):
    """Execute a goal using the agent's LLM + ZK skills pipeline."""
    orchestrator = get_orchestrator()
    agent = orchestrator.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {agent_id}")

    result = await orchestrator.execute_goal(agent_id, req.goal, req.context)

    # Include provider visibility info
    provider_requested = agent.llm_provider_id
    provider_used = result.llm_provider_used or provider_requested or "unknown"
    fallback_reason = result.llm_fallback_reason

    # Backward-compatible extraction for older orchestration payloads.
    if not fallback_reason:
        for s in result.steps:
            if s.step_type == "llm_reasoning" and s.result:
                fallback_reason = s.result.get("fallback_reason")
                fallback_from = s.result.get("fallback_from")
                if fallback_reason and fallback_from:
                    fallback_reason = f"{fallback_from}: {fallback_reason}"
                break

    return {
        "agent_id": result.agent_id,
        "goal": result.goal,
        "steps": [
            {
                "type": s.step_type,
                "skill_id": s.skill_id,
                "success": s.success,
                "duration_ms": s.duration_ms,
                "result": s.result,
            }
            for s in result.steps
        ],
        "final_decision": result.final_decision,
        "all_proofs_pass": result.all_proofs_pass,
        "total_duration_ms": result.total_duration_ms,
        "tokens_used": result.llm_tokens_used,
        "error": result.error,
        "llm_provider_requested": provider_requested,
        "llm_provider_used": provider_used,
        "llm_fallback_reason": fallback_reason,
    }


# ── Skills ───────────────────────────────────────────────────────────────────

@router.get("/skills")
async def list_skills(category: str | None = None):
    """List all available ZK circuit skills."""
    skill_service = get_skill_service()
    skills = skill_service.list_skills(category=category)
    return {"skills": skills, "count": len(skills)}


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str):
    """Get skill details including parameter schema."""
    skill = SKILL_DEFINITIONS.get(skill_id)
    if not skill:
        raise HTTPException(404, f"Skill not found: {skill_id}")
    return {
        "skill_id": skill.skill_id,
        "name": skill.name,
        "description": skill.description,
        "category": skill.category,
        "parameters": skill.parameters,
        "circuit_name": skill.circuit_name,
        "requires_tier": skill.requires_reputation_tier,
    }


@router.post("/skills/{skill_id}/execute")
async def execute_skill(skill_id: str, body: dict = {}):
    """Execute a single skill directly (for testing / standalone use).

    Body format: {"user_address": "0x...", "params": {"entry_price": 2000, ...}}
    or flat:     {"entry_price": 2000, "current_price": 2200}
    """
    skill_service = get_skill_service()
    # Support both nested {"params": {...}} and flat param dict
    user_addr_raw = body.pop("user_address", 0)
    if isinstance(user_addr_raw, str):
        user_addr_raw = int(user_addr_raw, 16) if user_addr_raw.startswith("0x") else int(user_addr_raw)
    skill_params = body.get("params", body)  # nested or flat
    result = await skill_service.execute_skill(skill_id, skill_params, user_address=user_addr_raw)
    return result


# ── LLM Providers ────────────────────────────────────────────────────────────

@router.get("/providers")
async def list_providers():
    """List all available LLM providers."""
    registry = get_llm_registry()
    providers = registry.list_providers()
    return {"providers": providers, "count": len(providers)}


@router.post("/providers/bind")
async def bind_provider(req: BindProviderRequest):
    """Bind an agent to an LLM provider."""
    registry = get_llm_registry()
    orchestrator = get_orchestrator()

    agent = orchestrator.get_agent(req.agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {req.agent_id}")

    provider = registry.get_provider(req.provider_id)
    if not provider:
        raise HTTPException(400, f"Unknown provider: {req.provider_id}")

    config_hash = registry.bind_agent(req.agent_id, req.provider_id)
    agent.llm_provider_id = req.provider_id

    return {
        "agent_id": req.agent_id,
        "provider_id": req.provider_id,
        "config_hash": config_hash,
    }


# ── Performance ──────────────────────────────────────────────────────────────

@router.get("/agents/{agent_id}/performance")
async def get_performance(agent_id: str, periods: int = 12):
    """Get agent performance history."""
    perf_service = get_performance_service()
    summary = perf_service.get_summary(agent_id)
    recent = perf_service.get_periods(agent_id, periods)

    return {
        "agent_id": agent_id,
        "summary": {
            "total_periods": summary.total_periods if summary else 0,
            "cumulative_return_bps": summary.cumulative_return_bps if summary else 0,
            "mean_return_bps": summary.mean_return_bps if summary else 0,
            "max_drawdown_bps": summary.max_drawdown_bps if summary else 0,
            "win_rate": summary.win_rate if summary else 0.0,
            "total_volume": summary.total_volume if summary else 0,
            "total_proofs": summary.total_proofs if summary else 0,
            "current_balance": summary.current_balance if summary else 10000,
            "peak_balance": summary.peak_balance if summary else 10000,
        },
        "periods": [
            {
                "period_id": p.period_id,
                "return_bps": p.return_bps,
                "volume": p.volume,
                "proof_count": p.proof_count,
                "successful_actions": p.successful_actions,
                "failed_actions": p.failed_actions,
                "max_drawdown_bps": p.max_drawdown_bps,
            }
            for p in recent
        ],
    }


@router.post("/agents/{agent_id}/performance/record")
async def record_performance(agent_id: str, req: RecordPerformanceRequest):
    """Record a new performance period for an agent."""
    perf_service = get_performance_service()
    period = PeriodPerformance(
        period_id=req.period_id,
        agent_id=agent_id,
        return_bps=req.return_bps,
        volume=req.volume,
        proof_count=req.proof_count,
        successful_actions=req.successful_actions,
        failed_actions=req.failed_actions,
        max_drawdown_bps=req.max_drawdown_bps,
    )
    summary = perf_service.record_period(period)
    return {
        "agent_id": agent_id,
        "period_recorded": req.period_id,
        "updated_summary": {
            "total_periods": summary.total_periods,
            "cumulative_return_bps": summary.cumulative_return_bps,
            "mean_return_bps": summary.mean_return_bps,
            "win_rate": summary.win_rate,
        },
    }


# ── Leaderboard ──────────────────────────────────────────────────────────────

@router.get("/leaderboard")
async def get_leaderboard(sort_by: str = "cumulative_return_bps", limit: int = 20):
    """Get the agent performance leaderboard."""
    perf_service = get_performance_service()
    entries = perf_service.get_leaderboard(sort_by=sort_by, limit=limit)
    return {"leaderboard": entries, "sort_by": sort_by, "count": len(entries)}


# ── Witness Data (for circuits) ──────────────────────────────────────────────

@router.get("/agents/{agent_id}/reputation-witness")
async def get_reputation_witness(agent_id: str):
    """Get witness data for the AgentReputationScore circuit."""
    perf_service = get_performance_service()
    inputs = perf_service.get_reputation_inputs(agent_id)
    return {"agent_id": agent_id, "circuit": "AgentReputationScore", "witness_inputs": inputs}


@router.get("/agents/{agent_id}/performance-witness")
async def get_performance_witness(agent_id: str, num_periods: int = 12):
    """Get witness data for the HistoricalPerformanceAttestation circuit."""
    perf_service = get_performance_service()
    inputs = perf_service.get_performance_witness(agent_id, num_periods)
    return {"agent_id": agent_id, "circuit": "HistoricalPerformanceAttestation", "witness_inputs": inputs}


# ── Provider Health ──────────────────────────────────────────────────────────

@router.get("/providers/health")
async def provider_health():
    """Check health / availability of all LLM providers."""
    import asyncio
    registry = get_llm_registry()
    providers = registry.list_providers()
    health: list[dict] = []
    for p in providers:
        pid = p["provider_id"]
        availability_reason = p.get("availability_reason")
        entry = {
            "provider_id": pid,
            "name": p["name"],
            "available": p["available"],
            "availability_reason": availability_reason,
        }
        if pid == "deterministic":
            entry["latency_ms"] = 0
            entry["status"] = "healthy"
        elif p["available"]:
            # Quick ping: tiny prompt
            try:
                import time as _time
                t0 = _time.monotonic()
                resp = await registry.chat_completion(
                    pid,
                    [{"role": "user", "content": "ping"}],
                    max_tokens=5,
                )
                latency = int((_time.monotonic() - t0) * 1000)
                entry["latency_ms"] = latency
                entry["status"] = "healthy"
                entry["model"] = resp.model
            except Exception as exc:
                entry["status"] = "error"
                entry["error"] = str(exc)
        else:
            entry["status"] = "unconfigured"
            entry["error"] = availability_reason or "provider_unavailable"
        health.append(entry)
    return {"providers": health}
