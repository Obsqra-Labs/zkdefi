# Source Generated with Decompyle++
# File: model.cpython-312.pyc (Python 3.12)

__doc__ = '\nYield Forecast MLP — EZKL-provable model.\n\nPredicts next-period APR bucket from pool features (TVL, volume, fee tier, \nhistorical APR snapshots). Uses only Linear+ReLU ops so EZKL can prove it.\n\nArchitecture:\n  Linear(12→32) → ReLU → Linear(32→16) → ReLU → Linear(16→4)\n\nOutput classes: ["declining", "stable", "growing", "surging"]\n  - declining: APR dropping >20%\n  - stable: APR within ±20%\n  - growing: APR increasing 20-50%\n  - surging: APR increasing >50%\n'
from __future__ import annotations
import torch
from torch.nn import nn
YIELD_CLASSES = [
    'declining',
    'stable',
    'growing',
    'surging']
# WARNING: Decompyle incomplete
