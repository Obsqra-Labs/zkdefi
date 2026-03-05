"""
Agent API compatibility routes.

These endpoints keep `/api/v1/agents/*` stable for existing frontend callers,
while routing to the unified v2 orchestrator/skills stack first. If a request
cannot be represented in v2, it falls back to the legacy local orchestrator.
"""

from __future__ import annotations

import hashlib
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.middleware.auth import require_wallet_owner
from app.services.agent_orchestrator import AgentConfig, get_orchestrator
from app.services.agent_service import get_agent_service
from app.services.agent_skill_service import SKILL_DEFINITIONS, get_skill_service
from app.services.zkml.circuit_scanner import CIRCUIT_REGISTRY

router = APIRouter()


PROCESSOR_TO_SKILL: dict[str, str] = {
    # Legacy processor IDs
    "risk_scoring": "risk_score",
    "correlation_risk": "correlation_risk",
    "twap_position": "twap_position",
    "safety_diversification": "safety_diversification",
    "credit_scoring": "reputation_check",
    "anomaly_detection": "anomaly_detection",
    "anomaly_detector": "anomaly_detection",
    "il_predictor": "il_predictor",
    "slippage_bound": "slippage_bound",
    "max_drawdown": "performance_attestation",
    "liquidity_depth": "slippage_bound",
    "volatility_regime": "risk_score",
    "position_concentration": "correlation_risk",
    "yield_optimality": "yield_optimality",
    "liquidation_risk": "liquidation_check",
    "mev_protection": "mev_protection",
    # Native v2 skill IDs (identity mapping)
    "risk_score": "risk_score",
    "correlation_risk": "correlation_risk",
    "twap_position": "twap_position",
    "safety_diversification": "safety_diversification",
    "reputation_check": "reputation_check",
    "anomaly_detection": "anomaly_detection",
    "yield_optimality": "yield_optimality",
    "il_predictor": "il_predictor",
    "slippage_bound": "slippage_bound",
    "arb_check": "arb_check",
    "liquidation_check": "liquidation_check",
    "performance_attestation": "performance_attestation",
    "mev_protection": "mev_protection",
}

SKILL_TO_PROCESSOR_ALIAS: dict[str, str] = {
    "risk_score": "risk_scoring",
    "correlation_risk": "correlation_risk",
    "twap_position": "twap_position",
    "safety_diversification": "safety_diversification",
    "reputation_check": "credit_scoring",
    "anomaly_detection": "anomaly_detector",
    "yield_optimality": "yield_optimality",
    "il_predictor": "il_predictor",
    "slippage_bound": "slippage_bound",
    "arb_check": "arb_check",
    "liquidation_check": "liquidation_risk",
    "performance_attestation": "max_drawdown",
    "mev_protection": "mev_protection",
}


class CreateAgentRequest(BaseModel):
    user_address: str
    name: str
    processors: list[str]
    decision_logic: dict[str, Any] = {"type": "AND"}
    llm_provider: str = "onyx"
    llm_model: str | None = None
    identity_commitment: str = "0"
    use_legacy: bool = False


class ExecuteAgentRequest(BaseModel):
    agent_id: str | None = None
    user_address: str
    portfolio: dict[str, Any] = {}
    constraints: dict[str, Any] = {}


def _parse_user_address_int(raw: str | None) -> int:
    if not raw:
        return 0
    try:
        v = raw.strip()
        return int(v, 16) if v.startswith("0x") else int(v)
    except Exception:
        return 0


