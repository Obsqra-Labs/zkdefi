"""
Deterministic Fallback Model for LLM Safety Net.

A small, deterministic decision tree that takes the same inputs as the
13 agent skills and outputs a decision class: {execute, reject, defer_to_human}.

The model is:
  - Small enough for EZKL proof generation (<50 params)
  - Deterministic: same inputs → same output (no temperature, no randomness)
  - Exportable to ONNX for verifiable inference
  - Conservative: biased toward reject/defer when uncertain

This acts as a "guardrail" — even if the LLM is compromised or hallucinating,
the deterministic fallback must agree before funds move.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "llm_fallback"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Decision classes
DECISIONS = ["execute", "reject", "defer_to_human"]
DECISION_TO_IDX = {d: i for i, d in enumerate(DECISIONS)}


@dataclass
class FallbackDecision:
    """Output of the deterministic fallback model."""
    decision: str           # execute, reject, defer_to_human
    confidence: float       # 0.0–1.0
    reasoning: str          # Human-readable explanation
    feature_flags: dict[str, bool]  # Which checks passed/failed


class DeterministicFallbackModel:
    """
    Rule-based decision model that mirrors agent skill logic.

    For each skill type, applies conservative thresholds.
    If ALL safety checks pass → execute.
    If ANY critical check fails → reject.
    Otherwise → defer_to_human.
    """

    def __init__(self) -> None:
        # Safety thresholds — deliberately more conservative than circuit thresholds
        self.thresholds = {
            "max_risk_score": 25,          # vs circuit's 30
            "max_anomaly_score": 40,       # vs circuit's 50
            "max_correlation": 70,         # vs circuit's 80
            "min_diversification": 70,     # vs circuit's 60
            "max_il_tolerance_bps": 400,   # vs circuit's 500
            "max_slippage_bps": 30,        # vs circuit's 50
            "min_health_factor": 1.5,      # vs circuit's 1.0
            "max_mev_deviation_bps": 30,   # vs circuit's 50
            "min_yield_optimality_pct": 90, # vs circuit's 80 (200bps gap)
            "max_action_value_eth": 20.0,  # Hard cap per action
        }

    def predict(
        self,
        skill_name: str,
        skill_inputs: dict[str, Any],
        llm_decision: str | None = None,
    ) -> FallbackDecision:
        """
        Run the deterministic decision logic for a given skill.

        Args:
            skill_name: One of the 13 agent skills.
            skill_inputs: The same inputs that the circuit/LLM received.
            llm_decision: What the LLM decided (for comparison only).

        Returns:
            FallbackDecision with conservative safety assessment.
        """
        checks: dict[str, bool] = {}
        reasons: list[str] = []

        # Universal checks
        value = float(skill_inputs.get("value_eth", skill_inputs.get("amount_eth", 0)))
        checks["value_within_limit"] = value <= self.thresholds["max_action_value_eth"]
        if not checks["value_within_limit"]:
            reasons.append(f"Value {value} ETH exceeds limit {self.thresholds['max_action_value_eth']}")

        # Skill-specific checks
        if skill_name in ("zk_risk_score", "risk_assessment"):
            risk_score = int(skill_inputs.get("risk_score", skill_inputs.get("computed_score", 100)))
            checks["risk_acceptable"] = risk_score <= self.thresholds["max_risk_score"]
            if not checks["risk_acceptable"]:
                reasons.append(f"Risk score {risk_score} exceeds threshold {self.thresholds['max_risk_score']}")

        elif skill_name in ("zk_anomaly_detection", "pool_safety"):
            anomaly = int(skill_inputs.get("anomaly_score", skill_inputs.get("weighted_sum", 100)))
            checks["no_anomaly"] = anomaly <= self.thresholds["max_anomaly_score"]
            if not checks["no_anomaly"]:
                reasons.append(f"Anomaly score {anomaly} exceeds threshold")

        elif skill_name == "zk_correlation_risk":
            corr = int(skill_inputs.get("correlation", 100))
            checks["correlation_safe"] = corr <= self.thresholds["max_correlation"]
            if not checks["correlation_safe"]:
                reasons.append(f"Correlation {corr} exceeds limit")

        elif skill_name == "zk_il_predictor":
            il_bps = int(skill_inputs.get("il_bps", skill_inputs.get("il_tolerance_bps", 1000)))
            checks["il_acceptable"] = il_bps <= self.thresholds["max_il_tolerance_bps"]
            if not checks["il_acceptable"]:
                reasons.append(f"IL {il_bps}bps exceeds tolerance")

        elif skill_name == "zk_yield_optimality":
            gap_bps = int(skill_inputs.get("optimality_gap_bps", 500))
            optimality_pct = 100 - (gap_bps / 100)
            checks["yield_optimal"] = optimality_pct >= self.thresholds["min_yield_optimality_pct"]
            if not checks["yield_optimal"]:
                reasons.append(f"Yield optimality {optimality_pct:.1f}% below threshold")

        elif skill_name == "zk_slippage_bound":
            slippage = int(skill_inputs.get("slippage_bps", 100))
            checks["slippage_safe"] = slippage <= self.thresholds["max_slippage_bps"]
            if not checks["slippage_safe"]:
                reasons.append(f"Slippage {slippage}bps exceeds limit")

        elif skill_name == "zk_liquidation_risk":
            health = float(skill_inputs.get("health_factor", 0))
            checks["health_ok"] = health >= self.thresholds["min_health_factor"]
            if not checks["health_ok"]:
                reasons.append(f"Health factor {health} below minimum")

        elif skill_name == "zk_mev_resistance":
            dev = int(skill_inputs.get("price_deviation_bps", 100))
            checks["no_mev"] = dev <= self.thresholds["max_mev_deviation_bps"]
            if not checks["no_mev"]:
                reasons.append(f"Price deviation {dev}bps suggests MEV")

        else:
            # Unknown skill — defer
            checks["known_skill"] = False
            reasons.append(f"Unknown skill '{skill_name}' — cannot assess")

        # Decision logic
        critical_failures = [k for k, v in checks.items() if not v]

        if not critical_failures:
            decision = "execute"
            confidence = 0.9
        elif len(critical_failures) == 1 and "known_skill" not in critical_failures:
            decision = "defer_to_human"
            confidence = 0.6
        else:
            decision = "reject"
            confidence = 0.85

        return FallbackDecision(
            decision=decision,
            confidence=confidence,
            reasoning="; ".join(reasons) if reasons else "All safety checks passed",
            feature_flags=checks,
        )

    def to_feature_vector(self, skill_name: str, skill_inputs: dict[str, Any]) -> list[float]:
        """
        Convert skill inputs to a fixed-length feature vector for ONNX export.
        10 features, matching the thresholds.
        """
        return [
            float(skill_inputs.get("risk_score", skill_inputs.get("computed_score", 0))),
            float(skill_inputs.get("anomaly_score", skill_inputs.get("weighted_sum", 0))),
            float(skill_inputs.get("correlation", 0)),
            float(skill_inputs.get("il_bps", skill_inputs.get("il_tolerance_bps", 0))),
            float(skill_inputs.get("slippage_bps", 0)),
            float(skill_inputs.get("health_factor", 2.0)),
            float(skill_inputs.get("price_deviation_bps", 0)),
            float(skill_inputs.get("optimality_gap_bps", 0)),
            float(skill_inputs.get("value_eth", skill_inputs.get("amount_eth", 0))),
            float(DECISIONS.index(skill_name) if skill_name in DECISIONS else 0),
        ]

    def get_model_hash(self) -> str:
        """Deterministic hash of the model parameters (thresholds)."""
        data = json.dumps(self.thresholds, sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()


# Singleton
_model: DeterministicFallbackModel | None = None


def get_fallback_model() -> DeterministicFallbackModel:
    global _model
    if _model is None:
        _model = DeterministicFallbackModel()
    return _model
