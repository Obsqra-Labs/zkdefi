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

router = APIRouter(tags=["signals"])
logger = logging.getLogger(__name__)

BACKEND_BASE = "http://localhost:8003"
AGGREGATION_TIMEOUT = 10.0


async def fetch_opportunities() -> List[dict]:
    """Fetch real opportunities from trade_desk endpoint."""
    try:
        async with httpx.AsyncClient(timeout=AGGREGATION_TIMEOUT) as client:
            response = await client.get(f"{BACKEND_BASE}/api/v1/zkdefi/opportunities/list")
            if response.status_code == 200:
                data = response.json()
                return data.get("opportunities", [])
    except Exception as e:
        logger.warning(f"Failed to fetch opportunities: {e}")
    
    return []


def opportunity_to_signal(opportunity: dict, index: int) -> dict:
    """Transform an opportunity into a signal with constitution and predictions."""
    
    opp_type = opportunity.get("type", "unknown")
    opp_id = opportunity.get("id", f"signal-{opp_type}-{index}")
    
    # Constitution: deterministic contract/entity/asset context
    constitution = {
        "contract": "0x05ba14536eca827e292bf633c2963abc048f0160a8a3efea6a71ca07d0bb3e64",  # zkdefi-core
        "entity": opportunity.get("adapter", f"zkdefi-{opp_type}"),
        "asset": opportunity.get("token", opportunity.get("token0", "UNKNOWN")),
        "pool": opportunity.get("poolId", opportunity.get("pool", "primary"))
    }
    
    # Add entity-specific context
    if opp_type == "lending":
        constitution["entity"] = "zkdefi-lending"
        constitution["pool"] = "primary_lending_pool"
    elif opp_type == "staking":
        constitution["entity"] = "zkdefi-staking"
        constitution["asset"] = opportunity.get("stakingToken", "STRK")
    elif opp_type == "dex":
        constitution["entity"] = opportunity.get("dex", "ekubo")
        constitution["pool"] = f"{opportunity.get('token0', 'ETH')}-{opportunity.get('token1', 'USDC')}"
    
    # Placeholder predictions (Phase 1)
    yield_forecast = opportunity.get("apy", opportunity.get("estimatedApy", 3.0))
    risk_score = max(1, min(99, 
        25 if opp_type == "lending" else 
        35 if opp_type == "staking" else 
        50 if opp_type == "dex" else 
        40
    ))
    
    signal = {
        "id": opp_id,
        "opportunity_id": opportunity.get("id"),
        "type": opp_type,
        "name": opportunity.get("name", f"{opp_type.title()} Opportunity"),
        "description": opportunity.get("description", ""),
        "currentYield": yield_forecast,
        "riskScore": risk_score,
        "privacyMode": opportunity.get("privacyMode", "public"),
        "rank": index + 1,
        "constitution": constitution,
        "predictions": {
            "yieldForecast": {
                "model": "yield-predictor-v1",
                "predicted_apy": yield_forecast * 1.05,  # Placeholder: 5% upside
                "confidence": 0.72,
                "horizon": "7d"
            },
            "reputationScore": {
                "model": "reputation-v1",
                "score": 85 if opp_type != "dex" else 72,
                "trustworthiness": "high" if risk_score < 40 else "moderate"
            },
            "marketForecaster": {
                "model": "forecaster-circuit-v1",
                "probability_up_5m": 0.62,
                "probability_up_30m": 0.68,
                "probability_up_4h": 0.71,
                "calibration_score": 0.88
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
            "phase": "phase-1-placeholder",
            "ready_for_predictions": True
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
        "phase": "phase-1-placeholder",
        "components": {
            "opportunities_aggregation": "active",
            "signal_transformation": "active",
            "predictions": "placeholder",
            "zkml_verification": "pending"
        },
        "readiness": {
            "phase_1": True,
            "phase_2_ready": True,
            "phase_3_ready": False
        }
    }
