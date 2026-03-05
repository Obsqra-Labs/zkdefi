"""
Timing Predictor MLP Trainer — EZKL-provable rebalance timing model.

Architecture: MLP (not LSTM) — EZKL cannot prove recurrent ops.
Input: 15 features extracted from fee snapshot windows.
Output: 2 values (blocks_ahead, confidence).

Training data: fee_snapshots from live Ekubo positions + mainnet pool data.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "timing_predictor"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# 15 features from fee snapshot windows
FEATURE_NAMES = [
    "fee0_current",
    "fee1_current",
    "tvl_current",
    "fee_velocity_short",
    "fee_velocity_long",
    "fee_acceleration",
    "fee_volatility",
    "utilization_ratio",
    "volume_trend",
    "position_age_hours",
    "tick_distance_from_center",
    "gas_price_gwei",
    "time_since_last_rebalance_hours",
    "pool_concentration",
    "fee_to_tvl_ratio",
]


class TimingMLP(nn.Module):
    """
    Small MLP for timing prediction — EZKL-compatible (Linear + ReLU only).

    Input:  15 features (normalised)
    Output: 2 values (blocks_ahead_normalised, confidence)
    """

    def __init__(self, n_features: int = 15) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def export_onnx(
    model: TimingMLP,
    path: str,
    n_features: int = 15,
    opset_version: int = 13,
) -> None:
    """Export timing MLP to ONNX for EZKL."""
    model.eval()
    dummy = torch.randn(1, n_features)
    torch.onnx.export(
        model,
        dummy,
        path,
        input_names=["features"],
        output_names=["prediction"],
        dynamic_axes=None,
        opset_version=opset_version,
        dynamo=False,
    )


def _extract_features_from_snapshot_window(
    snapshots: list[dict[str, Any]],
    lookback: int = 20,
) -> list[float]:
    """
    Extract the 15-dim feature vector from a window of fee snapshots.

    Each snapshot has: {fees0_usd, fees1_usd, tvl_usd, timestamp, ...}
    """
    recent = snapshots[-lookback:] if len(snapshots) >= lookback else snapshots

    if len(recent) < 3:
        return [0.0] * len(FEATURE_NAMES)

    fees0 = [float(s.get("fees0_usd", 0)) for s in recent]
    fees1 = [float(s.get("fees1_usd", 0)) for s in recent]
    tvls = [float(s.get("tvl_usd", 1)) for s in recent]
    total_fees = [f0 + f1 for f0, f1 in zip(fees0, fees1)]

    # Velocities
    velocities = [total_fees[i] - total_fees[i - 1] for i in range(1, len(total_fees))]
    short_vel = sum(velocities[-3:]) / max(len(velocities[-3:]), 1)
    long_vel = sum(velocities) / max(len(velocities), 1)
    acceleration = short_vel - long_vel

    # Volatility
    if velocities:
        mean_v = sum(velocities) / len(velocities)
        variance = sum((v - mean_v) ** 2 for v in velocities) / len(velocities)
        volatility = variance ** 0.5
    else:
        volatility = 0.0

    # Volume trend (tvl proxy)
    if len(tvls) >= 2:
        volume_trend = (tvls[-1] - tvls[0]) / max(tvls[0], 1)
    else:
        volume_trend = 0.0

    tvl_current = tvls[-1] if tvls else 0.0
    utilization = total_fees[-1] / max(tvl_current, 1) if total_fees else 0.0
    fee_to_tvl = sum(total_fees) / max(tvl_current * len(total_fees), 1)

    # Position metadata (from last snapshot if available)
    last = recent[-1]
    position_age = float(last.get("position_age_hours", 24.0))
    tick_distance = float(last.get("tick_distance", 0.0))
    gas_price = float(last.get("gas_price_gwei", 20.0))
    time_since_rebalance = float(last.get("time_since_rebalance_hours", 24.0))
    concentration = float(last.get("pool_concentration", 0.5))

    return [
        fees0[-1],
        fees1[-1],
        tvl_current,
        short_vel,
        long_vel,
        acceleration,
        volatility,
        utilization,
        volume_trend,
        position_age,
        tick_distance,
        gas_price,
        time_since_rebalance,
        concentration,
        fee_to_tvl,
    ]


def _generate_heuristic_label(features: list[float]) -> list[float]:
    """
    Generate training label from heuristic timing logic.

    Returns: [blocks_ahead_normalised, confidence]
    where blocks_ahead_normalised = blocks_ahead / 100 (clamped 0-1).
    """
    short_vel = features[3]
    long_vel = features[4]
    volatility = features[6]

    if short_vel > long_vel and short_vel > 0:
        # Fee momentum positive → rebalance soon
        blocks = max(3, int(5 * (1 - min(short_vel / (long_vel + 0.001), 2) / 2)))
        conf = min(0.9, 0.5 + abs(short_vel - long_vel) / (volatility + 0.001) * 0.1)
    elif volatility < abs(long_vel) * 0.3 + 0.001:
        blocks = 20
        conf = 0.6
    else:
        blocks = 30
        conf = 0.4

    return [min(1.0, blocks / 100), min(1.0, max(0.0, conf))]


def _generate_synthetic_training_data(n_samples: int = 500) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic fee snapshot data for initial timing model training.
    Uses randomisation + heuristic labels to bootstrap the model.
    """
    rng = np.random.default_rng(42)
    X_list = []
    y_list = []

    for _ in range(n_samples):
        # Generate a random fee snapshot window
        n_steps = rng.integers(5, 30)
        base_fee = rng.uniform(0, 100)
        base_tvl = rng.uniform(1000, 1_000_000)

        snapshots = []
        for t in range(n_steps):
            fee_noise = rng.normal(0, base_fee * 0.1)
            tvl_noise = rng.normal(0, base_tvl * 0.02)
            snapshots.append({
                "fees0_usd": max(0, base_fee + fee_noise + t * rng.uniform(-0.5, 2.0)),
                "fees1_usd": max(0, base_fee * 0.5 + fee_noise * 0.5),
                "tvl_usd": max(100, base_tvl + tvl_noise),
                "position_age_hours": float(t * 2 + rng.uniform(1, 48)),
                "tick_distance": rng.uniform(0, 500),
                "gas_price_gwei": rng.uniform(1, 100),
                "time_since_rebalance_hours": rng.uniform(1, 72),
                "pool_concentration": rng.uniform(0.1, 0.95),
            })

        features = _extract_features_from_snapshot_window(snapshots)
        label = _generate_heuristic_label(features)

        X_list.append(features)
        y_list.append(label)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.float32)


