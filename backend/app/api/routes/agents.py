"""
Agent API Routes for zkde.fi - Create and execute composed agents.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.middleware.auth import WalletOwner
from typing import Dict, Any, List, Optional

from app.services.agent_service import get_agent_service
from app.services.agent_performance_service import get_performance_service, PeriodPerformance

router = APIRouter()


class CreateAgentRequest(BaseModel):
    user_address: str
    name: str
    processors: List[str]
    decision_logic: Dict[str, Any] = {"type": "AND"}
    llm: Optional[Dict[str, Any]] = None


class ExecuteAgentRequest(BaseModel):
    agent_id: Optional[str] = None  # Optional when using path param
    user_address: str
    portfolio: Dict[str, Any] = {}
    constraints: Dict[str, Any] = {}


@router.get("/models/list")
async def list_models():
    """List available models - must be before /{agent_id} to avoid path conflict."""
    service = get_agent_service()
    models = await service.list_available_models()
    return {"models": models}


@router.get("/providers")
async def list_llm_providers():
    """List available LLM providers for agent composition."""
    service = get_agent_service()
    providers = await service.list_llm_providers()
    return {"providers": providers}


@router.post("/{agent_id}/execute")
async def execute_agent_path(agent_id: str, request: ExecuteAgentRequest, _caller: str = WalletOwner):
    """Execute agent by path ID - must be before /{agent_id} to avoid path conflict."""
    service = get_agent_service()
    try:
        result = await service.execute_agent(
            agent_id=agent_id,
            user_address=request.user_address,
            portfolio=request.portfolio,
            constraints=request.constraints
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create")
async def create_agent(request: CreateAgentRequest, _caller: str = WalletOwner):
    service = get_agent_service()
    try:
        agent = await service.create_agent(
            user_address=request.user_address,
            name=request.name,
            processors=request.processors,
            decision_logic=request.decision_logic,
            llm_config=request.llm,
        )
        return agent
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    service = get_agent_service()
    agent = await service.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("/user/{user_address}")
async def get_user_agents(user_address: str):
    service = get_agent_service()
    agents = await service.get_user_agents(user_address)
    return {"agents": agents}


@router.post("/execute")
async def execute_agent(request: ExecuteAgentRequest, _caller: str = WalletOwner):
    service = get_agent_service()
    try:
        result = await service.execute_agent(
            agent_id=request.agent_id,
            user_address=request.user_address,
            portfolio=request.portfolio,
            constraints=request.constraints
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{agent_id}")
async def deactivate_agent(agent_id: str, user_address: str, _caller: str = WalletOwner):
    service = get_agent_service()
    try:
        success = await service.deactivate_agent(agent_id, user_address)
        if not success:
            raise HTTPException(status_code=404, detail="Agent not found")
        return {"status": "deactivated", "agent_id": agent_id}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/models/{model_id}/details")
async def get_model_details(model_id: str):
    """Get detailed information about a specific model."""
    service = get_agent_service()
    model = service.get_model_details(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.get("/marketplace/stats")
async def get_marketplace_stats():
    """Get marketplace statistics."""
    service = get_agent_service()
    models = await service.list_available_models()
    
    # Count by type
    type_counts = {}
    for model in models:
        model_type = model.get("type", "unknown")
        type_counts[model_type] = type_counts.get(model_type, 0) + 1
    
    return {
        "total_models": len(models),
        "models_by_type": type_counts,
        "available_types": list(type_counts.keys()),
    }


@router.get("/marketplace/featured")
async def get_featured_models():
    """Get featured/recommended models for new users."""
    service = get_agent_service()
    all_models = await service.list_available_models()
    
    # Return first 3 models as featured
    featured = all_models[:3] if len(all_models) >= 3 else all_models
    
    return {
        "featured": featured,
        "message": "These models are recommended for getting started with zkde.fi agents"
    }


class SettleRequest(BaseModel):
    period_id: str
    return_bps: int


@router.post("/{agent_id}/performance/settle")
async def settle_performance(agent_id: str, req: SettleRequest):
    """Record settlement P&L for an execution period."""
    perf_service = get_performance_service()
    period = PeriodPerformance(
        period_id=f"{req.period_id}_settle",
        agent_id=agent_id,
        return_bps=req.return_bps,
        volume=0,
        proof_count=0,
        successful_actions=0,
        failed_actions=0,
        max_drawdown_bps=0,
    )
    summary = perf_service.record_period(period)
    return {
        "agent_id": agent_id,
        "settled_period": req.period_id,
        "return_bps": req.return_bps,
        "updated_summary": {
            "cumulative_return_bps": summary.cumulative_return_bps,
            "mean_return_bps": summary.mean_return_bps,
            "win_rate": summary.win_rate,
        },
    }
