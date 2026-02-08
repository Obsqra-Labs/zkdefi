"""
Full Privacy Pool API Routes

Endpoints for:
- Deposit commitment generation
- Withdrawal proof generation
- Selective disclosure proofs
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from ...services.full_privacy_proof_service import get_full_privacy_service
from ...services.merkle_tree_service import (
    get_merkle_tree,
    find_commitment_in_tree,
    compute_commitment,
)
from ...services.circomlib_poseidon import STARK_PRIME
from ...services.merkle_tree_onchain_sync import schedule_register_root_on_chain


router = APIRouter(tags=["Full Privacy"])


# ==================== Request/Response Models ====================

class DepositCommitmentRequest(BaseModel):
    user_address: str
    amount: str | int  # in wei - accept string to preserve precision
    pool_type: int  # 0=Conservative, 1=Neutral, 2=Aggressive


class DepositCommitmentResponse(BaseModel):
    commitment: str
    user_secret: str  # User must store this securely
    amount: str  # Return as string to avoid JS JSON.parse() precision loss for large wei values
    pool_type: int
    nonce: str
    blinding: str
    message: str


class RegisterCommitmentRequest(BaseModel):
    commitment: str


class RegisterCommitmentResponse(BaseModel):
    leaf_index: int
    merkle_root: str
    path_elements: List[str]
    path_indices: List[int]


class WithdrawProofRequest(BaseModel):
    user_secret: str
    amount: str | int  # Accept string to preserve precision
    pool_type: int
    nonce: str
    blinding: str
    withdraw_amount: str | int  # Accept string to preserve precision
    recipient: str
    leaf_index: int = -1  # Optional - will auto-find if -1 or missing
    # Optional: stored merkle proof from registration (bypasses get_merkle_proof bug)
    merkle_root: Optional[str] = None
    path_elements: Optional[List[str]] = None
    path_indices: Optional[List[int]] = None


class WithdrawProofResponse(BaseModel):
    nullifier: str
    root: str
    recipient: str
    amount: int
    pool_type: int
    proof_calldata: List[str]
    message: str


class BalanceDisclosureRequest(BaseModel):
    user_secret: str
    amount: int
    pool_type: int
    nonce: str
    blinding: str
    threshold: int  # Prove balance > threshold
    leaf_index: int


class PoolDisclosureRequest(BaseModel):
    user_secret: str
    amount: int
    pool_type: int
    nonce: str
    blinding: str
    leaf_index: int


class DisclosureResponse(BaseModel):
    disclosure_type: str
    root: str
    proof_calldata: List[str]
    verified: bool
    message: str


class MerkleRootResponse(BaseModel):
    root: str
    leaf_count: int


# ==================== Endpoints ====================

@router.post("/deposit/generate_commitment", response_model=DepositCommitmentResponse)
async def generate_deposit_commitment(request: DepositCommitmentRequest):
    """
    Generate a commitment for deposit.
    
    The user must store the returned data securely - it's needed for withdrawal.
    Only the commitment goes on-chain; everything else stays private.
    """
    try:
        svc = get_full_privacy_service()
        # Handle amount as string or int to preserve precision
        amount = int(request.amount) if isinstance(request.amount, str) else request.amount
        result = svc.generate_deposit_commitment(
            user_address=request.user_address,
            amount=amount,
            pool_type=request.pool_type,
        )
        return DepositCommitmentResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/deposit/register_commitment", response_model=RegisterCommitmentResponse)
async def register_commitment(request: RegisterCommitmentRequest):
    """
    Register a commitment in the merkle tree after on-chain deposit.
    
    Should be called after the deposit transaction is confirmed.
    Returns merkle proof data for future withdrawals.
    If FULL_PRIVACY_MERKLE_TREE_ADDRESS and admin key are set, schedules
    add_known_root(root_felt) on the pool's merkle tree so withdrawals are accepted.
    """
    try:
        svc = get_full_privacy_service()
        commitment = int(request.commitment, 16) if request.commitment.startswith("0x") else int(request.commitment)
        result = svc.register_commitment(commitment)
        root_int = int(result["merkle_root"], 16) if result["merkle_root"].startswith("0x") else int(result["merkle_root"])
        schedule_register_root_on_chain(root_int)
        return RegisterCommitmentResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/reset")
async def reset_merkle_tree_endpoint():
    """
    Reset the backend merkle tree to empty state.
    Use after pool contract redeployment or desync.
    """
    from ...services.merkle_tree_service import reset_merkle_tree
    from ...services.full_privacy_proof_service import reset_full_privacy_service
    reset_merkle_tree()
    reset_full_privacy_service()  # Also clear the service singleton so it picks up the new tree
    tree = get_merkle_tree()
    return {"message": "Merkle tree reset", "root": hex(tree.get_root()), "leaf_count": tree.get_leaf_count()}


@router.post("/withdraw/generate_proof", response_model=WithdrawProofResponse)
async def generate_withdraw_proof(request: WithdrawProofRequest):
    """
    Generate a withdrawal proof.
    
    Proves:
    - You know the preimage of a commitment in the merkle tree
    - The nullifier is correctly derived
    - withdraw_amount <= your balance
    - pool_type matches
    
    If leaf_index is -1 or invalid, will auto-search the tree.
    Returns proof calldata for on-chain verification.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        svc = get_full_privacy_service()
        
        # Parse hex inputs
        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        
        # Handle amount as string or int to preserve precision
        amount = int(request.amount) if isinstance(request.amount, str) else request.amount
        withdraw_amount = int(request.withdraw_amount) if isinstance(request.withdraw_amount, str) else request.withdraw_amount
        
        # Debug logging
        logger.warning(f"[Withdraw] Inputs: user_secret={hex(user_secret)[:20]}..., amount={amount}, pool_type={request.pool_type}, nonce={hex(nonce)}, blinding={hex(blinding)}")
        
        # Auto-find leaf_index if not provided or invalid
        leaf_index = request.leaf_index
        if leaf_index < 0:
            # Recompute commitment from preimage; tree stores commitment % STARK_PRIME (felt252-safe)
            commitment = compute_commitment(user_secret, amount, request.pool_type, nonce, blinding)
            commitment_felt = commitment % STARK_PRIME
            logger.warning(f"[Withdraw] Computed commitment_felt: {hex(commitment_felt)}")
            
            # Show what's in the tree for debugging
            tree = get_merkle_tree()
            logger.warning(f"[Withdraw] Tree has {len(tree.leaves)} leaves: {[hex(l)[:20]+'...' for l in tree.leaves]}")
            
            found_index = find_commitment_in_tree(commitment_felt)
            if found_index is None:
                raise ValueError(
                    f"Commitment not found in merkle tree. "
                    f"Computed commitment_felt: {hex(commitment_felt)}. "
                    f"Tree has {get_merkle_tree().get_leaf_count()} leaves. "
                    f"This may happen if: (1) the deposit wasn't registered, "
                    f"(2) commitment was made with old parameters, "
                    f"or (3) there's a Poseidon hash mismatch."
                )
            leaf_index = found_index
            logger.warning(f"[Withdraw] Found at leaf_index={leaf_index}")
        
        # Parse stored proof if provided
        stored_root = None
        stored_path_elements = None
        stored_path_indices = None
        if request.merkle_root and request.path_elements and request.path_indices:
            stored_root = int(request.merkle_root, 16) if request.merkle_root.startswith("0x") else int(request.merkle_root)
            stored_path_elements = [int(p, 16) if p.startswith("0x") else int(p) for p in request.path_elements]
            stored_path_indices = request.path_indices
            logger.warning(f"[Withdraw] Using stored proof from registration (root={hex(stored_root)[:20]}...)")
        
        result = svc.generate_withdraw_proof(
            user_secret=user_secret,
            amount=amount,
            pool_type=request.pool_type,
            nonce=nonce,
            blinding=blinding,
            withdraw_amount=withdraw_amount,
            recipient=request.recipient,
            leaf_index=leaf_index,
            merkle_root=stored_root,
            path_elements=stored_path_elements,
            path_indices=stored_path_indices,
        )
        
        return WithdrawProofResponse(
            nullifier=result["nullifier"],
            root=result["root"],
            recipient=result["recipient"],
            amount=result["amount"],
            pool_type=result["pool_type"],
            proof_calldata=result["proof_calldata"],
            message=result["message"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disclosure/balance_above", response_model=DisclosureResponse)
async def prove_balance_above(request: BalanceDisclosureRequest):
    """
    Generate a selective disclosure proof that balance > threshold.
    
    Does NOT reveal the actual balance, only that it exceeds the threshold.
    """
    try:
        svc = get_full_privacy_service()
        
        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        
        result = svc.generate_balance_disclosure_proof(
            user_secret=user_secret,
            amount=request.amount,
            pool_type=request.pool_type,
            nonce=nonce,
            blinding=blinding,
            threshold=request.threshold,
            leaf_index=request.leaf_index,
        )
        
        return DisclosureResponse(
            disclosure_type=result["disclosure_type"],
            root=result["root"],
            proof_calldata=result["proof_calldata"],
            verified=result["verified"],
            message=result["message"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disclosure/pool_membership", response_model=DisclosureResponse)
async def prove_pool_membership(request: PoolDisclosureRequest):
    """
    Generate a selective disclosure proof of pool membership.
    
    Does NOT reveal balance or commitment identity.
    """
    try:
        svc = get_full_privacy_service()
        
        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        
        result = svc.generate_pool_membership_proof(
            user_secret=user_secret,
            amount=request.amount,
            pool_type=request.pool_type,
            nonce=nonce,
            blinding=blinding,
            leaf_index=request.leaf_index,
        )
        
        return DisclosureResponse(
            disclosure_type=result["disclosure_type"],
            root=result["root"],
            proof_calldata=result["proof_calldata"],
            verified=result["verified"],
            message=result["message"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/merkle/root", response_model=MerkleRootResponse)
async def get_merkle_root():
    """
    Get the current merkle root and leaf count.
    """
    tree = get_merkle_tree()
    return MerkleRootResponse(
        root=hex(tree.get_root()),
        leaf_count=tree.get_leaf_count(),
    )


@router.get("/merkle/is_known_root/{root}")
async def check_known_root(root: str):
    """
    Check if a merkle root is known (in history).
    """
    tree = get_merkle_tree()
    root_int = int(root, 16) if root.startswith("0x") else int(root)
    is_known = tree.is_known_root(root_int)
    return {"root": root, "is_known": is_known}


@router.get("/merkle/leaves")
async def get_merkle_leaves():
    """
    Get all leaves in the merkle tree (for debugging).
    """
    tree = get_merkle_tree()
    return {
        "leaf_count": len(tree.leaves),
        "leaves": [hex(leaf) for leaf in tree.leaves],
        "root": hex(tree.root),
    }


class FindCommitmentRequest(BaseModel):
    user_secret: str
    amount: int
    pool_type: int
    nonce: str
    blinding: str = "0x0"


class VerifyCommitmentRequest(BaseModel):
    """Verify that a commitment matches its preimage."""
    commitment: str
    user_secret: str
    amount: int
    pool_type: int
    nonce: str
    blinding: str = "0x0"


@router.post("/debug/verify_commitment")
async def verify_commitment(request: VerifyCommitmentRequest):
    """
    Debug endpoint: Verify that a commitment matches its preimage.
    
    Returns whether the computed commitment matches the stored one.
    """
    try:
        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        stored_commitment = int(request.commitment, 16) if request.commitment.startswith("0x") else int(request.commitment)
        
        # Recompute commitment; stored value is commitment_felt (commitment % STARK_PRIME)
        computed = compute_commitment(user_secret, request.amount, request.pool_type, nonce, blinding)
        computed_felt = computed % STARK_PRIME
        matches = computed_felt == stored_commitment
        
        # Also check if it's in the tree (tree stores commitment_felt)
        tree = get_merkle_tree()
        in_tree_stored = find_commitment_in_tree(stored_commitment)
        in_tree_computed = find_commitment_in_tree(computed_felt)
        
        return {
            "stored_commitment": hex(stored_commitment),
            "computed_commitment": hex(computed_felt),
            "matches": matches,
            "stored_in_tree_at": in_tree_stored,
            "computed_in_tree_at": in_tree_computed,
            "inputs": {
                "user_secret": hex(user_secret)[:20] + "...",
                "amount": request.amount,
                "pool_type": request.pool_type,
                "nonce": hex(nonce),
                "blinding": hex(blinding),
            },
            "tree_leaves": [hex(l)[:30] + "..." for l in tree.leaves],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/find_commitment")
async def find_commitment(request: FindCommitmentRequest):
    """
    Find a commitment in the merkle tree by recomputing from preimage.
    
    Use this to check if your commitment is in the tree and get the leaf_index.
    """
    try:
        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        
        # Recompute commitment; tree stores commitment % STARK_PRIME
        commitment = compute_commitment(user_secret, request.amount, request.pool_type, nonce, blinding)
        commitment_felt = commitment % STARK_PRIME
        
        # Search tree
        leaf_index = find_commitment_in_tree(commitment_felt)
        tree = get_merkle_tree()
        
        if leaf_index is not None:
            return {
                "found": True,
                "commitment": hex(commitment_felt),
                "leaf_index": leaf_index,
                "merkle_root": hex(tree.root),
                "message": "Commitment found in tree",
            }
        else:
            # Show what leaves ARE in the tree for debugging
            return {
                "found": False,
                "commitment": hex(commitment_felt),
                "leaf_index": None,
                "tree_leaf_count": len(tree.leaves),
                "tree_leaves_preview": [hex(leaf)[:20] + "..." for leaf in tree.leaves[:5]],
                "message": "Commitment not in tree. May need to re-deposit or commitment was made with different parameters.",
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
