"""
Anomaly Detector MLP — EZKL-provable model.

Detects pool safety anomalies from 8 risk factors. Uses only Linear+ReLU ops
so EZKL can prove the inference in zero knowledge.

Architecture:
  Linear(8→24) → ReLU → Linear(24→12) → ReLU → Linear(12→3)

Output classes: ["safe", "warning", "critical"]
  - safe: pool operating normally
  - warning: elevated risk, monitor closely
  - critical: immediate risk, avoid or exit

Input features match the AnomalyDetector Circom circuit's 6 factors,
extended with 2 additional on-chain signals.
"""
from __future__ import annotations

import torch
import torch.nn as nn


ANOMALY_CLASSES = ["safe", "warning", "critical"]
CLASS_TO_IDX = {c: i for i, c in enumerate(ANOMALY_CLASSES)}

FEATURE_NAMES = [
    "tvl_stability",           # 1 - (tvl_stdev / tvl_mean) over 7 days
    "liquidity_concentration", # % of liquidity within ±5% of current price
    "price_impact_bps",        # Average price impact for 1 ETH trade
    "deployer_reputation",     # Deployer address reputation score (0–1)
    "volume_pattern",          # Volume consistency score (0–1)
    "fee_anomaly",             # |actual_fees - expected_fees| / expected_fees
    "large_withdrawal_pct",    # % of TVL withdrawn in last 24h
    "smart_money_flow",        # Net flow from top wallets (normalised -1 to 1)
]


class AnomalyDetectorMLP(nn.Module):
    """Small MLP for anomaly detection — EZKL-compatible ops only."""

    def __init__(self, n_features: int = 8, n_classes: int = 3) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 24),
            nn.ReLU(),
            nn.Linear(24, 12),
            nn.ReLU(),
            nn.Linear(12, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def export_onnx(
    model: AnomalyDetectorMLP,
    path: str,
    n_features: int = 8,
    opset_version: int = 13,
) -> None:
    """Export to ONNX with fixed batch=1.  Uses legacy exporter for EZKL compat."""
    model.eval()
    dummy = torch.randn(1, n_features)
    torch.onnx.export(
        model,
        dummy,
        path,
        input_names=["pool_risk_features"],
        output_names=["anomaly_logits"],
        dynamic_axes=None,
        opset_version=opset_version,
        dynamo=False,
    )
