"""
zkGraph / zkRAG data models.

Structured types for data returned from the obsqra.fi zkRAG proven-index service.
Used by ZkGraphClient and all intelligence services that consume zkRAG enrichment.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class ZkGraphProvenance:
    """Cryptographic provenance chain from the obsqra proven index."""

    fact_hash: str = ""
    block_range: str = ""
    merkle_root: str = ""
    source_count: int = 0
    verified_on_chain: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ZkGraphResult:
    """Parsed response from an obsqra zkRAG query."""

    query: str = ""
    response: str = ""
    query_id: str = ""
    response_hash: str = ""
    provenance: ZkGraphProvenance = field(default_factory=ZkGraphProvenance)
    results: list[dict] = field(default_factory=list)
    cached: bool = False

    def to_dict(self) -> dict:
        d = asdict(self)
        d["provenance"] = self.provenance.to_dict()
        return d


@dataclass
class MarketContext:
    """zkRAG-enriched market context for a pool or strategy."""

    pool_id: str = ""
    source: str = "local_only"  # "zkrag" | "local_only" | "pending_index"
    context_text: str = ""
    provenance: Optional[ZkGraphProvenance] = None
    enrichments: dict = field(default_factory=dict)
    verified: bool = False

    def to_dict(self) -> dict:
        return {
            "pool_id": self.pool_id,
            "source": self.source,
            "context": self.context_text,
            "provenance": self.provenance.to_dict() if self.provenance else None,
            "enrichments": self.enrichments,
            "verified": self.verified,
        }


@dataclass
class StrategyMatch:
    """A historically similar strategy found via zkRAG."""

    strategy_id: str = ""
    similarity_score: float = 0.0
    historical_apy: float = 0.0
    block_range: str = ""
    provenance: Optional[ZkGraphProvenance] = None


@dataclass
class HistoricalPattern:
    """A historical on-chain pattern discovered via zkRAG."""

    pattern_type: str = ""  # "volatility_spike", "tvl_drain", "yield_compression"
    description: str = ""
    block_range: str = ""
    confidence: float = 0.0
    provenance: Optional[ZkGraphProvenance] = None
