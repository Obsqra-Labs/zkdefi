# Source Generated with Decompyle++
# File: vault_policy_service.cpython-312.pyc (Python 3.12)

'''Vault policy service (file-backed, deterministic schema).'''
from __future__ import annotations
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
DATA_DIR.mkdir(parents = True, exist_ok = True)
POLICY_FILE = DATA_DIR / 'vault_policies.json'

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _normalize_address(value = None):
    if not value:
        value
    raw = ''.strip().lower()
    if not raw:
        return ''
    without = raw[2:] if raw.startswith('0x') else raw
    stripped = without.lstrip('0')
    if not stripped:
        stripped
    return f'''0x{'0'}'''


def _deep_merge(base = None, patch = None):
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
            continue
        out[key] = copy.deepcopy(value)
    return out


def _read_all():
    if not POLICY_FILE.exists():
        return { }
    payload = json.loads(POLICY_FILE.read_text(encoding = 'utf-8'))
# WARNING: Decompyle incomplete


def _write_all(policies = None):
    POLICY_FILE.parent.mkdir(parents = True, exist_ok = True)
    POLICY_FILE.write_text(json.dumps(policies, indent = 2, sort_keys = True), encoding = 'utf-8')


def _profile_id_for(user_address = None, mode = None):
    h = hashlib.sha256(f'''{user_address}:{mode}'''.encode('utf-8')).hexdigest()[:24]
    return f'''vpol_{h}'''


def _default_risk_budget():
    return {
        'max_drawdown_bps': 1500,
        'max_daily_turnover_bps': 2000,
        'max_position_pct': 35 }


def _default_strategy_permissions():
    return {
        'enable_dca': True,
        'enable_lp': True,
        'enable_rotation': True,
        'enable_rebalance': True }


def _default_execution_policy():
    return {
        'mode': 'assist',
        'session_max_notional_usd': 500,
        'session_duration_hours': 24,
        'emergency_pause': False,
        'cooldown_seconds': 300,
        'allowed_strategies': [],
        'min_expected_edge_bps': 0,
        'max_oracle_age_sec': 120,
        'max_daily_notional_wei': 0,
        'max_trade_notional_wei': 0 }


def _default_disclosure_policy():
    return {
        'allow_balance_proof': True,
        'allow_risk_proof': True,
        'allow_performance_proof': False }


def _default_privacy_policy(preset = None):
    if preset == 'hidden_flow':
        return {
            'preset': 'hidden_flow',
            'hide_amounts': True,
            'hide_recipient': True,
            'hide_sender': True,
            'use_nullifier': True,
            'settlement_mode': 'public_transfer',
            'relay_mode': 'required',
            'max_relayer_delay_seconds': 600 }
    if None == 'hashed_claims':
        return {
            'preset': 'hashed_claims',
            'hide_amounts': True,
            'hide_recipient': True,
            'hide_sender': True,
            'use_nullifier': True,
            'settlement_mode': 'hashed_claim',
            'relay_mode': 'required',
            'max_relayer_delay_seconds': 1200 }
    return {
        'preset': None,
        'hide_amounts': True,
        'hide_recipient': False,
        'hide_sender': True,
        'use_nullifier': True,
        'settlement_mode': 'public_transfer',
        'relay_mode': 'optional',
        'max_relayer_delay_seconds': 1200 }


