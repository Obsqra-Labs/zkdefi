"""
Full Privacy Pool API Routes

Endpoints for:
- Deposit commitment generation
- Withdrawal proof generation
- Selective disclosure proofs
"""

import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List

from app.middleware.auth import WalletOwner, AdminOnly
from ...services.full_privacy_proof_service import get_full_privacy_service
from ...services.merkle_tree_service import (
    get_merkle_tree,
    find_commitment_in_tree,
    compute_commitment,
    compute_nullifier,
)
from ...services.circomlib_poseidon import STARK_PRIME
from ...services.merkle_tree_onchain_sync import (
    register_root_on_chain,
    reconcile_all_roots,
    check_nullifier_used_on_chain,
    verify_root_on_chain,
)


router = APIRouter(tags=["Full Privacy"])


# ==================== Request/Response Models ====================

class DepositCommitmentRequest(BaseModel):
    user_address: str = Field(..., min_length=3)
    amount: str | int  # in wei - accept string to preserve precision
    pool_type: int = Field(..., ge=0, le=2)  # 0=Conservative, 1=Neutral, 2=Aggressive
    token: str = Field(default="STRK", min_length=1, description="Token symbol for pool bucket attribution")

    @field_validator("user_address")
    @classmethod
    def validate_address(cls, v: str) -> str:
        if not v.startswith("0x"):
            raise ValueError("Address must start with 0x")
        return v

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: str | int) -> str | int:
        if int(v) <= 0:
            raise ValueError("Amount must be positive")
        return v


class DepositCommitmentResponse(BaseModel):
    commitment: str
    user_secret: str  # User must store this securely
    amount: str  # Return as string to avoid JS JSON.parse() precision loss for large wei values
    pool_type: int
    nonce: str
    blinding: str
    message: str


class RegisterCommitmentRequest(BaseModel):
    commitment: str = Field(..., min_length=1)
    wait_for_onchain: bool = Field(
        default=True,
        description="When false, return after local Merkle registration and sync the root on-chain in the background.",
    )


class RegisterCommitmentResponse(BaseModel):
    leaf_index: int
    merkle_root: str
    path_elements: List[str]
    path_indices: List[int]


class WithdrawProofRequest(BaseModel):
    user_secret: str = Field(..., min_length=1)
    amount: str | int  # Accept string to preserve precision
    pool_type: int = Field(..., ge=0, le=2)
    nonce: str = Field(..., min_length=1)
    blinding: str = Field(..., min_length=1)
    withdraw_amount: str | int  # Accept string to preserve precision
    recipient: str = Field(..., min_length=3)
    leaf_index: int = -1  # Optional - will auto-find if -1 or missing
    # Optional: stored merkle proof from registration (bypasses get_merkle_proof bug)
    merkle_root: Optional[str] = None
    path_elements: Optional[List[str]] = None
    path_indices: Optional[List[int]] = None

    @field_validator("recipient")
    @classmethod
    def validate_recipient(cls, v: str) -> str:
        if not v.startswith("0x"):
            raise ValueError("Recipient must start with 0x")
        return v

    @field_validator("amount", "withdraw_amount")
    @classmethod
    def validate_amounts(cls, v: str | int) -> str | int:
        if int(v) <= 0:
            raise ValueError("Amount must be positive")
        return v


class WithdrawProofResponse(BaseModel):
    nullifier: str
    nullifier_low: Optional[str] = None
    nullifier_high: Optional[str] = None
    root: str
    root_low: Optional[str] = None
    root_high: Optional[str] = None
    recipient: str
    amount: int
    pool_type: int
    proof_calldata: List[str]
    message: str


class WithdrawClaimProofRequest(BaseModel):
    user_secret: str = Field(..., min_length=1)
    amount: str | int
    pool_type: int = Field(..., ge=0, le=2)
    nonce: str = Field(..., min_length=1)
    blinding: str = Field(..., min_length=1)
    withdraw_amount: str | int
    recipient: str = Field(..., min_length=3)
    claim_salt: Optional[str] = None
    leaf_index: int = -1
    merkle_root: Optional[str] = None
    path_elements: Optional[List[str]] = None
    path_indices: Optional[List[int]] = None

    @field_validator("recipient")
    @classmethod
    def validate_recipient(cls, v: str) -> str:
        if not v.startswith("0x"):
            raise ValueError("Recipient must start with 0x")
        return v

    @field_validator("amount", "withdraw_amount")
    @classmethod
    def validate_amounts(cls, v: str | int) -> str | int:
        if int(v) <= 0:
            raise ValueError("Amount must be positive")
        return v


