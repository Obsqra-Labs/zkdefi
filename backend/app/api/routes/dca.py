"""DCA Strategy API Routes — CRUD for Dollar-Cost-Averaging strategies."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner
from app.services import dca_strategy_store as store

router = APIRouter(prefix="/dca", tags=["dca"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class CreateDCARequest(BaseModel):
    user_address: str
    token_in: str = Field(..., description="Token address to sell")
    token_out: str = Field(..., description="Token address to buy")
    amount_per_interval: float = Field(..., gt=0, description="Amount (human) per execution")
    interval_secs: int = Field(default=3600, ge=60, description="Seconds between swaps")
    max_slippage_bps: int = Field(default=50, ge=1, le=500)
    label: Optional[str] = None


class UpdateDCARequest(BaseModel):
    amount_per_interval: Optional[float] = None
    interval_secs: Optional[int] = None
    max_slippage_bps: Optional[int] = None
    label: Optional[str] = None
    status: Optional[str] = None  # "active" | "paused"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/strategies/{user_address}")
async def list_strategies(user_address: str) -> dict[str, Any]:
    """List all DCA strategies for a user."""
    strategies = store.list_strategies(user_address)
    return {"user_address": user_address, "strategies": strategies, "count": len(strategies)}


@router.get("/strategies/{user_address}/{strategy_id}")
async def get_strategy(user_address: str, strategy_id: str) -> dict[str, Any]:
    """Get a single DCA strategy by ID."""
    s = store.get_strategy(user_address, strategy_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return s


@router.post("/strategies")
async def create_strategy(request: CreateDCARequest, _caller: str = WalletOwner) -> dict[str, Any]:
    """Create a new DCA strategy."""
    existing = store.list_strategies(request.user_address)
    if len(existing) >= 10:
        raise HTTPException(status_code=400, detail="Max 10 DCA strategies per user")

    record = store.create_strategy(
        user_address=request.user_address,
        token_in=request.token_in,
        token_out=request.token_out,
        amount_per_interval=request.amount_per_interval,
        interval_secs=request.interval_secs,
        max_slippage_bps=request.max_slippage_bps,
        label=request.label,
    )
    return {"status": "created", **record}


@router.put("/strategies/{user_address}/{strategy_id}")
async def update_strategy(
    user_address: str,
    strategy_id: str,
    request: UpdateDCARequest,
    _caller: str = WalletOwner,
) -> dict[str, Any]:
    """Update a DCA strategy (amount, interval, status, etc.)."""
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    if "status" in updates and updates["status"] not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'paused'")

    updated = store.update_strategy(user_address, strategy_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"status": "updated", **updated}


@router.delete("/strategies/{user_address}/{strategy_id}")
async def delete_strategy(
    user_address: str,
    strategy_id: str,
    _caller: str = WalletOwner,
) -> dict[str, Any]:
    """Delete a DCA strategy."""
    ok = store.delete_strategy(user_address, strategy_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"status": "deleted", "strategy_id": strategy_id}
