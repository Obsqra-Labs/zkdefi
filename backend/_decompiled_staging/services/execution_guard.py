# Source Generated with Decompyle++
# File: execution_guard.cpython-312.pyc (Python 3.12)

"""Unified pre-transaction execution guard.

Every path that writes to chain — rebalancer, vault_execute, privacy orchestrator,
strategy workers — calls ``check(intent)`` before signing.  The guard loads the
user's VaultPolicy, runs 7 deterministic checks, and returns a ``GuardResult``.

No external I/O beyond reading the JSON policy file.

Gating from Risk Profile: see docs/GATING_FROM_PROFILE.md. Policy can optionally
be validated or derived from the Risk Profile bundle when needed.
"""
from __future__ import annotations
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from app.models.action_intent import ActionIntent, GuardResult
from app.services.vault_policy_service import VaultPolicyService, get_vault_policy_service
_daily_notional: 'Dict[str, Dict[str, int]]' = defaultdict((lambda : {
'date': '',
'total': 0 }))
_last_exec_ts: 'Dict[str, float]' = { }

def _today_str():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _reset_if_new_day(user = None):
    today = _today_str()
    entry = _daily_notional[user]
    if entry['date'] != today:
        entry['date'] = today
        entry['total'] = 0
        return None


def check(intent = None, *, policy_svc):
    """Run all guard checks against the user's active VaultPolicy.

    Returns ``GuardResult.allowed == True`` only when *every* check passes.
    """
    if not policy_svc:
        policy_svc
    svc = get_vault_policy_service()
    policy = svc.get_policy(intent.user_address, create_if_missing = True)
    if not policy:
        return GuardResult(allowed = False, reason = 'no_policy_found', checks = { })
    p_hash = None.policy_hash(policy)
    checks = { }
    ep = policy.get('execution_policy', { })
    paused = bool(ep.get('emergency_pause', False))
    checks['emergency_pause'] = not paused
    if paused:
        return GuardResult(allowed = False, reason = 'emergency_pause_active', policy_hash = p_hash, checks = checks)
    sp = None.get('strategy_permissions', { })
    strategy_map = {
        'lp_recenter': 'enable_lp',
        'limit_grid': 'enable_lp',
        'rebalance': 'enable_rebalance',
        'dca': 'enable_dca',
        'rotation': 'enable_rotation',
        'manual': None }
    perm_key = strategy_map.get(intent.strategy)
# WARNING: Decompyle incomplete


def record_execution(intent = None):
    '''Call *after* a successful on-chain execution to update trackers.'''
    if not intent.user_address:
        intent.user_address
    user = ''.strip().lower()
    _last_exec_ts[user] = time.time()
    _reset_if_new_day(user)


def get_guard_status(user_address = None):
    '''Return current guard state for a user (for dashboard / debug).'''
    if not user_address:
        user_address
    user = ''.strip().lower()
    _reset_if_new_day(user)
    svc = get_vault_policy_service()
    policy = svc.get_policy(user_address, create_if_missing = False)
    if not policy:
        policy
    ep = { }.get('execution_policy', { })
    if policy:
        return {
            'user_address': user,
            'emergency_pause': ep.get('emergency_pause', False),
            'cooldown_seconds': ep.get('cooldown_seconds', 300),
            'last_exec_ts': _last_exec_ts.get(user),
            'daily_notional_spent_wei': _daily_notional[user]['total'],
            'daily_notional_limit_wei': ep.get('max_daily_notional_wei', 0),
            'policy_hash': VaultPolicyService.policy_hash(policy) }
    return {
        'user_address': None,
        'emergency_pause': user,
        'cooldown_seconds': ep.get('emergency_pause', False),
        'last_exec_ts': ep.get('cooldown_seconds', 300),
        'daily_notional_spent_wei': _last_exec_ts.get(user),
        'daily_notional_limit_wei': _daily_notional[user]['total'],
        'policy_hash': ep.get('max_daily_notional_wei', 0) }

