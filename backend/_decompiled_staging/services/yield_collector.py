# Source Generated with Decompyle++
# File: yield_collector.cpython-312.pyc (Python 3.12)

'''
Yield Collection Service — Phase D

Reads accrued fees from Ekubo LP positions, optionally harvests them on-chain,
and records yield events in the SQLite ledger.

Pipeline:
  1. Read all positions from ekubo_lp_service JSON store
  2. For each position, query Ekubo Positions contract `get_token_info` to read amounts
  3. Estimate uncollected fees as (current_amounts - deposited_amounts)
  4. Optionally call `collect_fees` to harvest on-chain
  5. Record yield events in vault_yield_events table

Depends on:
  - ekubo_executor.EkuboContractExecutor (get_token_info, collect_fees)
  - ekubo_lp_service (list_positions, _load_positions)
  - ledger_service.LedgerService (vault_yield_events)
  - real_pool_aggregator._TOKEN_META (price/decimals)
'''
from __future__ import annotations
import logging
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any
from app.services.real_pool_aggregator import _TOKEN_SYMBOLS, _TOKEN_META
logger = logging.getLogger(__name__)
PositionYield = <NODE:12>()
YieldSnapshot = <NODE:12>()

def _sym_for_addr(addr = None):
    norm = str(addr).strip().lower()
    if norm.startswith('0x'):
        if not norm[2:].lstrip('0'):
            norm[2:].lstrip('0')
        norm = f'''0x{'0'}'''
    for k, v in _TOKEN_SYMBOLS.items():
        key = str(k).lower()
        if key.startswith('0x'):
            if not key[2:].lstrip('0'):
                key[2:].lstrip('0')
            key = f'''0x{'0'}'''
        if not key == norm:
            continue
        
        return _TOKEN_SYMBOLS.items(), v
    return 'UNKNOWN'


def _wei_to_usd(amount_wei = None, symbol = None):
    meta = _TOKEN_META.get(symbol)
    if not meta:
        return 0
    (decimals, price_usd) = meta
    return (amount_wei / 10 ** decimals) * price_usd


def _pair_name(token0 = None, token1 = None):
    return f'''{_sym_for_addr(token0)}/{_sym_for_addr(token1)}'''


async def read_yield_for_owner(owner = None, harvest = None):
    '''
    Read all LP positions for `owner`, estimate uncollected fees,
    and optionally harvest them on-chain.

    Args:
        owner: Position owner address
        harvest: If True, call collect_fees on-chain for each position
    '''
    pass
# WARNING: Decompyle incomplete


async def _read_on_chain_amounts(position_id, token0, token1 = None, fee_tier = None, lower_tick = None, upper_tick = ('position_id', 'str', 'token0', 'str', 'token1', 'str', 'fee_tier', 'int', 'lower_tick', 'int', 'upper_tick', 'int', 'return', 'tuple[int, int, int, int, bool, str | None]')):
    '''
    Read current token amounts + accrued fees from Ekubo Positions contract.
    Returns (amount0, amount1, fees0, fees1, success, error_msg).

    First tries get_token_info_raw (direct addresses + fee_tier),
    falls back to get_token_info (pair-name based).
    '''
    pass
# WARNING: Decompyle incomplete


async def _harvest_position(position_id, token0 = None, token1 = None, lower_tick = None, upper_tick = ('position_id', 'str', 'token0', 'str', 'token1', 'str', 'lower_tick', 'int', 'upper_tick', 'int', 'return', 'str | None')):
    '''Call collect_fees on Ekubo Positions contract. Returns tx hash or None.'''
    pass
# WARNING: Decompyle incomplete


def _position_age_days(created_at = None):
    '''Calculate position age in days from ISO timestamp.'''
    if not created_at:
        return 1
    if created_at.endswith('Z'):
        created_at = created_at[:-1] + '+00:00'
    dt = datetime.fromisoformat(created_at)
# WARNING: Decompyle incomplete


def _estimate_fees_from_apr(deposited0 = None, deposited1 = None, apr_pct = None, age_days = ('deposited0', 'int', 'deposited1', 'int', 'apr_pct', 'float', 'age_days', 'float', 'return', 'tuple[int, int]')):
    '''
    Estimate accrued fees using APR and position age.
    Assumes fees accrue proportionally to deposited amounts.
    '''
    if apr_pct <= 0 or age_days <= 0:
        return (0, 0)
    daily_rate = apr_pct / 100 / 365
    factor = daily_rate * age_days
    return (int(deposited0 * factor), int(deposited1 * factor))


def _record_yield_event(user_address = None, position_id = None, amount_wei = None, harvest_tx = ('user_address', 'str', 'position_id', 'str', 'amount_wei', 'int', 'harvest_tx', 'str', 'return', 'None')):
    '''Insert a yield event into the ledger.'''
    get_ledger_service = get_ledger_service
    import app.services.ledger_service
    ledger = get_ledger_service()
    if not ledger.enabled:
        return None
    import sqlite3
    now = int(time.time())
    conn = ledger._db_connect()
    conn.execute('INSERT INTO vault_yield_events (user_address, allocation_id, amount_wei, harvest_tx_hash, harvested_at) VALUES (?, ?, ?, ?, ?)', (user_address.lower(), position_id, str(amount_wei), harvest_tx, now))
    conn.commit()
    conn.close()
    return None
# WARNING: Decompyle incomplete

