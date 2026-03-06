# Source Generated with Decompyle++
# File: lending_service.cpython-312.pyc (Python 3.12)

'''
Lending Service

Backend service for the LendingPool contract. Builds calldata for frontend
wallet signing, tracks pool stats, and computes health factors.
'''
from __future__ import annotations
import logging
import os
import time
from typing import Any, Optional
from app.services.json_store import JsonStore
from app.services.collateral_service import get_user_total_collateral
from app.services.receipt_service import get_receipt_service
logger = logging.getLogger(__name__)
WEI_PER_ETH = 0xDE0B6B3A7640000
LENDING_POOL_ADDRESS = os.getenv('LENDING_POOL_ADDRESS', '0x0')
ETH_TOKEN = os.getenv('ETH_TOKEN_ADDRESS', '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7')
LIQUIDATION_THRESHOLD_BPS = 8000
LIQUIDATION_PENALTY_BPS = 500
BPS_DENOM = 10000
BASE_SUPPLY_APY_BPS = 300
BASE_BORROW_APY_BPS = 500
_lending_store = JsonStore('lending_positions')
_pool_stats_store = JsonStore('lending_pool_stats')

def _u256_parts(value = None):
    low = value % 2 ** 128
    high = value // 2 ** 128
    return (str(low), str(high))


def get_pool_stats():
    '''Get pool-level statistics.'''
    if not _pool_stats_store.get('pool'):
        _pool_stats_store.get('pool')
    stats = {
        'total_supplied_wei': 0,
        'total_borrowed_wei': 0,
        'total_shares': 0,
        'supply_apy_bps': BASE_SUPPLY_APY_BPS,
        'borrow_apy_bps': BASE_BORROW_APY_BPS }
    supplied = int(stats.get('total_supplied_wei', 0))
    borrowed = int(stats.get('total_borrowed_wei', 0))
    utilization_bps = borrowed * BPS_DENOM // supplied if supplied > 0 else 0
    supply_apy = BASE_SUPPLY_APY_BPS + utilization_bps * 2 // BPS_DENOM
    borrow_apy = BASE_BORROW_APY_BPS + utilization_bps * 3 // BPS_DENOM
    return {
        'pool_address': LENDING_POOL_ADDRESS,
        'token': ETH_TOKEN,
        'total_supplied_wei': supplied,
        'total_supplied_eth': round(supplied / WEI_PER_ETH, 6),
        'total_borrowed_wei': borrowed,
        'total_borrowed_eth': round(borrowed / WEI_PER_ETH, 6),
        'utilization_bps': utilization_bps,
        'supply_apy_bps': supply_apy,
        'borrow_apy_bps': borrow_apy,
        'available_liquidity_wei': supplied - borrowed,
        'available_liquidity_eth': round((supplied - borrowed) / WEI_PER_ETH, 6) }


def get_user_positions(address = None):
    '''Get all lending positions (loans + supplies) for a user.'''
    key = address.lower().strip()
    if not _lending_store.get(key):
        _lending_store.get(key)
    data = {
        'loans': [],
        'supplies': [] }
# WARNING: Decompyle incomplete


def build_supply_calldata(amount_wei = None):
    '''Build multicall: [approve, supply].'''
    (low, high) = _u256_parts(amount_wei)
    return {
        'calls': [
            {
                'contractAddress': ETH_TOKEN,
                'entrypoint': 'approve',
                'calldata': [
                    LENDING_POOL_ADDRESS,
                    low,
                    high] },
            {
                'contractAddress': LENDING_POOL_ADDRESS,
                'entrypoint': 'supply',
                'calldata': [
                    low,
                    high] }],
        'message': f'''Supply {amount_wei} wei to lending pool''' }


def build_borrow_calldata(amount_wei = None, attestation_hash = None):
    '''Build calldata for borrow.'''
    (low, high) = _u256_parts(amount_wei)
    att_felt = attestation_hash
    return {
        'calls': [
            {
                'contractAddress': LENDING_POOL_ADDRESS,
                'entrypoint': 'borrow',
                'calldata': [
                    low,
                    high,
                    att_felt] }],
        'message': f'''Borrow {amount_wei} wei against attestation''' }


