"""
PyTorch MLP for creditworthiness classification.

Architecture: 18 input → 64 → 32 → 5 output
Uses ONLY EZKL-compatible ops: Linear, ReLU, Softmax.

This replaces XGBoost for EZKL-provable inference.
EZKL cannot handle tree-based ONNX ops (TreeEnsembleClassifier),
so we use a simple MLP that can be fully translated to a Halo2 circuit.
"""
from __future__ import annotations

import torch
import torch.nn as nn


class CreditMLP(nn.Module):
    """
    Small MLP for 5-class credit classification.

    Input:  18 features (normalised floats)
    Output: 5-class logits (AAA, AA, A, B, C)

    Architecture kept small to minimise EZKL proving time:
      Linear(18→64) → ReLU → Linear(64→32) → ReLU → Linear(32→5)
    """

    def __init__(self, n_features: int = 18, n_classes: int = 5) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def export_onnx(
    model: CreditMLP,
    path: str,
    n_features: int = 18,
    opset_version: int = 13,
) -> None:
    """Export the MLP to ONNX with a fixed batch dimension of 1.
    
    Uses the legacy TorchScript-based exporter (dynamo=False) because
    EZKL's tract runtime requires opset ≤13.
    """
    model.eval()
    dummy = torch.randn(1, n_features)
    torch.onnx.export(
        model,
        dummy,
        path,
        input_names=["features"],
        output_names=["logits"],
        dynamic_axes=None,  # fixed shape for EZKL
        opset_version=opset_version,
        dynamo=False,  # Legacy exporter — supports opset 13
    )
