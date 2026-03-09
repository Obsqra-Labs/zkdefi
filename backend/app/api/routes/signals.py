"""
Signals backend routes.

The signals layer transforms raw opportunities into actionable intelligence
for the oracle and agents. Signals include constitutional context (contract, entity,
asset, pool) and prediction placeholders (yield forecast, reputation, market forecaster).

Endpoints:
- GET /api/v1/zkdefi/signals/top
- GET /api/v1/zkdefi/signals/filtered (future)
- POST /api/v1/zkdefi/signals/rank (future)

This version aggregates opportunities and wraps them as signals with
constitution reports and placeholder predictions (Phase 1).
"""

from fastapi import APIRouter, Query
from datetime import datetime
import httpx
import logging
from typing import Optional, List

from app.services.forecaster_adapter import ForecasterAdapter
from app.services.reputation_adapter import ReputationAdapter
from app.services.agent_event_tracker import get_event_tracker

router = APIRouter(tags=["signals"])
logger = logging.getLogger(__name__)

tracker = get_event_tracker()

BACKEND_BASE = "http://localhost:8003"
AGGREGATION_TIMEOUT = 10.0

# Initialize adapters
_forecaster_adapter = ForecasterAdapter()
_reputation_adapter = ReputationAdapter()


async def fetch_opportunities() -> List[dict]:
    """Fetch real opportunities from TradeDesk V2 or legacy list."""
    try:
        async with httpx.AsyncClient(timeout=AGGREGATION_TIMEOUT) as client:
            response = await client.get(f"{BACKEND_BASE}/api/v1/zkdefi/v2/opportunities?limit=50")
            if response.status_code == 200:
                data = response.json()
                opps = data.get("opportunities", [])
                if opps:
                    return opps
            response = await client.get(f"{BACKEND_BASE}/api/v1/zkdefi/opportunities/list")
            if response.status_code == 200:
                data = response.json()
                return data.get("opportunities", [])
    except Exception as e:
        logger.warning(f"Failed to fetch opportunities: {e}")

    return []


def opportunity_to_signal(opportunity: dict, index: int) -> dict:
    """Transform an opportunity into a signal with real predictions from adapters."""
    
    opp_type = opportunity.get("type", "unknown")
    opp_id = opportunity.get("id", f"signal-{opp_type}-{index}")
    
    # Constitution: deterministic contract/entity/asset context
    entity = opportunity.get("source", f"zkdefi-{opp_type}")
    constitution = {
        "contract": "0x05ba14536eca827e292bf633c2963abc048f0160a8a3efea6a71ca07d0bb3e64",
        "entity": entity,
        "asset": opportunity.get("tokenA", opportunity.get("token", "UNKNOWN")),
        "pool": opportunity.get("poolId", opportunity.get("pool", "primary"))
    }
    
    # Add entity-specific context
    if opp_type == "lending":
        constitution["entity"] = "zkdefi-lending"
        constitution["pool"] = "primary_lending_pool"
    elif opp_type == "staking":
        constitution["entity"] = "zkdefi-staking"
        constitution["asset"] = opportunity.get("stakingToken", "STRK")
    elif opp_type == "dex" or opp_type == "swap":
        constitution["entity"] = opportunity.get("protocol", opportunity.get("dex", "ekubo"))
        constitution["pool"] = opportunity.get("pair", "ETH-USDC").replace("/", "-")
    
    # Get real predictions from adapters
    pair_str = opportunity.get("pair", "")
    if "/" in str(pair_str):
        token_a, _, token_b = str(pair_str).partition("/")
        token_a, token_b = token_a.strip(), token_b.strip()
    else:
        token_a = opportunity.get("tokenA", "UNKNOWN")
        token_b = opportunity.get("tokenB", "USDC")
    pair_id = f"{token_a}/{token_b}" if token_b else token_a
    entity = constitution.get("entity", f"zkdefi-{opp_type}")
    try:
        market_forecast = _forecaster_adapter.get_market_forecast(pair_id)
    except Exception as e:
        logger.warning(f"Forecaster failed for {pair_id}: {e}")
        market_forecast = _forecaster_adapter._fallback_forecast(pair_id)
    
    # Fetch reputation from reputation adapter
    try:
        rep = _reputation_adapter.get_protocol_reputation(entity)
    except Exception as e:
        logger.warning(f"Reputation failed for {entity}: {e}")
        rep = _reputation_adapter._fallback_reputation(entity)
    
    # Build yield forecast from opportunity APY (support both camelCase and snake_case from V2)
    opportunity_apy = float(
        opportunity.get("currentYield") or opportunity.get("apy") or opportunity.get("estimatedApy", 0.0)
    )
    # Adjust predicted yield based on market forecast confidence
    market_confidence = market_forecast.get("calibration_score", 0.7)
    predicted_apy = opportunity_apy * (1.0 + (market_forecast.get("predicted_apy", 0.0) / 100.0) * market_confidence)
    
    signal = {
        "id": opp_id,
        "opportunity_id": opportunity.get("id"),
        "type": opp_type,
        "name": opportunity.get("name", f"{opp_type.title()} Opportunity"),
        "description": opportunity.get("description", ""),
        "currentYield": opportunity_apy,
        "riskScore": max(1, min(99, 
            25 if opp_type == "lending" else 
            35 if opp_type == "staking" else 
            50 if opp_type == "dex" else 
            40
        )),
        "privacyMode": opportunity.get("privacyMode", "public"),
        "rank": index + 1,
        "constitution": constitution,
        "predictions": {
            "yieldForecast": {
                "model": "yield-predictor-v1",
                "predicted_apy": round(predicted_apy, 2),
                "confidence": market_confidence,
                "horizon": "7d"
            },
            "reputationScore": {
                "model": rep.get("model", "reputation-v1"),
                "score": rep.get("score", 75),
                "trustworthiness": rep.get("trustworthiness", "moderate")
            },
            "marketForecaster": {
                "model": market_forecast.get("model", "forecaster-circuit-v1"),
                "probability_up_5m": market_forecast.get("probability_up_5m", 0.5),
                "probability_up_30m": market_forecast.get("probability_up_30m", 0.5),
                "probability_up_4h": market_forecast.get("probability_up_4h", 0.5),
                "calibration_score": market_forecast.get("calibration_score", 0.7),
                "signal_strength": market_forecast.get("signal_strength", 0.0),
            }
        },
        "zkml_gated": False,
        "circuit_verified": False,
        "source": "zkdefi-aggregation",
        "updatedAt": datetime.utcnow().isoformat()
    }
    
    return signal


