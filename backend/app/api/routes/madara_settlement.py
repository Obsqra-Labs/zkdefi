"""
Madara L3 Settlement Routes (Phase 2 – Gap 23).

Exposes the Madara settlement client to the zkdefi frontend and adds
proof batching logic for aggregating facts before L3 submission.

Routes (all under /api/v1/zkdefi/risk_passport/settlement/madara):
  GET  /health           — Madara L3 health status
  GET  /stats            — settlement statistics
  GET  /config           — settlement layer config (L3 vs L2)
  POST /verify           — verify a fact hash on L3
  GET  /fact-count       — total registered facts
  POST /batch/submit     — submit a batch of facts for aggregated settlement
  GET  /batch/pending     — view pending batch queue
  POST /batch/flush      — force-flush the pending batch
"""

from __future__ import annotations

import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field

from app.services.madara_settlement_client import get_madara_settlement_client

router = APIRouter(tags=["madara-settlement"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Proof batching queue
# ---------------------------------------------------------------------------

@dataclass
class ProofBatchItem:
    id: str
    fact_hash: str
    proof_type: str
    user_address: str
    submitted_at: str
    status: str = "pending"  # pending | batched | verified | failed

@dataclass
class ProofBatchQueue:
    """In-memory queue that aggregates facts before L3 submission."""
    items: deque = field(default_factory=deque)
    batch_size: int = 10
    batches_flushed: int = 0
    last_flush_at: str = ""

    def add(self, fact_hash: str, proof_type: str, user_address: str) -> ProofBatchItem:
        item = ProofBatchItem(
            id=f"batch_{uuid.uuid4().hex[:12]}",
            fact_hash=fact_hash,
            proof_type=proof_type,
            user_address=user_address,
            submitted_at=datetime.now(timezone.utc).isoformat(),
        )
        self.items.append(item)
        return item

    def should_flush(self) -> bool:
        return len(self.items) >= self.batch_size

    def drain(self) -> list[ProofBatchItem]:
        """Drain all pending items for batch submission."""
        items = list(self.items)
        self.items.clear()
        self.batches_flushed += 1
        self.last_flush_at = datetime.now(timezone.utc).isoformat()
        return items


_batch_queue = ProofBatchQueue()


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class VerifyFactRequest(BaseModel):
    fact_hash: str = Field(..., description="The fact hash to verify on L3")

class BatchSubmitRequest(BaseModel):
    fact_hash: str
    proof_type: str = Field(default="zkml", description="Type: zkml, deposit, withdraw, vote")
    user_address: str = ""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/settlement/madara/health")
async def madara_health():
    """Madara L3 health status."""
    client = get_madara_settlement_client()
    result = await client.health()
    return {
        "healthy": result.healthy,
        "enabled": result.enabled,
        "configured": result.configured,
        "rpc_url": result.rpc_url,
        "chain_id": result.chain_id,
        "latest_block": result.latest_block,
        "error": result.error,
    }


@router.get("/settlement/madara/stats")
async def madara_stats():
    """Madara settlement statistics."""
    client = get_madara_settlement_client()
    return await client.stats()


@router.get("/settlement/madara/config")
async def madara_config():
    """Settlement layer configuration (L3 vs L2)."""
    client = get_madara_settlement_client()
    result = await client.settlement_config()
    return {
        "primary_settlement": result.primary_settlement,
        "madara_enabled": result.madara_enabled,
        "madara_configured": result.madara_configured,
        "madara_chain_id": result.madara_chain_id,
        "starknet_l2_enabled": result.starknet_l2_enabled,
        "starknet_l2_network": result.starknet_l2_network,
        "error": result.error,
    }


@router.post("/settlement/madara/verify")
async def madara_verify(req: VerifyFactRequest):
    """Verify a fact hash on Madara L3 FactRegistry."""
    client = get_madara_settlement_client()
    result = await client.verify_fact(req.fact_hash)
    return {
        "valid": result.valid,
        "fact_hash": result.fact_hash,
        "chain_id": result.chain_id,
        "error": result.error,
    }


@router.get("/settlement/madara/fact-count")
async def madara_fact_count():
    """Total facts registered on Madara L3."""
    client = get_madara_settlement_client()
    count = await client.fact_count()
    return {"count": count}


# ---------------------------------------------------------------------------
# Proof batching
# ---------------------------------------------------------------------------

@router.post("/settlement/madara/batch/submit")
async def batch_submit(req: BatchSubmitRequest):
    """
    Submit a fact to the proof batching queue.

    Facts accumulate until batch_size is reached, then are flushed
    as a single aggregated submission to L3.
    """
    item = _batch_queue.add(
        fact_hash=req.fact_hash,
        proof_type=req.proof_type,
        user_address=req.user_address,
    )

    auto_flushed = False
    flush_result: list[dict[str, Any]] = []

    if _batch_queue.should_flush():
        flush_result = await _flush_batch()
        auto_flushed = True

    return {
        "status": "ok",
        "item_id": item.id,
        "queue_size": len(_batch_queue.items),
        "auto_flushed": auto_flushed,
        "flush_result": flush_result if auto_flushed else None,
    }


@router.get("/settlement/madara/batch/pending")
async def batch_pending():
    """View the pending proof batch queue."""
    items = [
        {
            "id": it.id,
            "fact_hash": it.fact_hash,
            "proof_type": it.proof_type,
            "user_address": it.user_address,
            "submitted_at": it.submitted_at,
            "status": it.status,
        }
        for it in _batch_queue.items
    ]
    return {
        "pending_count": len(items),
        "batch_size_threshold": _batch_queue.batch_size,
        "batches_flushed": _batch_queue.batches_flushed,
        "last_flush_at": _batch_queue.last_flush_at,
        "items": items,
    }


@router.post("/settlement/madara/batch/flush")
async def batch_flush():
    """Force-flush the pending batch to L3."""
    if len(_batch_queue.items) == 0:
        return {"status": "empty", "message": "No pending items to flush"}

    results = await _flush_batch()
    return {
        "status": "ok",
        "flushed_count": len(results),
        "results": results,
    }


async def _flush_batch() -> list[dict[str, Any]]:
    """Drain the queue and verify each fact on L3."""
    items = _batch_queue.drain()
    client = get_madara_settlement_client()
    results: list[dict[str, Any]] = []

    for item in items:
        try:
            vr = await client.verify_fact(item.fact_hash)
            item.status = "verified" if vr.valid else "failed"
            results.append({
                "item_id": item.id,
                "fact_hash": item.fact_hash,
                "valid": vr.valid,
                "chain_id": vr.chain_id,
                "error": vr.error,
            })
        except Exception as e:
            item.status = "failed"
            results.append({
                "item_id": item.id,
                "fact_hash": item.fact_hash,
                "valid": False,
                "error": str(e),
            })

    logger.info("Flushed batch of %d facts to L3", len(results))
    return results
