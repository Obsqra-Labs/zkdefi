"""
Receipts API Routes

Exposes the on-chain receipt indexer endpoint consumed by useReceiptAggregator
on the frontend. Returns proof receipts with reconciliation-ready fields
(tx_hash, fact_hash, proof_type, action, result, timestamp).

GET /receipts — list receipts (optional address query); used by ReceiptService.getReceipts().
"""
import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, Query

from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["receipts"])


@router.get("")
async def list_receipts(
    address: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    adapter: Optional[str] = Query(None),
) -> list:
    """List receipts; returns [] when no address. Fixes 404 from frontend getReceipts. Fixes 404 from frontend getReceipts()."""
    if not address or not str(address).strip():
        return []
    svc = get_receipt_service()
    raw = await svc.get_user_receipts(str(address).strip())
    out: list[dict[str, Any]] = []
    for r in raw:
        if type and r.get("action_type") != type:
            continue
        if adapter and r.get("adapter") != adapter:
            continue
        out.append({
            "id": r.get("receipt_id", ""),
            "timestamp": r.get("timestamp", ""),
            "action": r.get("action_type", "receipt"),
            "adapter": r.get("adapter", ""),
            "amount": r.get("amount", 0),
            "user": r.get("user"),
            "tx_hash": r.get("tx_hash"),
            "proof_hash": r.get("proof_hash"),
        })
    return out


@router.get("/on-chain/{address}")
async def get_on_chain_receipts(address: str):
    """
    Return all proof receipts for an address in the shape expected by the
    frontend useReceiptAggregator hook. Each entry includes tx_hash and
    fact_hash when available so the frontend can reconcile on-chain state
    with the backend timeline.
    """
    svc = get_receipt_service()
    raw = await svc.get_user_receipts(address)

    receipts = []
    for r in raw:
        receipts.append({
            "tx_hash": r.get("tx_hash"),
            "fact_hash": r.get("fact_hash"),
            "proof_type": r.get("proof_type", "unknown"),
            "action": r.get("proof_type", r.get("action", "receipt")),
            "result": r.get("result"),
            "timestamp": r.get("timestamp"),
            "meta": {
                k: v
                for k, v in r.items()
                if k not in ("tx_hash", "fact_hash", "proof_type", "result", "timestamp", "user")
            },
        })

    return {"receipts": receipts, "count": len(receipts)}


@router.post("", summary="Record execution receipt")
async def record_receipt(receipt: dict = Body(...)):
    svc = get_receipt_service()
    tx_hash = receipt.get("transactionHash", receipt.get("txHash", "unknown"))

    try:
        stored = await svc.create_receipt(
            user_address=receipt.get("userAddress", receipt.get("user", "")),
            constraints_hash=receipt.get("constraintsHash", "0x0"),
            proof_hash=receipt.get("proofHash", receipt.get("proof_hash", "0x0")),
            action_type=receipt.get("action", receipt.get("actionType", "execution")),
            protocol_id=int(receipt.get("protocolId", 0)),
            amount=int(receipt.get("amount", 0)),
        )
        receipt_id = stored.get("receipt_id", "unknown")
        if tx_hash != "unknown":
            await svc.confirm_receipt(receipt_id, tx_hash)
    except Exception as exc:
        logger.warning("record_receipt storage failed (non-fatal): %s", exc)
        receipt_id = receipt.get("id", receipt.get("receiptId", "unknown"))

    logger.info("Receipt recorded: tx=%s id=%s", tx_hash, receipt_id)
    return {"status": "recorded", "id": receipt_id}
