"""
Snapshot Forecaster Service.

Provides a deterministic lifecycle for:
1) Window creation (snapshot + schema binding)
2) Prediction commit/reveal
3) Matured outcome ingestion
4) Deterministic scoring + reputation rollups

This is the MVP "trust atom" layer for forecast receipts. It intentionally keeps
on-chain verification optional; trust mode is always labeled in the receipt.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from typing import Any

from app.services.json_store import JsonStore

SUPPORTED_HORIZONS_MIN = (5, 30, 240)

RETURN_KEYS = {
    5: "r5",
    30: "r30",
    240: "r240",
}

PROB_KEYS = {
    5: "p5",
    30: "p30",
    240: "p240",
}

DEFAULT_SCHEMA_ID = "snapshot_forecaster.v1"

DEFAULT_OUTPUT_BOUNDS = {
    "return_min_bps": -5000,
    "return_max_bps": 5000,
    "prob_min": 0,
    "prob_max": 10000,
}


class SnapshotForecasterService:
    """Deterministic forecast lifecycle service backed by JSON stores."""

    def __init__(self, store_prefix: str = "snapshot_forecaster") -> None:
        self._store_prefix = store_prefix
        self._windows = JsonStore(f"{store_prefix}_windows")
        self._predictions = JsonStore(f"{store_prefix}_predictions")
        self._scores = JsonStore(f"{store_prefix}_scores")

    # ------------------------------------------------------------------
    # Window layer
    # ------------------------------------------------------------------

    async def create_window(
        self,
        *,
        pair_id: str,
        window_open_ts: int,
        window_close_ts: int,
        cadence_id: str,
        snapshot_data: dict[str, Any],
        feature_schema_id: str = DEFAULT_SCHEMA_ID,
        feature_vector: dict[str, float] | None = None,
        data_source_id: str = "unknown",
        snapshot_provenance_hash: str | None = None,
        attest_snapshot: bool = False,
    ) -> dict[str, Any]:
        if window_close_ts <= window_open_ts:
            raise ValueError("window_close_ts must be greater than window_open_ts")
        if not pair_id.strip():
            raise ValueError("pair_id is required")
        if not cadence_id.strip():
            raise ValueError("cadence_id is required")
        if not feature_schema_id.strip():
            raise ValueError("feature_schema_id is required")

        validated_features = self._validate_feature_vector(feature_vector or {})
        snapshot_hash = str(snapshot_data.get("snapshot_hash", "")).strip()
        if not snapshot_hash:
            snapshot_hash = self._hash_hex(snapshot_data)

        window_id = self._hash_hex(
            {
                "pair_id": pair_id,
                "window_open_ts": int(window_open_ts),
                "window_close_ts": int(window_close_ts),
                "cadence_id": cadence_id,
                "snapshot_hash": snapshot_hash,
                "feature_schema_id": feature_schema_id,
            }
        )

        existing = self._windows.get(window_id)
        if existing:
            return existing

        attestation = {
            "attempted": False,
            "registered_on_chain": False,
            "tx_hash": None,
            "fact_hash": None,
            "timestamp": None,
            "error": None,
        }

        if attest_snapshot:
            attestation["attempted"] = True
            try:
                from app.services.snapshot_attestation_service import get_attestation_service

                svc = get_attestation_service()
                proof = await svc.attest_snapshot(
                    snapshot_hash=snapshot_hash,
                    data_sources=[data_source_id],
                    metadata={
                        "pair_id": pair_id,
                        "window_open_ts": int(window_open_ts),
                        "window_close_ts": int(window_close_ts),
                        "feature_schema_id": feature_schema_id,
                    },
                )
                attestation.update(
                    {
                        "registered_on_chain": bool(proof.registered_on_chain),
                        "tx_hash": proof.tx_hash or None,
                        "fact_hash": proof.fact_hash or None,
                        "timestamp": int(proof.timestamp),
                    }
                )
            except Exception as exc:  # pragma: no cover - network/path dependent
                attestation["error"] = str(exc)

        record = {
            "window_id": window_id,
            "pair_id": pair_id,
            "window_open_ts": int(window_open_ts),
            "window_close_ts": int(window_close_ts),
            "cadence_id": cadence_id,
            "snapshot_hash": snapshot_hash,
            "snapshot_provenance_hash": snapshot_provenance_hash,
            "data_source_id": data_source_id,
            "feature_schema_id": feature_schema_id,
            "feature_vector": validated_features,
            "feature_vector_hash": self._hash_hex(validated_features),
            "attestation": attestation,
            "outcomes": {},
            "prediction_ids": [],
            "created_at_ts": self._now_ts(),
        }
        self._windows.set(window_id, record)
        return record

    def get_window(self, window_id: str) -> dict[str, Any] | None:
        return self._windows.get(window_id)

    def list_windows(self, pair_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._windows.values()
        if pair_id:
            rows = [r for r in rows if r.get("pair_id") == pair_id]
        rows.sort(key=lambda r: int(r.get("created_at_ts", 0)), reverse=True)
        return rows[: max(1, limit)]

    # ------------------------------------------------------------------
    # Commit / reveal layer
    # ------------------------------------------------------------------

    def commit_prediction(
        self,
        *,
        window_id: str,
        model_identity: dict[str, Any],
        guess_ts: int | None = None,
        horizons_min: list[int] | None = None,
        subject_id: str = "",
        prediction_commitment: str | None = None,
        outputs_scaled: dict[str, int] | None = None,
        salt: str | None = None,
        output_bounds: dict[str, int] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        window = self._windows.get(window_id)
        if not window:
            raise ValueError(f"Unknown window_id: {window_id}")

        model_hash = str(model_identity.get("model_hash", "")).strip()
        if not model_hash:
            raise ValueError("model_identity.model_hash is required")
        schema_id = str(model_identity.get("schema_id", DEFAULT_SCHEMA_ID)).strip() or DEFAULT_SCHEMA_ID
        settings_hash = str(model_identity.get("settings_hash", "")).strip() or None
        vk_hash = str(model_identity.get("vk_hash", "")).strip() or None

        bounds = self._normalize_bounds(output_bounds)
        horizons = self._normalize_horizons(horizons_min)
        ts = int(guess_ts or self._now_ts())
        subject = self._normalize_subject(subject_id)

        commitment = (prediction_commitment or "").strip().lower()
        if not commitment:
            if outputs_scaled is None or salt is None:
                raise ValueError("Provide prediction_commitment OR outputs_scaled + salt")
            validated_outputs = self._validate_outputs(outputs_scaled, bounds)
            commitment = self.build_prediction_commitment(
                window_id=window_id,
                model_hash=model_hash,
                schema_id=schema_id,
                outputs_scaled=validated_outputs,
                salt=salt,
            )
        elif outputs_scaled is not None and salt is not None:
            validated_outputs = self._validate_outputs(outputs_scaled, bounds)
            recomputed = self.build_prediction_commitment(
                window_id=window_id,
                model_hash=model_hash,
                schema_id=schema_id,
                outputs_scaled=validated_outputs,
                salt=salt,
            )
            if recomputed != commitment:
                raise ValueError("prediction_commitment does not match outputs_scaled + salt")

        forecast_id = self._hash_hex(
            {
                "window_id": window_id,
                "model_hash": model_hash,
                "schema_id": schema_id,
                "prediction_commitment": commitment,
                "guess_ts": ts,
                "subject_id": subject,
            }
        )

        existing = self._predictions.get(forecast_id)
        if existing:
            return existing

        record = {
            "forecast_id": forecast_id,
            "window_id": window_id,
            "subject_id": subject,
            "guess_ts": ts,
            "horizons_min": horizons,
            "status": "committed",
            "prediction_commitment": commitment,
            "model_identity": {
                "model_hash": model_hash,
                "schema_id": schema_id,
                "settings_hash": settings_hash,
                "vk_hash": vk_hash,
            },
            "output_bounds": bounds,
            "metadata": metadata or {},
            "revealed_at_ts": None,
            "outputs_scaled": None,
            "ezkl_receipt": None,
            "trust_mode": "commit_reveal_only",
            "score_receipt_id": None,
            "created_at_ts": self._now_ts(),
        }
        self._predictions.set(forecast_id, record)

        prediction_ids = list(window.get("prediction_ids", []))
        if forecast_id not in prediction_ids:
            prediction_ids.append(forecast_id)
            window["prediction_ids"] = prediction_ids
            self._windows.set(window_id, window)

        return record

    def reveal_prediction(
        self,
        *,
        forecast_id: str,
        outputs_scaled: dict[str, int],
        salt: str,
        ezkl_receipt: dict[str, Any] | None = None,
        revealed_at_ts: int | None = None,
    ) -> dict[str, Any]:
        record = self._predictions.get(forecast_id)
        if not record:
            raise ValueError(f"Unknown forecast_id: {forecast_id}")

        bounds = self._normalize_bounds(record.get("output_bounds") or {})
        validated_outputs = self._validate_outputs(outputs_scaled, bounds)

        model_identity = record.get("model_identity") or {}
        expected_commitment = self.build_prediction_commitment(
            window_id=record["window_id"],
            model_hash=str(model_identity.get("model_hash", "")),
            schema_id=str(model_identity.get("schema_id", DEFAULT_SCHEMA_ID)),
            outputs_scaled=validated_outputs,
            salt=salt,
        )

        committed = str(record.get("prediction_commitment", "")).strip().lower()
        if expected_commitment != committed:
            raise ValueError("Reveal payload does not match committed prediction_commitment")

        sanitized_receipt = self._sanitize_ezkl_receipt(ezkl_receipt)
        trust_mode = self._resolve_trust_mode(sanitized_receipt)

        record["outputs_scaled"] = validated_outputs
        record["revealed_at_ts"] = int(revealed_at_ts or self._now_ts())
        record["status"] = "revealed" if record.get("status") != "scored" else "scored"
        record["ezkl_receipt"] = sanitized_receipt
        record["trust_mode"] = trust_mode
        record["reveal_salt_hash"] = self._hash_hex({"forecast_id": forecast_id, "salt": salt})
        self._predictions.set(forecast_id, record)
        return record

    @staticmethod
    def build_prediction_commitment(
        *,
        window_id: str,
        model_hash: str,
        schema_id: str,
        outputs_scaled: dict[str, int],
        salt: str,
    ) -> str:
        payload = {
            "window_id": window_id,
            "model_hash": model_hash,
            "schema_id": schema_id,
            "outputs_scaled": SnapshotForecasterService._normalize_output_map(outputs_scaled),
            "salt": str(salt),
        }
        return SnapshotForecasterService._hash_hex(payload)

    def get_prediction(self, forecast_id: str) -> dict[str, Any] | None:
        return self._predictions.get(forecast_id)

    def list_predictions(
        self,
        *,
        subject_id: str | None = None,
        status: str | None = None,
        pair_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        rows = self._predictions.values()
        subject = self._normalize_subject(subject_id or "") if subject_id else None

        if subject:
            rows = [r for r in rows if self._normalize_subject(str(r.get("subject_id", ""))) == subject]
        if status:
            normalized_status = status.strip().lower()
            rows = [r for r in rows if str(r.get("status", "")).strip().lower() == normalized_status]
        if pair_id:
            filtered: list[dict[str, Any]] = []
            for row in rows:
                window = self._windows.get(str(row.get("window_id", "")))
                if window and window.get("pair_id") == pair_id:
                    filtered.append(row)
            rows = filtered

        rows.sort(key=lambda r: int(r.get("created_at_ts", 0)), reverse=True)
        return rows[: max(1, limit)]

    # ------------------------------------------------------------------
    # Outcomes + scoring
    # ------------------------------------------------------------------

    def upsert_outcomes(
        self,
        *,
        window_id: str,
        outcomes: list[dict[str, Any]],
        source_id: str = "unknown",
        recorded_at_ts: int | None = None,
    ) -> dict[str, Any]:
        window = self._windows.get(window_id)
        if not window:
            raise ValueError(f"Unknown window_id: {window_id}")

        existing = dict(window.get("outcomes") or {})
        now_ts = int(recorded_at_ts or self._now_ts())

        for raw in outcomes:
            horizon = int(raw.get("horizon_min"))
            if horizon not in SUPPORTED_HORIZONS_MIN:
                raise ValueError(f"Unsupported horizon_min={horizon}")

            actual_return = int(raw.get("actual_return_bps"))
            actual_up = raw.get("actual_up")
            if actual_up is None:
                actual_up = 1 if actual_return > 0 else 0
            actual_up = int(actual_up)
            if actual_up not in (0, 1):
                raise ValueError("actual_up must be 0 or 1")

            maturity_ts = raw.get("maturity_ts")
            if maturity_ts is None:
                maturity_ts = int(window["window_open_ts"]) + (horizon * 60)

            existing[str(horizon)] = {
                "horizon_min": horizon,
                "actual_return_bps": actual_return,
                "actual_up": actual_up,
                "maturity_ts": int(maturity_ts),
                "source_id": source_id,
                "recorded_at_ts": now_ts,
            }

        window["outcomes"] = existing
        self._windows.set(window_id, window)
        return window

    def score_prediction(
        self,
        *,
        forecast_id: str,
        ece_bins: int = 10,
    ) -> dict[str, Any]:
        record = self._predictions.get(forecast_id)
        if not record:
            raise ValueError(f"Unknown forecast_id: {forecast_id}")
        if not record.get("outputs_scaled"):
            raise ValueError("Prediction must be revealed before scoring")

        window = self._windows.get(record["window_id"])
        if not window:
            raise ValueError("Window missing for forecast")

        outputs = self._normalize_output_map(record.get("outputs_scaled") or {})
        horizons = self._normalize_horizons(record.get("horizons_min") or [])
        outcomes = window.get("outcomes") or {}

        missing = [h for h in horizons if str(h) not in outcomes]
        if missing:
            missing_csv = ",".join(str(h) for h in missing)
            raise ValueError(f"Missing matured outcomes for horizons: {missing_csv}")

        signed_errors: list[float] = []
        abs_errors: list[float] = []
        directional_hits: list[int] = []
        prob_preds: list[float] = []
        prob_labels: list[int] = []
        brier_terms: list[float] = []
        per_horizon: dict[str, Any] = {}

        for horizon in horizons:
            key = str(horizon)
            outcome = outcomes[key]

            return_key = RETURN_KEYS[horizon]
            prob_key = PROB_KEYS[horizon]
            pred_return = int(outputs[return_key])
            pred_prob_up = int(outputs[prob_key]) / 10000.0

            actual_return = int(outcome["actual_return_bps"])
            actual_up = int(outcome["actual_up"])

            err = float(pred_return - actual_return)
            abs_err = abs(err)
            pred_dir = 1 if pred_return >= 0 else 0
            dir_hit = 1 if pred_dir == actual_up else 0
            brier = (pred_prob_up - float(actual_up)) ** 2

            signed_errors.append(err)
            abs_errors.append(abs_err)
            directional_hits.append(dir_hit)
            prob_preds.append(pred_prob_up)
            prob_labels.append(actual_up)
            brier_terms.append(brier)

            per_horizon[key] = {
                "horizon_min": horizon,
                "predicted_return_bps": pred_return,
                "actual_return_bps": actual_return,
                "predicted_prob_up": pred_prob_up,
                "actual_up": actual_up,
                "directional_hit": bool(dir_hit),
                "abs_error_bps": abs_err,
                "squared_error_bps2": err * err,
                "brier": brier,
            }

        n = float(len(horizons))
        mae = sum(abs_errors) / n
        rmse = math.sqrt(sum(e * e for e in signed_errors) / n)
        directional_accuracy = sum(directional_hits) / n
        brier_score = sum(brier_terms) / n
        ece = self._expected_calibration_error(prob_preds, prob_labels, bins=max(1, int(ece_bins)))

        metrics = {
            "horizon_count": int(n),
            "mae_bps": round(mae, 6),
            "rmse_bps": round(rmse, 6),
            "directional_accuracy": round(directional_accuracy, 6),
            "brier_score": round(brier_score, 6),
            "ece": round(ece, 6),
        }
        metric_tiers = self._metric_tiers(metrics)

        scored_at = self._now_ts()
        score_receipt_id = self._hash_hex(
            {
                "forecast_id": forecast_id,
                "metrics": metrics,
                "metric_tiers": metric_tiers,
                "scored_at_ts": scored_at,
            }
        )

        receipt = {
            "score_receipt_id": score_receipt_id,
            "forecast_id": forecast_id,
            "window_id": record["window_id"],
            "subject_id": record.get("subject_id", ""),
            "pair_id": window.get("pair_id"),
            "model_identity": record.get("model_identity"),
            "trust_mode": record.get("trust_mode", "commit_reveal_only"),
            "metrics": metrics,
            "metric_tiers": metric_tiers,
            "per_horizon": per_horizon,
            "scored_at_ts": scored_at,
        }

        self._scores.set(score_receipt_id, receipt)
        record["status"] = "scored"
        record["score_receipt_id"] = score_receipt_id
        record["scored_at_ts"] = scored_at
        self._predictions.set(forecast_id, record)
        return receipt

    def get_score_receipt(self, score_receipt_id: str) -> dict[str, Any] | None:
        return self._scores.get(score_receipt_id)

    def get_subject_reputation(self, subject_id: str) -> dict[str, Any]:
        subject = self._normalize_subject(subject_id)
        predictions = [
            r
            for r in self._predictions.values()
            if self._normalize_subject(str(r.get("subject_id", ""))) == subject
            and str(r.get("status", "")).lower() == "scored"
            and r.get("score_receipt_id")
        ]

        receipts = []
        for row in predictions:
            rid = str(row.get("score_receipt_id", ""))
            receipt = self._scores.get(rid)
            if receipt:
                receipts.append(receipt)

        if not receipts:
            return {
                "subject_id": subject,
                "sample_size": 0,
                "trust_score": 0,
                "avg_metrics": {},
                "metric_tiers": {},
            }

        avg_directional = sum(float(r["metrics"]["directional_accuracy"]) for r in receipts) / len(receipts)
        avg_mae = sum(float(r["metrics"]["mae_bps"]) for r in receipts) / len(receipts)
        avg_brier = sum(float(r["metrics"]["brier_score"]) for r in receipts) / len(receipts)
        avg_ece = sum(float(r["metrics"]["ece"]) for r in receipts) / len(receipts)

        mae_component = max(0.0, 1.0 - (avg_mae / 600.0))
        brier_component = max(0.0, 1.0 - avg_brier)
        ece_component = max(0.0, 1.0 - avg_ece)

        trust_score = int(
            round(
                (
                    avg_directional * 0.45
                    + mae_component * 0.25
                    + brier_component * 0.20
                    + ece_component * 0.10
                )
                * 100
            )
        )
        trust_score = max(0, min(100, trust_score))

        avg_metrics = {
            "directional_accuracy": round(avg_directional, 6),
            "mae_bps": round(avg_mae, 6),
            "brier_score": round(avg_brier, 6),
            "ece": round(avg_ece, 6),
        }

        return {
            "subject_id": subject,
            "sample_size": len(receipts),
            "trust_score": trust_score,
            "avg_metrics": avg_metrics,
            "metric_tiers": self._metric_tiers(avg_metrics),
        }

    # ------------------------------------------------------------------
    # Utility / test support
    # ------------------------------------------------------------------

    def clear_all(self) -> None:
        self._windows.clear()
        self._predictions.clear()
        self._scores.clear()

    @staticmethod
    def _normalize_subject(subject_id: str) -> str:
        return (subject_id or "").strip().lower()

    @staticmethod
    def _now_ts() -> int:
        return int(time.time())

    @staticmethod
    def _hash_hex(payload: Any) -> str:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return "0x" + hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_horizons(horizons: list[int] | None) -> list[int]:
        vals = horizons or list(SUPPORTED_HORIZONS_MIN)
        normalized = sorted({int(v) for v in vals})
        if not normalized:
            raise ValueError("At least one horizon is required")
        for v in normalized:
            if v not in SUPPORTED_HORIZONS_MIN:
                raise ValueError(f"Unsupported horizon: {v}")
        return normalized

    @staticmethod
    def _normalize_bounds(bounds: dict[str, int] | None) -> dict[str, int]:
        base = dict(DEFAULT_OUTPUT_BOUNDS)
        if bounds:
            for key in base:
                if key in bounds:
                    base[key] = int(bounds[key])
        if base["return_min_bps"] >= base["return_max_bps"]:
            raise ValueError("return_min_bps must be less than return_max_bps")
        if base["prob_min"] >= base["prob_max"]:
            raise ValueError("prob_min must be less than prob_max")
        return base

    @staticmethod
    def _validate_feature_vector(feature_vector: dict[str, float]) -> dict[str, float]:
        if len(feature_vector) > 512:
            raise ValueError("feature_vector has too many keys (max 512)")
        normalized: dict[str, float] = {}
        for key, value in feature_vector.items():
            key_str = str(key).strip()
            if not key_str:
                raise ValueError("feature_vector contains an empty key")
            v = float(value)
            if not math.isfinite(v):
                raise ValueError(f"feature '{key_str}' is not finite")
            if v < -1e12 or v > 1e12:
                raise ValueError(f"feature '{key_str}' out of allowed range")
            normalized[key_str] = v
        return dict(sorted(normalized.items(), key=lambda kv: kv[0]))

    @staticmethod
    def _normalize_output_map(outputs_scaled: dict[str, int]) -> dict[str, int]:
        required = {"r5", "r30", "r240", "p5", "p30", "p240"}
        missing = sorted(required.difference(outputs_scaled.keys()))
        if missing:
            raise ValueError(f"outputs_scaled missing required keys: {', '.join(missing)}")

        normalized: dict[str, int] = {}
        for key in sorted(required):
            normalized[key] = int(outputs_scaled[key])
        return normalized

    @staticmethod
    def _validate_outputs(outputs_scaled: dict[str, int], bounds: dict[str, int]) -> dict[str, int]:
        normalized = SnapshotForecasterService._normalize_output_map(outputs_scaled)

        for key in ("r5", "r30", "r240"):
            val = normalized[key]
            if val < bounds["return_min_bps"] or val > bounds["return_max_bps"]:
                raise ValueError(
                    f"{key}={val} outside [{bounds['return_min_bps']}, {bounds['return_max_bps']}]"
                )

        for key in ("p5", "p30", "p240"):
            val = normalized[key]
            if val < bounds["prob_min"] or val > bounds["prob_max"]:
                raise ValueError(
                    f"{key}={val} outside [{bounds['prob_min']}, {bounds['prob_max']}]"
                )
        return normalized

    @staticmethod
    def _sanitize_ezkl_receipt(ezkl_receipt: dict[str, Any] | None) -> dict[str, Any] | None:
        if not ezkl_receipt:
            return None
        return {
            "proof_hash": str(ezkl_receipt.get("proof_hash", "")).strip() or None,
            "verify_key_hash": str(ezkl_receipt.get("verify_key_hash", "")).strip() or None,
            "proof_system": str(ezkl_receipt.get("proof_system", "halo2_kzg")).strip() or "halo2_kzg",
            "verified_locally": bool(ezkl_receipt.get("verified_locally", False)),
            "verified_on_chain": bool(ezkl_receipt.get("verified_on_chain", False)),
            "verification_mode": str(ezkl_receipt.get("verification_mode", "")).strip() or None,
        }

    @staticmethod
    def _resolve_trust_mode(ezkl_receipt: dict[str, Any] | None) -> str:
        if not ezkl_receipt:
            return "commit_reveal_only"
        if ezkl_receipt.get("verified_on_chain"):
            return "onchain_verified"
        if ezkl_receipt.get("verified_locally"):
            return "offchain_ezkl_verified"
        return "commit_reveal_only"

    @staticmethod
    def _expected_calibration_error(probs: list[float], labels: list[int], bins: int = 10) -> float:
        if not probs:
            return 0.0
        n = len(probs)
        bin_count = max(1, int(bins))
        buckets: list[list[tuple[float, int]]] = [[] for _ in range(bin_count)]

        for p, y in zip(probs, labels):
            clipped = min(max(float(p), 0.0), 1.0)
            idx = min(int(clipped * bin_count), bin_count - 1)
            buckets[idx].append((clipped, int(y)))

        ece = 0.0
        for bucket in buckets:
            if not bucket:
                continue
            conf = sum(p for p, _ in bucket) / len(bucket)
            acc = sum(y for _, y in bucket) / len(bucket)
            ece += abs(conf - acc) * (len(bucket) / n)
        return float(ece)

    @staticmethod
    def _metric_tiers(metrics: dict[str, float]) -> dict[str, str]:
        directional = float(metrics.get("directional_accuracy", 0.0))
        mae_bps = float(metrics.get("mae_bps", 999999))
        brier = float(metrics.get("brier_score", 1.0))
        ece = float(metrics.get("ece", 1.0))

        return {
            "directional_accuracy_tier": (
                "tier_1" if directional >= 0.66 else "tier_2" if directional >= 0.55 else "tier_3"
            ),
            "mae_tier": "tier_1" if mae_bps <= 40 else "tier_2" if mae_bps <= 80 else "tier_3",
            "brier_tier": "tier_1" if brier <= 0.12 else "tier_2" if brier <= 0.20 else "tier_3",
            "ece_tier": "tier_1" if ece <= 0.05 else "tier_2" if ece <= 0.10 else "tier_3",
        }


_service: SnapshotForecasterService | None = None


def get_snapshot_forecaster_service() -> SnapshotForecasterService:
    global _service
    if _service is None:
        _service = SnapshotForecasterService()
    return _service

