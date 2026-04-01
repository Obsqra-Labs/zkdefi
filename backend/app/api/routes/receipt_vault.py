"""
Receipt Vault API.
"""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.receipt_vault_service import get_receipt_vault_service


router = APIRouter(tags=["receipt-vault"])


class VerifyReceiptRequest(BaseModel):
    cid: str = Field(..., min_length=1)


class PassportRegisterRequest(BaseModel):
    wallet_address: str
    receipt_id: str | int
    tx_hash: str
    policy_hash: str
    proof_hash: str | None = None
    tier: str | None = None
    tier_name: str | None = None
    reputation_score: float | None = None
    gates: dict[str, bool] | None = None
    scanned_at: str | None = None
    claim_kind: str | None = "passport"
    claimed_at: str | None = None


@router.get("/archive/{owner_address}")
async def get_receipt_archive(owner_address: str) -> dict[str, Any]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    service = get_receipt_vault_service()
    receipts = await service.list_receipts(owner_address)
    return {
        "owner_address": owner_address.lower(),
        "receipts": receipts,
    }


@router.get("/receipt/{registry_receipt_id}")
async def get_receipt_detail(registry_receipt_id: str) -> dict[str, Any]:
    service = get_receipt_vault_service()
    receipt = await service.get_receipt(registry_receipt_id, verify=True)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


@router.get("/receipt/{registry_receipt_id}/bundle")
async def get_receipt_bundle(registry_receipt_id: str) -> JSONResponse:
    """Serve the receipt bundle JSON directly (self-hosted fallback for IPFS gateways)."""
    service = get_receipt_vault_service()
    receipt = await service.get_receipt(registry_receipt_id, verify=False)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    bundle = receipt.get("bundle") or {}
    return JSONResponse(
        content=bundle,
        headers={
            "Content-Disposition": "inline; filename=receipt-bundle.json",
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-CID": receipt.get("cid") or "",
        },
    )


@router.post("/verify")
async def verify_receipt_bundle(request: VerifyReceiptRequest) -> dict[str, Any]:
    service = get_receipt_vault_service()
    try:
        return await service.verify_cid(request.cid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/passport/register")
async def register_passport_receipt(request: PassportRegisterRequest) -> dict[str, Any]:
    if not request.wallet_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Wallet address must start with 0x")
    if not request.tx_hash.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Tx hash must start with 0x")
    if not request.policy_hash.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Policy hash must start with 0x")
    if not os.getenv("STORACHA_AGENT_KEY", "").strip() or not os.getenv("STORACHA_SPACE_PROOF", "").strip():
        raise HTTPException(status_code=503, detail="Missing STORACHA_AGENT_KEY or STORACHA_SPACE_PROOF")
    service = get_receipt_vault_service()
    try:
        return await service.register_passport_claim(
            wallet_address=request.wallet_address,
            registry_receipt_id=request.receipt_id,
            tx_hash=request.tx_hash,
            policy_hash=request.policy_hash,
            proof_hash=request.proof_hash,
            tier=request.tier or request.tier_name,
            claim_metadata=request.model_dump(
                exclude_none=True,
                exclude={"wallet_address", "receipt_id", "tx_hash", "policy_hash", "proof_hash", "tier"},
            ),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
