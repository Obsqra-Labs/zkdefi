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
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

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

DEFAULT_NETWORK_ID = "starknet_sepolia"
SUPPORTED_NETWORK_IDS = ("starknet_sepolia", "starknet_mainnet", "ethereum_mainnet")

AUTO_OUTCOME_SOURCE_ID = "auto_det_outcome_v1"
ORACLE_OUTCOME_SOURCE_ID = "ekubo_price_history_v1"
COINGECKO_OUTCOME_SOURCE_ID = "coingecko_pair_price_v1"
HEURISTIC_PROJECTION_SOURCE_ID = "heuristic_snapshot_projection_v1"

_NETWORK_PROJECTION_PROFILE: dict[str, dict[str, float]] = {
    "starknet_sepolia": {"amplitude_mult": 0.82, "bias_bps": -10.0, "prob_shift": -0.02},
    "starknet_mainnet": {"amplitude_mult": 1.0, "bias_bps": 0.0, "prob_shift": 0.0},
    "ethereum_mainnet": {"amplitude_mult": 1.14, "bias_bps": 8.0, "prob_shift": 0.02},
}

_PAIR_RETURN_PRIOR_BPS: dict[str, float] = {
    "ETH/USDC": 10.0,
    "ETH/FUSDC": 8.0,
    "STRK/USDC": 14.0,
    "STRK/FUSDC": 12.0,
    "STRK/ETH": 6.0,
}

_EKUBO_SEPOLIA_CHAIN_ID = "0x534e5f4d41494f"
_EKUBO_SEPOLIA_CHAIN_ID_DEC = "23448594291968335"
_EKUBO_MAINNET_CHAIN_ID = "0x534e5f4d41494e"

# Canonical Starknet token addresses used by Ekubo APIs for ETH/USDC/STRK pairs.
_SEPOLIA_TOKEN_BY_SYMBOL: dict[str, str] = {
    "ETH": "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    "STRK": "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    "USDC": "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
    "FUSDC": "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23",
}

_MAINNET_TOKEN_BY_SYMBOL: dict[str, str] = {
    "ETH": "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    "STRK": "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    "USDC": "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    "WBTC": "0x3fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
}

_PAIR_SYMBOLS: dict[str, tuple[str, str]] = {
    "ETH/USDC": ("ETH", "USDC"),
    "STRK/USDC": ("STRK", "USDC"),
    "STRK/ETH": ("STRK", "ETH"),
    "ETH/FUSDC": ("ETH", "FUSDC"),
    "STRK/FUSDC": ("STRK", "FUSDC"),
}

_COINGECKO_ID_BY_SYMBOL: dict[str, str] = {
    "ETH": "ethereum",
    "USDC": "usd-coin",
    "STRK": "starknet",
    "WBTC": "wrapped-bitcoin",
}

logger = logging.getLogger(__name__)


