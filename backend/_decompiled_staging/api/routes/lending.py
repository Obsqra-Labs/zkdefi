# Source Generated with Decompyle++
# File: lending.cpython-312.pyc (Python 3.12)

'''
Lending API Routes

Reputation-driven lending pool: supply, borrow, repay, withdraw, liquidate.
All actions build calldata for frontend wallet signing.
'''
from __future__ import annotations
from typing import Any, Optional
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from app.services.lending_service import get_pool_stats, get_user_positions, build_supply_calldata, build_borrow_calldata, build_repay_calldata, build_withdraw_calldata, build_liquidate_calldata, compute_health_factor, check_all_loans_health, record_supply, record_borrow, record_repay, record_liquidation
router = APIRouter(prefix = '/lending', tags = [
    'lending'])

def _resolve_base(request = None):
    base = str(request.base_url).rstrip('/')
    if base.startswith('http'):
        return base
    (host, port) = None.scope.get('server', ('localhost', 8000))
    root_path = request.scope.get('root_path', '')
    return f'''http://{host}:{port}{root_path}'''.rstrip('/')


async def _get_lending_gate(address = None, request = None):
    pass
# WARNING: Decompyle incomplete


class SupplyRequest(BaseModel):
    amount_wei: 'int' = 'SupplyRequest'


class SupplyConfirmRequest(BaseModel):
    amount_wei: 'int' = 'SupplyConfirmRequest'
    tx_hash: 'Optional[str]' = None


class BorrowRequest(BaseModel):
    attestation_hash: 'str' = None


class BorrowConfirmRequest(BaseModel):
    principal_wei: 'int' = 'BorrowConfirmRequest'
    interest_rate_bps: 'int' = 500
    attestation_hash: 'Optional[str]' = None
    tx_hash: 'Optional[str]' = None


class RepayRequest(BaseModel):
    amount_wei: 'int' = 'RepayRequest'


class RepayConfirmRequest(BaseModel):
    amount_wei: 'int' = 'RepayConfirmRequest'
    tx_hash: 'Optional[str]' = None


class WithdrawRequest(BaseModel):
    supply_id: 'int' = 'WithdrawRequest'


class LiquidateRequest(BaseModel):
    loan_id: 'int' = 'LiquidateRequest'


class LiquidationConfirmRequest(BaseModel):
    liquidator_address: 'str' = 'LiquidationConfirmRequest'
    tx_hash: 'Optional[str]' = None

pool_stats = (lambda : pass# WARNING: Decompyle incomplete
)()
user_positions = (lambda address = None: pass# WARNING: Decompyle incomplete
)()
supply = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
confirm_supply = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
borrow = (lambda req = None, request = None: pass# WARNING: Decompyle incomplete
)()
confirm_borrow = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
repay = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
confirm_repay = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
withdraw = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
liquidate = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
confirm_liquidation = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
health_factor = (lambda address = None, loan_id = None: pass# WARNING: Decompyle incomplete
)()
at_risk_loans = (lambda : pass# WARNING: Decompyle incomplete
)()

class CreditProofRequest(BaseModel):
    collateral_wei: 'int' = 'CreditProofRequest'
    min_credit_score: 'int' = 500
    min_collateral: 'int' = 0x16345785D8A0000

generate_credit_proof = (lambda req = router.get('/health/all/at-risk'): pass# WARNING: Decompyle incomplete
)()
