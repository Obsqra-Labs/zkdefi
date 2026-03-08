"""Linked Addresses API.

GET/PUT linked eth/arb/base/opt addresses keyed by Starknet address.
Ownership verification endpoints enforce signature-backed linking for
score-impacting chains.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.linked_addresses_store import get_linked, set_linked
from app.services.linked_address_verification_service import (
    LinkedAddressVerificationError,
    get_linked_address_verification_service,
)

router = APIRouter(prefix="/linked_addresses", tags=["linked_addresses"])


class LinkedAddressesPut(BaseModel):
    starknet_address: str
    eth: str | None = None
    arb: str | None = None
    base: str | None = None
    opt: str | None = None


class LinkedAddressVerifyStartRequest(BaseModel):
    starknet_address: str
    chain: str  # ethereum | arbitrum | base | optimism
    address: str


class LinkedAddressVerifyCompleteRequest(BaseModel):
    starknet_address: str
    chain: str
    address: str
    nonce_id: str
    signature: str


_SHORT_CHAIN_KEYS = {
    "eth": "ethereum",
    "arb": "arbitrum",
    "base": "base",
    "opt": "optimism",
}


def _verification_payload(starknet_address: str) -> dict[str, dict[str, str | bool | None]]:
    svc = get_linked_address_verification_service()
    status = svc.verification_status(starknet_address)
    by_short: dict[str, dict[str, str | bool | None]] = {}
    reverse = {
        "ethereum": "eth",
        "arbitrum": "arb",
        "base": "base",
        "optimism": "opt",
    }
    for chain, meta in status.items():
        short = reverse.get(chain)
        if not short or not isinstance(meta, dict):
            continue
        by_short[short] = {
            "verified": bool(meta.get("verified", False)),
            "verified_at": meta.get("verified_at"),
            "address": meta.get("address"),
        }
    return by_short


@router.get("/{address}")
async def get_linked_addresses(address: str):
    """Get linked addresses for a Starknet address + verification metadata."""
    payload = get_linked(address)
    payload["verification"] = _verification_payload(address)
    return payload


@router.post("/verify/start")
async def start_linked_address_verification(data: LinkedAddressVerifyStartRequest):
    """Start linked-address verification by issuing a challenge nonce."""
    svc = get_linked_address_verification_service()
    try:
        return svc.start_challenge(data.starknet_address, data.chain, data.address)
    except LinkedAddressVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/verify/complete")
async def complete_linked_address_verification(data: LinkedAddressVerifyCompleteRequest):
    """Complete linked-address verification with a wallet signature."""
    svc = get_linked_address_verification_service()
    try:
        result = svc.complete_challenge(
            data.starknet_address,
            data.chain,
            data.address,
            data.nonce_id,
            data.signature,
        )
    except LinkedAddressVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    linked = get_linked(data.starknet_address)
    chain_to_short = {
        "ethereum": "eth",
        "arbitrum": "arb",
        "base": "base",
        "optimism": "opt",
    }
    short = chain_to_short.get(result.get("chain", ""))
    if short and isinstance(result.get("address"), str):
        set_kwargs = {
            "eth": None,
            "arb": None,
            "base": None,
            "opt": None,
        }
        set_kwargs[short] = result["address"]
        # Preserve existing values by only setting verified chain when absent.
        if not linked.get(short):
            set_linked(data.starknet_address, **set_kwargs)

    result["verification"] = _verification_payload(data.starknet_address)
    return result


@router.put("")
async def put_linked_addresses(data: LinkedAddressesPut):
    """Set linked addresses for a Starknet address. Omitted keys are left unchanged."""
    svc = get_linked_address_verification_service()

    if svc.required:
        for short, chain in _SHORT_CHAIN_KEYS.items():
            value = getattr(data, short)
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            if not svc.is_verified(data.starknet_address, chain, value or ""):
                raise HTTPException(
                    status_code=403,
                    detail=f"Linked address for {chain} must be signature-verified before saving.",
                )

    result = set_linked(
        data.starknet_address,
        eth=data.eth,
        arb=data.arb,
        base=data.base,
        opt=data.opt,
    )
    result["verification"] = _verification_payload(data.starknet_address)
    return result
