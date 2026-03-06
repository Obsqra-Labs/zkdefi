"""
Yield Forecast Predictor — predicts yield trajectory for DeFi pools.

Uses an MLP trained on pool metrics to classify yield outlook:
  0 = declining, 1 = stable, 2 = growing, 3 = surging

When generate_proof=True, generates an EZKL KZG proof of the inference.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "yield_forecast"
ONNX_PATH = MODEL_DIR / "yield_forecast.onnx"
NORM_PARAMS_PATH = MODEL_DIR / "norm_params.json"

LABELS = ["declining", "stable", "growing", "surging"]

# 12 input features
FEATURE_NAMES = [
    "tvl_usd_log", "volume_24h_log", "fee_tier_bps", "current_apr",
    "apr_7d_avg", "apr_30d_avg", "apr_trend_7d", "apr_volatility_7d",
    "utilization_ratio", "tick_concentration", "num_positions",
    "time_since_last_rebalance_hours",
]


class YieldForecastPredictor:
    """ONNX-based yield forecast predictor with optional EZKL proof."""

    def __init__(self) -> None:
        self._session = None
        self._norm_params: dict[str, Any] | None = None
        self._ready = False
        self._load()

    def _load(self) -> None:
        if not ONNX_PATH.exists():
            logger.warning("Yield forecast ONNX not found at %s", ONNX_PATH)
            return
        try:
            import onnxruntime as ort
            self._session = ort.InferenceSession(str(ONNX_PATH))
            if NORM_PARAMS_PATH.exists():
                self._norm_params = json.loads(NORM_PARAMS_PATH.read_text())
            self._ready = True
            logger.info("Yield forecast predictor loaded (%d bytes ONNX)", ONNX_PATH.stat().st_size)
        except Exception as e:
            logger.warning("Failed to load yield forecast model: %s", e)

    @property
    def is_ready(self) -> bool:
        if not self._ready:
            self._load()
        return self._ready

    def _normalize(self, features: dict[str, float]) -> list[float]:
        """Min-max normalize features using stored parameters."""
        values = [features.get(name, 0.0) for name in FEATURE_NAMES]
        if self._norm_params:
            mins = self._norm_params.get("mins", [0.0] * len(values))
            maxs = self._norm_params.get("maxs", [1.0] * len(values))
            normed = []
            for v, mn, mx in zip(values, mins, maxs):
                rng = mx - mn if mx != mn else 1.0
                normed.append((v - mn) / rng)
            return normed
        return values

    async def predict(
        self,
        pool_features: dict[str, float],
        *,
        generate_proof: bool = False,
        user_address: str = "",
    ) -> dict[str, Any]:
        """
        Predict yield outlook for a pool.

        Args:
            pool_features: Dict of feature name → value.
            generate_proof: If True, generate an EZKL proof.
            user_address: Optional user address for proof registry.

        Returns:
            {"label": str, "class": int, "probabilities": [...], "proof": {...} | None}
        """
        if not self.is_ready:
            return {"error": "Yield forecast model not loaded", "label": "unknown", "class": -1}

        normed = self._normalize(pool_features)
        input_array = np.array([normed], dtype=np.float32)

        # Run ONNX inference
        input_name = self._session.get_inputs()[0].name
        logits = self._session.run(None, {input_name: input_array})[0][0]

        # Softmax
        exp_logits = np.exp(logits - np.max(logits))
        probs = (exp_logits / exp_logits.sum()).tolist()
        pred_class = int(np.argmax(probs))
        label = LABELS[pred_class] if pred_class < len(LABELS) else "unknown"

        result: dict[str, Any] = {
            "label": label,
            "class": pred_class,
            "probabilities": probs,
            "model_name": "yield_forecast_mlp",
            "features": {name: normed[i] for i, name in enumerate(FEATURE_NAMES)},
            "proof": None,
        }

        # EZKL proof
        if generate_proof:
            try:
                from app.services.ezkl_prover_service import get_ezkl_prover, EZKLModelArtifacts
                prover = get_ezkl_prover()

                if "yield_forecast" not in prover._models:
                    compiled = MODEL_DIR / "network.compiled"
                    pk = MODEL_DIR / "pk.key"
                    vk = MODEL_DIR / "vk.key"
                    if compiled.exists() and pk.exists() and vk.exists():
                        arts = EZKLModelArtifacts(
                            model_name="yield_forecast",
                            onnx_path=ONNX_PATH,
                            compiled_model_path=compiled,
                            settings_path=MODEL_DIR / "settings.json",
                            pk_path=pk,
                            vk_path=vk,
                            srs_path=MODEL_DIR / "kzg.srs",
                            calibration_path=MODEL_DIR / "calibration.json",
                            model_hash=hashlib.sha256(ONNX_PATH.read_bytes()).hexdigest(),
                        )
                        prover._models["yield_forecast"] = arts
                        logger.info("EZKL artifacts registered for 'yield_forecast'")
                    else:
                        logger.warning("Yield forecast EZKL artifacts not found — run train_all_ezkl_models.py")

                input_data = [normed]
                ezkl_proof = await prover.prove_inference("yield_forecast", input_data)
                result["proof"] = ezkl_proof.to_dict()

                # Store in proof registry
                try:
                    from app.services.proof_registry import get_proof_registry
                    registry = get_proof_registry()
                    registry.store_proof(
                        proof_hash=ezkl_proof.proof_hash,
                        model_name="yield_forecast",
                        user_address=user_address,
                        action_type="yield_estimate",
                        proof_size_bytes=len(ezkl_proof.proof_bytes),
                        inference_output=probs,
                        verified_locally=True,
                    )
                except Exception as e:
                    logger.warning("Failed to store proof in registry: %s", e)

            except Exception as e:
                logger.warning("EZKL proof generation failed for yield_forecast: %s", e)
                result["proof_error"] = str(e)

        return result


# ── Singleton ────────────────────────────────────────────────────────────

_instance: YieldForecastPredictor | None = None


def get_yield_predictor() -> YieldForecastPredictor:
    global _instance
    if _instance is None:
        _instance = YieldForecastPredictor()
    return _instance