class SnapshotForecasterService:
    """Deterministic forecast lifecycle service backed by JSON stores."""

    def __init__(self, store_prefix: str = "snapshot_forecaster") -> None:
        self._store_prefix = store_prefix
        self._windows = JsonStore(f"{store_prefix}_windows")
        self._predictions = JsonStore(f"{store_prefix}_predictions")
        self._scores = JsonStore(f"{store_prefix}_scores")
        # (chain_id, base_token, quote_token, interval) -> (fetch_ts, points[(ts, price)])
        self._oracle_history_cache: dict[tuple[str, str, str, int], tuple[int, list[tuple[int, float]]]] = {}
        # (coin_id, range_start_sec, range_end_sec) -> (fetch_ts, points[(ts, price_usd)])
        self._coingecko_history_cache: dict[tuple[str, int, int], tuple[int, list[tuple[int, float]]]] = {}

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
        network_id: str = DEFAULT_NETWORK_ID,
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
        normalized_network_id = self._normalize_network_id(network_id)

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
                "network_id": normalized_network_id,
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
                        "network_id": normalized_network_id,
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
            "network_id": normalized_network_id,
            "window_open_ts": int(window_open_ts),
            "window_close_ts": int(window_close_ts),
            "cadence_id": cadence_id,
            "snapshot_hash": snapshot_hash,
            "snapshot_data": snapshot_data,
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

    def list_windows(
        self,
        pair_id: str | None = None,
        network_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        rows = self._windows.values()
        if pair_id:
            rows = [r for r in rows if r.get("pair_id") == pair_id]
        if network_id:
            normalized_network_id = self._normalize_network_id(network_id)
            rows = [r for r in rows if str(r.get("network_id", DEFAULT_NETWORK_ID)) == normalized_network_id]
        rows.sort(key=lambda r: int(r.get("created_at_ts", 0)), reverse=True)
        return rows[: max(1, limit)]

    def suggest_outputs(
        self,
        *,
        window_id: str,
        horizons_min: list[int] | None = None,
        output_bounds: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        window = self._windows.get(window_id)
        if not window:
            raise ValueError(f"Unknown window_id: {window_id}")

        bounds = self._normalize_bounds(output_bounds)
        _ = self._normalize_horizons(horizons_min)
        network_id = self._normalize_network_id(str(window.get("network_id", DEFAULT_NETWORK_ID)))
        profile = _NETWORK_PROJECTION_PROFILE.get(network_id, _NETWORK_PROJECTION_PROFILE[DEFAULT_NETWORK_ID])

        pair_id = str(window.get("pair_id", "")).strip().upper()
        pair_key = pair_id.split("(")[0].strip() if pair_id else ""
        pair_prior_bps = float(_PAIR_RETURN_PRIOR_BPS.get(pair_key, 0.0))

        signals = self._projection_signals(window)
        trend_bps, trend_source = self._recent_oracle_trend_bps(window=window, lookback_min=30)
        trend_component_bps = float(max(-450, min(450, int(trend_bps)))) if trend_bps is not None else 0.0
        seed_jitter_bps = float(self._projection_seed_jitter(window_id=window_id, network_id=network_id, pair_id=pair_key))

        momentum = float(signals.get("momentum", 0.0))
        imbalance = float(signals.get("imbalance", 0.0))
        volatility = float(signals.get("volatility", 0.0))
        spread = float(signals.get("spread", 0.0))
        liquidity = float(signals.get("liquidity", 0.0))

        base_return_bps = (
            135.0 * momentum
            + 80.0 * imbalance
            + 45.0 * liquidity
            - 70.0 * max(0.0, volatility)
            - 35.0 * max(0.0, spread)
            + (0.34 * trend_component_bps)
            + pair_prior_bps
            + float(profile["bias_bps"])
            + (0.45 * seed_jitter_bps)
        )

        horizon_scales: dict[int, float] = {5: 1.0, 30: 1.62, 240: 2.48}
        trend_scales: dict[int, float] = {5: 0.42, 30: 0.74, 240: 1.08}
        volatility_penalty: dict[int, float] = {5: 8.0, 30: 24.0, 240: 52.0}

        returns_by_h: dict[int, int] = {}
        for horizon in SUPPORTED_HORIZONS_MIN:
            raw_bps = (
                (base_return_bps * horizon_scales[horizon])
                + (trend_component_bps * trend_scales[horizon])
                - (max(0.0, volatility) * volatility_penalty[horizon])
            ) * float(profile["amplitude_mult"])
            clipped = max(
                int(bounds["return_min_bps"]),
                min(int(bounds["return_max_bps"]), int(round(raw_bps))),
            )
            returns_by_h[horizon] = int(clipped)

        signal_strength = min(
            1.0,
            (0.50 * abs(momentum))
            + (0.25 * abs(imbalance))
            + (0.20 * min(1.0, abs(trend_component_bps) / 250.0))
            + (0.05 * abs(liquidity)),
        )
        confidence_shift = (
            (0.20 * signal_strength)
            - (0.09 * max(0.0, volatility))
            - (0.05 * max(0.0, spread))
            + float(profile["prob_shift"])
        )

        probs_by_h: dict[int, int] = {}
        for horizon in SUPPORTED_HORIZONS_MIN:
            horizon_bias = 0.0 if horizon == 5 else 0.08 if horizon == 30 else 0.18
            z = (returns_by_h[horizon] / 140.0) + confidence_shift + horizon_bias
            p = 1.0 / (1.0 + math.exp(-z))
            p_scaled = int(round(p * 10000.0))
            p_scaled = max(int(bounds["prob_min"]), min(int(bounds["prob_max"]), p_scaled))
            probs_by_h[horizon] = int(p_scaled)

        outputs = {
            "r5": returns_by_h[5],
            "r30": returns_by_h[30],
            "r240": returns_by_h[240],
            "p5": probs_by_h[5],
            "p30": probs_by_h[30],
            "p240": probs_by_h[240],
        }

        return {
            "window_id": window_id,
            "pair_id": pair_key or pair_id,
            "network_id": network_id,
            "source_id": HEURISTIC_PROJECTION_SOURCE_ID,
            "outputs_scaled": outputs,
            "signals": {k: round(float(v), 6) for k, v in signals.items()},
            "recent_trend_bps": trend_bps,
            "trend_source": trend_source,
            "seed_jitter_bps": int(round(seed_jitter_bps)),
        }

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

            row_source_id = str(raw.get("source_id") or source_id).strip() or source_id
            existing[str(horizon)] = {
                "horizon_min": horizon,
                "actual_return_bps": actual_return,
                "actual_up": actual_up,
                "maturity_ts": int(maturity_ts),
                "source_id": row_source_id,
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

    def get_subject_horizon_benchmarks(self, subject_id: str, limit: int = 1000) -> dict[str, Any]:
        subject = self._normalize_subject(subject_id)
        result = self.get_horizon_benchmarks(
            subject_id=subject,
            pair_id=None,
            network_id=None,
            model_hash=None,
            start_ts=None,
            end_ts=None,
            limit=limit,
        )
        result["subject_id"] = subject
        return result

    def _collect_scored_records(
        self,
        *,
        subject_id: str | None = None,
        pair_id: str | None = None,
        network_id: str | None = None,
        model_hash: str | None = None,
        start_ts: int | None = None,
        end_ts: int | None = None,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        normalized_subject = self._normalize_subject(subject_id) if subject_id else None
        normalized_pair = str(pair_id or "").strip().upper() or None
        normalized_network = self._normalize_network_id(network_id) if network_id else None
        normalized_model_hash = str(model_hash or "").strip().lower() or None
        start_val = int(start_ts) if start_ts is not None else None
        end_val = int(end_ts) if end_ts is not None else None

        rows: list[dict[str, Any]] = []
        for prediction in self._predictions.values():
            if str(prediction.get("status", "")).strip().lower() != "scored":
                continue

            score_receipt_id = str(prediction.get("score_receipt_id", "")).strip()
            if not score_receipt_id:
                continue
            score = self._scores.get(score_receipt_id)
            if not score:
                continue

            window_id = str(prediction.get("window_id", "")).strip()
            window = self._windows.get(window_id)
            if not window:
                continue

            scored_at_ts = int(
                score.get("scored_at_ts")
                or prediction.get("scored_at_ts")
                or prediction.get("created_at_ts")
                or 0
            )
            if start_val is not None and scored_at_ts < start_val:
                continue
            if end_val is not None and scored_at_ts > end_val:
                continue

            prediction_subject = self._normalize_subject(str(prediction.get("subject_id", "")))
            if normalized_subject and prediction_subject != normalized_subject:
                continue

            row_pair = str(window.get("pair_id", "")).strip().upper()
            row_pair = row_pair.split("(")[0].strip() if row_pair else row_pair
            if normalized_pair and row_pair != normalized_pair:
                continue

            row_network = self._normalize_network_id(str(window.get("network_id", DEFAULT_NETWORK_ID)))
            if normalized_network and row_network != normalized_network:
                continue

            row_model_hash = str((prediction.get("model_identity") or {}).get("model_hash", "")).strip().lower()
            if normalized_model_hash and row_model_hash != normalized_model_hash:
                continue

            rows.append(
                {
                    "prediction": prediction,
                    "window": window,
                    "score": score,
                    "subject_id": prediction_subject,
                    "pair_id": row_pair,
                    "network_id": row_network,
                    "model_hash": row_model_hash or "unknown_model",
                    "scored_at_ts": scored_at_ts,
                }
            )

        rows.sort(key=lambda row: int(row.get("scored_at_ts", 0)), reverse=True)
        return rows[: max(1, int(limit))]

    @staticmethod
    def _empty_horizon_metrics(horizon_min: int) -> dict[str, Any]:
        return {
            "horizon_min": horizon_min,
            "sample_size": 0,
            "directional_accuracy": 0.0,
            "mae_bps": 0.0,
            "rmse_bps": 0.0,
            "bias_bps": 0.0,
            "brier_score": 0.0,
            "avg_pred_prob_up": 0.0,
            "actual_up_rate": 0.0,
            "calibration_gap": 0.0,
        }

    @staticmethod
    def _summary_stats(values: list[float]) -> dict[str, float]:
        if not values:
            return {
                "count": 0.0,
                "mean": 0.0,
                "min": 0.0,
                "max": 0.0,
                "p50": 0.0,
                "p95": 0.0,
            }
        sorted_vals = sorted(float(v) for v in values)
        n = len(sorted_vals)

        def _pct(p: float) -> float:
            idx = int(round((n - 1) * p))
            return float(sorted_vals[max(0, min(n - 1, idx))])

        return {
            "count": float(n),
            "mean": round(sum(sorted_vals) / n, 6),
            "min": round(sorted_vals[0], 6),
            "max": round(sorted_vals[-1], 6),
            "p50": round(_pct(0.50), 6),
            "p95": round(_pct(0.95), 6),
        }

    @staticmethod
    def _max_drawdown_bps(equity_curve: list[float]) -> float:
        if not equity_curve:
            return 0.0
        peak = equity_curve[0]
        max_dd = 0.0
        for value in equity_curve:
            peak = max(peak, value)
            max_dd = max(max_dd, peak - value)
        return float(max_dd)

    def get_horizon_benchmarks(
        self,
        *,
        subject_id: str | None,
        pair_id: str | None,
        network_id: str | None,
        model_hash: str | None,
        start_ts: int | None,
        end_ts: int | None,
        limit: int = 1000,
    ) -> dict[str, Any]:
        rows = self._collect_scored_records(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )

        buckets: dict[int, dict[str, float]] = {
            h: {
                "n": 0.0,
                "dir_hits": 0.0,
                "abs_err_sum": 0.0,
                "sq_err_sum": 0.0,
                "bias_sum": 0.0,
                "brier_sum": 0.0,
                "pred_prob_sum": 0.0,
                "actual_up_sum": 0.0,
            }
            for h in SUPPORTED_HORIZONS_MIN
        }

        for row in rows:
            per_horizon = (row["score"] or {}).get("per_horizon") or {}
            if not isinstance(per_horizon, dict):
                continue
            for per_h in per_horizon.values():
                if not isinstance(per_h, dict):
                    continue
                try:
                    horizon = int(per_h.get("horizon_min"))
                except Exception:
                    continue
                if horizon not in buckets:
                    continue
                predicted_return = float(per_h.get("predicted_return_bps", 0.0))
                actual_return = float(per_h.get("actual_return_bps", 0.0))
                err = predicted_return - actual_return
                pred_prob = float(per_h.get("predicted_prob_up", 0.0))
                actual_up = float(int(per_h.get("actual_up", 0)))
                brier = float(per_h.get("brier", (pred_prob - actual_up) ** 2))

                acc = buckets[horizon]
                acc["n"] += 1.0
                acc["dir_hits"] += 1.0 if bool(per_h.get("directional_hit", False)) else 0.0
                acc["abs_err_sum"] += abs(err)
                acc["sq_err_sum"] += (err * err)
                acc["bias_sum"] += err
                acc["brier_sum"] += brier
                acc["pred_prob_sum"] += pred_prob
                acc["actual_up_sum"] += actual_up

        horizon_benchmarks: list[dict[str, Any]] = []
        for horizon in SUPPORTED_HORIZONS_MIN:
            acc = buckets[horizon]
            if acc["n"] <= 0:
                horizon_benchmarks.append(self._empty_horizon_metrics(horizon))
                continue
            n = acc["n"]
            avg_pred_prob = acc["pred_prob_sum"] / n
            actual_up_rate = acc["actual_up_sum"] / n
            horizon_benchmarks.append(
                {
                    "horizon_min": horizon,
                    "sample_size": int(n),
                    "directional_accuracy": round(acc["dir_hits"] / n, 6),
                    "mae_bps": round(acc["abs_err_sum"] / n, 6),
                    "rmse_bps": round(math.sqrt(acc["sq_err_sum"] / n), 6),
                    "bias_bps": round(acc["bias_sum"] / n, 6),
                    "brier_score": round(acc["brier_sum"] / n, 6),
                    "avg_pred_prob_up": round(avg_pred_prob, 6),
                    "actual_up_rate": round(actual_up_rate, 6),
                    "calibration_gap": round(abs(avg_pred_prob - actual_up_rate), 6),
                }
            )

        return {
            "sample_forecasts": len(rows),
            "filters": {
                "subject_id": self._normalize_subject(subject_id) if subject_id else None,
                "pair_id": str(pair_id or "").strip().upper() or None,
                "network_id": self._normalize_network_id(network_id) if network_id else None,
                "model_hash": str(model_hash or "").strip() or None,
                "start_ts": int(start_ts) if start_ts is not None else None,
                "end_ts": int(end_ts) if end_ts is not None else None,
            },
            "horizon_benchmarks": horizon_benchmarks,
        }

    def get_calibration_curves(
        self,
        *,
        subject_id: str | None,
        pair_id: str | None,
        network_id: str | None,
        model_hash: str | None,
        start_ts: int | None,
        end_ts: int | None,
        bins: int = 10,
        limit: int = 2000,
    ) -> dict[str, Any]:
        rows = self._collect_scored_records(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )

        bucket_count = max(2, min(50, int(bins)))
        horizon_points: dict[int, list[tuple[float, int]]] = {h: [] for h in SUPPORTED_HORIZONS_MIN}

        for row in rows:
            per_horizon = (row["score"] or {}).get("per_horizon") or {}
            for per_h in per_horizon.values():
                if not isinstance(per_h, dict):
                    continue
                try:
                    horizon = int(per_h.get("horizon_min"))
                except Exception:
                    continue
                if horizon not in horizon_points:
                    continue
                try:
                    prob = float(per_h.get("predicted_prob_up", 0.0))
                    label = int(per_h.get("actual_up", 0))
                except Exception:
                    continue
                clipped_prob = min(max(prob, 0.0), 1.0)
                horizon_points[horizon].append((clipped_prob, 1 if label > 0 else 0))

        horizons: list[dict[str, Any]] = []
        for horizon in SUPPORTED_HORIZONS_MIN:
            bins_payload: list[dict[str, Any]] = []
            points = horizon_points[horizon]
            if points:
                buckets: list[list[tuple[float, int]]] = [[] for _ in range(bucket_count)]
                for prob, label in points:
                    idx = min(int(prob * bucket_count), bucket_count - 1)
                    buckets[idx].append((prob, label))

                for idx, bucket in enumerate(buckets):
                    lo = idx / bucket_count
                    hi = (idx + 1) / bucket_count
                    if not bucket:
                        bins_payload.append(
                            {
                                "bin_index": idx,
                                "range_lo": round(lo, 6),
                                "range_hi": round(hi, 6),
                                "count": 0,
                                "avg_confidence": 0.0,
                                "empirical_up_rate": 0.0,
                                "gap": 0.0,
                            }
                        )
                        continue
                    avg_conf = sum(prob for prob, _ in bucket) / len(bucket)
                    empirical = sum(label for _, label in bucket) / len(bucket)
                    bins_payload.append(
                        {
                            "bin_index": idx,
                            "range_lo": round(lo, 6),
                            "range_hi": round(hi, 6),
                            "count": int(len(bucket)),
                            "avg_confidence": round(avg_conf, 6),
                            "empirical_up_rate": round(empirical, 6),
                            "gap": round(abs(avg_conf - empirical), 6),
                        }
                    )
            horizons.append(
                {
                    "horizon_min": horizon,
                    "sample_size": len(points),
                    "buckets": bins_payload,
                }
            )

        return {
            "sample_forecasts": len(rows),
            "bins": bucket_count,
            "horizons": horizons,
        }

    def get_latency_analytics(
        self,
        *,
        subject_id: str | None,
        pair_id: str | None,
        network_id: str | None,
        model_hash: str | None,
        start_ts: int | None,
        end_ts: int | None,
        limit: int = 2000,
    ) -> dict[str, Any]:
        rows = self._collect_scored_records(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )

        commit_to_reveal: list[float] = []
        reveal_to_score: list[float] = []
        total_commit_to_score: list[float] = []
        horizon_score_lag: dict[int, list[float]] = {h: [] for h in SUPPORTED_HORIZONS_MIN}

        for row in rows:
            prediction = row["prediction"] or {}
            window = row["window"] or {}
            score = row["score"] or {}

            created_ts = int(prediction.get("created_at_ts") or 0)
            reveal_ts = int(prediction.get("revealed_at_ts") or 0)
            scored_ts = int(score.get("scored_at_ts") or row.get("scored_at_ts") or 0)
            window_open = int(window.get("window_open_ts") or 0)

            if created_ts > 0 and reveal_ts > created_ts:
                commit_to_reveal.append(float(reveal_ts - created_ts))
            if reveal_ts > 0 and scored_ts > reveal_ts:
                reveal_to_score.append(float(scored_ts - reveal_ts))
            if created_ts > 0 and scored_ts > created_ts:
                total_commit_to_score.append(float(scored_ts - created_ts))

            for horizon in SUPPORTED_HORIZONS_MIN:
                if window_open <= 0 or scored_ts <= 0:
                    continue
                maturity_ts = window_open + (horizon * 60)
                if scored_ts >= maturity_ts:
                    horizon_score_lag[horizon].append(float(scored_ts - maturity_ts))

        return {
            "sample_forecasts": len(rows),
            "stage_latencies_sec": {
                "commit_to_reveal": self._summary_stats(commit_to_reveal),
                "reveal_to_score": self._summary_stats(reveal_to_score),
                "commit_to_score": self._summary_stats(total_commit_to_score),
            },
            "horizon_score_lag_sec": {
                str(h): self._summary_stats(horizon_score_lag[h]) for h in SUPPORTED_HORIZONS_MIN
            },
        }

    def get_drift_analytics(
        self,
        *,
        subject_id: str | None,
        pair_id: str | None,
        network_id: str | None,
        model_hash: str | None,
        start_ts: int | None,
        end_ts: int | None,
        limit: int = 2000,
    ) -> dict[str, Any]:
        rows = self._collect_scored_records(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )
        asc = sorted(rows, key=lambda row: int(row.get("scored_at_ts", 0)))
        if not asc:
            return {
                "sample_forecasts": 0,
                "reference_count": 0,
                "current_count": 0,
                "feature_drift": [],
                "performance_drift": {},
                "rolling_performance": [],
            }

        split_idx = max(1, len(asc) // 2)
        reference = asc[:split_idx]
        current = asc[split_idx:]
        if not current:
            current = asc[-1:]

        def _metric_avg(records: list[dict[str, Any]], key: str) -> float:
            vals: list[float] = []
            for row in records:
                metrics = (row["score"] or {}).get("metrics") or {}
                if key in metrics:
                    vals.append(float(metrics.get(key, 0.0)))
            return float(sum(vals) / len(vals)) if vals else 0.0

        feature_keys: set[str] = set()
        for row in asc:
            feature_keys.update((row["window"].get("feature_vector") or {}).keys())

        feature_drift: list[dict[str, Any]] = []
        for feature_key in sorted(feature_keys):
            ref_vals = [
                float((row["window"].get("feature_vector") or {}).get(feature_key))
                for row in reference
                if feature_key in (row["window"].get("feature_vector") or {})
            ]
            cur_vals = [
                float((row["window"].get("feature_vector") or {}).get(feature_key))
                for row in current
                if feature_key in (row["window"].get("feature_vector") or {})
            ]
            if not ref_vals or not cur_vals:
                continue
            ref_mean = sum(ref_vals) / len(ref_vals)
            cur_mean = sum(cur_vals) / len(cur_vals)
            ref_var = sum((v - ref_mean) ** 2 for v in ref_vals) / max(1, len(ref_vals))
            ref_std = math.sqrt(ref_var)
            drift_z = abs(cur_mean - ref_mean) / max(1e-9, ref_std + 1e-6)
            feature_drift.append(
                {
                    "feature": str(feature_key),
                    "reference_mean": round(ref_mean, 6),
                    "current_mean": round(cur_mean, 6),
                    "delta": round(cur_mean - ref_mean, 6),
                    "drift_z": round(drift_z, 6),
                }
            )
        feature_drift.sort(key=lambda row: float(row.get("drift_z", 0.0)), reverse=True)

        rolling_performance = [
            {
                "idx": idx + 1,
                "scored_at_ts": int(row.get("scored_at_ts", 0)),
                "directional_accuracy": round(
                    float(((row["score"] or {}).get("metrics") or {}).get("directional_accuracy", 0.0)),
                    6,
                ),
                "mae_bps": round(float(((row["score"] or {}).get("metrics") or {}).get("mae_bps", 0.0)), 6),
                "brier_score": round(float(((row["score"] or {}).get("metrics") or {}).get("brier_score", 0.0)), 6),
                "ece": round(float(((row["score"] or {}).get("metrics") or {}).get("ece", 0.0)), 6),
            }
            for idx, row in enumerate(asc)
        ]

        performance_drift = {
            "directional_accuracy": {
                "reference": round(_metric_avg(reference, "directional_accuracy"), 6),
                "current": round(_metric_avg(current, "directional_accuracy"), 6),
            },
            "mae_bps": {
                "reference": round(_metric_avg(reference, "mae_bps"), 6),
                "current": round(_metric_avg(current, "mae_bps"), 6),
            },
            "brier_score": {
                "reference": round(_metric_avg(reference, "brier_score"), 6),
                "current": round(_metric_avg(current, "brier_score"), 6),
            },
            "ece": {
                "reference": round(_metric_avg(reference, "ece"), 6),
                "current": round(_metric_avg(current, "ece"), 6),
            },
        }
        for key, vals in performance_drift.items():
            vals["delta"] = round(float(vals["current"]) - float(vals["reference"]), 6)

        return {
            "sample_forecasts": len(asc),
            "reference_count": len(reference),
            "current_count": len(current),
            "feature_drift": feature_drift[:12],
            "performance_drift": performance_drift,
            "rolling_performance": rolling_performance,
        }

    def get_model_leaderboard(
        self,
        *,
        subject_id: str | None,
        pair_id: str | None,
        network_id: str | None,
        start_ts: int | None,
        end_ts: int | None,
        limit: int = 3000,
    ) -> dict[str, Any]:
        rows = self._collect_scored_records(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=None,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )

        model_acc: dict[str, dict[str, Any]] = {}
        window_rows: dict[str, list[dict[str, Any]]] = {}

        for row in rows:
            model = str(row.get("model_hash", "") or "unknown_model")
            metrics = (row["score"] or {}).get("metrics") or {}
            if model not in model_acc:
                model_acc[model] = {
                    "model_hash": model,
                    "sample_size": 0,
                    "directional_sum": 0.0,
                    "mae_sum": 0.0,
                    "brier_sum": 0.0,
                    "ece_sum": 0.0,
                    "wins": 0.0,
                    "losses": 0.0,
                    "shared_window_count": 0,
                }
            acc = model_acc[model]
            acc["sample_size"] += 1
            acc["directional_sum"] += float(metrics.get("directional_accuracy", 0.0))
            acc["mae_sum"] += float(metrics.get("mae_bps", 0.0))
            acc["brier_sum"] += float(metrics.get("brier_score", 0.0))
            acc["ece_sum"] += float(metrics.get("ece", 0.0))

            window_id = str((row["prediction"] or {}).get("window_id", ""))
            if window_id:
                window_rows.setdefault(window_id, []).append(row)

        for contenders in window_rows.values():
            if len(contenders) < 2:
                continue
            by_mae = sorted(
                contenders,
                key=lambda item: float(((item["score"] or {}).get("metrics") or {}).get("mae_bps", 1e12)),
            )
            winner_model = str(by_mae[0].get("model_hash", "unknown_model"))
            for contender in contenders:
                model = str(contender.get("model_hash", "unknown_model"))
                model_acc[model]["shared_window_count"] += 1
                if model == winner_model:
                    model_acc[model]["wins"] += 1.0
                else:
                    model_acc[model]["losses"] += 1.0

        leaderboard: list[dict[str, Any]] = []
        for acc in model_acc.values():
            n = max(1, int(acc["sample_size"]))
            directional = acc["directional_sum"] / n
            mae = acc["mae_sum"] / n
            brier = acc["brier_sum"] / n
            ece = acc["ece_sum"] / n
            wins = float(acc["wins"])
            losses = float(acc["losses"])
            shared_total = wins + losses
            win_rate = (wins / shared_total) if shared_total > 0 else 0.0

            mae_component = max(0.0, 1.0 - (mae / 600.0))
            brier_component = max(0.0, 1.0 - brier)
            ece_component = max(0.0, 1.0 - ece)
            composite = (
                (directional * 0.40)
                + (mae_component * 0.25)
                + (brier_component * 0.20)
                + (ece_component * 0.10)
                + (win_rate * 0.05)
            )

            leaderboard.append(
                {
                    "model_hash": str(acc["model_hash"]),
                    "sample_size": int(acc["sample_size"]),
                    "shared_window_count": int(acc["shared_window_count"]),
                    "directional_accuracy": round(directional, 6),
                    "mae_bps": round(mae, 6),
                    "brier_score": round(brier, 6),
                    "ece": round(ece, 6),
                    "win_rate_shared": round(win_rate, 6),
                    "composite_score": round(composite, 6),
                }
            )

        leaderboard.sort(
            key=lambda row: (
                float(row.get("composite_score", 0.0)),
                float(row.get("win_rate_shared", 0.0)),
                -float(row.get("mae_bps", 1e12)),
            ),
            reverse=True,
        )

        return {
            "sample_forecasts": len(rows),
            "leaderboard": leaderboard,
        }

    def run_pnl_simulation(
        self,
        *,
        subject_id: str | None,
        pair_id: str | None,
        network_id: str | None,
        model_hash: str | None,
        start_ts: int | None,
        end_ts: int | None,
        horizon_min: int = 30,
        long_prob_threshold: float = 0.60,
        short_prob_threshold: float = 0.40,
        min_abs_return_bps: int = 25,
        cost_per_trade_bps: float = 4.0,
        limit: int = 3000,
    ) -> dict[str, Any]:
        horizon = int(horizon_min)
        if horizon not in SUPPORTED_HORIZONS_MIN:
            raise ValueError(f"Unsupported horizon_min={horizon}")
        long_threshold = min(max(float(long_prob_threshold), 0.0), 1.0)
        short_threshold = min(max(float(short_prob_threshold), 0.0), 1.0)
        if short_threshold > long_threshold:
            raise ValueError("short_prob_threshold must be <= long_prob_threshold")

        rows = self._collect_scored_records(
            subject_id=subject_id,
            pair_id=pair_id,
            network_id=network_id,
            model_hash=model_hash,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=limit,
        )
        asc = sorted(rows, key=lambda row: int(row.get("scored_at_ts", 0)))

        equity_curve: list[float] = []
        curve_points: list[dict[str, Any]] = []
        equity_bps = 0.0
        trade_count = 0
        long_count = 0
        short_count = 0
        wins = 0
        trade_returns: list[float] = []
        hold_returns: list[float] = []

        horizon_key = str(horizon)
        for row in asc:
            per_h = (((row["score"] or {}).get("per_horizon") or {}).get(horizon_key) or {})
            if not isinstance(per_h, dict):
                continue

            pred_return = float(per_h.get("predicted_return_bps", 0.0))
            pred_prob = float(per_h.get("predicted_prob_up", 0.0))
            actual_return = float(per_h.get("actual_return_bps", 0.0))
            hold_returns.append(actual_return)

            action = "flat"
            realized = 0.0
            if pred_prob >= long_threshold and pred_return >= float(min_abs_return_bps):
                action = "long"
                realized = actual_return - float(cost_per_trade_bps)
                long_count += 1
            elif pred_prob <= short_threshold and pred_return <= -float(min_abs_return_bps):
                action = "short"
                realized = (-actual_return) - float(cost_per_trade_bps)
                short_count += 1

            if action != "flat":
                trade_count += 1
                trade_returns.append(realized)
                if realized > 0:
                    wins += 1

            equity_bps += realized
            equity_curve.append(equity_bps)
            curve_points.append(
                {
                    "scored_at_ts": int(row.get("scored_at_ts", 0)),
                    "equity_bps": round(equity_bps, 6),
                    "action": action,
                    "trade_return_bps": round(realized, 6),
                }
            )

        avg_trade = (sum(trade_returns) / len(trade_returns)) if trade_returns else 0.0
        win_rate = (wins / trade_count) if trade_count else 0.0
        participation = (trade_count / len(curve_points)) if curve_points else 0.0
        buy_hold_bps = sum(hold_returns) if hold_returns else 0.0
        max_drawdown_bps = self._max_drawdown_bps(equity_curve)

        return {
            "sample_forecasts": len(curve_points),
            "horizon_min": horizon,
            "params": {
                "long_prob_threshold": round(long_threshold, 6),
                "short_prob_threshold": round(short_threshold, 6),
                "min_abs_return_bps": int(min_abs_return_bps),
                "cost_per_trade_bps": round(float(cost_per_trade_bps), 6),
            },
            "stats": {
                "trade_count": int(trade_count),
                "long_count": int(long_count),
                "short_count": int(short_count),
                "win_rate": round(win_rate, 6),
                "participation_rate": round(participation, 6),
                "avg_trade_return_bps": round(avg_trade, 6),
                "cumulative_return_bps": round(equity_bps, 6),
                "max_drawdown_bps": round(max_drawdown_bps, 6),
                "buy_and_hold_bps": round(buy_hold_bps, 6),
            },
            "curve": curve_points,
        }

    def list_subject_score_history(self, subject_id: str, limit: int = 200) -> list[dict[str, Any]]:
        subject = self._normalize_subject(subject_id)
        rows: list[dict[str, Any]] = []

        for prediction in self._predictions.values():
            if self._normalize_subject(str(prediction.get("subject_id", ""))) != subject:
                continue
            if str(prediction.get("status", "")).strip().lower() != "scored":
                continue
            score_receipt_id = str(prediction.get("score_receipt_id", "")).strip()
            if not score_receipt_id:
                continue
            receipt = self._scores.get(score_receipt_id)
            if not receipt:
                continue
            window = self._windows.get(str(prediction.get("window_id", ""))) or {}
            rows.append(
                {
                    "forecast_id": str(prediction.get("forecast_id", "")),
                    "window_id": str(prediction.get("window_id", "")),
                    "pair_id": str(window.get("pair_id", "")),
                    "status": str(prediction.get("status", "")),
                    "trust_mode": str(prediction.get("trust_mode", "")),
                    "created_at_ts": int(prediction.get("created_at_ts", 0) or 0),
                    "scored_at_ts": int(receipt.get("scored_at_ts", 0) or 0),
                    "metrics": dict(receipt.get("metrics") or {}),
                }
            )

        rows.sort(
            key=lambda row: (
                int(row.get("scored_at_ts", 0)),
                int(row.get("created_at_ts", 0)),
            ),
            reverse=True,
        )
        return rows[: max(1, int(limit))]

    def auto_ingest_and_score(self, *, now_ts: int | None = None, max_predictions: int = 300) -> dict[str, Any]:
        now = int(now_ts or self._now_ts())
        checked = 0
        outcomes_written = 0
        scored_predictions = 0
        touched_windows: set[str] = set()
        scored_forecast_ids: list[str] = []
        source_counts: dict[str, int] = {}

        predictions = self.list_predictions(limit=max(1, int(max_predictions)))
        predictions.reverse()

        for prediction in predictions:
            checked += 1
            status = str(prediction.get("status", "")).strip().lower()
            if status not in {"revealed", "scored"}:
                continue

            window_id = str(prediction.get("window_id", ""))
            window = self._windows.get(window_id)
            if not window:
                continue

            horizons = self._normalize_horizons(prediction.get("horizons_min") or [])
            existing_outcomes = dict(window.get("outcomes") or {})
            outputs_scaled = prediction.get("outputs_scaled") or {}
            bounds = self._normalize_bounds(prediction.get("output_bounds") or {})

            pending_outcomes: list[dict[str, Any]] = []
            for horizon in horizons:
                key = str(horizon)
                maturity_ts = int(window["window_open_ts"]) + (horizon * 60)
                if key in existing_outcomes:
                    continue
                if now < maturity_ts:
                    continue
                if not outputs_scaled:
                    continue

                source_id = AUTO_OUTCOME_SOURCE_ID
                actual_return_bps = self._oracle_actual_return_bps(
                    window=window,
                    horizon_min=horizon,
                    maturity_ts=maturity_ts,
                    bounds=bounds,
                )
                if actual_return_bps is None:
                    actual_return_bps = self._deterministic_actual_return_bps(
                        forecast_id=str(prediction.get("forecast_id", "")),
                        horizon_min=horizon,
                        predicted_return_bps=int(outputs_scaled.get(RETURN_KEYS[horizon], 0)),
                        bounds=bounds,
                    )
                else:
                    source_id = self._oracle_source_id(window)

                pending_outcomes.append(
                    {
                        "horizon_min": horizon,
                        "actual_return_bps": actual_return_bps,
                        "actual_up": 1 if actual_return_bps > 0 else 0,
                        "maturity_ts": maturity_ts,
                        "source_id": source_id,
                    }
                )
                source_counts[source_id] = source_counts.get(source_id, 0) + 1

            if pending_outcomes:
                updated_window = self.upsert_outcomes(
                    window_id=window_id,
                    outcomes=pending_outcomes,
                    source_id=AUTO_OUTCOME_SOURCE_ID,
                    recorded_at_ts=now,
                )
                touched_windows.add(window_id)
                outcomes_written += len(pending_outcomes)
                existing_outcomes = dict(updated_window.get("outcomes") or {})

            if status == "scored":
                continue

            if not outputs_scaled:
                continue

            missing = [h for h in horizons if str(h) not in existing_outcomes]
            if missing:
                continue

            try:
                self.score_prediction(forecast_id=str(prediction.get("forecast_id", "")))
                scored_predictions += 1
                scored_forecast_ids.append(str(prediction.get("forecast_id", "")))
            except ValueError:
                continue

        return {
            "checked_predictions": checked,
            "outcomes_written": outcomes_written,
            "scored_predictions": scored_predictions,
            "touched_window_count": len(touched_windows),
            "scored_forecast_ids": scored_forecast_ids,
            "source_id": (
                next(iter(source_counts.keys()))
                if len(source_counts) == 1
                else "mixed"
                if source_counts
                else AUTO_OUTCOME_SOURCE_ID
            ),
            "source_counts": source_counts,
            "tick_ts": now,
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
    def _normalize_network_id(network_id: str | None) -> str:
        val = str(network_id or DEFAULT_NETWORK_ID).strip().lower()
        if val not in SUPPORTED_NETWORK_IDS:
            allowed = ", ".join(SUPPORTED_NETWORK_IDS)
            raise ValueError(f"Unsupported network_id '{val}'. Allowed: {allowed}")
        return val

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

    def _projection_signals(self, window: dict[str, Any]) -> dict[str, float]:
        features = window.get("feature_vector") or {}
        snapshot = window.get("snapshot_data") or {}

        feature_vals = self._numeric_entries(features if isinstance(features, dict) else {})
        snapshot_vals = self._numeric_entries(snapshot if isinstance(snapshot, dict) else {})

        momentum_vals = [
            value
            for key, value in [*feature_vals, *snapshot_vals]
            if any(token in key for token in ("ret", "return", "mom", "trend"))
        ]
        imbalance_vals = [
            value
            for key, value in [*feature_vals, *snapshot_vals]
            if any(token in key for token in ("imbalance", "buy_sell", "orderflow", "pressure"))
        ]
        volatility_vals = [
            value
            for key, value in [*feature_vals, *snapshot_vals]
            if any(token in key for token in ("vol", "sigma", "std"))
        ]
        spread_vals = [
            value
            for key, value in [*feature_vals, *snapshot_vals]
            if any(token in key for token in ("spread", "slippage"))
        ]
        liquidity_vals = [
            value
            for key, value in [*feature_vals, *snapshot_vals]
            if any(token in key for token in ("depth", "liq", "reserve", "tvl"))
        ]

        momentum_raw = self._mean(momentum_vals, default=0.0)
        imbalance_raw = self._mean(imbalance_vals, default=0.0)
        volatility_raw = self._mean(volatility_vals, default=50.0)
        spread_raw = self._mean(spread_vals, default=4.0)
        liquidity_raw = self._mean(liquidity_vals, default=0.0)

        if abs(liquidity_raw) > 10_000:
            liquidity_scale = 1_000_000.0
        elif abs(liquidity_raw) > 100:
            liquidity_scale = 1_000.0
        else:
            liquidity_scale = 2.0

        return {
            "momentum": math.tanh(momentum_raw / 35.0),
            "imbalance": math.tanh(imbalance_raw / 1.5),
            "volatility": math.tanh((volatility_raw - 50.0) / 60.0),
            "spread": math.tanh(spread_raw / 20.0),
            "liquidity": math.tanh(liquidity_raw / liquidity_scale),
        }

    @staticmethod
    def _projection_seed_jitter(*, window_id: str, network_id: str, pair_id: str) -> int:
        seed_input = f"{window_id}:{network_id}:{pair_id}".encode("utf-8")
        seed_hex = hashlib.sha256(seed_input).hexdigest()
        bucket = int(seed_hex[:8], 16) % 241  # [0, 240]
        return bucket - 120  # [-120, +120]

    @staticmethod
    def _numeric_entries(payload: dict[str, Any]) -> list[tuple[str, float]]:
        out: list[tuple[str, float]] = []
        for key, value in payload.items():
            try:
                num = float(value)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(num):
                continue
            out.append((str(key).strip().lower(), num))
        return out

    @staticmethod
    def _mean(values: list[float], *, default: float) -> float:
        if not values:
            return float(default)
        return float(sum(values) / len(values))

    def _recent_oracle_trend_bps(
        self,
        *,
        window: dict[str, Any],
        lookback_min: int = 30,
    ) -> tuple[int | None, str]:
        network_id = self._normalize_network_id(str(window.get("network_id", DEFAULT_NETWORK_ID)))
        now_ts = self._now_ts()
        lookback_ts = now_ts - max(5, int(lookback_min)) * 60
        max_skew_sec = max(6 * 3600, int(lookback_min) * 60 * 4)

        try:
            if network_id in {"starknet_sepolia", "starknet_mainnet"}:
                pair_tokens = self._resolve_pair_tokens(window, network_id=network_id)
                if not pair_tokens:
                    return None, "none"
                base_token, quote_token = pair_tokens
                points = self._load_ekubo_history_points(
                    network_id=network_id,
                    base_token=base_token,
                    quote_token=quote_token,
                    horizon_min=max(5, int(lookback_min)),
                )
                if len(points) < 2:
                    return None, "none"
                old_price = self._nearest_oracle_price(points, lookback_ts, max_skew_sec=max_skew_sec)
                new_price = self._nearest_oracle_price(points, now_ts, max_skew_sec=max_skew_sec)
                if old_price is None or new_price is None or old_price <= 0 or new_price <= 0:
                    return None, "none"
                trend_bps = int(round(((new_price / old_price) - 1.0) * 10000.0))
                return trend_bps, ORACLE_OUTCOME_SOURCE_ID

            if network_id == "ethereum_mainnet":
                symbols = self._resolve_pair_symbols(window)
                if not symbols:
                    return None, "none"
                base_sym, quote_sym = symbols
                old_price = self._coingecko_pair_price_at(
                    base_symbol=base_sym,
                    quote_symbol=quote_sym,
                    target_ts=lookback_ts,
                    max_skew_sec=max_skew_sec,
                )
                new_price = self._coingecko_pair_price_at(
                    base_symbol=base_sym,
                    quote_symbol=quote_sym,
                    target_ts=now_ts,
                    max_skew_sec=max_skew_sec,
                )
                if old_price is None or new_price is None or old_price <= 0 or new_price <= 0:
                    return None, "none"
                trend_bps = int(round(((new_price / old_price) - 1.0) * 10000.0))
                return trend_bps, COINGECKO_OUTCOME_SOURCE_ID
        except Exception as exc:  # pragma: no cover - network dependent
            logger.debug("Recent trend fetch failed (%s)", exc)

        return None, "none"

    def _oracle_actual_return_bps(
        self,
        *,
        window: dict[str, Any],
        horizon_min: int,
        maturity_ts: int,
        bounds: dict[str, int],
    ) -> int | None:
        network_id = self._normalize_network_id(str(window.get("network_id", DEFAULT_NETWORK_ID)))
        open_ts = int(window.get("window_open_ts") or 0)
        if open_ts <= 0:
            return None

        if network_id in {"starknet_sepolia", "starknet_mainnet"}:
            pair_tokens = self._resolve_pair_tokens(window, network_id=network_id)
            if not pair_tokens:
                return None

            base_token, quote_token = pair_tokens
            points = self._load_ekubo_history_points(
                network_id=network_id,
                base_token=base_token,
                quote_token=quote_token,
                horizon_min=int(horizon_min),
            )
            if len(points) < 2:
                return None

            max_skew_sec = max(24 * 3600, int(horizon_min) * 120)
            open_price = self._nearest_oracle_price(points, open_ts, max_skew_sec=max_skew_sec)
            close_price = self._nearest_oracle_price(points, int(maturity_ts), max_skew_sec=max_skew_sec)
        elif network_id == "ethereum_mainnet":
            symbols = self._resolve_pair_symbols(window)
            if not symbols:
                return None
            base_sym, quote_sym = symbols
            max_skew_sec = max(24 * 3600, int(horizon_min) * 120)
            open_price = self._coingecko_pair_price_at(
                base_symbol=base_sym,
                quote_symbol=quote_sym,
                target_ts=open_ts,
                max_skew_sec=max_skew_sec,
            )
            close_price = self._coingecko_pair_price_at(
                base_symbol=base_sym,
                quote_symbol=quote_sym,
                target_ts=int(maturity_ts),
                max_skew_sec=max_skew_sec,
            )
        else:
            return None

        if open_price is None or close_price is None:
            return None
        if open_price <= 0 or close_price <= 0:
            return None

        raw_bps = int(round(((close_price / open_price) - 1.0) * 10000.0))
        return int(
            max(
                int(bounds["return_min_bps"]),
                min(int(bounds["return_max_bps"]), raw_bps),
            )
        )

    def _resolve_pair_symbols(self, window: dict[str, Any]) -> tuple[str, str] | None:
        pair_id = str(window.get("pair_id", "")).strip().upper()
        if not pair_id:
            return None
        canonical_pair = pair_id.split("(")[0].strip()
        symbols = _PAIR_SYMBOLS.get(canonical_pair)
        if symbols:
            return symbols
        if "/" in canonical_pair:
            left, right = canonical_pair.split("/", 1)
            left = left.strip().upper()
            right = right.strip().upper()
            if left and right:
                return left, right
        return None

    def _resolve_pair_tokens(
        self,
        window: dict[str, Any],
        *,
        network_id: str,
    ) -> tuple[str, str] | None:
        snapshot = window.get("snapshot_data") or {}
        if isinstance(snapshot, dict):
            token_a = self._coerce_token_address(
                snapshot.get("base_token")
                or snapshot.get("baseToken")
                or snapshot.get("token0")
                or snapshot.get("token_a")
            )
            token_b = self._coerce_token_address(
                snapshot.get("quote_token")
                or snapshot.get("quoteToken")
                or snapshot.get("token1")
                or snapshot.get("token_b")
            )
            if token_a and token_b:
                return token_a, token_b

        symbols = self._resolve_pair_symbols(window)
        if not symbols:
            return None
        token_map = _SEPOLIA_TOKEN_BY_SYMBOL if network_id == "starknet_sepolia" else _MAINNET_TOKEN_BY_SYMBOL
        token_a = token_map.get(symbols[0])
        token_b = token_map.get(symbols[1])
        if not token_a or not token_b:
            return None
        return token_a, token_b

    @staticmethod
    def _coerce_token_address(raw: Any) -> str | None:
        if raw is None:
            return None
        value = str(raw).strip().lower()
        if not value.startswith("0x"):
            return None
        body = value[2:]
        if not body:
            return None
        if any(ch not in "0123456789abcdef" for ch in body):
            return None
        return "0x" + body.lstrip("0") if body.lstrip("0") else "0x0"

    @staticmethod
    def _history_chain_candidates(network_id: str) -> list[str]:
        configured = str(os.getenv("EKUBO_CHAIN_ID") or "").strip()
        configured_mainnet = str(os.getenv("EKUBO_CHAIN_ID_MAINNET") or "").strip()
        if network_id == "starknet_mainnet":
            candidates = [
                configured_mainnet,
                _EKUBO_MAINNET_CHAIN_ID,
            ]
        else:
            candidates = [
                configured,
                _EKUBO_SEPOLIA_CHAIN_ID,
                _EKUBO_SEPOLIA_CHAIN_ID_DEC,
            ]
        out: list[str] = []
        for c in candidates:
            if c and c not in out:
                out.append(c)
        return out

    @staticmethod
    def _history_intervals_for_horizon(horizon_min: int) -> list[int]:
        if horizon_min <= 5:
            return [60, 300, 900, 1800, 3600, 7200]
        if horizon_min <= 30:
            return [300, 900, 1800, 3600, 7200]
        return [900, 1800, 3600, 7200]

    def _load_ekubo_history_points(
        self,
        *,
        network_id: str,
        base_token: str,
        quote_token: str,
        horizon_min: int,
    ) -> list[tuple[int, float]]:
        best_points: list[tuple[int, float]] = []
        for chain_id in self._history_chain_candidates(network_id):
            for interval in self._history_intervals_for_horizon(horizon_min):
                points = self._fetch_price_history_points(
                    chain_id=chain_id,
                    base_token=base_token,
                    quote_token=quote_token,
                    interval=interval,
                )
                if len(points) > len(best_points):
                    best_points = points
                if len(points) >= 2:
                    return points
        return best_points

    def _fetch_price_history_points(
        self,
        *,
        chain_id: str,
        base_token: str,
        quote_token: str,
        interval: int,
    ) -> list[tuple[int, float]]:
        key = (chain_id, base_token, quote_token, int(interval))
        now = self._now_ts()
        cached = self._oracle_history_cache.get(key)
        if cached and (now - int(cached[0])) <= 30:
            return list(cached[1])

        api_base = str(os.getenv("EKUBO_API_BASE") or "https://prod-api.ekubo.org").rstrip("/")
        url = f"{api_base}/price/{chain_id}/{base_token}/{quote_token}/history"

        try:
            with httpx.Client(timeout=8.0) as client:
                response = client.get(url, params={"interval": int(interval)})
            if response.status_code != 200:
                return []
            payload = response.json()
        except Exception as exc:
            logger.debug(
                "Snapshot forecaster oracle history fetch failed chain=%s interval=%s pair=%s/%s (%s)",
                chain_id,
                interval,
                base_token,
                quote_token,
                exc,
            )
            return []

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            return []

        points: list[tuple[int, float]] = []
        for row in data:
            if not isinstance(row, dict):
                continue
            ts = self._parse_unix_ts(row.get("start") or row.get("timestamp") or row.get("ts"))
            if ts is None:
                continue
            try:
                price = float(row.get("vwap"))
            except (TypeError, ValueError):
                continue
            if not math.isfinite(price) or price <= 0:
                continue
            points.append((ts, price))

        points.sort(key=lambda item: item[0])
        self._oracle_history_cache[key] = (now, list(points))
        return points

    @staticmethod
    def _coingecko_range_key(target_ts: int) -> tuple[int, int]:
        start = int(target_ts - (2 * 24 * 3600))
        end = int(target_ts + (2 * 24 * 3600))
        bucket = 6 * 3600
        start_b = (start // bucket) * bucket
        end_b = ((end + bucket - 1) // bucket) * bucket
        return start_b, end_b

    def _fetch_coingecko_points(
        self,
        *,
        coin_id: str,
        target_ts: int,
    ) -> list[tuple[int, float]]:
        range_start, range_end = self._coingecko_range_key(target_ts)
        key = (coin_id, range_start, range_end)
        now = self._now_ts()
        cached = self._coingecko_history_cache.get(key)
        if cached and (now - int(cached[0])) <= 120:
            return list(cached[1])

        api_base = str(os.getenv("COINGECKO_API_BASE") or "https://api.coingecko.com/api/v3").rstrip("/")
        url = f"{api_base}/coins/{coin_id}/market_chart/range"
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.get(
                    url,
                    params={
                        "vs_currency": "usd",
                        "from": int(range_start),
                        "to": int(range_end),
                    },
                    headers={"accept": "application/json"},
                )
            if response.status_code != 200:
                return []
            payload = response.json()
        except Exception as exc:
            logger.debug("CoinGecko fetch failed coin=%s (%s)", coin_id, exc)
            return []

        raw = payload.get("prices") if isinstance(payload, dict) else None
        if not isinstance(raw, list):
            return []

        points: list[tuple[int, float]] = []
        for item in raw:
            if not isinstance(item, list) or len(item) < 2:
                continue
            try:
                ts_ms = int(item[0])
                price = float(item[1])
            except (TypeError, ValueError):
                continue
            if not math.isfinite(price) or price <= 0:
                continue
            points.append((int(ts_ms / 1000), price))

        points.sort(key=lambda row: row[0])
        self._coingecko_history_cache[key] = (now, list(points))
        return points

    def _coingecko_usd_price_at(
        self,
        *,
        coin_id: str,
        target_ts: int,
        max_skew_sec: int,
    ) -> float | None:
        if coin_id == "usd-coin":
            return 1.0
        points = self._fetch_coingecko_points(coin_id=coin_id, target_ts=target_ts)
        if not points:
            return None
        return self._nearest_oracle_price(points, target_ts, max_skew_sec=max_skew_sec)

    def _coingecko_pair_price_at(
        self,
        *,
        base_symbol: str,
        quote_symbol: str,
        target_ts: int,
        max_skew_sec: int,
    ) -> float | None:
        base_id = _COINGECKO_ID_BY_SYMBOL.get(base_symbol)
        quote_id = _COINGECKO_ID_BY_SYMBOL.get(quote_symbol)
        if not base_id or not quote_id:
            return None

        base_usd = self._coingecko_usd_price_at(
            coin_id=base_id,
            target_ts=target_ts,
            max_skew_sec=max_skew_sec,
        )
        quote_usd = self._coingecko_usd_price_at(
            coin_id=quote_id,
            target_ts=target_ts,
            max_skew_sec=max_skew_sec,
        )
        if base_usd is None or quote_usd is None or quote_usd <= 0:
            return None
        return float(base_usd / quote_usd)

    def _oracle_source_id(self, window: dict[str, Any]) -> str:
        network_id = self._normalize_network_id(str(window.get("network_id", DEFAULT_NETWORK_ID)))
        if network_id == "ethereum_mainnet":
            return COINGECKO_OUTCOME_SOURCE_ID
        return ORACLE_OUTCOME_SOURCE_ID

    @staticmethod
    def _parse_unix_ts(raw: Any) -> int | None:
        if raw is None:
            return None

        if isinstance(raw, (int, float)):
            ts = int(raw)
            return int(ts / 1000) if ts > 10_000_000_000 else ts

        txt = str(raw).strip()
        if not txt:
            return None

        if txt.isdigit():
            ts = int(txt)
            return int(ts / 1000) if ts > 10_000_000_000 else ts

        try:
            dt = datetime.fromisoformat(txt.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except ValueError:
            return None

    @staticmethod
    def _nearest_oracle_price(
        points: list[tuple[int, float]],
        target_ts: int,
        *,
        max_skew_sec: int,
    ) -> float | None:
        if not points:
            return None

        prior = [p for p in points if p[0] <= target_ts]
        if prior:
            ts, price = prior[-1]
            if abs(ts - target_ts) <= max_skew_sec:
                return price

        nearest_ts, nearest_price = min(points, key=lambda p: abs(p[0] - target_ts))
        if abs(nearest_ts - target_ts) > max_skew_sec:
            return None
        return nearest_price

    @staticmethod
    def _deterministic_actual_return_bps(
        *,
        forecast_id: str,
        horizon_min: int,
        predicted_return_bps: int,
        bounds: dict[str, int],
    ) -> int:
        # Deterministic surrogate outcome for public demo mode; replace with oracle-backed historical close when available.
        damp_by_horizon = {5: 0.88, 30: 0.82, 240: 0.76}
        damp = float(damp_by_horizon.get(int(horizon_min), 0.8))

        seed_raw = f"{forecast_id}:{horizon_min}".encode("utf-8")
        seed_hex = hashlib.sha256(seed_raw).hexdigest()
        jitter_bucket = int(seed_hex[:8], 16) % 161  # [0, 160]
        jitter_bps = jitter_bucket - 80  # [-80, +80]

        projected = int(round((int(predicted_return_bps) * damp) + jitter_bps))
        return int(
            max(
                int(bounds["return_min_bps"]),
                min(int(bounds["return_max_bps"]), projected),
            )
        )


_service: SnapshotForecasterService | None = None


def get_snapshot_forecaster_service() -> SnapshotForecasterService:
    global _service
    if _service is None:
        _service = SnapshotForecasterService()
    return _service
