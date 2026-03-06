"""
Creditworthiness predictor — MLP inference + EZKL ZK proof.

Uses a PyTorch MLP (Linear + ReLU only) exported to ONNX.
EZKL can prove this model's inference in a Halo2 ZK circuit.

Fallback chain:
  1. MLP ONNX via onnxruntime (preferred — matches EZKL's proven model)
  2. XGBoost native model (legacy inference, no proof)
  3. Heuristic rules (no model loaded)

Usage:
    predictor = get_creditworthiness_predictor()
    result = await predictor.predict(user_address, cross_chain_data, behavior_stats, reputation)
    # result = {credit_class: "AA", confidence: 0.87, ..., proof: {...} | None}
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "creditworthiness"
CREDIT_CLASSES = ["AAA", "AA", "A", "B", "C"]

# Credit terms by class
CREDIT_TERMS: dict[str, dict[str, float]] = {
    "AAA": {"ltv": 0.90, "rate_bps": 300, "unsecured_multiplier": 1.5},
    "AA":  {"ltv": 0.85, "rate_bps": 400, "unsecured_multiplier": 1.2},
    "A":   {"ltv": 0.80, "rate_bps": 500, "unsecured_multiplier": 1.0},
    "B":   {"ltv": 0.70, "rate_bps": 700, "unsecured_multiplier": 0.5},
    "C":   {"ltv": 0.50, "rate_bps": 1000, "unsecured_multiplier": 0.1},
}


class CreditworthinessPredictor:
    """Runs creditworthiness inference with optional EZKL proof generation."""

    def __init__(self) -> None:
        self._ort_session = None  # onnxruntime session for MLP ONNX
        self._model = None  # XGBoost fallback
        self._model_hash: str | None = None
        self._onnx_path: Path | None = None
        self._norm_min: np.ndarray | None = None
        self._norm_range: np.ndarray | None = None
        self._model_type: str = "fallback"
        self._observed_class_indices: list[int] | None = None
        self._load_model()

    def _load_model(self) -> None:
        """Load models: prefer MLP ONNX, fallback to XGBoost."""
        meta_path = MODEL_DIR / "training_metadata.json"
        onnx_path = MODEL_DIR / "creditworthiness.onnx"
        norm_path = MODEL_DIR / "mlp_norm_params.json"
        native_path = MODEL_DIR / "creditworthiness_model.json"

        # Read metadata
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                self._model_hash = meta.get("model_hash")
            except Exception:
                pass

        # Try loading MLP ONNX via onnxruntime (preferred)
        if onnx_path.exists():
            try:
                import onnxruntime as ort
                self._ort_session = ort.InferenceSession(
                    str(onnx_path),
                    providers=["CPUExecutionProvider"],
                )
                self._onnx_path = onnx_path
                self._model_type = "creditworthiness_mlp"
                logger.info("MLP ONNX loaded via onnxruntime: %s", onnx_path)

                # Load normalisation params
                if norm_path.exists():
                    norm = json.loads(norm_path.read_text())
                    self._norm_min = np.array(norm["min"], dtype=np.float32)
                    self._norm_range = np.array(norm["range"], dtype=np.float32)
                    logger.info("MLP normalisation params loaded")
                else:
                    logger.warning("MLP norm params not found — using raw features")

                # MLP always uses all 5 classes
                self._observed_class_indices = list(range(len(CREDIT_CLASSES)))

            except Exception as e:
                logger.warning("Failed to load MLP ONNX: %s — trying XGBoost", e)
                self._ort_session = None

        # Fallback: XGBoost native model
        if self._ort_session is None and native_path.exists():
            try:
                from xgboost import XGBClassifier
                self._model = XGBClassifier()
                self._model.load_model(str(native_path))
                self._model_type = "creditworthiness_xgboost"
                self._onnx_path = onnx_path if onnx_path.exists() else None
                logger.info("XGBoost model loaded (fallback, no EZKL proof): %s", native_path)

                observed = meta.get("observed_class_indices")
                if isinstance(observed, list):
                    self._observed_class_indices = [int(i) for i in observed if 0 <= int(i) < len(CREDIT_CLASSES)]
            except Exception as e:
                logger.warning("Failed to load XGBoost model: %s", e)

        if self._ort_session is None and self._model is None:
            logger.info("No creditworthiness model found — predictor in fallback mode")
        else:
            logger.info("Predictor ready: type=%s, hash=%s…", self._model_type, (self._model_hash or "unknown")[:12])

    @property
    def is_ready(self) -> bool:
        if self._ort_session is None and self._model is None:
            self._load_model()
        return self._ort_session is not None or self._model is not None

    def _normalise(self, X: np.ndarray) -> np.ndarray:
        """Apply min-max normalisation matching training."""
        if self._norm_min is not None and self._norm_range is not None:
            return (X - self._norm_min) / self._norm_range
        return X

    async def predict(
        self,
        user_address: str,
        cross_chain_data: dict[str, Any] | None = None,
        behavior_stats: dict[str, Any] | None = None,
        reputation_data: dict[str, Any] | None = None,
        *,
        generate_proof: bool = False,
    ) -> dict[str, Any]:
        """
        Predict credit class for a user.

        Args:
            user_address: Target user.
            cross_chain_data: From cross_chain_fetcher.
            behavior_stats: From decision_store.get_behavior_stats().
            reputation_data: From reputation registry.
            generate_proof: If True, also generate EZKL proof of inference.

        Returns:
            Dict with credit_class, confidence, terms, feature_importances, proof (optional).
        """
        from app.ml.creditworthiness.features import build_features, features_to_onnx_input, FEATURE_NAMES

        features = await build_features(
            user_address,
            cross_chain_data=cross_chain_data,
            behavior_stats=behavior_stats,
            reputation_data=reputation_data,
        )

        if not self.is_ready:
            return self._fallback_predict(features)

        X_raw = np.array([features.to_vector()], dtype=np.float32)

        # ── MLP ONNX inference (preferred) ────────────────────────────
        if self._ort_session is not None:
            X_normed = self._normalise(X_raw)
            input_name = self._ort_session.get_inputs()[0].name
            logits = self._ort_session.run(None, {input_name: X_normed})[0][0]

            # Softmax to get probabilities
            exp_logits = np.exp(logits - logits.max())
            proba = exp_logits / exp_logits.sum()

            class_idx = int(np.argmax(proba))
            credit_class = CREDIT_CLASSES[class_idx]
            confidence = float(proba[class_idx])

            result: dict[str, Any] = {
                "credit_class": credit_class,
                "class_index": class_idx,
                "confidence": round(confidence, 4),
                "probabilities": {CREDIT_CLASSES[i]: round(float(proba[i]), 4) for i in range(len(CREDIT_CLASSES))},
                "terms": CREDIT_TERMS[credit_class],
                "model_hash": self._model_hash,
                "model_name": self._model_type,
                "features": features.to_dict(),
                "proof": None,
            }

            # EZKL proof generation — the MLP ONNX has only Linear+ReLU ops
            if generate_proof and self._onnx_path and self._onnx_path.exists():
                try:
                    from app.services.ezkl_prover_service import get_ezkl_prover, EZKLModelArtifacts
                    prover = get_ezkl_prover()

                    # Register pre-compiled artifacts if they exist on disk
                    if "creditworthiness" not in prover._models:
                        model_dir = MODEL_DIR
                        compiled = model_dir / "network.compiled"
                        pk = model_dir / "pk.key"
                        vk = model_dir / "vk.key"

                        if compiled.exists() and pk.exists() and vk.exists():
                            # Artifacts already exist from train_mlp_ezkl.py — register them
                            import hashlib as _hl
                            arts = EZKLModelArtifacts(
                                model_name="creditworthiness",
                                onnx_path=self._onnx_path,
                                compiled_model_path=compiled,
                                settings_path=model_dir / "settings.json",
                                pk_path=pk,
                                vk_path=vk,
                                srs_path=model_dir / "kzg.srs",
                                calibration_path=model_dir / "calibration.json",
                                model_hash=_hl.sha256(self._onnx_path.read_bytes()).hexdigest(),
                            )
                            prover._models["creditworthiness"] = arts
                            logger.info("EZKL artifacts registered from disk for 'creditworthiness'")
                        else:
                            # Run full setup
                            logger.info("Auto-setting up EZKL model 'creditworthiness' …")
                            cal_data = [X_normed[0].tolist()]
                            await prover.setup_model(
                                "creditworthiness",
                                self._onnx_path,
                                calibration_data=cal_data,
                                input_scale=7,
                                param_scale=7,
                                bits=16,
                                logrows=17,
                            )

                    # EZKL expects normalised input (same as what we feed onnxruntime)
                    input_data = [X_normed[0].tolist()]
                    ezkl_proof = await prover.prove_inference("creditworthiness", input_data)
                    result["proof"] = ezkl_proof.to_dict()

                    # Store in proof registry
                    try:
                        from app.services.proof_registry import get_proof_registry
                        registry = get_proof_registry()
                        registry.store_proof(
                            proof_hash=ezkl_proof.proof_hash,
                            model_name="creditworthiness",
                            user_address=address,
                            action_type="credit_check",
                            proof_size_bytes=len(ezkl_proof.proof_bytes),
                            inference_output=proba.tolist() if hasattr(proba, "tolist") else list(proba),
                            verified_locally=True,
                        )
                    except Exception as reg_err:
                        logger.warning("Failed to store credit proof in registry: %s", reg_err)
                except Exception as e:
                    logger.warning("EZKL proof generation failed for creditworthiness: %s", e)
                    result["proof_error"] = str(e)

            return result

        # ── XGBoost inference (fallback — no EZKL proof) ──────────────
        raw_proba = self._model.predict_proba(X_raw)[0]
        observed_class_indices = self._observed_class_indices or list(range(len(raw_proba)))

        proba = np.zeros(len(CREDIT_CLASSES), dtype=np.float32)
        for local_idx, p in enumerate(raw_proba):
            global_idx = observed_class_indices[local_idx] if local_idx < len(observed_class_indices) else local_idx
            if 0 <= global_idx < len(CREDIT_CLASSES):
                proba[global_idx] = float(p)

        class_idx = int(np.argmax(proba))
        credit_class = CREDIT_CLASSES[class_idx]
        confidence = float(proba[class_idx])

        result = {
            "credit_class": credit_class,
            "class_index": class_idx,
            "confidence": round(confidence, 4),
            "probabilities": {CREDIT_CLASSES[i]: round(float(proba[i]), 4) for i in range(len(CREDIT_CLASSES))},
            "terms": CREDIT_TERMS[credit_class],
            "model_hash": self._model_hash,
            "model_name": self._model_type,
            "features": features.to_dict(),
            "proof": None,
        }

        # Feature importances (XGBoost only)
        try:
            importances = self._model.feature_importances_
            result["feature_importances"] = {
                FEATURE_NAMES[i]: round(float(importances[i]), 4)
                for i in range(min(len(importances), len(FEATURE_NAMES)))
            }
        except Exception:
            pass

        if generate_proof:
            result["proof_error"] = "XGBoost model loaded — EZKL proof requires MLP ONNX. Retrain to generate MLP."

        return result

    def _fallback_predict(self, features) -> dict[str, Any]:
        """Heuristic fallback when no trained model is available."""
        vec = features.to_vector()
        early_exit_rate = vec[7]
        proof_success = vec[9]
        tenure = vec[15]

        score = 100
        score -= int(early_exit_rate * 40)
        score -= int((1 - proof_success) * 20)
        score += min(int(tenure / 10), 20)

        if score >= 90:
            cls = "AAA"
        elif score >= 75:
            cls = "AA"
        elif score >= 60:
            cls = "A"
        elif score >= 40:
            cls = "B"
        else:
            cls = "C"

        return {
            "credit_class": cls,
            "class_index": CREDIT_CLASSES.index(cls),
            "confidence": 0.5,
            "probabilities": {c: 0.2 for c in CREDIT_CLASSES},
            "terms": CREDIT_TERMS[cls],
            "model_hash": None,
            "model_name": "fallback",
            "features": features.to_dict(),
            "proof": None,
            "fallback": True,
        }


# ── Singleton ────────────────────────────────────────────────────────────

_predictor: CreditworthinessPredictor | None = None


def get_creditworthiness_predictor() -> CreditworthinessPredictor:
    """Get or create the creditworthiness predictor singleton."""
    global _predictor
    if _predictor is None:
        _predictor = CreditworthinessPredictor()
    return _predictor
