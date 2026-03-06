# Source Generated with Decompyle++
# File: robustness_tester.cpython-312.pyc (Python 3.12)

'''
Robustness Tester — runs ML models against adversarial attack suites
and generates robustness certificates with optional EZKL proofs.

Flow:
  1. AttackGenerator produces an AttackSuite (100+ scenarios)
  2. RobustnessTester runs each scenario through the model
  3. Results are checked against expected_action
  4. If pass_rate >= threshold, a RobustnessCertificate is generated
  5. Optionally, the certificate is proven via the RobustnessCertificate.circom circuit
'''
from __future__ import annotations
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from attack_generator import AttackScenario, AttackSuite, AttackType
logger = logging.getLogger(__name__)
TestResult = <NODE:12>()
RobustnessReport = <NODE:12>()
ModelFn = Callable[([
    dict[(str, Any)]], str)]

class RobustnessTester:
    '''
    Runs adversarial attack suites against ML models and produces
    robustness certificates.
    '''
    MIN_PASS_RATE_BPS = 9500
    MIN_ATTACKS = 50
    
    def __init__(self = None, model_name = None, model_hash = None):
        self.model_name = model_name
        self.model_hash = model_hash

    
    def run_suite(self = None, suite = None, model_fn = None, *, baseline_inputs):
        '''
        Run all scenarios in the attack suite against the model.

        Args:
            suite: AttackSuite from AttackGenerator
            model_fn: Callable that takes input features → returns action string
            baseline_inputs: Default feature values to merge with attack overrides

        Returns:
            RobustnessReport with pass/fail results and optional certificate.
        '''
        if not baseline_inputs:
            baseline_inputs
        baseline = { }
        results = []
        results_by_type = { }
        for scenario in suite.scenarios:
            result = self._run_single(scenario, model_fn, baseline)
            results.append(result)
            type_name = scenario.attack_type.name
            if type_name not in results_by_type:
                results_by_type[type_name] = {
                    'total': 0,
                    'passed': 0,
                    'failed': 0 }
            if result.passed:
                continue
        len(results) = None
        passed = (lambda .0: pass# WARNING: Decompyle incomplete
)(results())
        failed = total - passed
        pass_rate_bps = passed * 10000 // total if total > 0 else 0
    # WARNING: Decompyle incomplete

    
    def _run_single(self = None, scenario = None, model_fn = None, baseline = ('scenario', 'AttackScenario', 'model_fn', 'ModelFn', 'baseline', 'dict[str, Any]', 'return', 'TestResult')):
        '''Run a single attack scenario.'''
        import time
    # WARNING: Decompyle incomplete

    
    def _check_action(self = None, model_action = None, expected = None, severity = ('model_action', 'str', 'expected', 'str', 'severity', 'str', 'return', 'bool')):
        '''
        Check if the model\'s action is acceptable for this scenario.

        - For critical severity: model must return exactly the expected action
        - For high severity: model can return expected OR "defer" (conservative)
        - For medium severity: model can return expected, "defer", or exact match
        '''
        model_action = model_action.lower().strip()
        expected = expected.lower().strip()
        if model_action == expected:
            return True
        if model_action == 'reject' and expected in ('defer', 'reject'):
            return True
        if severity == 'medium' and model_action == 'defer':
            return True
        if severity == 'high' and model_action in ('reject', 'defer') and expected == 'defer':
            return True
        return False

    
    async def persist_report(self = None, report = None):
        '''Persist the robustness report to PostgreSQL.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def generate_circuit_proof(self = None, report = None):
        '''
        Generate a ZK proof of robustness via the RobustnessCertificate circuit.

        Returns the proof hash, or None if proof generation fails.
        '''
        pass
    # WARNING: Decompyle incomplete


