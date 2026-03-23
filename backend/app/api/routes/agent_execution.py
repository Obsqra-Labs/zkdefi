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
from app.middleware.auth import AdminOnly
from app.services.agent_orchestrator import get_agent_orchestrator
from app.services.execution_policy_service import get_execution_policy_service
from app.services.zkdefi_agent_service import ZkdefiAgentService
from app.services.gas_oracle import get_gas_oracle
from app.services.agent_performance_service import (
    get_performance_service,
    PeriodPerformance,
)

router = APIRouter(tags=["agent-execution"])
logger = logging.getLogger(__name__)

orchestrator = get_agent_orchestrator()
policy_service = get_execution_policy_service()
proof_gated_service = ZkdefiAgentService()


def _record_execution_perf(
    address: str,
    call_id: str,
    estimated_gas: int,
    proof_count: int = 0,
) -> None:
    """Best-effort performance recording after a signal execution."""
    try:
        svc = get_performance_service()
        svc.record_period(PeriodPerformance(
            period_id=call_id,
            agent_id=address,
            return_bps=0,          # settled later via /settle
            volume=estimated_gas,  # gas as proxy for volume
            proof_count=proof_count,
            successful_actions=1,
            failed_actions=0,
            max_drawdown_bps=0,
        ))
    except Exception as exc:
        logger.warning("Failed to record execution perf: %s", exc)


@router.post("/api/v1/zkdefi/oracle/execute")
async def execute_signal(
    address: str = Query(..., description="User address"),
    request_body: dict = Body(...),
    _admin: str = AdminOnly,
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

        if execution_params.get("adapterId") == "proof_gated_yield_agent":
            model_name = execution_params.get("modelName")
            input_data = execution_params.get("inputData")
            if not model_name or not isinstance(input_data, list) or not input_data:
                raise HTTPException(
                    status_code=400,
                    detail="proof_gated_yield_agent requires execution_params.modelName and execution_params.inputData"
                )

            prepared = await proof_gated_service.prepare_execute_with_ml_proof(
                user_address=address,
                model_name=str(model_name),
                input_data=input_data,
                protocol_id=int(execution_params.get("protocolId", 1)),
                amount=int(execution_params.get("amount", 0)),
                action_type=str(execution_params.get("actionType", "deposit")),
                proof_mode=execution_params.get("proofMode", 2),
                tier=int(execution_params.get("tier", 0)),
                value_eth=float(execution_params.get("valueEth", 0.0)),
                expected_model_hash=int(execution_params.get("expectedModelHash", 0)),
                output_lower_bound=int(execution_params.get("outputLowerBound", 0)),
                output_upper_bound=int(execution_params.get("outputUpperBound", 10000)),
                execution_chain=str(execution_params.get("executionChain", "l3")),
                bridge_circuit=str(execution_params.get("bridgeCircuit", "ModelBridge")),
                execution_proof_hash=str(execution_params.get("executionProofHash", "0x0")),
                intent_commitment=(
                    str(execution_params.get("intentCommitment"))
                    if execution_params.get("intentCommitment") is not None
                    else None
                ),
            )
            if prepared.get("error"):
                raise HTTPException(status_code=400, detail=str(prepared["error"]))

            call_id = orchestrator._generate_call_id(address, signal.get("id", "unknown"))
            return {
                "success": True,
                "call_id": call_id,
                "tx_hash": None,
                "status": "wallet_sign_required",
                "address": address,
                "signal_id": signal.get("id"),
                "wallet_calldata": {
                    "contract": prepared["contract"],
                    "function": prepared["function"],
                    "calldata": prepared["calldata"],
                },
                "proof_context": prepared.get("proof_context"),
            }
        
        # Prepare execution
        call = orchestrator.prepare_execution(signal, address, execution_params)
        
        # Try relayer; if unavailable, return calldata for direct wallet signing
        try:
            submission = await orchestrator.submit_execution(call)
            if submission.get("status") == "rejected" or not submission.get("tx_hash"):
                raise RuntimeError(submission.get("error", "relayer rejected"))

            _record_execution_perf(address, call.id, call.estimated_gas)

            return {
                "success": True,
                "call_id": call.id,
                "tx_hash": submission["tx_hash"],
                "status": submission["status"],
                "submitted_at": submission["submitted_at"],
                "address": address,
                "signal_id": signal.get("id"),
            }
        except Exception as relay_err:
            logger.warning(f"Relayer unavailable ({relay_err}), returning calldata for wallet signing")

            _record_execution_perf(address, call.id, call.estimated_gas)

            return {
                "success": True,
                "call_id": call.id,
                "tx_hash": None,
                "status": "wallet_sign_required",
                "address": address,
                "signal_id": signal.get("id"),
                "wallet_calldata": {
                    "adapter": call.adapter,
                    "method": call.method,
                    "calldata": call.calldata,
                    "estimated_gas": call.estimated_gas,
                },
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
    _admin: str = AdminOnly,
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
        
        gas_oracle = get_gas_oracle()
        estimated_cost_eth = await gas_oracle.estimate_cost_eth(call.estimated_gas)

        return {
            "success": True,
            "simulation": {
                "call_id": call.id,
                "adapter": call.adapter,
                "method": call.method,
                "calldata": call.calldata,
                "estimated_gas": call.estimated_gas,
                "estimated_cost_eth": estimated_cost_eth,
            },
            "note": "Simulation only - not submitted",
        }
    except Exception as e:
        logger.error(f"Simulation failed for {address}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
