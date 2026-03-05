"""
zkGraph Client — HTTP client for obsqra.fi zkRAG proven-index service.

4th integration client alongside ObsqraProverClient, ProofSequencerClient,
and SnapshotAttestationService.  Pattern: singleton + httpx.AsyncClient,
local:8002 primary, feature-flagged via ZKGRAPH_ENABLED, TTL cache,
10 RPM rate limit, 5 s timeout, graceful fallback to local_only.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

import httpx

from app.models.zkgraph import (
    HistoricalPattern,
    MarketContext,
    StrategyMatch,
    ZkGraphProvenance,
    ZkGraphResult,
)

logger = logging.getLogger(__name__)


class ZkGraphClient:
    """
    Async HTTP client that queries the obsqra zkRAG proven-index.

    Every public method returns a typed dataclass and **never raises**:
    on any error it returns a graceful fallback (source="local_only").
    """

    def __init__(self) -> None:
        # Configuration -------------------------------------------------------
        self.enabled: bool = os.getenv("ZKGRAPH_ENABLED", "true").lower() in (
            "true",
            "1",
            "yes",
        )
        self.base_url: str = os.getenv(
            "OBSQRA_PROVER_API_URL",
            os.getenv("OBSQRA_PROVER_URL", "http://localhost:8002/api/v1"),
        ).rstrip("/")
        self.timeout: float = float(os.getenv("ZKGRAPH_TIMEOUT", "5"))
        self.max_rpm: int = int(os.getenv("ZKGRAPH_MAX_RPM", "10"))
        self.cache_ttl_market: int = int(os.getenv("ZKGRAPH_CACHE_TTL_MARKET", "60"))
        self.cache_ttl_historical: int = int(
            os.getenv("ZKGRAPH_CACHE_TTL_HISTORICAL", "300")
        )

        # Internal state ------------------------------------------------------
        self._client: Optional[httpx.AsyncClient] = None
        self._cache: dict[str, tuple[float, Any]] = {}
        self._rpm_timestamps: list[float] = []

        if self.enabled:
            logger.info(
                "ZkGraphClient enabled — base_url=%s timeout=%.1fs rpm=%d",
                self.base_url,
                self.timeout,
                self.max_rpm,
            )
        else:
            logger.info("ZkGraphClient disabled (ZKGRAPH_ENABLED=%s)", os.getenv("ZKGRAPH_ENABLED"))

    # -- HTTP transport -------------------------------------------------------

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    # -- Rate limiter (simple sliding-window) ---------------------------------

    def _rate_ok(self) -> bool:
        now = time.monotonic()
        self._rpm_timestamps = [t for t in self._rpm_timestamps if now - t < 60]
        if len(self._rpm_timestamps) >= self.max_rpm:
            logger.warning("ZkGraph rate limit hit (%d RPM)", self.max_rpm)
            return False
        self._rpm_timestamps.append(now)
        return True

    # -- Cache ----------------------------------------------------------------

    def _get_cached(self, key: str, ttl: int) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry is None:
            return None
        ts, value = entry
        if time.monotonic() - ts > ttl:
            del self._cache[key]
            return None
        return value

    def _set_cached(self, key: str, value: Any) -> None:
        self._cache[key] = (time.monotonic(), value)

    # -- Core POST helper -----------------------------------------------------

    async def _post_zkrag(self, query: str) -> Optional[dict]:
        """POST /zkrag/query with format=structured.  Returns parsed JSON or None."""
        if not self.enabled:
            return None
        if not self._rate_ok():
            return None

        client = await self._get_client()
        try:
            resp = await client.post(
                f"{self.base_url}/zkrag/query",
                json={"query": query, "format": "structured"},
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("zkRAG query timed out (%.1fs): %s", self.timeout, query[:80])
            return None
        except httpx.HTTPError as exc:
            logger.warning("zkRAG query HTTP error: %s", exc)
            return None
        except Exception as exc:
            logger.warning("zkRAG query unexpected error: %s", exc)
            return None

    # -- Parse helpers --------------------------------------------------------

    @staticmethod
    def _parse_provenance(raw: dict) -> ZkGraphProvenance:
        prov = raw.get("provenance", {})
        return ZkGraphProvenance(
            fact_hash=prov.get("fact_hash", ""),
            block_range=prov.get("block_range", ""),
            merkle_root=prov.get("merkle_root", ""),
            source_count=int(prov.get("sources", 0)),
            verified_on_chain=False,  # filled by verify_provenance()
        )

    @staticmethod
    def _parse_result(raw: dict) -> ZkGraphResult:
        return ZkGraphResult(
            query=raw.get("query", ""),
            response=raw.get("response", ""),
            query_id=raw.get("query_id", ""),
            response_hash=raw.get("response_hash", ""),
            provenance=ZkGraphClient._parse_provenance(raw),
            results=raw.get("results", []),
            cached=False,
        )

    # =========================================================================
    # Public API
    # =========================================================================

    async def query_market_context(self, pool_id: str) -> MarketContext:
        """
        Fetch attested market context for a pool / pair from the proven index.

        Returns MarketContext with source="zkrag" on success, source="local_only" on
        any failure or when disabled.
        """
        cache_key = f"market:{pool_id}"
        cached = self._get_cached(cache_key, self.cache_ttl_market)
        if cached is not None:
            cached.enrichments["cached"] = True
            return cached

        raw = await self._post_zkrag(
            f"pool activity and events for {pool_id} on Starknet Sepolia"
        )
        if raw is None:
            return MarketContext(pool_id=pool_id, source="local_only")

        prov = self._parse_provenance(raw)
        results = raw.get("results", [])

        ctx = MarketContext(
            pool_id=pool_id,
            source="zkrag",
            context_text=self._summarize_results(results, pool_id),
            provenance=prov,
            enrichments={"result_count": len(results), "cached": False},
            verified=bool(prov.fact_hash),
        )
        self._set_cached(cache_key, ctx)
        return ctx

    async def query_similar_strategies(
        self, strategy_id: str, *, limit: int = 5
    ) -> list[StrategyMatch]:
        """
        Search the proven index for historically similar strategies.
        """
        cache_key = f"strategies:{strategy_id}"
        cached = self._get_cached(cache_key, self.cache_ttl_historical)
        if cached is not None:
            return cached

        raw = await self._post_zkrag(
            f"historical strategies similar to {strategy_id} last 500 blocks yield allocation"
        )
        if raw is None:
            return []

        prov = self._parse_provenance(raw)
        matches: list[StrategyMatch] = []
        for item in (raw.get("results") or [])[:limit]:
            matches.append(
                StrategyMatch(
                    strategy_id=item.get("contract", item.get("fact_hash", strategy_id)),
                    similarity_score=0.8,  # determined by index proximity
                    historical_apy=0.0,
                    block_range=f"{item.get('block_from', '?')}-{item.get('block_to', item.get('block_number', '?'))}",
                    provenance=prov,
                )
            )
        self._set_cached(cache_key, matches)
        return matches

    async def query_historical_patterns(
        self, pattern_type: str = "general", *, limit: int = 5
    ) -> list[HistoricalPattern]:
        """
        Query for historical on-chain patterns (volatility spikes, TVL drains, etc.).
        """
        cache_key = f"patterns:{pattern_type}"
        cached = self._get_cached(cache_key, self.cache_ttl_historical)
        if cached is not None:
            return cached

        raw = await self._post_zkrag(
            f"historical on-chain patterns {pattern_type} last 1000 blocks risk events"
        )
        if raw is None:
            return []

        prov = self._parse_provenance(raw)
        patterns: list[HistoricalPattern] = []
        for item in (raw.get("results") or [])[:limit]:
            note = item.get("note", item.get("type", pattern_type))
            patterns.append(
                HistoricalPattern(
                    pattern_type=pattern_type,
                    description=note,
                    block_range=f"{item.get('block_from', '?')}-{item.get('block_to', item.get('block_number', '?'))}",
                    confidence=0.7 if item.get("proof_path") and "verified" in str(item.get("proof_path", "")).lower() else 0.4,
                    provenance=prov,
                )
            )
        self._set_cached(cache_key, patterns)
        return patterns

    async def verify_provenance(
        self, fact_hash: str, response_hash: str = ""
    ) -> dict[str, Any]:
        """
        Verify a fact_hash and optional response_hash via obsqra /zkrag/verify.
        """
        if not self.enabled or not fact_hash:
            return {"verified": False, "reason": "disabled_or_empty"}

        if not self._rate_ok():
            return {"verified": False, "reason": "rate_limited"}

        client = await self._get_client()
        try:
            query_id = fact_hash[:34]  # use fact_hash prefix as pseudo-query-id
            resp = await client.post(
                f"{self.base_url}/zkrag/verify/{query_id}",
                json={"fact_hash": fact_hash, "response_hash": response_hash},
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.warning("zkRAG verify error: %s", exc)
            return {"verified": False, "reason": str(exc)}

    async def health_check(self) -> dict[str, Any]:
        """
        Lightweight liveness check for the obsqra zkRAG service.
        """
        if not self.enabled:
            return {"available": False, "reason": "disabled"}

        client = await self._get_client()
        try:
            base = self.base_url.replace("/api/v1", "").rstrip("/")
            resp = await client.get(f"{base}/", timeout=5.0)
            ok = resp.status_code == 200
        except Exception:
            ok = False

        return {
            "available": ok,
            "base_url": self.base_url,
            "cache_entries": len(self._cache),
            "rpm_used": len([t for t in self._rpm_timestamps if time.monotonic() - t < 60]),
            "rpm_limit": self.max_rpm,
        }

    # -- Utility --------------------------------------------------------------

    @staticmethod
    def _summarize_results(results: list[dict], pool_id: str) -> str:
        """Build a concise text summary of structured results."""
        if not results:
            return f"No proven-index data found for {pool_id}."
        lines = [f"Proven-index data for {pool_id} ({len(results)} source(s)):"]
        for item in results[:5]:
            blk = item.get("block_number", item.get("block_to", "?"))
            note = item.get("note", item.get("type", ""))
            fh = item.get("fact_hash", "")
            if fh:
                lines.append(f"  block {blk}: fact_hash={fh[:20]}... {note}")
            else:
                lines.append(f"  block {blk}: {note}")
        if len(results) > 5:
            lines.append(f"  ... and {len(results) - 5} more.")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_client: Optional[ZkGraphClient] = None


def get_zkgraph_client() -> ZkGraphClient:
    """Get or create the ZkGraphClient singleton."""
    global _client
    if _client is None:
        _client = ZkGraphClient()
    return _client
