"""
Stark ID API Routes

Store and retrieve .stark name bindings for addresses.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.middleware.auth import WalletOwner
from app.services.json_store import JsonStore

router = APIRouter(prefix="/stark_id", tags=["stark_id"])

_stark_id_store = JsonStore("stark_id_bindings")


class StarkIdBinding(BaseModel):
    address: str
    stark_name: Optional[str] = None


@router.get("/{address}")
async def get_stark_id(address: str):
    """Get the .stark name binding for an address."""
    key = address.lower().strip()
    binding = _stark_id_store.get(key)
    if binding:
        return {"address": address, "stark_name": binding.get("stark_name"), "bound": True}
    return {"address": address, "stark_name": None, "bound": False}


@router.put("/{address}")
async def set_stark_id(address: str, req: StarkIdBinding, _caller: str = WalletOwner):
    """Store a .stark name binding for an address."""
    key = address.lower().strip()
    _stark_id_store.set(key, {
        "address": address,
        "stark_name": req.stark_name,
    })
    return {"address": address, "stark_name": req.stark_name, "bound": True}
