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

from app.db.decision_store import get_decision_store
from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["receipts"])


def _decision_fact_hash(row: dict[str, Any]) -> str | None:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    fact_hash = metadata.get("fact_hash") or metadata.get("proof_hash")
    return str(fact_hash) if fact_hash else None


def _decision_proof_type(row: dict[str, Any]) -> str:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    value = metadata.get("proof_type") or row.get("proof_mode") or row.get("event_type") or "unknown"
    return str(value)


def _decision_action(row: dict[str, Any]) -> str:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    value = metadata.get("proof_type") or row.get("event_type") or row.get("gate") or "receipt"
    return str(value)


def _decision_meta(row: dict[str, Any], tx_source: str) -> dict[str, Any]:
    return {
        "source": "decision_store",
        "tx_source": tx_source,
        "gate": row.get("gate"),
        "proof_mode": row.get("proof_mode"),
        "model_name": row.get("model_name"),
        "model_hash": row.get("model_hash"),
        "execution_chain": row.get("execution_chain"),
        "primary_chain": row.get("primary_chain"),
        "verification_mode": row.get("verification_mode"),
        "verified_on_chain": row.get("verified_on_chain"),
        "mirror_status": row.get("mirror_status"),
        "failure_reason": row.get("failure_reason"),
    }


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
    seen_keys: set[tuple[str | None, str | None, str | None]] = set()
    for r in raw:
        if type and r.get("action_type") != type:
            continue
        if adapter and r.get("adapter") != adapter:
            continue
        row = {
            "id": r.get("receipt_id", ""),
            "timestamp": r.get("timestamp", ""),
            "action": r.get("action_type", "receipt"),
            "adapter": r.get("adapter", ""),
            "amount": r.get("amount", 0),
            "user": r.get("user"),
            "tx_hash": r.get("tx_hash"),
            "proof_hash": r.get("proof_hash"),
            "fact_hash": r.get("fact_hash") or r.get("proof_hash"),
        }
        out.append(row)
        seen_keys.add(
            (
                str(row.get("tx_hash") or "") or None,
                str(row.get("fact_hash") or "") or None,
                str(row.get("timestamp") or "") or None,
            )
        )

    try:
        decision_rows = await get_decision_store().get_user_history(str(address).strip(), limit=1000)
    except Exception:
        decision_rows = []

    for row in decision_rows:
        if not isinstance(row, dict):
            continue
        fact_hash = _decision_fact_hash(row)
        proof_type = _decision_proof_type(row)
        action = _decision_action(row)
        timestamp = str(row.get("created_at") or "")

        for tx_field, tx_source in (("l3_tx_hash", "l3"), ("l2_tx_hash", "l2")):
            tx_hash = row.get(tx_field)
            if not tx_hash:
                continue
            if type and type not in {action, proof_type, str(row.get("event_type") or ""), str(row.get("gate") or "")}:
                continue
            if adapter and adapter not in {str(row.get("gate") or ""), tx_source}:
                continue
            dedupe_key = (
                str(tx_hash) or None,
                str(fact_hash or "") or None,
                timestamp or None,
            )
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            out.append(
                {
                    "id": f"decision:{row.get('id')}:{tx_source}",
                    "timestamp": timestamp,
                    "action": action,
                    "adapter": str(row.get("gate") or tx_source),
                    "amount": 0,
                    "user": str(address).strip().lower(),
                    "tx_hash": tx_hash,
                    "proof_hash": fact_hash,
                    "fact_hash": fact_hash,
                    "proof_type": proof_type,
                    "source": "decision_store",
                    "verified_on_chain": row.get("verified_on_chain"),
                    "tx_source": tx_source,
                }
            )
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
    seen_tx_keys: set[tuple[str | None, str | None, str | None]] = set()
    for r in raw:
        row = {
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
        }
        receipts.append(row)
        seen_tx_keys.add(
            (
                str(row.get("tx_hash") or "") or None,
                str(row.get("fact_hash") or "") or None,
                str(row.get("timestamp") or "") or None,
            )
        )

    try:
        decision_rows = await get_decision_store().get_user_history(address, limit=1000)
    except Exception:
        decision_rows = []

    for row in decision_rows:
        if not isinstance(row, dict):
            continue
        fact_hash = _decision_fact_hash(row)
        proof_type = _decision_proof_type(row)
        action = row.get("event_type") or row.get("gate") or proof_type
        timestamp = row.get("created_at")

        for tx_field, tx_source in (("l3_tx_hash", "l3"), ("l2_tx_hash", "l2")):
            tx_hash = row.get(tx_field)
            if not tx_hash:
                continue
            dedupe_key = (
                str(tx_hash) or None,
                str(fact_hash or "") or None,
                str(timestamp or "") or None,
            )
            if dedupe_key in seen_tx_keys:
                continue
            seen_tx_keys.add(dedupe_key)
            receipts.append(
                {
                    "tx_hash": tx_hash,
                    "fact_hash": fact_hash,
                    "proof_type": proof_type,
                    "action": action,
                    "result": row.get("outcome"),
                    "timestamp": timestamp,
                    "meta": _decision_meta(row, tx_source),
                }
            )

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
