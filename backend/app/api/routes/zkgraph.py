"""
zkGraph API Routes: Query attested on-chain intelligence
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging

from app.services.zkgraph_client import ZkGraphClient

router = APIRouter()
logger = logging.getLogger(__name__)


class VerifyProvenanceRequest(BaseModel):
    fact_hash: str
    response_hash: str


@router.get("/health")
async def get_zkgraph_health():
    """
    Check zkGraph client health
    
    Returns:
        available: bool - client enabled
        base_url: str - obsqra API URL
        cache_entries: dict - cache stats
        rate_limit: dict - RPM usage
    """
    try:
        zk = ZkGraphClient.get_instance()
        health = await zk.health_check()
        return health
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/context/{pool_id}")
async def get_market_context(pool_id: str):
    """
    Get attested market context for a specific pool
    
    Returns MarketContext with provenance if zkRAG available,
    otherwise returns source="local_only"
    """
    try:
        zk = ZkGraphClient.get_instance()
        ctx = await zk.query_market_context(pool_id)
        
        return {
            "pool_id": ctx.pool_id,
            "source": ctx.source,
            "context_text": ctx.context_text,
            "provenance": {
                "fact_hash": ctx.provenance.fact_hash if ctx.provenance else None,
                "block_range": ctx.provenance.block_range if ctx.provenance else None,
                "merkle_root": ctx.provenance.merkle_root if ctx.provenance else None,
                "source_count": ctx.provenance.source_count if ctx.provenance else 0,
                "verified_on_chain": ctx.provenance.verified_on_chain if ctx.provenance else False,
            } if ctx.provenance else None,
            "enrichments": ctx.enrichments,
            "verified": ctx.verified
        }
    except Exception as e:
        logger.error(f"Failed to get market context for {pool_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/patterns/{pattern_type}")
async def get_historical_patterns(pattern_type: str, limit: int = 5):
    """
    Get historical on-chain patterns from proven index
    
    Args:
        pattern_type: "general", "tvl_divergence", "volatility", etc.
        limit: Max number of patterns to return (default 5)
    """
    try:
        zk = ZkGraphClient.get_instance()
        patterns = await zk.query_historical_patterns(pattern_type, limit)
        
        return {
            "pattern_type": pattern_type,
            "patterns": [
                {
                    "pattern_type": p.pattern_type,
                    "description": p.description,
                    "block_range": p.block_range,
                    "confidence": p.confidence,
                    "provenance": {
                        "fact_hash": p.provenance.fact_hash if p.provenance else None,
                        "block_range": p.provenance.block_range if p.provenance else None,
                    } if p.provenance else None
                }
                for p in patterns
            ],
            "count": len(patterns)
        }
    except Exception as e:
        logger.error(f"Failed to get patterns for {pattern_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/strategies/{strategy_id}")
async def get_similar_strategies(strategy_id: str, limit: int = 5):
    """
    Get historically similar strategies from proven index
    """
    try:
        zk = ZkGraphClient.get_instance()
        matches = await zk.query_similar_strategies(strategy_id, limit)
        
        return {
            "strategy_id": strategy_id,
            "matches": [
                {
                    "strategy_id": m.strategy_id,
                    "similarity_score": m.similarity_score,
                    "historical_apy": m.historical_apy,
                    "block_range": m.block_range,
                    "provenance": {
                        "fact_hash": m.provenance.fact_hash if m.provenance else None,
                        "block_range": m.provenance.block_range if m.provenance else None,
                    } if m.provenance else None
                }
                for m in matches
            ],
            "count": len(matches)
        }
    except Exception as e:
        logger.error(f"Failed to get similar strategies for {strategy_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify")
async def verify_provenance(request: VerifyProvenanceRequest):
    """
    Verify a fact_hash + response_hash against obsqra registry
    """
    try:
        zk = ZkGraphClient.get_instance()
        result = await zk.verify_provenance(
            request.fact_hash,
            request.response_hash
        )
        return result
    except Exception as e:
        logger.error(f"Provenance verification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
