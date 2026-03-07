"""
Ledger API — transfers feed for Vault ledger UI.

GET /transfers — list ledger transfers for a user (paginated).
POST /demo-credit — credit user ledger (demo mode only; requires X-Demo-Mode: true).
"""

from __future__ import annotations

import logging
from typing import Any, List

from fastapi import APIRouter, Query, Request, HTTPException
from pydantic import BaseModel, Field

from app.services.ledger_service import get_ledger_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ledger", tags=["ledger"])


class TransferEntry(BaseModel):
    id: int
    address: str
    amount_wei: str
    direction: str
    request_id: int | None
    reason: str | None
    created_at: int


class TransfersResponse(BaseModel):
    transfers: List[TransferEntry]
    limit: int
    offset: int


@router.get("/transfers", response_model=TransfersResponse)
async def get_transfers(
    user_address: str = Query(..., description="User's Starknet address"),
    limit: int = Query(50, ge=1, le=500, description="Max entries to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> dict[str, Any]:
    """
    List ledger transfers for the given address (Vault ledger feed).
    Each entry includes id, amount, direction, reason and created_at for display
    as ledger rows (what happened, why, proof status when available from reason).
    """
    ledger = get_ledger_service()
    raw = ledger.list_transfers(address=user_address.strip(), limit=limit, offset=offset)
    return {
        "transfers": [
            {
                "id": r["id"],
                "address": r["address"],
                "amount_wei": r["amount_wei"],
                "direction": r["direction"],
                "request_id": r.get("request_id"),
                "reason": r.get("reason"),
                "created_at": r["created_at"],
            }
            for r in raw
        ],
        "limit": limit,
        "offset": offset,
    }


class DarkLedgerNote(BaseModel):
    note_hash: str
    amount_wei: str
    commitment: str
    created_at: int


class NotesResponse(BaseModel):
    count: int
    sweep_available_usd: float
    l3_block: int
    notes: List[DarkLedgerNote]


@router.get("/notes/{address}", response_model=NotesResponse)
async def get_dark_ledger_notes(address: str) -> dict[str, Any]:
    """
    Return Dark Ledger notes (shielded commitments) for the given address.
    Includes note count, sweep-available amount (USD), and L3 block context.
    """
    # TODO: Wire to actual note_store.get_notes() when available
    # For now, return empty with zeroes to eliminate console 404 errors
    return {
        "count": 0,
        "sweep_available_usd": 0.0,
        "l3_block": 0,
        "notes": [],
    }


class DemoCreditRequest(BaseModel):
    user_address: str = Field(..., description="Starknet address to credit")
    amount_wei: str = Field(..., description="Amount in wei (decimal or hex string)")


class DemoCreditResponse(BaseModel):
    balance_wei: str
    message: str


@router.post("/demo-credit", response_model=DemoCreditResponse)
async def demo_credit(request: Request, body: DemoCreditRequest) -> dict[str, Any]:
    """
    Credit the internal ledger for the given address. Only allowed when X-Demo-Mode: true.
    """
    if not getattr(request.state, "demo_mode", False):
        raise HTTPException(
            status_code=403,
            detail="Demo credit is only allowed when X-Demo-Mode: true",
        )
    try:
        amount = int(body.amount_wei, 0)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid amount_wei: {e}") from e
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    ledger = get_ledger_service()
    try:
        new_balance = ledger.credit_balance(
            body.user_address,
            amount,
            request_id=None,
            reason="demo_deposit",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "balance_wei": str(new_balance),
        "message": "Ledger credited (demo); no on-chain transaction.",
    }
