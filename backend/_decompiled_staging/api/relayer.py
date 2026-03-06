# Source Generated with Decompyle++
# File: relayer.cpython-312.pyc (Python 3.12)

'''
Relayer API and queue state helpers.

Supports:
- Tier-2 relayed withdraw queue
- Tier-3 relayed deposit queue
- Tier-2H claim payout queue
- Internal ledger withdraw queue

Also exposes helper functions used by `app.services.relayer_runner`.
'''
from __future__ import annotations
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional
import httpx
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field
from app.services.ledger_service import get_ledger_service
router = APIRouter(prefix = '/relayer', tags = [
    'relayer'])
_STATE_FILE = Path(__file__).resolve().parent.parent.parent / 'data' / 'relayer_state.json'
_STATE_LOCK = threading.RLock()
_STATE: 'dict[str, Any]' = { }

def _norm_addr(addr = None):
    if not addr:
        addr
    text = str('').strip()
    if text.startswith(('0x', '0X')):
        return hex(int(text, 16)).lower()
    return None(int(text)).lower()
# WARNING: Decompyle incomplete


def _default_state():
    return {
        'relay_queue': { },
        'deposit_queue': { },
        'claim_queue': { },
        'ledger_withdraw_queue': { },
        'wallet_payout_queue': { },
        'next_request_id': 1,
        'next_deposit_id': 1,
        'next_claim_id': 1,
        'next_withdraw_id': 1,
        'next_wallet_payout_id': 1 }


def _normalize_state(data = None):
    state = _default_state()
    for key in ('relay_queue', 'deposit_queue', 'claim_queue', 'ledger_withdraw_queue', 'wallet_payout_queue'):
        value = data.get(key, { })
        if not isinstance(value, dict):
            continue
        state[key] = value
    for key in ('next_request_id', 'next_deposit_id', 'next_claim_id', 'next_withdraw_id', 'next_wallet_payout_id'):
        raw = data.get(key, state[key])
        parsed = int(raw)
        state[key] = parsed if parsed > 0 else state[key]
    return state
# WARNING: Decompyle incomplete


def _atomic_write_json(path = None, payload = None):
    path.parent.mkdir(parents = True, exist_ok = True)
    (fd, tmp_path) = tempfile.mkstemp(prefix = 'relayer_state_', suffix = '.json', dir = str(path.parent))
# WARNING: Decompyle incomplete


def reload_state():
    '''Reload queue state from disk.'''
    pass
# WARNING: Decompyle incomplete


def _save_state_locked():
    _atomic_write_json(_STATE_FILE, _STATE)


def _queue_pending(entry = None):
    if not entry.get('executed', False):
        not entry.get('executed', False)
    return not entry.get('cancelled', False)


def _queue_ready(entry = None):
    if not _queue_pending(entry):
        return False
    if not entry.get('ready_time', 0):
        entry.get('ready_time', 0)
    ready_time = int(0)
    return int(time.time()) >= ready_time


def _sorted_ready(queue = None, limit = None):
    pass
# WARNING: Decompyle incomplete


def get_ready_relay_requests(limit = None):
    pass
# WARNING: Decompyle incomplete


def get_ready_deposit_requests(limit = None):
    pass
# WARNING: Decompyle incomplete


def get_ready_claim_requests(limit = None):
    pass
# WARNING: Decompyle incomplete


def get_ready_ledger_withdraw_requests(limit = None):
    pass
# WARNING: Decompyle incomplete


def get_ready_wallet_payout_requests(limit = None):
    pass
# WARNING: Decompyle incomplete


def _mark_executed(queue_key = None, id_key = None, item_id = None, tx_hash = (None,)):
    pass
# WARNING: Decompyle incomplete


def _mark_cancelled(queue_key = None, item_id = None, reason = None):
    pass
# WARNING: Decompyle incomplete


def mark_relay_executed(request_id = None, tx_hash = None):
    _mark_executed('relay_queue', 'request_id', request_id, tx_hash = tx_hash)


def mark_deposit_executed(request_id = None, tx_hash = None):
    _mark_executed('deposit_queue', 'request_id', request_id, tx_hash = tx_hash)


def mark_claim_executed(request_id = None, tx_hash = None):
    _mark_executed('claim_queue', 'request_id', request_id, tx_hash = tx_hash)
    ledger = get_ledger_service()
    ledger.mark_claim_executed(int(request_id), tx_hash = tx_hash)


def mark_ledger_withdraw_executed(withdraw_id = None, tx_hash = None):
    _mark_executed('ledger_withdraw_queue', 'withdraw_id', withdraw_id, tx_hash = tx_hash)


def mark_wallet_payout_executed(payout_id = None, tx_hash = None):
    _mark_executed('wallet_payout_queue', 'payout_id', payout_id, tx_hash = tx_hash)


def _get_user_tier(address = None):
    '''Resolve user tier from reputation module if available, otherwise default to Tier 0.'''
    get_user_data = get_user_data
    import app.api.reputation
    user = get_user_data(address)
    return int(user.get('tier', 0))
# WARNING: Decompyle incomplete


async def _get_user_tier_for_gating(address = None, base_url = None):
    '''Resolve tier for relayer gating. Optionally from Risk Profile when available (see docs/GATING_FROM_PROFILE.md).'''
    pass
