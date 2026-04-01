"""
Privacy Recovery Key Storage — encrypted MIST Chamber claiming keys.

Stores encrypted recovery blobs so users can retrieve their Chamber
claiming keys even if they lose the downloaded file.  Optionally
registers a commitment hash on the Madara L3 appchain for auditability.

Endpoints (all under /privacy/recovery):
  POST /store           — Store an encrypted recovery blob
  GET  /fetch/{address} — Retrieve stored blobs for a wallet
  GET  /list/{address}  — List recovery entries (metadata only)
"""

from __future__ import annotations

import hashlib
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/privacy/recovery", tags=["privacy-recovery"])

# ---------------------------------------------------------------------------
# In-memory store (production: swap for a DB / encrypted-at-rest KV store)
# ---------------------------------------------------------------------------

_recovery_store: dict[str, list[dict[str, Any]]] = {}


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class StoreRecoveryRequest(BaseModel):
    wallet_address: str = Field(..., description="User wallet address (owner)")
    encrypted_blob: str = Field(..., description="Encrypted recovery JSON (hex or base64)")
    commitment_hash: str = Field(
        ...,
        description="Poseidon or SHA-256 hash of the plaintext recovery data",
    )
    token_address: str = Field("", description="Token deposited (for display)")
    amount_wei: str = Field("", description="Amount deposited (for display)")
    chamber_address: str = Field("", description="Chamber contract address")


class StoreRecoveryResponse(BaseModel):
    ok: bool
    entry_id: str
    l3_registered: bool = False
    l3_tx_hash: str = ""


class RecoveryEntry(BaseModel):
    entry_id: str
    wallet_address: str
    encrypted_blob: str
    commitment_hash: str
    token_address: str
    amount_wei: str
    chamber_address: str
    stored_at: float
    l3_registered: bool = False
    l3_tx_hash: str = ""


class FetchRecoveryResponse(BaseModel):
    entries: list[RecoveryEntry]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/store", response_model=StoreRecoveryResponse)
async def store_recovery(req: StoreRecoveryRequest) -> StoreRecoveryResponse:
    """Store an encrypted recovery blob for a wallet address."""
    addr = req.wallet_address.lower()
    entry_id = hashlib.sha256(
        f"{addr}:{req.commitment_hash}:{time.time()}".encode()
    ).hexdigest()[:16]

    entry: dict[str, Any] = {
        "entry_id": entry_id,
        "wallet_address": addr,
        "encrypted_blob": req.encrypted_blob,
        "commitment_hash": req.commitment_hash,
        "token_address": req.token_address,
        "amount_wei": req.amount_wei,
        "chamber_address": req.chamber_address,
        "stored_at": time.time(),
        "l3_registered": False,
        "l3_tx_hash": "",
    }

    # Try to register commitment hash on Madara L3 (best-effort)
    l3_registered = False
    l3_tx_hash = ""
    try:
        from app.services.madara_settlement_client import get_madara_settlement_client
        client = get_madara_settlement_client()
        config = await client.settlement_config()
        if config.madara_enabled:
            # Register the commitment hash as a fact on L3
            result = await client.verify_fact(req.commitment_hash)
            if result:
                l3_registered = True
                l3_tx_hash = getattr(result, "tx_hash", "")
                logger.info(
                    "Recovery commitment %s registered on L3 for %s",
                    req.commitment_hash[:16],
                    addr[:12],
                )
    except Exception as exc:
        logger.warning("L3 registration skipped: %s", exc)

    entry["l3_registered"] = l3_registered
    entry["l3_tx_hash"] = l3_tx_hash

    if addr not in _recovery_store:
        _recovery_store[addr] = []
    _recovery_store[addr].append(entry)

    logger.info("Stored recovery entry %s for %s", entry_id, addr[:12])
    return StoreRecoveryResponse(
        ok=True,
        entry_id=entry_id,
        l3_registered=l3_registered,
        l3_tx_hash=l3_tx_hash,
    )


@router.get("/fetch/{address}", response_model=FetchRecoveryResponse)
async def fetch_recovery(address: str) -> FetchRecoveryResponse:
    """Retrieve all stored recovery entries for a wallet address."""
    addr = address.lower()
    entries = _recovery_store.get(addr, [])
    return FetchRecoveryResponse(
        entries=[RecoveryEntry(**e) for e in entries],
    )


@router.get("/list/{address}")
async def list_recovery(address: str) -> dict[str, Any]:
    """List recovery entries (metadata only — no encrypted blobs)."""
    addr = address.lower()
    entries = _recovery_store.get(addr, [])
    return {
        "count": len(entries),
        "entries": [
            {
                "entry_id": e["entry_id"],
                "commitment_hash": e["commitment_hash"],
                "token_address": e["token_address"],
                "amount_wei": e["amount_wei"],
                "stored_at": e["stored_at"],
                "l3_registered": e["l3_registered"],
            }
            for e in entries
        ],
    }
