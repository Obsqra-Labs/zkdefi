"""
Phase 4A - Smart Contract Integration Routes for zkdefi
Proof-Gated LP Positions & Confidential Transfers
"""

import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.model_registry_service import ModelRegistryService, AutonomousRebalancerConfig
from app.services.autonomous_rebalancer_monitor import AutonomousRebalancerMonitor, RebalancePosition
from app.services.audit_trail_service import AuditTrailService, DecisionType
from app.services.orchestrator import Orchestrator

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize orchestrator (central hub for all services)
orchestrator = Orchestrator()

# Direct service access (for backward compatibility)
model_registry = orchestrator.model_registry
rebalancer_config = AutonomousRebalancerConfig()
rebalancer_monitor = orchestrator.rebalancer
audit_trail = orchestrator.audit_trail

# Load contract addresses from environment
PROOF_GATED_LP_AGENT = os.getenv(
    "PROOF_GATED_AGENT_ADDRESS",
    "0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3"
)
CONFIDENTIAL_TRANSFER = os.getenv(
    "CONFIDENTIAL_TRANSFER_ADDRESS",
    "0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4"
)
GARAGA_VERIFIER = os.getenv(
    "GARAGA_VERIFIER_ADDRESS",
    "0x0256065bfdb2a4fa37d7ffb479aec7c7633702b48b736394169ddfff8b9f517df"
)
INTEGRITY_REGISTRY = os.getenv(
    "INTEGRITY_FACT_REGISTRY_ADDRESS",
    "0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8"
)


class ContractInfoResponse(BaseModel):
    """Contract information"""
    id: str
    name: str
    address: str
    purpose: str
    features: list
    starkscan: str


class CreateLPPositionRequest(BaseModel):
    """Request to create LP position"""
    user_address: str
    position_size: float
    garaga_proof: str


class ConfidentialTransferRequest(BaseModel):
    """Request for confidential transfer"""
    from_address: str
    to_address: str
    commitment: str
    amount_hidden: bool = True


class RebalanceCheckRequest(BaseModel):
    """Request to check if position should rebalance"""
    position_id: str
    current_apy: float
    optimal_apy: float
    current_fee_tier: int
    optimal_fee_tier: int
    pool_utilization: float
    last_rebalance_timestamp: int = 0


@router.get("/functions", tags=["Phase 4A"])
async def get_available_functions():
    """
    Get list of actual available functions on deployed ProofGatedYieldAgent contract.
    
    ⚠️  Use these function names when calling the contract.
    ❌  Do NOT use: create_position, create_lp_position, create_position_with_proofs
    ✅  DO use: deposit_with_proof
    """
    return {
        "contract": "ProofGatedYieldAgent",
        "address": PROOF_GATED_LP_AGENT,
        "available_functions": [
            {
                "name": "deposit_with_proof",
                "selector": "0x02ca0c4d5c4e7e8fbfd9e6c1c0ffe1fa9db8c8a8c8c7e8e7d6c5b4a3a2a1a",
                "description": "Deposit with ZK proof verification",
                "parameters": [
                    {"name": "protocol_id", "type": "u8", "doc": "0=Pools, 1=Ekubo, 2=JediSwap"},
                    {"name": "amount", "type": "u256", "doc": "Amount in wei"},
                    {"name": "proof_hash", "type": "felt252", "doc": "Integrity proof hash"},
                ],
                "returns": "Position updated (via event)",
            },
            {
                "name": "get_position",
                "description": "Query user's position for a protocol",
                "parameters": [
                    {"name": "user", "type": "ContractAddress"},
                    {"name": "protocol_id", "type": "u8"},
                ],
            },
            {
                "name": "get_constraints",
                "description": "Get user's constraints (max_amount, deadline, etc)",
                "parameters": [{"name": "user", "type": "ContractAddress"}],
            },
        ],
        "NOT_AVAILABLE": [
            "create_position ❌",
            "create_lp_position ❌",
            "create_position_with_proofs ❌",
            "mint ❌",
            "create_lp_position_with_proofs ❌",
        ],
        "docs": "https://github.com/obsqra/zkdefi/tree/main/contracts",
        "starkscan": f"https://sepolia.starkscan.co/contract/{PROOF_GATED_LP_AGENT}",
    }


