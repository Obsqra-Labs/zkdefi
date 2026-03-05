"""Strategy recommendation for orchestration and strategies route.

Returns Ekubo-only pools for orchestration target.  When the market-surface
service is reachable the APYs and risk scores come from live Ekubo pair data;
otherwise we fall back to conservative static estimates so the endpoint never
breaks.
"""
from datetime import datetime, timezone
from typing import Any
import hashlib
import logging
import time

logger = logging.getLogger(__name__)

# ── Fallback values used when live data is unavailable ──────────────────────
_FALLBACK_POOLS: list[dict[str, Any]] = [
    {
        "pool_id": "ekubo_eth_usdc",
        "protocol": "Ekubo",
        "pair": "ETH/USDC",
        "expected_apy": 0.0,
        "risk_score": 35.0,
        "risk_flags": [],
    },
    {
        "pool_id": "ekubo_strk_usdc",
        "protocol": "Ekubo",
        "pair": "STRK/USDC",
        "expected_apy": 0.0,
        "risk_score": 45.0,
        "risk_flags": [],
    },
]


async def _fetch_live_opportunities() -> list[dict[str, Any]]:
    """Pull live opportunity rows from market_surface_service.

    Returns a list of dicts each with at least:
        pair, estimated_apy_pct, tvl_usd, volume_24h_usd, confidence
    """
    try:
        from app.services.market_surface_service import get_market_surface
        surface = await get_market_surface()
        opps = surface.get("opportunities", [])
        if opps:
            return opps
    except Exception as exc:
        logger.warning("strategy_recommendation: live surface unavailable: %s", exc)
    return []


def _risk_score_from_opp(opp: dict[str, Any]) -> float:
    """Derive a 0-100 risk score from opportunity metadata."""
    confidence = opp.get("confidence", "low")
    tvl = float(opp.get("tvl_usd", 0))
    base = {"high": 20, "medium": 40, "low": 60}.get(confidence, 50)
    # Lower TVL → higher risk
    if tvl < 10_000:
        base += 15
    elif tvl < 50_000:
        base += 5
    return min(100.0, max(0.0, float(base)))


