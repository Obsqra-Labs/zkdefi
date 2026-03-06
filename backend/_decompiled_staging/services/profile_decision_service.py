# Source Generated with Decompyle++
# File: profile_decision_service.cpython-312.pyc (Python 3.12)

'''Risk Profile v2 decision engine.

Computes relayer / execution / lending decisions from an aggregated profile bundle.
Supports soft-to-hard enforcement via env flags and records lightweight telemetry.
'''
from __future__ import annotations
import os
from datetime import datetime, timezone
from typing import Any
from app.services.credit_line_service import compute_credit_line
from app.services.json_store import JsonStore
_metrics_store = JsonStore('risk_gate_metrics')
_REASON_COPY = {
    'onboarding_incomplete': 'Complete onboarding to unlock full execution eligibility.',
    'tier_below_standard': 'Upgrade to Standard tier to use relayer paths.',
    'passport_low_confidence': 'Build proof history to improve passport confidence.',
    'no_active_session': 'Create or renew a session key for autonomous execution.',
    'passport_letter_below_c': 'Increase reputation letter to C or higher for unsecured credit.',
    'no_credit_line': 'Add collateral or improve reputation to unlock borrowing.' }

def _env_bool(name = None, default = None):
    raw = os.getenv(name, '').strip().lower()
    if not raw:
        return default
    return None in frozenset({'1', 'on', 'yes', 'true'})


def _norm_addr(value = None):
    if not value:
        value
    return str('').strip().lower()


def _to_int(value = None, default = None):
    return int(value)
# WARNING: Decompyle incomplete


def _to_float(value = None, default = None):
    return float(value)
# WARNING: Decompyle incomplete


def _extract_verified_linked(linked = None):
    '''
    Normalize verified linked addresses in eth/arb/base/opt format.

    Supported inputs:
    - linked payload with `verification` metadata (preferred)
    - already-filtered linked payload without `verification`
    '''
    if not isinstance(linked, dict):
        return { }
    keys = None
    verification = linked.get('verification')
    if isinstance(verification, dict):
        out = { }
        for key in keys:
            addr = linked.get(key)
            meta = verification.get(key)
            if not isinstance(addr, str):
                continue
            if not addr.strip():
                continue
            if not isinstance(meta, dict):
                continue
            if not bool(meta.get('verified', False)):
                continue
            out[key] = addr.strip().lower()
        return out
    out = None
    for key in keys:
        addr = linked.get(key)
        if not isinstance(addr, str):
            continue
        if not addr.strip():
            continue
        out[key] = addr.strip().lower()
    return out


