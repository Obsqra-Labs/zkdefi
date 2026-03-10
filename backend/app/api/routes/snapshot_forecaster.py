"""
Snapshot Forecaster API routes.

MVP route family for deterministic forecast lifecycle:
- create window
- commit / reveal predictions
- record matured outcomes
- score forecast receipts
- fetch subject reputation rollups
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.llm_narration import generate_narration
from app.services.snapshot_forecaster_service import (
    DEFAULT_SCHEMA_ID,
    DEFAULT_NETWORK_ID,
    SUPPORTED_NETWORK_IDS,
    SnapshotForecasterService,
    get_snapshot_forecaster_service,
)

router = APIRouter(prefix="/snapshot-forecaster", tags=["snapshot-forecaster"])


class WindowCreateRequest(BaseModel):
    pair_id: str = Field(..., description="Market pair identifier, e.g. ETH/USDC")
    network_id: str = Field(
        default=DEFAULT_NETWORK_ID,
        description=f"Forecast network. Allowed: {', '.join(SUPPORTED_NETWORK_IDS)}",
    )
    window_open_ts: int = Field(..., description="Window open timestamp (unix seconds)")
    window_close_ts: int = Field(..., description="Window close timestamp (unix seconds)")
    cadence_id: str = Field(..., description="Window cadence id, e.g. 1m")
    snapshot_data: dict[str, Any] = Field(..., description="Raw snapshot payload or hash carrier")
    feature_schema_id: str = Field(default=DEFAULT_SCHEMA_ID, description="Versioned feature schema id")
    feature_vector: dict[str, float] = Field(default_factory=dict, description="Deterministic feature vector")
    data_source_id: str = Field(default="unknown", description="Oracle/indexer source id")
    snapshot_provenance_hash: str | None = Field(default=None, description="Optional provenance hash")
    attest_snapshot: bool = Field(default=False, description="Attempt snapshot attestation via fact registry")


class ModelIdentity(BaseModel):
    model_hash: str = Field(..., description="Hash of model artifact (onnx/circuit identity)")
    schema_id: str = Field(default=DEFAULT_SCHEMA_ID, description="Output schema id")
    settings_hash: str | None = Field(default=None, description="Optional settings hash")
    vk_hash: str | None = Field(default=None, description="Optional verification key hash")


class OutputBounds(BaseModel):
    return_min_bps: int = -5000
    return_max_bps: int = 5000
    prob_min: int = 0
    prob_max: int = 10000


class SuggestOutputsRequest(BaseModel):
    horizons_min: list[int] = Field(default_factory=lambda: [5, 30, 240])
    output_bounds: OutputBounds = Field(default_factory=OutputBounds)


class BuildCommitmentRequest(BaseModel):
    window_id: str
    model_hash: str
    schema_id: str = DEFAULT_SCHEMA_ID
    outputs_scaled: dict[str, int]
    salt: str


class PredictionCommitRequest(BaseModel):
    window_id: str
    model_identity: ModelIdentity
    guess_ts: int | None = None
    horizons_min: list[int] = Field(default_factory=lambda: [5, 30, 240])
    subject_id: str = Field(default="", description="Wallet/agent subject id for reputation")
    prediction_commitment: str | None = Field(default=None, description="Commit hash only mode")
    outputs_scaled: dict[str, int] | None = Field(default=None, description="Optional convenience mode")
    salt: str | None = Field(default=None, description="Required when outputs_scaled is provided")
    output_bounds: OutputBounds = Field(default_factory=OutputBounds)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EZKLReceipt(BaseModel):
    proof_hash: str | None = None
    verify_key_hash: str | None = None
    proof_system: str = "halo2_kzg"
    verified_locally: bool = False
    verified_on_chain: bool = False
    verification_mode: str | None = None


class PredictionRevealRequest(BaseModel):
    outputs_scaled: dict[str, int]
    salt: str
    ezkl_receipt: EZKLReceipt | None = None
    revealed_at_ts: int | None = None


class HorizonOutcome(BaseModel):
    horizon_min: int
    actual_return_bps: int
    actual_up: int | None = None
    maturity_ts: int | None = None


class OutcomesUpsertRequest(BaseModel):
    outcomes: list[HorizonOutcome]
    source_id: str = "unknown"
    recorded_at_ts: int | None = None


class ScoreRequest(BaseModel):
    ece_bins: int = Field(default=10, ge=1, le=100)


class ExplainRequest(BaseModel):
    forecast_id: str | None = Field(default=None, description="Forecast id to explain")
    window_id: str | None = Field(default=None, description="Optional window id for lookup")
    score_receipt_id: str | None = Field(default=None, description="Optional score receipt id")


class PnlSimulationRequest(BaseModel):
    subject_id: str | None = None
    pair_id: str | None = None
    network_id: str | None = None
    model_hash: str | None = None
    start_ts: int | None = None
    end_ts: int | None = None
    horizon_min: int = Field(default=30, description="One of 5, 30, 240")
    long_prob_threshold: float = Field(default=0.60, ge=0.0, le=1.0)
    short_prob_threshold: float = Field(default=0.40, ge=0.0, le=1.0)
    min_abs_return_bps: int = Field(default=25, ge=0)
    cost_per_trade_bps: float = Field(default=4.0, ge=0.0)
    limit: int = Field(default=3000, ge=1, le=10000)


def _svc() -> SnapshotForecasterService:
    return get_snapshot_forecaster_service()


@router.post("/windows")
async def create_window(req: WindowCreateRequest) -> dict[str, Any]:
    try:
        return await _svc().create_window(
            pair_id=req.pair_id,
            network_id=req.network_id,
            window_open_ts=req.window_open_ts,
            window_close_ts=req.window_close_ts,
            cadence_id=req.cadence_id,
            snapshot_data=req.snapshot_data,
            feature_schema_id=req.feature_schema_id,
            feature_vector=req.feature_vector,
            data_source_id=req.data_source_id,
            snapshot_provenance_hash=req.snapshot_provenance_hash,
            attest_snapshot=req.attest_snapshot,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/windows")
def list_windows(
    pair_id: str | None = Query(default=None),
    network_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    try:
        rows = _svc().list_windows(pair_id=pair_id, network_id=network_id, limit=limit)
        return {"windows": rows, "count": len(rows)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/windows/{window_id}")
def get_window(window_id: str) -> dict[str, Any]:
    row = _svc().get_window(window_id)
    if not row:
        raise HTTPException(status_code=404, detail="Window not found")
    return row


@router.post("/windows/{window_id}/suggested-outputs")
def suggest_window_outputs(window_id: str, req: SuggestOutputsRequest) -> dict[str, Any]:
    try:
        return _svc().suggest_outputs(
            window_id=window_id,
            horizons_min=req.horizons_min,
            output_bounds=req.output_bounds.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commitment")
def build_commitment(req: BuildCommitmentRequest) -> dict[str, str]:
    try:
        commitment = SnapshotForecasterService.build_prediction_commitment(
            window_id=req.window_id,
            model_hash=req.model_hash,
            schema_id=req.schema_id,
            outputs_scaled=req.outputs_scaled,
            salt=req.salt,
        )
        return {"prediction_commitment": commitment}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/predictions/commit")
def commit_prediction(req: PredictionCommitRequest) -> dict[str, Any]:
    try:
        return _svc().commit_prediction(
            window_id=req.window_id,
            model_identity=req.model_identity.model_dump(),
            guess_ts=req.guess_ts,
            horizons_min=req.horizons_min,
            subject_id=req.subject_id,
            prediction_commitment=req.prediction_commitment,
            outputs_scaled=req.outputs_scaled,
            salt=req.salt,
            output_bounds=req.output_bounds.model_dump(),
            metadata=req.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/predictions/{forecast_id}/reveal")
def reveal_prediction(forecast_id: str, req: PredictionRevealRequest) -> dict[str, Any]:
    try:
        return _svc().reveal_prediction(
            forecast_id=forecast_id,
            outputs_scaled=req.outputs_scaled,
            salt=req.salt,
            ezkl_receipt=req.ezkl_receipt.model_dump() if req.ezkl_receipt else None,
            revealed_at_ts=req.revealed_at_ts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/predictions")
def list_predictions(
    subject_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    pair_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    rows = _svc().list_predictions(subject_id=subject_id, status=status, pair_id=pair_id, limit=limit)
    return {"predictions": rows, "count": len(rows)}


@router.get("/predictions/{forecast_id}")
def get_prediction(forecast_id: str) -> dict[str, Any]:
    row = _svc().get_prediction(forecast_id)
    if not row:
        raise HTTPException(status_code=404, detail="Prediction not found")
    return row


@router.post("/windows/{window_id}/outcomes")
def upsert_outcomes(window_id: str, req: OutcomesUpsertRequest) -> dict[str, Any]:
    try:
        return _svc().upsert_outcomes(
            window_id=window_id,
            outcomes=[o.model_dump() for o in req.outcomes],
            source_id=req.source_id,
            recorded_at_ts=req.recorded_at_ts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/predictions/{forecast_id}/score")
def score_prediction(forecast_id: str, req: ScoreRequest) -> dict[str, Any]:
    try:
        return _svc().score_prediction(forecast_id=forecast_id, ece_bins=req.ece_bins)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/scores/{score_receipt_id}")
def get_score(score_receipt_id: str) -> dict[str, Any]:
    row = _svc().get_score_receipt(score_receipt_id)
    if not row:
        raise HTTPException(status_code=404, detail="Score receipt not found")
    return row


@router.get("/reputation/{subject_id}")
def get_subject_reputation(subject_id: str) -> dict[str, Any]:
    return _svc().get_subject_reputation(subject_id)


@router.get("/reputation/{subject_id}/benchmarks")
def get_subject_horizon_benchmarks(
    subject_id: str,
    limit: int = Query(default=1000, ge=1, le=5000),
) -> dict[str, Any]:
    return _svc().get_subject_horizon_benchmarks(subject_id=subject_id, limit=limit)


@router.get("/reputation/{subject_id}/history")
def get_subject_reputation_history(
    subject_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict[str, Any]:
    rows = _svc().list_subject_score_history(subject_id=subject_id, limit=limit)
    return {"history": rows, "count": len(rows)}


@router.get("/analytics/benchmarks")
def analytics_benchmarks(
    subject_id: str | None = Query(default=None),
    pair_id: str | None = Query(default=None),
    network_id: str | None = Query(default=None),
    model_hash: str | None = Query(default=None),
    start_ts: int | None = Query(default=None),
    end_ts: int | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=10000),
) -> dict[str, Any]:
    try:
        return _svc().get_horizon_benchmarks(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/analytics/calibration")
def analytics_calibration(
    subject_id: str | None = Query(default=None),
    pair_id: str | None = Query(default=None),
    network_id: str | None = Query(default=None),
    model_hash: str | None = Query(default=None),
    start_ts: int | None = Query(default=None),
    end_ts: int | None = Query(default=None),
    bins: int = Query(default=10, ge=2, le=50),
    limit: int = Query(default=2000, ge=1, le=10000),
) -> dict[str, Any]:
    try:
        return _svc().get_calibration_curves(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            bins=bins,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/analytics/latency")
def analytics_latency(
    subject_id: str | None = Query(default=None),
    pair_id: str | None = Query(default=None),
    network_id: str | None = Query(default=None),
    model_hash: str | None = Query(default=None),
    start_ts: int | None = Query(default=None),
    end_ts: int | None = Query(default=None),
    limit: int = Query(default=2000, ge=1, le=10000),
) -> dict[str, Any]:
    try:
        return _svc().get_latency_analytics(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/analytics/drift")
def analytics_drift(
    subject_id: str | None = Query(default=None),
    pair_id: str | None = Query(default=None),
    network_id: str | None = Query(default=None),
    model_hash: str | None = Query(default=None),
    start_ts: int | None = Query(default=None),
    end_ts: int | None = Query(default=None),
    limit: int = Query(default=2000, ge=1, le=10000),
) -> dict[str, Any]:
    try:
        return _svc().get_drift_analytics(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/analytics/leaderboard")
def analytics_leaderboard(
    subject_id: str | None = Query(default=None),
    pair_id: str | None = Query(default=None),
    network_id: str | None = Query(default=None),
    start_ts: int | None = Query(default=None),
    end_ts: int | None = Query(default=None),
    limit: int = Query(default=3000, ge=1, le=10000),
) -> dict[str, Any]:
    try:
        return _svc().get_model_leaderboard(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analytics/pnl-sim")
def analytics_pnl_sim(req: PnlSimulationRequest) -> dict[str, Any]:
    try:
        return _svc().run_pnl_simulation(
            subject_id=req.subject_id,
            pair_id=req.pair_id,
            network_id=req.network_id,
            model_hash=req.model_hash,
            start_ts=req.start_ts,
            end_ts=req.end_ts,
            horizon_min=req.horizon_min,
            long_prob_threshold=req.long_prob_threshold,
            short_prob_threshold=req.short_prob_threshold,
            min_abs_return_bps=req.min_abs_return_bps,
            cost_per_trade_bps=req.cost_per_trade_bps,
            limit=req.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/automation/tick")
def automation_tick(
    max_predictions: int = Query(default=300, ge=1, le=5000),
) -> dict[str, Any]:
    return _svc().auto_ingest_and_score(max_predictions=max_predictions)


@router.post("/explain")
async def explain_forecast(req: ExplainRequest) -> dict[str, Any]:
    if not req.forecast_id and not req.window_id and not req.score_receipt_id:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of forecast_id, window_id, or score_receipt_id",
        )

    svc = _svc()
    score: dict[str, Any] | None = None
    if req.score_receipt_id:
        score = svc.get_score_receipt(req.score_receipt_id)
        if not score:
            raise HTTPException(status_code=404, detail="Score receipt not found")

    forecast_id = req.forecast_id or (str(score.get("forecast_id", "")) if score else None)
    forecast: dict[str, Any] | None = None
    if forecast_id:
        forecast = svc.get_prediction(forecast_id)
        if not forecast:
            raise HTTPException(status_code=404, detail="Prediction not found")
    elif req.window_id:
        candidates = [p for p in svc.list_predictions(limit=500) if p.get("window_id") == req.window_id]
        if not candidates:
            raise HTTPException(status_code=404, detail="No predictions found for window_id")
        forecast = candidates[0]
        forecast_id = str(forecast.get("forecast_id", ""))

    if not forecast:
        raise HTTPException(status_code=404, detail="Prediction not found")

    window_id = req.window_id or str(forecast.get("window_id", ""))
    window = svc.get_window(window_id)
    if not window:
        raise HTTPException(status_code=404, detail="Window not found")

    if not score and forecast.get("score_receipt_id"):
        score = svc.get_score_receipt(str(forecast.get("score_receipt_id")))

    outputs = forecast.get("outputs_scaled") or {}
    outcomes = window.get("outcomes") or {}
    metrics = (score or {}).get("metrics") or {}
    per_horizon = (score or {}).get("per_horizon") or {}

    def _scaled_prob_pct(key: str) -> float:
        try:
            return float(int(outputs.get(key, 0))) / 100.0
        except Exception:
            return 0.0

    def _pred_bps(key: str) -> int:
        try:
            return int(outputs.get(key, 0))
        except Exception:
            return 0

    def _actual_bps(h: int) -> int:
        per_h = per_horizon.get(str(h)) or {}
        if "actual_return_bps" in per_h:
            return int(per_h["actual_return_bps"])
        raw = outcomes.get(str(h)) or {}
        if "actual_return_bps" in raw:
            return int(raw["actual_return_bps"])
        return 0

    context_data: dict[str, Any] = {
        "pair_id": str(window.get("pair_id", "unknown")),
        "status": str(forecast.get("status", "unknown")),
        "trust_mode": str(forecast.get("trust_mode", "commit_reveal_only")),
        "r5_bps": _pred_bps("r5"),
        "r30_bps": _pred_bps("r30"),
        "r240_bps": _pred_bps("r240"),
        "r5_pct": _pred_bps("r5") / 100.0,
        "r30_pct": _pred_bps("r30") / 100.0,
        "r240_pct": _pred_bps("r240") / 100.0,
        "p5_pct": _scaled_prob_pct("p5"),
        "p30_pct": _scaled_prob_pct("p30"),
        "p240_pct": _scaled_prob_pct("p240"),
        "a5_bps": _actual_bps(5),
        "a30_bps": _actual_bps(30),
        "a240_bps": _actual_bps(240),
        "a5_pct": _actual_bps(5) / 100.0,
        "a30_pct": _actual_bps(30) / 100.0,
        "a240_pct": _actual_bps(240) / 100.0,
        "directional_pct": float(metrics.get("directional_accuracy", 0.0)) * 100.0,
        "mae_bps": float(metrics.get("mae_bps", 0.0)),
        "mae_pct": float(metrics.get("mae_bps", 0.0)) / 100.0,
        "brier": float(metrics.get("brier_score", 0.0)),
        "ece": float(metrics.get("ece", 0.0)),
    }

    narration_result = await generate_narration("snapshot_forecast_explain", context_data)
    highlights = [
        (
            f"Predicted returns: 5m {context_data['r5_pct']:.2f}% "
            f"({context_data['r5_bps']} bps), 30m {context_data['r30_pct']:.2f}% "
            f"({context_data['r30_bps']} bps), 4h {context_data['r240_pct']:.2f}% "
            f"({context_data['r240_bps']} bps)"
        ),
        (
            f"Predicted up probability: 5m {context_data['p5_pct']:.1f}%, "
            f"30m {context_data['p30_pct']:.1f}%, 4h {context_data['p240_pct']:.1f}%"
        ),
        (
            "Scored metrics: directional "
            f"{context_data['directional_pct']:.1f}%, "
            f"MAE {context_data['mae_pct']:.2f}% "
            f"({context_data['mae_bps']:.1f} bps), "
            f"Brier {context_data['brier']:.4f}, ECE {context_data['ece']:.4f}"
            if score
            else "Scoring not available yet. Reveal + matured outcomes are required for score receipts."
        ),
    ]

    return {
        "forecast_id": forecast_id,
        "window_id": window_id,
        "score_receipt_id": score.get("score_receipt_id") if score else None,
        "narration": narration_result.get("narration", ""),
        "source": narration_result.get("source", "deterministic"),
        "context_type": narration_result.get("context_type", "snapshot_forecast_explain"),
        "fallback_reason": narration_result.get("fallback_reason"),
        "highlights": highlights,
        "context": context_data,
        "records": {
            "window": window,
            "prediction": forecast,
            "score": score,
        },
    }
