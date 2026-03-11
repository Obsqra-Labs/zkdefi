"""
API Routes for strategy recommendations
POST /api/v1/strategies/recommend - Get AI allocation recommendation
POST /api/v1/strategies/analyze - Get zkML pool analysis
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field, field_validator
import logging
import hashlib
import json
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Import our services
from app.services.pool_analyzer import analyze_pools, evaluate_pool_for_user
from app.services.llm_engine import LLMEngine
from app.services.zkml.pool_evaluator import PoolRiskEvaluator
from app.services.zkml.pool_data_collector import PoolDataCollector

router = APIRouter(tags=["strategies"])

# Initialize services
llm_engine = LLMEngine()
pool_collector = PoolDataCollector()
pool_evaluator = PoolRiskEvaluator()


# ============================================================================
# zkML Pool Analysis Models
# ============================================================================

class PoolAnalysisRequest(BaseModel):
    """Request for zkML pool analysis"""
    deposit_amount: int  # In smallest unit
    risk_profile: str  # "CONSERVATIVE", "BALANCED", "AGGRESSIVE"
    user_address: str
    
    @field_validator("risk_profile")
    @classmethod
    def validate_profile(cls, v: str) -> str:
        valid = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]
        if v not in valid:
            raise ValueError(f"risk_profile must be one of: {valid}")
        return v

class PoolAnalysisRecommendation(BaseModel):
    """Single pool from analysis"""
    pool_id: str
    pool_name: str
    risk_score: int  # 0-100
    safety_level: str
    confidence: float
    apy: float
    allocation_min: float
    allocation_max: float
    allocation_mid: float
    flags: List[str]

class PoolAnalysisResponse(BaseModel):
    """zkML pool analysis response"""
    timestamp: str
    user_address: str
    deposit_amount: int
    risk_profile: str
    
    # Results
    recommended_pools: List[PoolAnalysisRecommendation]
    primary_pool: Optional[str]
    secondary_pool: Optional[str]
    
    # Proofs
    analysis_proof_hash: str
    pool_evaluations_proof: str
    confidence_score: float
    
    # Summary
    summary_text: str


# Request/Response Models
class StrategyRecommendationRequest(BaseModel):
    """User request for strategy recommendation"""
    user_address: str = "anonymous"  # Starknet wallet address (optional for preview)
    risk_profile: str  # "conservative", "balanced", or "aggressive"
    amount: float = 1000.0  # USDC to deploy

    @field_validator("risk_profile")
    @classmethod
    def validate_profile(cls, v: str) -> str:
        v = v.lower().strip()
        if v == "moderate":
            v = "balanced"
        if v not in ["conservative", "balanced", "aggressive"]:
            raise ValueError("risk_profile must be one of: conservative, balanced, aggressive, moderate")
        return v

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("amount must be positive")
        if v > 1_000_000:
            raise ValueError("amount too large (max $1M for MVP)")
        return v


class ZkMLSignal(BaseModel):
    """zkML verification signal for a pool recommendation"""
    circuit: str
    verified: bool
    proof_type: str  # "Groth16" | "STARK"
    constraint: str
    fact_registry: str


class PoolRecommendation(BaseModel):
    """Single pool in recommendation"""
    pool_id: str
    protocol: str
    pair: str
    allocation_percent: float  # 0-100
    allocation_amount: float  # USD
    expected_apy: float  # e.g., 0.15 = 15%
    risk_score: float  # 0-100
    risk_flags: List[str]  # ["low_liquidity", "high_volatility"]
    zkml_signal: Optional[ZkMLSignal] = None
    adapter_ready: bool = True  # Whether the adapter is deployed and wired on-chain


class ProvenanceInfo(BaseModel):
    """On-chain provenance for the recommendation"""
    fact_registry: str
    garaga_verifier: str
    circuits_used: List[str]
    proof_types: List[str]
    settlement: str


class StrategyRecommendationResponse(BaseModel):
    """AI-recommended strategy"""
    user_address: str
    risk_profile: str
    total_amount: float
    recommended_pools: List[PoolRecommendation]
    
    # LLM-generated reasoning
    ai_reasoning: str
    ai_confidence: float  # 0-1
    expected_portfolio_apy: float  # Expected blended APY
    portfolio_risk_assessment: str
    
    # Audit trail
    recommendation_id: str  # For tracking decisions
    timestamp: str

    # Phase E: zkML provenance
    attestation_hash: Optional[str] = None
    provenance: Optional[ProvenanceInfo] = None
    genome: Optional[Dict[str, float]] = None  # {yield, risk, volatility, liquidity, efficiency} 0-100


# Compatibility request model used by `/mvp` execution flow.
class ExecuteAdvancedRequest(BaseModel):
    user_address: str
    risk_profile: str
    total_amount: Optional[float] = None
    deposit_amount: Optional[float] = None
    recommendation_id: Optional[str] = None
    allocations: Optional[List[Dict[str, Any]]] = None
    recommended_pools: Optional[List[Dict[str, Any]]] = None


# ============================================================================
# ENDPOINT 1: zkML Pool Analysis (Transparent, Verifiable)
# ============================================================================

@router.post("/analyze", response_model=PoolAnalysisResponse)
async def analyze_strategy(request: PoolAnalysisRequest):
    """
    Analyze pools using deterministic zkML circuit.
    
    Returns:
    - Pool risk scores (0-100) with deterministic hash proofs
    - Recommendations filtered by risk profile
    - Confidence metrics for each pool
    
    Example:
        POST /api/v1/strategies/analyze
        {
            "deposit_amount": 1000000000,
            "risk_profile": "BALANCED",
            "user_address": "0x..."
        }
    """
    try:
        timestamp = datetime.now(timezone.utc).isoformat()
        logger.info(f"Analyzing pools for {request.risk_profile} profile")
        
        # Fetch pools
        lp_pools, yield_rates = pool_collector.get_all_pools()
        if not lp_pools:
            raise HTTPException(status_code=500, detail="No pools available")
        
        # Evaluate all pools (deterministic)
        evaluations = pool_evaluator.evaluate_multiple(lp_pools)
        logger.info(f"Evaluated {len(evaluations)} pools")
        
        # Filter by risk profile
        filtered = _filter_by_profile(evaluations, request.risk_profile)
        if not filtered:
            filtered = sorted(evaluations, key=lambda x: x.risk_score)[:3]
        
        # Rank by risk-adjusted returns
        ranked = pool_evaluator.rank_by_risk_adjusted_apy(
            filtered,
            {p.pool_id: yield_rates.get(p.pool_id, 0) for p in filtered}
        )
        
        # Build recommendations
        recommendations = []
        for eval_obj, risk_adj_apy in ranked:
            recommendations.append(PoolAnalysisRecommendation(
                pool_id=eval_obj.pool_id,
                pool_name=eval_obj.pool_name,
                risk_score=eval_obj.risk_score,
                safety_level=eval_obj.safety_level,
                confidence=eval_obj.confidence,
                apy=risk_adj_apy,
                allocation_min=eval_obj.recommended_allocation_min,
                allocation_max=eval_obj.recommended_allocation_max,
                allocation_mid=(eval_obj.recommended_allocation_min + eval_obj.recommended_allocation_max) / 2,
                flags=eval_obj.flags,
            ))
        
        # Generate proofs
        pool_evals_proof = hashlib.sha256(
            json.dumps([
                {'pool_id': e.pool_id, 'risk': e.risk_score}
                for e in evaluations
            ], sort_keys=True).encode()
        ).hexdigest()
        
        analysis_dict = {
            'timestamp': timestamp,
            'user': request.user_address,
            'amount': request.deposit_amount,
            'profile': request.risk_profile,
            'pool_evals': pool_evals_proof,
        }
        analysis_proof = hashlib.sha256(
            json.dumps(analysis_dict, sort_keys=True).encode()
        ).hexdigest()
        
        # Summary
        primary = recommendations[0].pool_name if recommendations else None
        secondary = recommendations[1].pool_name if len(recommendations) > 1 else None
        confidence = min(r.confidence for r in recommendations) if recommendations else 0
        
        summary = f"zkML Analysis: {request.risk_profile} profile\n"
        summary += f"Primary: {primary}\n"
        if secondary:
            summary += f"Secondary: {secondary}\n"
        summary += f"Confidence: {int(confidence * 100)}%"
        
        return PoolAnalysisResponse(
            timestamp=timestamp,
            user_address=request.user_address,
            deposit_amount=request.deposit_amount,
            risk_profile=request.risk_profile,
            recommended_pools=recommendations,
            primary_pool=primary,
            secondary_pool=secondary,
            analysis_proof_hash=analysis_proof,
            pool_evaluations_proof=pool_evals_proof,
            confidence_score=confidence,
            summary_text=summary,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pool analysis error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ENDPOINT 2: LLM Strategy Recommendation (Smart, Contextual)
# ============================================================================

@router.post("/recommend", response_model=StrategyRecommendationResponse)
async def recommend_strategy(
    request: StrategyRecommendationRequest
) -> StrategyRecommendationResponse:
    """
    Get AI recommendation for capital allocation using LLM
    
    Example:
        POST /api/v1/strategies/recommend
        {
            "user_address": "0x1234...",
            "risk_profile": "balanced",
            "amount": 1000
        }
    """
    try:
        from app.services.strategy_recommendation_service import get_recommendation
        result = await get_recommendation(
            request.user_address,
            request.amount,
            request.risk_profile,
        )
        recommended_pools = [
            PoolRecommendation(
                **{k: v for k, v in p.items() if k != "zkml_signal"},
                zkml_signal=ZkMLSignal(**p["zkml_signal"]) if p.get("zkml_signal") else None,
            )
            for p in result["recommended_pools"]
        ]

        provenance_raw = result.get("provenance")
        genome_raw = result.get("genome")

        return StrategyRecommendationResponse(
            user_address=result["user_address"],
            risk_profile=result["risk_profile"],
            total_amount=result["total_amount"],
            recommended_pools=recommended_pools,
            ai_reasoning=result["ai_reasoning"],
            ai_confidence=result["ai_confidence"],
            expected_portfolio_apy=result["expected_portfolio_apy"],
            portfolio_risk_assessment=result["portfolio_risk_assessment"],
            recommendation_id=result["recommendation_id"],
            timestamp=result["timestamp"],
            attestation_hash=result.get("attestation_hash"),
            provenance=ProvenanceInfo(**provenance_raw) if provenance_raw else None,
            genome=genome_raw,
        )
    except Exception as e:
        logger.error(f"Strategy recommendation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-advanced")
async def execute_advanced_strategy(request: ExecuteAdvancedRequest):
    """
    Execute recommended strategy via the canonical vault execution engine.

    Accepts legacy `/mvp` payloads and maps them to `vault_execute` request
    shape. This keeps `/agent` and `/mvp` on one backend execution path.
    """
    deposit_amount = float(
        request.deposit_amount
        if request.deposit_amount is not None
        else (request.total_amount if request.total_amount is not None else 0.0)
    )
    if deposit_amount <= 0:
        raise HTTPException(status_code=400, detail="deposit_amount or total_amount must be positive")

    raw_allocations = request.allocations or []
    if not raw_allocations and request.recommended_pools:
        for pool in request.recommended_pools:
            raw_allocations.append(
                {
                    "strategy": pool.get("pool_id") or "ekubo_lp",
                    "percentage": float(pool.get("allocation_percent") or 0.0),
                    "amount": float(pool.get("allocation_amount") or 0.0),
                    "expected_apy": float(pool.get("expected_apy") or 0.0),
                    "pool_id": pool.get("pool_id"),
                    "protocol": pool.get("protocol"),
                    "token_pair": pool.get("pair"),
                    "pool_name": pool.get("pair"),
                }
            )

    if not raw_allocations:
        raise HTTPException(status_code=400, detail="No allocations provided")

    try:
        # Import at call-time to keep startup resilient during partial deployments.
        from app.api.routes.vault_execute import (
            AllocationDetail as VaultAllocationDetail,
            ExecuteStrategyRequest as VaultExecuteStrategyRequest,
            execute_strategy as vault_execute_strategy,
        )
    except Exception as exc:
        logger.error("Vault execution route unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="Vault execution engine unavailable")

    allocations: list[VaultAllocationDetail] = []
    for alloc in raw_allocations:
        allocations.append(
            VaultAllocationDetail(
                strategy=str(alloc.get("strategy") or alloc.get("pool_id") or "allocation"),
                percentage=float(alloc.get("percentage") or 0.0),
                amount=float(alloc.get("amount") or 0.0),
                expected_apy=float(alloc.get("expected_apy") or 0.0),
                pool_id=alloc.get("pool_id"),
                pool_name=alloc.get("pool_name"),
                protocol=alloc.get("protocol"),
                token_pair=alloc.get("token_pair"),
            )
        )

    vault_request = VaultExecuteStrategyRequest(
        user_address=request.user_address,
        risk_profile=request.risk_profile,
        deposit_amount=deposit_amount,
        allocations=allocations,
    )
    return await vault_execute_strategy(vault_request)


# ============================================================================
# ENDPOINT 3: Opportunity Discovery (unified feed for Oracle Dashboard)
# ============================================================================

class OpportunitiesRequest(BaseModel):
    user_address: str
    risk_profile: str = "balanced"
    limit: int = 20


def _composite_score(apy_bps: int, volatility_bps: int) -> float:
    return round(max(0.0, apy_bps - volatility_bps * 0.5) / 100, 2)


@router.post("/opportunities")
async def get_opportunities(request: OpportunitiesRequest):
    """
    Unified opportunity feed for the Oracle Dashboard Strip.
    Merges oracle market data with LLM strategy recommendations.
    """
    opportunities: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        from app.services.mainnet_oracle import get_oracle
        oracle = get_oracle()
        snapshot = oracle.get_latest_snapshot()
        if snapshot:
            snap_dict = snapshot.to_dict()
            ekubo = snap_dict.get("ekubo", {})

            opportunities.append({
                "id": "ekubo_eth_usdc",
                "name": "Ekubo ETH/USDC",
                "venue": "ekubo",
                "apy_bps": ekubo.get("apy_bps", 0),
                "tvl": ekubo.get("tvl", 0),
                "risk_level": "medium" if ekubo.get("volatility_bps", 0) > 300 else "low",
                "volatility": min(int(ekubo.get("volatility_bps", 0) / 10), 100),
                "liquidity_score": min(int(ekubo.get("tvl", 0) / 10000), 100) if ekubo.get("tvl") else 50,
                "efficiency": _composite_score(ekubo.get("apy_bps", 0), ekubo.get("volatility_bps", 0)) * 10,
                "composite_score": _composite_score(ekubo.get("apy_bps", 0), ekubo.get("volatility_bps", 0)),
                "source": "oracle",
            })
    except Exception as exc:
        logger.debug("oracle unavailable for opportunities: %s", exc)

    try:
        from app.services.strategy_recommendation_service import get_recommendation
        rec = await get_recommendation(request.user_address, 1000.0, request.risk_profile)
        for pool in rec.get("recommended_pools", []):
            opp_id = pool.get("pool_id", "")
            if any(o["id"] == opp_id for o in opportunities):
                continue
            apy_bps = int(pool.get("expected_apy", 0) * 10000)
            risk_score = pool.get("risk_score", 50)
            opportunities.append({
                "id": opp_id,
                "name": pool.get("pair", opp_id),
                "venue": pool.get("protocol", "ekubo"),
                "apy_bps": apy_bps,
                "risk_level": "low" if risk_score < 30 else ("high" if risk_score > 60 else "medium"),
                "volatility": int(risk_score * 0.8),
                "liquidity_score": 50,
                "efficiency": _composite_score(apy_bps, int(risk_score * 5)) * 10,
                "composite_score": _composite_score(apy_bps, int(risk_score * 5)),
                "source": "llm",
            })
    except Exception as exc:
        logger.debug("strategy recommendation unavailable for opportunities: %s", exc)

    risk_filter = request.risk_profile.lower()
    if risk_filter == "conservative":
        opportunities = [o for o in opportunities if o.get("risk_level") != "high"]
    elif risk_filter == "aggressive":
        pass

    opportunities.sort(key=lambda o: o.get("composite_score", 0), reverse=True)
    opportunities = opportunities[:request.limit]

    return {
        "opportunities": opportunities,
        "count": len(opportunities),
        "timestamp": now_iso,
    }


@router.get("/health")
async def health_check():
    """Health check for strategies endpoint"""
    zkml_pools = 0
    if pool_collector:
        try:
            lp_pools, _ = await pool_collector.get_all_pools()
            zkml_pools = len(lp_pools)
        except Exception:
            pass
    return {
        "status": "healthy",
        "llm_available": llm_engine.use_llm,
        "fallback_available": True,
        "zkml_pools_available": zkml_pools,
    }


# ============================================================================
# Helper Functions
# ============================================================================

def _filter_by_profile(evaluations, risk_profile: str):
    """Filter pools based on user's risk profile"""
    if risk_profile == "CONSERVATIVE":
        # Only safe pools (risk < 30)
        return [e for e in evaluations if e.risk_score < 30]
    elif risk_profile == "BALANCED":
        # Safe and moderate (risk < 60)
        return [e for e in evaluations if e.risk_score < 60]
    elif risk_profile == "AGGRESSIVE":
        # All pools available
        return evaluations
    return evaluations