def build_repay_calldata(loan_id = None, amount_wei = None):
    '''Build multicall: [approve, repay].'''
    (low, high) = _u256_parts(amount_wei)
    return {
        'calls': [
            {
                'contractAddress': ETH_TOKEN,
                'entrypoint': 'approve',
                'calldata': [
                    LENDING_POOL_ADDRESS,
                    low,
                    high] },
            {
                'contractAddress': LENDING_POOL_ADDRESS,
                'entrypoint': 'repay',
                'calldata': [
                    str(loan_id),
                    low,
                    high] }],
        'message': f'''Repay {amount_wei} wei on loan {loan_id}''' }


def build_withdraw_calldata(supply_id = None):
    '''Build calldata for withdraw.'''
    return {
        'calls': [
            {
                'contractAddress': LENDING_POOL_ADDRESS,
                'entrypoint': 'withdraw',
                'calldata': [
                    str(supply_id)] }],
        'message': f'''Withdraw supply position {supply_id}''' }


def build_liquidate_calldata(loan_id = None):
    '''Build calldata for liquidate.'''
    return {
        'calls': [
            {
                'contractAddress': LENDING_POOL_ADDRESS,
                'entrypoint': 'liquidate',
                'calldata': [
                    str(loan_id)] }],
        'message': f'''Liquidate loan {loan_id}''' }


def compute_health_factor(address = None, loan_id = None):
    '''
    Compute health factor for user loans.
    health_factor = (collateral_value * BPS_DENOM) / (total_debt * LIQUIDATION_THRESHOLD_BPS)
    > 1.0 = healthy, < 1.0 = liquidatable
    '''
    collateral_info = get_user_total_collateral(address)
    collateral_wei = collateral_info.get('total_wei', 0)
    positions = get_user_positions(address)
    loans = positions.get('loans', [])
# WARNING: Decompyle incomplete


def check_all_loans_health():
    '''Check health for all users with loans. Returns at-risk and liquidatable loans.'''
    all_data = _lending_store.all()
    at_risk = []
# WARNING: Decompyle incomplete


def record_supply(address = None, supply_id = None, amount_wei = None, tx_hash = (None,)):
    '''Record a supply in local cache after on-chain confirmation.'''
    key = address.lower().strip()
    if not _lending_store.get(key):
        _lending_store.get(key)
    data = {
        'loans': [],
        'supplies': [] }
    supply = {
        'supply_id': supply_id,
        'amount_wei': amount_wei,
        'deposited_at': int(time.time()),
        'active': True,
        'tx_hash': tx_hash }
    data['supplies'].append(supply)
    _lending_store.set(key, data)
    _update_pool_stats('supply', amount_wei)
    record_transaction_internal = record_transaction_internal
    import app.api.reputation
    record_transaction_internal(address, amount_wei / WEI_PER_ETH, success = True)
    receipt_svc = get_receipt_service()
    receipt_svc.append_proof_receipt(user_address = address, proof_type = 'lending_supply', threshold_or_model = 'lending_pool_v1', result = f'''supplied={amount_wei}wei''', tx_hash = tx_hash)
    return supply


def record_borrow(address, loan_id = None, principal_wei = None, interest_rate_bps = None, attestation_hash = (BASE_BORROW_APY_BPS, None, None), tx_hash = ('address', 'str', 'loan_id', 'int', 'principal_wei', 'int', 'interest_rate_bps', 'int', 'attestation_hash', 'Optional[str]', 'tx_hash', 'Optional[str]', 'return', 'dict[str, Any]')):
    '''Record a borrow in local cache after on-chain confirmation.'''
    key = address.lower().strip()
    if not _lending_store.get(key):
        _lending_store.get(key)
    data = {
        'loans': [],
        'supplies': [] }
    loan = {
        'loan_id': loan_id,
        'principal_wei': principal_wei,
        'interest_wei': 0,
        'interest_rate_bps': interest_rate_bps,
        'opened_at': int(time.time()),
        'last_accrued': int(time.time()),
        'attestation_hash': attestation_hash,
        'active': True,
        'tx_hash': tx_hash }
    data['loans'].append(loan)
    _lending_store.set(key, data)
    _update_pool_stats('borrow', principal_wei)
    return loan


