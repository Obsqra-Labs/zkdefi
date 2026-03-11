"""
Proofs API — unified proof management endpoints.

Endpoints:
- GET  /proofs/                     List all proofs (with filtering)
- GET  /proofs/stats                Aggregate proof statistics
- GET  /proofs/models               Available provable ML models
- GET  /proofs/{proof_hash}         Get a specific proof record
- POST /proofs/verify/{proof_hash}  Re-verify a proof locally
- POST /proofs/submit/{proof_hash}  Submit proof to on-chain registry
- POST /proofs/yield-forecast       Generate yield forecast + proof
- POST /proofs/anomaly-detect       Generate anomaly detection + proof
- POST /proofs/ml-bridge            Generate ML bridge proofs with L3/L2 verification
- GET  /proofs/sequencer-status     Proof sequencer forwarding stats
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Request Models ──────────────────────────────────────────────────────


class YieldForecastRequest(BaseModel):
    """Pool features for yield forecast."""
    tvl_usd_log: float = Field(..., description="Log of TVL in USD")
    volume_24h_log: float = Field(..., description="Log of 24h volume")
    fee_tier_bps: float = Field(..., description="Fee tier in bps")
    current_apr: float = Field(..., description="Current APR %")
    apr_7d_avg: float = Field(..., description="7-day avg APR %")
    apr_30d_avg: float = Field(..., description="30-day avg APR %")
    apr_trend_7d: float = Field(..., description="7-day APR trend")
    apr_volatility_7d: float = Field(..., description="7-day APR volatility")
    utilization_ratio: float = Field(..., description="Pool utilization ratio")
    tick_concentration: float = Field(..., description="Liquidity tick concentration")
    num_positions: float = Field(..., description="Number of LP positions")
    time_since_last_rebalance_hours: float = Field(..., description="Hours since last rebalance")
    user_address: str = Field(default="", description="Optional user address")
    generate_proof: bool = Field(default=False, description="Generate EZKL proof")


class AnomalyDetectRequest(BaseModel):
    """Pool features for anomaly detection."""
    tvl_stability: float = Field(..., description="TVL stability score 0-1")
    liquidity_concentration: float = Field(..., description="Liquidity concentration 0-1")
    price_impact_bps: float = Field(..., description="Price impact in bps")
    deployer_reputation: float = Field(..., description="Deployer reputation score 0-1")
    volume_pattern: float = Field(..., description="Volume pattern normality 0-1")
    fee_anomaly: float = Field(..., description="Fee anomaly score 0-1")
    large_withdrawal_pct: float = Field(..., description="Large withdrawal % of TVL")
    smart_money_flow: float = Field(..., description="Smart money flow indicator -1 to 1")
    user_address: str = Field(default="", description="Optional user address")
    generate_proof: bool = Field(default=False, description="Generate EZKL proof")


class OnChainSubmitRequest(BaseModel):
    """Explicit submission request."""
    proof_hash: str = Field(..., description="Proof hash to submit")


class MLBridgeProofRequest(BaseModel):
    """Generate ML bridge proofs with per-request execution chain control."""
    user_address: str = Field(..., description="User address for audit + policy context")
    model_name: str = Field(..., description="Registered EZKL model name")
    input_data: list[list[float]] = Field(..., description="Model input tensor as nested float array")
    execution_chain: Literal["l3", "l2", "dual"] = Field(
        default="l3",
        description="Verification/execution chain mode",
    )
    proof_mode: str | int | None = Field(default=None, description="Proof mode override")
    tier: int = Field(default=0, description="Reputation tier")
    action_type: str = Field(default="ml_inference", description="Action context")
    value_eth: float = Field(default=0.0, description="Action value for proof escalation logic")
    expected_model_hash: int = Field(default=0, description="Expected model hash felt")
    output_lower_bound: int = Field(default=0, description="Model output lower bound")
    output_upper_bound: int = Field(default=10000, description="Model output upper bound")
    bridge_circuit: Literal["ModelBridge", "ModelBridgeHeavy", "NoirEzklBridge", "EzklNativeKzg"] = Field(
        default="ModelBridge",
        description="Bridge circuit lane to use for L3 verification",
    )


# ── Read Endpoints ──────────────────────────────────────────────────────


@router.get("/")
async def list_proofs(
    model_name: str = Query(None, description="Filter by model name"),
    user_address: str = Query(None, description="Filter by user address"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """List proof records with optional filters."""
    try:
        from app.services.proof_pipeline import get_proof_pipeline
        pipeline = get_proof_pipeline()
        cache = pipeline._cache
        items = list(cache.values())
        if model_name:
            items = [i for i in items if (i.get("ezkl_proof") or {}).get("model_name") == model_name]
        return {"proofs": items[offset: offset + limit], "total": len(items), "limit": limit, "offset": offset}
    except Exception as exc:
        return {"proofs": [], "total": 0, "error": str(exc)}


@router.get("/stats")
async def get_proof_stats() -> dict[str, Any]:
    """Aggregate proof statistics across all models."""
    try:
        from app.services.proof_pipeline import get_proof_pipeline
        pipeline = get_proof_pipeline()
        cache = pipeline._cache
        total = len(cache)
        verified = sum(1 for v in cache.values()
                       if isinstance(v.get("verification"), dict) and
                       v["verification"].get("l3", {}).get("verified_on_chain"))
        return {"total_proofs": total, "verified_on_chain": verified, "cache_size": total}
    except Exception as exc:
        return {"total_proofs": 0, "error": str(exc)}


@router.get("/models")
async def list_models() -> dict[str, Any]:
    """List available provable ML models and their status."""
    models_dir = Path(__file__).parent.parent.parent.parent / "ezkl_models"
    result = []
    if models_dir.exists():
        for d in sorted(models_dir.iterdir()):
            if d.is_dir():
                onnx = list(d.glob("*.onnx"))
                compiled = (d / "network.compiled").exists()
                pk = (d / "pk.key").exists()
                vk = (d / "vk.key").exists()
                srs = (d / "kzg.srs").exists()
                meta = {}
                meta_path = d / "training_metadata.json"
                if meta_path.exists():
                    import json
                    try:
                        meta = json.loads(meta_path.read_text())
                    except Exception:
                        pass
                result.append({
                    "name": d.name,
                    "onnx": bool(onnx),
                    "compiled": compiled,
                    "proving_key": pk,
                    "verification_key": vk,
                    "srs": srs,
                    "ready": bool(onnx and compiled and pk and vk),
                    "accuracy": meta.get("accuracy"),
                    "final_loss": meta.get("final_loss"),
                })
    return {"models": result, "count": len(result), "models_dir": str(models_dir)}


@router.get("/sequencer-status")
async def sequencer_status() -> dict[str, Any]:
    """Return proof sequencer forwarding stats."""
    try:
        from app.services.proof_sequencer_client import get_sequencer_client
        seq = get_sequencer_client()
        if seq is None:
            return {"status": "not_initialized", "endpoint": "obsqra.fi"}
        stats = await seq.get_sequencer_stats()
        return {
            "status": "active",
            "endpoint": "obsqra.fi/api/v1/aggregation",
            "stats": stats,
            "log": await seq.get_submission_log(),
        }
    except Exception as exc:
        logger.warning("Sequencer status error: %s", exc)
        return {"status": "unavailable", "error": str(exc)}


@router.get("/{proof_hash}")
async def get_proof(proof_hash: str) -> dict[str, Any]:
    """Get a specific proof record by hash."""
    try:
        from app.services.proof_pipeline import get_proof_pipeline
        pipeline = get_proof_pipeline()
        for v in pipeline._cache.values():
            if v.get("commitment_hash") == proof_hash:
                return v
            bp = v.get("bridge_proof") or {}
            if bp.get("proof_hash") == proof_hash:
                return v
            ep = v.get("ezkl_proof") or {}
            if ep.get("proof_hash") == proof_hash:
                return v
    except Exception:
        pass
    raise HTTPException(status_code=404, detail="Proof not found")


# ── Write Endpoints ─────────────────────────────────────────────────────


@router.post("/verify/{proof_hash}")
async def verify_proof(proof_hash: str) -> dict[str, Any]:
    """Re-verify a proof locally using EZKL."""
    try:
        from app.services.proof_pipeline import get_proof_pipeline
        pipeline = get_proof_pipeline()
        for v in pipeline._cache.values():
            bp = v.get("bridge_proof") or {}
            if bp.get("proof_hash") == proof_hash:
                return {"proof_hash": proof_hash, "verified": bp.get("success", False), "is_compliant": bp.get("is_compliant", False)}
    except Exception:
        pass
    raise HTTPException(status_code=404, detail="Proof not found")


@router.post("/submit/{proof_hash}")
async def submit_proof_on_chain(proof_hash: str) -> dict[str, Any]:
    """Submit a proof to the ValidationProofRegistry on Starknet."""
    try:
        from app.services.l3_proving_path_client import get_l3_proving_path_client
        client = get_l3_proving_path_client()
        result = await client.verify_proof(
            fact_hash=proof_hash,
            proof_type="groth16",
            circuit_name="ManualSubmit",
        )
        if result.success:
            return {"status": "success", "tx_hash": result.tx_hash, "mode": result.mode}
        if result.mode == "already_submitted":
            return {"status": "already_submitted", "mode": result.mode}
        return {"status": "Submission failed", "error": result.error, "mode": result.mode}
    except Exception as exc:
        return {"status": "Submission failed", "error": str(exc)}


# ── Proof Generation Endpoints ──────────────────────────────────────────


@router.post("/yield-forecast")
async def generate_yield_forecast(req: YieldForecastRequest) -> dict[str, Any]:
    """Generate a yield forecast prediction with optional EZKL proof."""
    try:
        from app.services.zkml_proof_service import get_zkml_proof_service
        svc = get_zkml_proof_service()
    except Exception:
        raise HTTPException(status_code=503, detail="Yield forecast model not loaded")

    features = [
        req.tvl_usd_log, req.volume_24h_log, req.fee_tier_bps,
        req.current_apr, req.apr_7d_avg, req.apr_30d_avg,
        req.apr_trend_7d, req.apr_volatility_7d, req.utilization_ratio,
        req.tick_concentration, req.num_positions, req.time_since_last_rebalance_hours,
    ]
    result = await svc.predict_yield(
        features=features,
        user_address=req.user_address,
        generate_proof=req.generate_proof,
    )
    return result


@router.post("/anomaly-detect")
async def generate_anomaly_detection(req: AnomalyDetectRequest) -> dict[str, Any]:
    """Generate an anomaly detection classification with optional EZKL proof."""
    try:
        from app.services.zkml_anomaly_service import get_anomaly_service
        svc = get_anomaly_service()
    except Exception:
        raise HTTPException(status_code=503, detail="Anomaly detector model not loaded")

    features = [
        req.tvl_stability, req.liquidity_concentration, req.price_impact_bps,
        req.deployer_reputation, req.volume_pattern, req.fee_anomaly,
        req.large_withdrawal_pct, req.smart_money_flow,
    ]
    result = await svc.detect_anomaly(
        features=features,
        user_address=req.user_address,
        generate_proof=req.generate_proof,
    )
    return result


@router.post("/ml-bridge")
async def generate_ml_bridge_proof(req: MLBridgeProofRequest) -> dict[str, Any]:
    """
    Generate EZKL -> ModelBridge proofs and run strict L3/L2 verification policy.
    """
    from app.services.proof_pipeline import get_proof_pipeline

    pipeline = get_proof_pipeline()
    return await pipeline.generate_ml_proofs(
        user_address=req.user_address,
        model_name=req.model_name,
        input_data=req.input_data,
        proof_mode=req.proof_mode,
        tier=req.tier,
        action_type=req.action_type,
        value_eth=req.value_eth,
        expected_model_hash=req.expected_model_hash,
        output_lower_bound=req.output_lower_bound,
        output_upper_bound=req.output_upper_bound,
        execution_chain=req.execution_chain,
        bridge_circuit=req.bridge_circuit,
    )
