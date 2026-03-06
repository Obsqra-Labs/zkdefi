"""Strategy recommendation for orchestration and strategies route. Returns Ekubo-only pools for orchestration target."""
from datetime import datetime
from typing import Any
import hashlib
import time


async def get_recommendation(
    user_address: str,
    amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """Return recommendation dict with recommended_pools (protocol = Ekubo). Used by strategies route and orchestrator."""
    profile = risk_profile.lower() if risk_profile else "balanced"
    if profile == "conservative":
        allocation_pct1, allocation_pct2 = 0.7, 0.3
    elif profile == "aggressive":
        allocation_pct1, allocation_pct2 = 0.3, 0.7
    else:
        allocation_pct1, allocation_pct2 = 0.6, 0.4

    # APY as fraction (0.275 = 27.5%) to match PoolRecommendation and API tests
    apy1, apy2 = 0.275, 0.265
    recommended_pools = [
        {
            "pool_id": "ekubo_eth_usdc",
            "protocol": "Ekubo",
            "pair": "ETH/USDC",
            "allocation_percent": allocation_pct1 * 100,
            "allocation_amount": amount * allocation_pct1,
            "expected_apy": apy1,
            "risk_score": 30.0,
            "risk_flags": [],
        },
        {
            "pool_id": "ekubo_strk_usdc",
            "protocol": "Ekubo",
            "pair": "STRK/USDC",
            "allocation_percent": allocation_pct2 * 100,
            "allocation_amount": amount * allocation_pct2,
            "expected_apy": apy2,
            "risk_score": 40.0,
            "risk_flags": [],
        },
    ]
    expected_apy = (apy1 * allocation_pct1) + (apy2 * allocation_pct2)
    recommendation_id = hashlib.sha256(
        f"{user_address}_{time.time()}".encode()
    ).hexdigest()[:12]
    return {
        "user_address": user_address,
        "risk_profile": risk_profile,
        "total_amount": amount,
        "recommended_pools": recommended_pools,
        "ai_reasoning": f"Based on your {risk_profile} risk profile, we recommend allocating {allocation_pct1*100:.0f}% to ETH/USDC and {allocation_pct2*100:.0f}% to STRK/USDC for optimal yield. Expected portfolio APY is {expected_apy*100:.1f}%.",
        "ai_confidence": 0.85,
        "expected_portfolio_apy": expected_apy,
        "portfolio_risk_assessment": f"This {risk_profile} allocation balances your risk tolerance with yield optimization.",
        "recommendation_id": recommendation_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
