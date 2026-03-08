"""
Agent Execution API Routes.

Provides endpoints for:
- POST /api/v1/zkdefi/oracle/execute - Submit signal for execution
- GET /api/v1/zkdefi/oracle/execution/{call_id} - Track execution status
- GET /api/v1/zkdefi/oracle/execution/history/{address} - User execution history
"""

import logging
from typing import Optional

from fastapi import APIRouter, Query, HTTPException, Body
from app.services.agent_orchestrator import get_agent_orchestrator
from app.services.execution_policy_service import get_execution_policy_service

router = APIRouter(tags=["agent-execution"])
logger = logging.getLogger(__name__)

orchestrator = get_agent_orchestrator()
policy_service = get_execution_policy_service()


@router.post("/api/v1/zkdefi/oracle/execute")
async def execute_signal(
    address: str = Query(..., description="User address"),
    request_body: dict = Body(...),
):
    """
    Submit a signal for execution.
    
    Process:
    1. Validate policy gates
    2. Prepare contract call
    3. Submit to relayer
    4. Return tx_hash
    
    Args:
        address: User address
        signal: Signal from /api/v1/zkdefi/signals/top (gated already)
        execution_params: {amount, slippage, privacyLevel, ...}
        
    Returns:
        {tx_hash, call_id, status, submitted_at}
    """
    try:
        signal = request_body.get("signal")
        execution_params = request_body.get("execution_params")
        
        if not signal or not execution_params:
            raise HTTPException(
                status_code=400,
                detail="Missing 'signal' or 'execution_params' in request body"
            )
        
        # Re-gate the signal against current policy
        gate_result = policy_service.evaluate_signal(address, signal)
        if not gate_result["allowed"]:
            raise HTTPException(
                status_code=403,
                detail=f"Signal rejected: {gate_result['reason']}"
            )
        
        # Prepare execution
        call = orchestrator.prepare_execution(signal, address, execution_params)
        
        # Submit to relayer
        submission = orchestrator.submit_execution(call)
        
        return {
            "success": True,
            "call_id": call.id,
            "tx_hash": submission["tx_hash"],
            "status": submission["status"],
            "submitted_at": submission["submitted_at"],
            "address": address,
            "signal_id": signal.get("id"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Execution failed for {address}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/v1/zkdefi/oracle/execution/{call_id}")
async def get_execution(call_id: str):
    """Get execution status for a call."""
    try:
        status = orchestrator.get_execution_status(call_id)
        return status
    except Exception as e:
        logger.error(f"Failed to fetch execution {call_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/v1/zkdefi/oracle/execution/history/{address}")
async def get_execution_history(
    address: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str = Query(None, description="Filter by status (pending|confirmed|failed)"),
):
    """
    Get execution history for a user address (Phase 2+: SQLite persistence).
    
    Args:
        address: User's wallet address
        limit: Max results (1-200, default 50)
        offset: Pagination offset
        status: Optional status filter
        
    Returns:
        {
            "address": address,
            "executions": [{...}],
            "total": count,
            "stats": {
                "pending": count,
                "confirmed": count,
                "failed": count
            }
        }
    """
    try:
        from app.db.execution_store import get_execution_store
        
        store = get_execution_store()
        executions = store.get_user_executions(
            address=address,
            limit=limit,
            offset=offset,
            status=status,
        )
        stats = store.get_stats(address=address)
        
        return {
            "address": address,
            "executions": executions,
            "total": stats.get("total", 0),
            "stats": {
                "pending": stats.get("pending", 0),
                "confirmed": stats.get("confirmed", 0),
                "failed": stats.get("failed", 0),
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch execution history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/v1/zkdefi/oracle/execution/simulate")
async def simulate_execution(
    address: str = Query(..., description="User address"),
    request_body: dict = Body(...),
):
    """
    Simulate execution without submitting to relayer.
    
    Useful for:
    - Previewing outcomes
    - Estimating gas
    - Testing parameters
    """
    try:
        signal = request_body.get("signal")
        execution_params = request_body.get("execution_params")
        
        if not signal or not execution_params:
            raise HTTPException(
                status_code=400,
                detail="Missing 'signal' or 'execution_params' in request body"
            )
        
        call = orchestrator.prepare_execution(signal, address, execution_params)
        
        return {
            "success": True,
            "simulation": {
                "call_id": call.id,
                "adapter": call.adapter,
                "method": call.method,
                "calldata": call.calldata,
                "estimated_gas": call.estimated_gas,
                "estimated_cost_eth": call.estimated_gas * 1e-9 * 50,  # Mock: 50 Gwei
            },
            "note": "Simulation only - not submitted",
        }
    except Exception as e:
        logger.error(f"Simulation failed for {address}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
