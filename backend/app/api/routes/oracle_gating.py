"""
Oracle Gating Engine API Routes.

Provides endpoints for:
- GET /api/v1/zkdefi/policies/{address} - Fetch user policy
- POST /api/v1/zkdefi/policies - Create/update policy
- GET /api/v1/zkdefi/policies/default - Fetch default policy
- POST /api/v1/zkdefi/oracle/should-execute - Evaluate signal gating
- GET /api/v1/zkdefi/oracle/gated-signals - Only circuit-verified signals
"""

import logging
from typing import Optional

from fastapi import APIRouter, Query, HTTPException, Body
from app.middleware.auth import AdminOnly
from app.services.execution_policy_service import get_execution_policy_service

router = APIRouter(tags=["oracle-gating"])
logger = logging.getLogger(__name__)

policy_service = get_execution_policy_service()


@router.get("/api/v1/zkdefi/policies/default")
async def get_default_policy():
    """Get default policy template."""
    return policy_service._default_policy("template")


@router.get("/api/v1/zkdefi/policies/{address}")
async def get_policy(address: str):
    """Get policy for an address."""
    try:
        policy = policy_service.get_policy(address)
        return policy.data
    except Exception as e:
        logger.error(f"Failed to fetch policy for {address}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/v1/zkdefi/policies")
async def set_policy(
    address: str = Query(...),
    policy_data: dict = Body(...),
    _admin: str = AdminOnly,
):
    """Create or update policy for an address."""
    try:
        policy = policy_service.set_policy(address, policy_data)
        return {
            "success": True,
            "address": address,
            "policy": policy.data,
            "message": "Policy saved",
        }
    except Exception as e:
        logger.error(f"Failed to set policy for {address}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/v1/zkdefi/oracle/should-execute")
async def should_execute(
    address: str = Query(...),
    signal: dict = Body(...),
    _admin: str = AdminOnly,
):
    """
    Evaluate if a signal is gated for execution.
    
    Returns:
    - allowed: bool
    - reason: str
    - policy_applied: dict
    """
    try:
        result = policy_service.evaluate_signal(address, signal)
        return result
    except Exception as e:
        logger.error(f"Failed to evaluate signal for {address}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/v1/zkdefi/oracle/gated-signals")
async def get_gated_signals(
    address: str = Query(...),
    limit: int = Query(5, ge=1, le=20)
):
    """
    Get only circuit-verified signals that pass policy gates.
    
    Phase 1: Returns empty (no circuits yet).
    Phase 2+: Real gated signals.
    """
    return {
        "address": address,
        "signals": [],
        "metadata": {
            "total": 0,
            "phase": "phase-1-placeholder",
            "message": "Circuit verification not yet implemented",
            "note": "Use /api/v1/zkdefi/signals/top and check with /oracle/should-execute",
        }
    }


@router.get("/api/v1/zkdefi/oracle/status")
async def oracle_status():
    """Health check for oracle gating system."""
    return {
        "status": "operational",
        "phase": "phase-3-gating",
        "components": {
            "policy_service": "active",
            "gating_engine": "active",
            "circuit_verification": "pending",
        },
        "readiness": {
            "policy_gating": True,
            "risk_filtering": True,
            "circuit_verification": False,
        }
    }
