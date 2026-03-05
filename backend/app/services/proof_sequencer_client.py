"""
Proof Sequencer Client — forwards EZKL proofs to parent Obsqra proof sequencer.

After every EZKL proof generation in zkdefi, this client:
  1. POSTs to parent's /api/v1/aggregation/submit
  2. The parent sequencer batches proofs into blocks
  3. Recursive STARK proofs are generated per block
  4. Settlement: aggregated fact hash registered in Obsqra FactRegistry

This creates a proof-centric sequencing layer where zkdefi's individual
EZKL proofs become part of a larger verified batch.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

# Parent Obsqra prover/sequencer API
PARENT_API_URL = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")
PARENT_LOCAL_URL = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")


@dataclass
class SequencerSubmission:
    """Result of submitting a proof to the parent sequencer."""
    proof_id: str
    fact_hash: str
    block_number: int
    accepted: bool
    error: str = ""


class ProofSequencerClient:
    """
    Client that forwards zkdefi EZKL proofs to the parent Obsqra proof sequencer.

    Tries local parent API first, falls back to remote.
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None
        self._submission_log: list[SequencerSubmission] = []

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def submit_proof(
        self,
        proof_id: str,
        fact_hash: str,
        model_name: str = "",
        metadata: dict | None = None,
    ) -> SequencerSubmission:
        """
        Submit a proof to the parent sequencer for batching and settlement.

        Args:
            proof_id: Unique proof identifier (e.g., EZKL proof hash)
            fact_hash: The proof's fact hash for on-chain registration
            model_name: Which model generated this proof
            metadata: Additional context (timestamp, user, etc.)

        Returns:
            SequencerSubmission with acceptance status and block number.
        """
        client = await self._get_client()

        payload = {
            "proof_id": proof_id,
            "fact_hash": fact_hash,
            "model_name": model_name,
            "source": "zkdefi",
            "timestamp": int(time.time()),
            **(metadata or {}),
        }

        # Try local parent API first
        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.post(
                    f"{base_url}/aggregation/submit",
                    json=payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    submission = SequencerSubmission(
                        proof_id=proof_id,
                        fact_hash=fact_hash,
                        block_number=int(data.get("block_number", 0)),
                        accepted=True,
                    )
                    self._submission_log.append(submission)
                    logger.info(
                        "Proof %s submitted to sequencer (block %d) via %s",
                        proof_id[:12], submission.block_number, base_url,
                    )
                    return submission

                logger.debug(
                    "Sequencer %s returned %d: %s",
                    base_url, resp.status_code, resp.text[:200],
                )

            except Exception as e:
                logger.debug("Sequencer %s unreachable: %s", base_url, e)

        # All endpoints failed — log locally for retry
        submission = SequencerSubmission(
            proof_id=proof_id,
            fact_hash=fact_hash,
            block_number=-1,
            accepted=False,
            error="All sequencer endpoints unreachable",
        )
        self._submission_log.append(submission)
        logger.warning("Proof %s: sequencer submission failed (queued for retry)", proof_id[:12])
        return submission

    async def get_pending_retries(self) -> list[SequencerSubmission]:
        """Get proofs that were not accepted and need retry."""
        return [s for s in self._submission_log if not s.accepted]

    async def retry_pending(self) -> int:
        """Retry all pending submissions. Returns number successfully retried."""
        pending = await self.get_pending_retries()
        retried = 0
        for sub in pending:
            result = await self.submit_proof(sub.proof_id, sub.fact_hash)
            if result.accepted:
                # Remove old failed entry
                self._submission_log = [
                    s for s in self._submission_log
                    if not (s.proof_id == sub.proof_id and not s.accepted)
                ]
                retried += 1
        return retried

    async def get_sequencer_stats(self) -> dict:
        """Query the parent sequencer for its current stats."""
        client = await self._get_client()

        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.get(f"{base_url}/aggregation/stats")
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                continue

        return {"status": "unreachable", "submitted_count": len(self._submission_log)}

    def get_submission_log(self) -> list[dict]:
        """Return local submission log."""
        return [
            {
                "proof_id": s.proof_id[:16] + "...",
                "fact_hash": s.fact_hash[:16] + "...",
                "block_number": s.block_number,
                "accepted": s.accepted,
            }
            for s in self._submission_log[-100:]  # Last 100
        ]


# ── Singleton ─────────────────────────────────────────────────────────
_client: ProofSequencerClient | None = None


def get_sequencer_client() -> ProofSequencerClient:
    global _client
    if _client is None:
        _client = ProofSequencerClient()
    return _client
