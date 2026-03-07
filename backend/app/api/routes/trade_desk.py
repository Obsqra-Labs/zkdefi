"""
Trade Desk backend routes.

Provides market data, opportunities, AI recommendations, and receipt tracking
for the new Trade Desk UI components.

Endpoints:
- GET /api/v1/zkdefi/opportunities/list
- GET /api/v1/zkdefi/market/context
- GET /api/v1/zkdefi/pools/{poolId}/data
- POST /api/v1/zkdefi/ai/recommendations
- GET /api/v1/zkdefi/ai/insights
- GET /api/v1/zkdefi/receipts/timeline
"""

from fastapi import APIRouter
from datetime import datetime, timedelta

router = APIRouter()

# Mock opportunities data
OPPORTUNITIES = [
    {
        "id": "opp-1",
        "name": "ETH/USDC LP (Conservative)",
        "description": "Low-risk liquidity provision with tight tick range",
        "type": "lp",
        "tokenA": "ETH",
        "tokenB": "USDC",
        "currentYield": 8.5,
        "riskScore": 25,
        "tvl": 1250000,
        "privacyModes": ["public", "shielded"],
        "source": "Ekubo",
        "updatedAt": datetime.utcnow().isoformat()
    },
    {
        "id": "opp-2",
        "name": "USDC Lending (Tier2 Rate: 6%)",
        "description": "Borrow USDC against your reputation tier",
        "type": "lending",
        "tokenA": "USDC",
        "currentYield": 6.0,
        "riskScore": 35,
        "tvl": 500000,
        "privacyModes": ["shielded", "dark_ledger"],
        "source": "zkGraph",
        "updatedAt": datetime.utcnow().isoformat()
    },
    {
        "id": "opp-3",
        "name": "STRK Staking",
        "description": "Stake STRK and earn 15% APY",
        "type": "staking",
        "tokenA": "STRK",
        "currentYield": 15.0,
        "riskScore": 20,
        "tvl": 3500000,
        "privacyModes": ["public"],
        "source": "Strategy",
        "updatedAt": datetime.utcnow().isoformat()
    },
    {
        "id": "opp-4",
        "name": "ETH DCA Strategy",
        "description": "Dollar-cost average into ETH with weekly buys",
        "type": "dca",
        "tokenA": "USDC",
        "tokenB": "ETH",
        "currentYield": 0,
        "riskScore": 30,
        "tvl": None,
        "privacyModes": ["public", "shielded", "dark_ledger"],
        "source": "Strategy",
        "updatedAt": datetime.utcnow().isoformat()
    },
    {
        "id": "opp-5",
        "name": "STRK/ETH Limit Orders",
        "description": "Set limit orders on Ekubo with custom pricing",
        "type": "limit_orders",
        "tokenA": "STRK",
        "tokenB": "ETH",
        "currentYield": 0,
        "riskScore": 15,
        "tvl": None,
        "privacyModes": ["public", "shielded"],
        "source": "Ekubo",
        "updatedAt": datetime.utcnow().isoformat()
    }
]

MARKET_CONTEXT = {
    "volatilityIndex": 42,
    "sentiment": "neutral",
    "riskWarnings": [
        "ETH volatility increased 15% over last 24h",
        "USDC liquidity dip on Ekubo"
    ],
    "trendingPairs": [
        {"tokenA": "ETH", "tokenB": "USDC", "volume24h": 2500000},
        {"tokenA": "STRK", "tokenB": "ETH", "volume24h": 1800000},
        {"tokenA": "BTC", "tokenB": "USDC", "volume24h": 1200000}
    ],
    "timestamp": datetime.utcnow().isoformat()
}

RECOMMENDATIONS = [
    {
        "id": "rec-1",
        "action": "Add 5 ETH to conservative LP pool",
        "reasoning": "Low volatility window, good liquidity pair",
        "type": "yield",
        "expectedYield": 8.5,
        "expectedRiskReduction": 0,
        "confidence": 0.82
    },
    {
        "id": "rec-2",
        "action": "Stake STRK to earn 15% APY",
        "reasoning": "Strong staking demand, sustainable yield",
        "type": "opportunity",
        "expectedYield": 15.0,
        "expectedRiskReduction": 0,
        "confidence": 0.76
    }
]