def _generate_from_collected_data(pool_samples: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate training data from real collected pool samples.
    Converts pool samples into fee snapshot-like features.
    """
    if not pool_samples:
        return np.zeros((0, len(FEATURE_NAMES)), dtype=np.float32), np.zeros((0, 2), dtype=np.float32)

    X_list = []
    y_list = []

    for sample in pool_samples:
        tvl = float(sample.get("tvl_usd", 0))
        if tvl < 100:
            continue

        volume = float(sample.get("volume_24h_usd", 0))
        apr = float(sample.get("current_apr", 0))
        fee_bps = float(sample.get("fee_tier_bps", 30))

        # Approximate fee from volume and fee tier
        daily_fee = volume * fee_bps / 10000
        hourly_fee = daily_fee / 24

        features = [
            hourly_fee * 0.6,          # fee0_current
            hourly_fee * 0.4,          # fee1_current
            tvl,                        # tvl_current
            hourly_fee * 0.01,         # fee_velocity_short
            hourly_fee * 0.005,        # fee_velocity_long
            hourly_fee * 0.002,        # fee_acceleration
            hourly_fee * 0.1,          # fee_volatility
            min(1.0, volume / tvl) if tvl > 0 else 0,  # utilization
            float(sample.get("apr_trend_7d", 0)) * 0.01,  # volume_trend
            float(sample.get("time_since_last_rebalance_hours", 24)),
            0.0,                        # tick_distance (not in pool data)
            20.0,                       # gas_price (default)
            float(sample.get("time_since_last_rebalance_hours", 24)),
            float(sample.get("tick_concentration", 0.5)),
            daily_fee / max(tvl, 1),   # fee_to_tvl_ratio
        ]

        label = _generate_heuristic_label(features)
        X_list.append(features)
        y_list.append(label)

    if not X_list:
        return np.zeros((0, len(FEATURE_NAMES)), dtype=np.float32), np.zeros((0, 2), dtype=np.float32)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.float32)


async def train_timing_model(
    pool_samples: list[dict] | None = None,
    synthetic_samples: int = 500,
    epochs: int = 300,
    lr: float = 1e-3,
) -> dict[str, Any]:
    """
    Train the timing predictor MLP and export to ONNX.

    Uses real pool data if available, augmented with synthetic data.
    Then runs EZKL setup for proof generation.

    Returns:
        Dict with model_path, onnx_path, model_hash, metrics.
    """
    logger.info("Training timing predictor MLP...")

    # Combine real + synthetic data
    X_parts = []
    y_parts = []

    if pool_samples:
        X_real, y_real = _generate_from_collected_data(pool_samples)
        if len(X_real) > 0:
            X_parts.append(X_real)
            y_parts.append(y_real)
            logger.info("Real data: %d samples from pool collection", len(X_real))

    X_synth, y_synth = _generate_synthetic_training_data(synthetic_samples)
    X_parts.append(X_synth)
    y_parts.append(y_synth)
    logger.info("Synthetic data: %d samples", len(X_synth))

    X = np.concatenate(X_parts, axis=0)
    y = np.concatenate(y_parts, axis=0)

    # Normalise features (min-max)
    X_min = X.min(axis=0)
    X_max = X.max(axis=0)
    X_range = np.where(X_max - X_min > 1e-8, X_max - X_min, 1.0)
    X_normed = (X - X_min) / X_range

    norm_params = {"min": X_min.tolist(), "range": X_range.tolist()}
    (MODEL_DIR / "norm_params.json").write_text(json.dumps(norm_params))

    # Train MLP
    model = TimingMLP(n_features=len(FEATURE_NAMES))
    X_tensor = torch.tensor(X_normed, dtype=torch.float32)
    y_tensor = torch.tensor(y, dtype=torch.float32)

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.MSELoss()

    model.train()
    for epoch in range(epochs):
        optimizer.zero_grad()
        pred = model(X_tensor)
        loss = criterion(pred, y_tensor)
        loss.backward()
        optimizer.step()

    model.eval()
    final_loss = loss.item()

    # Evaluation
    with torch.no_grad():
        preds = model(X_tensor).numpy()
    mae_blocks = float(np.mean(np.abs(preds[:, 0] - y[:, 0])) * 100)  # unscale
    mae_conf = float(np.mean(np.abs(preds[:, 1] - y[:, 1])))

    logger.info(
        "Timing MLP trained: %d epochs, loss=%.6f, MAE_blocks=%.1f, MAE_conf=%.3f",
        epochs, final_loss, mae_blocks, mae_conf,
    )

    # Save weights
    weights_path = MODEL_DIR / "timing_predictor_mlp.pt"
    torch.save(model.state_dict(), str(weights_path))

    # Export ONNX
    onnx_path = MODEL_DIR / "timing_predictor.onnx"
    export_onnx(model, str(onnx_path), n_features=len(FEATURE_NAMES))
    logger.info("Timing ONNX exported to %s", onnx_path)

    # Model hash
    model_hash = hashlib.sha256(onnx_path.read_bytes()).hexdigest()

    # Calibration data for EZKL
    cal_data = X_normed[:5].tolist()
    (MODEL_DIR / "calibration.json").write_text(json.dumps({"input_data": cal_data}))

    # Save metadata
    meta = {
        "model_hash": model_hash,
        "onnx_path": str(onnx_path),
        "weights_path": str(weights_path),
        "norm_params_path": str(MODEL_DIR / "norm_params.json"),
        "training_samples": len(X),
        "real_samples": len(X) - synthetic_samples,
        "synthetic_samples": synthetic_samples,
        "epochs": epochs,
        "final_loss": final_loss,
        "mae_blocks": mae_blocks,
        "mae_confidence": mae_conf,
        "feature_names": FEATURE_NAMES,
        "architecture": "15→32→16→2",
        "trained_at": datetime.utcnow().isoformat(),
    }
    (MODEL_DIR / "training_metadata.json").write_text(json.dumps(meta, indent=2))

    return {
        "status": "success",
        "model_hash": model_hash,
        "onnx_path": str(onnx_path),
        "training_samples": len(X),
        "final_loss": final_loss,
        "mae_blocks": mae_blocks,
        "mae_confidence": mae_conf,
    }


async def setup_timing_ezkl(force: bool = False) -> dict[str, Any]:
    """
    Run EZKL setup for the timing predictor model.

    Requires: train_timing_model() must have been run first.
    """
    from app.services.ezkl_prover_service import get_ezkl_prover

    meta_path = MODEL_DIR / "training_metadata.json"
    if not meta_path.exists():
        return {"status": "error", "message": "No trained model. Run train_timing_model() first."}

    meta = json.loads(meta_path.read_text())
    onnx_path = meta.get("onnx_path")
    if not onnx_path or not Path(onnx_path).exists():
        return {"status": "error", "message": f"ONNX not found at {onnx_path}"}

    # Load calibration data
    cal_path = MODEL_DIR / "calibration.json"
    cal_data = None
    if cal_path.exists():
        cal_data = json.loads(cal_path.read_text()).get("input_data")

    prover = get_ezkl_prover()
    artifacts = await prover.setup_model(
        model_name="timing_predictor",
        onnx_path=onnx_path,
        calibration_data=cal_data,
        input_scale=7,
        param_scale=7,
        bits=16,
        logrows=17,
        force=force,
    )

    return {
        "status": "success",
        "model_name": "timing_predictor",
        "model_hash": artifacts.model_hash,
        "compiled": str(artifacts.compiled_model_path),
        "pk": str(artifacts.pk_path),
        "vk": str(artifacts.vk_path),
        "ready": artifacts.is_ready(),
    }
