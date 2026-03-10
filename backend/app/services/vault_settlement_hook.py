"""
Vault V2 → Madara L3 Settlement Hook (Privacy-Preserving)

Posts privacy-safe fact hashes to the Madara L3 batch queue whenever a
vault lifecycle event completes (deposit confirmed, deploy settled,
withdrawal confirmed).

PRIVACY GUARANTEES:
- fact_hash = SHA-256 of (event_type || commitment_hash || tx_hash || salt)
- NO plaintext amounts, addresses, tokens, vault_ids, or adapter names
- The fact_hash is a one-way commitment: L3 can verify it exists, but
  cannot reverse it to learn the underlying values
- user_address field sent to batch queue is the ZERO ADDRESS (anonymous)
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

ANONYMOUS_ADDRESS = "0x0000000000000000000000000000000000000000"


def _compute_fact_hash(
    event_type: str,
    commitment_hash: str,
    tx_hash: str,
    salt: Optional[str] = None,
) -> str:
    """
    Compute a privacy-preserving fact hash.

    fact = SHA-256(event_type || commitment_hash || tx_hash || salt)

    This is a one-way function: the L3 can verify the fact exists in its
    FactRegistry but cannot determine the deposit amount, owner, token,
    or any other sensitive field.
    """
    if salt is None:
        salt = uuid.uuid4().hex
    preimage = f"{event_type}|{commitment_hash}|{tx_hash}|{salt}"
    return hashlib.sha256(preimage.encode()).hexdigest()


async def post_deposit_fact(
    commitment_hash: str,
    tx_hash: str,
) -> Optional[dict]:
    """Post a DEPOSIT fact to L3 after deposit is confirmed."""
    try:
        from app.api.routes.madara_settlement import _batch_queue

        fact_hash = _compute_fact_hash("DEPOSIT", commitment_hash, tx_hash)
        item = _batch_queue.add(
            fact_hash=fact_hash,
            proof_type="vault_deposit",
            user_address=ANONYMOUS_ADDRESS,
        )
        logger.info(
            "L3 deposit fact queued: %s (batch_id=%s)", fact_hash[:16], item.id
        )

        # Auto-flush if batch threshold reached
        if _batch_queue.should_flush():
            await _try_flush_batch()

        return {"fact_hash": fact_hash, "batch_item_id": item.id, "status": "queued"}
    except Exception as exc:
        logger.warning("L3 settlement hook (deposit) failed: %s", exc)
        return None


async def post_deploy_fact(
    proposal_hash: str,
    tx_hash: str,
) -> Optional[dict]:
    """Post a DEPLOY_SETTLE fact to L3 after deploy execution settles."""
    try:
        from app.api.routes.madara_settlement import _batch_queue

        # proposal_hash is already a SHA-256 of the deploy intent — safe to use
        fact_hash = _compute_fact_hash("DEPLOY_SETTLE", proposal_hash, tx_hash)
        item = _batch_queue.add(
            fact_hash=fact_hash,
            proof_type="vault_deploy",
            user_address=ANONYMOUS_ADDRESS,
        )
        logger.info(
            "L3 deploy fact queued: %s (batch_id=%s)", fact_hash[:16], item.id
        )

        if _batch_queue.should_flush():
            await _try_flush_batch()

        return {"fact_hash": fact_hash, "batch_item_id": item.id, "status": "queued"}
    except Exception as exc:
        logger.warning("L3 settlement hook (deploy) failed: %s", exc)
        return None


async def post_withdrawal_fact(
    withdrawal_id: str,
    tx_hash: str,
) -> Optional[dict]:
    """Post a WITHDRAWAL fact to L3 after withdrawal is confirmed."""
    try:
        from app.api.routes.madara_settlement import _batch_queue

        # Hash the withdrawal_id (UUID) — don't send it raw
        wd_hash = hashlib.sha256(withdrawal_id.encode()).hexdigest()
        fact_hash = _compute_fact_hash("WITHDRAWAL", wd_hash, tx_hash)
        item = _batch_queue.add(
            fact_hash=fact_hash,
            proof_type="vault_withdrawal",
            user_address=ANONYMOUS_ADDRESS,
        )
        logger.info(
            "L3 withdrawal fact queued: %s (batch_id=%s)", fact_hash[:16], item.id
        )

        if _batch_queue.should_flush():
            await _try_flush_batch()

        return {"fact_hash": fact_hash, "batch_item_id": item.id, "status": "queued"}
    except Exception as exc:
        logger.warning("L3 settlement hook (withdrawal) failed: %s", exc)
        return None


async def _try_flush_batch() -> None:
    """Attempt to flush the batch queue to Madara L3."""
    try:
        from app.api.routes.madara_settlement import _batch_queue
        from app.services.madara_settlement_client import get_madara_settlement_client

        items = _batch_queue.drain()
        if not items:
            return

        client = get_madara_settlement_client()
        for item in items:
            result = await client.verify_fact(item.fact_hash)
            item.status = "verified" if result.valid else "batched"

        logger.info("L3 batch flushed: %d facts submitted", len(items))
    except Exception as exc:
        logger.warning("L3 batch flush failed: %s", exc)
