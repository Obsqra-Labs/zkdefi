"""Telegram Studio linking API (zkde.fi mints codes; studio-api redeems)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.services import studio_link_service as link_svc

router = APIRouter(prefix="/api/studio/telegram", tags=["studio-telegram"])


class LinkTokenRequest(BaseModel):
    wallet_address: str = Field(..., min_length=4, max_length=128)


class LinkTokenResponse(BaseModel):
    code: str
    expires_at: str


class RedeemRequest(BaseModel):
    code: str


class RedeemResponse(BaseModel):
    wallet_address: str


@router.post("/link-token", response_model=LinkTokenResponse)
async def post_link_token(
    body: LinkTokenRequest,
    x_telegram_link_key: str | None = Header(None, alias="X-Telegram-Link-Key"),
) -> Any:
    """Mint an 8-char code. Set env ``TELEGRAM_LINK_MINT_KEY`` to require ``X-Telegram-Link-Key``."""
    if not link_svc.verify_link_mint_key(x_telegram_link_key):
        raise HTTPException(status_code=401, detail="invalid or missing link mint key")
    try:
        code, expires_at = link_svc.mint_link_code(body.wallet_address)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return LinkTokenResponse(code=code, expires_at=expires_at)


@router.post("/redeem-code", response_model=RedeemResponse)
async def post_redeem_code(
    body: RedeemRequest,
    authorization: str | None = Header(None, alias="Authorization"),
) -> Any:
    if not link_svc.verify_service_token(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")
    wallet = link_svc.redeem_code(body.code)
    if wallet is None:
        raise HTTPException(status_code=404, detail="invalid or expired code")
    return RedeemResponse(wallet_address=wallet)
