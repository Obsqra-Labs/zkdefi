"""
ZkGraph Client: Query attested on-chain intelligence from obsqra.fi zkRAG API

This client provides rate-limited, cached access to the obsqra proven index.
All methods fail-open (return local_only fallbacks on error).
"""

import logging
import os
import time
from typing import Optional, List, Dict, Any
from collections import deque
import httpx

from app.models.zkgraph import (
    ZkGraphProvenance,
    ZkGraphResult,
    MarketContext,
    HistoricalPattern,
    StrategyMatch,
)

logger = logging.getLogger(__name__)


class ZkGraphClient:
    """
    Singleton client for querying obsqra's zkRAG API
    
    Features:
    - Rate limiting: 10 requests per minute (sliding window)
    - TTL caching: 60s for market context, 300s for historical data
    - Fail-open: Returns source="local_only" on any error
    - Structured format: Always requests structured JSON responses
    """
    
    _instance: Optional['ZkGraphClient'] = None
    
    def __init__(self):
        self.base_url = os.getenv(
            "OBSQRA_PROVER_API_URL",
            "http://localhost:8002/api/v1"
        )
        self.enabled = os.getenv("ZKGRAPH_ENABLED", "").lower() == "true"
        
        # Rate limiting: 10 RPM sliding window
        self.rate_limit_rpm = 10
        self.request_timestamps: deque = deque(maxlen=self.rate_limit_rpm)
        
        # TTL caches
        self.market_context_cache: Dict[str, Dict[str, Any]] = {}
        self.historical_cache: Dict[str, Dict[str, Any]] = {}
        self.market_ttl = 60  # 60 seconds
        self.historical_ttl = 300  # 5 minutes
        
        self.client = httpx.AsyncClient(timeout=30.0)
        
        if self.enabled:
            logger.info(f"ZkGraphClient initialized: {self.base_url}")
        else:
            logger.info("ZkGraphClient disabled (ZKGRAPH_ENABLED != true)")
    
    @classmethod
    def get_instance(cls) -> 'ZkGraphClient':
        """Get singleton instance"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def _check_rate_limit(self) -> bool:
        """Check if we're under rate limit (10 RPM)"""
        now = time.time()
        
        # Remove timestamps older than 1 minute
        while self.request_timestamps and now - self.request_timestamps[0] > 60:
            self.request_timestamps.popleft()
        
        # Check if we have room
        if len(self.request_timestamps) >= self.rate_limit_rpm:
            logger.warning(f"ZkGraph rate limit exceeded: {len(self.request_timestamps)} requests in last minute")
            return False
        
        self.request_timestamps.append(now)
        return True
    
    def _get_cached(self, cache: Dict, key: str, ttl: int) -> Optional[Any]:
        """Get cached value if within TTL"""
        if key in cache:
            entry = cache[key]
            if time.time() - entry["timestamp"] < ttl:
                logger.debug(f"Cache hit for {key}")
                return entry["data"]
            else:
                del cache[key]
        return None
    
    def _set_cache(self, cache: Dict, key: str, data: Any):
        """Set cached value with timestamp"""
        cache[key] = {
            "data": data,
            "timestamp": time.time()
        }
    
    async def _query_zkrag(self, query: str, format: str = "structured") -> Optional[Dict[str, Any]]:
        """
        Internal method to query obsqra zkRAG API
        
        Returns None on error (fail-open design)
        """
        if not self.enabled:
            return None
        
        if not self._check_rate_limit():
            logger.warning("Rate limit exceeded, skipping zkRAG query")
            return None
        
        try:
            response = await self.client.post(
                f"{self.base_url}/zkrag/query",
                json={
                    "query": query,
                    "format": format
                }
            )
            response.raise_for_status()
            return response.json()
        
        except Exception as e:
            logger.error(f"zkRAG query failed: {e}")
            return None
    
    async def query_market_context(self, pool_id: str) -> MarketContext:
        """
        Get attested market context for a specific pool
        
        Returns MarketContext with source="local_only" on error (fail-open)
        """
        # Check cache first
        cached = self._get_cached(self.market_context_cache, pool_id, self.market_ttl)
        if cached:
            cached.enrichments["cached"] = True
            return cached
        
        # Query zkRAG
        result = await self._query_zkrag(f"pool activity for {pool_id}")
        
        if not result:
            # Fallback: local_only
            ctx = MarketContext(
                pool_id=pool_id,
                source="local_only",
                context_text="",
                provenance=None,
                enrichments={"reason": "zkRAG unavailable"},
                verified=False
            )
            self._set_cache(self.market_context_cache, pool_id, ctx)
            return ctx
        
        # Parse structured response
        provenance_data = result.get("provenance", {})
        results = result.get("results", [])
        
        # Build context text from results
        context_parts = []
        for r in results[:3]:  # Top 3 results
            block_num = r.get("block_number", "?")
            fact_hash = r.get("fact_hash", "")[:10]
            context_parts.append(f"block {block_num}: fact_hash={fact_hash}...")
        
        context_text = " ".join(context_parts) if context_parts else result.get("response", "")
        
        # Build provenance
        provenance = ZkGraphProvenance(
            fact_hash=provenance_data.get("fact_hash", "0x0"),
            block_range=provenance_data.get("block_range", "unknown"),
            merkle_root=provenance_data.get("merkle_root", "0x0"),
            source_count=provenance_data.get("sources", 0),
            verified_on_chain=False  # TODO: Verify via fact registry
        )
        
        ctx = MarketContext(
            pool_id=pool_id,
            source="zkrag",
            context_text=context_text,
            provenance=provenance,
            enrichments={
                "query_id": result.get("query_id"),
                "response_hash": result.get("response_hash"),
                "result_count": len(results)
            },
            verified=True
        )
        
        self._set_cache(self.market_context_cache, pool_id, ctx)
        return ctx
    
    async def query_historical_patterns(
        self,
        pattern_type: str = "general",
        limit: int = 5
    ) -> List[HistoricalPattern]:
        """
        Get historical on-chain patterns from proven index
        
        Returns empty list on error (fail-open)
        """
        cache_key = f"{pattern_type}:{limit}"
        cached = self._get_cached(self.historical_cache, cache_key, self.historical_ttl)
        if cached:
            return cached
        
        # Query zkRAG
        result = await self._query_zkrag(
            f"historical on-chain patterns {pattern_type} limit {limit}"
        )
        
        if not result:
            return []
        
        # Parse results
        patterns = []
        provenance_data = result.get("provenance", {})
        
        provenance = ZkGraphProvenance(
            fact_hash=provenance_data.get("fact_hash", "0x0"),
            block_range=provenance_data.get("block_range", "unknown"),
            merkle_root=provenance_data.get("merkle_root", "0x0"),
            source_count=provenance_data.get("sources", 0),
            verified_on_chain=False
        )
        
        results = result.get("results", [])
        for r in results[:limit]:
            pattern = HistoricalPattern(
                pattern_type=r.get("type", pattern_type),
                description=r.get("note", "From attested snapshots"),
                block_range=f"{r.get('block_from', '?')}-{r.get('block_to', '?')}",
                confidence=0.4,  # Conservative default
                provenance=provenance
            )
            patterns.append(pattern)
        
        self._set_cache(self.historical_cache, cache_key, patterns)
        return patterns
    
    async def query_similar_strategies(
        self,
        strategy_id: str,
        limit: int = 5
    ) -> List[StrategyMatch]:
        """
        Get historically similar strategies from proven index
        
        Returns empty list on error (fail-open)
        """
        cache_key = f"strat:{strategy_id}:{limit}"
        cached = self._get_cached(self.historical_cache, cache_key, self.historical_ttl)
        if cached:
            return cached
        
        # Query zkRAG
        result = await self._query_zkrag(
            f"similar strategies to {strategy_id} limit {limit}"
        )
        
        if not result:
            return []
        
        # Parse results
        matches = []
        provenance_data = result.get("provenance", {})
        
        provenance = ZkGraphProvenance(
            fact_hash=provenance_data.get("fact_hash", "0x0"),
            block_range=provenance_data.get("block_range", "unknown"),
            merkle_root=provenance_data.get("merkle_root", "0x0"),
            source_count=provenance_data.get("sources", 0),
            verified_on_chain=False
        )
        
        results = result.get("results", [])
        for r in results[:limit]:
            match = StrategyMatch(
                strategy_id=strategy_id,
                similarity_score=0.7,  # Default similarity
                historical_apy=0.08,  # 8% default
                block_range=f"{r.get('block_from', '?')}-{r.get('block_to', '?')}",
                provenance=provenance
            )
            matches.append(match)
        
        self._set_cache(self.historical_cache, cache_key, matches)
        return matches
    
    async def verify_provenance(
        self,
        fact_hash: str,
        response_hash: str
    ) -> Dict[str, Any]:
        """
        Verify a fact_hash + response_hash against obsqra registry
        """
        if not self.enabled:
            return {"verified": False, "reason": "zkGraph disabled"}
        
        try:
            response = await self.client.post(
                f"{self.base_url}/zkrag/verify",
                json={
                    "fact_hash": fact_hash,
                    "response_hash": response_hash
                }
            )
            response.raise_for_status()
            return response.json()
        
        except Exception as e:
            logger.error(f"Provenance verification failed: {e}")
            return {"verified": False, "error": str(e)}
    
    async def query_agent_report(
        self,
        prompt: str,
        run_live_circuits: bool = False,
        llm_synthesis: bool = False,
    ) -> Dict[str, Any]:
        """
        Query obsqra zkRAG agent for a multi-section intelligence report.

        Returns a dict with:
          - confidence: float   (0-1 overall quality / freshness)
          - action:     dict    (level, label, etc.)
          - zkrag_queries: list of {query, available, results, fact_hash}
          - pool_id:    str | None
          - raw sections from the agent
        """
        if not self.enabled:
            return {
                "source": "local_only",
                "confidence": 0,
                "action": {"level": "unknown", "label": "zkGraph disabled"},
                "zkrag_queries": [],
            }

        if not self._check_rate_limit():
            return {
                "source": "local_only",
                "confidence": 0,
                "action": {"level": "rate_limited", "label": "Rate limit exceeded"},
                "zkrag_queries": [],
            }

        try:
            response = await self.client.post(
                f"{self.base_url}/zkrag/agent/query",
                json={
                    "prompt": prompt,
                    "run_live_circuits": run_live_circuits,
                    "llm_synthesis": llm_synthesis,
                },
            )
            response.raise_for_status()
            data = response.json()

            # Normalise sections into a flat zkrag_queries list
            zkrag_queries: List[Dict[str, Any]] = []
            for section in data.get("sections", data.get("results", [])):
                zkrag_queries.append({
                    "query": section.get("query", section.get("title", "")),
                    "available": section.get("available", True),
                    "results": section.get("results", section.get("data", [])),
                    "fact_hash": section.get("provenance", {}).get("fact_hash")
                                or section.get("fact_hash"),
                })

            return {
                "source": "zkrag",
                "confidence": data.get("confidence", data.get("score", 0)),
                "action": data.get("action", {"level": "unknown"}),
                "zkrag_queries": zkrag_queries,
                "pool_id": data.get("pool_id"),
                **{k: v for k, v in data.items()
                   if k not in ("sections", "results", "confidence", "score",
                                "action", "pool_id")},
            }

        except Exception as e:
            logger.error(f"Agent report query failed: {e}")
            return {
                "source": "local_only",
                "confidence": 0,
                "action": {"level": "error", "label": str(e)},
                "zkrag_queries": [],
            }

    async def health_check(self) -> Dict[str, Any]:
        """
        Check zkGraph client health
        """
        return {
            "available": self.enabled,
            "base_url": self.base_url,
            "cache_entries": {
                "market_context": len(self.market_context_cache),
                "historical": len(self.historical_cache)
            },
            "rate_limit": {
                "rpm_used": len(self.request_timestamps),
                "rpm_limit": self.rate_limit_rpm
            }
        }


# Helper function for convenience
def get_zkgraph_client() -> ZkGraphClient:
    """Get singleton ZkGraphClient instance"""
    return ZkGraphClient.get_instance()