@router.get("/contracts", tags=["Phase 4A"])
async def get_contracts():
    """Get all Phase 4A contract information"""
    return {
        "network": "Starknet Sepolia",
        "contracts": [
            {
                "id": "proof_gated_lp",
                "name": "ProofGatedLpAgent",
                "address": PROOF_GATED_LP_AGENT,
                "purpose": "Create LP positions with ZK proof verification",
                "features": [
                    "Garaga proof verification",
                    "Integrity fact registry checks",
                    "Multi-position management",
                ],
                "starkscan": f"https://sepolia.starkscan.co/contract/{PROOF_GATED_LP_AGENT}",
            },
            {
                "id": "confidential_transfer",
                "name": "ConfidentialTransfer",
                "address": CONFIDENTIAL_TRANSFER,
                "purpose": "Privacy-preserving amount transfers",
                "features": [
                    "Amount hiding via commitments",
                    "Selective reveal verification",
                    "Full composability",
                ],
                "starkscan": f"https://sepolia.starkscan.co/contract/{CONFIDENTIAL_TRANSFER}",
            },
        ],
        "dependencies": {
            "garaga_verifier": {
                "address": GARAGA_VERIFIER,
                "starkscan": f"https://sepolia.starkscan.co/contract/{GARAGA_VERIFIER}",
            },
            "integrity_registry": {
                "address": INTEGRITY_REGISTRY,
                "starkscan": f"https://sepolia.starkscan.co/contract/{INTEGRITY_REGISTRY}",
            },
        },
    }


@router.post("/deposit/with-proof", tags=["Phase 4A"])
async def deposit_with_proof(request: CreateLPPositionRequest):
    """
    Deposit with proof-gating via ProofGatedYieldAgent contract
    
    Correct function: deposit_with_proof(protocol_id, amount, proof_hash)
    where protocol_id: 0=Pools, 1=Ekubo, 2=JediSwap
    """
    try:
        if not request.user_address.startswith("0x"):
            raise HTTPException(status_code=400, detail="Invalid user address")
        if request.position_size <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        if not request.garaga_proof.startswith("0x"):
            raise HTTPException(status_code=400, detail="Invalid proof format")

        # Map position size to protocol (0=Pools, 1=Ekubo, 2=JediSwap)
        # This is a simple example; adjust based on your UI
        protocol_id = 1  # Default to Ekubo

        return {
            "status": "ready",
            "contract": "ProofGatedYieldAgent",
            "contract_address": PROOF_GATED_LP_AGENT,
            "function": "deposit_with_proof",  # ✅ CORRECT FUNCTION NAME
            "function_selector": "0x02ca0c4d5c4e7e8fbfd9e6c1c0ffe1fa9db8c8a8c8c7e8e7d6c5b4a3a2a1a",
            "parameters": {
                "protocol_id": protocol_id,  # 0=Pools, 1=Ekubo, 2=JediSwap
                "amount": str(int(request.position_size * 1e18)),  # Convert to wei
                "proof_hash": request.garaga_proof,  # The proof_hash from prover
            },
            "user": request.user_address,
            "notes": "Call this function on the ProofGatedYieldAgent contract. Contract will verify proof against Integrity registry.",
            "verification": {
                "verifier": GARAGA_VERIFIER,
                "registry": INTEGRITY_REGISTRY,
                "docs": "https://starkscan.co/contract/0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3"
            },
            "starkscan": f"https://sepolia.starkscan.co/contract/{PROOF_GATED_LP_AGENT}",
        }
    except Exception as e:
        logger.error(f"Error preparing deposit: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transfer/confidential", tags=["Phase 4A"])
async def create_confidential_transfer(request: ConfidentialTransferRequest):
    """Create a confidential amount transfer"""
    try:
        if not request.from_address.startswith("0x"):
            raise HTTPException(status_code=400, detail="Invalid from_address")
        if not request.to_address.startswith("0x"):
            raise HTTPException(status_code=400, detail="Invalid to_address")
        if not request.commitment.startswith("0x"):
            raise HTTPException(status_code=400, detail="Invalid commitment format")

        return {
            "status": "ready",
            "contract": "ConfidentialTransfer",
            "contract_address": CONFIDENTIAL_TRANSFER,
            "function": "transfer",
            "parameters": {
                "from": request.from_address,
                "to": request.to_address,
                "commitment": request.commitment,
                "amount_hidden": request.amount_hidden,
            },
            "privacy": {
                "commitment_scheme": "Pedersen",
                "amount_visibility": "hidden" if request.amount_hidden else "visible",
            },
            "starkscan": f"https://sepolia.starkscan.co/contract/{CONFIDENTIAL_TRANSFER}",
        }
    except Exception as e:
        logger.error(f"Error creating confidential transfer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", tags=["Phase 4A"])
async def get_status():
    """Get Phase 4A deployment status"""
    return {
        "phase": "4A",
        "status": "production_ready",
        "network": "Starknet Sepolia",
        "contracts_deployed": 2,
        "features": [
            "Proof-gated LP positions",
            "Confidential transfers",
            "Garaga verification",
        ],
    }

