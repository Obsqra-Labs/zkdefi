"""
Oracle API Routes

Exposes mainnet market data for frontend consumption.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.mainnet_oracle import get_oracle, MarketSnapshot

router = APIRouter(prefix="/oracle", tags=["oracle"])


class MarketDataResponse(BaseModel):
    jediswap: dict
    ekubo: dict
    timestamp: int
    datetime: str


class RecommendationResponse(BaseModel):
    jediswap_bps: int
    ekubo_bps: int
    pool_type: str
    reason: str
    jediswap_apy_pct: float
    ekubo_apy_pct: float
    ekubo_volatility_pct: float
    snapshot_timestamp: int


class PoolAPYResponse(BaseModel):
    conservative: int
    neutral: int
    aggressive: int
    timestamp: int


@router.get("/market-data", response_model=MarketDataResponse)
async def get_market_data():
    """Get latest market data snapshot."""
    oracle = get_oracle()
    snapshot = oracle.get_latest_snapshot()
    
    if not snapshot:
        # Trigger a sync if no data
        snapshot = await oracle.sync_market_data()
    
    return snapshot.to_dict()


@router.get("/recommendation", response_model=RecommendationResponse)
async def get_recommendation(risk_tolerance: int = 50):
    """
    Get allocation recommendation based on current market conditions.
    
    Args:
        risk_tolerance: 0-100, where 0 is most conservative and 100 is most aggressive
    """
    if not 0 <= risk_tolerance <= 100:
        raise HTTPException(status_code=400, detail="risk_tolerance must be 0-100")
    
    oracle = get_oracle()
    return oracle.get_current_recommendation(risk_tolerance)


@router.get("/pool-apys", response_model=PoolAPYResponse)
async def get_pool_apys():
    """Get projected APYs for each pool type."""
    oracle = get_oracle()
    snapshot = oracle.get_latest_snapshot()
    
    if not snapshot:
        snapshot = await oracle.sync_market_data()
    
    return {
        "conservative": snapshot.get_pool_apy("conservative"),
        "neutral": snapshot.get_pool_apy("neutral"),
        "aggressive": snapshot.get_pool_apy("aggressive"),
        "timestamp": snapshot.timestamp,
    }


@router.post("/sync")
async def sync_market_data():
    """Manually trigger a market data sync."""
    oracle = get_oracle()
    snapshot = await oracle.sync_market_data()
    return {
        "status": "synced",
        "timestamp": snapshot.timestamp,
        "jediswap_apy_bps": snapshot.jediswap.get("apy_bps"),
        "ekubo_apy_bps": snapshot.ekubo.get("apy_bps"),
    }


@router.get("/history")
async def get_snapshot_history(limit: int = 10):
    """Get recent snapshot history."""
    if not 1 <= limit <= 100:
        limit = 10
    
    oracle = get_oracle()
    snapshots = oracle.get_snapshot_history(limit)
    
    return {
        "count": len(snapshots),
        "snapshots": [s.to_dict() for s in snapshots],
    }
