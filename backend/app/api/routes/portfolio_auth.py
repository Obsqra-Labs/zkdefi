"""Signed auth session routes for the `/portfolio` lane."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.middleware.portfolio_session import PortfolioSession
from app.services.portfolio_auth_session_service import (
    PortfolioAuthSessionError,
    PortfolioAuthSessionUnauthorizedError,
    get_portfolio_auth_session_service,
)
from app.services.portfolio_auth_telemetry_service import (
    get_portfolio_auth_telemetry_service,
)

router = APIRouter(prefix="/portfolio/auth", tags=["portfolio-auth"])
logger = logging.getLogger("uvicorn.error")


class PortfolioSessionStartRequest(BaseModel):
    starknet_address: str
    chain_id: str


class PortfolioSessionCompleteRequest(BaseModel):
    starknet_address: str
    nonce_id: str
    signature: Any


class PortfolioSessionTelemetryRequest(BaseModel):
    outcome: str
    failure_stage: str | None = None
    starknet_address: str | None = None
    chain_id: str | None = None
    total_ms: float | None = None
    start_ms: float | None = None
    sign_ms: float | None = None
    complete_ms: float | None = None
    api_status: int | None = None
    error: str | None = None
    user_agent: str | None = None
    timestamp: str | None = None


@router.post("/session/start")
async def start_portfolio_session(req: PortfolioSessionStartRequest) -> dict[str, Any]:
    try:
        return get_portfolio_auth_session_service().start(req.starknet_address, req.chain_id)
    except PortfolioAuthSessionUnauthorizedError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except PortfolioAuthSessionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/session/complete")
async def complete_portfolio_session(req: PortfolioSessionCompleteRequest) -> dict[str, Any]:
    try:
        return get_portfolio_auth_session_service().complete(
            req.starknet_address,
            req.nonce_id,
            req.signature,
        )
    except PortfolioAuthSessionUnauthorizedError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except PortfolioAuthSessionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/session/verify")
async def verify_portfolio_session(session: dict[str, Any] = PortfolioSession) -> dict[str, Any]:
    """Validate bearer token and return normalized session context."""
    return {
        "active": True,
        "starknet_address": session.get("starknet_address"),
        "chain_id": session.get("chain_id"),
        "issued_at": session.get("issued_at"),
        "expires_at": session.get("expires_at"),
    }


@router.post("/telemetry")
async def portfolio_auth_telemetry(
    req: PortfolioSessionTelemetryRequest,
    request: Request,
) -> dict[str, bool]:
    """Capture portfolio auth flow timing signals from the frontend."""
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    telemetry_service = get_portfolio_auth_telemetry_service()
    recorded = telemetry_service.record(
        {
            "outcome": req.outcome,
            "failure_stage": req.failure_stage,
            "starknet_address": req.starknet_address,
            "chain_id": req.chain_id,
            "total_ms": req.total_ms,
            "start_ms": req.start_ms,
            "sign_ms": req.sign_ms,
            "complete_ms": req.complete_ms,
            "api_status": req.api_status,
            "error": req.error,
            "user_agent": req.user_agent or request.headers.get("user-agent"),
            "timestamp": req.timestamp,
            "ip": client_ip,
        }
    )
    logger.info(
        "portfolio_auth_telemetry outcome=%s stage=%s total_ms=%s start_ms=%s sign_ms=%s complete_ms=%s status=%s address=%s chain=%s ip=%s ua=%s error=%s",
        recorded.get("outcome"),
        recorded.get("failure_stage"),
        recorded.get("total_ms"),
        recorded.get("start_ms"),
        recorded.get("sign_ms"),
        recorded.get("complete_ms"),
        recorded.get("api_status"),
        recorded.get("starknet_address"),
        recorded.get("chain_id"),
        recorded.get("ip"),
        recorded.get("user_agent"),
        recorded.get("error"),
    )
    summary = telemetry_service.summarize(window_sec=600)
    for alert in summary.get("alerts", []):
        if not alert.get("emit_log_warning"):
            continue
        logger.warning(
            "portfolio_auth_telemetry_alert id=%s severity=%s count=%s ratio=%s window_events=%s window_sec=%s message=%s",
            alert.get("id"),
            alert.get("severity"),
            alert.get("count"),
            alert.get("ratio"),
            alert.get("window_event_count"),
            alert.get("window_sec"),
            alert.get("message"),
        )
    return {"ok": True}


@router.get("/telemetry/summary")
async def portfolio_auth_telemetry_summary(
    window_sec: int = Query(default=24 * 60 * 60, ge=60, le=7 * 24 * 60 * 60),
) -> dict[str, Any]:
    """Return aggregate portfolio auth telemetry over the requested window."""
    return get_portfolio_auth_telemetry_service().summarize(window_sec=window_sec)
