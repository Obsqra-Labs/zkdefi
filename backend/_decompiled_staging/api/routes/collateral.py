# Source Generated with Decompyle++
# File: collateral.cpython-312.pyc (Python 3.12)

'''
Collateral API Routes

Manages on-chain collateral for the lending system via CollateralVault.
'''
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.services.collateral_service import get_user_positions, get_user_total_collateral, build_deposit_calldata, build_withdraw_calldata, record_deposit, record_withdrawal, ETH_TOKEN
router = APIRouter(prefix = '/collateral', tags = [
    'collateral'])

class DepositRequest(BaseModel):
    amount_wei: int = ETH_TOKEN
    pool_tier: str = 'core'


class DepositConfirmRequest(BaseModel):
    position_id: int = 'DepositConfirmRequest'
    amount_wei: int = ETH_TOKEN
    pool_tier: str = 'core'
    tx_hash: Optional[str] = None


class WithdrawRequest(BaseModel):
    position_id: int = 'WithdrawRequest'


class WithdrawConfirmRequest(BaseModel):
    position_id: int = 'WithdrawConfirmRequest'

collateral_positions = (lambda address = None: pass# WARNING: Decompyle incomplete
)()
collateral_total = (lambda address = None: pass# WARNING: Decompyle incomplete
)()
deposit_collateral = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
confirm_deposit = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
withdraw_collateral = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
confirm_withdrawal = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
