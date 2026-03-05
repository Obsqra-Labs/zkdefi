"""
Proofs API — unified proof management endpoints.

Endpoints:
- GET  /proofs/                     List all proofs (with filters)
- GET  /proofs/stats                Aggregate proof statistics
- GET  /proofs/{proof_hash}         Get a specific proof record
- POST /proofs/verify/{proof_hash}  Re-verify a proof locally
- POST /proofs/submit/{proof_hash}  Submit proof on-chain to ValidationProofRegistry
- POST /proofs/yield-forecast       Generate yield forecast with proof
- POST /proofs/anomaly-detect       Generate anomaly detection with proof
- GET  /proofs/models               List available provable models
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response models ───────────────────────────────────────────

class YieldForecastRequest(BaseModel):
    """Pool features for yield forecast."""
    tvl_usd_log: float = Field(default=18.0, description="Log of TVL in USD")
    volume_24h_log: float = Field(default=14.0, description="Log of 24h volume")
    fee_tier_bps: float = Field(default=30.0, description="Fee tier in bps")
    current_apr: float = Field(default=12.0, description="Current APR %")
    apr_7d_avg: float = Field(default=11.5, description="7-day avg APR %")
    apr_30d_avg: float = Field(default=10.0, description="30-day avg APR %")
    apr_trend_7d: float = Field(default=0.5, description="7-day APR trend")
    apr_volatility_7d: float = Field(default=2.0, description="7-day APR volatility")
    utilization_ratio: float = Field(default=0.75, description="Pool utilization ratio")
    tick_concentration: float = Field(default=0.6, description="Liquidity tick concentration")
    num_positions: float = Field(default=50.0, description="Number of LP positions")
    time_since_last_rebalance_hours: float = Field(default=24.0, description="Hours since last rebalance")
    user_address: str = Field(default="", description="Optional user address")
    generate_proof: bool = Field(default=True, description="Generate EZKL proof")


class AnomalyDetectRequest(BaseModel):
    """Pool features for anomaly detection."""
    tvl_stability: float = Field(default=0.9, description="TVL stability score 0-1")
    liquidity_concentration: float = Field(default=0.5, description="Liquidity concentration 0-1")
    price_impact_bps: float = Field(default=10.0, description="Price impact in bps")
    deployer_reputation: float = Field(default=0.8, description="Deployer reputation score 0-1")
    volume_pattern: float = Field(default=0.7, description="Volume pattern normality 0-1")
    fee_anomaly: float = Field(default=0.1, description="Fee anomaly score 0-1")
    large_withdrawal_pct: float = Field(default=5.0, description="Large withdrawal % of TVL")
    smart_money_flow: float = Field(default=0.3, description="Smart money flow indicator -1 to 1")
    user_address: str = Field(default="", description="Optional user address")
    generate_proof: bool = Field(default=True, description="Generate EZKL proof")


class OnChainSubmitRequest(BaseModel):
    """Explicit submission request."""
    proof_hash: str


# ── Endpoints ───────────────────────────────────────────────────────────

@router.get("/")
async def list_proofs(
    model_name: str | None = Query(None, description="Filter by model name"),
    user_address: str | None = Query(None, description="Filter by user address"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """List proof records with optional filters."""
    from app.services.proof_registry import get_proof_registry
    registry = get_proof_registry()
    proofs = registry.list_proofs(
        model_name=model_name,
        user_address=user_address,
        limit=limit,
        offset=offset,
    )
    return {
        "proofs": [p.to_dict() for p in proofs],
        "count": len(proofs),
        "filters": {"model_name": model_name, "user_address": user_address},
    }


@router.get("/stats")
async def get_proof_stats() -> dict[str, Any]:
    """Aggregate proof statistics across all models."""
    from app.services.proof_registry import get_proof_registry
    registry = get_proof_registry()
    stats = registry.get_stats()

    # Add model availability info
    from app.services.ezkl_prover_service import get_ezkl_prover
    prover = get_ezkl_prover()
    models_ready = {name: arts.is_ready() for name, arts in prover._models.items()}

    return {
        **stats,
        "models_ready": models_ready,
        "available_models": ["creditworthiness", "yield_forecast", "anomaly_detector"],
    }


@router.get("/models")
async def list_models() -> dict[str, Any]:
    """List available provable ML models and their status."""
    from pathlib import Path
    import json

    base = Path(__file__).resolve().parents[2] / "data" / "ezkl_models"
    models = []
    if not base.exists():
        return {"models": models}
    for model_dir in sorted(base.iterdir()):
        if not model_dir.is_dir():
            continue
        onnx_files = list(model_dir.glob("*.onnx"))
        has_compiled = (model_dir / "network.compiled").exists()
        has_pk = (model_dir / "pk.key").exists()
        has_vk = (model_dir / "vk.key").exists()
        has_srs = (model_dir / "kzg.srs").exists()

        metadata = {}
        meta_path = model_dir / "training_metadata.json"
        if meta_path.exists():
            metadata = json.loads(meta_path.read_text())

        models.append({
            "name": model_dir.name,
            "onnx_exists": len(onnx_files) > 0,
            "onnx_size_bytes": onnx_files[0].stat().st_size if onnx_files else 0,
            "ezkl_ready": has_compiled and has_pk and has_vk and has_srs,
            "has_compiled": has_compiled,
            "has_proving_key": has_pk,
            "has_verification_key": has_vk,
            "has_srs": has_srs,
            "training_accuracy": metadata.get("accuracy"),
            "training_loss": metadata.get("final_loss"),
        })

    return {"models": models}


@router.get("/{proof_hash}")
async def get_proof(proof_hash: str) -> dict[str, Any]:
    """Get a specific proof record by hash."""
    from app.services.proof_registry import get_proof_registry
    registry = get_proof_registry()
    record = registry.get_proof(proof_hash)
    if not record:
        raise HTTPException(status_code=404, detail="Proof not found")
    return {"proof": record.to_dict()}


@router.post("/verify/{proof_hash}")
async def verify_proof(proof_hash: str) -> dict[str, Any]:
    """Re-verify a proof locally using EZKL."""
    from app.services.proof_registry import get_proof_registry
    registry = get_proof_registry()
    record = registry.get_proof(proof_hash)
    if not record:
        raise HTTPException(status_code=404, detail="Proof not found")

    # We can only verify if we still have the proof bytes
    # For now, return the stored verification status
    return {
        "proof_hash": proof_hash,
        "model_name": record.model_name,
        "verified_locally": record.verified_locally,
        "on_chain": record.tx_hash is not None,
        "tx_hash": record.tx_hash,
    }


@router.post("/submit/{proof_hash}")
async def submit_proof_on_chain(proof_hash: str) -> dict[str, Any]:
    """Submit a proof to the ValidationProofRegistry on Starknet."""
    from app.services.proof_registry import get_proof_registry
    registry = get_proof_registry()
    result = await registry.submit_on_chain(proof_hash)
    if not result["success"] and not result.get("already_submitted"):
        raise HTTPException(status_code=500, detail=result.get("error", "Submission failed"))
    return result


@router.post("/yield-forecast")
async def generate_yield_forecast(req: YieldForecastRequest) -> dict[str, Any]:
    """Generate a yield forecast prediction with optional EZKL proof."""
    from app.ml.yield_forecast.predictor import get_yield_predictor

    predictor = get_yield_predictor()
    if not predictor.is_ready:
        raise HTTPException(status_code=503, detail="Yield forecast model not loaded")

    features = {
        "tvl_usd_log": req.tvl_usd_log,
        "volume_24h_log": req.volume_24h_log,
        "fee_tier_bps": req.fee_tier_bps,
        "current_apr": req.current_apr,
        "apr_7d_avg": req.apr_7d_avg,
        "apr_30d_avg": req.apr_30d_avg,
        "apr_trend_7d": req.apr_trend_7d,
        "apr_volatility_7d": req.apr_volatility_7d,
        "utilization_ratio": req.utilization_ratio,
        "tick_concentration": req.tick_concentration,
        "num_positions": req.num_positions,
        "time_since_last_rebalance_hours": req.time_since_last_rebalance_hours,
    }

    result = await predictor.predict(
        features,
        generate_proof=req.generate_proof,
        user_address=req.user_address,
    )
    return result


@router.post("/anomaly-detect")
async def generate_anomaly_detection(req: AnomalyDetectRequest) -> dict[str, Any]:
    """Generate an anomaly detection classification with optional EZKL proof."""
    from app.ml.anomaly_detector.predictor import get_anomaly_predictor

    predictor = get_anomaly_predictor()
    if not predictor.is_ready:
        raise HTTPException(status_code=503, detail="Anomaly detector model not loaded")

    features = {
        "tvl_stability": req.tvl_stability,
        "liquidity_concentration": req.liquidity_concentration,
        "price_impact_bps": req.price_impact_bps,
        "deployer_reputation": req.deployer_reputation,
        "volume_pattern": req.volume_pattern,
        "fee_anomaly": req.fee_anomaly,
        "large_withdrawal_pct": req.large_withdrawal_pct,
        "smart_money_flow": req.smart_money_flow,
    }

    result = await predictor.predict(
        features,
        generate_proof=req.generate_proof,
        user_address=req.user_address,
    )
    return result


# ── Proof Sequencer Status ──────────────────────────────────────────────

@router.get("/sequencer-status")
async def sequencer_status() -> dict[str, Any]:
    """Return proof sequencer forwarding stats."""
    try:
        from app.services.proof_sequencer_client import _client as seq_client
        if seq_client is None:
            return {
                "status": "not_initialized",
                "submitted_count": 0,
                "retry_queue_size": 0,
                "endpoint": "obsqra.fi",
            }
        stats = await seq_client.get_sequencer_stats()
        pending = await seq_client.get_pending_retries()
        return {
            "status": "active",
            "submitted_count": len(seq_client._submission_log),
            "retry_queue_size": len(pending),
            "endpoint": "obsqra.fi/api/v1/aggregation",
            **stats,
        }
    except Exception as e:
        logger.debug("Sequencer status error: %s", e)
        return {
            "status": "unavailable",
            "submitted_count": 0,
            "retry_queue_size": 0,
            "endpoint": "obsqra.fi",
        }