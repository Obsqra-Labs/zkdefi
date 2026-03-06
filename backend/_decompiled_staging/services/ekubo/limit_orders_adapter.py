# Source Generated with Decompyle++
# File: limit_orders_adapter.cpython-312.pyc (Python 3.12)

"""Ekubo Limit Orders Extension adapter — place / cancel / query limit orders.

The Limit Orders contract (Sepolia: 0x00c4c8…) allows users to place limit
orders at specific ticks.  When price crosses the order tick, the order is
filled automatically by Ekubo's AMM.

Flow:
1. Approve token to the Limit Orders contract
2. Call ``place_order(pool_key, bounds, amount, …)``
3. Poll ``get_order`` or listen for fills
4. ``cancel_order`` to withdraw unfilled amount

This adapter builds calldata only — the actual signing happens via the vault
account in the worker or executor.
"""
from __future__ import annotations
import json
import logging
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from app.services.ekubo_config import EKUBO_LIMIT_ORDERS_SEPOLIA, SEPOLIA_ETH, SEPOLIA_STRK
from app.services.ekubo_executor import _i129, FEE_30PCT, align_tick
logger = logging.getLogger(__name__)
_ORDERS_FILE = Path(__file__).resolve().parents[3] / 'data' / 'limit_orders.json'

def _load_orders():
    if not _ORDERS_FILE.exists():
        return []
    payload = json.loads(_ORDERS_FILE.read_text(encoding = 'utf-8'))
    if isinstance(payload, dict):
        return payload.get('orders', [])
    return None
# WARNING: Decompyle incomplete


def _save_orders(orders = None):
    _ORDERS_FILE.parent.mkdir(parents = True, exist_ok = True)
    datetime = datetime
    timezone = timezone
    import datetime
    data = {
        'orders': orders,
        'updated_at': datetime.now(timezone.utc).isoformat() }
    _ORDERS_FILE.write_text(json.dumps(data, indent = 2), encoding = 'utf-8')


def build_place_limit_order_calldata(*, sell_token, buy_token, amount_wei, limit_tick, tick_spacing, fee):
    '''Build a multicall: [approve, place_order].

    ``limit_tick`` is the tick at which the order should be filled.
    ``sell_token`` is transferred to the Limit Orders contract.

    Returns a list of call dicts: [{contract, entrypoint, calldata}, …]
    '''
    t0_int = int(sell_token, 16) if sell_token.startswith('0x') else int(sell_token)
    t1_int = int(buy_token, 16) if buy_token.startswith('0x') else int(buy_token)
    if t0_int > t1_int:
        token1 = sell_token
        token0 = buy_token
        is_token1 = False
    else:
        token1 = buy_token
        token0 = sell_token
        is_token1 = True
    aligned_tick = align_tick(limit_tick, tick_spacing)
    pool_key = {
        'token0': int(token0, 16),
        'token1': int(token1, 16),
        'fee': fee,
        'tick_spacing': tick_spacing,
        'extension': int(EKUBO_LIMIT_ORDERS_SEPOLIA, 16) }
    bounds = {
        'lower': _i129(aligned_tick),
        'upper': _i129(aligned_tick + tick_spacing) }
    calls = [
        {
            'contract': sell_token,
            'entrypoint': 'approve',
            'calldata': [
                int(EKUBO_LIMIT_ORDERS_SEPOLIA, 16),
                amount_wei,
                0] },
        {
            'contract': EKUBO_LIMIT_ORDERS_SEPOLIA,
            'entrypoint': 'place_order',
            'calldata': {
                'pool_key': pool_key,
                'bounds': bounds,
                'amount': amount_wei,
                'is_token1': is_token1 } }]
    return calls


def build_cancel_order_calldata(*, order_id, token0, token1, tick, tick_spacing, fee):
    '''Build calldata to cancel an open limit order and withdraw tokens.'''
    pool_key = {
        'token0': int(token0, 16),
        'token1': int(token1, 16),
        'fee': fee,
        'tick_spacing': tick_spacing,
        'extension': int(EKUBO_LIMIT_ORDERS_SEPOLIA, 16) }
    bounds = {
        'lower': _i129(tick),
        'upper': _i129(tick + tick_spacing) }
    return [
        {
            'contract': EKUBO_LIMIT_ORDERS_SEPOLIA,
            'entrypoint': 'cancel_order',
            'calldata': {
                'order_id': order_id,
                'pool_key': pool_key,
                'bounds': bounds } }]


def record_order(*, order_id, sell_token, buy_token, amount_wei, limit_tick, tx_hash):
    '''Persist a newly placed order to the local store.'''
    datetime = datetime
    timezone = timezone
    import datetime
    orders = _load_orders()
    entry = {
        'order_id': order_id,
        'sell_token': sell_token,
        'buy_token': buy_token,
        'amount_wei': amount_wei,
        'limit_tick': limit_tick,
        'status': 'open',
        'tx_hash': tx_hash,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'filled_at': None,
        'cancelled_at': None }
    orders.append(entry)
    _save_orders(orders)
    return entry


def get_active_orders():
    """Return all orders with status == 'open'."""
    pass
# WARNING: Decompyle incomplete


def mark_order_filled(order_id = None):
    '''Mark an order as filled. Returns True if found.'''
    datetime = datetime
    timezone = timezone
    import datetime
    orders = _load_orders()
    for o in orders:
        if not o.get('order_id') == order_id:
            continue
        if not o.get('status') == 'open':
            continue
        o['status'] = 'filled'
        o['filled_at'] = datetime.now(timezone.utc).isoformat()
        _save_orders(orders)
        orders
        return True
    return False


def mark_order_cancelled(order_id = None):
    '''Mark an order as cancelled. Returns True if found.'''
    datetime = datetime
    timezone = timezone
    import datetime
    orders = _load_orders()
    for o in orders:
        if not o.get('order_id') == order_id:
            continue
        if not o.get('status') == 'open':
            continue
        o['status'] = 'cancelled'
        o['cancelled_at'] = datetime.now(timezone.utc).isoformat()
        _save_orders(orders)
        orders
        return True
    return False

