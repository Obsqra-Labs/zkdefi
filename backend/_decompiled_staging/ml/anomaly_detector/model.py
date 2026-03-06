# Source Generated with Decompyle++
# File: model.cpython-312.pyc (Python 3.12)

__doc__ = '\nAnomaly Detector MLP — EZKL-provable model.\n\nDetects pool safety anomalies from 8 risk factors. Uses only Linear+ReLU ops\nso EZKL can prove the inference in zero knowledge.\n\nArchitecture:\n  Linear(8→24) → ReLU → Linear(24→12) → ReLU → Linear(12→3)\n\nOutput classes: ["safe", "warning", "critical"]\n  - safe: pool operating normally\n  - warning: elevated risk, monitor closely\n  - critical: immediate risk, avoid or exit\n\nInput features match the AnomalyDetector Circom circuit\'s 6 factors,\nextended with 2 additional on-chain signals.\n'
from __future__ import annotations
import torch
from torch.nn import nn
ANOMALY_CLASSES = [
    'safe',
    'warning',
    'critical']
# WARNING: Decompyle incomplete
