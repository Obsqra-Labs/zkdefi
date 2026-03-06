"""
Madara Settlement Client — zkdefi → obsqra Madara L3 bridge.

Provides zkdefi backend access to Madara appchain settlement status
via the parent obsqra API. This lets the zkdefi frontend show users
which settlement layer their proofs landed on (Madara L3 vs Starknet L2).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Parent obsqra API (same pattern as other clients)
PARENT_API_URL = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")
PARENT_LOCAL_URL = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")


@dataclass
class MadaraHealthResult:
    """Health status of Madara L3 from parent API."""
    healthy: bool
    enabled: bool = False
    configured: bool = False
    rpc_url: str = ""
    chain_id: str = ""
    latest_block: int = 0
    error: str = ""


@dataclass
class SettlementConfigResult:
    """Settlement configuration from parent API."""
    primary_settlement: str = "starknet_l2"
    madara_enabled: bool = False
    madara_configured: bool = False
    madara_chain_id: str = ""
    starknet_l2_enabled: bool = True
    starknet_l2_network: str = "sepolia"
    error: str = ""


@dataclass
class FactVerifyResult:
    """Result of verifying a fact on Madara L3."""
    valid: bool
    fact_hash: str = ""
    chain_id: str = ""
    error: str = ""


class MadaraSettlementClient:
    """
    HTTP client for querying Madara L3 settlement status via parent obsqra API.

    Endpoints used:
      GET  /aggregation/madara/health
      GET  /aggregation/madara/stats
      GET  /aggregation/settlement/config
      POST /aggregation/madara/verify
      GET  /aggregation/madara/fact-count
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _get(self, path: str) -> dict | None:
        """GET request to parent API with local/remote fallback."""
        client = await self._get_client()
        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.get(f"{base_url}/aggregation/{path}")
                if resp.status_code == 200:
                    return resp.json()
            except Exception as e:
                logger.debug("Madara client %s/%s failed: %s", base_url, path, e)
        return None

    async def _post(self, path: str, payload: dict) -> dict | None:
        """POST request to parent API with local/remote fallback."""
        client = await self._get_client()
        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.post(
                    f"{base_url}/aggregation/{path}",
                    json=payload,
                )
                if resp.status_code == 200:
                    return resp.json()
            except Exception as e:
                logger.debug("Madara client POST %s/%s failed: %s", base_url, path, e)
        return None

    async def health(self) -> MadaraHealthResult:
        """Check Madara L3 health via parent API."""
        data = await self._get("madara/health")
        if data is None:
            return MadaraHealthResult(
                healthy=False,
                error="Parent obsqra API unreachable",
            )
        return MadaraHealthResult(
            healthy=data.get("healthy", False),
            enabled=data.get("enabled", False),
            configured=data.get("configured", False),
            rpc_url=data.get("rpc_url", ""),
            chain_id=data.get("chain_id", ""),
            latest_block=data.get("latest_block", 0),
            error=data.get("error", ""),
        )

    async def stats(self) -> dict:
        """Get Madara settlement statistics."""
        data = await self._get("madara/stats")
        return data or {"error": "unreachable"}

    async def settlement_config(self) -> SettlementConfigResult:
        """Get current settlement configuration (Madara L3 vs Starknet L2)."""
        data = await self._get("settlement/config")
        if data is None:
            return SettlementConfigResult(error="Parent obsqra API unreachable")

        madara = data.get("madara", {})
        l2 = data.get("starknet_l2", {})

        return SettlementConfigResult(
            primary_settlement=data.get("primary_settlement", "starknet_l2"),
            madara_enabled=madara.get("enabled", False),
            madara_configured=madara.get("configured", False),
            madara_chain_id=madara.get("chain_id", ""),
            starknet_l2_enabled=l2.get("enabled", True),
            starknet_l2_network=l2.get("network", "sepolia"),
        )

    async def verify_fact(self, fact_hash: str) -> FactVerifyResult:
        """Verify a fact hash on Madara L3 FactRegistry."""
        data = await self._post("madara/verify", {"fact_hash": fact_hash})
        if data is None:
            return FactVerifyResult(
                valid=False,
                fact_hash=fact_hash,
                error="Parent obsqra API unreachable",
            )
        return FactVerifyResult(
            valid=data.get("valid", False),
            fact_hash=data.get("fact_hash", fact_hash),
            chain_id=data.get("chain_id", ""),
            error=data.get("error", ""),
        )

    async def fact_count(self) -> int:
        """Get total facts registered on Madara L3."""
        data = await self._get("madara/fact-count")
        if data is None:
            return 0
        return data.get("count", 0)


# ── Singleton ─────────────────────────────────────────────────────────
_client_instance: MadaraSettlementClient | None = None


def get_madara_settlement_client() -> MadaraSettlementClient:
    """Get or create the singleton MadaraSettlementClient."""
    global _client_instance
    if _client_instance is None:
        _client_instance = MadaraSettlementClient()
    return _client_instance