class WithdrawClaimProofResponse(BaseModel):
    nullifier: str
    nullifier_low: Optional[str] = None
    nullifier_high: Optional[str] = None
    root: str
    root_low: Optional[str] = None
    root_high: Optional[str] = None
    claim_hash: str
    claim_low: Optional[str] = None
    claim_high: Optional[str] = None
    claim_salt: str
    pool_type: int
    proof_calldata: List[str]
    message: str


class WithdrawProofWithChangeResponse(BaseModel):
    nullifier: str
    nullifier_low: Optional[str] = None
    nullifier_high: Optional[str] = None
    root: str
    root_low: Optional[str] = None
    root_high: Optional[str] = None
    recipient: str
    withdraw_amount: int
    change_amount: int
    change_commitment: str
    change_commitment_low: str
    change_commitment_high: str
    change_nonce: str
    change_blinding: str
    pool_type: int
    proof_calldata: List[str]
    path_elements: Optional[List[str]] = None
    path_indices: Optional[List[int]] = None
    message: str


class RegisterChangeCommitmentRequest(BaseModel):
    """Register change commitment after withdraw_with_change tx. Inserts into tree and syncs new root on-chain."""
    change_commitment: Optional[str] = None  # hex (single felt)
    change_commitment_low: Optional[str] = None
    change_commitment_high: Optional[str] = None


class BalanceDisclosureRequest(BaseModel):
    user_secret: str = Field(..., min_length=1)
    amount: int = Field(..., gt=0)
    pool_type: int = Field(..., ge=0, le=2)
    nonce: str = Field(..., min_length=1)
    blinding: str = Field(..., min_length=1)
    threshold: int = Field(..., ge=0)  # Prove balance > threshold
    leaf_index: int = Field(..., ge=0)


class PoolDisclosureRequest(BaseModel):
    user_secret: str = Field(..., min_length=1)
    amount: int = Field(..., gt=0)
    pool_type: int = Field(..., ge=0, le=2)
    nonce: str = Field(..., min_length=1)
    blinding: str = Field(..., min_length=1)
    leaf_index: int = Field(..., ge=0)


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
async def generate_deposit_commitment(request: DepositCommitmentRequest, _caller: str = WalletOwner):
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

        # Credit pool idle account so the bucket tracks this deposit
        from app.services.pool_composition_service import credit_pool_idle
        _POOL_TYPE_MAP = {0: "conservative", 1: "moderate", 2: "aggressive"}
        pool_id = _POOL_TYPE_MAP.get(request.pool_type, "conservative")
        credit_pool_idle(
            pool_id=pool_id,
            token=request.token,
            amount_wei=amount,
            source_account="USER_DEPOSIT",
            refs={"user": request.user_address, "commitment": result.get("commitment", "")[:20]},
        )

        return DepositCommitmentResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/deposit/register_commitment", response_model=RegisterCommitmentResponse)
async def register_commitment(request: RegisterCommitmentRequest, _caller: str = WalletOwner):
    """
    Register a commitment in the merkle tree after on-chain deposit.
    
    Should be called after the deposit transaction is confirmed.
    Returns merkle proof data for future withdrawals.

    IMPORTANT: This endpoint WAITS for add_known_root() to confirm on-chain
    before returning success. If root registration fails after retries,
    returns 503 so the frontend knows to retry.
    """
    import logging
    _log = logging.getLogger(__name__)

    try:
        svc = get_full_privacy_service()
        commitment = int(request.commitment, 16) if request.commitment.startswith("0x") else int(request.commitment)
        result = svc.register_commitment(commitment)
        root_int = int(result["merkle_root"], 16) if result["merkle_root"].startswith("0x") else int(result["merkle_root"])

        if request.wait_for_onchain:
            # SYNCHRONOUS: wait for on-chain root registration with retries
            _log.info("Registering root on-chain (synchronous): %s", hex(root_int)[:30])
            registered = await register_root_on_chain(root_int, max_retries=3)

            if not registered:
                _log.error("FAILED to register root on-chain: %s", hex(root_int))
                raise HTTPException(
                    status_code=503,
                    detail="Merkle root registration failed on-chain after retries. Commitment saved locally. Try again or wait."
                )

            _log.info("Root registered on-chain successfully: %s", hex(root_int)[:30])
        else:
            _log.info("Registering root on-chain (background): %s", hex(root_int)[:30])
            asyncio.create_task(register_root_on_chain(root_int, max_retries=3))
        return RegisterCommitmentResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/reconcile")
