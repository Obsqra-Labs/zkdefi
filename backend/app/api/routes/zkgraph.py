"""
zkGraph API — Proxy to obsqra zkRAG proven-index with local caching.

Exposes market context, historical patterns, provenance verification, and
health checks.  All data is attested by the obsqra prover network.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from app.services.zkgraph_client import get_zkgraph_client

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/context/{pool_id}")
async def get_market_context(pool_id: str):
    """Return attested market context for a pool from the obsqra proven-index."""
    client = get_zkgraph_client()
    ctx = await client.query_market_context(pool_id)
    return ctx.to_dict()


@router.get("/strategies/{strategy_id}")
async def get_similar_strategies(strategy_id: str, limit: int = 5):
    """Find historically similar strategies from the proven-index."""
    client = get_zkgraph_client()
    matches = await client.query_similar_strategies(strategy_id, limit=limit)
    return {
        "strategy_id": strategy_id,
        "matches": [
            {
                "strategy_id": m.strategy_id,
                "similarity_score": m.similarity_score,
                "historical_apy": m.historical_apy,
                "block_range": m.block_range,
                "provenance": m.provenance.to_dict() if m.provenance else None,
            }
            for m in matches
        ],
    }


@router.get("/patterns/{pattern_type}")
async def get_historical_patterns(pattern_type: str = "general", limit: int = 5):
    """Query historical on-chain patterns from the proven-index."""
    client = get_zkgraph_client()
    patterns = await client.query_historical_patterns(pattern_type, limit=limit)
    return {
        "pattern_type": pattern_type,
        "patterns": [
            {
                "pattern_type": p.pattern_type,
                "description": p.description,
                "block_range": p.block_range,
                "confidence": p.confidence,
                "provenance": p.provenance.to_dict() if p.provenance else None,
            }
            for p in patterns
        ],
    }


@router.post("/verify")
async def verify_provenance(body: dict):
    """Verify a fact_hash and optional response_hash against the obsqra registry."""
    client = get_zkgraph_client()
    result = await client.verify_provenance(
        fact_hash=body.get("fact_hash", ""),
        response_hash=body.get("response_hash", ""),
    )
    return result


@router.get("/health")
async def zkgraph_health():
    """Liveness check for the obsqra zkRAG service + cache stats."""
    client = get_zkgraph_client()
    return await client.health_check()
