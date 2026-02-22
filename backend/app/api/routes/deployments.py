"""
Deployments API - Execute recommended strategies to on-chain pools
POST /api/v1/deployments/execute - Deploy capital to recommended pools
"""

from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, validator
import logging
import hashlib

logger = logging.getLogger(__name__)

from app.services.pool_analyzer import analyze_pools
from app.services.llm_engine import LLMEngine
from app.services.zkml_circuit import get_circuit, CircuitProof

router = APIRouter(tags=["deployments"])

# Initialize services
llm_engine = LLMEngine()
circuit = get_circuit()


# Request/Response Models
class PoolDeployment(BaseModel):
    """Single pool deployment instruction"""
    pool_id: str
    protocol: str  # "Ekubo", "Vesu", etc.
    amount_usdc: float
    allocation_proof: str  # Proof hash from zkML circuit


class DeploymentExecutionRequest(BaseModel):
    """Request to deploy capital"""
    user_address: str
    risk_profile: str
    total_amount: float
    # Either provide allocation directly OR let us compute it
    allocation: Optional[Dict[str, float]] = None


class OnChainCalldata(BaseModel):
    """Calldata for on-chain execution"""
    contract_address: str
    entrypoint: str
    calldata: List[str]  # Starknet calldata format


class DeploymentExecutionResponse(BaseModel):
    """Response with deployment plan & on-chain calldata"""
    deployment_id: str
    user_address: str
    risk_profile: str
    total_amount: float
    
    # Pools to deploy to
    pool_deployments: List[PoolDeployment]
    
    # On-chain actions needed
    on_chain_calls: List[OnChainCalldata]
    
    # Proofs
    allocation_proof: str  # Main zkML proof
    circuit_type: str  # "allocation_valid"
    
    # Audit trail
    recommendation_id: str
    timestamp: str