class VaultPolicyService:
    
    def get_policy(self = None, user_address = None, create_if_missing = None):
        addr = _normalize_address(user_address)
        if not addr:
            return None
        policies = _read_all()
        found = policies.get(addr)
        if found:
            result = copy.deepcopy(found)
            ep = result.get('execution_policy', { })
            defaults = _default_execution_policy()
            changed = False
            for key, default_val in defaults.items():
                if not key not in ep:
                    continue
                ep[key] = default_val
                changed = True
            if changed:
                result['execution_policy'] = ep
                policies[addr] = result
                _write_all(policies)
            return result
        if not None:
            return None
        created = self._build_default_policy(addr)
        policies[addr] = created
        _write_all(policies)
        return copy.deepcopy(created)

    
    def put_policy(self = None, user_address = None, patch = None):
        addr = _normalize_address(user_address)
        if not addr:
            raise ValueError('user_address is required')
        if not self.get_policy(addr, create_if_missing = True):
            self.get_policy(addr, create_if_missing = True)
        current = self._build_default_policy(addr)
        if not patch:
            patch
        cleaned_patch = copy.deepcopy({ })
        cleaned_patch.pop('profile_id', None)
        cleaned_patch.pop('user_address', None)
        cleaned_patch.pop('updated_at', None)
        merged = _deep_merge(current, cleaned_patch)
        if not current.get('profile_id'):
            current.get('profile_id')
        merged['profile_id'] = _profile_id_for(addr, merged.get('mode', 'personal'))
        merged['user_address'] = addr
        merged['mode'] = 'shared_member' if merged.get('mode') == 'shared_member' else 'personal'
        merged['updated_at'] = _now_iso()
        policies = _read_all()
        policies[addr] = merged
        _write_all(policies)
        return copy.deepcopy(merged)

    
    def ensure_default_policy(self = None, user_address = None, *, mode, onboarding_hints):
        addr = _normalize_address(user_address)
        if not addr:
            raise ValueError('user_address is required')
        existing = self.get_policy(addr, create_if_missing = False)
        if existing:
            return existing
        policy = None._build_default_policy(addr, mode = mode)
        if onboarding_hints:
            risk_tolerance = onboarding_hints.get('risk_tolerance')
            max_position_wei = onboarding_hints.get('max_position')
            session_duration = onboarding_hints.get('session_duration')
            if isinstance(risk_tolerance, int):
                if risk_tolerance <= 35:
                    policy['risk_budget']['max_drawdown_bps'] = 900
                    policy['risk_budget']['max_daily_turnover_bps'] = 1200
                    policy['strategy_permissions']['enable_rotation'] = False
                elif risk_tolerance >= 65:
                    policy['risk_budget']['max_drawdown_bps'] = 2500
                    policy['risk_budget']['max_daily_turnover_bps'] = 4000
            if isinstance(session_duration, int) and session_duration > 0:
                policy['execution_policy']['session_duration_hours'] = min(session_duration, 168)
            if isinstance(max_position_wei, str) and max_position_wei.isdigit():
                max_position_eth = int(max_position_wei) / float(0xDE0B6B3A7640000)
                session_max_notional = max(100, min(25000, max_position_eth * 2500))
                policy['execution_policy']['session_max_notional_usd'] = round(session_max_notional, 2)
        policies = _read_all()
        policies[addr] = policy
        _write_all(policies)
        return copy.deepcopy(policy)
    # WARNING: Decompyle incomplete

    
    def upsert_from_onboarding(self = None, user_address = None, onboarding_hints = None):
        """
        Apply onboarding hints to a user's policy even if it already exists.
        This keeps onboarding as a live source for risk/session defaults.
        """
        addr = _normalize_address(user_address)
        if not addr:
            raise ValueError('user_address is required')
        if not self.get_policy(addr, create_if_missing = True):
            self.get_policy(addr, create_if_missing = True)
        current = self._build_default_policy(addr)
        if not onboarding_hints:
            return current
        patch = {
            'mode': None,
            'risk_budget': { },
            'execution_policy': { },
            'strategy_permissions': { } }
        risk_tolerance = onboarding_hints.get('risk_tolerance')
        session_duration = onboarding_hints.get('session_duration')
        max_position_wei = onboarding_hints.get('max_position')
        if isinstance(risk_tolerance, int):
            if risk_tolerance <= 35:
                patch['risk_budget']['max_drawdown_bps'] = 900
                patch['risk_budget']['max_daily_turnover_bps'] = 1200
                patch['strategy_permissions']['enable_rotation'] = False
            elif risk_tolerance >= 65:
                patch['risk_budget']['max_drawdown_bps'] = 2500
                patch['risk_budget']['max_daily_turnover_bps'] = 4000
                patch['strategy_permissions']['enable_rotation'] = True
        if isinstance(session_duration, int) and session_duration > 0:
            patch['execution_policy']['session_duration_hours'] = min(session_duration, 168)
        if isinstance(max_position_wei, str) and max_position_wei.isdigit():
            max_position_eth = int(max_position_wei) / float(0xDE0B6B3A7640000)
            session_max_notional = max(100, min(25000, max_position_eth * 2500))
            patch['execution_policy']['session_max_notional_usd'] = round(session_max_notional, 2)
        execution_mode = onboarding_hints.get('execution_mode')
        if isinstance(execution_mode, str) and execution_mode in ('assist', 'autonomous', 'monitor'):
            patch['execution_policy']['mode'] = execution_mode
        allowed_strategies = onboarding_hints.get('allowed_strategies')
        if isinstance(allowed_strategies, list):
            patch['execution_policy']['allowed_strategies'] = allowed_strategies
        min_edge = onboarding_hints.get('min_expected_edge_bps')
        if isinstance(min_edge, int) and min_edge > 0:
            patch['execution_policy']['min_expected_edge_bps'] = min_edge
        max_oracle_age = onboarding_hints.get('max_oracle_age_sec')
        if isinstance(max_oracle_age, int) and max_oracle_age > 0:
            patch['execution_policy']['max_oracle_age_sec'] = max_oracle_age
        max_daily = onboarding_hints.get('max_daily_notional')
        if isinstance(max_daily, str) and max_daily.isdigit():
            patch['execution_policy']['max_daily_notional_wei'] = int(max_daily)
        max_trade = onboarding_hints.get('max_trade_notional')
        if isinstance(max_trade, str) and max_trade.isdigit():
            patch['execution_policy']['max_trade_notional_wei'] = int(max_trade)
    # WARNING: Decompyle incomplete

    
    def delete_policy(self = None, user_address = None):
        addr = _normalize_address(user_address)
        if not addr:
            return False
        policies = _read_all()
        existed = addr in policies
        if existed:
            del policies[addr]
            _write_all(policies)
        return existed

    policy_hash = (lambda policy = None: encoded = json.dumps(policy, sort_keys = True, separators = (',', ':')).encode('utf-8')'0x' + hashlib.sha256(encoded).hexdigest())()
    
    def _build_default_policy(self = None, user_address = None, mode = None):
        normalized = _normalize_address(user_address)
        selected_mode = 'shared_member' if mode == 'shared_member' else 'personal'
        return {
            'profile_id': _profile_id_for(normalized, selected_mode),
            'user_address': normalized,
            'mode': selected_mode,
            'risk_budget': _default_risk_budget(),
            'strategy_permissions': _default_strategy_permissions(),
            'venue_allowlist': [
                'ekubo',
                'avnu'],
            'token_allowlist': [],
            'execution_policy': _default_execution_policy(),
            'disclosure_policy': _default_disclosure_policy(),
            'privacy_policy': _default_privacy_policy('hidden_flow' if selected_mode == 'shared_member' else 'unlinkable_basic'),
            'updated_at': _now_iso() }


_vault_policy_service: 'VaultPolicyService | None' = None

def get_vault_policy_service():
    pass
# WARNING: Decompyle incomplete