def record_repay(address = None, loan_id = None, amount_wei = None, tx_hash = (None,)):
    '''Record a repayment in local cache.'''
    key = address.lower().strip()
    data = _lending_store.get(key)
    if not data:
        return False
    for loan in data.get('loans', []):
        if not loan.get('loan_id') == loan_id:
            continue
        principal = int(loan.get('principal_wei', 0))
        interest = int(loan.get('interest_wei', 0))
        total = principal + interest
        if amount_wei >= total:
            loan['principal_wei'] = 0
            loan['interest_wei'] = 0
            loan['active'] = False
        elif amount_wei > interest:
            loan['interest_wei'] = 0
            loan['principal_wei'] = principal - amount_wei - interest
        else:
            loan['interest_wei'] = interest - amount_wei
        loan['last_accrued'] = int(time.time())
        _lending_store.set(key, data)
        _update_pool_stats('repay', amount_wei)
        record_transaction_internal = record_transaction_internal
        import app.api.reputation
        record_transaction_internal(address, amount_wei / WEI_PER_ETH, success = True)
        receipt_svc = get_receipt_service()
        receipt_svc.append_proof_receipt(user_address = address, proof_type = 'lending_repay', threshold_or_model = 'lending_pool_v1', result = f'''repaid={amount_wei}wei,loan={loan_id}''', tx_hash = tx_hash)
        data.get('loans', [])
        return True
    return False


def record_liquidation(borrower_address, loan_id = None, debt_repaid_wei = None, collateral_seized_wei = None, liquidator_address = (None,), tx_hash = ('borrower_address', 'str', 'loan_id', 'int', 'debt_repaid_wei', 'int', 'collateral_seized_wei', 'int', 'liquidator_address', 'str', 'tx_hash', 'Optional[str]', 'return', 'bool')):
    '''Record a liquidation event.'''
    key = borrower_address.lower().strip()
    data = _lending_store.get(key)
    if not data:
        return False
    for loan in data.get('loans', []):
        if not loan.get('loan_id') == loan_id:
            continue
        loan['active'] = False
        loan['principal_wei'] = 0
        loan['interest_wei'] = 0
        _lending_store.set(key, data)
        _update_pool_stats('liquidation', debt_repaid_wei)
        record_transaction_internal = record_transaction_internal
        import app.api.reputation
        record_transaction_internal(borrower_address, debt_repaid_wei / WEI_PER_ETH, success = False)
        receipt_svc = get_receipt_service()
        receipt_svc.append_proof_receipt(user_address = borrower_address, proof_type = 'lending_liquidation', threshold_or_model = 'lending_pool_v1', result = f'''liquidated=loan_{loan_id},debt={debt_repaid_wei}wei,seized={collateral_seized_wei}wei''', tx_hash = tx_hash)
        data.get('loans', [])
        return True
    return False


def _update_pool_stats(action = None, amount_wei = None):
    '''Update pool stats after an action.'''
    if not _pool_stats_store.get('pool'):
        _pool_stats_store.get('pool')
    stats = {
        'total_supplied_wei': 0,
        'total_borrowed_wei': 0,
        'total_shares': 0 }
    if action == 'supply':
        stats['total_supplied_wei'] = int(stats.get('total_supplied_wei', 0)) + amount_wei
    elif action == 'borrow':
        stats['total_borrowed_wei'] = int(stats.get('total_borrowed_wei', 0)) + amount_wei
    elif action == 'repay':
        stats['total_borrowed_wei'] = max(0, int(stats.get('total_borrowed_wei', 0)) - amount_wei)
        stats['total_supplied_wei'] = int(stats.get('total_supplied_wei', 0)) + amount_wei
    elif action == 'withdraw':
        stats['total_supplied_wei'] = max(0, int(stats.get('total_supplied_wei', 0)) - amount_wei)
    elif action == 'liquidation':
        stats['total_borrowed_wei'] = max(0, int(stats.get('total_borrowed_wei', 0)) - amount_wei)
    _pool_stats_store.set('pool', stats)

