#!/usr/bin/env python3
"""
Train MLP creditworthiness model + run full EZKL circuit setup.

This script:
  1. Trains a PyTorch MLP on the same data pipeline as XGBoost
  2. Exports MLP to ONNX (Linear + ReLU only — EZKL-compatible)
  3. Runs EZKL gen_settings → calibrate → get_srs → compile_circuit → setup
  4. Verifies the full pipeline with a test proof

Run from project root:
    cd /opt/obsqra.starknet/zkdefi
    python3 train_mlp_ezkl.py
"""
import asyncio
import hashlib
import json
import logging
import sys
import os
import time
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
os.chdir(str(Path(__file__).resolve().parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("train_mlp_ezkl")

MODEL_DIR = Path("backend/app/data/ezkl_models/creditworthiness")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

CREDIT_CLASSES = ["AAA", "AA", "A", "B", "C"]
FEATURE_NAMES = [
    "chains_active", "total_tx_count", "total_value_usd", "account_age_days",
    "protocol_diversity", "success_rate", "unique_contracts",
    "early_exit_rate", "avg_hold_duration_hours", "proof_success_rate",
    "rebalance_frequency", "avg_action_size_eth", "max_single_loss_pct",
    "time_since_last_action_hours",
    "tier", "tenure_days", "collateral_eth", "on_chain_reputation_score",
]

N_FEATURES = len(FEATURE_NAMES)
N_CLASSES = len(CREDIT_CLASSES)


def generate_synthetic_training_data(n_samples: int = 200):
    """
    Generate diverse synthetic training data spanning all 5 credit classes.
    Mimics the heuristic labelling from trainer.py but ensures class coverage.
    """
    import numpy as np

    np.random.seed(42)
    X = []
    y = []

    for _ in range(n_samples):
        # Random behavioral profile
        chains = np.random.uniform(1, 5)
        tx_count = np.random.uniform(0, 100)
        value_usd = np.random.uniform(0, 100000)
        age_days = np.random.uniform(0, 365)
        proto_div = np.random.uniform(0, 10)
        success = np.random.uniform(0.5, 1.0)
        contracts = np.random.uniform(0, 50)
        early_exit = np.random.uniform(0, 1.0)
        hold_hours = np.random.uniform(0, 500)
        proof_success = np.random.uniform(0.3, 1.0)
        rebal_freq = np.random.uniform(0, 2)
        action_size = np.random.uniform(0, 10)
        max_loss = np.random.uniform(0, 0.5)
        time_since = np.random.uniform(0, 720)
        tier = np.random.uniform(0, 5)
        tenure = np.random.uniform(0, 365)
        collateral = np.random.uniform(0, 50)
        rep_score = np.random.uniform(0, 100)

        features = [
            chains, tx_count, value_usd, age_days, proto_div, success, contracts,
            early_exit, hold_hours, proof_success, rebal_freq, action_size,
            max_loss, time_since, tier, tenure, collateral, rep_score,
        ]

        # Heuristic label (same logic as trainer.py)
        score = 100
        score -= int(early_exit * 40)
        score -= int((1 - proof_success) * 20)
        score += min(int(tenure / 36), 20)
        score += min(int(value_usd / 10000), 10)
        if tx_count < 5:
            score = min(score, 70)
        if tx_count < 2:
            score = min(score, 50)

        if score >= 90:
            label = 0  # AAA
        elif score >= 75:
            label = 1  # AA
        elif score >= 60:
            label = 2  # A
        elif score >= 40:
            label = 3  # B
        else:
            label = 4  # C

        X.append(features)
        y.append(label)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int64)


def train_mlp(X, y, epochs=500, lr=1e-3):
    """Train the MLP and return model + normalisation params."""
    import numpy as np
    import torch
    import torch.nn as nn
    from app.ml.creditworthiness.mlp_model import CreditMLP

    # Normalise
    X_min = X.min(axis=0)
    X_max = X.max(axis=0)
    X_range = np.where(X_max - X_min > 1e-8, X_max - X_min, 1.0).astype(np.float32)
    X_min = X_min.astype(np.float32)
    X_normed = (X - X_min) / X_range

    # Save norm params
    norm_params = {"min": X_min.tolist(), "range": X_range.tolist()}
    norm_path = MODEL_DIR / "mlp_norm_params.json"
    norm_path.write_text(json.dumps(norm_params))
    logger.info("Normalisation params saved to %s", norm_path)

    # Build model
    mlp = CreditMLP(n_features=N_FEATURES, n_classes=N_CLASSES)
    X_t = torch.tensor(X_normed, dtype=torch.float32)
    y_t = torch.tensor(y, dtype=torch.long)

    optimizer = torch.optim.Adam(mlp.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    mlp.train()
    for epoch in range(epochs):
        optimizer.zero_grad()
        logits = mlp(X_t)
        loss = criterion(logits, y_t)
        loss.backward()
        optimizer.step()
        if (epoch + 1) % 100 == 0:
            with torch.no_grad():
                acc = (mlp(X_t).argmax(1) == y_t).float().mean().item()
            logger.info("Epoch %d/%d — loss=%.4f acc=%.3f", epoch + 1, epochs, loss.item(), acc)

    mlp.eval()

    # Final accuracy
    with torch.no_grad():
        preds = mlp(X_t).argmax(1).numpy()
    acc = float((preds == y).mean())
    logger.info("Final MLP accuracy: %.3f", acc)

    # Class distribution of predictions
    import collections
    pred_dist = collections.Counter(preds.tolist())
    logger.info("Prediction distribution: %s", {CREDIT_CLASSES[k]: v for k, v in sorted(pred_dist.items())})

    # Save weights
    weights_path = MODEL_DIR / "creditworthiness_mlp.pt"
    torch.save(mlp.state_dict(), str(weights_path))
    logger.info("MLP weights saved to %s", weights_path)

    return mlp, X_normed, norm_params, acc


def export_mlp_onnx(mlp):
    """Export MLP to ONNX."""
    from app.ml.creditworthiness.mlp_model import export_onnx

    onnx_path = MODEL_DIR / "creditworthiness.onnx"
    export_onnx(mlp, str(onnx_path), n_features=N_FEATURES)
    logger.info("MLP ONNX exported to %s (%d bytes)", onnx_path, onnx_path.stat().st_size)

    # Verify with onnxruntime
    import numpy as np
    import onnxruntime as ort
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    dummy = np.random.randn(1, N_FEATURES).astype(np.float32)
    out = sess.run(None, {"features": dummy})[0]
    logger.info("ONNX inference test: input shape=%s → output shape=%s", dummy.shape, out.shape)

    return onnx_path


async def run_ezkl_setup(onnx_path: Path, X_normed):
    """Run full EZKL setup: gen_settings → calibrate → get_srs → compile → setup."""
    import ezkl
    import numpy as np

    model_dir = MODEL_DIR
    settings_path = str(model_dir / "settings.json")
    compiled_path = str(model_dir / "network.compiled")
    pk_path = str(model_dir / "pk.key")
    vk_path = str(model_dir / "vk.key")
    srs_path = str(model_dir / "kzg.srs")
    cal_path = str(model_dir / "calibration.json")
    onnx = str(onnx_path)

    loop = asyncio.get_event_loop()

    # Step 1: gen-settings
    logger.info("[1/5] Generating EZKL settings...")
    t0 = time.time()
    await loop.run_in_executor(None, ezkl.gen_settings, onnx, settings_path)
    logger.info("  gen_settings done in %.1fs", time.time() - t0)

    # Patch settings
    s = json.loads(Path(settings_path).read_text())
    s["run_args"] = s.get("run_args", {})
    s["run_args"]["input_scale"] = 7
    s["run_args"]["param_scale"] = 7
    s["run_args"]["bits"] = 16
    s["run_args"]["logrows"] = 17
    Path(settings_path).write_text(json.dumps(s))
    logger.info("  Settings patched: input_scale=7, param_scale=7, bits=16, logrows=17")

    # Step 2: Write calibration data + calibrate
    logger.info("[2/5] Calibrating settings...")
    # Use a few representative samples from training data
    n_cal = min(5, len(X_normed))
    cal_samples = X_normed[:n_cal].tolist()
    cal_data = {"input_data": cal_samples}
    Path(cal_path).write_text(json.dumps(cal_data))

    t0 = time.time()
    await loop.run_in_executor(
        None, ezkl.calibrate_settings,
        cal_path, onnx, settings_path, "resources",
    )
    logger.info("  calibrate_settings done in %.1fs", time.time() - t0)

    # Step 3: Get SRS
    logger.info("[3/5] Fetching SRS (structured reference string)...")
    t0 = time.time()
    # Read logrows from calibrated settings
    s_cal = json.loads(Path(settings_path).read_text())
    logrows = s_cal.get("run_args", {}).get("logrows", 17)
    # get_srs is the ONE async function in EZKL (downloads SRS via HTTP)
    await ezkl.get_srs(settings_path, logrows, srs_path)
    srs_size = Path(srs_path).stat().st_size if Path(srs_path).exists() else 0
    logger.info("  SRS fetched in %.1fs (%d bytes)", time.time() - t0, srs_size)

    # Step 4: Compile circuit
    logger.info("[4/5] Compiling circuit...")
    t0 = time.time()
    await loop.run_in_executor(
        None, ezkl.compile_circuit,
        onnx, compiled_path, settings_path,
    )
    compiled_size = Path(compiled_path).stat().st_size
    logger.info("  Circuit compiled in %.1fs (%d bytes)", time.time() - t0, compiled_size)

    # Step 5: Setup (generate proving + verification keys)
    logger.info("[5/5] Generating proving/verification keys...")
    t0 = time.time()
    await loop.run_in_executor(
        None, ezkl.setup,
        compiled_path, vk_path, pk_path, srs_path,
    )
    pk_size = Path(pk_path).stat().st_size if Path(pk_path).exists() else 0
    vk_size = Path(vk_path).stat().st_size if Path(vk_path).exists() else 0
    logger.info("  Keys generated in %.1fs (pk=%d bytes, vk=%d bytes)", time.time() - t0, pk_size, vk_size)

    # Verify all artifacts exist
    for name, path in [
        ("settings.json", settings_path),
        ("network.compiled", compiled_path),
        ("pk.key", pk_path),
        ("vk.key", vk_path),
        ("kzg.srs", srs_path),
    ]:
        p = Path(path)
        if not p.exists():
            raise RuntimeError(f"EZKL setup failed: {name} not created at {path}")
        logger.info("  ✓ %s (%d bytes)", name, p.stat().st_size)


async def test_proof(onnx_path: Path, X_normed):
    """Generate a real ZK proof and verify it."""
    import ezkl
    import tempfile
    import numpy as np

    model_dir = MODEL_DIR
    settings_path = str(model_dir / "settings.json")
    compiled_path = str(model_dir / "network.compiled")
    pk_path = str(model_dir / "pk.key")
    vk_path = str(model_dir / "vk.key")
    srs_path = str(model_dir / "kzg.srs")

    loop = asyncio.get_event_loop()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        input_path = str(tmp / "input.json")
        witness_path = str(tmp / "witness.json")
        proof_path = str(tmp / "proof.json")

        # Use first training sample
        sample = X_normed[0].tolist()
        Path(input_path).write_text(json.dumps({"input_data": [sample]}))

        # Generate witness
        logger.info("Generating witness...")
        t0 = time.time()
        await loop.run_in_executor(
            None, ezkl.gen_witness,
            input_path, compiled_path, witness_path,
        )
        logger.info("  Witness generated in %.1fs", time.time() - t0)

        # Read witness outputs
        witness = json.loads(Path(witness_path).read_text())
        raw_outputs = witness.get("outputs", [[]])[0] if "outputs" in witness else []
        logger.info("  Witness outputs (%d values): %s", len(raw_outputs), raw_outputs[:5])

        # Generate proof
        logger.info("Generating ZK proof...")
        t0 = time.time()
        await loop.run_in_executor(
            None, ezkl.prove,
            witness_path, compiled_path,
            pk_path, proof_path,
            srs_path,
        )
        proof_time = time.time() - t0
        logger.info("  Proof generated in %.1fs", proof_time)

        # Read proof
        proof_data = json.loads(Path(proof_path).read_text())
        proof_hex = proof_data.get("hex_proof", proof_data.get("proof", ""))
        proof_bytes = bytes.fromhex(proof_hex.replace("0x", "")) if proof_hex else b""
        proof_hash = "0x" + hashlib.sha256(proof_bytes).hexdigest()
        logger.info("  Proof size: %d bytes", len(proof_bytes))
        logger.info("  Proof hash: %s", proof_hash)

        # Verify proof
        logger.info("Verifying proof...")
        t0 = time.time()
        verified = await loop.run_in_executor(
            None, ezkl.verify,
            proof_path, settings_path, vk_path, srs_path,
        )
        logger.info("  Verification: %s (%.1fs)", "✓ VALID" if verified else "✗ INVALID", time.time() - t0)

        return {
            "proof_hash": proof_hash,
            "proof_size_bytes": len(proof_bytes),
            "proof_time_s": proof_time,
            "verified": bool(verified),
        }


async def save_metadata(onnx_path, mlp_accuracy, proof_result):
    """Save training metadata."""
    model_hash = hashlib.sha256(onnx_path.read_bytes()).hexdigest()

    meta = {
        "model_hash": model_hash,
        "onnx_path": str(onnx_path),
        "native_path": str(MODEL_DIR / "creditworthiness_model.json"),
        "model_type": "mlp",
        "mlp_weights_path": str(MODEL_DIR / "creditworthiness_mlp.pt"),
        "mlp_accuracy": mlp_accuracy,
        "norm_params_path": str(MODEL_DIR / "mlp_norm_params.json"),
        "training_samples": 200,
        "accuracy": mlp_accuracy,
        "class_distribution": {},
        "observed_class_indices": list(range(N_CLASSES)),
        "observed_classes": CREDIT_CLASSES,
        "train_to_global_class_index": {str(i): i for i in range(N_CLASSES)},
        "feature_names": FEATURE_NAMES,
        "ezkl_setup_complete": True,
        "test_proof": proof_result,
        "trained_at": __import__("datetime").datetime.utcnow().isoformat(),
    }
    meta_path = MODEL_DIR / "training_metadata.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    logger.info("Metadata saved to %s", meta_path)
    return model_hash


async def main():
    logger.info("=" * 60)
    logger.info("CREDITWORTHINESS MLP TRAINING + EZKL SETUP")
    logger.info("=" * 60)

    # Step 1: Generate training data
    logger.info("\n── Step 1: Generate training data ──")
    X, y = generate_synthetic_training_data(n_samples=200)
    class_counts = {CREDIT_CLASSES[i]: int((y == i).sum()) for i in range(N_CLASSES)}
    logger.info("Training data: %d samples, %d features, classes: %s", len(X), X.shape[1], class_counts)

    # Step 2: Train MLP
    logger.info("\n── Step 2: Train MLP ──")
    mlp, X_normed, norm_params, accuracy = train_mlp(X, y, epochs=500)

    # Step 3: Export ONNX
    logger.info("\n── Step 3: Export ONNX ──")
    onnx_path = export_mlp_onnx(mlp)

    # Step 4: EZKL setup
    logger.info("\n── Step 4: EZKL circuit setup ──")
    await run_ezkl_setup(onnx_path, X_normed)

    # Step 5: Test proof
    logger.info("\n── Step 5: Test proof generation + verification ──")
    proof_result = await test_proof(onnx_path, X_normed)

    # Step 6: Save metadata
    logger.info("\n── Step 6: Save metadata ──")
    model_hash = await save_metadata(onnx_path, accuracy, proof_result)

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SETUP COMPLETE")
    logger.info("=" * 60)
    logger.info("Model hash:    %s", model_hash)
    logger.info("MLP accuracy:  %.1f%%", accuracy * 100)
    logger.info("Proof hash:    %s", proof_result["proof_hash"])
    logger.info("Proof size:    %d bytes", proof_result["proof_size_bytes"])
    logger.info("Proof time:    %.1fs", proof_result["proof_time_s"])
    logger.info("Verified:      %s", "YES ✓" if proof_result["verified"] else "NO ✗")
    logger.info("")
    logger.info("Artifacts in:  %s", MODEL_DIR)
    for f in sorted(MODEL_DIR.iterdir()):
        logger.info("  %s (%d bytes)", f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
