"""Orchestration API: privacy → Ekubo deploy (personal v1)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.privacy_ekubo_orchestrator import orchestrate_deploy

router = APIRouter(tags=["orchestration"])


class OrchestrateDeployRequest(BaseModel):
    user_address: str
    deployable_amount: float
    risk_profile: str  # conservative | balanced | aggressive


@router.post("/deploy")
async def orchestrate_deploy_endpoint(request: OrchestrateDeployRequest):
    """Deploy user's deployable amount to Ekubo Sepolia only; record receipt."""
    try:
        result = await orchestrate_deploy(
            user_address=request.user_address,
            deployable_amount=request.deployable_amount,
            risk_profile=request.risk_profile,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Deploy temporarily unavailable; try again later.",
        )
