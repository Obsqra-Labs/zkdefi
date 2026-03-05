"""Market surface routes for cross-DEX dashboard intelligence."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException

from app.services.ekubo_config import get_ekubo_chain_id
from app.services.market_surface_service import get_market_surface

router = APIRouter(prefix="/market", tags=["market"])


def _market_surface_enabled() -> bool:
    return os.getenv("EKUBO_MARKET_SURFACE_ENABLED", "true").strip().lower() == "true"


@router.get("/surface")
async def market_surface() -> dict[str, Any]:
    if not _market_surface_enabled():
        raise HTTPException(status_code=503, detail="Market surface disabled (EKUBO_MARKET_SURFACE_ENABLED=false).")

    chain_id = get_ekubo_chain_id()
    data = await get_market_surface(chain_id=chain_id)
    return data
