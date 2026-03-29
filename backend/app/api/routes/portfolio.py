"""
Portfolio Scanner API — reads a wallet's live mainnet positions.

Endpoints:
  GET  /portfolio/{address}       → full portfolio snapshot
  GET  /portfolio/{address}/summary → lightweight summary (counts + TVL)

This is landing-page-lane: reads mainnet, never writes.
The snapshot_hash returned is suitable for proof binding / identity seeding.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.position_scanner import scan_portfolio, PortfolioSnapshot

logger = logging.getLogger(__name__)

router = APIRouter(tags=["portfolio"])


class PortfolioSummary(BaseModel):
    wallet_address: str
    total_value_usd: float
    protocol_count: int
    position_count: int
    wallet_token_count: int
    wallet_positions_value_usd: float
    defi_positions_value_usd: float
    protocols_found: list[str]
    wallet_assets_found: list[str]
    snapshot_hash: str
    scanned_at: str


@router.get("/portfolio/{address}")
async def get_portfolio(
    address: str,
    skip_cache: bool = Query(False, description="Force a fresh scan (bypass 60s cache)"),
) -> Dict[str, Any]:
    """
    Scan mainnet DeFi positions for the given Starknet wallet address.

    Returns token balances, Vesu lending positions, Endur staking positions,
    Nostra lending positions, and USD valuations.

    The `snapshot_hash` is a deterministic SHA-256 of the canonical position data,
    suitable for committing to L3 as a proof anchor.
    """
    addr = address.strip()
    if not addr.startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    if len(addr) < 10:
        raise HTTPException(status_code=400, detail="Address too short")

    try:
        snapshot = await scan_portfolio(addr, skip_cache=skip_cache)
        return snapshot.to_dict()
    except Exception as exc:
        logger.exception("Portfolio scan failed for %s", addr[:20])
        raise HTTPException(status_code=502, detail=f"Portfolio scan failed: {exc}")


@router.get("/portfolio/{address}/summary")
async def get_portfolio_summary(address: str) -> PortfolioSummary:
    """
    Lightweight portfolio summary — just counts and TVL, no position details.
    Useful for quick reputation checks without transferring full position data.
    """
    addr = address.strip()
    if not addr.startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")

    snapshot = await scan_portfolio(addr)
    return PortfolioSummary(
        wallet_address=snapshot.wallet_address,
        total_value_usd=snapshot.total_value_usd,
        protocol_count=snapshot.protocol_count,
        position_count=snapshot.position_count,
        wallet_token_count=snapshot.wallet_token_count,
        wallet_positions_value_usd=snapshot.wallet_positions_value_usd,
        defi_positions_value_usd=snapshot.defi_positions_value_usd,
        protocols_found=snapshot.protocols_found,
        wallet_assets_found=snapshot.wallet_assets_found,
        snapshot_hash=snapshot.snapshot_hash,
        scanned_at=snapshot.scanned_at,
    )
