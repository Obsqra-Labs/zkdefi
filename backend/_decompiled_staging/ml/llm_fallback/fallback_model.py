# Source Generated with Decompyle++
# File: fallback_model.cpython-312.pyc (Python 3.12)

__doc__ = '\nDeterministic Fallback Model for LLM Safety Net.\n\nA small, deterministic decision tree that takes the same inputs as the\n13 agent skills and outputs a decision class: {execute, reject, defer_to_human}.\n\nThe model is:\n  - Small enough for EZKL proof generation (<50 params)\n  - Deterministic: same inputs → same output (no temperature, no randomness)\n  - Exportable to ONNX for verifiable inference\n  - Conservative: biased toward reject/defer when uncertain\n\nThis acts as a "guardrail" — even if the LLM is compromised or hallucinating,\nthe deterministic fallback must agree before funds move.\n'
from __future__ import annotations
import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any
logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).resolve().parents[2] / 'data' / 'ezkl_models' / 'llm_fallback'
MODEL_DIR.mkdir(parents = True, exist_ok = True)
DECISIONS = [
    'execute',
    'reject',
    'defer_to_human']
# WARNING: Decompyle incomplete
