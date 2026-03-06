"""
Receipts API Routes

Exposes the on-chain receipt indexer endpoint consumed by useReceiptAggregator
on the frontend. Returns proof receipts with reconciliation-ready fields
(tx_hash, fact_hash, proof_type, action, result, timestamp).
"""
from fastapi import APIRouter

from app.services.receipt_service import get_receipt_service

router = APIRouter(prefix="/receipts", tags=["receipts"])


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
