"""
Feature engineering for the creditworthiness model.

Combines three data sources into an 18-feature vector:
  1. Cross-chain activity (from cross_chain_fetcher.py)
  2. Behavioral stats (from decision_store / user_behavior_stats)
  3. On-chain reputation (from reputation_registry via API)

Feature vector is designed to be fed into:
  - XGBoost classifier for credit class prediction
  - EZKL prover for verifiable inference
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from typing import Any

logger = logging.getLogger(__name__)

# Feature names in canonical order (must match ONNX model input)
FEATURE_NAMES: list[str] = [
    # Cross-chain features (7)
    "chains_active",
    "total_tx_count",
    "total_value_usd",
    "account_age_days",
    "protocol_diversity",
    "success_rate",
    "unique_contracts",
    # Behavioral features (7)
    "early_exit_rate",
    "avg_hold_duration_hours",
    "proof_success_rate",
    "rebalance_frequency",
    "avg_action_size_eth",
    "max_single_loss_pct",
    "time_since_last_action_hours",
    # Reputation features (4)
    "tier",
    "tenure_days",
    "collateral_eth",
    "on_chain_reputation_score",
]

# Credit classes (model output)
CREDIT_CLASSES: list[str] = ["AAA", "AA", "A", "B", "C"]


@dataclass
class CreditFeatures:
    """18-dimensional feature vector for creditworthiness."""
    # Cross-chain (7)
    chains_active: float = 1.0
    total_tx_count: float = 0.0
    total_value_usd: float = 0.0
    account_age_days: float = 0.0
    protocol_diversity: float = 0.0
    success_rate: float = 1.0
    unique_contracts: float = 0.0
    # Behavioral (7)
    early_exit_rate: float = 0.0
    avg_hold_duration_hours: float = 0.0
    proof_success_rate: float = 1.0
    rebalance_frequency: float = 0.0
    avg_action_size_eth: float = 0.0
    max_single_loss_pct: float = 0.0
    time_since_last_action_hours: float = 0.0
    # Reputation (4)
    tier: float = 0.0
    tenure_days: float = 0.0
    collateral_eth: float = 0.0
    on_chain_reputation_score: float = 0.0

    def to_vector(self) -> list[float]:
        """Return features in canonical order as a flat list."""
        d = asdict(self)
        return [d[name] for name in FEATURE_NAMES]

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


async def build_features(
    user_address: str,
    cross_chain_data: dict[str, Any] | None = None,
    behavior_stats: dict[str, Any] | None = None,
    reputation_data: dict[str, Any] | None = None,
) -> CreditFeatures:
    """
    Build a CreditFeatures vector from available data sources.

    Args:
        user_address: For logging / fallback queries.
        cross_chain_data: Output of cross_chain_fetcher.fetch_all_chains()
        behavior_stats: Output of decision_store.get_behavior_stats()
        reputation_data: Dict with tier, tenure_days, collateral_eth, reputation_score

    Returns:
        CreditFeatures ready for model inference.
    """
    features = CreditFeatures()

    # --- Cross-chain features ---
    if cross_chain_data:
        agg = cross_chain_data.get("aggregated", cross_chain_data)
        features.chains_active = float(agg.get("chains_active", 1))
        features.total_tx_count = float(agg.get("total_transactions", 0))
        features.total_value_usd = float(agg.get("total_value_usd", 0))
        features.account_age_days = float(agg.get("account_age_days", 0))
        features.protocol_diversity = float(agg.get("protocol_diversity", 0))
        features.success_rate = float(agg.get("success_rate", 1.0))
        features.unique_contracts = float(agg.get("total_contracts_interacted", 0))

    # --- Behavioral features ---
    if behavior_stats:
        features.early_exit_rate = float(behavior_stats.get("early_exit_rate", 0))
        features.avg_hold_duration_hours = float(
            behavior_stats.get("activity_span_hours", 0)
            / max(behavior_stats.get("total_actions", 1), 1)
        )
        features.proof_success_rate = float(behavior_stats.get("proof_success_rate", 1.0))

        total = behavior_stats.get("total_actions", 0)
        span_h = behavior_stats.get("activity_span_hours", 0)
        features.rebalance_frequency = total / max(span_h, 1) if span_h > 0 else 0

        features.avg_action_size_eth = float(behavior_stats.get("avg_action_size_eth", 0))
        features.max_single_loss_pct = 0.0  # TODO: compute from withdrawal events

        # Time since last action
        last_seen = behavior_stats.get("last_seen")
        if last_seen:
            from datetime import datetime, timezone
            if hasattr(last_seen, "timestamp"):
                delta = datetime.now(timezone.utc) - last_seen
            else:
                delta_parsed = datetime.fromisoformat(str(last_seen))
                delta = datetime.now(timezone.utc) - delta_parsed.replace(tzinfo=timezone.utc)
            features.time_since_last_action_hours = delta.total_seconds() / 3600
    else:
        # No behavioral data — use neutral defaults
        features.proof_success_rate = 1.0  # Benefit of the doubt

    # --- Reputation features ---
    if reputation_data:
        features.tier = float(reputation_data.get("tier", 0))
        features.tenure_days = float(reputation_data.get("tenure_days", 0))
        features.collateral_eth = float(reputation_data.get("collateral_eth", 0))
        features.on_chain_reputation_score = float(
            reputation_data.get("reputation_score",
                reputation_data.get("on_chain_reputation_score", 0))
        )

    return features


def features_to_onnx_input(features: CreditFeatures) -> list[list[float]]:
    """Convert CreditFeatures to the nested list format EZKL expects."""
    return [features.to_vector()]
