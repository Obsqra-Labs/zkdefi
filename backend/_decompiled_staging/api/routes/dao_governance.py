# Source Generated with Decompyle++
# File: dao_governance.cpython-312.pyc (Python 3.12)

'''
DAO Governance API Routes

Endpoints for private DAO voting and proposal management.
'''
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging
from app.services.dao_voting_service import get_dao_voting_service
logger = logging.getLogger(__name__)
router = APIRouter()

class CreateProposalRequest(BaseModel):
    new_value: int = 'CreateProposalRequest'
    vote_duration_seconds: int = 604800


class CreateProposalResponse(BaseModel):
    voting_ends_at: int = 'CreateProposalResponse'


class VoteRequest(BaseModel):
    vote_direction: int = 'VoteRequest'


class VoteResponse(BaseModel):
    vote_value: int = 'VoteResponse'


class CastVoteRequest(BaseModel):
    vote_direction: int = 'CastVoteRequest'


class CastVoteResponse(BaseModel):
    vote_recorded: bool = 'CastVoteResponse'


class ProposalResponse(BaseModel):
    passed: bool = 'ProposalResponse'

create_proposal = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
generate_vote_proof = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
cast_vote = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
get_proposal = (lambda proposal_id = None: pass# WARNING: Decompyle incomplete
)()
list_proposals = (lambda status = None, limit = None, offset = router.get('/dao/proposals', response_model = List[ProposalResponse]): pass# WARNING: Decompyle incomplete
)()
get_voting_power = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
tally_proposal = (lambda proposal_id = None: pass# WARNING: Decompyle incomplete
)()
execute_proposal = (lambda proposal_id = None: pass# WARNING: Decompyle incomplete
)()
