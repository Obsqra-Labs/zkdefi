# Source Generated with Decompyle++
# File: trainer.cpython-312.pyc (Python 3.12)

__doc__ = '\nCreditworthiness model trainer — XGBoost 5-class classifier.\n\nClasses: AAA (best) → C (worst), mapped from behavioral + cross-chain features.\n\nTraining workflow:\n  1. Pull labeled data from decision_store (user_behavior_stats + heuristic labels)\n  2. Train XGBoost multi-class classifier\n  3. Export to ONNX for inference + EZKL proof generation\n  4. Register model hash in on-chain ModelRegistry\n\nLabels are initially heuristic-based:\n  - AAA: low early_exit_rate, high proof_success_rate, high tenure, no slashes\n  - C: high early_exit_rate, low tenure, slashes present\n  - As real default/repayment data accumulates, labels shift to ground truth.\n'
from __future__ import annotations
import hashlib
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any
logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).resolve().parents[2] / 'data' / 'ezkl_models' / 'creditworthiness'
MODEL_DIR.mkdir(parents = True, exist_ok = True)
CREDIT_CLASSES = [
    'AAA',
    'AA',
    'A',
    'B',
    'C']
# WARNING: Decompyle incomplete
