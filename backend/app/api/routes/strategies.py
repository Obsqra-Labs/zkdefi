"""
API Routes for strategy recommendations
POST /api/v1/strategies/recommend - Get AI allocation recommendation
POST /api/v1/strategies/analyze - Get zkML pool analysis
POST /api/v1/strategies/analyze-live - Live Ekubo pool analysis with risk engine
GET  /api/v1/strategies/price/live - Live STRK/ETH price from Ekubo oracle
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Request
from pydantic import BaseModel, validator
import logging
import hashlib
import json
from datetime import datetime

logger = logging.getLogger(__name__)

# Import our services
from app.services.pool_analyzer import analyze_pools, evaluate_pool_for_user
from app.services.llm_engine import LLMEngine
from app.services.zkml.pool_evaluator import PoolRiskEvaluator
from app.services.zkml.pool_data_collector import PoolDataCollector
from app.services.risk_engine import score_risk, label_from_string, RiskAssessment
from app.services.pool_metrics import fetch_pool_metrics, get_metrics_summary, PoolMetric
from app.services.constraint_gate import get_constraint_gate, ConstraintVerdict
from app.services.ekubo.oracle_adapter import get_live_prices

router = APIRouter(tags=["strategies"])

# Initialize services
llm_engine = LLMEngine()
pool_collector = PoolDataCollector()
pool_evaluator = PoolRiskEvaluator()


# ============================================================================
# Live Price Endpoint
# ============================================================================

@router.get("/price/live")
async def price_live():
    """Return live STRK/ETH price from Ekubo oracle.

    Single source of price truth for all frontends and backend services.
    Cached 15s server-side (oracle_adapter TTL).

    Returns::

        {
            "strk_eth": 0.00042,
            "strk_usd": 1.05,
            "eth_usd": 2500.0,
            "tick": -7783,
            "source": "ekubo_vwap",
            "cached_at": "2026-02-26T12:00:00Z"
        }
    """
    try:
        prices = await get_live_prices()
        if prices.get("strk_eth") is None:
            raise HTTPException(
                status_code=503,
                detail="Oracle unavailable — no STRK/ETH price from Ekubo API or on-chain RPC",
            )
        return prices
    except HTTPException:
        raise
    except Exception as e:
        logger.error("price/live error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# zkML Pool Analysis Models
# ============================================================================

class PoolAnalysisRequest(BaseModel):
    """Request for zkML pool analysis"""
    deposit_amount: int  # In smallest unit
    risk_profile: str  # "CONSERVATIVE", "BALANCED", "AGGRESSIVE"
    user_address: str
    
    @validator("risk_profile")
    def validate_profile(cls, v):
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
    proof_id: Optional[str] = None
    proof_status: str = "generated"  # generated | submitted | verified
    
    # Summary
    summary_text: str


# Request/Response Models
class StrategyRecommendationRequest(BaseModel):
    """User request for strategy recommendation"""
    user_address: str  # Starknet wallet address
    risk_profile: str  # "conservative", "balanced", or "aggressive"
    amount: float = 1000.0  # USDC to deploy

    @validator("risk_profile")
    def validate_profile(cls, v):
        if v not in ["conservative", "balanced", "aggressive"]:
            raise ValueError("risk_profile must be one of: conservative, balanced, aggressive")
        return v.lower()

    @validator("amount")
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError("amount must be positive")
        if v > 1_000_000:
            raise ValueError("amount too large (max $1M for MVP)")
        return v


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
        timestamp = datetime.utcnow().isoformat()
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
            proof_id=f"pool-{analysis_proof[:16]}",
            proof_status="generated",
            summary_text=summary,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pool analysis error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ENDPOINT 1b: Live Ekubo Pool Analysis (Real data + Risk Engine)
# ============================================================================

class AnalyzeLiveRequest(BaseModel):
    """Request for live pool analysis with risk engine."""
    deposit_amount: float         # USD value to allocate
    risk_profile: str             # "conservative" | "balanced" | "aggressive"
    user_address: str
    time_horizon_days: int = 30   # investment horizon

    @validator("risk_profile")
    def validate_profile(cls, v):
        v_lower = v.strip().lower()
        if v_lower not in ("conservative", "balanced", "aggressive"):
            raise ValueError("risk_profile must be conservative, balanced, or aggressive")
        return v_lower


class LivePoolRecommendation(BaseModel):
    pool_id: str
    protocol: str
    pair: str
    apy_pct: float
    tvl_usd: float
    volume_24h_usd: float
    fee_ratio: float
    risk_tier: str                  # "stable" | "volatile" | "concentrated"
    allocation_pct: float           # suggested % of deposit
    allocation_usd: float           # dollar amount to allocate


class AnalyzeLiveResponse(BaseModel):
    timestamp: str
    user_address: str
    deposit_amount: float
    risk_profile: str
    risk_level: int
    risk_reasoning: str

    recommended_pools: List[LivePoolRecommendation]
    total_allocated_pct: float
    reserve_pct: float              # unallocated (kept in Pool D)
    expected_blended_apy: float
    pool_count: int

    proof_hash: str                 # deterministic hash of the decision
    proof_id: Optional[str] = None  # receipt registry ID
    proof_status: str = "generated"  # generated | submitted | verified


@router.post("/analyze-live", response_model=AnalyzeLiveResponse)
async def analyze_live(request: AnalyzeLiveRequest):
    """
    Analyse live Ekubo pools using the risk engine.

    Returns pool recommendations weighted by risk profile with real APY,
    TVL, and volume data from prod-api.ekubo.org.
    """
    try:
        timestamp = datetime.utcnow().isoformat()

        # 1. Score user risk
        risk_level = label_from_string(request.risk_profile)
        assessment: RiskAssessment = score_risk(
            risk_level=risk_level,
            time_horizon_days=request.time_horizon_days,
        )

        # 2. Fetch live Ekubo pool metrics (cached 5 min)
        all_pools: list[PoolMetric] = await fetch_pool_metrics(
            min_tvl_usd=100.0,  # skip dust pools
            limit=50,
        )

        # 3. Filter by risk tier alignment
        tier_allow = _allowed_tiers(request.risk_profile)
        candidates = [p for p in all_pools if p.risk_tier in tier_allow and p.apy_pct > 0]
        if not candidates:
            # Fallback: any pool with APY
            candidates = [p for p in all_pools if p.apy_pct > 0]

        # 4. Rank by risk-adjusted APY (penalise low TVL)
        def _rank_score(p: PoolMetric) -> float:
            tvl_factor = min(p.tvl_usd / 50_000.0, 1.0)  # ramp up to $50k
            return p.apy_pct * tvl_factor

        candidates.sort(key=_rank_score, reverse=True)

        # 5. Allocate within risk bounds (bounds are decimals 0.0-1.0 → convert to %)
        max_lp_pct = assessment.bounds.max_lp_pct * 100.0
        max_single = assessment.max_single_pool_pct * 100.0
        top_n = min(len(candidates), 5)  # max 5 pools
        selected = candidates[:top_n]

        recommendations: list[LivePoolRecommendation] = []
        remaining_pct = max_lp_pct
        total_apy_weighted = 0.0
        total_allocated = 0.0

        for pool in selected:
            alloc_pct = min(max_single, remaining_pct)
            if alloc_pct <= 0:
                break
            alloc_usd = request.deposit_amount * alloc_pct / 100.0
            recommendations.append(LivePoolRecommendation(
                pool_id=pool.pool_id,
                protocol=pool.protocol,
                pair=pool.pair,
                apy_pct=round(pool.apy_pct, 2),
                tvl_usd=round(pool.tvl_usd, 2),
                volume_24h_usd=round(pool.volume_24h_usd, 2),
                fee_ratio=pool.fee_ratio,
                risk_tier=pool.risk_tier,
                allocation_pct=round(alloc_pct, 2),
                allocation_usd=round(alloc_usd, 2),
            ))
            total_apy_weighted += pool.apy_pct * alloc_pct
            total_allocated += alloc_pct
            remaining_pct -= alloc_pct

        reserve_pct = round(100.0 - total_allocated, 2)
        blended_apy = round(total_apy_weighted / total_allocated, 2) if total_allocated > 0 else 0.0

        # 6. Deterministic proof hash
        proof_input = {
            "timestamp": timestamp,
            "user": request.user_address,
            "amount": request.deposit_amount,
            "risk": request.risk_profile,
            "pools": [r.pool_id for r in recommendations],
            "allocs": [r.allocation_pct for r in recommendations],
        }
        proof_hash = hashlib.sha256(
            json.dumps(proof_input, sort_keys=True).encode()
        ).hexdigest()

        return AnalyzeLiveResponse(
            timestamp=timestamp,
            user_address=request.user_address,
            deposit_amount=request.deposit_amount,
            risk_profile=request.risk_profile,
            risk_level=risk_level,
            risk_reasoning=assessment.reasoning,
            recommended_pools=recommendations,
            total_allocated_pct=round(total_allocated, 2),
            reserve_pct=reserve_pct,
            expected_blended_apy=blended_apy,
            pool_count=len(recommendations),
            proof_hash=proof_hash,
            proof_id=f"anlz-{proof_hash[:16]}",
            proof_status="generated",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"analyze-live error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _allowed_tiers(risk_profile: str) -> set[str]:
    """Which pool risk_tiers are acceptable for a given user profile."""
    if risk_profile == "conservative":
        return {"stable", "blue_chip"}
    elif risk_profile == "balanced":
        return {"stable", "blue_chip", "volatile"}
    else:  # aggressive
        return {"stable", "blue_chip", "volatile", "concentrated"}


# ============================================================================
# ENDPOINT 1c: AI Allocation (Phase B — LLM/deterministic + attestation)
# ============================================================================

class AllocateRequest(BaseModel):
    """Request for AI-driven allocation decision."""
    deposit_amount: float
    risk_profile: str
    user_address: str
    time_horizon_days: int = 30

    @validator("risk_profile")
    def validate_profile(cls, v):
        v_lower = v.strip().lower()
        if v_lower not in ("conservative", "balanced", "aggressive"):
            raise ValueError("risk_profile must be conservative, balanced, or aggressive")
        return v_lower


class AllocatePoolItem(BaseModel):
    pool_id: str
    protocol: str
    pair: str
    weight_pct: float
    amount_usd: float
    expected_apy_pct: float
    risk_tier: str


class AllocateResponse(BaseModel):
    timestamp: str
    risk_profile: str
    deposit_amount: float
    allocations: List[AllocatePoolItem]
    reserve_pct: float
    reserve_usd: float
    blended_apy_pct: float
    reasoning: str
    confidence: float
    source: str                     # "llm" | "deterministic"
    attestation_hash: str
    proof_id: Optional[str] = None
    proof_status: str = "generated"  # generated | submitted | verified


@router.post("/allocate", response_model=AllocateResponse)
async def allocate(request: AllocateRequest):
    """
    AI-driven capital allocation.

    Uses LLM (if OPENAI_API_KEY set) or deterministic scoring to produce
    weighted pool allocations bounded by the risk engine.
    Returns attestation hash for verifiable decision audit.

    Constraint gate: validates onboarding identity + risk bounds before proceeding.
    """
    from app.services.ai_allocation import compute_allocation

    try:
        # ── Constraint gate: enforce onboarding bounds ──
        gate = get_constraint_gate()
        verdict: ConstraintVerdict = gate.check(
            user_address=request.user_address,
            action="allocate",
            requested_amount_usd=request.deposit_amount,
            requested_profile=request.risk_profile,
        )
        if not verdict.allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Constraint gate denied allocation",
                    "violations": verdict.violations,
                    "attestation_hash": verdict.attestation_hash,
                },
            )
        # Use the canonical risk profile from onboarding (may downgrade)
        effective_profile = verdict.risk_profile

        risk_level = label_from_string(effective_profile)
        assessment = score_risk(
            risk_level=risk_level,
            time_horizon_days=request.time_horizon_days,
        )
        pools = await fetch_pool_metrics(min_tvl_usd=100.0, limit=50)

        decision = await compute_allocation(
            assessment=assessment,
            pools=pools,
            deposit_amount=request.deposit_amount,
            user_address=request.user_address,
        )

        # Record allocation in ledger for audit trail
        try:
            from app.services.ledger_service import get_ledger_service
            ledger = get_ledger_service()
            # Record one row per allocated pool so vault overview can display them
            for a in decision.allocations:
                ledger.record_vault_allocation(
                    user_address=request.user_address,
                    strategy_id="ekubo",
                    pool_id=a.pool_id,
                    amount=a.amount_usd,
                    pair=a.pair,
                    status="active",
                    metadata=json.dumps({
                        "source": decision.source,
                        "risk_profile": decision.risk_profile,
                        "attestation": decision.attestation_hash,
                    }),
                )
        except Exception as e:
            logger.warning("Ledger record failed (non-fatal): %s", e)

        return AllocateResponse(
            timestamp=decision.timestamp,
            risk_profile=decision.risk_profile,
            deposit_amount=decision.deposit_amount,
            allocations=[
                AllocatePoolItem(**a.to_dict()) for a in decision.allocations
            ],
            reserve_pct=decision.reserve_pct,
            reserve_usd=decision.reserve_usd,
            blended_apy_pct=decision.blended_apy_pct,
            reasoning=decision.reasoning,
            confidence=decision.confidence,
            source=decision.source,
            attestation_hash=decision.attestation_hash,
            proof_id=f"alloc-{decision.attestation_hash[:16]}",
            proof_status="generated",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"allocate error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Phase C: Execute Allocation → Ekubo LP Positions
# ============================================================================

class ExecuteAllocationRequest(BaseModel):
    """Request to execute an AI-driven allocation as Ekubo LP positions."""
    deposit_amount: float
    risk_profile: str
    user_address: str
    time_horizon_days: int = 30
    owner_address: Optional[str] = None   # LP owner; defaults to vault wallet

    @validator("risk_profile")
    def validate_profile_exec(cls, v):
        v_lower = v.strip().lower()
        if v_lower not in ("conservative", "balanced", "aggressive"):
            raise ValueError("risk_profile must be conservative, balanced, or aggressive")
        return v_lower


class LPPositionResult(BaseModel):
    pool_id: str
    pair: str
    position_id: Optional[str]
    token0: str
    token1: str
    amount0_wei: int
    amount1_wei: int
    amount_usd: float
    fee_tier: int
    status: str
    tx_hash: Optional[str]
    error: Optional[str]
    warnings: List[str]
    calldata: Optional[Dict] = None


class ExecuteAllocationResponse(BaseModel):
    execution_id: str
    attestation_hash: str
    risk_profile: str
    deposit_amount: float
    results: List[LPPositionResult]
    reserve_usd: float
    live_submitted: bool
    allocation_summary: AllocateResponse
    timestamp: str
    proof_id: Optional[str] = None
    proof_status: str = "generated"  # generated | submitted | verified


@router.post("/execute-allocation", response_model=ExecuteAllocationResponse)
async def execute_allocation_endpoint(http_request: Request, request: ExecuteAllocationRequest):
    """
    Phase C: AI allocation → Ekubo LP calldata (+ optional live submit).

    1. Constraint gate check (identity + risk bounds)
    2. Runs the full allocation engine (risk_engine → pool_metrics → ai_allocation)
    3. For each pool allocation, builds Ekubo LP mint_and_deposit calldata
    4. If EXECUTOR_LIVE_SUBMIT=true, signs and broadcasts via starkli
    5. Records everything in the ledger

    Returns combined allocation decision + per-pool execution results.
    Calldata is always returned so the client can sign manually if live submit is off.
    """
    from app.services.ai_allocation import compute_allocation
    from app.services.vault_allocation_executor import execute_allocation
    from app.services.ledger_service import get_ledger_service

    demo_mode = getattr(http_request.state, "demo_mode", False)
    if demo_mode:
        # Ledger-only: compute allocation, debit ledger, record allocations as demo
        gate = get_constraint_gate()
        verdict: ConstraintVerdict = gate.check(
            user_address=request.user_address,
            action="execute",
            requested_amount_usd=request.deposit_amount,
            requested_profile=request.risk_profile,
        )
        effective_profile = verdict.risk_profile if verdict.allowed else request.risk_profile
        risk_level = label_from_string(effective_profile)
        assessment = score_risk(risk_level=risk_level, time_horizon_days=request.time_horizon_days)
        pools = await fetch_pool_metrics(min_tvl_usd=100.0, limit=50)
        decision = await compute_allocation(
            assessment=assessment,
            pools=pools,
            deposit_amount=request.deposit_amount,
            user_address=request.user_address,
        )
        amount_wei = int(request.deposit_amount * 1e18)
        ledger = get_ledger_service()
        try:
            ledger.debit_balance(
                request.user_address,
                amount_wei,
                request_id=None,
                reason="demo_deploy",
                settlement_type="demo",
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        for i, alloc in enumerate(decision.allocations):
            ledger.record_vault_allocation(
                user_address=request.user_address,
                strategy_id=alloc.pool_id,
                pool_id=f"demo_{i}",
                amount=alloc.amount_usd,
                pair=alloc.pair or "",
                status="active",
                is_demo=True,
            )
        results = [
            LPPositionResult(
                pool_id=a.pool_id,
                pair=a.pair or "",
                position_id=None,
                token0="",
                token1="",
                amount0_wei=0,
                amount1_wei=0,
                amount_usd=a.amount_usd,
                fee_tier=0,
                status="recorded",
                tx_hash=None,
                error=None,
                warnings=["demo"],
            )
            for a in decision.allocations
        ]
        alloc_summary = AllocateResponse(
            timestamp=decision.timestamp,
            risk_profile=decision.risk_profile,
            deposit_amount=decision.deposit_amount,
            allocations=[AllocatePoolItem(**a.to_dict()) for a in decision.allocations],
            reserve_pct=decision.reserve_pct,
            reserve_usd=decision.reserve_usd,
            blended_apy_pct=decision.blended_apy_pct,
            reasoning=decision.reasoning,
            confidence=decision.confidence,
            source=decision.source,
            attestation_hash=decision.attestation_hash,
        )
        return ExecuteAllocationResponse(
            execution_id=f"demo_{decision.attestation_hash[:12]}",
            attestation_hash=decision.attestation_hash,
            risk_profile=decision.risk_profile,
            deposit_amount=decision.deposit_amount,
            results=results,
            reserve_usd=decision.reserve_usd,
            live_submitted=False,
            allocation_summary=alloc_summary,
            timestamp=decision.timestamp,
            proof_id=f"exec-{decision.attestation_hash[:16]}",
            proof_status="generated",
        )

    try:
        # ── Constraint gate: enforce onboarding bounds ──
        gate = get_constraint_gate()
        verdict: ConstraintVerdict = gate.check(
            user_address=request.user_address,
            action="execute",
            requested_amount_usd=request.deposit_amount,
            requested_profile=request.risk_profile,
        )
        if not verdict.allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Constraint gate denied execution",
                    "violations": verdict.violations,
                    "attestation_hash": verdict.attestation_hash,
                },
            )
        effective_profile = verdict.risk_profile

        risk_level = label_from_string(effective_profile)
        assessment = score_risk(
            risk_level=risk_level,
            time_horizon_days=request.time_horizon_days,
        )
        pools = await fetch_pool_metrics(min_tvl_usd=100.0, limit=50)

        decision = await compute_allocation(
            assessment=assessment,
            pools=pools,
            deposit_amount=request.deposit_amount,
            user_address=request.user_address,
        )

        # Execute: build LP calldata + optional live submit
        batch = await execute_allocation(
            decision=decision,
            owner=request.owner_address,
            risk_profile=effective_profile,
        )

        # Build allocation summary (same shape as /allocate response)
        alloc_summary = AllocateResponse(
            timestamp=decision.timestamp,
            risk_profile=decision.risk_profile,
            deposit_amount=decision.deposit_amount,
            allocations=[
                AllocatePoolItem(**a.to_dict()) for a in decision.allocations
            ],
            reserve_pct=decision.reserve_pct,
            reserve_usd=decision.reserve_usd,
            blended_apy_pct=decision.blended_apy_pct,
            reasoning=decision.reasoning,
            confidence=decision.confidence,
            source=decision.source,
            attestation_hash=decision.attestation_hash,
        )

        return ExecuteAllocationResponse(
            execution_id=batch.execution_id,
            attestation_hash=batch.attestation_hash,
            risk_profile=batch.risk_profile,
            deposit_amount=batch.deposit_amount,
            results=[LPPositionResult(**r.to_dict()) for r in batch.results],
            reserve_usd=batch.reserve_usd,
            live_submitted=batch.live_submitted,
            allocation_summary=alloc_summary,
            timestamp=batch.timestamp,
            proof_id=f"exec-{batch.attestation_hash[:16]}",
            proof_status="submitted" if batch.live_submitted else "generated",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"execute-allocation error: {e}", exc_info=True)
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

        # Enrich with zkML signal pass when available
        try:
            from app.services.signal_pass_service import compute_signals
            from app.services.ai_allocation import compute_allocation
            from app.services.market_surface_service import get_overview_pairs
            pairs = await get_overview_pairs()
            candidate_pools = [
                {"pool_id": p.get("pool_id", f"{p.get('pair','')}"),
                 "pair": p.get("pair", ""), "token0": p.get("token0", ""),
                 "token1": p.get("token1", ""), "apy_pct": float(p.get("apy_pct", 0)),
                 "tvl_usd": float(p.get("tvl_usd", 0)),
                 "liquidity_usd": float(p.get("liquidity_usd", 0))}
                for p in (pairs or [])[:10]
            ]
            if candidate_pools:
                amount_wei = int(request.amount * 1e18)
                signals = await compute_signals(candidate_pools, amount_wei=amount_wei, token_decimals=18)
                risk_level = {"conservative": 1, "balanced": 2, "aggressive": 3}.get(request.risk_profile, 2)
                pool_metrics = candidate_pools
                allocation = await compute_allocation(
                    request.amount, risk_level, pool_metrics, signals=signals
                )
                if allocation and allocation.get("allocations"):
                    result["ai_reasoning"] = allocation.get("reasoning", result.get("ai_reasoning", ""))
                    result["ai_confidence"] = allocation.get("confidence", result.get("ai_confidence", 0.5))
        except Exception as sig_err:
            logger.debug("Signal enrichment skipped: %s", sig_err)

        recommended_pools = [
            PoolRecommendation(**p) for p in result["recommended_pools"]
        ]
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
        )
    except Exception as e:
        logger.error(f"Strategy recommendation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recommendation/{user_address}", response_model=StrategyRecommendationResponse)
async def recommend_strategy_legacy(
    user_address: str,
    risk_profile: str = Query(default="balanced"),
    amount: float = Query(default=1000.0),
) -> StrategyRecommendationResponse:
    """
    Backward-compatible alias for older bundles that call:
    GET /api/v1/strategies/recommendation/{address}
    """
    normalized_profile = (risk_profile or "balanced").lower()
    if normalized_profile not in {"conservative", "balanced", "aggressive"}:
        raise HTTPException(
            status_code=422,
            detail="risk_profile must be one of: conservative, balanced, aggressive",
        )
    if amount <= 0 or amount > 1_000_000:
        raise HTTPException(status_code=422, detail="amount must be > 0 and <= 1000000")

    req = StrategyRecommendationRequest(
        user_address=user_address,
        risk_profile=normalized_profile,
        amount=amount,
    )
    return await recommend_strategy(req)


@router.post("/execute-advanced")
async def execute_advanced_strategy(http_request: Request, request: ExecuteAdvancedRequest):
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

    demo_mode = getattr(http_request.state, "demo_mode", False)
    if demo_mode:
        from app.services.vault_execute_service import execute_strategy_impl
        req_dict = {
            "user_address": request.user_address,
            "risk_profile": request.risk_profile,
            "deposit_amount": deposit_amount,
            "allocations": raw_allocations,
            "demo_mode": True,
        }
        result = await execute_strategy_impl(req_dict)
        from app.api.routes.vault_execute import DeploymentPosition, ExecuteStrategyResponse
        positions = [DeploymentPosition(**p) for p in result["positions"]]
        return ExecuteStrategyResponse(
            deployment_id=result["deployment_id"],
            user_address=result["user_address"],
            total_amount=result["total_amount"],
            positions=positions,
            total_expected_apy=result.get("total_expected_apy", 0.0),
            audit_trail_entry_id=result.get("audit_trail_entry_id", ""),
            zkml_proof_hash=result.get("zkml_proof_hash", "0x0"),
            timestamp=result.get("timestamp", ""),
        )

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


@router.get("/llm/providers")
async def llm_providers_health():
    """Live health status for all registered LLM providers."""
    import time
    from app.services.llm_provider_registry import get_llm_registry

    registry = get_llm_registry()
    providers_out = []

    for pid, prov in registry._providers.items():
        entry: dict[str, Any] = {
            "provider_id": pid,
            "name": getattr(prov, "name", pid),
            "type": str(getattr(prov, "provider_type", "unknown")),
            "model": getattr(prov, "default_model", ""),
            "active": getattr(prov, "active", True),
            "healthy": False,
            "latency_ms": None,
            "error": None,
        }

        # Quick ping — only for real providers
        if pid == "deterministic":
            entry["healthy"] = True
            entry["latency_ms"] = 0
        else:
            try:
                t0 = time.monotonic()
                resp = await registry.chat_completion(
                    provider_id=pid,
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=1,
                    temperature=0,
                )
                latency = round((time.monotonic() - t0) * 1000)
                entry["healthy"] = resp.content is not None
                entry["latency_ms"] = latency
            except Exception as exc:
                entry["healthy"] = False
                entry["error"] = str(exc)[:120]

        providers_out.append(entry)

    return {"providers": providers_out}

class YieldPositionItem(BaseModel):
    position_id: str
    pair: str
    fees0_usd: float
    fees1_usd: float
    total_fees_usd: float
    apr_est: float
    status: str
    harvest_tx: Optional[str]
    error: Optional[str]
    lower_tick: Optional[int] = None
    upper_tick: Optional[int] = None


class YieldSnapshotResponse(BaseModel):
    timestamp: str
    owner: str
    positions: List[YieldPositionItem]
    total_fees_usd: float
    total_positions: int
    harvested_count: int
    proof_id: Optional[str] = None
    proof_status: str = "generated"  # generated | submitted | verified


@router.get("/yield/{owner_address}", response_model=YieldSnapshotResponse)
async def get_yield_snapshot(owner_address: str, harvest: bool = False):
    """
    Read accrued yield across all Ekubo LP positions for an owner.

    - Default: read-only yield estimate (APR-based when on-chain read fails)
    - Set ?harvest=true to collect fees on-chain (requires executor config)
    """
    from app.services.yield_collector import read_yield_for_owner

    try:
        snapshot = await read_yield_for_owner(owner=owner_address, harvest=harvest)
        return YieldSnapshotResponse(
            timestamp=snapshot.timestamp,
            owner=snapshot.owner,
            positions=[
                YieldPositionItem(
                    position_id=p.position_id,
                    pair=p.pair,
                    fees0_usd=p.fees0_usd,
                    fees1_usd=p.fees1_usd,
                    total_fees_usd=p.total_fees_usd,
                    apr_est=p.apr_est,
                    status=p.status,
                    harvest_tx=p.harvest_tx,
                    error=p.error,
                    lower_tick=getattr(p, 'lower_tick', None),
                    upper_tick=getattr(p, 'upper_tick', None),
                )
                for p in snapshot.positions
            ],
            total_fees_usd=snapshot.total_fees_usd,
            total_positions=snapshot.total_positions,
            harvested_count=snapshot.harvested_count,
        )
    except Exception as e:
        logger.error(f"yield snapshot error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class AuditAllocationItem(BaseModel):
    id: int
    venue: Optional[str]
    pool_id: Optional[str]
    amount: Optional[str]
    metadata: Optional[str]
    status: Optional[str]
    allocated_at: Optional[int]


class AuditTrailResponse(BaseModel):
    user_address: str
    allocations: List[AuditAllocationItem]
    total_deployed_wei: int
    total_yield_wei: int
    proof_id: Optional[str] = None
    proof_status: str = "verified"  # audit trail is always verified


@router.get("/audit/{user_address}", response_model=AuditTrailResponse)
async def get_audit_trail(user_address: str):
    """
    Full audit trail: all allocation records + yield events for a user.

    Used for frontend history / compliance / attestation verification.
    """
    try:
        from app.services.ledger_service import get_ledger_service
        ledger = get_ledger_service()

        allocations = ledger.get_vault_allocations(user_address)
        deployed = ledger.get_deployed_amount(user_address)
        total_yield = ledger.get_total_yield(user_address)

        return AuditTrailResponse(
            user_address=user_address,
            allocations=[
                AuditAllocationItem(
                    id=a.get("id", 0),
                    venue=a.get("venue"),
                    pool_id=a.get("pool_id"),
                    amount=a.get("amount"),
                    metadata=a.get("metadata"),
                    status=a.get("status"),
                    allocated_at=a.get("allocated_at"),
                )
                for a in allocations
            ],
            total_deployed_wei=deployed,
            total_yield_wei=total_yield,
        )
    except Exception as e:
        logger.error(f"audit trail error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class VaultSummaryResponse(BaseModel):
    user_address: str
    total_deposited_wei: int
    total_deployed_wei: int
    total_yield_wei: int
    total_withdrawn_wei: int
    active_allocations: int
    net_balance_wei: int
    proof_id: Optional[str] = None
    proof_status: str = "verified"  # vault summary is aggregated from verified records


@router.get("/vault-summary/{user_address}", response_model=VaultSummaryResponse)
async def get_vault_summary(user_address: str):
    """
    Single-call vault summary: deposited, deployed, yield, withdrawn, net.
    """
    try:
        from app.services.ledger_service import get_ledger_service
        ledger = get_ledger_service()

        deposited = ledger.get_total_deposited(user_address)
        deployed = ledger.get_deployed_amount(user_address)
        yielded = ledger.get_total_yield(user_address)
        withdrawn = ledger.get_total_withdrawn(user_address)
        active = ledger.list_active_allocations(user_address)

        net = deposited + yielded - withdrawn

        return VaultSummaryResponse(
            user_address=user_address,
            total_deposited_wei=deposited,
            total_deployed_wei=deployed,
            total_yield_wei=yielded,
            total_withdrawn_wei=withdrawn,
            active_allocations=len(active),
            net_balance_wei=net,
        )
    except Exception as e:
        logger.error(f"vault summary error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Phase E: Rebalancing
# ============================================================================

class RebalanceRequest(BaseModel):
    owner_address: str
    risk_profile: str = "balanced"
    deposit_amount: Optional[float] = None   # None = use current portfolio value
    drift_threshold_pct: float = 10.0

    @validator("risk_profile")
    def validate_profile_rebal(cls, v):
        v_lower = v.strip().lower()
        if v_lower not in ("conservative", "balanced", "aggressive"):
            raise ValueError("risk_profile must be conservative, balanced, or aggressive")
        return v_lower


class RebalanceActionItem(BaseModel):
    action: str
    pool_id: str
    pair: str
    current_weight_pct: float
    target_weight_pct: float
    drift_pct: float
    position_id: Optional[str]
    amount_usd: float
    calldata: Optional[Dict] = None


class RebalancePlanResponse(BaseModel):
    timestamp: str
    risk_profile: str
    deposit_amount: float
    drift_threshold_pct: float
    max_drift_pct: float
    needs_rebalance: bool
    actions: List[RebalanceActionItem]
    new_attestation_hash: str


@router.post("/rebalance", response_model=RebalancePlanResponse)
async def rebalance_plan(request: RebalanceRequest):
    """
    Phase E: Compare current LP positions vs fresh allocation target.

    Constraint gate: validates onboarding identity + risk bounds before proceeding.
    Returns a rebalance plan with remove/add/keep actions.
    If max_drift_pct < threshold, needs_rebalance=false.
    Remove actions include calldata for withdraw_and_burn.
    """
    from app.services.rebalancer import compute_rebalance_plan

    try:
        # ── Constraint gate: enforce onboarding bounds ──
        gate = get_constraint_gate()
        verdict: ConstraintVerdict = gate.check(
            user_address=request.owner_address,
            action="rebalance",
            requested_amount_usd=request.deposit_amount or 0.0,
            requested_profile=request.risk_profile,
        )
        if not verdict.allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Constraint gate denied rebalance",
                    "violations": verdict.violations,
                    "attestation_hash": verdict.attestation_hash,
                },
            )
        effective_profile = verdict.risk_profile

        plan = await compute_rebalance_plan(
            owner=request.owner_address,
            risk_profile=effective_profile,
            deposit_amount=request.deposit_amount,
            drift_threshold_pct=request.drift_threshold_pct,
        )
        return RebalancePlanResponse(
            timestamp=plan.timestamp,
            risk_profile=plan.risk_profile,
            deposit_amount=plan.deposit_amount,
            drift_threshold_pct=plan.drift_threshold_pct,
            max_drift_pct=plan.max_drift_pct,
            needs_rebalance=plan.needs_rebalance,
            actions=[
                RebalanceActionItem(**a.to_dict()) for a in plan.actions
            ],
            new_attestation_hash=plan.new_attestation_hash,
        )
    except Exception as e:
        logger.error(f"rebalance error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Constraint Gate: User constraints endpoint
# ============================================================================

class UserConstraintsResponse(BaseModel):
    """Returns canonical constraints from onboarding for the frontend."""
    onboarded: bool
    risk_profile: Optional[str] = None       # "conservative" | "balanced" | "aggressive"
    risk_tolerance: Optional[int] = None     # 30, 50, 70
    max_position_usd: Optional[float] = None
    session_duration_hours: Optional[int] = None
    session_valid: Optional[bool] = None
    identity_verified: Optional[bool] = None
    fact_hash: Optional[str] = None
    claims: Optional[List[str]] = None


@router.get("/user-constraints/{user_address}", response_model=UserConstraintsResponse)
async def get_user_constraints(user_address: str):
    """
    Return the user's canonical constraints from onboarding.
    Frontend uses this to pre-populate risk profile selector and show identity status.
    """
    gate = get_constraint_gate()
    constraints = gate.get_constraints(user_address)
    if constraints is None:
        return UserConstraintsResponse(onboarded=False)

    from datetime import datetime as _dt
    now_ts = int(_dt.utcnow().timestamp())
    elapsed_hours = (now_ts - constraints.onboarded_at) / 3600.0
    session_valid = elapsed_hours <= constraints.session_duration_hours

    return UserConstraintsResponse(
        onboarded=True,
        risk_profile=constraints.risk_profile,
        risk_tolerance=constraints.risk_tolerance,
        max_position_usd=round(constraints.max_position_usd, 2),
        session_duration_hours=constraints.session_duration_hours,
        session_valid=session_valid,
        identity_verified=bool(constraints.fact_hash) and constraints.agent_initialized,
        fact_hash=constraints.fact_hash[:20] + "..." if constraints.fact_hash else None,
        claims=constraints.claims,
    )

# ============================================================================
# LLM Narration endpoint
# ============================================================================

class NarrationRequest(BaseModel):
    """Request body for LLM narration."""
    context_type: str  # gate_evaluation | strategy_recommendation | idle_capital | ...
    context_data: Dict[str, Any] = {}


class NarrationResponse(BaseModel):
    narration: str
    source: str  # "llm" | "deterministic" | "error"
    context_type: Optional[str] = None
    cta: Optional[Dict[str, str]] = None


@router.post("/llm/narrate", response_model=NarrationResponse)
async def llm_narrate(req: NarrationRequest):
    """
    Single backend for all LLM narration calls from the Control Surface UI.
    Prompt logic stays server-side; frontend just sends context_type + data.
    """
    from app.services.llm_narration import generate_narration
    result = await generate_narration(req.context_type, req.context_data)
    return NarrationResponse(**result)


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


# ============================================================================
# Guard Status + Attribution Endpoints (Phase 4 — Strategy Expansion)
# ============================================================================

class GuardStatusResponse(BaseModel):
    user_address: str
    emergency_pause: bool
    cooldown_seconds: int
    last_exec_ts: Optional[float] = None
    daily_notional_spent_wei: int
    daily_notional_limit_wei: int
    policy_hash: Optional[str] = None


@router.get("/guard-status/{user_address}", response_model=GuardStatusResponse)
async def get_guard_status(user_address: str):
    """Return the current execution guard state for a user (dashboard / debug)."""
    from app.services.execution_guard import get_guard_status as _get_guard_status
    data = _get_guard_status(user_address)
    return GuardStatusResponse(**data)


class GuardCheckRequest(BaseModel):
    user_address: str
    strategy: str = "manual"
    notional_wei: int = 0
    expected_edge_bps: int = 0


class GuardCheckResponse(BaseModel):
    allowed: bool
    reason: str
    policy_hash: str
    checks: Dict[str, bool]


@router.post("/guard-check", response_model=GuardCheckResponse)
async def guard_check(req: GuardCheckRequest):
    """Dry-run a guard check without executing anything."""
    from app.services.execution_guard import check as guard_check_fn
    from app.models.action_intent import ActionIntent

    intent = ActionIntent(
        user_address=req.user_address,
        strategy=req.strategy,
        notional_wei=req.notional_wei,
        expected_edge_bps=req.expected_edge_bps,
    )
    result = guard_check_fn(intent)
    return GuardCheckResponse(
        allowed=result.allowed,
        reason=result.reason,
        policy_hash=result.policy_hash,
        checks=result.checks,
    )


class LimitOrdersResponse(BaseModel):
    active_orders: List[Dict[str, Any]]
    total_count: int


@router.get("/limit-orders/active", response_model=LimitOrdersResponse)
async def get_active_limit_orders():
    """Return all active (open) limit orders from the local store."""
    from app.services.ekubo.limit_orders_adapter import get_active_orders
    orders = get_active_orders()
    return LimitOrdersResponse(active_orders=orders, total_count=len(orders))


# ── Native Staking (Starknet Sepolia) ────────────────────────────────────

class StakingDashboardResponse(BaseModel):
    network: str
    staking_contract: str
    strk_token: str
    total_stake_strk: float
    current_epoch: int
    is_paused: bool
    updated_at: float
    pools: List[Dict[str, Any]]
    user: Optional[Dict[str, Any]] = None


class BuildDelegateRequest(BaseModel):
    pool_contract: str
    amount_wei: str
    reward_address: str


class BuildExitRequest(BaseModel):
    pool_contract: str
    amount_wei: str


class BuildClaimRequest(BaseModel):
    pool_contract: str
    user_address: str


class StakingCallsResponse(BaseModel):
    calls: List[Dict[str, Any]]
    description: str


@router.get("/staking/dashboard")
async def staking_dashboard(user_address: Optional[str] = None):
    """Get native staking dashboard: overview, pools, user positions."""
    try:
        from app.services.staking.native_staking import get_staking_dashboard
        return await get_staking_dashboard(user_address)
    except Exception as e:
        logger.error(f"Staking dashboard error: {e}")
        return {
            "network": "sepolia",
            "staking_contract": "0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1",
            "strk_token": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
            "total_stake_strk": 0,
            "current_epoch": 0,
            "is_paused": False,
            "updated_at": 0,
            "pools": [],
            "error": str(e),
        }


@router.get("/staking/overview")
async def staking_overview():
    """Quick staking stats: total staked, epoch, paused."""
    from app.services.staking.native_staking import get_staking_overview
    overview = await get_staking_overview()
    return {
        "total_stake_strk": overview.total_stake_strk,
        "current_epoch": overview.current_epoch,
        "is_paused": overview.is_paused,
        "updated_at": overview.updated_at,
    }


@router.get("/staking/balance/{user_address}")
async def staking_strk_balance(user_address: str):
    """Get STRK balance for a user address."""
    from app.services.staking.native_staking import get_strk_balance
    balance = await get_strk_balance(user_address)
    return {
        "address": user_address,
        "strk_balance_wei": str(balance),
        "strk_balance": balance / 1e18,
    }


@router.post("/staking/build-delegate", response_model=StakingCallsResponse)
async def build_delegate(req: BuildDelegateRequest):
    """Build multicall for delegating STRK to a pool (approve + enter_delegation_pool)."""
    from app.services.staking.native_staking import build_delegate_calldata
    amount = int(req.amount_wei)
    calls = build_delegate_calldata(req.pool_contract, amount, req.reward_address)
    return StakingCallsResponse(
        calls=calls,
        description=f"Delegate {amount / 1e18:.4f} STRK to pool {req.pool_contract[:10]}...",
    )


@router.post("/staking/build-claim", response_model=StakingCallsResponse)
async def build_claim(req: BuildClaimRequest):
    """Build calldata for claiming delegation rewards."""
    from app.services.staking.native_staking import build_claim_rewards_calldata
    calls = build_claim_rewards_calldata(req.pool_contract, req.user_address)
    return StakingCallsResponse(
        calls=calls,
        description=f"Claim rewards from pool {req.pool_contract[:10]}...",
    )


@router.post("/staking/build-exit-intent", response_model=StakingCallsResponse)
async def build_exit_intent(req: BuildExitRequest):
    """Build calldata for initiating delegation exit (starts cooldown)."""
    from app.services.staking.native_staking import build_exit_intent_calldata
    amount = int(req.amount_wei)
    calls = build_exit_intent_calldata(req.pool_contract, amount)
    return StakingCallsResponse(
        calls=calls,
        description=f"Initiate exit of {amount / 1e18:.4f} STRK from pool {req.pool_contract[:10]}...",
    )


@router.post("/staking/build-exit-action", response_model=StakingCallsResponse)
async def build_exit_action(req: BuildExitRequest):
    """Build calldata for completing delegation exit (after cooldown)."""
    from app.services.staking.native_staking import build_exit_action_calldata
    calls = build_exit_action_calldata(req.pool_contract)
    return StakingCallsResponse(
        calls=calls,
        description=f"Complete exit from pool {req.pool_contract[:10]}...",
    )


# ============================================================================
# Opportunities — live market surface + risk scoring
# ============================================================================

class OpportunitiesRequest(BaseModel):
    risk_profile: str = "BALANCED"
    user_address: Optional[str] = None
    min_tvl_usd: float = 0
    min_confidence: Optional[str] = None  # "low" | "medium" | "high"
    limit: int = 10


class OpportunityRow(BaseModel):
    pair: str
    best_venue: str
    estimated_apy_pct: float
    risk_score: float
    confidence: str
    tvl_usd: float
    volume_24h_usd: float
    spread_bps: int = 0
    flags: List[str] = []
    data_source: str = "live"
    
    # ── zkML enhancement fields (Phase 1B) ──
    zkml_risk_score: Optional[int] = None          # 0-100 from PoolRiskEvaluator
    zkml_confidence: Optional[float] = None        # 0-1 from circuit gates
    zkml_signals: Optional[Dict[str, Any]] = None  # {il_acceptable, yield_optimal, slippage_ok, gates_passed}
    zkml_proof_hash: Optional[str] = None          # Receipt proof hash
    zkml_flags: Optional[List[str]] = []           # Additional flags from evaluator


class OpportunitiesResponse(BaseModel):
    opportunities: List[Dict[str, Any]]
    total_count: int
    data_source: str
    timestamp: str


@router.post("/opportunities", response_model=OpportunitiesResponse)
async def get_opportunities(req: OpportunitiesRequest):
    """Return ranked yield opportunities from live market surface data.

    Combines Ekubo market surface, risk scoring, and optional vault-policy
    filtering to surface the best opportunities for the user's risk profile.
    """
    from app.services.market_surface_service import get_market_surface
    from app.services.vault_policy_service import get_vault_policy_service
    from app.services.zkml.pool_evaluator import PoolRiskEvaluator, PoolMetrics
    from app.services.signal_pass_service import compute_signals
    from app.services.strategy_intelligence_service import get_strategy_intelligence_service
    from datetime import datetime as _dt

    try:
        surface = await get_market_surface()
        opps = surface.get("opportunities", [])
        data_source = surface.get("data_quality", "live")
    except Exception as exc:
        logger.warning("opportunities: market surface unavailable: %s", exc)
        opps = []
        data_source = "unavailable"

    # Apply risk-profile based filtering
    profile_upper = (req.risk_profile or "BALANCED").upper()
    max_risk = {"CONSERVATIVE": 40, "BALANCED": 65, "AGGRESSIVE": 100}.get(profile_upper, 65)

    # Load user vault policy constraints if address provided
    allowed_strategies: list[str] = []
    if req.user_address:
        try:
            policy_svc = get_vault_policy_service()
            policy = policy_svc.get_policy(req.user_address, create_if_missing=False)
            if policy:
                allowed_strategies = policy.get("execution_policy", {}).get("allowed_strategies", [])
        except Exception:
            pass

    confidence_levels = {"low": 0, "medium": 1, "high": 2}
    min_conf_val = confidence_levels.get(req.min_confidence or "low", 0)

    # ── Phase 1B: Initialize PoolRiskEvaluator ──
    evaluator = PoolRiskEvaluator()
    evaluations: dict[str, Any] = {}  # pool_id -> evaluation result
    
    # ── Phase 2: Initialize Strategy Intelligence Service ──
    intelligence_svc = get_strategy_intelligence_service()

    scored: list[dict] = []
    for opp in opps:
        conf = opp.get("confidence", "low")
        conf_val = confidence_levels.get(conf, 0)
        if conf_val < min_conf_val:
            continue

        tvl = float(opp.get("tvl_usd", 0))
        if tvl < req.min_tvl_usd:
            continue

        # ── Phase 2: Create/update strategy with intelligence ──
        zkml_risk_score = None
        zkml_flags: list[str] = []
        try:
            strategy = intelligence_svc.create_or_update_strategy(
                pool_id=opp.get("pair", "unknown"),
                protocol=opp.get("best_venue", "ekubo"),
                token0=opp.get("token0", ""),
                token1=opp.get("token1", ""),
                fee_tier=float(opp.get("spread_bps", 0)) / 10000.0,
                apy=float(opp.get("estimated_apy_pct", 0)),
                tvl_usd=tvl,
                volume_24h_usd=float(opp.get("volume_24h_usd", 0)),
                confidence=conf,
                zkml_risk_score=None,  # Will be filled by circuits later
                zkml_flags=[],
                volatility_pct=abs(float(opp.get("change_24h_pct", 0))),
            )
            
            risk = strategy.genome.risk_score
            zkml_risk_score = int(risk)
            zkml_flags = strategy.zkml_flags
            
            # Use genome composite score for ranking (not just APY * risk)
            opp_score = strategy.genome.composite_score
            
        except Exception as exc:
            logger.warning("intelligence service failed for %s: %s", opp.get("pair"), exc)
            # Fallback to basic scoring
            risk = 20 if conf == "high" else (40 if conf == "medium" else 60)
            if tvl < 10_000:
                risk += 15
            elif tvl < 50_000:
                risk += 5
            zkml_risk_score = int(risk)
            apy = float(opp.get("estimated_apy_pct", 0))
            opp_score = apy * (1.0 - risk / 200.0)

        if risk > max_risk:
            continue

        flags: list[str] = []
        if conf == "low":
            flags.append("low_confidence")
        if opp.get("stale"):
            flags.append("stale_data")
        if tvl < 25_000:
            flags.append("low_tvl")

        scored.append({
            **opp,
            "risk_score": risk,
            "flags": flags,
            "zkml_risk_score": zkml_risk_score,
            "zkml_flags": zkml_flags,
            "data_source": data_source,
            "_score": opp_score,
        })

    scored.sort(key=lambda x: x.get("_score", 0), reverse=True)

    # ── Phase 1B: Run zkML circuits on top 10 candidates ──
    top_candidates = scored[:10]  # Run circuits on top 10 only (expensive)
    circuit_reports: dict[str, Any] = {}

    if top_candidates:
        try:
            # Build candidate pool list for signal_pass
            candidate_pools = []
            for opp in top_candidates:
                candidate_pools.append({
                    "pool_id": opp.get("pair", ""),
                    "pair": opp.get("pair", ""),
                    "token0": opp.get("token0", ""),
                    "token1": opp.get("token1", ""),
                    "apy_pct": opp.get("estimated_apy_pct", 0),
                    "tvl_usd": opp.get("tvl_usd", 0),
                    "liquidity_usd": opp.get("tvl_usd", 0),  # use TVL as liquidity proxy
                })
            
            # Run circuits (all available: IL, Yield, Slippage, Liquidation, Correlation)
            amount_wei = int(10_000 * 1e18)  # Simulate $10k deployment for circuit inputs
            signals = await compute_signals(
                candidate_pools,
                amount_wei=amount_wei,
                token_decimals=18,
            )
            
            # Index by pool_id
            for pool_id, report in signals.items():
                circuit_reports[pool_id] = {
                    "il_acceptable": report.il_acceptable,
                    "yield_near_optimal": report.yield_near_optimal,
                    "slippage_ok": report.slippage_ok,
                    "gates_passed": report.gates_passed,
                    "gates_total": report.gates_total,
                    "proof_hash": report.receipt_id if hasattr(report, "receipt_id") else None,
                }
                
        except Exception as exc:
            logger.warning("compute_signals failed: %s", exc)
            # Continue without circuit data

    # Merge zkML circuit signals into final results
    results = []
    for s in scored[: req.limit]:
        s.pop("_score", None)
        
        # Merge zkML circuit signals if available
        pool_id = s.get("pair", "")
        if pool_id in circuit_reports:
            report = circuit_reports[pool_id]
            s["zkml_signals"] = report
            s["zkml_proof_hash"] = report.get("proof_hash")
            s["zkml_confidence"] = report["gates_passed"] / report["gates_total"] if report["gates_total"] > 0 else None
            
            # Add circuit warning flags
            if report["gates_passed"] < report["gates_total"]:
                if not s.get("flags"):
                    s["flags"] = []
                s["flags"].append(f"circuit_warnings_{report['gates_passed']}/{report['gates_total']}")
        
        results.append(s)

    return OpportunitiesResponse(
        opportunities=results,
        total_count=len(results),
        data_source=data_source,
        timestamp=datetime.utcnow().isoformat(),
    )


@router.get("")
async def list_strategies(
    protocol: Optional[str] = None,
    min_tvl: float = 0,
    max_risk: float = 100,
    user_profile: str = "BALANCED",
    limit: int = 20,
):
    """List and rank strategies using Strategy Intelligence Service (GET /api/v1/strategies)."""
    from app.services.strategy_intelligence_service import get_strategy_intelligence_service
    
    svc = get_strategy_intelligence_service()
    strategies = svc.rank_strategies(
        user_profile=user_profile,
        min_tvl=min_tvl,
        max_risk=max_risk,
        limit=limit,
    )
    
    # Apply protocol filter if specified
    if protocol:
        strategies = [s for s in strategies if s.protocol.lower() == protocol.lower()]
    
    return {
        "strategies": [s.model_dump(mode="json") for s in strategies],
        "total_count": len(strategies),
    }


@router.get("/{strategy_id}")
async def get_strategy_detail(strategy_id: str):
    """Get detailed strategy information including genome and performance history (GET /api/v1/strategies/{id})."""
    from fastapi import HTTPException
    from app.services.strategy_intelligence_service import get_strategy_intelligence_service
    
    svc = get_strategy_intelligence_service()
    strategy = svc.repo.get_strategy(strategy_id)
    
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    
    # Get performance history
    history = svc.repo.get_performance_history(strategy_id, limit=30)
    
    return {
        "strategy": strategy.model_dump(mode="json"),
        "performance_history": [h.model_dump(mode="json") for h in history],
    }


# ============================================================================
# Limit Orders — Create
# ============================================================================

class CreateLimitOrderRequest(BaseModel):
    user_address: str
    sell_token: str
    buy_token: str
    amount_wei: str  # string to handle large ints
    limit_price: Optional[float] = None  # human-readable; converted to tick
    limit_tick: Optional[int] = None     # raw tick; takes priority
    tick_spacing: int = 1000


class CreateLimitOrderResponse(BaseModel):
    success: bool
    calls: List[Dict[str, Any]] = []
    order: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@router.post("/limit-orders/create", response_model=CreateLimitOrderResponse)
async def create_limit_order(req: CreateLimitOrderRequest):
    """Build calldata for placing a limit order on Ekubo.

    Returns the multicall array (approve + place_order) for the frontend
    to sign via the vault account or session key.
    """
    from app.services.ekubo.limit_orders_adapter import (
        build_place_limit_order_calldata,
        record_order,
    )
    import math

    try:
        amount = int(req.amount_wei)
    except (ValueError, TypeError):
        return CreateLimitOrderResponse(success=False, error="Invalid amount_wei")

    if amount <= 0:
        return CreateLimitOrderResponse(success=False, error="amount_wei must be positive")

    # Determine tick
    tick = req.limit_tick
    if tick is None:
        if req.limit_price is not None and req.limit_price > 0:
            tick = int(math.log(req.limit_price) / math.log(1.0001))
        else:
            return CreateLimitOrderResponse(
                success=False,
                error="Either limit_tick or limit_price must be provided",
            )

    try:
        calls = build_place_limit_order_calldata(
            sell_token=req.sell_token,
            buy_token=req.buy_token,
            amount_wei=amount,
            limit_tick=tick,
            tick_spacing=req.tick_spacing,
        )
    except Exception as exc:
        logger.error("limit-orders/create calldata build failed: %s", exc)
        return CreateLimitOrderResponse(success=False, error=str(exc))

    # Record order locally (tx_hash filled in after signing)
    order = record_order(
        sell_token=req.sell_token,
        buy_token=req.buy_token,
        amount_wei=amount,
        limit_tick=tick,
    )

    return CreateLimitOrderResponse(success=True, calls=calls, order=order)


class LimitOrderMarketResponse(BaseModel):
    pair: str
    current_price: Optional[float] = None
    price_24h_ago: Optional[float] = None
    change_pct: Optional[float] = None
    source: str = "ekubo_oracle"


@router.get("/limit-orders/market/{pair}")
async def limit_orders_market(pair: str):
    """Return live price context for a trading pair (e.g. 'STRK-ETH').

    Used by the limit order creation form to show current price and suggest
    reasonable limit prices.
    """
    from app.services.ekubo.oracle_adapter import get_live_prices

    try:
        prices = await get_live_prices()
    except Exception as exc:
        logger.warning("limit-orders/market price fetch failed: %s", exc)
        raise HTTPException(status_code=503, detail="Price data unavailable")

    pair_upper = pair.upper().replace("-", "/").replace("_", "/")
    current_price: float | None = None

    if "STRK" in pair_upper and "ETH" in pair_upper:
        current_price = prices.get("strk_eth")
    elif "STRK" in pair_upper and "USD" in pair_upper:
        current_price = prices.get("strk_usd")
    elif "ETH" in pair_upper and "USD" in pair_upper:
        current_price = prices.get("eth_usd")

    if current_price is None:
        raise HTTPException(status_code=404, detail=f"No price data for pair: {pair}")

    return LimitOrderMarketResponse(
        pair=pair_upper,
        current_price=current_price,
        source="ekubo_oracle",
    )


# ============================================================================
# Recenter Alerts — surface out-of-range LP positions
# ============================================================================

@router.get("/recenter-alerts/{user_address}")
async def recenter_alerts(user_address: str):
    """Return LP positions that have drifted out of range for this user.

    Uses the lp_recenter_adapter to detect recenterable positions based
    on a heuristic current_tick derived from oracle price.
    """
    from app.services.ekubo.lp_recenter_adapter import get_recenterable_positions
    from app.services.ekubo.oracle_adapter import get_live_prices
    from app.services.ekubo_executor import price_to_tick

    try:
        prices = await get_live_prices()
        strk_eth = prices.get("strk_eth")
        if strk_eth and strk_eth > 0:
            current_tick = price_to_tick(strk_eth)
        else:
            current_tick = 0
    except Exception:
        current_tick = 0

    positions = get_recenterable_positions(current_tick, drift_pct=0.75)

    alerts = []
    for pos in positions:
        alerts.append({
            "nft_id": pos.get("nft_id") or pos.get("id"),
            "pair": pos.get("pair", "STRK/ETH"),
            "reason": pos.get("_recenter_reason", "out_of_range"),
            "lower_tick": pos.get("lower_tick", 0),
            "upper_tick": pos.get("upper_tick", 0),
            "current_tick": current_tick,
        })

    return {"alerts": alerts, "current_tick": current_tick}


class RecenterBuildRequest(BaseModel):
    nft_id: str
    current_tick: int
    half_width_ticks: int = 1000


@router.post("/recenter/build")
async def recenter_build(req: RecenterBuildRequest):
    """Build multicall calldata to recenter a specific LP position."""
    from app.services.ekubo.lp_recenter_adapter import (
        build_recenter_calldata,
        _load_positions,
    )

    positions = _load_positions()
    target = None
    for pos in positions:
        pid = str(pos.get("nft_id") or pos.get("id"))
        if pid == str(req.nft_id):
            target = pos
            break

    if not target:
        raise HTTPException(status_code=404, detail=f"Position {req.nft_id} not found")

    result = build_recenter_calldata(
        position=target,
        current_tick=req.current_tick,
        half_width_ticks=req.half_width_ticks,
    )
    return result