def _match_pool(pair_label: str, opps: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Find the best matching opportunity row for a pool label like 'ETH/USDC'.

    Matching is order-agnostic: ETH/USDC == USDC/ETH.
    """
    parts = set(pair_label.upper().replace(" ", "").split("/"))
    for opp in opps:
        candidate_parts = set(str(opp.get("pair", "")).upper().replace(" ", "").split("/"))
        if candidate_parts == parts:
            return opp
    return None


def _select_best_pools(
    live_opps: list[dict[str, Any]],
    risk_profile: str,
    n: int = 2,
) -> list[dict[str, Any]]:
    """Select the best N live opportunity rows for the given risk profile.

    - conservative: prefer high-TVL, lower-APY (stablecoin-heavy)
    - aggressive: prefer highest APY regardless of TVL
    - balanced: balanced sort on (APY * confidence_weight)
    """
    if not live_opps:
        return []

    confidence_weight = {"high": 1.0, "medium": 0.7, "low": 0.4}
    profile = risk_profile.lower()

    def _sort_key(opp: dict[str, Any]) -> float:
        apy = float(opp.get("estimated_apy_pct", 0))
        tvl = float(opp.get("tvl_usd", 0))
        cw = confidence_weight.get(opp.get("confidence", "low"), 0.4)
        if profile == "conservative":
            return tvl * cw  # prefer high TVL
        elif profile == "aggressive":
            return apy * cw  # prefer high APY
        else:
            return (apy * 0.5 + tvl * 0.0001) * cw  # balanced

    sorted_opps = sorted(live_opps, key=_sort_key, reverse=True)
    # Deduplicate by pair label (keep first / best)
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for opp in sorted_opps:
        key = frozenset(str(opp.get("pair", "")).upper().split("/"))
        if key not in seen:
            seen.add(key)
            result.append(opp)
            if len(result) >= n:
                break
    return result


async def get_recommendation(
    user_address: str,
    amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """Return recommendation dict with recommended_pools (protocol = Ekubo).

    When live market data is available, dynamically selects the best pools
    for the user's risk profile instead of relying on hardcoded pairs.
    """
    profile = risk_profile.lower() if risk_profile else "balanced"
    if profile == "conservative":
        alloc_weights = [0.7, 0.3]
    elif profile == "aggressive":
        alloc_weights = [0.3, 0.7]
    else:
        alloc_weights = [0.6, 0.4]

    # Fetch live market data
    live_opps = await _fetch_live_opportunities()
    data_source = "live" if live_opps else "fallback"

    # Dynamically select best pools from live data
    best_live = _select_best_pools(live_opps, profile, n=len(alloc_weights))

    recommended_pools: list[dict[str, Any]] = []

    if best_live:
        # Use dynamically selected live pools
        for idx, opp in enumerate(best_live):
            pct = alloc_weights[idx] if idx < len(alloc_weights) else (1.0 / len(best_live))
            apy = float(opp.get("estimated_apy_pct", 0)) / 100.0
            risk = _risk_score_from_opp(opp)
            flags = []
            if opp.get("confidence") == "low":
                flags.append("low_confidence")
            if opp.get("data_quality") in ("fallback", "synthetic", "mainnet_reference"):
                flags.append("reference_data")

            pair_label = opp.get("pair", "UNKNOWN")
            pool_id = f"ekubo_{pair_label.lower().replace('/', '_')}"

            recommended_pools.append({
                "pool_id": pool_id,
                "protocol": "Ekubo",
                "pair": pair_label,
                "allocation_percent": pct * 100,
                "allocation_amount": amount * pct,
                "expected_apy": apy,
                "risk_score": risk,
                "risk_flags": flags,
                "data_source": data_source,
                "data_quality": opp.get("data_quality", "unknown"),
                "tvl_usd": opp.get("tvl_usd", 0),
                "volume_24h_usd": opp.get("volume_24h_usd", 0),
            })
    else:
        # Fall back to static pools with no live APY
        for idx, base_pool in enumerate(_FALLBACK_POOLS):
            pct = alloc_weights[idx] if idx < len(alloc_weights) else 0.5
            matched = _match_pool(base_pool["pair"], live_opps)
            if matched:
                apy = float(matched.get("estimated_apy_pct", 0)) / 100.0
                risk = _risk_score_from_opp(matched)
                flags = []
                if matched.get("confidence") == "low":
                    flags.append("low_confidence")
            else:
                apy = base_pool["expected_apy"]
                risk = base_pool["risk_score"]
                flags = ["no_live_data"]

            recommended_pools.append({
                "pool_id": base_pool["pool_id"],
                "protocol": base_pool["protocol"],
                "pair": base_pool["pair"],
                "allocation_percent": pct * 100,
                "allocation_amount": amount * pct,
                "expected_apy": apy,
                "risk_score": risk,
                "risk_flags": flags,
                "data_source": data_source,
            })

    expected_apy = sum(
        p["expected_apy"] * (p["allocation_percent"] / 100.0)
        for p in recommended_pools
    )

    recommendation_id = hashlib.sha256(
        f"{user_address}_{time.time()}".encode()
    ).hexdigest()[:12]

    pool_summaries = ", ".join(
        f"{p['allocation_percent']:.0f}% to {p['pair']} ({p['expected_apy']*100:.1f}% APY)"
        for p in recommended_pools
    )

    return {
        "user_address": user_address,
        "risk_profile": risk_profile,
        "total_amount": amount,
        "recommended_pools": recommended_pools,
        "ai_reasoning": (
            f"Based on your {risk_profile} risk profile, we recommend allocating "
            f"{pool_summaries} for optimal yield. "
            f"Expected portfolio APY is {expected_apy*100:.1f}%. "
            f"Data source: {data_source}."
        ),
        "ai_confidence": 0.90 if data_source == "live" else 0.60,
        "expected_portfolio_apy": expected_apy,
        "portfolio_risk_assessment": (
            f"This {risk_profile} allocation balances your risk tolerance "
            f"with yield optimization."
        ),
        "recommendation_id": recommendation_id,
        "data_source": data_source,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