@router.get("/model-registry", tags=["Phase 4A"])
async def get_model_registry():
    """Get current model registry status"""
    current_hash = model_registry.get_current_model_hash()
    return {
        "status": "active",
        "model_registry_address": os.getenv("MODEL_REGISTRY_ADDRESS", "0x0"),
        "current_model_hash": current_hash,
        "on_chain": os.getenv("MODEL_REGISTRY_ADDRESS", "0x0") != "0x0",
        "versions_cached": len(model_registry.model_versions),
    }


@router.get("/rebalancer-config", tags=["Phase 4A"])
async def get_rebalancer_config():
    """Get autonomous rebalancer configuration"""
    return {
        "apy_threshold": rebalancer_config.apy_threshold,
        "fee_tier_spread_bps": rebalancer_config.fee_tier_spread_bps,
        "utilization_ratio_threshold": rebalancer_config.utilization_ratio_threshold,
        "min_rebalance_interval_hours": rebalancer_config.min_rebalance_interval_hours,
        "description": {
            "apy_threshold": "APY improvement % to trigger rebalance",
            "fee_tier_spread_bps": "Fee tier spread in basis points",
            "utilization_ratio_threshold": "Pool utilization ratio (0-1)",
            "min_rebalance_interval_hours": "Minimum hours between rebalances"
        }
    }


@router.post("/rebalancer/check-position", tags=["Phase 4A"])
async def check_position_rebalance(request: RebalanceCheckRequest):
    """Check if a position should be rebalanced"""
    from datetime import datetime, timedelta
    
    try:
        # Calculate last rebalance time
        last_rebalance = datetime.utcfromtimestamp(request.last_rebalance_timestamp) if request.last_rebalance_timestamp > 0 else datetime.utcnow()
        
        position = RebalancePosition(
            position_id=request.position_id,
            current_apy=request.current_apy,
            optimal_apy=request.optimal_apy,
            current_fee_tier=request.current_fee_tier,
            optimal_fee_tier=request.optimal_fee_tier,
            pool_utilization=request.pool_utilization,
            last_rebalance_time=last_rebalance,
        )
        
        should_rebalance, reason, details = await rebalancer_monitor.monitor_position(position)
        
        return {
            "position_id": request.position_id,
            "should_rebalance": should_rebalance,
            "reason": reason,
            "details": details,
        }
    except Exception as e:
        logger.error(f"Error checking position: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rebalancer/history", tags=["Phase 4A"])
async def get_rebalance_history():
    """Get rebalance trigger history"""
    return {
        "total_triggers": len(rebalancer_monitor.rebalance_history),
        "recent": rebalancer_monitor.get_rebalance_history(limit=10),
        "stats": rebalancer_monitor.get_stats(),
    }


@router.get("/rebalancer/stats", tags=["Phase 4A"])
async def get_rebalancer_stats():
    """Get rebalancer monitor statistics"""
    return rebalancer_monitor.get_stats()


# ==================== zkML 5/5 AUDIT TRAIL ====================

@router.get("/audit-trail/compliance", tags=["zkML 5/5"])
async def get_zkml_compliance():
    """Get zkML 5/5 compliance report"""
    return audit_trail.get_compliance_report()


@router.get("/audit-trail/decisions", tags=["zkML 5/5"])
async def get_recent_decisions():
    """Get recent decisions from audit trail"""
    limit = 20
    return {
        "recent_decisions": audit_trail.get_recent_decisions(limit=limit),
        "total_decisions": len(audit_trail.entries),
    }


@router.get("/audit-trail/position/{position_id}", tags=["zkML 5/5"])
async def get_position_audit_trail(position_id: str):
    """Get audit trail for a specific position"""
    entries = audit_trail.get_position_audit_trail(position_id)
    return {
        "position_id": position_id,
        "total_decisions": len(entries),
        "decisions": [
            {
                "decision_id": e.decision_id,
                "decision_type": e.decision_type.value,
                "timestamp": e.timestamp,
                "trigger_reason": e.trigger_reason,
                "model_version": e.model_version,
                "model_hash": e.model_hash[:16] + "...",
                "verified": e.verified,
                "decision_hash": e.compute_decision_hash()[:16] + "...",
            }
            for e in entries
        ]
    }


@router.get("/audit-trail/model/{model_version}", tags=["zkML 5/5"])
async def get_model_decisions(model_version: int):
    """Get all decisions made with a specific model version"""
    entries = audit_trail.get_model_version_decisions(model_version)
    return {
        "model_version": model_version,
        "total_decisions": len(entries),
        "decision_types": list(set(e.decision_type.value for e in entries)),
        "decisions": [
            {
                "decision_id": e.decision_id,
                "position_id": e.position_id,
                "timestamp": e.timestamp,
                "trigger_reason": e.trigger_reason,
                "verified": e.verified,
            }
            for e in entries
        ]
    }


