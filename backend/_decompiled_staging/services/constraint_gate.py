# Source Generated with Decompyle++
# File: constraint_gate.cpython-312.pyc (Python 3.12)

"""
Constraint Gate — enforces onboarding constraints + ZKML proof verification
before allowing vault operations (allocate, execute, rebalance).

Data flow:
  1. Loads user's onboarding state (fact_hash, identity_commitment, constraints)
  2. Loads vault policy (risk budget, session limits, max notional)
  3. Runs ZKML risk-score check against user's portfolio features
  4. Validates the requested operation respects all bounds
  5. Returns a ConstraintVerdict: pass/fail + attestation hash

If onboarding was never completed, operations are BLOCKED (unless the user
is in a dev/testing bypass list).

Gating from Risk Profile: see docs/GATING_FROM_PROFILE.md. Tier/reputation
can optionally be resolved from the same Risk Profile bundle when available.
"""
from __future__ import annotations
import hashlib
import json
import logging
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
logger = logging.getLogger(__name__)
_cached_eth_usd: 'float' = 2500

def update_cached_eth_usd(price = None):
    '''Called from async oracle code to keep sync callers up-to-date.'''
    global _cached_eth_usd
    if price:
        if price > 0:
            _cached_eth_usd = price
            return None
        return None


def _get_cached_eth_usd():
    '''Return last-known ETH/USD price (sync safe).'''
    return _cached_eth_usd

_ONBOARDING_STATE_FILE = Path(__file__).resolve().parent.parent / 'app' / 'data' / 'onboarding_state.json'
_ALT_STATE_FILE = Path(__file__).resolve().parent.parent / 'data' / 'onboarding_state.json'
for _candidate in (Path(__file__).resolve().parent.parent / 'data' / 'onboarding_state.json', Path(__file__).resolve().parent.parent / 'app' / 'data' / 'onboarding_state.json', Path(__file__).resolve().parent.parent.parent / 'data' / 'onboarding_state.json'):
    if not _candidate.exists():
        continue
    _ONBOARDING_STATE_FILE = _candidate
    (Path(__file__).resolve().parent.parent / 'data' / 'onboarding_state.json', Path(__file__).resolve().parent.parent / 'app' / 'data' / 'onboarding_state.json', Path(__file__).resolve().parent.parent.parent / 'data' / 'onboarding_state.json')

def tolerance_to_profile(tolerance = None):
    '''Map numeric risk_tolerance to string profile.'''
    if tolerance <= 35:
        return 'conservative'
    if tolerance >= 65:
        return 'aggressive'
    return 'balanced'


def profile_to_tolerance(profile = None):
    '''Map string profile back to numeric risk_tolerance.'''
    p = profile.strip().lower()
    if p == 'conservative':
        return 30
    if p == 'aggressive':
        return 70
    return 50

OnboardingConstraints = <NODE:12>()
ConstraintVerdict = <NODE:12>()

