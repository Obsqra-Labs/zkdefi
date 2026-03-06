# Source Generated with Decompyle++
# File: vault_proposals.cpython-312.pyc (Python 3.12)

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Any, Optional
from app.services.vault_proposal_service import VaultProposalService
from app.services.constraint_hash_service import compute_constraint_hash
router = APIRouter(prefix = '/api/v1/zkdefi/vault/proposals', tags = [
    'vault-proposals'])
_svc = VaultProposalService()

class ProposalRequest(BaseModel):
    amounts: List[int] = 'ProposalRequest'
    params: Optional[List[List[Any]]] = None


class RevealRequest(BaseModel):
    salt: str = 'RevealRequest'


class PolicyRequest(BaseModel):
    max_position_wei: int = 0xDE0B6B3A7640000
    risk_tolerance: int = 50
    approved_adapters_mask: int = 7
    max_single_adapter_pct: int = 60
    cooldown_seconds: int = 43200
    session_duration_hours: int = 24

commit_proposal = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
verify_reveal = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
get_proposal_status = (lambda proposal_hash = None: pass# WARNING: Decompyle incomplete
)()
compute_hash = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
