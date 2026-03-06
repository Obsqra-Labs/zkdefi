# Source Generated with Decompyle++
# File: circuit_scanner.cpython-312.pyc (Python 3.12)

__doc__ = 'Unified circuit scanner — run any subset of the 25 zkML circuits in parallel.\n\nEach circuit generates a real Groth16 proof via snarkjs, returning a per-circuit\nresult dict with proof hash, compliance flag, and timing metadata.\n\nCircuits available:\n  ML/scoring:       RiskScore, AnomalyDetector, CorrelationRisk, TWAPPosition, SafetyDiversification\n  Merkle/privacy:   BalanceAboveThreshold, PoolMembership, TenureAboveThreshold\n  Agent/identity:   ImpermanentLossPredictor, YieldOptimality, SlippageBound,\n                    AgentReputationScore, CrossProtocolArbitrage, LiquidationRisk,\n                    HistoricalPerformanceAttestation, MEVResistanceProof\n  EZKL/safety:      ModelBridge, RebalanceTimingCommitment, RobustnessCertificate\n  Reputation:       SolvencyProof, RiskPassportTier, TraderPerformanceProof,\n                    StrategyIntegrity, ExecutionIntegrity\n  Governance:       private_vote\n'
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from datetime import datetime, timezone
logger = logging.getLogger(__name__)
from app.monitoring.metrics import proof_generation_total, proof_generation_duration_seconds
_METRICS_AVAILABLE = True
PROJECT_ROOT = Path(__file__).resolve().parents[4]
CIRCUITS_BUILD = PROJECT_ROOT / 'circuits' / 'build'
BACKEND_ROOT = PROJECT_ROOT / 'backend'
REQUIRE_REAL_PROOFS = os.environ.get('ZKDEFI_REQUIRE_REAL_PROOFS', '').lower() in ('1', 'true', 'yes')

class ProofGenerationError(Exception):
    '''Raised when REQUIRE_REAL_PROOFS is set and a proof fails to generate.'''
    pass

# WARNING: Decompyle incomplete
