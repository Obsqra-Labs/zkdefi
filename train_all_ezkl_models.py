#!/usr/bin/env python3
"""
Train and setup EZKL circuits for ALL provable MLP models.

This script:
  1. Trains yield_forecast MLP on synthetic pool data
  2. Trains anomaly_detector MLP on synthetic safety data
  3. Exports both to ONNX (opset 13, Linear+ReLU only)
  4. Runs full EZKL setup for each: gen_settings → calibrate → compile → SRS → setup
  5. Generates a test proof + verification for each model

Run:
  cd /opt/obsqra.starknet/zkdefi && python3 train_all_ezkl_models.py
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

sys.path.insert(0, str(Path(__file__).parent / "backend"))

BASE = Path(__file__).parent / "backend" / "app" / "data" / "ezkl_models"


# ─────────────────────────────────────────────────────────────────────────
# Yield Forecast Model
# ─────────────────────────────────────────────────────────────────────────

def train_yield_forecast():
    """Train yield forecast MLP on synthetic pool data."""
    import torch
    import torch.nn as nn
    from app.ml.yield_forecast.model import (
        YieldForecastMLP, export_onnx, YIELD_CLASSES, FEATURE_NAMES,
    )

    logger.info("═══ Training Yield Forecast MLP ═══")
    model_dir = BASE / "yield_forecast"
    model_dir.mkdir(parents=True, exist_ok=True)

    n_features = len(FEATURE_NAMES)
    n_classes = len(YIELD_CLASSES)
    n_samples = 400

    # Generate synthetic pool data
    rng = np.random.RandomState(42)

    X = np.zeros((n_samples, n_features), dtype=np.float32)
    y = np.zeros(n_samples, dtype=np.int32)

    for i in range(n_samples):
        cls = i % n_classes
        y[i] = cls

        # Base features
        tvl_log = rng.uniform(4, 9)          # log10 TVL: $10K to $1B
        vol_log = rng.uniform(3, 8)          # log10 volume
        fee_tier = rng.choice([5, 30, 100]) / 10000.0
        cur_apr = rng.uniform(0.01, 0.5)
        apr_7d = rng.uniform(0.01, 0.5)
        apr_30d = rng.uniform(0.01, 0.5)

        # Class-dependent patterns
        if cls == 0:  # declining
            apr_trend = rng.uniform(-0.8, -0.2)
            apr_vol = rng.uniform(0.1, 0.4)
        elif cls == 1:  # stable
            apr_trend = rng.uniform(-0.2, 0.2)
            apr_vol = rng.uniform(0.0, 0.1)
        elif cls == 2:  # growing
            apr_trend = rng.uniform(0.2, 0.5)
            apr_vol = rng.uniform(0.05, 0.2)
        else:  # surging
            apr_trend = rng.uniform(0.5, 1.5)
            apr_vol = rng.uniform(0.15, 0.4)

        utilization = rng.uniform(0.01, 0.5)
        tick_conc = rng.uniform(0.1, 0.9)
        num_pos = rng.uniform(0, 1)
        hours_since = rng.uniform(0, 168)  # up to 7 days

        X[i] = [tvl_log, vol_log, fee_tier, cur_apr, apr_7d, apr_30d,
                 apr_trend, apr_vol, utilization, tick_conc, num_pos, hours_since]

    # Min-max normalise
    X_min = X.min(axis=0)
    X_max = X.max(axis=0)
    X_range = np.where(X_max - X_min > 1e-8, X_max - X_min, 1.0)
    X_normed = (X - X_min) / X_range

    norm_params = {"min": X_min.tolist(), "range": X_range.tolist()}
    (model_dir / "norm_params.json").write_text(json.dumps(norm_params))

    # Train
    model = YieldForecastMLP(n_features, n_classes)
    X_t = torch.tensor(X_normed, dtype=torch.float32)
    y_t = torch.tensor(y.astype(np.int64), dtype=torch.long)

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    model.train()
    for epoch in range(600):
        optimizer.zero_grad()
        loss = criterion(model(X_t), y_t)
        loss.backward()
        optimizer.step()

    model.eval()
    with torch.no_grad():
        preds = model(X_t).argmax(dim=1).numpy()
    acc = float((preds == y).mean())
    logger.info("Yield forecast MLP: loss=%.4f, accuracy=%.3f", loss.item(), acc)

    # Save
    torch.save(model.state_dict(), str(model_dir / "yield_forecast_mlp.pt"))
    onnx_path = model_dir / "yield_forecast.onnx"
    export_onnx(model, str(onnx_path), n_features=n_features)
    logger.info("ONNX exported: %s (%d bytes)", onnx_path, onnx_path.stat().st_size)

    # Calibration data
    cal = [X_normed[i].tolist() for i in range(min(10, len(X_normed)))]
    (model_dir / "calibration.json").write_text(json.dumps({"input_data": cal}))

    meta = {
        "model_name": "yield_forecast",
        "model_hash": hashlib.sha256(onnx_path.read_bytes()).hexdigest(),
        "accuracy": acc,
        "n_features": n_features,
        "n_classes": n_classes,
        "n_samples": n_samples,
        "architecture": "Linear(12→32)→ReLU→Linear(32→16)→ReLU→Linear(16→4)",
    }
    (model_dir / "training_metadata.json").write_text(json.dumps(meta, indent=2))
    return model_dir, onnx_path


# ─────────────────────────────────────────────────────────────────────────
# Anomaly Detector Model
# ─────────────────────────────────────────────────────────────────────────

def train_anomaly_detector():
    """Train anomaly detector MLP on synthetic safety data."""
    import torch
    import torch.nn as nn
    from app.ml.anomaly_detector.model import (
        AnomalyDetectorMLP, export_onnx, ANOMALY_CLASSES, FEATURE_NAMES,
    )

    logger.info("═══ Training Anomaly Detector MLP ═══")
    model_dir = BASE / "anomaly_detector"
    model_dir.mkdir(parents=True, exist_ok=True)

    n_features = len(FEATURE_NAMES)
    n_classes = len(ANOMALY_CLASSES)
    n_samples = 300

    rng = np.random.RandomState(123)

    X = np.zeros((n_samples, n_features), dtype=np.float32)
    y = np.zeros(n_samples, dtype=np.int32)

    for i in range(n_samples):
        cls = i % n_classes
        y[i] = cls

        if cls == 0:  # safe
            tvl_stab = rng.uniform(0.8, 1.0)
            liq_conc = rng.uniform(0.3, 0.8)
            price_impact = rng.uniform(0, 20)
            deployer = rng.uniform(0.7, 1.0)
            vol_pattern = rng.uniform(0.7, 1.0)
            fee_anomaly = rng.uniform(0, 0.1)
            large_wd = rng.uniform(0, 0.05)
            smart_flow = rng.uniform(-0.2, 0.3)
        elif cls == 1:  # warning
            tvl_stab = rng.uniform(0.5, 0.8)
            liq_conc = rng.uniform(0.1, 0.5)
            price_impact = rng.uniform(20, 80)
            deployer = rng.uniform(0.3, 0.7)
            vol_pattern = rng.uniform(0.3, 0.7)
            fee_anomaly = rng.uniform(0.1, 0.5)
            large_wd = rng.uniform(0.05, 0.15)
            smart_flow = rng.uniform(-0.5, 0.0)
        else:  # critical
            tvl_stab = rng.uniform(0.0, 0.5)
            liq_conc = rng.uniform(0.0, 0.2)
            price_impact = rng.uniform(80, 300)
            deployer = rng.uniform(0.0, 0.3)
            vol_pattern = rng.uniform(0.0, 0.3)
            fee_anomaly = rng.uniform(0.5, 2.0)
            large_wd = rng.uniform(0.15, 0.5)
            smart_flow = rng.uniform(-1.0, -0.5)

        X[i] = [tvl_stab, liq_conc, price_impact, deployer,
                 vol_pattern, fee_anomaly, large_wd, smart_flow]

    # Normalise
    X_min = X.min(axis=0)
    X_max = X.max(axis=0)
    X_range = np.where(X_max - X_min > 1e-8, X_max - X_min, 1.0)
    X_normed = (X - X_min) / X_range

    norm_params = {"min": X_min.tolist(), "range": X_range.tolist()}
    (model_dir / "norm_params.json").write_text(json.dumps(norm_params))

    # Train
    model = AnomalyDetectorMLP(n_features, n_classes)
    X_t = torch.tensor(X_normed, dtype=torch.float32)
    y_t = torch.tensor(y.astype(np.int64), dtype=torch.long)

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    model.train()
    for epoch in range(600):
        optimizer.zero_grad()
        loss = criterion(model(X_t), y_t)
        loss.backward()
        optimizer.step()

    model.eval()
    with torch.no_grad():
        preds = model(X_t).argmax(dim=1).numpy()
    acc = float((preds == y).mean())
    logger.info("Anomaly detector MLP: loss=%.4f, accuracy=%.3f", loss.item(), acc)

    # Save
    torch.save(model.state_dict(), str(model_dir / "anomaly_detector_mlp.pt"))
    onnx_path = model_dir / "anomaly_detector.onnx"
    export_onnx(model, str(onnx_path), n_features=n_features)
    logger.info("ONNX exported: %s (%d bytes)", onnx_path, onnx_path.stat().st_size)

    # Calibration data
    cal = [X_normed[i].tolist() for i in range(min(10, len(X_normed)))]
    (model_dir / "calibration.json").write_text(json.dumps({"input_data": cal}))

    meta = {
        "model_name": "anomaly_detector",
        "model_hash": hashlib.sha256(onnx_path.read_bytes()).hexdigest(),
        "accuracy": acc,
        "n_features": n_features,
        "n_classes": n_classes,
        "n_samples": n_samples,
        "architecture": "Linear(8→24)→ReLU→Linear(24→12)→ReLU→Linear(12→3)",
    }
    (model_dir / "training_metadata.json").write_text(json.dumps(meta, indent=2))
    return model_dir, onnx_path


# ─────────────────────────────────────────────────────────────────────────
# EZKL Setup  (shared for any model)
# ─────────────────────────────────────────────────────────────────────────

async def ezkl_setup_model(model_dir: Path, onnx_path: Path, model_name: str):
    """Run full EZKL setup: gen_settings → calibrate → get_srs → compile → setup."""
    import ezkl

    logger.info("─── EZKL setup for '%s' ───", model_name)

    settings_path = str(model_dir / "settings.json")
    compiled_path = str(model_dir / "network.compiled")
    srs_path = str(model_dir / "kzg.srs")
    pk_path = str(model_dir / "pk.key")
    vk_path = str(model_dir / "vk.key")
    cal_path = str(model_dir / "calibration.json")

    t0 = time.time()

    # 1. Generate settings
    ezkl.gen_settings(str(onnx_path), settings_path)
    logger.info("  gen_settings done")

    # 2. Calibrate
    if (model_dir / "calibration.json").exists():
        ezkl.calibrate_settings(cal_path, str(onnx_path), settings_path, "resources")
        logger.info("  calibrate done")

    # 3. Get SRS (async — downloads via HTTP)
    # Read logrows from settings to pass explicitly
    with open(settings_path) as f:
        _s = json.load(f)
    logrows = _s.get("run_args", {}).get("logrows", 17)
    await ezkl.get_srs(settings_path=settings_path, logrows=logrows, srs_path=srs_path)
    logger.info("  get_srs done (logrows=%d)", logrows)

    # 4. Compile
    ezkl.compile_circuit(str(onnx_path), compiled_path, settings_path)
    csize = Path(compiled_path).stat().st_size
    logger.info("  compile done (%d bytes)", csize)

    # 5. Setup (generate pk/vk) — NOTE: ezkl.setup arg order is (compiled, vk, pk, srs)
    ezkl.setup(compiled_path, vk_path, pk_path, srs_path)
    pk_size = Path(pk_path).stat().st_size
    vk_size = Path(vk_path).stat().st_size
    logger.info("  setup done: pk=%d bytes, vk=%d bytes", pk_size, vk_size)

    elapsed = time.time() - t0
    logger.info("  EZKL setup complete for '%s' in %.1fs", model_name, elapsed)
    return True


async def ezkl_test_proof(model_dir: Path, model_name: str, test_input: list[float]):
    """Generate and verify a test proof."""
    import ezkl
    import tempfile

    logger.info("─── Test proof for '%s' ───", model_name)

    compiled_path = str(model_dir / "network.compiled")
    pk_path = str(model_dir / "pk.key")
    vk_path = str(model_dir / "vk.key")
    srs_path = str(model_dir / "kzg.srs")
    settings_path = str(model_dir / "settings.json")

    with tempfile.TemporaryDirectory() as td:
        inp = f"{td}/input.json"
        wit = f"{td}/witness.json"
        prf = f"{td}/proof.json"

        with open(inp, "w") as f:
            json.dump({"input_data": [test_input]}, f)

        t0 = time.time()
        ezkl.gen_witness(inp, compiled_path, wit)
        ezkl.prove(wit, compiled_path, pk_path, prf, srs_path)
        prove_time = time.time() - t0

        proof_data = json.loads(Path(prf).read_text())
        proof_hex = proof_data.get("hex_proof", "")
        proof_bytes = bytes.fromhex(proof_hex.replace("0x", "")) if proof_hex else b""
        proof_hash = hashlib.sha256(proof_bytes).hexdigest()

        logger.info("  proof generated: %d bytes, hash=0x%s…, time=%.2fs",
                     len(proof_bytes), proof_hash[:12], prove_time)

        # Verify
        result = ezkl.verify(prf, settings_path, vk_path, srs_path)
        logger.info("  verify: %s ✓" if result else "  verify: %s ✗", result)

        return result


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────

async def main():
    logger.info("╔══════════════════════════════════════════════════╗")
    logger.info("║   Training & EZKL Setup for ALL Provable Models  ║")
    logger.info("╚══════════════════════════════════════════════════╝")

    results = {}

    # 1. Yield Forecast
    yf_dir, yf_onnx = train_yield_forecast()
    await ezkl_setup_model(yf_dir, yf_onnx, "yield_forecast")
    yf_ok = await ezkl_test_proof(yf_dir, "yield_forecast", [0.5] * 12)
    results["yield_forecast"] = {"trained": True, "ezkl_setup": True, "proof_verified": yf_ok}

    # 2. Anomaly Detector
    ad_dir, ad_onnx = train_anomaly_detector()
    await ezkl_setup_model(ad_dir, ad_onnx, "anomaly_detector")
    ad_ok = await ezkl_test_proof(ad_dir, "anomaly_detector", [0.5] * 8)
    results["anomaly_detector"] = {"trained": True, "ezkl_setup": True, "proof_verified": ad_ok}

    # Summary
    logger.info("")
    logger.info("╔══════════════════════════════════════════════════╗")
    logger.info("║                    RESULTS                       ║")
    logger.info("╠══════════════════════════════════════════════════╣")
    for name, r in results.items():
        status = "✓" if r["proof_verified"] else "✗"
        logger.info("║  %s %s: trained=%s, ezkl=%s, proof=%s",
                     status, name.ljust(20),
                     r["trained"], r["ezkl_setup"], r["proof_verified"])
    logger.info("╚══════════════════════════════════════════════════╝")

    all_ok = all(r["proof_verified"] for r in results.values())
    if all_ok:
        logger.info("All models trained and EZKL-proven successfully!")
    return all_ok


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