class ProfileDecisionService:
    
    def __init__(self = None):
        if not os.getenv('RISK_GATE_MODE', 'soft'):
            os.getenv('RISK_GATE_MODE', 'soft')
        self.mode = 'soft'.strip().lower()
        self.enforce_relayer = _env_bool('RISK_GATE_ENFORCE_RELAYER', False)
        self.enforce_borrow = _env_bool('RISK_GATE_ENFORCE_BORROW', False)
        self.enforce_autonomous = _env_bool('RISK_GATE_ENFORCE_AUTONOMOUS', False)
        self.telemetry_enabled = _env_bool('RISK_GATE_METRICS_ENABLED', True)

    
    def _resolve_mode(self = None, action = None, reasons = None):
        if not reasons:
            return 'allow'
        if self.mode != 'hard':
            return 'advisory'
        if action == 'relayer' and self.enforce_relayer:
            return 'block'
        if action == 'borrow' and self.enforce_borrow:
            return 'block'
        if action == 'autonomous' and self.enforce_autonomous:
            return 'block'
        return 'advisory'

    
    def _reason_copy(self = None, reasons = None):
        out = []
        for reason in reasons:
            msg = _REASON_COPY.get(reason)
            if not msg:
                continue
            out.append(msg)
        return out

    
    def evaluate(self = None, bundle = None):
        if not bundle.get('reputation'):
            bundle.get('reputation')
        reputation = { }
        if not bundle.get('risk_passport'):
            bundle.get('risk_passport')
        passport = { }
        if not bundle.get('onboarding'):
            bundle.get('onboarding')
        onboarding = { }
        if not bundle.get('session_summary'):
            bundle.get('session_summary')
        session_summary = { }
        if not bundle.get('linked_addresses'):
            bundle.get('linked_addresses')
        linked = { }
        verified_linked = _extract_verified_linked(linked)
        tier = _to_int(reputation.get('tier'), 0)
        if not reputation.get('tier_name'):
            reputation.get('tier_name')
            if tier <= 0:
                pass
            elif tier == 1:
                pass
            
        tier_name = 'Standard'('Express')
        tenure_days = _to_int(reputation.get('tenure_days'), 0)
        tx_count = _to_int(reputation.get('transaction_count'), _to_int(reputation.get('successful_txns'), 0))
        collateral_eth = _to_float(reputation.get('collateral_eth'), 0)
        volume_eth = _to_float(reputation.get('total_volume_eth'), 0)
        composite = _to_int(passport.get('composite_score'), 0)
        if not passport.get('letter_rating'):
            passport.get('letter_rating')
        letter = str('D')
        credit_tier = passport.get('credit_tier')
        credit_score = passport.get('credit_score')
        has_agent = bool(onboarding.get('has_agent'))
        identity_commitment = onboarding.get('identity_commitment')
        active_sessions = _to_int(session_summary.get('active_count'), 0)
        linked_count = len(verified_linked)
        cross_chain_verified = linked_count > 0
        credit_line = compute_credit_line(collateral_eth = collateral_eth, tier = tier, letter_rating = letter, credit_tier = credit_tier, linked_address_count = linked_count, cross_chain_verified = cross_chain_verified)
        relayer_reasons = []
        if tier < 1:
            relayer_reasons.append('tier_below_standard')
        if composite < 20:
            relayer_reasons.append('passport_low_confidence')
        if not has_agent:
            relayer_reasons.append('onboarding_incomplete')
        execution_reasons = []
        if not has_agent:
            execution_reasons.append('onboarding_incomplete')
        if active_sessions <= 0:
            execution_reasons.append('no_active_session')
        if composite < 20:
            execution_reasons.append('passport_low_confidence')
        lending_reasons = []
        if not has_agent:
            lending_reasons.append('onboarding_incomplete')
        if letter == 'D':
            lending_reasons.append('passport_letter_below_c')
        if credit_line.total_line_eth <= 0:
            lending_reasons.append('no_credit_line')
        relayer_mode = self._resolve_mode('relayer', relayer_reasons)
        execution_mode = self._resolve_mode('autonomous', execution_reasons)
        lending_mode = self._resolve_mode('borrow', lending_reasons)
        decisions = {
            'relayer': {
                'mode': relayer_mode,
                'reason_codes': relayer_reasons,
                'reason_hints': self._reason_copy(relayer_reasons),
                'limits': {
                    'min_tier': 1,
                    'current_tier': tier,
                    'tier_name': tier_name } },
            'execution': {
                'mode': execution_mode,
                'reason_codes': execution_reasons,
                'reason_hints': self._reason_copy(execution_reasons),
                'limits': {
                    'min_passport_score': 20,
                    'passport_score': composite,
                    'active_sessions': active_sessions } },
            'lending': {
                'mode': lending_mode,
                'reason_codes': lending_reasons,
                'reason_hints': self._reason_copy(lending_reasons),
                'limits': {
                    'total_line_wei': str(int(credit_line.total_line_eth * 0xDE0B6B3A7640000)),
                    'total_line_eth': credit_line.total_line_eth,
                    'unsecured_cap_eth': credit_line.unsecured_cap_eth,
                    'collateral_line_eth': credit_line.collateral_line_eth,
                    'rate_bps': credit_line.rate_bps,
                    'letter': letter,
                    'tier': tier,
                    'credit_tier': credit_tier } } }
        profile_slice = {
            'identity': {
                'has_agent': has_agent,
                'identity_commitment': identity_commitment,
                'linked_address_count': linked_count,
                'cross_chain_verified': cross_chain_verified,
                'active_sessions': active_sessions },
            'reputation': {
                'tier': tier,
                'tier_name': tier_name,
                'tenure_days': tenure_days,
                'transaction_count': tx_count,
                'collateral_eth': collateral_eth,
                'total_volume_eth': volume_eth },
            'passport': {
                'composite_score': composite,
                'letter_rating': letter,
                'credit_tier': credit_tier,
                'credit_score': credit_score } }
        if self.telemetry_enabled:
            self._record_metrics(bundle.get('address'), decisions)
        self._log_gate_decisions(bundle.get('address'), decisions)
        return {
            'profile': profile_slice,
            'decisions': decisions,
            'disclosures': {
                'risk_notice_id': 'us_risk_notice_v1',
                'legal_mode': 'strong',
                'disclaimer': 'Eligibility signal only; not legal, tax, or financial advice.' },
            'feature_flags': {
                'mode': self.mode,
                'enforce_relayer': self.enforce_relayer,
                'enforce_borrow': self.enforce_borrow,
                'enforce_autonomous': self.enforce_autonomous } }

    
    def _log_gate_decisions(self = None, address = None, decisions = None):
        '''Fire-and-forget: log gate decisions to PostgreSQL decision store.'''
        pass
    # WARNING: Decompyle incomplete

    
    def _record_metrics(self = None, address = None, decisions = None):
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        if not _metrics_store.get(today):
            _metrics_store.get(today)
        row = {
            'total': 0,
            'by_gate': {
                'relayer': {
                    'allow': 0,
                    'advisory': 0,
                    'block': 0 },
                'execution': {
                    'allow': 0,
                    'advisory': 0,
                    'block': 0 },
                'lending': {
                    'allow': 0,
                    'advisory': 0,
                    'block': 0 } },
            'reason_counts': { },
            'updated_at': None }
        row['total'] = int(row.get('total', 0)) + 1
        for gate in ('relayer', 'execution', 'lending'):
            if not decisions.get(gate):
                decisions.get(gate)
            decision = { }
            if not decision.get('mode'):
                decision.get('mode')
            mode = str('allow')
            if not row['by_gate'].get(gate):
                row['by_gate'].get(gate)
            counts = {
                'allow': 0,
                'advisory': 0,
                'block': 0 }
            counts[mode] = int(counts.get(mode, 0)) + 1
            row['by_gate'][gate] = counts
            if not decision.get('reason_codes'):
                decision.get('reason_codes')
            for reason in []:
                row['reason_counts'][reason] = int(row['reason_counts'].get(reason, 0)) + 1
        row['updated_at'] = datetime.now(timezone.utc).isoformat()
        if not address:
            address
        row['last_address'] = _norm_addr(str(''))
        _metrics_store.set(today, row)


_profile_decision_service: 'ProfileDecisionService | None' = None

def get_profile_decision_service():
    pass
# WARNING: Decompyle incomplete