# WARNING: Decompyle incomplete


async def _get_relayer_gate(address = None, base_url = None):
    '''Resolve relayer decision context from Risk Profile v2 when available.'''
    pass
# WARNING: Decompyle incomplete


def _tier_delay_seconds(tier = None):
    if tier <= 0:
        return 0
    if tier == 1:
        return 3600
    return 0


def _tier_fee_bps(tier = None):
    if tier <= 0:
        return 100
    if tier == 1:
        return 50
    return 10


class RelayWithdrawRequest(BaseModel):
    root_high: 'str' = 'RelayWithdrawRequest'
    pool_type: 'int' = 1
    proof_calldata: 'list[str]' = Field(default_factory = list)


class RelayDepositRequest(BaseModel):
    amount_wei: 'str' = 'RelayDepositRequest'
    pool_type: 'int' = 1


class ClaimPayoutRequest(BaseModel):
    commitment_high: 'str' = 'ClaimPayoutRequest'
    proof_calldata: 'list[str]' = Field(default_factory = list)
    recipient: 'Optional[str]' = None
    claim_salt: 'Optional[str]' = None
    payout_nonce: 'Optional[str]' = None


class LedgerWithdrawRequest(BaseModel):
    amount_wei: 'str' = 'LedgerWithdrawRequest'
    asset: 'str' = 'STRK'
    proof_calldata: 'list[str]' = Field(default_factory = list)
    reason: 'str' = 'tier2h_payout'


class WalletPayoutRequest(BaseModel):
    recipient: 'str' = 'WalletPayoutRequest'
    asset: 'str' = 'STRK'
    reason: 'str' = 'ledger_transfer_out_wallet'


class RelayExecuteRequest(BaseModel):
    request_id: 'int' = 'RelayExecuteRequest'
    tx_hash: 'Optional[str]' = None


class RelayCancelRequest(BaseModel):
    request_id: 'int' = 'RelayCancelRequest'
    reason: 'Optional[str]' = None


def _enqueue(queue_key = None, id_counter_key = None, id_field = None, payload = ('queue_key', 'str', 'id_counter_key', 'str', 'id_field', 'str', 'payload', 'dict[str, Any]', 'return', 'dict[str, Any]')):
    pass
# WARNING: Decompyle incomplete


def enqueue_ledger_withdraw(*, requester, commitment_low, commitment_high, amount_wei, proof_calldata, reason, asset):
    now = int(time.time())
    requester_norm = _norm_addr(requester)
    return _enqueue('ledger_withdraw_queue', 'next_withdraw_id', 'withdraw_id', {
        'requester': requester_norm,
        'commitment_low': commitment_low,
        'commitment_high': commitment_high,
        'amount_wei': amount_wei,
        'asset': asset,
        'proof_calldata': proof_calldata,
        'reason': reason,
        'request_time': now,
        'ready_time': now,
        'executed': False,
        'cancelled': False,
        'status': 'pending' })


def enqueue_wallet_payout(*, requester, amount_wei, recipient, asset, reason):
    now = int(time.time())
    requester_norm = _norm_addr(requester)
    recipient_norm = _norm_addr(recipient)
    return _enqueue('wallet_payout_queue', 'next_wallet_payout_id', 'payout_id', {
        'requester': requester_norm,
        'amount_wei': amount_wei,
        'recipient': recipient_norm,
        'asset': asset,
        'reason': reason,
        'request_time': now,
        'ready_time': now,
        'executed': False,
        'cancelled': False,
        'status': 'pending' })


def get_pending_outgoing_by_asset(address = None):
    '''
    Sum pending ledger outflows for an address, grouped by asset.
    Includes shielded ledger withdraw queue and wallet payout queue.
    '''
    out = { }
    addr = _norm_addr(address)
# WARNING: Decompyle incomplete

create_withdraw_request = (lambda req = None, request = None: pass# WARNING: Decompyle incomplete
)()
get_withdraw_request = (lambda request_id = None: pass# WARNING: Decompyle incomplete
)()
create_deposit_request = (lambda req = None, request = None: pass# WARNING: Decompyle incomplete
)()
get_deposit_request = (lambda request_id = None: pass# WARNING: Decompyle incomplete
)()
create_claim_request = (lambda req = None, request = None: pass# WARNING: Decompyle incomplete
)()
get_claim_request = (lambda request_id = None: pass# WARNING: Decompyle incomplete
)()
create_ledger_withdraw_request = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
create_wallet_payout_request = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
mark_withdraw = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
mark_deposit = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
mark_claim = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
mark_ledger_withdraw = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
mark_wallet_payout = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
cancel_withdraw = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
cancel_deposit = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
cancel_claim = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
cancel_ledger_withdraw = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
cancel_wallet_payout = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
pending_for_user = (lambda address = None: pass# WARNING: Decompyle incomplete
)()
list_ledger_claims = (lambda status = None, limit = None, offset = router.get('/ledger/claims'): pass# WARNING: Decompyle incomplete
)()
list_ledger_events = (lambda limit = None, offset = None, request_id = router.get('/ledger/events'): pass# WARNING: Decompyle incomplete
)()
get_relayer_stats = (lambda : pass# WARNING: Decompyle incomplete
)()
reload_state()
