# Source Generated with Decompyle++
# File: auth_session.cpython-312.pyc (Python 3.12)

'''Dual-wallet auth/session routes.

This route binds a Starknet address to a signature-verified EVM address as an
off-chain session handle for UX and trust-context use.
'''
from __future__ import annotations
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.dual_wallet_session_service import get_dual_wallet_session_service
from app.services.linked_address_verification_service import LinkedAddressVerificationError
router = APIRouter(prefix = '/auth/session', tags = [
    'auth_session'])

class SessionStartRequest(BaseModel):
    starknet_address: 'str' = 'SessionStartRequest'
    address: 'str' = 'ethereum'


class SessionCompleteRequest(BaseModel):
    starknet_address: 'str' = 'SessionCompleteRequest'
    signature: 'str' = 'ethereum'
    auth_provider: 'str | None' = None
    credentials: 'dict[str, Any] | None' = None

start_session = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
complete_session = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
get_session = (lambda starknet_address = None: pass# WARNING: Decompyle incomplete
)()
revoke_session = (lambda starknet_address = None: pass# WARNING: Decompyle incomplete
)()
