# Source Generated with Decompyle++
# File: ezkl_prover_service.cpython-312.pyc (Python 3.12)

__doc__ = '\nEZKL Prover Service — wraps EZKL CLI for proving ML model inference.\n\nManages the full lifecycle:\n  1. Model setup (ONNX → compiled model + proving/verification keys)\n  2. Proof generation (inference + ZK proof)\n  3. Proof verification (local check before on-chain submission)\n\nStores artifacts in ``backend/data/ezkl_models/<model_name>/``.\n\nEZKL v23+ required (Halo2/KZG-based, audited by Trail of Bits).\n'
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any
logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent / 'data' / 'ezkl_models'
DATA_DIR.mkdir(parents = True, exist_ok = True)
EZKL_BIN = os.getenv('EZKL_BIN', 'ezkl')
EZKL_TIMEOUT = int(os.getenv('EZKL_TIMEOUT', '300'))
import ezkl as _ezkl_lib
_HAS_EZKL_PYTHON = True
EZKLModelArtifacts = <NODE:12>()
EZKLProof = <NODE:12>()

class EZKLProverService:
    '''
    Singleton service for EZKL proof generation.

    Usage:
        svc = get_ezkl_prover()
        artifacts = await svc.setup_model("yield_forecast", "/path/to/model.onnx", cal_data)
        proof = await svc.prove_inference("yield_forecast", input_data)
        ok = await svc.verify_proof(proof)
    '''
    
    def __init__(self = None):
        self._models = { }
        self._lock = asyncio.Lock()
        self._check_ezkl_available()

    
    async def setup_model(self = None, model_name = None, onnx_path = None, calibration_data = None, *, input_scale, param_scale, bits, logrows, force):
        '''
        One-time setup: gen-settings → calibrate → compile → setup.

        Args:
            model_name: Identifier for caching & storage.
            onnx_path: Path to the ONNX model file.
            calibration_data: Representative inputs for quantisation calibration.
            input_scale: EZKL input scaling (2^scale).
            param_scale: EZKL param scaling.
            bits: Bit width for quantised lookups.
            logrows: KZG SRS size (2^logrows points).
            force: Re-run setup even if artifacts exist.

        Returns:
            EZKLModelArtifacts with all paths populated.
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def prove_inference(self = None, model_name = None, input_data = None):
        '''
        Run inference and generate a ZK proof.

        Args:
            model_name: Must match a previously setup model.
            input_data: Model inputs as nested list matching ONNX input shape.

        Returns:
            EZKLProof with proof bytes, outputs, and hashes.
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def verify_proof(self = None, proof = None):
        '''
        Locally verify an EZKL proof (pre-flight before on-chain submit).
        '''
        pass
    # WARNING: Decompyle incomplete

    
    def get_model_hash_felt(self = None, model_name = None):
        '''Return model hash truncated to fit felt252 (< 2^251).'''
        artifacts = self._get_artifacts(model_name)
        return int(artifacts.model_hash[:62], 16)

    
    def get_artifacts(self = None, model_name = None):
        '''Return artifacts for a model if set up, else None.'''
        return self._models.get(model_name)

    
    def list_models(self = None):
        '''Return names of all set-up models.'''
        return list(self._models.keys())

    
    async def _setup_model_python(self, artifacts, onnx_path, input_scale = None, param_scale = None, bits = None, logrows = ('artifacts', 'EZKLModelArtifacts', 'onnx_path', 'Path', 'input_scale', 'int', 'param_scale', 'int', 'bits', 'int', 'logrows', 'int', 'return', 'None')):
        '''Setup model using ezkl Python bindings.

        EZKL v23 calling conventions:
          - gen_settings, calibrate_settings, compile_circuit, setup: synchronous
          - get_srs: async (downloads SRS via HTTP internally)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def _setup_model_cli(self, artifacts, onnx_path, input_scale = None, param_scale = None, bits = None, logrows = ('artifacts', 'EZKLModelArtifacts', 'onnx_path', 'Path', 'input_scale', 'int', 'param_scale', 'int', 'bits', 'int', 'logrows', 'int', 'return', 'None')):
        '''Setup model using ezkl CLI subprocess (fallback).'''
        pass
    # WARNING: Decompyle incomplete

    
    async def _prove_inference_python(self = None, artifacts = None, input_data = None):
        '''Generate proof using ezkl Python bindings.

        All EZKL v23 prove-path functions (gen_witness, prove) are synchronous.
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def _prove_inference_cli(self = None, artifacts = None, input_data = None):
        '''Generate proof using ezkl CLI subprocess (fallback).'''
        pass
    # WARNING: Decompyle incomplete

    
    async def _verify_proof_python(self = None, artifacts = None, proof = None):
        '''Verify proof using ezkl Python bindings (sync call).'''
        pass
    # WARNING: Decompyle incomplete

    
    async def _verify_proof_cli(self = None, artifacts = None, proof = None):
        '''Verify proof using ezkl CLI subprocess (fallback).'''
        pass
    # WARNING: Decompyle incomplete

    
    def _get_artifacts(self = None, model_name = None):
        if model_name not in self._models:
            raise ValueError(f'''Model \'{model_name}\' not set up. Call setup_model() first. Available: {list(self._models.keys())}''')
        return self._models[model_name]

    
    def _check_ezkl_available(self = None):
        if _HAS_EZKL_PYTHON:
            logger.info('EZKL Python API available (v%s). Using native bindings.', getattr(_ezkl_lib, '__version__', 'unknown'))
            self._use_python_api = True
            return None
        self._use_python_api = False
        result = subprocess.run([
            EZKL_BIN,
            '--version'], capture_output = True, text = True, timeout = 10)
        if result.returncode == 0:
            logger.info('EZKL CLI available: %s', result.stdout.strip())
            return None
        logger.warning('EZKL binary found but returned error: %s', result.stderr.strip())
        return None
    # WARNING: Decompyle incomplete

    
    async def _run_ezkl(self = None, args = None):
        '''Run an EZKL CLI command asynchronously.'''
        pass
    # WARNING: Decompyle incomplete

    
    def _run_ezkl_sync(self = None, cmd = None):
        result = subprocess.run(cmd, capture_output = True, text = True, timeout = EZKL_TIMEOUT)
        if result.returncode != 0:
            stderr = result.stderr.strip()
            stdout = result.stdout.strip()
            if not stderr:
                stderr
                if not stdout:
                    stdout
            msg = f'''EZKL command failed with code {result.returncode}'''
            raise RuntimeError(f'''EZKL error: {msg}\nCommand: {' '.join(cmd)}''')
        return result.stdout

    _decode_field_element = (lambda val = None: if isinstance(val, (int, float)):
float(val)if None(val, str):
hex_str = val.replace('0x', '')if (lambda .0: pass# WARNING: Decompyle incomplete
)(hex_str()) and len(hex_str) > 0:
                if len(hex_str) % 2 != 0:
                    hex_str = '0' + hex_str
                le_bytes = bytes.fromhex(hex_str)
                v = int.from_bytes(le_bytes, byteorder = 'little')
                BN254_P = 0x30644E72E131A029B85045B68181585D2833E84879B9709143E1F593F0000001
                if v > BN254_P // 2:
                    v = v - BN254_P
                return v / 8192
            return all(val)
    # WARNING: Decompyle incomplete
)()

_instance: 'EZKLProverService | None' = None

def get_ezkl_prover():
    '''Get or create the EZKL prover singleton.'''
    pass
# WARNING: Decompyle incomplete

return None
# WARNING: Decompyle incomplete
