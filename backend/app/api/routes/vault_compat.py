"""
Vault compatibility aliases.

Bridges legacy `/api/v1/vault/*` policy/constraint paths to Mission Control
canonical handlers (`/api/v1/zkdefi/mc/*`).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.mission_control import (
    ConstraintsPutRequest,
    PolicyPutRequest,
    get_constraints,
    get_policy,
    put_constraints,
    put_policy,
)

router = APIRouter(tags=["vault-compat"])


@router.get("/constraints/{address}")
async def vault_get_constraints(address: str):
    return await get_constraints(address)


@router.put("/constraints/{address}")
async def vault_put_constraints(address: str, body: ConstraintsPutRequest):
    return await put_constraints(address, body)


@router.get("/policy/{address}")
async def vault_get_policy(address: str):
    return await get_policy(address)


@router.put("/policy/{address}")
async def vault_put_policy(address: str, body: PolicyPutRequest):
    return await put_policy(address, body)