class ConstraintGate:
    '''
    Pre-flight check for vault operations. Loads onboarding constraints,
    validates identity, runs ZKML risk check, and enforces policy bounds.
    '''
    _bypass_addresses: 'set[str]' = set()
    
    def __init__(self = None):
        self._onboarding_cache = { }
        self._load_onboarding()

    
    def check(self, user_address = None, action = None, requested_amount_usd = None, requested_profile = (0, None, None), portfolio_features = ('user_address', 'str', 'action', 'str', 'requested_amount_usd', 'float', 'requested_profile', 'str | None', 'portfolio_features', 'list[int] | None', 'return', 'ConstraintVerdict')):
        """
        Run all constraint checks. Returns ConstraintVerdict.
        If the user hasn't onboarded, verdict.allowed=False unless bypassed.
        """
        addr = user_address.strip().lower()
        violations = []
        timestamp = datetime.utcnow().isoformat()
        onb = self._get_onboarding(addr)
    # WARNING: Decompyle incomplete

    
    def get_user_profile(self = None, user_address = None):
        '''Return the canonical risk profile from onboarding, or None.'''
        addr = user_address.strip().lower()
        onb = self._get_onboarding(addr)
        if onb:
            return onb.risk_profile

    
    def get_constraints(self = None, user_address = None):
        '''Return full parsed onboarding constraints, or None.'''
        addr = user_address.strip().lower()
        return self._get_onboarding(addr)

    
    def reload(self = None):
        '''Reload onboarding state from disk.'''
        self._onboarding_cache.clear()
        self._load_onboarding()

    
    def _load_onboarding(self = None):
        '''Load onboarding state from persistence file.'''
        if not _ONBOARDING_STATE_FILE.exists():
            logger.warning('Onboarding state file not found: %s', _ONBOARDING_STATE_FILE)
            return None
        data = json.loads(_ONBOARDING_STATE_FILE.read_text())
    # WARNING: Decompyle incomplete

    
    def _get_onboarding(self = None, addr = None):
        '''Parse raw onboarding state into typed constraints.'''
        raw = self._onboarding_cache.get(addr)
        if not raw:
            self._load_onboarding()
            raw = self._onboarding_cache.get(addr)
        if not raw:
            return None
        if not raw.get('pending_constraints'):
            raw.get('pending_constraints')
        pending = { }
        risk_tol = pending.get('risk_tolerance', 50)
        max_pos_str = str(pending.get('max_position', '0'))
        max_pos_wei = float(max_pos_str)
        max_pos_eth = max_pos_wei / 1e+18
        eth_usd = _get_cached_eth_usd()
        max_pos_usd = max_pos_eth * eth_usd
        return OnboardingConstraints(max_position_wei = max_pos_str, max_position_usd = max_pos_usd, risk_tolerance = risk_tol if isinstance(risk_tol, int) else 50, risk_profile = tolerance_to_profile(risk_tol if isinstance(risk_tol, int) else 50), session_duration_hours = pending.get('session_duration', 24), claims = pending.get('claims', []), fact_hash = raw.get('fact_hash', ''), identity_commitment = raw.get('identity_commitment', ''), agent_initialized = raw.get('agent_initialized', False), onboarded_at = raw.get('timestamp', 0))
    # WARNING: Decompyle incomplete

    
    def _check_zkml_risk(self = None, features = None, tolerance = None):
        '''Run ZKML risk score model and check against threshold.'''
        RiskScoreModel = RiskScoreModel
        import app.services.zkml_risk_service
        score = RiskScoreModel.compute_risk_score(features)
        return score <= tolerance
    # WARNING: Decompyle incomplete

    
    def _check_vault_policy(self = None, addr = None, amount_usd = None, profile = ('addr', 'str', 'amount_usd', 'float', 'profile', 'str', 'return', 'bool')):
        '''Check operation against vault policy service bounds.'''
        get_vault_policy_service = get_vault_policy_service
        import app.services.vault_policy_service
        svc = get_vault_policy_service()
        policy = svc.get_policy(addr)
        if not policy:
            return True
        exec_policy = policy.get('execution_policy', { })
        session_max = exec_policy.get('session_max_notional_usd', 0)
        if session_max > 0 and amount_usd > session_max:
            logger.info('Policy violation: amount $%.2f > session_max $%.2f', amount_usd, session_max)
            return False
        return True
    # WARNING: Decompyle incomplete

    
    def _permissive_verdict(self = None, addr = None, profile = None, timestamp = ('addr', 'str', 'profile', 'str', 'timestamp', 'str', 'return', 'ConstraintVerdict')):
        '''Return permissive verdict for dev/bypass addresses.'''
        return ConstraintVerdict(allowed = True, user_address = addr, risk_profile = profile, risk_tolerance = profile_to_tolerance(profile), max_position_usd = 999999, session_valid = True, identity_verified = False, zkml_risk_ok = True, policy_enforced = False, violations = [], attestation_hash = self._hash_verdict(addr, True, [], timestamp), timestamp = timestamp)

    _hash_verdict = (lambda addr = None, allowed = None, violations = staticmethod, timestamp = ('addr', 'str', 'allowed', 'bool', 'violations', 'list[str]', 'timestamp', 'str', 'return', 'str'): payload = json.dumps({
'addr': addr,
'allowed': allowed,
'violations': violations,
'ts': timestamp }, sort_keys = True)'0x' + hashlib.sha256(payload.encode()).hexdigest()[:48])()

_gate_instance: 'ConstraintGate | None' = None

def get_constraint_gate():
    pass
# WARNING: Decompyle incomplete

