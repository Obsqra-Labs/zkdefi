"""Proxy routes to the market-maker-sim service (port 8099).

Exposes the sim state, events, and contract addresses through the main
backend API so the frontend can consume a single origin.

All data forwarded from the sim is tagged with `data_quality: "simulated"`
so downstream consumers never confuse it with real market data.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/sim", tags=["sim"])

_SIM_BASE = os.getenv("MM_SIM_URL", "http://localhost:8099")
_TIMEOUT = 5.0


async def _proxy_get(path: str) -> dict[str, Any]:
    """Forward a GET request to the sim service."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_SIM_BASE}{path}")
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Market sim service unreachable")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="Sim service error")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/health")
async def sim_health() -> dict[str, Any]:
    """Health check proxy — confirms the sim is alive."""
    return await _proxy_get("/health")


@router.get("/state")
async def sim_state() -> dict[str, Any]:
    """Current sim snapshot tagged as simulated data."""
    data = await _proxy_get("/public/state")
    data["data_quality"] = "simulated"
    return data


@router.get("/events")
async def sim_events() -> dict[str, Any]:
    """Recent sim events tagged as simulated data."""
    data = await _proxy_get("/public/events")
    data["data_quality"] = "simulated"
    return data


@router.get("/contracts")
async def sim_contracts() -> dict[str, Any]:
    """Deployed mock-token contract addresses."""
    data = await _proxy_get("/public/contracts")
    data["data_quality"] = "simulated"
    return data


@router.get("/scenarios")
async def sim_scenarios() -> dict[str, Any]:
    """Available preset scenarios."""
    return await _proxy_get("/public/scenarios")
