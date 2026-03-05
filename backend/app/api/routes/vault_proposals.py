from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Any, Optional

from app.services.vault_proposal_service import VaultProposalService
from app.services.constraint_hash_service import compute_constraint_hash

router = APIRouter(
    prefix="/api/v1/zkdefi/vault/proposals",
    tags=["vault-proposals"],
)

_svc = VaultProposalService()


class ProposalRequest(BaseModel):
    adapters: List[str]
    amounts: List[int]
    params: Optional[List[List[Any]]] = None


class RevealRequest(BaseModel):
    proposal_hash: str
    adapters: List[str]
    amounts: List[int]
    params: List[List[Any]]
    salt: str


class PolicyRequest(BaseModel):
    max_position_wei: int = 1_000_000_000_000_000_000
    risk_tolerance: int = 50
    approved_adapters_mask: int = 7
    max_single_adapter_pct: int = 60
    cooldown_seconds: int = 43200
    session_duration_hours: int = 24


@router.post("/commit")
async def commit_proposal(req: ProposalRequest):
    proposal = _svc.create_proposal(
        req.adapters, req.amounts, req.params
    )
    return {
        "proposal_hash": proposal["proposal_hash"],
        "status": "committed",
        "created_at": proposal["created_at"],
    }


@router.post("/reveal/verify")
async def verify_reveal(req: RevealRequest):
    ok = _svc.verify_reveal(
        req.proposal_hash, req.adapters, req.amounts, req.params, req.salt
    )
    if not ok:
        raise HTTPException(400, "Reveal does not match commit")
    return {"verified": True}


@router.get("/status/{proposal_hash}")
async def get_proposal_status(proposal_hash: str):
    p = _svc.get_proposal(proposal_hash)
    if not p:
        raise HTTPException(404, "Proposal not found")
    return {"proposal_hash": p["proposal_hash"], "status": p["status"]}


@router.post("/constraint-hash")
async def compute_hash(req: PolicyRequest):
    h = compute_constraint_hash(req.model_dump())
    return {"constraint_hash": hex(h), "policy": req.model_dump()}
