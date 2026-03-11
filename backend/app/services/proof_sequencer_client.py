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

PARENT_API_URL = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")
PARENT_LOCAL_URL = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")


@dataclass
class SequencerSubmission:
    """Result of submitting a proof to the parent sequencer."""
    proof_id: str
    fact_hash: str
    block_number: int = -1
    accepted: bool = False


class ProofSequencerClient:
    """
    Client that forwards zkdefi EZKL proofs to the parent Obsqra proof sequencer.

    Tries local parent API first, falls back to remote.
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None
        self._submission_log: list[SequencerSubmission] = []
        self._retry_queue: list[dict] = []

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0)
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
        groth16_calldata: list[str] | None = None,
        honk_calldata: list[str] | None = None,
        kzg_calldata: list[str] | None = None,
        circuit_name: str = "",
    ) -> SequencerSubmission:
        """
        Submit a proof to the parent sequencer for batching and settlement.

        Args:
            proof_id: Unique proof identifier (e.g., EZKL proof hash)
            fact_hash: The proof's fact hash for on-chain registration
            model_name: Which model generated this proof
            metadata: Additional context (timestamp, user, etc.)
            groth16_calldata: Optional Groth16 calldata for on-chain verification
            honk_calldata: Optional HONK calldata for Noir path
            kzg_calldata: Optional native KZG calldata for Path B
            circuit_name: Optional circuit name

        Returns:
            SequencerSubmission with acceptance status and block number.
        """
        payload = {
            "proof_id": proof_id,
            "fact_hash": fact_hash,
            "proof_type": (
                "native_kzg"
                if kzg_calldata
                else ("noir_honk" if honk_calldata else ("groth16" if groth16_calldata else "stark"))
            ),
            "public_inputs": [],
            "source": "zkdefi",
        }
        if groth16_calldata:
            payload["groth16_calldata"] = groth16_calldata
        if honk_calldata:
            payload["honk_calldata"] = honk_calldata
        if kzg_calldata:
            payload["kzg_calldata"] = kzg_calldata
        if circuit_name:
            payload["circuit_name"] = circuit_name
        if metadata:
            payload["metadata"] = metadata

        client = await self._get_client()
        submission = SequencerSubmission(proof_id=proof_id, fact_hash=fact_hash)

        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.post(
                    f"{base_url}/aggregation/submit",
                    json=payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    submission.block_number = data.get("sequencer_block") or data.get("block_number", -1)
                    submission.accepted = True
                    logger.info(
                        "Proof %s submitted to sequencer (block %d) via %s",
                        proof_id[:16], submission.block_number, base_url,
                    )
                    self._submission_log.append(submission)
                    return submission
                else:
                    logger.warning(
                        "Sequencer %s returned %d: %s",
                        base_url, resp.status_code, resp.text[:200],
                    )
            except Exception as exc:
                logger.debug("Sequencer %s unreachable: %s", base_url, exc)

        # All endpoints failed
        logger.warning("All sequencer endpoints unreachable")
        submission.accepted = False
        self._submission_log.append(submission)
        self._retry_queue.append({
            "proof_id": proof_id,
            "fact_hash": fact_hash,
            "model_name": model_name,
            "metadata": metadata,
            "groth16_calldata": groth16_calldata,
            "honk_calldata": honk_calldata,
            "kzg_calldata": kzg_calldata,
            "circuit_name": circuit_name,
            "timestamp": time.time(),
        })
        logger.info("Proof %s: sequencer submission failed (queued for retry)", proof_id[:16])
        return submission

    async def get_pending_retries(self) -> list[dict]:
        """Get proofs that were not accepted and need retry."""
        return list(self._retry_queue)

    async def retry_pending(self) -> int:
        """Retry all pending submissions. Returns number successfully retried."""
        if not self._retry_queue:
            return 0
        pending = list(self._retry_queue)
        self._retry_queue.clear()
        retried = 0
        for item in pending:
            result = await self.submit_proof(
                proof_id=item["proof_id"],
                fact_hash=item["fact_hash"],
                model_name=item.get("model_name", ""),
                metadata=item.get("metadata"),
                groth16_calldata=item.get("groth16_calldata"),
                honk_calldata=item.get("honk_calldata"),
                kzg_calldata=item.get("kzg_calldata"),
                circuit_name=item.get("circuit_name", ""),
            )
            if result.accepted:
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
                pass
        return {"status": "unreachable"}

    async def get_submission_log(self) -> list[dict]:
        """Return local submission log."""
        return [
            {
                "proof_id": s.proof_id,
                "fact_hash": s.fact_hash,
                "block_number": s.block_number,
                "accepted": s.accepted,
            }
            for s in self._submission_log[-50:]
        ]


_client: ProofSequencerClient | None = None


def get_sequencer_client() -> ProofSequencerClient:
    global _client
    if _client is None:
        _client = ProofSequencerClient()
    return _client
