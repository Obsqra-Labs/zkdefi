# Source Generated with Decompyle++
# File: predictor.cpython-312.pyc (Python 3.12)

'''
Creditworthiness predictor — MLP inference + EZKL ZK proof.

Uses a PyTorch MLP (Linear + ReLU only) exported to ONNX.
EZKL can prove this model\'s inference in a Halo2 ZK circuit.

Fallback chain:
  1. MLP ONNX via onnxruntime (preferred — matches EZKL\'s proven model)
  2. XGBoost native model (legacy inference, no proof)
  3. Heuristic rules (no model loaded)

Usage:
    predictor = get_creditworthiness_predictor()
    result = await predictor.predict(user_address, cross_chain_data, behavior_stats, reputation)
    # result = {credit_class: "AA", confidence: 0.87, ..., proof: {...} | None}
'''
from __future__ import annotations
import json
import logging
from pathlib import Path
from typing import Any
import numpy as np
logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).resolve().parents[2] / 'data' / 'ezkl_models' / 'creditworthiness'
CREDIT_CLASSES = [
    'AAA',
    'AA',
    'A',
    'B',
    'C']
CREDIT_TERMS: 'dict[str, dict[str, float]]' = {
    'AAA': {
        'ltv': 0.9,
        'rate_bps': 300,
        'unsecured_multiplier': 1.5 },
    'AA': {
        'ltv': 0.85,
        'rate_bps': 400,
        'unsecured_multiplier': 1.2 },
    'A': {
        'ltv': 0.8,
        'rate_bps': 500,
        'unsecured_multiplier': 1 },
    'B': {
        'ltv': 0.7,
        'rate_bps': 700,
        'unsecured_multiplier': 0.5 },
    'C': {
        'ltv': 0.5,
        'rate_bps': 1000,
        'unsecured_multiplier': 0.1 } }

class CreditworthinessPredictor:
    '''Runs creditworthiness inference with optional EZKL proof generation.'''
    
    def __init__(self = None):
        self._ort_session = None
        self._model = None
        self._model_hash = None
        self._onnx_path = None
        self._norm_min = None
        self._norm_range = None
        self._model_type = 'fallback'
        self._observed_class_indices = None
        self._load_model()

    
    def _load_model(self = None):
        '''Load models: prefer MLP ONNX, fallback to XGBoost.'''
        meta_path = MODEL_DIR / 'training_metadata.json'
        onnx_path = MODEL_DIR / 'creditworthiness.onnx'
        norm_path = MODEL_DIR / 'mlp_norm_params.json'
        native_path = MODEL_DIR / 'creditworthiness_model.json'
        meta = { }
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            self._model_hash = meta.get('model_hash')
        if onnx_path.exists():
            import onnxruntime as ort
            self._ort_session = ort.InferenceSession(str(onnx_path), providers = [
                'CPUExecutionProvider'])
            self._onnx_path = onnx_path
            self._model_type = 'creditworthiness_mlp'
            logger.info('MLP ONNX loaded via onnxruntime: %s', onnx_path)
            if norm_path.exists():
                norm = json.loads(norm_path.read_text())
                self._norm_min = np.array(norm['min'], dtype = np.float32)
                self._norm_range = np.array(norm['range'], dtype = np.float32)
                logger.info('MLP normalisation params loaded')
            else:
                logger.warning('MLP norm params not found — using raw features')
            self._observed_class_indices = list(range(len(CREDIT_CLASSES)))
    # WARNING: Decompyle incomplete

    is_ready = (lambda self = None: pass# WARNING: Decompyle incomplete
)()
    
    def _normalise(self = None, X = None):
        '''Apply min-max normalisation matching training.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def predict(self = None, user_address = None, cross_chain_data = None, behavior_stats = None, reputation_data = (None, None, None), *, generate_proof):
        '''
        Predict credit class for a user.

        Args:
            user_address: Target user.
            cross_chain_data: From cross_chain_fetcher.
            behavior_stats: From decision_store.get_behavior_stats().
            reputation_data: From reputation registry.
            generate_proof: If True, also generate EZKL proof of inference.

        Returns:
            Dict with credit_class, confidence, terms, feature_importances, proof (optional).
        '''
        pass
    # WARNING: Decompyle incomplete

    
    def _fallback_predict(self = None, features = None):
        '''Heuristic fallback when no trained model is available.'''
        vec = features.to_vector()
        early_exit_rate = vec[7]
        proof_success = vec[9]
        tenure = vec[15]
        score = 100
        score -= int(early_exit_rate * 40)
        score -= int((1 - proof_success) * 20)
        score += min(int(tenure / 10), 20)
        if score >= 90:
            cls = 'AAA'
        elif score >= 75:
            cls = 'AA'
        elif score >= 60:
            cls = 'A'
        elif score >= 40:
            cls = 'B'
        else:
            cls = 'C'
    # WARNING: Decompyle incomplete


_predictor: 'CreditworthinessPredictor | None' = None

def get_creditworthiness_predictor():
    '''Get or create the creditworthiness predictor singleton.'''
    pass
# WARNING: Decompyle incomplete

