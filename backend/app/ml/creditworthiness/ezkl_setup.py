"""
EZKL setup for the creditworthiness model.

One-time operation: compiles the ONNX model, generates proving/verification keys,
and prepares calibration data for quantisation.

Usage:
    python -m app.ml.creditworthiness.ezkl_setup
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "creditworthiness"


async def setup_creditworthiness_ezkl(
    force: bool = False,
    input_scale: int = 7,
    param_scale: int = 7,
    bits: int = 16,
    logrows: int = 17,
) -> dict:
    """
    Set up EZKL proving for the creditworthiness model.

    1. Loads the ONNX model path from training metadata
    2. Generates calibration data from representative feature vectors
    3. Runs EZKL setup pipeline
    """
    from app.services.ezkl_prover_service import get_ezkl_prover
    from app.ml.creditworthiness.features import FEATURE_NAMES

    meta_path = MODEL_DIR / "training_metadata.json"
    if not meta_path.exists():
        return {"status": "error", "message": "No trained model found. Run trainer.train_model() first."}

    meta = json.loads(meta_path.read_text())
    onnx_path = meta.get("onnx_path")
    if not onnx_path or not Path(onnx_path).exists():
        return {"status": "error", "message": f"ONNX model not found at {onnx_path}"}

    # Generate calibration data — representative feature vectors
    n_features = len(FEATURE_NAMES)
    calibration_data = []

    # Conservative user profile
    calibration_data.append([0.0] * n_features)
    calibration_data[0][5] = 1.0   # success_rate
    calibration_data[0][9] = 1.0   # proof_success_rate

    # Aggressive user profile
    aggressive = [5.0, 100.0, 50000.0, 365.0, 8.0, 0.98, 50.0,
                  0.05, 24.0, 0.95, 2.0, 5.0, 5.0, 12.0,
                  2.0, 180.0, 10.0, 800.0]
    calibration_data.append(aggressive)

    # Risky user profile
    risky = [1.0, 10.0, 1000.0, 30.0, 2.0, 0.80, 5.0,
             0.4, 2.0, 0.6, 10.0, 0.5, 20.0, 168.0,
             0.0, 7.0, 0.0, 100.0]
    calibration_data.append(risky)

    prover = get_ezkl_prover()
    artifacts = await prover.setup_model(
        model_name="creditworthiness",
        onnx_path=onnx_path,
        calibration_data=calibration_data,
        input_scale=input_scale,
        param_scale=param_scale,
        bits=bits,
        logrows=logrows,
        force=force,
    )

    return {
        "status": "success",
        "model_name": "creditworthiness",
        "model_hash": artifacts.model_hash,
        "compiled": str(artifacts.compiled_model_path),
        "pk": str(artifacts.pk_path),
        "vk": str(artifacts.vk_path),
        "ready": artifacts.is_ready(),
    }


if __name__ == "__main__":
    result = asyncio.run(setup_creditworthiness_ezkl(force=True))
    print(json.dumps(result, indent=2))
