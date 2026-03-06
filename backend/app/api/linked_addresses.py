"""
Linked Addresses API

GET/PUT linked eth/arb/base/opt addresses keyed by Starknet address.
Used by reputation (cross-chain baseline) and optional identity/credit-proof.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.linked_addresses_store import get_linked, set_linked

router = APIRouter(prefix="/linked_addresses", tags=["linked_addresses"])


class LinkedAddressesPut(BaseModel):
    starknet_address: str
    eth: str | None = None
    arb: str | None = None
    base: str | None = None
    opt: str | None = None


@router.get("/{address}")
async def get_linked_addresses(address: str):
    """Get linked addresses for a Starknet address."""
    return get_linked(address)


@router.put("")
async def put_linked_addresses(data: LinkedAddressesPut):
    """Set linked addresses for a Starknet address. Omitted keys are left unchanged."""
    result = set_linked(
        data.starknet_address,
        eth=data.eth,
        arb=data.arb,
        base=data.base,
        opt=data.opt,
    )
    return result
