"""
Batch Verification API routes.

Exposes the BatchVerifier contract functionality via REST endpoints.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class QueueActionRequest(BaseModel):
    user_address: str
    action_hash: str


class SubmitBatchRequest(BaseModel):
    batch_proof_hash: str
    action_count: int


class ChallengeRequest(BaseModel):
    action_index: int
    fraud_proof_hash: str


@router.post("/batch/queue")
async def queue_action(req: QueueActionRequest):
    """Queue an action for batch verification."""
    from app.services.batch_verification_service import get_batch_verifier_service
    svc = get_batch_verifier_service()
    result = await svc.queue_action(req.user_address, req.action_hash)
    return result


@router.post("/batch/submit")
async def submit_batch_proof(req: SubmitBatchRequest):
    """Submit a batch proof for pending actions."""
    from app.services.batch_verification_service import get_batch_verifier_service
    svc = get_batch_verifier_service()
    result = await svc.submit_batch_proof(req.batch_proof_hash, req.action_count)
    return {
        "batch_proof_hash": result.batch_proof_hash,
        "action_count": result.action_count,
        "tx_hash": result.tx_hash,
        "success": result.success,
        "error": result.error,
    }


@router.post("/batch/process")
async def process_batch():
    """Automatically batch-prove all pending actions."""
    from app.services.batch_verification_service import get_batch_verifier_service
    svc = get_batch_verifier_service()
    result = await svc.process_batch()
    if result is None:
        return {"status": "no_pending_actions"}
    return {
        "batch_proof_hash": result.batch_proof_hash,
        "action_count": result.action_count,
        "tx_hash": result.tx_hash,
        "success": result.success,
    }


@router.post("/batch/challenge")
async def challenge_action(req: ChallengeRequest):
    """Challenge a pending action with a fraud proof."""
    from app.services.batch_verification_service import get_batch_verifier_service
    svc = get_batch_verifier_service()
    result = await svc.challenge_action(req.action_index, req.fraud_proof_hash)
    return result


@router.get("/batch/pending")
async def get_pending():
    """Get pending action count and local queue."""
    from app.services.batch_verification_service import get_batch_verifier_service
    svc = get_batch_verifier_service()
    count = await svc.get_pending_count()
    return {
        "pending_count": count,
        "local_queue": svc.get_local_queue(),
    }


@router.get("/batch/history")
async def get_batch_history():
    """Get batch submission history."""
    from app.services.batch_verification_service import get_batch_verifier_service
    svc = get_batch_verifier_service()
    return {
        "batches": svc.get_batch_history(),
        "challenge_window_seconds": await svc.get_challenge_window(),
    }