@router.get("/api/v1/zkdefi/signals/top")
async def get_signals_top(
    limit: int = Query(12, ge=1, le=50),
    type: Optional[str] = None,
    riskScore: Optional[int] = None
) -> dict:
    """
    Fetch top signals for oracle consumption.
    
    Phase 1 (now): Returns opportunities transformed to signals with
    constitution reports and placeholder predictions.
    
    Filters:
    - type: "lending" | "staking" | "dex" | "dca" | "limits"
    - riskScore: max risk score (1-99)
    """
    
    # Fetch real opportunities
    opportunities = await fetch_opportunities()
    
    if not opportunities:
        logger.warning("No opportunities available for signals")
        return {"signals": [], "metadata": {"total": 0, "source": "empty"}}
    
    # Transform to signals
    signals = []
    for idx, opp in enumerate(opportunities):
        signal = opportunity_to_signal(opp, idx)
        
        # Apply filters
        if type and signal["type"] != type:
            continue
        if riskScore is not None and signal["riskScore"] > riskScore:
            continue
        
        signals.append(signal)
        if len(signals) >= limit:
            break
    
    # Sort by yield (rank)
    signals.sort(key=lambda s: s["currentYield"], reverse=True)
    
    return {
        "signals": signals,
        "metadata": {
            "total": len(signals),
            "filtered_by": list(filter(None, [type, "riskScore" if riskScore else None])),
            "ranking_model": "opportunity-priority-v1",
            "phase": "phase-2-predictions",
            "ready_for_predictions": True,
        }
    }


@router.get("/api/v1/zkdefi/signals/gated")
async def get_signals_gated(limit: int = Query(5, ge=1, le=20)) -> dict:
    """
    Fetch ONLY circuit-verified, zkML-gated signals.
    
    Phase 1 (now): Returns empty list (no circuits running yet).
    Phase 2+: Real gated signals from zkML verification.
    """
    return {
        "signals": [],
        "metadata": {
            "total": 0,
            "phase": "phase-1-placeholder",
            "message": "Circuit verification not yet implemented",
            "ready_for_predictions": False
        }
    }


@router.get("/api/v1/zkdefi/signals/status")
async def get_signals_status() -> dict:
    """Health check for signals pipeline."""
    return {
        "status": "operational",
        "phase": "phase-2-predictions",
        "components": {
            "opportunities_aggregation": "active",
            "signal_transformation": "active",
            "predictions": "forecaster_and_reputation_adapters",
            "zkml_verification": "pending",
        },
        "readiness": {
            "phase_1": True,
            "phase_2_ready": True,
            "phase_3_ready": False,
        },
    }
