# Source Generated with Decompyle++
# File: mlp_model.cpython-312.pyc (Python 3.12)

'''
PyTorch MLP for creditworthiness classification.

Architecture: 18 input → 64 → 32 → 5 output
Uses ONLY EZKL-compatible ops: Linear, ReLU, Softmax.

This replaces XGBoost for EZKL-provable inference.
EZKL cannot handle tree-based ONNX ops (TreeEnsembleClassifier),
so we use a simple MLP that can be fully translated to a Halo2 circuit.
'''
from __future__ import annotations
import torch
from torch.nn import nn

class CreditMLP(nn.Module):
    pass
# WARNING: Decompyle incomplete


def export_onnx(model = None, path = None, n_features = None, opset_version = (18, 13)):
    """Export the MLP to ONNX with a fixed batch dimension of 1.
    
    Uses the legacy TorchScript-based exporter (dynamo=False) because
    EZKL's tract runtime requires opset ≤13.
    """
    model.eval()
    dummy = torch.randn(1, n_features)
    torch.onnx.export(model, dummy, path, input_names = [
        'features'], output_names = [
        'logits'], dynamic_axes = None, opset_version = opset_version, dynamo = False)

