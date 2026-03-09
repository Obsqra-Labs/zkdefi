"""
zkML Marketplace Economy Routes (Phase 2 – Gap 24).

Adds:
  POST /marketplace/models/submit  — third-party model submission
  GET  /marketplace/models/search  — search/filter models
  GET  /marketplace/models/{model_id}/pricing — pricing info
  POST /marketplace/models/{model_id}/subscribe — record subscription intent

All models are persisted via JsonStore (survives restart).
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner
from app.services.json_store import JsonStore

router = APIRouter(tags=["marketplace"])


# ---------------------------------------------------------------------------
# Persistent stores
# ---------------------------------------------------------------------------

_model_store = JsonStore("marketplace_models")
_subscription_store = JsonStore("marketplace_subscriptions")

# Seed built-in models on first import (idempotent)
_BUILTIN_MODELS = [
    {
        "id": "model_zkml_base_v0",
        "name": "zkML Base Model v0",
        "description": "Base model for autonomous LP rebalancing with ZK proofs",
        "type": "proof-gated-lp-agent",
        "creator": "obsqra-labs",
        "fee_bps": 0,
        "status": "active",
        "verified": True,
        "downloads": 0,
        "created_at": "2025-06-01T00:00:00+00:00",
    },
    {
        "id": "model_groth16_verifier",
        "name": "Groth16 Proof Verifier",
        "description": "Circuit-verified execution gating with Groth16 proofs",
        "type": "groth16",
        "creator": "obsqra-labs",
        "fee_bps": 0,
        "status": "active",
        "verified": True,
        "downloads": 0,
        "created_at": "2025-06-15T00:00:00+00:00",
    },
    {
        "id": "model_stone_prover",
        "name": "STONE LP Prover",
        "description": "STONE-based proof generation for privacy-preserving LP management",
        "type": "stone",
        "creator": "obsqra-labs",
        "fee_bps": 50,
        "status": "active",
        "verified": True,
        "downloads": 0,
        "created_at": "2025-07-01T00:00:00+00:00",
    },
]

for _m in _BUILTIN_MODELS:
    if not _model_store.get(_m["id"]):
        _model_store.set(_m["id"], _m)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ModelSubmitRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    description: str = Field(default="", max_length=500)
    model_type: str = Field(..., description="groth16 | stone | custom")
    verifier_address: str = Field(default="", description="On-chain verifier contract (optional)")
    fee_bps: int = Field(default=0, ge=0, le=5000, description="Fee in basis points (0-50%)")


class SubscribeRequest(BaseModel):
    subscriber: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _all_models() -> list[dict[str, Any]]:
    """Return all models from store."""
    return [v for v in _model_store.values() if isinstance(v, dict)]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/marketplace/models/submit")
async def submit_model(
    req: ModelSubmitRequest,
    _wallet: str = WalletOwner,
):
    """Submit a new model to the marketplace (pending review)."""
    model_id = f"model_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    model = {
        "id": model_id,
        "name": req.name,
        "description": req.description,
        "type": req.model_type,
        "creator": _wallet,
        "verifier_address": req.verifier_address,
        "fee_bps": req.fee_bps,
        "status": "pending_review",
        "verified": False,
        "downloads": 0,
        "created_at": now_iso,
    }
    _model_store.set(model_id, model)

    return {
        "status": "ok",
        "model_id": model_id,
        "message": "Model submitted for review",
        "model": model,
    }


@router.get("/marketplace/models/search")
async def search_models(
    q: str = Query(default="", description="Search query"),
    model_type: str = Query(default="", description="Filter by type"),
    status: str = Query(default="active", description="Filter by status"),
    sort: str = Query(default="created_at", description="Sort field"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Search and filter marketplace models."""
    models = _all_models()

    # Filter by status
    if status:
        models = [m for m in models if m.get("status") == status]

    # Filter by type
    if model_type:
        models = [m for m in models if m.get("type") == model_type]

    # Search by name/description
    if q:
        q_lower = q.lower()
        models = [
            m for m in models
            if q_lower in (m.get("name") or "").lower()
            or q_lower in (m.get("description") or "").lower()
        ]

    # Sort
    reverse = True  # newest first by default
    if sort == "fee_bps":
        models.sort(key=lambda m: m.get("fee_bps", 0))
        reverse = False
    elif sort == "downloads":
        models.sort(key=lambda m: m.get("downloads", 0), reverse=True)
    else:
        models.sort(key=lambda m: m.get("created_at", ""), reverse=True)

    total = len(models)
    models = models[offset : offset + limit]

    return {
        "models": models,
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/marketplace/models/{model_id}/pricing")
async def get_model_pricing(model_id: str):
    """Get pricing information for a model."""
    model = _model_store.get(model_id)
    if not isinstance(model, dict):
        raise HTTPException(status_code=404, detail="Model not found")

    fee_bps = model.get("fee_bps", 0)

    return {
        "model_id": model_id,
        "model_name": model.get("name"),
        "fee_bps": fee_bps,
        "fee_pct": round(fee_bps / 100, 2),
        "payment_token": "STRK",
        "billing": "per-execution" if fee_bps > 0 else "free",
        "creator": model.get("creator"),
        "verified": model.get("verified", False),
    }


@router.post("/marketplace/models/{model_id}/subscribe")
async def subscribe_to_model(
    model_id: str,
    req: SubscribeRequest,
    _wallet: str = WalletOwner,
):
    """Record a subscription (usage intent) for a model."""
    model = _model_store.get(model_id)
    if not isinstance(model, dict):
        raise HTTPException(status_code=404, detail="Model not found")

    sub_id = f"sub_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    subscription = {
        "id": sub_id,
        "model_id": model_id,
        "subscriber": req.subscriber,
        "created_at": now_iso,
        "status": "active",
    }
    _subscription_store.set(sub_id, subscription)

    # Bump download counter
    model["downloads"] = model.get("downloads", 0) + 1
    _model_store.set(model_id, model)

    return {
        "status": "ok",
        "subscription_id": sub_id,
        "model_id": model_id,
        "message": "Subscribed to model",
    }
