"""
Yield Forecast MLP — EZKL-provable model.

Predicts next-period APR bucket from pool features (TVL, volume, fee tier, 
historical APR snapshots). Uses only Linear+ReLU ops so EZKL can prove it.

Architecture:
  Linear(12→32) → ReLU → Linear(32→16) → ReLU → Linear(16→4)

Output classes: ["declining", "stable", "growing", "surging"]
  - declining: APR dropping >20%
  - stable: APR within ±20%
  - growing: APR increasing 20-50%
  - surging: APR increasing >50%
"""
from __future__ import annotations

import torch
import torch.nn as nn


YIELD_CLASSES = ["declining", "stable", "growing", "surging"]
CLASS_TO_IDX = {c: i for i, c in enumerate(YIELD_CLASSES)}

# 12 input features
FEATURE_NAMES = [
    "tvl_usd_log",             # log10(TVL)
    "volume_24h_log",          # log10(24h volume)
    "fee_tier_bps",            # Pool fee tier (5, 30, 100 bps)
    "current_apr",             # Current APR (0–1 scale)
    "apr_7d_avg",              # 7-day rolling average APR
    "apr_30d_avg",             # 30-day rolling average APR
    "apr_trend_7d",            # (cur - 7d_avg) / 7d_avg
    "apr_volatility_7d",       # Stdev of daily APR over 7 days
    "utilization_ratio",       # volume / TVL
    "tick_concentration",      # Liquidity concentration near current tick
    "num_positions",           # Active LP positions (normalised)
    "time_since_last_rebalance_hours",  # Hours since last rebalance
]


class YieldForecastMLP(nn.Module):
    """Small MLP for yield forecasting — EZKL-compatible ops only."""

    def __init__(self, n_features: int = 12, n_classes: int = 4) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def export_onnx(
    model: YieldForecastMLP,
    path: str,
    n_features: int = 12,
    opset_version: int = 13,
) -> None:
    """Export to ONNX with fixed batch=1.  Uses legacy exporter for EZKL compat."""
    model.eval()
    dummy = torch.randn(1, n_features)
    torch.onnx.export(
        model,
        dummy,
        path,
        input_names=["pool_features"],
        output_names=["yield_logits"],
        dynamic_axes=None,
        opset_version=opset_version,
        dynamo=False,
    )
