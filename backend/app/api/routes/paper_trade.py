"""
Paper Trade + Strategy Simulator API routes.

Endpoints:
  POST /paper-trade/simulate                — scan portfolio, propose strategy
  POST /paper-trade/simulate-and-execute    — scan + propose + execute on paper
  POST /paper-trade/sessions                — create empty session
  GET  /paper-trade/sessions/{session_id}   — get session state
  POST /paper-trade/sessions/{session_id}/mtm       — mark-to-market
  POST /paper-trade/sessions/{session_id}/snapshot   — take snapshot (+ L3)
  POST /paper-trade/sessions/{session_id}/close      — close session
  GET  /paper-trade/sessions                — list active sessions
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["paper-trade"])


# ─── Request models ──────────────────────────────────────────────────────────

class SimulateRequest(BaseModel):
    wallet_address: str = Field(..., description="Starknet wallet address to scan")
    risk_profile: str = Field(default="balanced", description="conservative | balanced | aggressive")


class CreateSessionRequest(BaseModel):
    wallet_address: str
    starting_value_usd: float = Field(default=0.0, description="Starting capital (0 = use scanned portfolio)")


class OpenPositionRequest(BaseModel):
    protocol: str
    pool_name: str
    asset_symbol: str
    position_type: str = "lending"
    amount_usd: float
    entry_price: float = 1.0
    apy: float = 0.0


# ─── Simulate ────────────────────────────────────────────────────────────────

@router.post("/simulate")
async def simulate_strategy(req: SimulateRequest):
    """
    Scan a wallet's mainnet portfolio and propose a strategy.

    Does NOT execute anything — returns the proposal for review.
    """
    from app.services.position_scanner import scan_portfolio
    from app.services.strategy_simulator import simulate_strategy as _simulate

    # 1. Scan real portfolio
    snapshot = await scan_portfolio(req.wallet_address)
    snapshot_dict = snapshot.to_dict()

    # 2. Simulate strategy
    proposal = await _simulate(snapshot_dict, req.risk_profile)

    return {
        "portfolio": {
            "wallet_address": snapshot.wallet_address,
            "total_value_usd": snapshot.total_value_usd,
            "position_count": snapshot.position_count,
            "protocols_found": snapshot.protocols_found,
            "snapshot_hash": snapshot.snapshot_hash,
        },
        "proposal": proposal.to_dict(),
    }


@router.post("/simulate-and-execute")
async def simulate_and_execute(req: SimulateRequest):
    """
    Full flow: scan portfolio → propose strategy → execute on paper → settle to L3.

    Returns session ID for tracking P&L over time.
    """
    from app.services.position_scanner import scan_portfolio
    from app.services.strategy_simulator import simulate_strategy as _simulate
    from app.services.strategy_simulator import execute_on_paper

    # 1. Scan
    snapshot = await scan_portfolio(req.wallet_address)
    snapshot_dict = snapshot.to_dict()

    # 2. Simulate
    proposal = await _simulate(snapshot_dict, req.risk_profile)

    # 3. Execute on paper + settle to L3
    result = await execute_on_paper(proposal, settle_to_l3=True)

    return {
        "portfolio": {
            "wallet_address": snapshot.wallet_address,
            "total_value_usd": snapshot.total_value_usd,
            "position_count": snapshot.position_count,
            "protocols_found": snapshot.protocols_found,
        },
        "proposal": {
            "risk_profile": proposal.risk_profile,
            "moves_count": len(proposal.moves),
            "expected_blended_apy": proposal.expected_blended_apy,
            "expected_annual_yield_usd": proposal.expected_annual_yield_usd,
            "reasoning": proposal.reasoning,
            "proposal_hash": proposal.proposal_hash,
            "moves": [
                {
                    "action": m.action,
                    "protocol": m.protocol,
                    "pool_name": m.pool_name,
                    "asset_symbol": m.asset_symbol,
                    "amount_usd": m.amount_usd,
                    "expected_apy": m.expected_apy,
                    "risk_score": m.risk_score,
                    "reasoning": m.reasoning,
                }
                for m in proposal.moves
            ],
        },
        "execution": result,
    }


# ─── Session management ─────────────────────────────────────────────────────

@router.post("/sessions")
async def create_session(req: CreateSessionRequest):
    """Create a new paper trading session."""
    from app.services.paper_trade_engine import create_session as _create

    session = _create(req.wallet_address, req.starting_value_usd)
    return {
        "session_id": session.session_id,
        "wallet_address": session.wallet_address,
        "created_at": session.created_at,
        "starting_value_usd": session.starting_value_usd,
    }


@router.get("/sessions")
async def list_sessions(limit: int = 50):
    """List active paper trading sessions."""
    from app.services.paper_trade_engine import list_active_sessions
    return {"sessions": list_active_sessions(limit)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get full session state including positions and P&L."""
    from app.services.paper_trade_engine import get_session as _get

    session = _get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.session_id,
        "wallet_address": session.wallet_address,
        "created_at": session.created_at,
        "closed": session.closed,
        "total_value_usd": session.total_value_usd,
        "starting_value_usd": session.starting_value_usd,
        "total_pnl_usd": session.total_pnl_usd,
        "total_pnl_pct": session.total_pnl_pct,
        "last_snapshot_hash": session.last_snapshot_hash,
        "positions": [
            {
                "position_id": p.position_id,
                "protocol": p.protocol,
                "pool_name": p.pool_name,
                "asset_symbol": p.asset_symbol,
                "position_type": p.position_type,
                "amount_usd": p.amount_usd,
                "apy_at_entry": p.apy_at_entry,
                "current_apy": p.current_apy,
                "pnl_usd": p.pnl_usd,
                "entered_at": p.entered_at,
                "closed": p.closed,
            }
            for p in session.positions
        ],
        "snapshot_count": len(session.snapshots),
    }


