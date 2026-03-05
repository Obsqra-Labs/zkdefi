"""
Reputation Passport Client — zkdefi → obsqra aggregation bridge.

Calls the parent Obsqra backend's POST /api/v1/aggregation/passport to generate
STARK-proven reputation passports. Used by the zkdefi proof pipeline and
risk passport API.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

PARENT_LOCAL_URL = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")
PARENT_API_URL = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")


@dataclass
class PassportResult:
    """Result from a reputation passport aggregation request."""
    success: bool
    aggregated_commitment: str = ""
    weighted_score: int = 0
    tier: int = 0
    tier_name: str = ""
    badge_count: int = 0
    proof_hash: str = ""
    fact_hash: str = ""
    proof_size_kb: float = 0.0
    generation_time_ms: float = 0.0
    n_steps: int = 0
    registered_on_chain: bool = False
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "aggregated_commitment": self.aggregated_commitment,
            "weighted_score": self.weighted_score,
            "tier": self.tier,
            "tier_name": self.tier_name,
            "badge_count": self.badge_count,
            "proof_hash": self.proof_hash,
            "fact_hash": self.fact_hash,
            "proof_size_kb": self.proof_size_kb,
            "generation_time_ms": self.generation_time_ms,
            "n_steps": self.n_steps,
            "registered_on_chain": self.registered_on_chain,
            "error": self.error,
        }


class ReputationPassportClient:
    """
    HTTP client that calls obsqra's POST /api/v1/aggregation/passport
    to generate STARK-proven reputation passports.
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def aggregate_passport(
        self,
        badge_fact_hashes: dict[str, str],
        tier_thresholds: list[int] | None = None,
        timestamp: int | None = None,
    ) -> PassportResult:
        """
        Request a STARK-proven reputation passport from the obsqra backend.

        Args:
            badge_fact_hashes: Map of badge_type → fact_hash (hex string).
            tier_thresholds: Override tier thresholds [bronze, silver, gold, diamond].
            timestamp: Unix epoch. Defaults to server time.

        Returns:
            PassportResult with STARK proof details.
        """
        client = await self._get_client()

        payload: dict[str, Any] = {
            "badge_fact_hashes": badge_fact_hashes,
        }
        if tier_thresholds:
            payload["tier_thresholds"] = tier_thresholds
        if timestamp:
            payload["timestamp"] = timestamp

        # Try local parent API first, fallback to remote
        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.post(
                    f"{base_url}/aggregation/passport",
                    json=payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("success"):
                        proof = data.get("proof", {})
                        result = PassportResult(
                            success=True,
                            aggregated_commitment=data.get("aggregated_commitment", ""),
                            weighted_score=data.get("weighted_score", 0),
                            tier=data.get("tier", 0),
                            tier_name=data.get("tier_name", ""),
                            badge_count=data.get("badge_count", 0),
                            proof_hash=proof.get("proof_hash", ""),
                            fact_hash=proof.get("fact_hash", ""),
                            proof_size_kb=proof.get("proof_size_kb", 0.0),
                            generation_time_ms=proof.get("generation_time_ms", 0.0),
                            n_steps=proof.get("n_steps", 0),
                            registered_on_chain=proof.get("registered_on_chain", False),
                        )
                        logger.info(
                            "Passport aggregated via %s: tier=%s, %d badges, %.1fs",
                            base_url,
                            result.tier_name,
                            result.badge_count,
                            result.generation_time_ms / 1000,
                        )
                        return result
                    else:
                        return PassportResult(
                            success=False,
                            error=data.get("error", "Unknown error"),
                            badge_count=data.get("badge_count", 0),
                        )
                else:
                    logger.warning(
                        "Passport request to %s returned %d: %s",
                        base_url,
                        resp.status_code,
                        resp.text[:200],
                    )
            except Exception as e:
                logger.debug("Passport request to %s failed: %s", base_url, e)
                continue

        return PassportResult(
            success=False,
            error="Could not reach obsqra aggregation service",
        )

    async def get_passport_config(self) -> dict[str, Any]:
        """Fetch passport configuration (badge weights, tier thresholds)."""
        client = await self._get_client()

        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.get(f"{base_url}/aggregation/passport/config")
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                continue

        return {"status": "unreachable"}


# ── Singleton ────────────────────────────────────────────────────────────────

_client: ReputationPassportClient | None = None


def get_reputation_passport_client() -> ReputationPassportClient:
    global _client
    if _client is None:
        _client = ReputationPassportClient()
    return _client