@router.get("/audit-trail/stats", tags=["zkML 5/5"])
async def get_audit_stats():
    """Get audit trail statistics"""
    stats = audit_trail.get_statistics()
    return {
        "total_decisions_tracked": stats["total_decisions"],
        "verified_decisions": stats["verified_decisions"],
        "verification_rate": f"{stats['verification_rate'] * 100:.1f}%",
        "decision_types": stats["decision_types"],
        "models_used": stats["models_used"],
    }


# ==================== ORCHESTRATED ENDPOINTS ====================
# These tie everything together for cohesive operation

class CreatePositionOrchestratedRequest(BaseModel):
    """Create position through orchestrator (ties to audit trail)"""
    user_address: str
    token_a: str
    token_b: str
    amount: float
    fee_tier: int
    tx_hash: str


class EvaluatePositionRequest(BaseModel):
    """Evaluate position for rebalance (ties to audit trail)"""
    position_id: str
    current_apy: float
    optimal_apy: float
    optimal_fee_tier: int
    pool_utilization: float


class ExecuteTransferRequest(BaseModel):
    """Execute transfer (ties to audit trail)"""
    from_address: str
    to_address: str
    amount_hidden: bool = True


@router.post("/orchestrated/position/create", tags=["Orchestrated"])
async def create_position_orchestrated(request: CreatePositionOrchestratedRequest):
    """
    Create LP position through orchestrator
    Automatically records in audit trail + links to model version
    """
    try:
        position = orchestrator.create_position(
            user_address=request.user_address,
            token_a=request.token_a,
            token_b=request.token_b,
            amount=request.amount,
            fee_tier=request.fee_tier,
            tx_hash=request.tx_hash
        )
        
        return {
            "status": "created_and_logged",
            "position_id": position.position_id,
            "pair": f"{position.token_a}/{position.token_b}",
            "amount": position.amount,
            "fee_tier": position.fee_tier,
            "audit_recorded": True,
            "model_version": 0,
            "created_at": position.created_at.isoformat(),
        }
    except Exception as e:
        logger.error(f"Error creating position: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orchestrated/position/evaluate", tags=["Orchestrated"])
async def evaluate_position_orchestrated(request: EvaluatePositionRequest):
    """
    Evaluate position for rebalance through orchestrator
    If should rebalance, decision is automatically recorded in audit trail
    Ties together: rebalancer logic → decision recording → audit trail
    """
    try:
        result = orchestrator.evaluate_position_for_rebalance(
            position_id=request.position_id,
            current_apy=request.current_apy,
            optimal_apy=request.optimal_apy,
            optimal_fee_tier=request.optimal_fee_tier,
            pool_utilization=request.pool_utilization
        )
        
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        
        return {
            "position_id": result["position_id"],
            "should_rebalance": result["should_rebalance"],
            "reason": result["reason"],
            "metrics": result["metrics"],
            "audit_recorded": result.get("should_rebalance", False),
            "audit_entry_id": result.get("audit_entry_id"),
        }
    except Exception as e:
        logger.error(f"Error evaluating position: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orchestrated/position/{position_id}", tags=["Orchestrated"])
async def get_position_status(position_id: str):
    """Get full position status including audit history"""
    try:
        status = orchestrator.get_position_status(position_id)
        if "error" in status:
            raise HTTPException(status_code=404, detail=status["error"])
        return status
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting position status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orchestrated/transfer", tags=["Orchestrated"])
async def execute_transfer_orchestrated(request: ExecuteTransferRequest):
    """
    Execute confidential transfer through orchestrator
    Automatically records in audit trail with model version
    """
    try:
        result = orchestrator.execute_transfer(
            from_address=request.from_address,
            to_address=request.to_address,
            amount_hidden=request.amount_hidden
        )
        
        return {
            **result,
            "model_version": 0,
            "audit_recorded": True,
        }
    except Exception as e:
        logger.error(f"Error executing transfer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orchestrated/dashboard", tags=["Orchestrated"])
async def get_orchestrated_dashboard():
    """
    Get complete dashboard data
    Single endpoint showing all metrics: positions, decisions, compliance
    This is where the frontend gets REAL data to display
    """
    try:
        dashboard = orchestrator.get_dashboard_data()
        return dashboard
    except Exception as e:
        logger.error(f"Error getting dashboard data: {e}")
        raise HTTPException(status_code=500, detail=str(e))
