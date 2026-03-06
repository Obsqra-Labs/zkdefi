# Source Generated with Decompyle++
# File: ezkl_setup.cpython-312.pyc (Python 3.12)

'''
EZKL setup for the creditworthiness model.

One-time operation: compiles the ONNX model, generates proving/verification keys,
and prepares calibration data for quantisation.

Usage:
    python -m app.ml.creditworthiness.ezkl_setup
'''
from __future__ import annotations
import asyncio
import json
import logging
from pathlib import Path
logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).resolve().parents[2] / 'data' / 'ezkl_models' / 'creditworthiness'

async def setup_creditworthiness_ezkl(force = None, input_scale = None, param_scale = None, bits = (False, 7, 7, 16, 17), logrows = ('force', 'bool', 'input_scale', 'int', 'param_scale', 'int', 'bits', 'int', 'logrows', 'int', 'return', 'dict')):
    '''
    Set up EZKL proving for the creditworthiness model.

    1. Loads the ONNX model path from training metadata
    2. Generates calibration data from representative feature vectors
    3. Runs EZKL setup pipeline
    '''
    pass
# WARNING: Decompyle incomplete

if __name__ == '__main__':
    result = asyncio.run(setup_creditworthiness_ezkl(force = True))
    print(json.dumps(result, indent = 2))
    return None