@router.post("/sessions/{session_id}/positions")
async def add_position(session_id: str, req: OpenPositionRequest):
    """Manually add a paper position to a session."""
    from app.services.paper_trade_engine import open_position

    pos = open_position(
        session_id=session_id,
        protocol=req.protocol,
        pool_name=req.pool_name,
        asset_symbol=req.asset_symbol,
        position_type=req.position_type,
        amount_usd=req.amount_usd,
        entry_price=req.entry_price,
        apy=req.apy,
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Session not found or closed")
    return {"position_id": pos.position_id, "status": "opened"}


@router.post("/sessions/{session_id}/mtm")
async def mark_to_market(session_id: str):
    """Re-price all positions using elapsed time × current APY."""
    from app.services.paper_trade_engine import mark_to_market as _mtm

    session = _mtm(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or closed")
    return {
        "session_id": session.session_id,
        "total_value_usd": session.total_value_usd,
        "total_pnl_usd": session.total_pnl_usd,
        "total_pnl_pct": session.total_pnl_pct,
        "last_snapshot_hash": session.last_snapshot_hash,
    }


@router.post("/sessions/{session_id}/snapshot")
async def take_snapshot(session_id: str, settle_l3: bool = True):
    """
    Take a point-in-time snapshot and optionally settle to L3.

    Returns the snapshot hash for proof binding.
    """
    from app.services.paper_trade_engine import (
        take_snapshot as _snap,
        settle_snapshot_to_l3,
    )

    snapshot = _snap(session_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Session not found")

    l3_result = None
    if settle_l3:
        l3_result = await settle_snapshot_to_l3(snapshot)

    return {
        "snapshot": snapshot.to_dict(),
        "l3_settlement": l3_result,
    }


@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str):
    """Close a paper trading session (final P&L locked in)."""
    from app.services.paper_trade_engine import (
        close_session as _close,
        get_session as _get,
        take_snapshot as _snap,
        settle_snapshot_to_l3,
    )

    # Take final snapshot before closing
    final_snap = _snap(session_id)
    l3_result = None
    if final_snap:
        l3_result = await settle_snapshot_to_l3(final_snap)

    if not _close(session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    session = _get(session_id)
    return {
        "session_id": session_id,
        "status": "closed",
        "final_pnl_usd": session.total_pnl_usd if session else 0,
        "final_pnl_pct": session.total_pnl_pct if session else 0,
        "final_snapshot": final_snap.to_dict() if final_snap else None,
        "l3_settlement": l3_result,
    }
