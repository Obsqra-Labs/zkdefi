# Source Generated with Decompyle++
# File: risk_profile.cpython-312.pyc (Python 3.12)

'''
Risk Profile API — single composable bundle for profile UI and gating.

GET /risk_profile/{address} composes:
- reputation user
- risk_passport user
- onboarding status
- linked_addresses
- compliance profiles (summary)
- session_keys list (summary)

GET /risk_profile/v2/{address} adds canonical trust decisions used by relayer,
policy preview, lending, and UI explainability.
'''
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
import asyncio
import httpx
from fastapi import APIRouter, Request
from app.services.profile_decision_service import get_profile_decision_service
from app.services.credit_line_service import compute_predictive_credit_line
router = APIRouter(prefix = '/risk_profile', tags = [
    'risk_profile'])

async def _fetch(client = None, base = None, path = None):
    '''GET path under base; return (parsed json or None, ok).'''
    pass
# WARNING: Decompyle incomplete


def _resolve_base(request = None):
    base = str(request.base_url).rstrip('/')
    if base.startswith('http'):
        return base
    (host, port) = None.scope.get('server', ('localhost', 8000))
    root_path = request.scope.get('root_path', '')
    return f'''http://{host}:{port}{root_path}'''.rstrip('/')


async def _build_bundle(address = None, request = None):
    pass
# WARNING: Decompyle incomplete

get_risk_profile = (lambda address = None, request = None, format = router.get('/{address}'): pass# WARNING: Decompyle incomplete
)()
get_risk_profile_v2 = (lambda address = None, request = None: pass# WARNING: Decompyle incomplete
)()

def _to_erc8004(bundle = None):
    '''Project Risk Profile bundle to ERC-8004 portable identity shape.'''
    if not bundle.get('reputation'):
        bundle.get('reputation')
    rep = { }
    if not bundle.get('risk_passport'):
        bundle.get('risk_passport')
    passport = { }
    if not bundle.get('onboarding'):
        bundle.get('onboarding')
    onboarding = { }
    if not bundle.get('session_summary'):
        bundle.get('session_summary')
    sessions = { }
    if not bundle.get('dual_wallet_session'):
        bundle.get('dual_wallet_session')
    dual_session = { }
    if not bundle.get('compliance_summary'):
        bundle.get('compliance_summary')
    compliance = { }
    tier = rep.get('tier', 0)
    tier_name = rep.get('tier_name', 'Strict')
    letter = passport.get('letter_rating', 'D')
    composite = passport.get('composite_score', 0)
    credit_tier = passport.get('credit_tier')
    credit_score = passport.get('credit_score')
    identity_card = {
        'agent_name': 'zkdefi_agent',
        'reputation_score': composite,
        'privacy_tier': tier_name,
        'tier': tier,
        'letter_rating': letter,
        'credit_tier': credit_tier,
        'credit_score': credit_score }
    reputation_slice = {
        'tier': tier,
        'tier_name': tier_name,
        'tenure_days': rep.get('tenure_days', 0),
        'successful_txns': rep.get('successful_txns', 0),
        'collateral_eth': rep.get('collateral_eth', 0),
        'total_volume_eth': rep.get('total_volume_eth', 0) }
    validations = {
        'has_agent': onboarding.get('has_agent', False),
        'fact_hash': onboarding.get('fact_hash'),
        'identity_commitment': onboarding.get('identity_commitment') }
    session_summary_slice = {
        'active_count': sessions.get('active_count', 0),
        'count': sessions.get('count', 0),
        'dual_wallet_active': bool(dual_session.get('active', False)) if isinstance(dual_session, dict) else False }
    disclosure_summary = {
        'profile_count': compliance.get('count', 0) }
    return {
        'identity_card': identity_card,
        'reputation': reputation_slice,
        'validations': validations,
        'session_summary': session_summary_slice,
        'disclosure_summary': disclosure_summary }

