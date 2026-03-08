"""
Ledger API — transfers feed for Vault ledger UI.

GET /transfers — list ledger transfers for a user (paginated).
POST /demo-credit — credit user ledger (demo mode only; requires X-Demo-Mode: true).
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List

from fastapi import APIRouter, Query, Request, HTTPException
from pydantic import BaseModel, Field

from app.services.ledger_service import get_ledger_service
from app.services.note_store import NoteStore
from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ledger", tags=["ledger"])

_NOTES_DB_PATH = Path(__file__).resolve().parents[3] / "data" / "notes.db"


def _normalize_address(addr: str) -> str:
    text = str(addr or "").strip()
    if not text:
        return ""
    try:
        if text.startswith(("0x", "0X")):
            return hex(int(text, 16)).lower()
        return hex(int(text)).lower()
    except Exception:
        return text.lower()


def _parse_amount_wei(value: str | int) -> int:
    try:
        amount = int(str(value), 0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid amount_wei: {exc}") from exc
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    return amount


def _to_request_id(prefix: str, *parts: str) -> int:
    raw = "|".join([prefix, *parts]).encode()
    return int(hashlib.sha256(raw).hexdigest()[:12], 16) % 2_000_000_000


def _starkscan_tx_url(tx_hash: str | None) -> str | None:
    h = str(tx_hash or "").strip()
    if not h:
        return None
    if not h.startswith("0x"):
        h = f"0x{h}"
    return f"https://sepolia.voyager.online/tx/{h}"


def _get_note_store() -> NoteStore:
    return NoteStore(str(_NOTES_DB_PATH))


def _settlement_fields(ts: int) -> dict[str, str]:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return {
        "settlement_eta": dt.isoformat().replace("+00:00", "Z"),
        "settlement_day_utc": dt.strftime("%Y-%m-%d"),
    }


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
    rail_type: str | None = None
    token: str | None = None
    created_at: int


class NotesResponse(BaseModel):
    count: int
    sweep_available_usd: float
    l3_block: int
    notes: List[DarkLedgerNote]
    source: str | None = None


@router.get("/notes/{address}", response_model=NotesResponse)
async def get_dark_ledger_notes(address: str) -> dict[str, Any]:
    """
    Return Dark Ledger notes (shielded commitments) for the given address.
    Includes note count, sweep-available amount (USD), and L3 block context.
    """
    notes: list[dict[str, Any]] = []
    source = "simulated"
    try:
        store = _get_note_store()
        notes = store.list_notes(_normalize_address(address), status="OPEN")
        source = "live" if notes else "simulated"
    except Exception as exc:
        logger.debug("dark ledger notes unavailable: %s", exc)

    total_wei = sum(int(n.get("amount_wei", 0)) for n in notes)
    sweep_available_usd = round((total_wei / 1e18) * 3200.0, 2)
    l3_block = int(time.time()) if notes else 0

    return {
        "count": len(notes),
        "sweep_available_usd": sweep_available_usd,
        "l3_block": l3_block,
        "notes": [
            {
                "note_hash": str(n.get("note_id", "")),
                "amount_wei": str(n.get("amount_wei", 0)),
                "commitment": str(n.get("commitment_hash", "")),
                "rail_type": str(n.get("rail_type", "")),
                "token": str(n.get("token", "")),
                "created_at": int(float(n.get("created_at", 0))),
            }
            for n in notes
        ],
        "source": source,
    }


class TransferInRequest(BaseModel):
    user_address: str = Field(..., description="User wallet address")
    tx_hash: str | None = Field(default=None, description="Wallet tx hash for transfer-in")
    amount_wei: str | int = Field(..., description="Amount in wei")
    asset: str = Field(default="STRK", description="Asset symbol")
    capital_source: str | None = Field(default="wallet_mode")
    method: str | None = Field(default="dark_ledger")
    commitment_hash: str | None = Field(default=None, description="Optional canonical commitment hash")


class TransferOutRequest(BaseModel):
    user_address: str = Field(..., description="User wallet address")
    amount_wei: str | int = Field(..., description="Amount in wei")
    asset: str = Field(default="STRK", description="Asset symbol")
    capital_source: str | None = Field(default="private_capital")
    destination_mode: str | None = Field(default="wallet")
    recipient: str | None = Field(default=None, description="Optional destination wallet")
    method: str | None = Field(default="dark_ledger")
    commitment_hash: str | None = Field(default=None, description="Optional commitment hash")
    note_id: str | None = Field(default=None, description="Optional explicit note id")
    tx_hash: str | None = Field(default=None, description="Optional chain tx hash if already sent")


@router.post("/transfer_in/request")
async def transfer_in_request(req: TransferInRequest) -> dict[str, Any]:
    """
    Canonical backend sync for a commitment/deposit event.
    Used by the slideout steppers to keep Vault + Ledger state aligned.
    """
    address = _normalize_address(req.user_address)
    if not address:
        raise HTTPException(status_code=400, detail="user_address is required")

    amount = _parse_amount_wei(req.amount_wei)
    method = str(req.method or "dark_ledger").strip().lower() or "dark_ledger"
    asset = str(req.asset or "STRK").strip().upper() or "STRK"
    now = int(time.time())

    commitment_hash = str(req.commitment_hash or "").strip()
    if not commitment_hash:
        commitment_hash = "0x" + hashlib.sha256(
            f"in:{address}:{amount}:{asset}:{req.tx_hash or ''}:{method}".encode()
        ).hexdigest()[:64]
    if not commitment_hash.startswith("0x"):
        commitment_hash = f"0x{commitment_hash}"

    store = _get_note_store()
    existing = store.find_by_commitment(address, commitment_hash, status="OPEN")
    duplicate = existing is not None
    note = existing
    if note is None:
        note = store.create_note(
            vault_id=address,
            rail_type=method,
            commitment_hash=commitment_hash,
            pool_address="wallet_transfer_in",
            token=asset,
            amount_wei=amount,
            custody="OPERATOR_HELD",
        )

    request_id = _to_request_id("transfer_in", address, commitment_hash, str(amount), asset, method)
    ledger = get_ledger_service()
    balance_wei = ledger.credit_balance(
        address,
        amount,
        request_id=request_id,
        reason=f"vault_commit_{method}",
    )

    receipt = get_receipt_service().append_proof_receipt(
        user_address=address,
        proof_type="vault_commit_recorded",
        threshold_or_model=method,
        result=json.dumps(
            {
                "action": "transfer_in",
                "asset": asset,
                "amount_wei": str(amount),
                "commitment_hash": commitment_hash,
                "capital_source": req.capital_source,
                "request_id": request_id,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        tx_hash=req.tx_hash,
        pool_id="vault",
    )

    settlement = _settlement_fields(now)
    receipt_id = str(receipt.get("receipt_id") or "")
    return {
        "status": "recorded",
        "duplicate": duplicate,
        "request_id": request_id,
        "receipt_id": receipt_id,
        "receipt_url": f"/api/v1/zkdefi/mc/receipts/{receipt_id}" if receipt_id else None,
        "note_id": str(note.get("note_id", "")),
        "commitment_hash": commitment_hash,
        "method": method,
        "asset": asset,
        "amount_wei": str(amount),
        "balance_wei": str(balance_wei),
        "tx_hash": req.tx_hash,
        "tx_url": _starkscan_tx_url(req.tx_hash),
        **settlement,
    }


@router.post("/transfer_out/request")
async def transfer_out_request(req: TransferOutRequest) -> dict[str, Any]:
    """
    Canonical backend sync for a withdrawal/settlement request.
    Marks matching commitment notes spent and queues payout tracking.
    """
    address = _normalize_address(req.user_address)
    if not address:
        raise HTTPException(status_code=400, detail="user_address is required")

    amount = _parse_amount_wei(req.amount_wei)
    method = str(req.method or "dark_ledger").strip().lower() or "dark_ledger"
    asset = str(req.asset or "STRK").strip().upper() or "STRK"
    recipient = _normalize_address(req.recipient or address)
    now = int(time.time())

    store = _get_note_store()
    target_note: dict[str, Any] | None = None
    if req.note_id:
        target_note = store.get_note(str(req.note_id))
    elif req.commitment_hash:
        target_note = store.find_by_commitment(address, str(req.commitment_hash), status="OPEN")
    else:
        target_note = store.find_latest_open(address, token=asset)

    note_status = "not_found"
    if target_note is not None:
        status = str(target_note.get("status", "")).upper()
        if status == "OPEN":
            store.mark_withdrawn(str(target_note.get("note_id")))
            note_status = "withdrawn"
        else:
            note_status = f"already_{status.lower() or 'closed'}"

    request_id = _to_request_id(
        "transfer_out",
        address,
        str(req.commitment_hash or (target_note.get("commitment_hash") if target_note else "")),
        str(amount),
        asset,
        method,
    )

    ledger = get_ledger_service()
    ledger_warning: str | None = None
    try:
        balance_wei = ledger.debit_balance(
            address,
            amount,
            request_id=request_id,
            reason=f"vault_withdraw_{method}",
        )
    except ValueError as exc:
        # Keep sync flow non-blocking for legacy wallets that never backfilled credits.
        ledger_warning = str(exc)
        balance_wei = ledger.get_balance(address)

    wants_wallet_queue = (
        str(req.destination_mode or "").strip().lower() == "wallet"
        and str(req.capital_source or "").strip().lower() == "private_capital"
    )

    payout_id: int | None = None
    payout_status = "queued" if wants_wallet_queue else "recorded"
    ready_time = now
    if wants_wallet_queue:
        try:
            from app.api.relayer import enqueue_wallet_payout

            payout = enqueue_wallet_payout(
                requester=address,
                amount_wei=str(amount),
                recipient=recipient,
                asset=asset,
                reason=f"ledger_transfer_out_{method}",
            )
            payout_id = int(payout.get("payout_id"))
            ready_time = int(payout.get("ready_time") or now)
        except Exception as exc:
            payout_status = "recorded_only"
            ledger_warning = (f"{ledger_warning}; " if ledger_warning else "") + f"payout queue unavailable: {exc}"

    receipt = get_receipt_service().append_proof_receipt(
        user_address=address,
        proof_type="vault_withdraw_recorded",
        threshold_or_model=method,
        result=json.dumps(
            {
                "action": "transfer_out",
                "asset": asset,
                "amount_wei": str(amount),
                "capital_source": req.capital_source,
                "destination_mode": req.destination_mode,
                "note_status": note_status,
                "payout_id": payout_id,
                "request_id": request_id,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        tx_hash=req.tx_hash,
        pool_id="vault",
    )

    settlement = _settlement_fields(ready_time)
    receipt_id = str(receipt.get("receipt_id") or "")
    return {
        "status": payout_status,
        "request_id": request_id,
        "payout_id": payout_id,
        "receipt_id": receipt_id,
        "receipt_url": f"/api/v1/zkdefi/mc/receipts/{receipt_id}" if receipt_id else None,
        "status_url": f"/api/v1/zkdefi/relayer/pending/{address}" if wants_wallet_queue else None,
        "note_id": str(target_note.get("note_id")) if target_note else None,
        "note_status": note_status,
        "commitment_hash": str(req.commitment_hash or (target_note.get("commitment_hash") if target_note else "")),
        "method": method,
        "asset": asset,
        "amount_wei": str(amount),
        "balance_wei": str(balance_wei),
        "recipient": recipient,
        "tx_hash": req.tx_hash,
        "tx_url": _starkscan_tx_url(req.tx_hash),
        "warning": ledger_warning,
        **settlement,
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
