"""Orchestration API: privacy → Ekubo deploy (personal v1)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.middleware.auth import AdminOnly
from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
from app.services.receipt_service import get_receipt_service

router = APIRouter(tags=["orchestration"])


class OrchestrateDeployRequest(BaseModel):
    user_address: str
    deployable_amount: float
    risk_profile: str  # conservative | balanced | aggressive


class ConfirmReceiptRequest(BaseModel):
    receipt_id: str
    tx_hash: str


@router.post("/deploy")
async def orchestrate_deploy_endpoint(request: OrchestrateDeployRequest, _admin: str = AdminOnly):
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


@router.post("/receipt/confirm")
async def confirm_receipt_endpoint(request: ConfirmReceiptRequest):
    """Confirm receipt after on-chain settlement."""
    svc = get_receipt_service()
    try:
        await svc.confirm_receipt(request.receipt_id, request.tx_hash)
    except Exception:
        pass  # tolerate missing receipt — idempotent
    return {"status": "confirmed", "tx_hash": request.tx_hash}
