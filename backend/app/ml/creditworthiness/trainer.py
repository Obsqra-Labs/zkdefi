"""
Creditworthiness model trainer — dual-model: XGBoost + MLP.

Classes: AAA (best) → C (worst), mapped from behavioral + cross-chain features.

Training workflow:
  1. Pull labeled data from decision_store (user_behavior_stats + heuristic labels)
  2. Train XGBoost multi-class classifier (high-accuracy inference)
  3. Train PyTorch MLP on the SAME data (EZKL-provable architecture)
  4. Export MLP to ONNX for EZKL proof generation
  5. Run EZKL circuit setup (gen-settings → compile → pk/vk)
  6. Register model hash in on-chain ModelRegistry

The MLP uses only EZKL-compatible ops (Linear, ReLU) — no tree ops.
XGBoost remains for reference; the MLP is the canonical inference model.

Labels are initially heuristic-based:
  - AAA: low early_exit_rate, high proof_success_rate, high tenure, no slashes
  - C: high early_exit_rate, low tenure, slashes present
  - As real default/repayment data accumulates, labels shift to ground truth.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "creditworthiness"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

CREDIT_CLASSES = ["AAA", "AA", "A", "B", "C"]
CLASS_TO_IDX = {c: i for i, c in enumerate(CREDIT_CLASSES)}


def _heuristic_label(stats: dict[str, Any]) -> str:
    """
    Assign a credit class based on behavioral heuristics.
    Used for initial model training before real ground-truth labels exist.
    """
    early_exit_rate = stats.get("early_exit_rate", 0)
    proof_success_rate = stats.get("proof_success_rate", 1.0)
    slash_count = stats.get("slash_count", 0)
    total_actions = stats.get("total_actions", 0)
    tenure_hours = stats.get("activity_span_hours", 0)
    total_volume = stats.get("total_volume_eth", 0)
    tier_upgrades = stats.get("tier_upgrade_count", 0)

    score = 100  # Start at perfect

    # Penalise early exits
    score -= int(early_exit_rate * 40)

    # Penalise proof failures
    score -= int((1 - proof_success_rate) * 20)

    # Penalise slashes heavily
    score -= slash_count * 15

    # Reward tenure (up to 20 points for 720+ hours = 30 days)
    score += min(int(tenure_hours / 36), 20)

    # Reward volume (up to 10 points)
    score += min(int(total_volume / 5), 10)

    # Reward tier upgrades
    score += tier_upgrades * 5

    # Require minimum activity for high classes
    if total_actions < 5:
        score = min(score, 70)  # Cap at A if too few actions
    if total_actions < 2:
        score = min(score, 50)  # Cap at B

    # Map score to class
    if score >= 90:
        return "AAA"
    elif score >= 75:
        return "AA"
    elif score >= 60:
        return "A"
    elif score >= 40:
        return "B"
    else:
        return "C"


async def train_model(
    min_events: int = 10,
    n_estimators: int = 100,
    max_depth: int = 4,
    learning_rate: float = 0.1,
) -> dict[str, Any]:
    """
    Train the creditworthiness XGBoost model.

    1. Fetches training data from the decision store
    2. Applies heuristic labels
    3. Trains XGBoost multi-class classifier
    4. Exports to ONNX
    5. Returns model metadata

    Requires: xgboost, scikit-learn, onnxmltools or skl2onnx

    Returns:
        Dict with model_path, onnx_path, model_hash, metrics, etc.
    """
    from app.db.decision_store import get_decision_store
    from app.ml.creditworthiness.features import FEATURE_NAMES

    store = get_decision_store()
    dataset = await store.get_training_dataset(min_events=min_events)

    if len(dataset) < 10:
        return {
            "status": "insufficient_data",
            "message": f"Need at least 10 users with {min_events}+ events; found {len(dataset)}",
            "user_count": len(dataset),
        }

    try:
        import numpy as np
        from xgboost import XGBClassifier
    except ImportError:
        return {
            "status": "missing_dependency",
            "message": "Install xgboost: pip install xgboost scikit-learn",
        }

    # Build feature matrix and labels
    X = []
    y = []

    for stats in dataset:
        total_actions = float(stats.get("total_actions", 0) or 0)
        total_volume_eth = float(stats.get("total_volume_eth", 0) or 0)
        activity_span_hours = float(stats.get("activity_span_hours", 0) or 0)
        proof_success_rate = float(stats.get("proof_success_rate", 1.0) or 1.0)
        early_exit_rate = float(stats.get("early_exit_rate", 0) or 0)
        avg_action_size_eth = float(stats.get("avg_action_size_eth", 0) or 0)

        actions_denom = max(total_actions, 1.0)
        span_denom = max(activity_span_hours, 1.0)

        # Build feature vector from stats (behavioral features only initially)
        features = [
            1.0,  # chains_active placeholder
            total_actions,  # total_tx_count proxy
            total_volume_eth * 2000,  # value_usd estimate
            activity_span_hours / 24,  # account_age_days
            0.0,  # protocol_diversity placeholder
            proof_success_rate,  # success_rate
            0.0,  # unique_contracts placeholder
            # Behavioral features (directly from stats)
            early_exit_rate,
            activity_span_hours / actions_denom,
            proof_success_rate,
            total_actions / span_denom,
            avg_action_size_eth,
            0.0,  # max_single_loss_pct placeholder
            0.0,  # time_since_last_action_hours placeholder
            # Reputation features (from stats or placeholders)
            0.0,  # tier
            activity_span_hours / 24,  # tenure_days
            0.0,  # collateral_eth
            0.0,  # on_chain_reputation_score
        ]
        X.append(features)
        y.append(CLASS_TO_IDX[_heuristic_label(stats)])

    X_np = np.array(X, dtype=np.float32)
    y_np = np.array(y, dtype=np.int32)

    # XGBoost expects contiguous class ids [0..k-1]. Our global class ids may be sparse
    # when a class is absent in the current training slice, so remap for fitting.
    observed_class_indices = sorted(set(int(v) for v in y_np.tolist()))
    if len(observed_class_indices) < 2:
        observed_labels = [CREDIT_CLASSES[i] for i in observed_class_indices]
        return {
            "status": "insufficient_class_diversity",
            "message": "Need at least 2 distinct classes in training data",
            "observed_classes": observed_labels,
            "user_count": len(dataset),
        }

    global_to_train_idx = {global_idx: train_idx for train_idx, global_idx in enumerate(observed_class_indices)}
    train_to_global_idx = {train_idx: global_idx for global_idx, train_idx in global_to_train_idx.items()}
    y_train = np.array([global_to_train_idx[int(v)] for v in y_np.tolist()], dtype=np.int32)

    # Train
    model = XGBClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        learning_rate=learning_rate,
        objective="multi:softprob",
        num_class=len(observed_class_indices),
        eval_metric="mlogloss",
        use_label_encoder=False,
        random_state=42,
    )
    model.fit(X_np, y_train)

    # Save native model
    native_path = MODEL_DIR / "creditworthiness_model.json"
    model.save_model(str(native_path))

    # ── Train MLP (EZKL-compatible) on the same data ──────────────────
    import torch
    import torch.nn as nn
    from app.ml.creditworthiness.mlp_model import CreditMLP, export_onnx

    # Normalise features (min-max per column) for stable MLP training
    X_min = X_np.min(axis=0)
    X_max = X_np.max(axis=0)
    X_range = np.where(X_max - X_min > 1e-8, X_max - X_min, 1.0)
    X_normed = (X_np - X_min) / X_range

    # Save normalisation params for inference-time use
    norm_params = {
        "min": X_min.tolist(),
        "range": X_range.tolist(),
    }
    norm_path = MODEL_DIR / "mlp_norm_params.json"
    norm_path.write_text(json.dumps(norm_params))

    # Use FULL class count (5) for MLP — map sparse labels to global indices
    mlp = CreditMLP(n_features=len(FEATURE_NAMES), n_classes=len(CREDIT_CLASSES))

    # Training targets use the global class indices (0..4) directly
    X_tensor = torch.tensor(X_normed, dtype=torch.float32)
    y_tensor = torch.tensor(y_np, dtype=torch.long)  # global indices already

    optimizer = torch.optim.Adam(mlp.parameters(), lr=1e-3, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    mlp.train()
    epochs = 500
    for epoch in range(epochs):
        optimizer.zero_grad()
        logits = mlp(X_tensor)
        loss = criterion(logits, y_tensor)
        loss.backward()
        optimizer.step()
    mlp.eval()

    # MLP accuracy
    with torch.no_grad():
        mlp_preds = mlp(X_tensor).argmax(dim=1).numpy()
    mlp_accuracy = float((mlp_preds == y_np).mean())
    logger.info("MLP trained: %d epochs, loss=%.4f, accuracy=%.3f", epochs, loss.item(), mlp_accuracy)

    # Save MLP weights
    mlp_weights_path = MODEL_DIR / "creditworthiness_mlp.pt"
    torch.save(mlp.state_dict(), str(mlp_weights_path))

    # Export MLP to ONNX (EZKL-compatible: only Linear + ReLU ops)
    onnx_path = MODEL_DIR / "creditworthiness.onnx"
    export_onnx(mlp, str(onnx_path), n_features=len(FEATURE_NAMES))
    logger.info("MLP ONNX exported to %s", onnx_path)

    # Also keep XGBoost ONNX for reference (separate file)
    xgb_onnx_path = MODEL_DIR / "creditworthiness_xgboost.onnx"
    try:
        import onnxmltools
        from onnxmltools.convert.common.data_types import FloatTensorType

        onnx_model = onnxmltools.convert_xgboost(
            model,
            initial_types=[("features", FloatTensorType([None, len(FEATURE_NAMES)]))],
            target_opset=13,
        )
        with open(xgb_onnx_path, "wb") as f:
            f.write(onnx_model.SerializeToString())
    except ImportError:
        logger.warning("onnxmltools not available; skipping XGBoost ONNX export")

    # Compute model hash from MLP ONNX (the one EZKL proves)
    model_bytes = onnx_path.read_bytes()
    model_hash = hashlib.sha256(model_bytes).hexdigest()

    # Training metrics
    from sklearn.metrics import accuracy_score, classification_report
    y_pred_train = model.predict(X_np)
    y_pred = np.array([train_to_global_idx[int(v)] for v in y_pred_train.tolist()], dtype=np.int32)
    accuracy = accuracy_score(y_np, y_pred)
    report = classification_report(
        y_np,
        y_pred,
        labels=list(range(len(CREDIT_CLASSES))),
        target_names=CREDIT_CLASSES,
        output_dict=True,
        zero_division=0,
    )

    # Save metadata
    meta = {
        "model_hash": model_hash,
        "onnx_path": str(onnx_path) if onnx_path else None,
        "native_path": str(native_path),
        "model_type": "mlp",
        "mlp_weights_path": str(mlp_weights_path),
        "mlp_accuracy": mlp_accuracy,
        "xgboost_accuracy": accuracy,
        "norm_params_path": str(norm_path),
        "training_samples": len(X),
        "accuracy": mlp_accuracy,
        "class_distribution": {CREDIT_CLASSES[i]: int((y_np == i).sum()) for i in range(len(CREDIT_CLASSES))},
        "observed_class_indices": list(range(len(CREDIT_CLASSES))),  # MLP uses all 5 classes
        "observed_classes": CREDIT_CLASSES,
        "train_to_global_class_index": {str(i): i for i in range(len(CREDIT_CLASSES))},
        "feature_names": FEATURE_NAMES,
        "n_estimators": n_estimators,
        "max_depth": max_depth,
        "trained_at": datetime.utcnow().isoformat(),
    }
    meta_path = MODEL_DIR / "training_metadata.json"
    meta_path.write_text(json.dumps(meta, indent=2))

    logger.info(
        "Creditworthiness model trained: %d samples, accuracy=%.3f, hash=%s…",
        len(X), accuracy, model_hash[:12],
    )

    return {
        "status": "success",
        "model_hash": model_hash,
        "onnx_path": str(onnx_path) if onnx_path else None,
        "accuracy": accuracy,
        "training_samples": len(X),
        "report": report,
    }
