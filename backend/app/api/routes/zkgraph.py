"""
zkGraph API Routes: Query attested on-chain intelligence
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import logging

from app.services.zkgraph_client import ZkGraphClient
from app.services.receipt_service import get_receipt_service

router = APIRouter()
logger = logging.getLogger(__name__)


class AgentQueryRequest(BaseModel):
    prompt: str
    user_address: Optional[str] = None
    run_live_circuits: bool = False
    llm_synthesis: bool = False


@router.post("/agent/query")
async def agent_query(request: AgentQueryRequest):
    """
    Query the zkGraph agent and optionally append a proof receipt.
    """
    try:
        zk = ZkGraphClient.get_instance()
        report = await zk.query_agent_report(
            prompt=request.prompt,
            run_live_circuits=request.run_live_circuits,
            llm_synthesis=request.llm_synthesis,
        )

        receipt = None
        if request.user_address:
            # Find the first non-null fact_hash from zkrag_queries
            fact_hash = None
            for q in report.get("zkrag_queries", []):
                if q.get("fact_hash"):
                    fact_hash = q["fact_hash"]
                    break

            receipt_svc = get_receipt_service()
            receipt = receipt_svc.append_proof_receipt(
                user_address=request.user_address,
                proof_type="zkrag_agent_report",
                threshold_or_model=f"confidence={report.get('confidence', 0)}",
                result=report.get("action", {}).get("level", "unknown"),
                fact_hash=fact_hash,
                pool_id=report.get("pool_id"),
            )

        return {**report, "receipt": receipt}
    except Exception as e:
        logger.error(f"Agent query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/agent/capabilities")
async def get_agent_capabilities():
    """
    Return the static capability manifest for the zkRAG/zkGraph agent.
    The ZkRagAgentConsole queries this to populate its UI.
    """
    return {
        "capabilities": [
            {
                "id": "market_context",
                "name": "Market Context Query",
                "description": "Attested pool-level market data with provenance hashes",
                "input_schema": {"pool_id": "string"},
                "output_schema": {"context": "object", "fact_hash": "string"},
            },
            {
                "id": "pattern_analysis",
                "name": "Historical Pattern Analysis",
                "description": "zkRAG-indexed on-chain pattern matching with fact attestation",
                "input_schema": {"pattern_type": "enum[volatility,volume_spike,yield_trend]"},
                "output_schema": {"patterns": "array", "fact_hashes": "array"},
            },
            {
                "id": "strategy_match",
                "name": "Strategy Matching",
                "description": "Match current conditions to proven strategy templates",
                "input_schema": {"strategy_id": "string"},
                "output_schema": {"matches": "array", "provenance": "array"},
            },
            {
                "id": "agent_query",
                "name": "Agent Intelligence Query",
                "description": "Full zkRAG agent query: risk scoring, action recommendation, receipt generation",
                "input_schema": {"query": "string", "context": "object"},
                "output_schema": {"action": "string", "confidence": "float", "receipt_hash": "string"},
            },
        ],
        "zkrag_status": "available",
        "last_indexed_block": None,
    }


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
