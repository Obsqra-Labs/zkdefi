"""
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
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request

logger = logging.getLogger(__name__)

ADMIN_API_KEY: str = os.getenv("ADMIN_API_KEY", "")
# When empty, admin endpoints are blocked entirely unless APP_ENV=development
APP_ENV: str = os.getenv("APP_ENV", "development")


def _normalize_address(addr: str | None) -> str:
    """Lowercase hex, strip leading zeros after 0x prefix."""
    if not addr:
        return ""
    addr = addr.strip().lower()
    if addr.startswith("0x"):
        addr = "0x" + addr[2:].lstrip("0")
    return addr or "0x0"


async def require_wallet_owner(
    request: Request,
    x_wallet_address: Optional[str] = Header(None),
) -> str:
    """
    Dependency that ensures the caller's ``X-Wallet-Address`` header matches the
    ``user_address`` in the path or JSON body.

    Returns the verified address (normalized).
    """
    caller = _normalize_address(x_wallet_address)
    if not caller or caller == "0x0":
        raise HTTPException(status_code=401, detail="Missing X-Wallet-Address header")

    # Try path params first
    target: str | None = request.path_params.get("user_address") or request.path_params.get("address")

    # Fall back to JSON body
    if not target and request.method in {"POST", "PUT", "PATCH"}:
        try:
            body = await request.json()
            target = (
                body.get("user_address")
                or body.get("address")
                or body.get("owner_address")
                or body.get("userAddress")        # camelCase variant (trade desk)
                or body.get("manager_address")    # shared pools
                or body.get("member_address")     # shared pool joins
            )
        except Exception:
            target = None

    if target:
        if _normalize_address(target) != caller:
            raise HTTPException(
                status_code=403,
                detail="X-Wallet-Address does not match target user_address",
            )

    return caller


async def require_admin(
    x_admin_key: Optional[str] = Header(None),
) -> str:
    """
    Dependency for admin-only endpoints (merkle reset, policy reset, etc.).
    In development mode without ADMIN_API_KEY set, allows access with a warning.
    """
    if ADMIN_API_KEY:
        if x_admin_key != ADMIN_API_KEY:
            raise HTTPException(status_code=403, detail="Invalid admin key")
        return "admin"

    # No key configured
    if APP_ENV == "development":
        logger.warning("Admin endpoint accessed without ADMIN_API_KEY set (dev mode)")
        return "admin-dev"

    raise HTTPException(
        status_code=403,
        detail="Admin endpoints disabled — set ADMIN_API_KEY env var",
    )


# Convenience aliases for Depends()
WalletOwner = Depends(require_wallet_owner)
AdminOnly = Depends(require_admin)
