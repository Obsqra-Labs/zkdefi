"""
zkGraph Data Models: Attested on-chain intelligence from obsqra.fi
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any


@dataclass
class ZkGraphProvenance:
    """Cryptographic provenance for zkRAG responses"""
    fact_hash: str
    block_range: str
    merkle_root: str
    source_count: int
    verified_on_chain: bool = False


@dataclass
class ZkGraphResult:
    """Full response from obsqra zkRAG API"""
    query: str
    response: str
    query_id: str
    response_hash: str
    provenance: ZkGraphProvenance
    results: List[Dict[str, Any]]
    cached: bool = False


@dataclass
class MarketContext:
    """Pool-specific attested market intelligence"""
    pool_id: str
    source: str  # "zkrag" | "local_only"
    context_text: str
    provenance: Optional[ZkGraphProvenance]
    enrichments: Dict[str, Any]
    verified: bool


@dataclass
class HistoricalPattern:
    """Cross-block historical patterns from proven index"""
    pattern_type: str
    description: str
    block_range: str
    confidence: float  # 0.0 - 1.0
    provenance: Optional[ZkGraphProvenance]


@dataclass
class StrategyMatch:
    """Historical similar strategy from proven index"""
    strategy_id: str
    similarity_score: float
    historical_apy: float
    block_range: str
    provenance: Optional[ZkGraphProvenance]
