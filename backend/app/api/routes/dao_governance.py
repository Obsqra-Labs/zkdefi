"""
DAO Governance API Routes

Endpoints for private DAO voting and proposal management.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

from app.services.dao_voting_service import get_dao_voting_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ==============================================================================
# Request/Response Models
# ==============================================================================

class CreateProposalRequest(BaseModel):
    proposer_address: str
    proposal_type: str  # "adapter_limit", "whitelist_asset", "emergency_pause"
    target_address: str  # Adapter or asset address
    new_value: int
    vote_duration_seconds: int = 604800  # 7 days default


class CreateProposalResponse(BaseModel):
    proposal_id: int
    tx_hash: str
    voting_ends_at: int


class VoteRequest(BaseModel):
    user_address: str
    proposal_id: int
    vote_direction: int  # 0 = against, 1 = for


class VoteResponse(BaseModel):
    proof_calldata: List[str]
    nullifier_hash: str
    commitment: str
    vote_value: int


class CastVoteRequest(BaseModel):
    user_address: str
    proposal_id: int
    vote_direction: int
    
    
class CastVoteResponse(BaseModel):
    tx_hash: str
    nullifier_hash: str
    vote_recorded: bool


class ProposalResponse(BaseModel):
    id: int
    proposer: str
    proposal_type: str
    target: str
    new_value: int
    votes_for: int
    votes_against: int
    total_votes: int
    created_at: int
    voting_ends_at: int
    executed: bool
    passed: bool


# ==============================================================================
# Endpoints
# ==============================================================================

@router.post("/dao/proposals", response_model=CreateProposalResponse)
async def create_proposal(request: CreateProposalRequest):
    """
    Create a new governance proposal.
    
    Requires:
    - Proposer has minimum voting power threshold
    - Valid proposal type
    """
    try:
        # TODO: Call DAOConstraintManager.create_proposal()
        # For now, return mock
        
        proposal_id = 1  # Mock
        tx_hash = "0xmock_tx_hash"
        voting_ends_at = 1234567890
        
        logger.info(f"Proposal created: {proposal_id} by {request.proposer_address}")
        
        return CreateProposalResponse(
            proposal_id=proposal_id,
            tx_hash=tx_hash,
            voting_ends_at=voting_ends_at,
        )
    except Exception as e:
        logger.error(f"Failed to create proposal: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dao/vote/generate_proof", response_model=VoteResponse)
async def generate_vote_proof(request: VoteRequest):
    """
    Generate ZK proof for private vote.
    
    Returns proof_calldata that can be submitted on-chain via cast_vote_with_proof().
    
    Privacy: vote_direction is never revealed on-chain.
    """
    try:
        voting_service = get_dao_voting_service()
        
        proof = await voting_service.generate_voting_proof(
            user_address=request.user_address,
            proposal_id=request.proposal_id,
            vote_direction=request.vote_direction,
        )
        
        logger.info(f"Vote proof generated for proposal {request.proposal_id}")
        
        return VoteResponse(
            proof_calldata=proof.proof_calldata,
            nullifier_hash=proof.nullifier_hash,
            commitment=proof.commitment,
            vote_value=proof.vote_value,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate vote proof: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dao/vote/cast", response_model=CastVoteResponse)
async def cast_vote(request: CastVoteRequest):
    """
    Generate proof and submit vote on-chain.
    
    This endpoint:
    1. Generates ZK proof
    2. Submits to DAOConstraintManager.cast_vote_with_proof()
    3. Returns tx_hash
    """
    try:
        # Step 1: Generate proof
        voting_service = get_dao_voting_service()
        proof = await voting_service.generate_voting_proof(
            user_address=request.user_address,
            proposal_id=request.proposal_id,
            vote_direction=request.vote_direction,
        )
        
        # Step 2: Submit on-chain
        # TODO: Call DAOConstraintManager.cast_vote_with_proof()
        # For now, return mock
        tx_hash = "0xmock_vote_tx_hash"
        
        logger.info(f"Vote cast for proposal {request.proposal_id}: nullifier={proof.nullifier_hash[:16]}...")
        
        return CastVoteResponse(
            tx_hash=tx_hash,
            nullifier_hash=proof.nullifier_hash,
            vote_recorded=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to cast vote: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dao/proposals/{proposal_id}", response_model=ProposalResponse)
async def get_proposal(proposal_id: int):
    """
    Get proposal details.
    
    Returns current vote tally and status.
    """
    try:
        # TODO: Query DAOConstraintManager.get_proposal()
        # For now, return mock
        
        return ProposalResponse(
            id=proposal_id,
            proposer="0x123...",
            proposal_type="adapter_limit",
            target="0xabc...",
            new_value=6000,
            votes_for=1000,
            votes_against=300,
            total_votes=1300,
            created_at=1234567000,
            voting_ends_at=1234567890,
            executed=False,
            passed=False,
        )
    except Exception as e:
        logger.error(f"Failed to get proposal: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dao/proposals", response_model=List[ProposalResponse])
async def list_proposals(
    status: Optional[str] = None,  # "active", "ended", "executed"
    limit: int = 20,
    offset: int = 0,
):
    """
    List all proposals (with optional status filter).
    """
    try:
        # TODO: Query DAOConstraintManager for all proposals
        # For now, return empty
        
        return []
    except Exception as e:
        logger.error(f"Failed to list proposals: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dao/voting_power/{user_address}")
async def get_voting_power(user_address: str):
    """
    Get user's voting power (sqrt of LP position).
    """
    try:
        voting_service = get_dao_voting_service()
        
        # TODO: Query actual LP position
        # For now, return mock
        voting_power = 100  # Mock: $10k position = 100 VP
        
        return {
            "user_address": user_address,
            "voting_power": voting_power,
            "basis": "sqrt(lp_position_usd)",
        }
    except Exception as e:
        logger.error(f"Failed to get voting power: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dao/proposals/{proposal_id}/tally")
async def tally_proposal(proposal_id: int):
    """
    Tally votes for a proposal after voting period ends.
    
    Admin or anyone can call this.
    """
    try:
        # TODO: Call DAOConstraintManager.tally_votes()
        
        return {
            "proposal_id": proposal_id,
            "tallied": True,
            "passed": False,
            "votes_for": 0,
            "votes_against": 0,
        }
    except Exception as e:
        logger.error(f"Failed to tally proposal: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dao/proposals/{proposal_id}/execute")
async def execute_proposal(proposal_id: int):
    """
    Execute a passed proposal.
    
    Only callable if:
    - Voting period ended
    - Proposal passed (quorum met + majority for)
    - Not already executed
    """
    try:
        # TODO: Call DAOConstraintManager.execute_proposal()
        
        return {
            "proposal_id": proposal_id,
            "executed": True,
            "tx_hash": "0xmock_execute_tx",
        }
    except Exception as e:
        logger.error(f"Failed to execute proposal: {e}")
        raise HTTPException(status_code=500, detail=str(e))