def _created_at_to_epoch(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value:
        try:
            return int(
                datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            )
        except Exception:
            return int(time.time())
    return int(time.time())


def _normalize_processors_to_skills(processors: list[str]) -> tuple[list[str], list[str]]:
    skills: list[str] = []
    unsupported: list[str] = []
    for processor in processors:
        skill = PROCESSOR_TO_SKILL.get(processor)
        if not skill or skill not in SKILL_DEFINITIONS:
            unsupported.append(processor)
            continue
        if skill not in skills:
            skills.append(skill)
    return skills, unsupported


def _processor_alias_for_skill(skill_id: str) -> str:
    return SKILL_TO_PROCESSOR_ALIAS.get(skill_id, skill_id)


def _legacy_agent_from_unified(row: dict[str, Any]) -> dict[str, Any]:
    skills = list(row.get("skills") or [])
    processors = [_processor_alias_for_skill(s) for s in skills]
    created_at = _created_at_to_epoch(row.get("created_at"))
    return {
        "id": row.get("agent_id"),
        "name": row.get("name"),
        "owner": row.get("owner"),
        "processors": processors,
        "decision_logic": {"type": "AND"},
        "active": bool(row.get("active", True)),
        "created_at": created_at,
        "stack": "unified_v2",
        "skills": skills,
        "llm_provider": row.get("llm_provider", "onyx"),
        "reputation_tier": row.get("tier", 0),
    }


def _extract_score_threshold(step_result: dict[str, Any] | None) -> tuple[int | None, int | None]:
    if not step_result:
        return None, None
    public_signals = step_result.get("public_signals") or []
    score = None
    threshold = None
    if len(public_signals) >= 2:
        try:
            score = int(public_signals[1])
        except Exception:
            score = None
    if len(public_signals) >= 3:
        try:
            threshold = int(public_signals[2])
        except Exception:
            threshold = None
    return score, threshold


def _summarize_step_result(step: Any) -> dict[str, Any] | None:
    """Summarize an OrchestrationStep's result for the reasoning trace, omitting large payloads."""
    if not step.result:
        return None
    r = step.result
    if step.step_type == "llm_reasoning":
        return {
            "provider_id": r.get("provider_id"),
            "model": r.get("model"),
            "tokens_used": r.get("tokens_used", 0),
            "skill_calls_parsed": len(r.get("skill_calls", [])) if isinstance(r.get("skill_calls"), list) else None,
            "reasoning_preview": str(r.get("content", ""))[:300],
        }
    elif step.step_type == "skill_execution":
        return {
            "skill_id": step.skill_id,
            "is_compliant": r.get("is_compliant"),
            "proof_hash": r.get("proof_hash"),
            "public_signals_count": len(r.get("public_signals", [])),
            "error": r.get("error"),
        }
    elif step.step_type == "llm_synthesis":
        return {
            "decision_preview": str(r.get("decision", r.get("content", "")))[:300],
            "tokens_used": r.get("tokens_used", 0),
        }
    return {k: v for k, v in r.items() if k not in ("proof", "witness")}  # drop heavy blobs


def _legacy_execution_from_unified(
    *,
    agent_id: str,
    agent_name: str,
    orchestration_result: Any,
) -> dict[str, Any]:
    processor_results: list[dict[str, Any]] = []
    for step in orchestration_result.steps:
        if step.step_type != "skill_execution":
            continue
        step_result = step.result or {}
        score, threshold = _extract_score_threshold(step_result)
        proof_hash = step_result.get("proof_hash")
        is_compliant = step_result.get("is_compliant")
        passed = bool(step.success) and (is_compliant is not False)
        processor_results.append(
            {
                "processor_id": _processor_alias_for_skill(step.skill_id or "unknown"),
                "passed": passed,
                "score": score,
                "threshold": threshold,
                "has_proof": bool(proof_hash),
                "error": step_result.get("error"),
                "execution_time_ms": int(step.duration_ms or 0),
                "skill_id": step.skill_id,
                "proof_hash": proof_hash,
            }
        )

    return {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "should_execute": bool(orchestration_result.all_proofs_pass),
        "decision_logic": "AND",
        "processor_results": processor_results,
        "execution_calldata": None,
        "total_time_ms": int(orchestration_result.total_duration_ms or 0),
        "human_readable_output": orchestration_result.final_decision,
        "stack": "unified_v2",
        "reasoning_trace": [
            {
                "step_type": s.step_type,
                "skill_id": s.skill_id,
                "input_params": s.input_params,
                "result_summary": _summarize_step_result(s),
                "duration_ms": s.duration_ms,
                "success": s.success,
            }
            for s in orchestration_result.steps
        ],
        "llm_provider_used": getattr(orchestration_result, "llm_provider_used", "unknown"),
        "llm_tokens_used": getattr(orchestration_result, "llm_tokens_used", 0),
        "llm_fallback_reason": getattr(orchestration_result, "llm_fallback_reason", None),
    }


def _legacy_execution_from_skill_results(
    *,
    agent_id: str,
    agent_name: str,
    skill_results: list[dict[str, Any]],
    total_time_ms: int,
    human_readable_output: Any,
) -> dict[str, Any]:
    processor_results: list[dict[str, Any]] = []
    should_execute = True
    for result in skill_results:
        is_compliant = result.get("is_compliant")
        passed = bool(result.get("success")) and (is_compliant is not False)
        if not passed:
            should_execute = False
        score, threshold = _extract_score_threshold(result)
        processor_results.append(
            {
                "processor_id": _processor_alias_for_skill(result.get("skill_id", "unknown")),
                "passed": passed,
                "score": score,
                "threshold": threshold,
                "has_proof": bool(result.get("proof_hash")),
                "error": result.get("error"),
                "execution_time_ms": int(result.get("duration_ms") or 0),
                "skill_id": result.get("skill_id"),
                "proof_hash": result.get("proof_hash"),
            }
        )

    return {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "should_execute": should_execute,
        "decision_logic": "AND",
        "processor_results": processor_results,
        "execution_calldata": None,
        "total_time_ms": total_time_ms,
        "human_readable_output": human_readable_output,
        "stack": "unified_v2",
        "execution_mode": "manual_skill_fallback",
    }


def _get_onnx_metadata() -> dict[str, Any]:
    """Load ONNX/EZKL training metadata for the creditworthiness model."""
    import json as _json
    from pathlib import Path as _Path

    meta_path = _Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "creditworthiness" / "training_metadata.json"
    try:
        if meta_path.exists():
            data = _json.loads(meta_path.read_text())
            onnx_path = _Path(data.get("onnx_path", ""))
            return {
                "onnx_hash": data.get("model_hash"),
                "onnx_size_bytes": int(onnx_path.stat().st_size) if onnx_path.exists() else None,
                "trained_at": data.get("trained_at"),
                "training_samples": data.get("training_samples"),
                "accuracy": data.get("accuracy"),
                "n_features": len(data.get("feature_names", [])),
                "ezkl_setup": bool(onnx_path.exists()),
            }
    except Exception:
        pass
    return {}


def _build_unified_model_catalog() -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []

    for skill_id, skill in SKILL_DEFINITIONS.items():
        circuit_meta = CIRCUIT_REGISTRY.get(skill.circuit_name, {})
        wasm_path = circuit_meta.get("wasm") if circuit_meta else None
        zkey_path = circuit_meta.get("zkey") if circuit_meta else None
        ready = bool(wasm_path and zkey_path and wasm_path.exists() and zkey_path.exists())
        models.append(
            {
                "id": skill_id,
                "name": skill.name,
                "description": skill.description,
                "type": "groth16",
                "timeout": 30.0,
                "circuit": skill.circuit_name,
                "category": skill.category,
                "composable": True,
                "ready": ready,
                "processor_alias": _processor_alias_for_skill(skill_id),
                "stack": "unified_v2",
            }
        )

    # Keep a compatibility credit-scoring entry in catalog for old UI copy.
    # Enrich with ONNX/EZKL metadata from training_metadata.json.
    onnx_meta = _get_onnx_metadata()
    models.append(
        {
            "id": "credit_scoring",
            "name": "Credit Scoring (ONNX/EZKL)",
            "description": "Predictive credit signal bridged into policy/readout flows.",
            "type": "risc_zero",
            "timeout": 120.0,
            "circuit": "ModelBridge",
            "category": "ezkl_bridge",
            "composable": True,
            "ready": False,
            "processor_alias": "credit_scoring",
            "stack": "unified_v2",
            **onnx_meta,
        }
    )

    return models


@router.get("/models/list")
async def list_models():
    """List available models from the unified skill/circuit stack."""
    return {"models": _build_unified_model_catalog()}


@router.post("/{agent_id}/execute")
async def execute_agent_path(agent_id: str, request: ExecuteAgentRequest):
    """Execute by agent ID. Unified v2 first, legacy fallback."""
    orchestrator = get_orchestrator()
    unified_agent = orchestrator.get_agent(agent_id)
    if unified_agent:
        goal = (
            request.constraints.get("goal")
            or request.constraints.get("objective")
            or request.constraints.get("reason")
            or "Generate composable market-depth context from all available zkML signals."
        )
        context = {
            "user_address": request.user_address,
            "portfolio": request.portfolio,
            "constraints": request.constraints,
            "requested_stack": "unified_v2",
        }
        result = await orchestrator.execute_goal(agent_id, goal, context)

        # If LLM did not select skills (common with deterministic fallback),
        # run bound skills directly so callers still receive concrete signals.
        skill_steps = [s for s in result.steps if s.step_type == "skill_execution"]
        if not skill_steps and unified_agent.bound_skills:
            skill_service = get_skill_service()
            t0 = time.monotonic()
            user_addr_int = _parse_user_address_int(request.user_address)
            manual_results: list[dict[str, Any]] = []
            for sid in unified_agent.bound_skills:
                manual_results.append(
                    await skill_service.execute_skill(
                        sid,
                        {},
                        user_address=user_addr_int,
                    )
                )
            return _legacy_execution_from_skill_results(
                agent_id=agent_id,
                agent_name=unified_agent.name,
                skill_results=manual_results,
                total_time_ms=int((time.monotonic() - t0) * 1000),
                human_readable_output=result.final_decision,
            )

        return _legacy_execution_from_unified(
            agent_id=agent_id,
            agent_name=unified_agent.name,
            orchestration_result=result,
        )

    # Fallback legacy execution
    service = get_agent_service()
    try:
        return await service.execute_agent(
            agent_id=agent_id,
            user_address=request.user_address,
            portfolio=request.portfolio,
            constraints=request.constraints,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/create")
async def create_agent(request: CreateAgentRequest):
    """Create agent. Unified v2 by default, legacy fallback when requested/needed."""
    service = get_agent_service()
    if request.use_legacy:
        try:
            return await service.create_agent(
                user_address=request.user_address,
                name=request.name,
                processors=request.processors,
                decision_logic=request.decision_logic,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    skills, unsupported = _normalize_processors_to_skills(request.processors)
    if not skills and unsupported:
        # Nothing mappable to v2 skills -> fallback to legacy.
        try:
            return await service.create_agent(
                user_address=request.user_address,
                name=request.name,
                processors=request.processors,
                decision_logic=request.decision_logic,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    if unsupported:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unsupported_processors",
                "unsupported": unsupported,
                "message": "Some selected models cannot be represented as unified skills yet.",
            },
        )

    agent_id = hashlib.sha256(
        f"{request.user_address}:{request.name}:{time.time()}".encode()
    ).hexdigest()[:16]

    config = AgentConfig(
        agent_id=agent_id,
        owner_address=request.user_address,
        name=request.name,
        identity_commitment=request.identity_commitment,
        bound_skills=skills,
        llm_provider_id=request.llm_provider,
        llm_model=request.llm_model,
    )
    orchestrator = get_orchestrator()
    reg = orchestrator.register_agent(config)

    return {
        "id": agent_id,
        "owner": request.user_address,
        "name": request.name,
        "processors": [_processor_alias_for_skill(s) for s in skills],
        "decision_logic": {"type": "AND"},
        "active": True,
        "created_at": int(time.time()),
        "stack": "unified_v2",
        "skills": skills,
        "llm_provider": request.llm_provider,
        "llm_model": request.llm_model,
        "onchain": reg.get("onchain"),
    }


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """Get agent details. Unified v2 first, then legacy fallback."""
    orchestrator = get_orchestrator()
    unified = orchestrator.get_agent(agent_id)
    if unified:
        return {
            "id": unified.agent_id,
            "owner": unified.owner_address,
            "name": unified.name,
            "processors": [_processor_alias_for_skill(s) for s in unified.bound_skills],
            "decision_logic": {"type": "AND"},
            "active": unified.active,
            "created_at": int(time.time()),
            "stack": "unified_v2",
            "skills": list(unified.bound_skills),
            "llm_provider": unified.llm_provider_id,
            "llm_model": unified.llm_model,
            "reputation_tier": unified.reputation_tier,
        }

    service = get_agent_service()
    agent = await service.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("/user/{user_address}")
async def get_user_agents(user_address: str):
    """List agents for a user across unified and legacy stacks."""
    unified_rows = get_orchestrator().list_agents(owner=user_address)
    unified_agents = [_legacy_agent_from_unified(row) for row in unified_rows]

    legacy_agents = await get_agent_service().get_user_agents(user_address)
    for legacy in legacy_agents:
        legacy.setdefault("stack", "legacy_v1")
        legacy.setdefault("skills", [])

    merged: dict[str, dict[str, Any]] = {}
    for row in legacy_agents:
        merged[row.get("id")] = row
    for row in unified_agents:
        merged[row.get("id")] = row  # prefer unified on ID collision

    return {"agents": list(merged.values())}


@router.post("/execute")
async def execute_agent(request: ExecuteAgentRequest):
    """Execute with request body agent_id (delegates to path endpoint handler)."""
    if not request.agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    return await execute_agent_path(request.agent_id, request)


@router.delete("/{agent_id}")
async def deactivate_agent(
    agent_id: str,
    user_address: str,
    _caller: str = Depends(require_wallet_owner),
):
    """Deactivate agent across unified/legacy stacks."""
    orchestrator = get_orchestrator()
    unified = orchestrator.get_agent(agent_id)
    if unified:
        if unified.owner_address.lower() != user_address.lower():
            raise HTTPException(status_code=403, detail="Not authorized")
        updated = orchestrator.update_agent(agent_id, {"active": False})
        if not updated:
            raise HTTPException(status_code=500, detail="Failed to deactivate unified agent")
        return {"status": "deactivated", "agent_id": agent_id, "stack": "unified_v2"}

    service = get_agent_service()
    try:
        success = await service.deactivate_agent(agent_id, user_address)
        if not success:
            raise HTTPException(status_code=404, detail="Agent not found")
        return {"status": "deactivated", "agent_id": agent_id, "stack": "legacy_v1"}
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.get("/models/{model_id}/details")
async def get_model_details(model_id: str):
    """Get detailed information about a model/skill."""
    skill_id = PROCESSOR_TO_SKILL.get(model_id, model_id)
    skill = SKILL_DEFINITIONS.get(skill_id)
    if skill:
        circuit_meta = CIRCUIT_REGISTRY.get(skill.circuit_name, {})
        wasm_path = circuit_meta.get("wasm") if circuit_meta else None
        zkey_path = circuit_meta.get("zkey") if circuit_meta else None
        ready = bool(wasm_path and zkey_path and wasm_path.exists() and zkey_path.exists())
        return {
            "id": model_id,
            "skill_id": skill_id,
            "name": skill.name,
            "description": skill.description,
            "category": skill.category,
            "parameters": skill.parameters,
            "circuit": skill.circuit_name,
            "circuit_ready": ready,
            "stack": "unified_v2",
            "processor_alias": _processor_alias_for_skill(skill_id),
        }

    # Legacy fallback
    model = get_agent_service().get_model_details(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.get("/marketplace/stats")
async def get_marketplace_stats():
    """Unified marketplace stats across skills/circuits."""
    models = _build_unified_model_catalog()
    type_counts: dict[str, int] = {}
    for model in models:
        model_type = model.get("type", "unknown")
        type_counts[model_type] = type_counts.get(model_type, 0) + 1
    return {
        "total_models": len(models),
        "models_by_type": type_counts,
        "available_types": list(type_counts.keys()),
        "stack": "unified_v2",
    }


@router.get("/marketplace/featured")
async def get_featured_models():
    """Featured models from the unified catalog."""
    all_models = _build_unified_model_catalog()
    featured = all_models[:6] if len(all_models) >= 6 else all_models
    return {
        "featured": featured,
        "message": "Unified v2 featured models (composable circuit skills + ONNX bridge).",
        "stack": "unified_v2",
    }