# Mock receipts (audit trail)
RECEIPTS = [
    {
        "id": "rcpt-1",
        "timestamp": (datetime.utcnow() - timedelta(hours=2)).isoformat(),
        "action": "lp_add",
        "adapter": "lp",
        "opportunityName": "ETH/USDC LP (Conservative)",
        "amount": 5,
        "privacyLevel": "public",
        "exposureLevel": 25,
        "yieldImpact": 0.42,
        "trustDelta": 5,
        "txHash": "0x1234...5678",
        "status": "confirmed",
        "reputationImpact": 5,
        "explanationFromAI": "Successfully added 5 ETH to LP pool at optimal ratio"
    },
    {
        "id": "rcpt-2",
        "timestamp": (datetime.utcnow() - timedelta(hours=6)).isoformat(),
        "action": "borrow",
        "adapter": "lending",
        "opportunityName": "USDC Lending (Tier2)",
        "amount": 50000,
        "privacyLevel": "shielded",
        "exposureLevel": 65,
        "yieldImpact": 0,
        "trustDelta": 2,
        "txHash": "0x9abc...def0",
        "status": "confirmed",
        "reputationImpact": 3,
        "explanationFromAI": "Borrowed $50k USDC at Tier2 rate (6% APR)"
    },
    {
        "id": "rcpt-3",
        "timestamp": (datetime.utcnow() - timedelta(hours=12)).isoformat(),
        "action": "stake",
        "adapter": "staking",
        "opportunityName": "STRK Staking",
        "amount": 1000,
        "privacyLevel": "public",
        "exposureLevel": 20,
        "yieldImpact": 1.25,
        "trustDelta": 4,
        "txHash": "0x5678...90ab",
        "status": "confirmed",
        "reputationImpact": 8,
        "explanationFromAI": "Staked 1000 STRK, earning 15% APY"
    }
]


@router.get("/api/v1/zkdefi/opportunities/list")
async def get_opportunities(
    type: str = None,
    minYield: float = None,
    maxRisk: float = None,
    privacyMode: str = None
):
    """Fetch opportunities with optional filtering."""
    opps = OPPORTUNITIES.copy()
    
    if type:
        opps = [o for o in opps if o["type"] == type]
    if minYield:
        opps = [o for o in opps if o["currentYield"] >= minYield]
    if maxRisk:
        opps = [o for o in opps if o["riskScore"] <= maxRisk]
    if privacyMode:
        opps = [o for o in opps if privacyMode in o["privacyModes"]]
    
    return {"opportunities": opps}


@router.get("/api/v1/zkdefi/market/context")
async def get_market_context():
    """Fetch current market context: volatility, sentiment, warnings."""
    return MARKET_CONTEXT


@router.get("/api/v1/zkdefi/pools/{pool_id}/data")
async def get_pool_data(pool_id: str):
    """Fetch pool-specific data: liquidity, APY, TVL, risk factors."""
    return {
        "poolId": pool_id,
        "token0": "ETH",
        "token1": "USDC",
        "liquidity": 5000000,
        "volume24h": 2500000,
        "apy": 8.5,
        "tvl": 1250000,
        "fee": 0.05,
        "riskFactors": {
            "impermanentLoss": 15,
            "slippage": 0.3
        },
        "lastUpdated": datetime.utcnow().isoformat()
    }


@router.post("/api/v1/zkdefi/ai/recommendations")
async def get_recommendations(currentPortfolio: dict = None, riskProfile: str = "moderate"):
    """Get AI-powered recommendations based on portfolio and risk profile."""
    return {"recommendations": RECOMMENDATIONS}


@router.get("/api/v1/zkdefi/ai/insights")
async def get_ai_insights():
    """Get market insights from AI: opportunities, warnings, narrative."""
    return {
        "emergingOpportunities": [OPPORTUNITIES[0], OPPORTUNITIES[2]],
        "warnings": MARKET_CONTEXT["riskWarnings"],
        "narrativeExplanation": "Markets showing moderate volatility with strong staking opportunities. Conservative LP positions are well-positioned. Monitor ETH/USDC pair.",
        "timestamp": datetime.utcnow().isoformat()
    }


@router.get("/api/v1/zkdefi/receipts/timeline")
async def get_receipt_timeline(limit: int = 50):
    """Fetch receipt timeline for Memory Lane."""
    return {
        "receipts": RECEIPTS[:limit],
        "totalCount": len(RECEIPTS)
    }


@router.get("/api/v1/zkdefi/receipts/summary")
async def get_receipt_summary():
    """Fetch receipt summary: total yield, success rate, reputation gained."""
    return {
        "totalExecutions": len(RECEIPTS),
        "totalYield": sum(r["yieldImpact"] for r in RECEIPTS),
        "successRate": 1.0,
        "reputationGainedFromProofs": sum(r["reputationImpact"] for r in RECEIPTS),
        "topPerformingAdapter": "lp",
        "lastExecutionTime": RECEIPTS[0]["timestamp"]
    }