@router.post("/execute", response_model=DeploymentExecutionResponse)
async def execute_deployment(
    request: DeploymentExecutionRequest,
) -> DeploymentExecutionResponse:
    """
    Execute a strategy deployment
    
    Steps:
    1. Get pool recommendations (or use provided allocation)
    2. Generate zkML proofs for allocation
    3. Create on-chain calldata for each pool
    4. Return deployment plan
    
    Example:
        POST /api/v1/deployments/execute
        {
            "user_address": "0x1234...",
            "risk_profile": "balanced",
            "total_amount": 5000.0
        }
    """
    try:
        # Step 1: Get recommendations if not provided
        if request.allocation is None:
            pools = await analyze_pools(request.risk_profile)
            if not pools:
                raise HTTPException(
                    status_code=400,
                    detail=f"No pools available for {request.risk_profile} profile"
                )

            # Use simple allocation based on profile
            allocation = _get_allocation_for_profile(
                request.risk_profile,
                pools,
            )
        else:
            allocation = request.allocation

            # Validate provided allocation
            total = sum(allocation.values())
            if abs(total - 1.0) > 0.01:
                raise HTTPException(
                    status_code=400,
                    detail=f"Allocation must sum to 100%, got {total*100:.1f}%"
                )

        # Step 2: Generate zkML proof for allocation
        all_pools_list = []
        if request.allocation is None:
            all_pools_list = [
                {
                    "pool_id": p.pool_id,
                    "protocol": str(getattr(p.protocol, 'value', p.protocol)),
                    "risk_score": p.risk_score,
                }
                for p in pools
            ]

        allocation_proof = circuit.prove_allocation_valid(
            user_address=request.user_address,
            pools=all_pools_list,
            allocation_percentages=allocation,
            risk_profile=request.risk_profile,
        )

        logger.info(
            f"Generated allocation proof {allocation_proof.proof_hash[:16]}... "
            f"for {request.user_address[:8]}..."
        )

        # Step 3: Create pool deployments
        pool_deployments: List[PoolDeployment] = []
        on_chain_calls: List[OnChainCalldata] = []

        for pool_id, allocation_pct in allocation.items():
            amount_usdc = request.total_amount * allocation_pct

            # Create deployment record
            pool_deployments.append(
                PoolDeployment(
                    pool_id=pool_id,
                    protocol=_get_protocol_for_pool(pool_id),
                    amount_usdc=amount_usdc,
                    allocation_proof=allocation_proof.proof_hash,
                )
            )

            # Create on-chain calldata for this pool
            calldata = _create_pool_calldata(
                pool_id=pool_id,
                user_address=request.user_address,
                amount_usdc=amount_usdc,
                proof_hash=allocation_proof.proof_hash,
            )
            on_chain_calls.append(calldata)

        # Step 4: Generate deployment ID
        deployment_id = hashlib.sha256(
            f"{request.user_address}_{request.risk_profile}_{len(pool_deployments)}".encode()
        ).hexdigest()[:12]

        from datetime import datetime

        return DeploymentExecutionResponse(
            deployment_id=deployment_id,
            user_address=request.user_address,
            risk_profile=request.risk_profile,
            total_amount=request.total_amount,
            pool_deployments=pool_deployments,
            on_chain_calls=on_chain_calls,
            allocation_proof=allocation_proof.proof_hash,
            circuit_type=allocation_proof.proof_type.value,
            recommendation_id=deployment_id,
            timestamp=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        logger.error(f"Deployment execution error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """Health check for deployments endpoint"""
    return {
        "status": "healthy",
        "circuit_type": "mock",  # Week 3+: "stark"
        "proofs_cached": len(circuit.proof_cache),
    }


def _get_allocation_for_profile(
    risk_profile: str,
    pools: List,
) -> Dict[str, float]:
    """Get pool allocation for this profile"""
    
    lending_pools = [p for p in pools if "Vesu" in p.protocol.value]
    lp_pools = [p for p in pools if "Ekubo" in p.protocol.value]

    if risk_profile == "conservative":
        if lending_pools and lp_pools:
            return {
                lending_pools[0].pool_id: 0.70,
                lp_pools[0].pool_id: 0.30,
            }
        elif lending_pools:
            return {lending_pools[0].pool_id: 1.0}
        elif lp_pools:
            return {lp_pools[0].pool_id: 1.0}

    elif risk_profile == "balanced":
        if lending_pools and len(lp_pools) >= 2:
            return {
                lp_pools[0].pool_id: 0.40,
                lp_pools[1].pool_id: 0.30,
                lending_pools[0].pool_id: 0.30,
            }
        elif lending_pools and lp_pools:
            return {
                lp_pools[0].pool_id: 0.60,
                lending_pools[0].pool_id: 0.40,
            }
        elif lp_pools:
            return {lp_pools[0].pool_id: 1.0}

    else:  # aggressive
        if len(lp_pools) >= 2 and lending_pools:
            return {
                lp_pools[0].pool_id: 0.70,
                lp_pools[1].pool_id: 0.20,
                lending_pools[0].pool_id: 0.10,
            }
        elif len(lp_pools) >= 1:
            return {lp_pools[0].pool_id: 1.0}

    return {}


def _get_protocol_for_pool(pool_id: str) -> str:
    """Get protocol name from pool ID"""
    if "ekubo" in pool_id.lower():
        return "Ekubo"
    elif "vesu" in pool_id.lower():
        return "Vesu"
    elif "jediswap" in pool_id.lower():
        return "JediSwap"
    return "Unknown"


def _create_pool_calldata(
    pool_id: str,
    user_address: str,
    amount_usdc: float,
    proof_hash: str,
) -> OnChainCalldata:
    """
    Create on-chain calldata for pool deployment
    
    In Week 2+, this will target the actual protocol contracts.
    For now, we use a mock vault contract.
    """
    
    protocol = _get_protocol_for_pool(pool_id)
    amount_int = int(amount_usdc * 1e6)  # Convert to USDC units (6 decimals)

    if protocol == "Ekubo":
        # Ekubo LP position
        return OnChainCalldata(
            contract_address="0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384",
            entrypoint="mint_position",
            calldata=[
                user_address,  # recipient
                str(amount_int),  # amount_0 (low)
                "0",  # amount_0 (high)
                str(amount_int),  # amount_1 (low)
                "0",  # amount_1 (high)
                proof_hash,  # commitment proof
            ],
        )
    elif protocol == "Vesu":
        # Vesu lending deposit
        return OnChainCalldata(
            contract_address="0x06a09ccb1137491e3e12dfe5845f2d0a5d75a34ea91782d1f126d2e88e3e3a3f",
            entrypoint="deposit",
            calldata=[
                user_address,  # account
                str(amount_int),  # amount (low)
                "0",  # amount (high)
                proof_hash,  # verification hash
            ],
        )
    else:
        # Generic fallback
        return OnChainCalldata(
            contract_address="0x0000000000000000000000000000000000000000000000000000000000000000",
            entrypoint="deposit",
            calldata=[user_address, str(amount_int), proof_hash],
        )