async def reconcile_merkle_roots_endpoint(_admin: str = AdminOnly):
    """
    Compare all backend roots against on-chain state and register any missing ones.
    Can be called manually or triggered by monitoring.
    """
    result = await reconcile_all_roots()
    return result


@router.post("/merkle/reset")
async def reset_merkle_tree_endpoint(_admin: str = AdminOnly):
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


class VerifyRootRequest(BaseModel):
    merkle_root: str = Field(..., min_length=1)


class EnsureRootRequest(BaseModel):
    """Root (hex) from the proof - will be registered on-chain if missing."""
    root: str = Field(..., min_length=1)


@router.post("/merkle/ensure_root")
async def ensure_root_on_chain(request: EnsureRootRequest, _admin: str = AdminOnly):
    """
    Ensure the given merkle root is registered on-chain before the user signs a withdraw tx.
    Call this with commitmentData.root right before account.execute(withdraw).
    Returns 200 with { "ok": true, "root": "0x...", "was_already_known": bool }.
    Returns 503 if registration failed after retries.
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        root_int = int(request.root, 16) if request.root.startswith("0x") else int(request.root)
        is_known = await verify_root_on_chain(root_int)
        if is_known:
            return {"ok": True, "root": request.root, "was_already_known": True}
        logger.info("[EnsureRoot] Root %s not on-chain, registering...", request.root[:24])
        registered = await register_root_on_chain(root_int, max_retries=5)
        if not registered:
            raise HTTPException(
                status_code=503,
                detail="Merkle root could not be registered on-chain. Try again in a few seconds."
            )
        return {"ok": True, "root": request.root, "was_already_known": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ensure_root error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/verify_root")
async def verify_merkle_root(request: VerifyRootRequest, _admin: str = AdminOnly):
    """
    Check if merkle root is registered on-chain.
    Polls MerkleTree contract's is_known_root function.
    """
    import os
    from starknet_py.net.full_node_client import FullNodeClient
    from starknet_py.contract import Contract
    
    try:
        root_int = int(request.merkle_root, 16) if request.merkle_root.startswith("0x") else int(request.merkle_root)
        from ...services.circomlib_poseidon import STARK_PRIME
        root_felt = root_int % STARK_PRIME
        
        merkle_tree_addr = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADDRESS")
        if not merkle_tree_addr:
            raise HTTPException(status_code=500, detail="FULL_PRIVACY_MERKLE_TREE_ADDRESS not configured")
        
        rpc_url = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7")
        client = FullNodeClient(node_url=rpc_url)
        contract = await Contract.from_address(address=merkle_tree_addr, provider=client)
        result = await contract.functions["is_known_root"].call(root_felt)
        is_known = result[0] == 1
        
        return {"is_known": is_known, "root_felt": hex(root_felt)}
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"verify_root error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/withdraw/generate_proof", response_model=WithdrawProofResponse)
async def generate_withdraw_proof(request: WithdrawProofRequest, _caller: str = WalletOwner):
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
    
    logger.info("=== WITHDRAW PROOF REQUEST ===")
    logger.info(f"User secret (len): {len(request.user_secret)}")
    logger.info(f"Amount: {request.amount}")
    logger.info(f"Pool type: {request.pool_type}")
    logger.info(f"Withdraw amount: {request.withdraw_amount}")
    logger.info(f"Leaf index: {request.leaf_index}")
    logger.info(f"Using stored proof: {request.merkle_root is not None}")
    
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

        # --- Pre-flight: check if nullifier is already used on-chain ---
        # This catches the case where a previous withdrawal succeeded on-chain
        # but the frontend didn't remove the commitment from localStorage.
        commitment_for_null = compute_commitment(user_secret, amount, request.pool_type, nonce, blinding)
        nullifier_precheck = compute_nullifier(commitment_for_null, user_secret)
        is_used = await check_nullifier_used_on_chain(nullifier_precheck)
        if is_used:
            raise HTTPException(
                status_code=409,
                detail="Nullifier already used on-chain. This commitment was already withdrawn. Remove it from your wallet."
            )
        
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

        # Ensure the proof's root is on-chain before returning
        proof_root = int(result["root"], 16) if result["root"].startswith("0x") else int(result["root"])
        root_on_chain = await verify_root_on_chain(proof_root)
        if not root_on_chain:
            logger.warning("[Withdraw] Root %s not on-chain, registering now...", result["root"][:20])
            registered = await register_root_on_chain(proof_root, max_retries=3)
            if not registered:
                raise HTTPException(
                    status_code=503,
                    detail="Merkle root not confirmed on-chain. Try again in a few seconds."
                )

        return WithdrawProofResponse(
            nullifier=result["nullifier"],
            nullifier_low=result.get("nullifier_low"),
            nullifier_high=result.get("nullifier_high"),
            root=result["root"],
            root_low=result.get("root_low"),
            root_high=result.get("root_high"),
            recipient=result["recipient"],
            amount=result["amount"],
            pool_type=result["pool_type"],
            proof_calldata=result["proof_calldata"],
            message=result["message"],
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("withdraw proof error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/withdraw/generate_claim_proof", response_model=WithdrawClaimProofResponse)
async def generate_withdraw_claim_proof(request: WithdrawClaimProofRequest, _caller: str = WalletOwner):
    """
    Generate a Tier-2H withdrawal claim proof.
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info("=== WITHDRAW CLAIM PROOF REQUEST ===")
    logger.info(f"Amount: {request.amount}")
    logger.info(f"Pool type: {request.pool_type}")
    logger.info(f"Withdraw amount: {request.withdraw_amount}")
    logger.info(f"Leaf index: {request.leaf_index}")

    try:
        svc = get_full_privacy_service()

        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        claim_salt = None
        if request.claim_salt:
            claim_salt = int(request.claim_salt, 16) if request.claim_salt.startswith("0x") else int(request.claim_salt)

        amount = int(request.amount) if isinstance(request.amount, str) else request.amount
        withdraw_amount = int(request.withdraw_amount) if isinstance(request.withdraw_amount, str) else request.withdraw_amount

        proof_data = svc.generate_withdraw_claim_proof(
            user_secret=user_secret,
            amount=amount,
            pool_type=request.pool_type,
            nonce=nonce,
            blinding=blinding,
            withdraw_amount=withdraw_amount,
            recipient=request.recipient,
            leaf_index=request.leaf_index,
            claim_salt=claim_salt,
            merkle_root=int(request.merkle_root, 16) if request.merkle_root else None,
            path_elements=[int(p, 16) for p in request.path_elements] if request.path_elements else None,
            path_indices=request.path_indices,
        )

        return WithdrawClaimProofResponse(
            nullifier=proof_data["nullifier"],
            nullifier_low=proof_data["nullifier_low"],
            nullifier_high=proof_data["nullifier_high"],
            root=proof_data["root"],
            root_low=proof_data["root_low"],
            root_high=proof_data["root_high"],
            claim_hash=proof_data["claim_hash"],
            claim_low=proof_data["claim_low"],
            claim_high=proof_data["claim_high"],
            claim_salt=proof_data["claim_salt"],
            pool_type=proof_data["pool_type"],
            proof_calldata=proof_data["proof_calldata"],
            message=proof_data["message"],
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("withdraw claim proof error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/withdraw/generate_proof_with_change", response_model=WithdrawProofWithChangeResponse)
async def generate_withdraw_proof_with_change(request: WithdrawProofRequest, _caller: str = WalletOwner):
    """
    Generate a withdrawal-with-change proof (V2 partial withdraw).
    Proves withdraw_amount + change_amount == commitment amount; returns change commitment for pool to insert.
    Frontend should store change_nonce, change_blinding, change_amount, change_commitment for the new commitment.
    """
    try:
        svc = get_full_privacy_service()
        user_secret = int(request.user_secret, 16) if request.user_secret.startswith("0x") else int(request.user_secret)
        nonce = int(request.nonce, 16) if request.nonce.startswith("0x") else int(request.nonce)
        blinding = int(request.blinding, 16) if request.blinding.startswith("0x") else int(request.blinding)
        amount = int(request.amount) if isinstance(request.amount, str) else request.amount
        withdraw_amount = int(request.withdraw_amount) if isinstance(request.withdraw_amount, str) else request.withdraw_amount

        leaf_index = request.leaf_index
        if leaf_index < 0:
            commitment = compute_commitment(user_secret, amount, request.pool_type, nonce, blinding)
            commitment_felt = commitment % STARK_PRIME
            found_index = find_commitment_in_tree(commitment_felt)
            if found_index is None:
                raise ValueError("Commitment not found in merkle tree")
            leaf_index = found_index

        # --- Pre-flight: check if nullifier is already used on-chain ---
        commitment_for_null = compute_commitment(user_secret, amount, request.pool_type, nonce, blinding)
        nullifier_precheck = compute_nullifier(commitment_for_null, user_secret)
        is_used = await check_nullifier_used_on_chain(nullifier_precheck)
        if is_used:
            raise HTTPException(
                status_code=409,
                detail="Nullifier already used on-chain. This commitment was already withdrawn. Remove it from your wallet."
            )

        stored_root = None
        stored_path_elements = None
        stored_path_indices = None
        if request.merkle_root and request.path_elements and request.path_indices:
            stored_root = int(request.merkle_root, 16) if request.merkle_root.startswith("0x") else int(request.merkle_root)
            stored_path_elements = [int(p, 16) if p.startswith("0x") else int(p) for p in request.path_elements]
            stored_path_indices = request.path_indices

        result = svc.generate_withdraw_proof_with_change(
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

        # Ensure the proof's root is on-chain before returning
        proof_root = int(result["root"], 16) if result["root"].startswith("0x") else int(result["root"])
        root_on_chain = await verify_root_on_chain(proof_root)
        if not root_on_chain:
            logger.warning("[Withdraw] Root %s not on-chain, registering now...", result["root"][:20])
            registered = await register_root_on_chain(proof_root, max_retries=3)
            if not registered:
                raise HTTPException(
                    status_code=503,
                    detail="Merkle root not confirmed on-chain. Try again in a few seconds."
                )

        return WithdrawProofWithChangeResponse(
            nullifier=result["nullifier"],
            nullifier_low=result.get("nullifier_low"),
            nullifier_high=result.get("nullifier_high"),
            root=result["root"],
            root_low=result.get("root_low"),
            root_high=result.get("root_high"),
            recipient=result["recipient"],
            withdraw_amount=result["withdraw_amount"],
            change_amount=result["change_amount"],
            change_commitment=result["change_commitment"],
            change_commitment_low=result["change_commitment_low"],
            change_commitment_high=result["change_commitment_high"],
            change_nonce=result["change_nonce"],
            change_blinding=result["change_blinding"],
            pool_type=result["pool_type"],
            proof_calldata=result["proof_calldata"],
            path_elements=result.get("path_elements"),
            path_indices=result.get("path_indices"),
            message=result["message"],
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/register_change_commitment")
async def register_change_commitment(request: RegisterChangeCommitmentRequest, _caller: str = WalletOwner):
    """
    After a successful withdraw_with_change tx, register the change commitment in the backend tree
    and sync the new root on-chain. Call this so future withdrawals using the new root succeed.
    """
    from ...services.merkle_tree_service import combine_u256
    try:
        if request.change_commitment:
            commitment_int = int(request.change_commitment, 16) if request.change_commitment.startswith("0x") else int(request.change_commitment)
        elif request.change_commitment_low is not None and request.change_commitment_high is not None:
            low = int(request.change_commitment_low, 16) if request.change_commitment_low.startswith("0x") else int(request.change_commitment_low)
            high = int(request.change_commitment_high, 16) if request.change_commitment_high.startswith("0x") else int(request.change_commitment_high)
            commitment_int = combine_u256(low, high)
        else:
            raise HTTPException(status_code=400, detail="Provide change_commitment or change_commitment_low and change_commitment_high")
        commitment_felt = commitment_int % STARK_PRIME
        tree = get_merkle_tree()
        leaf_index, path_elements, path_indices = tree.insert(commitment_felt)
        root = tree.get_root()
        registered = await register_root_on_chain(root, max_retries=3)
        if not registered:
            raise HTTPException(status_code=503, detail="Merkle root registration failed")
        return {
            "leaf_index": leaf_index,
            "merkle_root": hex(root),
            "path_elements": [hex(p) for p in path_elements],
            "path_indices": path_indices,
            "message": "Change commitment registered; root synced on-chain",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/disclosure/balance_above", response_model=DisclosureResponse)
async def prove_balance_above(request: BalanceDisclosureRequest, _caller: str = WalletOwner):
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
async def prove_pool_membership(request: PoolDisclosureRequest, _caller: str = WalletOwner):
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
    user_secret: str = Field(..., min_length=1)
    amount: int = Field(..., gt=0)
    pool_type: int = Field(..., ge=0, le=2)
    nonce: str = Field(..., min_length=1)
    blinding: str = "0x0"


class VerifyCommitmentRequest(BaseModel):
    """Verify that a commitment matches its preimage."""
    commitment: str = Field(..., min_length=1)
    user_secret: str = Field(..., min_length=1)
    amount: int = Field(..., gt=0)
    pool_type: int = Field(..., ge=0, le=2)
    nonce: str = Field(..., min_length=1)
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
