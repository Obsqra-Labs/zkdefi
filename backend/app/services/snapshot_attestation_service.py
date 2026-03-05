"""
Snapshot Attestation Service — registers MarketSnapshot hashes on-chain
BEFORE ML inference, proving the input data existed at a specific time.

Flow:
  1. mainnet_oracle.py produces a MarketSnapshot with snapshot_hash
  2. This service registers snapshot_hash in the Obsqra FactRegistry
  3. ML inference uses the attested snapshot data
  4. The proof pipeline can later verify the snapshot was attested before inference

This creates an immutable input audit trail: every ML decision can be traced
back to an on-chain attestation of the data it was based on.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Obsqra prover API (has both STARK + fact registration endpoints)
OBSQRA_LOCAL_API = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")
OBSQRA_REMOTE_API = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")


@dataclass
class SnapshotAttestation:
    """Record of an attested market snapshot."""
    snapshot_hash: str
    timestamp: int
    data_sources: list[str]
    registered_on_chain: bool
    tx_hash: str
    fact_hash: str


class SnapshotAttestationService:
    """
    Registers market data snapshot hashes on-chain before ML inference.

    Uses the Obsqra FactRegistry (via integrity service or direct HTTP)
    to create an immutable record that the input data existed at a specific time.
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None
        self._attestations: list[SnapshotAttestation] = []

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def attest_snapshot(
        self,
        snapshot_hash: str,
        data_sources: list[str] | None = None,
        metadata: dict | None = None,
    ) -> SnapshotAttestation:
        """
        Register a market snapshot hash on-chain.

        Args:
            snapshot_hash: SHA-256 hash of the snapshot data
            data_sources: List of sources used (e.g., ["ekubo_mainnet", "defi_llama"])
            metadata: Additional context to include in the attestation

        Returns:
            SnapshotAttestation with on-chain registration result.
        """
        timestamp = int(time.time())
        sources = data_sources or ["unknown"]

        # Build fact hash: hash(snapshot_hash, timestamp, sources)
        fact_input = f"{snapshot_hash}:{timestamp}:{','.join(sources)}"
        fact_hash = "0x" + hashlib.sha256(fact_input.encode()).hexdigest()[:62]
        fact_hash_int = int(fact_hash, 16) % (2**251)  # felt252-safe

        # Try to register via Obsqra FactRegistry
        registered = False
        tx_hash = ""

        # Method 1: Via local integrity service
        try:
            from app.services.proof_pipeline import ProofPipeline
            from app.services.obsqra_prover_client import get_obsqra_prover

            prover = get_obsqra_prover()
            health = await prover.health_check()
            if health:
                client = await self._get_client()
                for base_url in [OBSQRA_LOCAL_API, OBSQRA_REMOTE_API]:
                    try:
                        resp = await client.post(
                            f"{base_url}/facts/register",
                            json={
                                "fact_hash": fact_hash,
                                "fact_type": "snapshot_attestation",
                                "source": "zkdefi",
                                "snapshot_hash": snapshot_hash,
                                "timestamp": timestamp,
                                "data_sources": sources,
                                **(metadata or {}),
                            },
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            registered = True
                            tx_hash = data.get("tx_hash", "registered")
                            logger.info(
                                "Snapshot attested on-chain: %s → fact=%s",
                                snapshot_hash[:16], fact_hash[:16],
                            )
                            break
                    except Exception as e:
                        logger.debug("Fact registration via %s failed: %s", base_url, e)
        except Exception as e:
            logger.debug("Integrity-based attestation failed: %s", e)

        # Method 2: Submit to parent proof sequencer as a fact
        if not registered:
            try:
                from app.services.proof_sequencer_client import get_sequencer_client
                seq = get_sequencer_client()
                result = await seq.submit_proof(
                    proof_id=f"snapshot_{snapshot_hash[:16]}",
                    fact_hash=fact_hash,
                    model_name="snapshot_attestation",
                    metadata={"sources": sources, "timestamp": timestamp},
                )
                if result.accepted:
                    registered = True
                    tx_hash = f"sequencer_block_{result.block_number}"
            except Exception as e:
                logger.debug("Sequencer-based attestation failed: %s", e)

        attestation = SnapshotAttestation(
            snapshot_hash=snapshot_hash,
            timestamp=timestamp,
            data_sources=sources,
            registered_on_chain=registered,
            tx_hash=tx_hash,
            fact_hash=fact_hash,
        )

        self._attestations.append(attestation)

        if not registered:
            logger.warning(
                "Snapshot %s attested locally only (on-chain registration failed)",
                snapshot_hash[:16],
            )

        return attestation

    async def attest_market_snapshot(self, snapshot: dict) -> SnapshotAttestation:
        """
        Convenience method to attest a MarketSnapshot dict (from mainnet_oracle.py).

        The snapshot should have a 'snapshot_hash' field. If missing, one is computed.
        """
        snapshot_hash = snapshot.get("snapshot_hash", "")
        if not snapshot_hash:
            import json
            sorted_data = json.dumps(snapshot, sort_keys=True)
            snapshot_hash = hashlib.sha256(sorted_data.encode()).hexdigest()

        sources = []
        if snapshot.get("eth_usd"):
            sources.append("pragma_oracle")
        if snapshot.get("ekubo_pools"):
            sources.append("ekubo")
        if snapshot.get("defi_llama_yields"):
            sources.append("defi_llama")
        if not sources:
            sources.append("local")

        return await self.attest_snapshot(snapshot_hash, sources)

    async def verify_attestation(self, snapshot_hash: str) -> bool:
        """
        Verify that a snapshot was attested on-chain.

        Checks the Obsqra FactRegistry for the fact hash derived from the snapshot.
        """
        # Rebuild fact hash from snapshot_hash
        for attestation in reversed(self._attestations):
            if attestation.snapshot_hash == snapshot_hash:
                if attestation.registered_on_chain:
                    return True
                break

        # Check on-chain fact registry
        try:
            client = await self._get_client()
            for base_url in [OBSQRA_LOCAL_API, OBSQRA_REMOTE_API]:
                try:
                    resp = await client.get(
                        f"{base_url}/facts/verify",
                        params={"snapshot_hash": snapshot_hash},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return data.get("valid", False)
                except Exception:
                    continue
        except Exception:
            pass

        return False

    def get_attestation_log(self) -> list[dict]:
        """Return local attestation log."""
        return [
            {
                "snapshot_hash": a.snapshot_hash[:16] + "...",
                "timestamp": a.timestamp,
                "sources": a.data_sources,
                "on_chain": a.registered_on_chain,
                "fact_hash": a.fact_hash[:16] + "...",
            }
            for a in self._attestations[-100:]
        ]


# ── Singleton ─────────────────────────────────────────────────────────
_service: SnapshotAttestationService | None = None


def get_attestation_service() -> SnapshotAttestationService:
    global _service
    if _service is None:
        _service = SnapshotAttestationService()
    return _service
