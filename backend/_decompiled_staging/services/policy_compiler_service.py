# Source Generated with Decompyle++
# File: policy_compiler_service.cpython-312.pyc (Python 3.12)

"""Policy compiler service for Vault OS execution routing.

Architecture (see docs/plans/VAULT_AND_PRIVACY_ARCHITECTURE.md):
- execution_path: Privacy semantics for the same logical user vault (Track A).
  Values like full_privacy_pool, shielded_pool, hashed_withdraw_pool select *how*
  deposit/withdraw are proven (proof type, relayer), not which pool contract.
- shared_pool_id: When set, effective policy is computed for a shared pool (Track B)
  that the AI can manage; otherwise the user's personal vault profile (Track A) applies.
"""
from __future__ import annotations
import copy
from typing import Any
from app.services.shared_pool_service import get_shared_pool_service
from app.services.vault_policy_service import get_vault_policy_service
_PATH_PROOFS = {
    'shielded_pool': [
        'shielded_balance_proof'],
    'full_privacy_pool': [
        'privacy_merkle_proof',
        'nullifier_proof'],
    'hashed_withdraw_pool': [
        'hashed_claim_proof',
        'nullifier_proof'],
    'internal_ledger': [
        'internal_ledger_proof'] }

def _normalize_text(value = None):
    if not value:
        value
    return str('').strip().lower()


def _normalize_token(value = None):
    raw = _normalize_text(value)
    if not raw:
        return ''
    if raw.startswith('0x'):
        body = raw[2:].lstrip('0')
        if not body:
            body
        return f'''0x{'0'}'''


class PolicyCompilerService:
    
    def __init__(self = None):
        self.vault_policy_service = get_vault_policy_service()
        self.shared_pool_service = get_shared_pool_service()

    
    def compile(self = None, request = None):
        if not request.get('user_address'):
            request.get('user_address')
        user_address = str('').strip()
        if not request.get('action_type'):
            request.get('action_type')
        action_type = _normalize_text('deposit')
        if not request.get('execution_intent'):
            request.get('execution_intent')
        execution_intent = _normalize_text('manual_wallet')
        wallet_connected = bool(request.get('wallet_connected', False))
        shared_pool_id = _normalize_text(request.get('shared_pool_id'))
        if not request.get('member_address'):
            request.get('member_address')
        member_address = str(user_address).strip()
        context = request.get('context') if isinstance(request.get('context'), dict) else { }
        if not member_address:
            member_address
        base_policy = self.vault_policy_service.get_policy(user_address, create_if_missing = True)
        if not base_policy:
            raise ValueError('unable to load policy profile')
        effective_policy = copy.deepcopy(base_policy)
        if shared_pool_id:
            if not member_address:
                member_address
            effective_policy = self.shared_pool_service.compute_effective_policy(shared_pool_id, effective_policy, member_address = user_address)
        execution_path = self._resolve_privacy_path(effective_policy)
        legacy_preset_label = self._legacy_preset_label(effective_policy)
        blocking_reasons = []
        warnings = []
        strategy_allowed = self._action_allowed_by_strategy(action_type, effective_policy)
        if not strategy_allowed:
            blocking_reasons.append('action_not_enabled_by_strategy_permissions')
        if effective_policy.get('execution_policy', { }).get('emergency_pause'):
            blocking_reasons.append('emergency_pause_enabled')
        token_in = _normalize_token(context.get('token_in') if isinstance(context, dict) else '')
        token_out = _normalize_token(context.get('token_out') if isinstance(context, dict) else '')
        venue = _normalize_text(context.get('venue') if isinstance(context, dict) else '')
        if action_type in frozenset({'swap', 'deploy', 'lp_add', 'lp_remove'}):
            if not venue:
                warnings.append('missing_venue_context')
            if not action_type in frozenset({'swap', 'lp_add', 'lp_remove'}) and token_in and token_out:
                warnings.append('missing_token_context')
    # WARNING: Decompyle incomplete

    _action_allowed_by_strategy = (lambda action_type = None, policy = None: if action_type in frozenset({'deposit', 'withdraw', 'privacy_deposit', 'privacy_withdraw'}):
Trueif not policy.get('strategy_permissions'):
policy.get('strategy_permissions')strategy = { }enable_lp = bool(strategy.get('enable_lp', False))enable_rotation = bool(strategy.get('enable_rotation', False))enable_rebalance = bool(strategy.get('enable_rebalance', False))enable_dca = bool(strategy.get('enable_dca', False))if action_type in frozenset({'lp_add', 'lp_remove'}):
enable_lpif None in frozenset({'swap', 'rotate'}):
if not enable_rotation:
enable_rotationif not enable_rebalance:
enable_rebalanceenable_dcaif None in frozenset({'deploy', 'rebalance'}):
if not enable_rebalance:
enable_rebalanceif not enable_lp:
enable_lpenable_rotation)()
    _resolve_privacy_path = (lambda policy = None: if not policy.get('privacy_policy'):
policy.get('privacy_policy')privacy = { }settlement = _normalize_text(privacy.get('settlement_mode') if isinstance(privacy, dict) else '')hide_amounts = bool(privacy.get('hide_amounts', False))hide_recipient = bool(privacy.get('hide_recipient', False))if settlement == 'internal_ledger':
'internal_ledger'if settlement == 'hashed_claim':
'hashed_withdraw_pool'if hide_amounts and hide_recipient:
'full_privacy_pool'if hide_amounts:
'shielded_pool''shielded_pool')()
    _legacy_preset_label = (lambda policy = None: if not policy.get('privacy_policy'):
policy.get('privacy_policy')preset = _normalize_text({ }.get('preset'))if preset in frozenset({'unlinkable_basic', 'preset_unlinkable_basic'}):
'pool_a'if preset in frozenset({'hidden_flow', 'preset_hidden_flow'}):
'pool_b'if preset in frozenset({'hashed_claims', 'preset_hashed_claims'}):
'pool_d''none')()
    _requires_relayer = (lambda execution_path = None, policy = None: if not policy.get('privacy_policy'):
policy.get('privacy_policy')privacy = { }relay_mode = _normalize_text(privacy.get('relay_mode') if isinstance(privacy, dict) else '')if relay_mode == 'required':
Trueif execution_path in frozenset({'full_privacy_pool', 'hashed_withdraw_pool'}) and relay_mode in frozenset({'optional', 'required'}):
TrueFalse)()
    _gate_matrix = (lambda execution_intent = None, wallet_connected = None: if execution_intent == 'manual_wallet' and wallet_connected:
(False, True)if execution_intent in frozenset({'session', 'autonomous'}):
(True, False)(True, False))()

_policy_compiler_service: 'PolicyCompilerService | None' = None

def get_policy_compiler_service():
    pass
# WARNING: Decompyle incomplete

