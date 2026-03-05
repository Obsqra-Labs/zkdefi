"""
Agent Rebalancer API endpoints.

Endpoints:
- /api/v1/zkdefi/rebalancer/analyze - Analyze portfolio
- /api/v1/zkdefi/rebalancer/propose - Create rebalancing proposal
- /api/v1/zkdefi/rebalancer/check - Run zkML gate checks
- /api/v1/zkdefi/rebalancer/prepare - Prepare execution
- /api/v1/zkdefi/rebalancer/execute - Execute rebalancing
- /api/v1/zkdefi/rebalancer/autonomous/start - Start autonomous agent
- /api/v1/zkdefi/rebalancer/autonomous/stop - Stop autonomous agent
- /api/v1/zkdefi/rebalancer/autonomous/status - Get agent status
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..middleware.auth import require_wallet_owner, require_admin
from typing import Any, Optional, Literal
import os

from app.services.agent_rebalancer import get_rebalancer
from app.services.autonomous_agent import get_autonomous_agent, MonitoringConfig
from app.services.policy_engine import check as policy_check

router = APIRouter()


# ==================== Request Models ====================

class AnalyzeRequest(BaseModel):
    """Request to analyze portfolio."""
    user_address: str
    positions: dict[str, int]  # protocol_id (as string) -> amount


class ProposeRequest(BaseModel):
    """Request to propose rebalancing."""
    user_address: str
    from_protocol: int
    to_protocol: int
    amount: int
    reason: str = "Risk optimization"


class CheckZkmlRequest(BaseModel):
    """Request to check zkML gates."""
    proposal_id: str
    portfolio_features: list[int]
    pool_id: str | None = None


class AdvisoryCheckRequest(BaseModel):
    """Request for non-blocking advisory policy check."""
    user_address: str
    action_type: Literal["swap", "lp_add", "lp_remove", "deploy"]
    pool_id: str
    portfolio_features: list[int]
    context: Optional[dict[str, Any]] = None


class PrepareRequest(BaseModel):
    """Request to prepare execution."""
    proposal_id: str
    session_id: str


class ExecuteRequest(BaseModel):
    """Request to execute rebalancing."""
    proposal_id: str
    session_id: str


class AutonomousStartRequest(BaseModel):
    """Request to start autonomous agent."""
    user_address: str
    session_id: str
    interval_minutes: int = 15
    risk_threshold: int = 50
    min_rebalance_amount: Optional[str] = None  # Wei amount


class AutonomousStopRequest(BaseModel):
    """Request to stop autonomous agent."""
    user_address: str


# ==================== Endpoints ====================

@router.post("/analyze")
async def analyze_portfolio(data: AnalyzeRequest):
    """
    Analyze portfolio and determine if rebalancing is needed.
    
    Returns risk assessment and rebalancing recommendation.
    """
    try:
        rebalancer = get_rebalancer()
        # Convert string keys to int
        positions = {int(k): v for k, v in data.positions.items()}
        result = await rebalancer.analyze_portfolio(
            user_address=data.user_address,
            positions=positions
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/propose")
async def propose_rebalance(data: ProposeRequest):
    """
    Create a rebalancing proposal.
    
    The proposal must pass zkML checks before execution.
    """
    try:
        rebalancer = get_rebalancer()
        proposal = await rebalancer.propose_rebalance(
            user_address=data.user_address,
            from_protocol=data.from_protocol,
            to_protocol=data.to_protocol,
            amount=data.amount,
            reason=data.reason
        )
        return proposal.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/check")
async def check_zkml_gates(data: CheckZkmlRequest):
    """
    Run zkML models to gate the rebalancing proposal.
    
    Both risk score and anomaly detection must pass.
    """
    try:
        rebalancer = get_rebalancer()
        result = await rebalancer.check_zkml_gates(
            proposal_id=data.proposal_id,
            portfolio_features=data.portfolio_features,
            pool_id=data.pool_id
        )
        return result
    except RuntimeError as e:
        if "retry later" in str(e).lower():
            raise HTTPException(status_code=503, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/advisory-check")
async def advisory_check(data: AdvisoryCheckRequest):
    """
    Run a non-blocking policy check for manual actions.

    This endpoint never creates proposals and is intended for
    post-submit/advisory UX only.
    """
    enabled = os.getenv("REBALANCER_ADVISORY_CHECK_ENABLED", "true").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enabled:
        return {
            "advisory_only": True,
            "can_proceed": True,
            "risk_passed": True,
            "anomaly_passed": True,
            "reason": "advisory check disabled",
        }

    context = data.context or {}
    try:
        payload = {
            "proposal_id": f"advisory_{data.action_type}",
            "portfolio_features": data.portfolio_features,
            "pool_id": data.pool_id,
            "from_protocol": context.get("from_protocol", 0),
            "to_protocol": context.get("to_protocol", 1),
            "amount": context.get("amount", 1),
            "reason": f"advisory:{data.action_type}",
        }
        policy = await policy_check(
            user_address=data.user_address,
            action_type="rebalance",
            payload=payload,
        )
        risk_result = policy.get("risk_result") or {}
        anomaly_result = policy.get("anomaly_result") or {}
        return {
            "advisory_only": True,
            "can_proceed": bool(policy.get("allowed", False)),
            "risk_passed": bool(risk_result.get("is_compliant", False)),
            "anomaly_passed": bool(anomaly_result.get("is_safe", False)),
            "snapshot_hash": policy.get("snapshot_hash"),
            "commitment_hash": policy.get("commitment_hash"),
            "reason": policy.get("reason") or None,
        }
    except RuntimeError as e:
        if "retry later" in str(e).lower():
            raise HTTPException(status_code=503, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prepare")
async def prepare_execution(data: PrepareRequest):
    """
    Prepare the rebalancing execution.
    
    Validates session key and generates execution proofs.
    """
    try:
        rebalancer = get_rebalancer()
        result = await rebalancer.prepare_execution(
            proposal_id=data.proposal_id,
            session_id=data.session_id
        )
        return result
    except RuntimeError as e:
        if "retry later" in str(e).lower():
            raise HTTPException(status_code=503, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute")
async def execute_rebalance(http_request: Request, data: ExecuteRequest):
    """
    Execute the rebalancing.

    In demo mode, returns success without submitting chain transactions.
    """
    if getattr(http_request.state, "demo_mode", False):
        return {
            "success": True,
            "proposal_id": data.proposal_id,
            "session_id": data.session_id,
            "demo": True,
            "message": "Rebalance recorded (demo); no on-chain transaction.",
        }
    try:
        rebalancer = get_rebalancer()
        result = await rebalancer.execute_rebalance(
            proposal_id=data.proposal_id,
            session_id=data.session_id
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/proposal/{proposal_id}")
async def get_proposal(proposal_id: str):
    """Get proposal by ID."""
    rebalancer = get_rebalancer()
    proposal = rebalancer.get_proposal(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return proposal


@router.get("/proposals/{user_address}")
async def get_user_proposals(user_address: str):
    """Get all proposals for a user."""
    rebalancer = get_rebalancer()
    proposals = rebalancer.get_user_proposals(user_address)
    return {
        "user_address": user_address,
        "proposals": proposals,
        "count": len(proposals)
    }


# ==================== Autonomous Agent Endpoints ====================

@router.post("/autonomous/start")
async def start_autonomous_agent(data: AutonomousStartRequest, _caller: str = Depends(require_wallet_owner)):
    """
    Start autonomous monitoring for a user.
    
    The agent will periodically:
    1. Check portfolio conditions
    2. Propose rebalancing if thresholds breached
    3. Run zkML gates
    4. Execute if approved
    
    Requires an active session key.
    """
    try:
        agent = get_autonomous_agent()
        
        # Parse min_rebalance_amount if provided
        min_amount = 100000000000000000  # 0.1 ETH default
        if data.min_rebalance_amount:
            min_amount = int(data.min_rebalance_amount)
        
        config = MonitoringConfig(
            interval_seconds=data.interval_minutes * 60,
            risk_threshold=data.risk_threshold,
            min_rebalance_amount=min_amount
        )
        
        result = await agent.start(
            user_address=data.user_address,
            session_id=data.session_id,
            config=config
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autonomous/stop")
async def stop_autonomous_agent(data: AutonomousStopRequest, _caller: str = Depends(require_wallet_owner)):
    """
    Stop autonomous monitoring for a user.
    
    Gracefully stops the background monitoring task.
    """
    try:
        agent = get_autonomous_agent()
        result = await agent.stop(data.user_address)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autonomous/status/{user_address}")
async def get_autonomous_status(user_address: str):
    """
    Get the status of autonomous agent for a user.
    
    Returns current state, check count, actions taken, etc.
    """
    agent = get_autonomous_agent()
    state = agent.get_agent_state(user_address)
    return state


@router.post("/autonomous/pause/{user_address}")
async def pause_autonomous_agent(user_address: str, _caller: str = Depends(require_wallet_owner)):
    """Pause the autonomous agent (keeps state)."""
    try:
        agent = get_autonomous_agent()
        result = await agent.pause(user_address)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autonomous/resume/{user_address}")
async def resume_autonomous_agent(user_address: str, _caller: str = Depends(require_wallet_owner)):
    """Resume a paused autonomous agent."""
    try:
        agent = get_autonomous_agent()
        result = await agent.resume(user_address)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autonomous/all")
async def get_all_autonomous_agents(_admin: str = Depends(require_admin)):
    """Get status of all autonomous agents (admin endpoint)."""
    agent = get_autonomous_agent()
    agents = agent.get_all_agents()
    return {
        "agents": agents,
        "count": len(agents)
    }
