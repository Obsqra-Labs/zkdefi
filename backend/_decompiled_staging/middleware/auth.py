# Source Generated with Decompyle++
# File: auth.cpython-312.pyc (Python 3.12)

'''
Wallet-address authentication middleware for zkde.fi.

Strategy:
- Read-only (GET) endpoints remain open — public market data, system metrics, etc.
- Write endpoints (POST/PUT/DELETE) that act on a *user_address* require that
  the caller proves ownership via an ``X-Wallet-Address`` header matching the
  ``user_address`` path/body parameter.
- Admin / destructive endpoints (merkle reset, policy reset) require an
  ``X-Admin-Key`` header matching the ``ADMIN_API_KEY`` env var.

This is a pragmatic first layer.  Full Starknet signature verification
(``starknet_keccak`` + ``verify()``) can be layered on top once frontend
signs a nonce on each mutation.
'''
from __future__ import annotations
import logging
import os
from typing import Optional
from fastapi import Depends, Header, HTTPException, Request
logger = logging.getLogger(__name__)
ADMIN_API_KEY: 'str' = os.getenv('ADMIN_API_KEY', '')
APP_ENV: 'str' = os.getenv('APP_ENV', 'development')

def _normalize_address(addr = None):
    '''Lowercase hex, strip leading zeros after 0x prefix.'''
    if not addr:
        return ''
    addr = addr.strip().lower()
    if addr.startswith('0x'):
        addr = '0x' + addr[2:].lstrip('0')
    if not addr:
        addr
    return '0x0'


async def require_wallet_owner(request = None, x_wallet_address = None):
    """
    Dependency that ensures the caller's ``X-Wallet-Address`` header matches the
    ``user_address`` in the path or JSON body.

    Returns the verified address (normalized).
    """
    pass
# WARNING: Decompyle incomplete


async def require_admin(x_admin_key = None):
    '''
    Dependency for admin-only endpoints (merkle reset, policy reset, etc.).
    In development mode without ADMIN_API_KEY set, allows access with a warning.
    '''
    pass
# WARNING: Decompyle incomplete

WalletOwner = Depends(require_wallet_owner)
AdminOnly = Depends(require_admin)
