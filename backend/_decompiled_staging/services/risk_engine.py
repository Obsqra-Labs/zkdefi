# Source Generated with Decompyle++
# File: risk_engine.cpython-312.pyc (Python 3.12)

'''
Risk Profile Engine — scores user risk tolerance and returns allocation bounds.

Inputs:  risk_level (1-10), optional time_horizon, optional behavior history
Outputs: risk_score, allocation bounds (% deposit-like vs % LP), safe protocols list

No mocks. Deterministic scoring logic. Used by ai_allocation.py to drive decisions.
'''
from __future__ import annotations
import logging
from dataclasses import dataclass, asdict
from typing import Any
logger = logging.getLogger(__name__)
AllocationBounds = <NODE:12>()
RiskAssessment = <NODE:12>()
_TIERS: 'list[dict[str, Any]]' = [
    {
        'label': 'conservative',
        'max_level': 3,
        'bounds': AllocationBounds(min_deposit_pct = 0.7, max_deposit_pct = 1, min_lp_pct = 0, max_lp_pct = 0.3),
        'safe_protocols': [
            'ekubo_stable_lp'],
        'max_single_pool_pct': 0.8 },
    {
        'label': 'balanced',
        'max_level': 6,
        'bounds': AllocationBounds(min_deposit_pct = 0.3, max_deposit_pct = 0.7, min_lp_pct = 0.3, max_lp_pct = 0.7),
        'safe_protocols': [
            'ekubo_stable_lp',
            'ekubo_volatile_lp'],
        'max_single_pool_pct': 0.6 },
    {
        'label': 'aggressive',
        'max_level': 10,
        'bounds': AllocationBounds(min_deposit_pct = 0, max_deposit_pct = 0.4, min_lp_pct = 0.6, max_lp_pct = 1),
        'safe_protocols': [
            'ekubo_stable_lp',
            'ekubo_volatile_lp',
            'ekubo_concentrated_lp'],
        'max_single_pool_pct': 0.5 }]

def _tier_for_level(level = None):
    for tier in _TIERS:
        if not level <= tier['max_level']:
            continue
        
        return _TIERS, tier
    return _TIERS[-1]


def score_risk(risk_level = None, time_horizon_days = None, past_decisions = None):
    """
    Score a user's risk tolerance and return allocation constraints.

    Args:
        risk_level:        User-selected 1-10.
        time_horizon_days: Planned holding period in days.
        past_decisions:    Optional list of previous allocation records
                           (for behaviour-adjusted scoring — future).

    Returns:
        RiskAssessment with bounds, safe protocols, concentration cap.
    """
    level = max(1, min(10, int(risk_level)))
    tier = _tier_for_level(level)
    base_score = level / 10
    if time_horizon_days < 30:
        base_score = max(0.05, base_score - 0.1)
    elif time_horizon_days > 180:
        base_score = min(1, base_score + 0.05)
    behaviour_adj = 0
    if past_decisions:
        total = len(past_decisions)
        early_exits = (lambda .0: pass# WARNING: Decompyle incomplete
)(past_decisions())
        proof_failures = (lambda .0: pass# WARNING: Decompyle incomplete
)(past_decisions())
        gate_blocks = (lambda .0: pass# WARNING: Decompyle incomplete
)(past_decisions())
        slashes = (lambda .0: pass# WARNING: Decompyle incomplete
)(past_decisions())
        if total > 0:
            early_exit_rate = early_exits / total
            if early_exit_rate > 0.3:
                behaviour_adj -= 0.05
            elif early_exit_rate > 0.5:
                behaviour_adj -= 0.1
            if proof_failures > 0:
                behaviour_adj -= min(0.05, proof_failures * 0.01)
            if slashes > 0:
                behaviour_adj -= min(0.15, slashes * 0.05)
            if gate_blocks > total * 0.2:
                behaviour_adj -= 0.03
        successful_proofs = (lambda .0: pass# WARNING: Decompyle incomplete
)(past_decisions())
        if successful_proofs > 10:
            behaviour_adj += 0.02
    score = max(0, min(1, round(base_score + behaviour_adj, 4)))
    reasoning_parts = [
        f'''Risk level {level}/10 → base score {base_score:.2f}.''',
        f'''Time horizon {time_horizon_days}d.''']
    if behaviour_adj:
        reasoning_parts.append(f'''Behaviour adjustment: {behaviour_adj:+.2f}.''')
    reasoning_parts.append(f'''Tier: {tier['label']}. LP range [{tier['bounds'].min_lp_pct * 100:.0f}%-{tier['bounds'].max_lp_pct * 100:.0f}%].''')
    return RiskAssessment(risk_level = level, risk_score = score, label = tier['label'], bounds = tier['bounds'], safe_protocols = list(tier['safe_protocols']), max_single_pool_pct = tier['max_single_pool_pct'], reasoning = ' '.join(reasoning_parts))


def label_from_string(profile = None):
    """Map 'conservative'/'balanced'/'aggressive' to a representative risk_level."""
    if not profile:
        profile
    p = ''.strip().lower()
    if p in ('conservative', 'low'):
        return 2
    if p in ('aggressive', 'high'):
        return 8
    return 5


async def score_risk_with_history(user_address = None, risk_level = None, time_horizon_days = None):
    '''
    Enhanced risk scoring that fetches real behavioral history from the decision store.

    Falls back to basic score_risk() if the database is unavailable.
    '''
    pass
# WARNING: Decompyle incomplete

