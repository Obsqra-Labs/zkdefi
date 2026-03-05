"""
Full Privacy Pool API Routes

Endpoints for:
- Deposit commitment generation
- Withdrawal proof generation
- Selective disclosure proofs
"""

import os
from typing import Optional, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from starknet_py.hash.selector import get_selector_from_name

from ...middleware.auth import require_admin

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
    amount_wei: Optional[int] = None
    pool_target: Optional[str] = None
    user_address: Optional[str] = None


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
    user_secret: str
    amount: str | int
    pool_type: int
    nonce: str
    blinding: str
    withdraw_amount: str | int
    recipient: str
    claim_salt: Optional[str] = None
    leaf_index: int = -1
    merkle_root: Optional[str] = None
    path_elements: Optional[List[str]] = None
    path_indices: Optional[List[int]] = None


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

        # SYNCHRONOUS: wait for on-chain root registration with retries
        _log.info("Registering root on-chain (synchronous): %s", hex(root_int)[:30])
        registered = await register_root_on_chain(root_int, max_retries=5)

        if not registered:
            _log.error("FAILED to register root on-chain: %s", hex(root_int))
            raise HTTPException(
                status_code=503,
                detail="Merkle root registration failed on-chain after retries. Commitment saved locally. Try again or wait."
            )

        _log.info("Root registered on-chain successfully: %s", hex(root_int)[:30])

        # If this deposit targets the private yield pool, register in yield vault ledger
        _yield_pool = os.getenv("PRIVATE_YIELD_POOL_ADDRESS", "")
        if (
            request.pool_target == "private_yield"
            or (request.pool_target and _yield_pool and request.pool_target.lower() == _yield_pool.lower())
        ) and request.amount_wei:
            try:
                from app.services.private_yield_service import register_deposit
                register_deposit(
                    commitment=request.commitment,
                    amount_wei=request.amount_wei,
                    user_address=request.user_address,
                )
                _log.info("Private yield deposit registered: commitment=%s amount=%s", request.commitment[:20], request.amount_wei)
            except Exception as yield_err:
                _log.warning("Private yield registration failed (non-fatal): %s", yield_err)

        return RegisterCommitmentResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/reconcile")
async def reconcile_merkle_roots_endpoint():
    """
    Compare all backend roots against on-chain state and register any missing ones.
    Can be called manually or triggered by monitoring.
    """
    result = await reconcile_all_roots()
    return result


@router.post("/merkle/reset")
async def reset_merkle_tree_endpoint(_admin: str = Depends(require_admin)):
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
    merkle_root: str


class EnsureRootRequest(BaseModel):
    """Root (hex) from the proof - will be registered on-chain if missing."""
    root: str


@router.post("/merkle/ensure_root")
async def ensure_root_on_chain(request: EnsureRootRequest):
    """
    Ensure the given merkle root is registered on-chain before the user signs a withdraw tx.
    Call this with commitmentData.root right before account.execute(withdraw).
    Returns 200 with { "ok": true, "root": "0x...", "was_already_known": bool }.
    If registration fails, returns advisory-only success so manual wallet flows can proceed.
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
            logger.warning("[EnsureRoot] Root registration pending (advisory-only): %s", request.root[:24])
            return {
                "ok": True,
                "root": request.root,
                "was_already_known": False,
                "advisory_only": True,
                "warning": "Merkle root registration is pending. Manual wallet execution may still proceed.",
            }
        return {"ok": True, "root": request.root, "was_already_known": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ensure_root error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pool_balance")
async def get_pool_balance(
    pool_address: str = Query(..., description="Full Privacy Pool contract address"),
    token_address: str = Query(..., description="ERC20 token address (e.g. STRK)"),
):
    """
    Return the pool's token balance in wei. Use before withdraw to avoid u256_sub Overflow.
    """
    rpc = os.getenv("STARKNET_RPC_URL", os.getenv("STARKNET_RPC_URL_V08", "https://starknet-sepolia-rpc.publicnode.com"))
    token = token_address.strip() if token_address.strip().startswith("0x") else f"0x{token_address.strip()}"
    owner = pool_address.strip() if pool_address.strip().startswith("0x") else f"0x{pool_address.strip()}"
    selector = hex(get_selector_from_name("balance_of"))
    async with httpx.AsyncClient(timeout=10.0) as client:
        payload = {
            "jsonrpc": "2.0",
            "method": "starknet_call",
            "params": {
                "request": {
                    "contract_address": token,
                    "entry_point_selector": selector,
                    "calldata": [owner],
                },
                "block_id": "latest",
            },
            "id": 1,
        }
        try:
            response = await client.post(rpc, json=payload)
            data = response.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"RPC error: {e}")
    err = data.get("error")
    if err:
        raise HTTPException(status_code=502, detail=str(err))
    result = data.get("result")
    if not isinstance(result, list) or len(result) == 0:
        return {"pool_address": pool_address, "token_address": token_address, "balance_wei": "0"}
    try:
        if len(result) == 1:
            low = int(str(result[0]), 16) if str(result[0]).startswith("0x") else int(str(result[0]))
            balance = max(0, low)
        else:
            low = int(str(result[0]), 16) if str(result[0]).startswith("0x") else int(str(result[0]))
            high = int(str(result[1]), 16) if str(result[1]).startswith("0x") else int(str(result[1]))
            balance = max(0, low + (high << 128))
        return {"pool_address": pool_address, "token_address": token_address, "balance_wei": str(balance)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Parse balance: {e}")


@router.post("/merkle/verify_root")
async def verify_merkle_root(request: VerifyRootRequest):
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

        # Ensure the proof's root is on-chain before returning.
        # If sync is unavailable, keep manual flow non-blocking and return advisory warning.
        proof_root = int(result["root"], 16) if result["root"].startswith("0x") else int(result["root"])
        root_sync_warning: str | None = None
        root_on_chain = await verify_root_on_chain(proof_root)
        if not root_on_chain:
            logger.warning("[Withdraw] Root %s not on-chain, registering now...", result["root"][:20])
            registered = await register_root_on_chain(proof_root, max_retries=5)
            if not registered:
                root_sync_warning = "Merkle root sync pending on-chain; manual execution can still be attempted."
                logger.warning("[Withdraw] %s root=%s", root_sync_warning, result["root"][:20])

        message = str(result.get("message", "Withdraw proof generated."))
        if root_sync_warning:
            message = f"{message} {root_sync_warning}"

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
            message=message,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("withdraw proof error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/withdraw/generate_claim_proof", response_model=WithdrawClaimProofResponse)
async def generate_withdraw_claim_proof(request: WithdrawClaimProofRequest):
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
async def generate_withdraw_proof_with_change(request: WithdrawProofRequest):
    """
    Generate a withdrawal-with-change proof (V2 partial withdraw).
    Proves withdraw_amount + change_amount == commitment amount; returns change commitment for pool to insert.
    Frontend should store change_nonce, change_blinding, change_amount, change_commitment for the new commitment.
    """
    import logging
    logger = logging.getLogger(__name__)

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

        # Ensure the proof's root is on-chain before returning.
        # If sync is unavailable, keep manual flow non-blocking and return advisory warning.
        proof_root = int(result["root"], 16) if result["root"].startswith("0x") else int(result["root"])
        root_sync_warning: str | None = None
        root_on_chain = await verify_root_on_chain(proof_root)
        if not root_on_chain:
            logger.warning("[Withdraw] Root %s not on-chain, registering now...", result["root"][:20])
            registered = await register_root_on_chain(proof_root, max_retries=5)
            if not registered:
                root_sync_warning = "Merkle root sync pending on-chain; manual execution can still be attempted."
                logger.warning("[Withdraw] %s root=%s", root_sync_warning, result["root"][:20])

        message = str(result.get("message", "Withdraw proof generated."))
        if root_sync_warning:
            message = f"{message} {root_sync_warning}"

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
            message=message,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merkle/register_change_commitment")
async def register_change_commitment(request: RegisterChangeCommitmentRequest):
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
        registered = await register_root_on_chain(root, max_retries=5)
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


# ==================== Pool D: Tier-2H Claim Payout ====================

class ClaimPayoutExecRequest(BaseModel):
    """
    Trigger Pool D (HashedWithdrawPool) claim payout.

    After the user calls withdraw_claim_u256 on-chain (proving via ZK that they hold
    a leaf in the Merkle tree and burning their nullifier), the contract stores the
    claimHash but does NOT transfer tokens.  This endpoint completes the payout:

      1. Verifies is_claimed_u256(claim_low, claim_high) on Pool D.
      2. Transfers amount_wei STRK from the operator wallet to recipient.
      3. Returns the on-chain tx hash.

    Fields:
      claim_low / claim_high  — the u256 halves of claimHash from the proof response.
      recipient               — destination address (hex 0x...).
      amount_wei              — STRK amount in wei (string to preserve precision).
    """
    claim_low: str
    claim_high: str
    recipient: str
    amount_wei: str


class ClaimPayoutExecResponse(BaseModel):
    tx_hash: str
    recipient: str
    amount_wei: str
    message: str


@router.post("/claim/pay", response_model=ClaimPayoutExecResponse)
async def execute_claim_payout(request: ClaimPayoutExecRequest):
    """
    Pool D Tier-2H payout: verify on-chain claim hash then transfer STRK to recipient.
    """
    import logging
    logger = logging.getLogger(__name__)

    from starknet_py.contract import Contract
    from starknet_py.net.account.account import Account
    from starknet_py.net.full_node_client import FullNodeClient
    from starknet_py.net.models.chains import StarknetChainId
    from starknet_py.net.signer.stark_curve_signer import KeyPair
    from starknet_py.net.client_models import Call
    from starknet_py.hash.selector import get_selector_from_name as _sel

    from ... import config as cfg

    pool_d_addr_str = os.getenv("HASHED_WITHDRAW_POOL_ADDRESS", "")
    if not pool_d_addr_str:
        raise HTTPException(status_code=503, detail="HASHED_WITHDRAW_POOL_ADDRESS not configured.")
    strk_addr_str = os.getenv(
        "STRK_TOKEN_ADDRESS",
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    )
    rpc_url = os.getenv("STARKNET_RPC_URL_V08") or os.getenv("EXECUTOR_RPC_URL") or \
              "https://api.cartridge.gg/x/starknet/sepolia"
    admin_addr_str = os.getenv(
        "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS",
        os.getenv("EXECUTOR_ADDRESS", ""),
    )
    admin_pk_str = os.getenv(
        "FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY",
        os.getenv("EXECUTOR_PRIVATE_KEY", ""),
    )
    if not admin_addr_str or not admin_pk_str:
        raise HTTPException(status_code=503, detail="Admin wallet not configured.")

    try:
        claim_low  = int(request.claim_low,  16) if request.claim_low.startswith("0x")  else int(request.claim_low)
        claim_high = int(request.claim_high, 16) if request.claim_high.startswith("0x") else int(request.claim_high)
        recipient  = int(request.recipient,  16) if request.recipient.startswith("0x")  else int(request.recipient)
        amount_wei = int(request.amount_wei)
        pool_d_addr  = int(pool_d_addr_str,  16) if pool_d_addr_str.startswith("0x")  else int(pool_d_addr_str)
        strk_addr    = int(strk_addr_str,    16) if strk_addr_str.startswith("0x")    else int(strk_addr_str)
        admin_addr   = int(admin_addr_str,   16) if admin_addr_str.startswith("0x")   else int(admin_addr_str)
        admin_pk     = int(admin_pk_str,     16) if admin_pk_str.startswith("0x")     else int(admin_pk_str)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid parameter: {e}")

    # ── Step 1: Verify claim is registered on-chain ──────────────────────
    try:
        anon_client = FullNodeClient(node_url=rpc_url)
        # Use call_contract directly with block_hash="latest" (proven pattern from relayer_runner)
        is_claimed_result = await anon_client.call_contract(
            call=Call(
                to_addr=pool_d_addr,
                selector=_sel("is_claimed_u256"),
                calldata=[claim_low, claim_high],
            ),
            block_hash="latest",
        )
        is_claimed = bool(is_claimed_result[0]) if is_claimed_result else False
        if not is_claimed:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Claim not registered on-chain "
                    f"(claim_low={claim_low}, claim_high={claim_high}). "
                    "Call withdraw_claim_u256 with a valid ZK proof first."
                ),
            )
        logger.info("[ClaimPay] On-chain claim verified claim_low=%s", claim_low)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"On-chain verification failed: {e}")

    # ── Step 1.5: AI Gate — verify ledger balance and debit ──────────────
    # The "AI gate" ensures only users with sufficient internal ledger
    # balance can receive payouts. This links the on-chain ZK claim to
    # the off-chain vault accounting system.
    try:
        from app.services.ledger_service import get_ledger_service
        ledger = get_ledger_service()
        recipient_hex = hex(recipient)

        if ledger.enabled:
            ledger_balance = ledger.get_balance(recipient_hex)
            if ledger_balance < amount_wei:
                # Also check with normalized address (no leading zeros difference)
                recipient_norm = recipient_hex.lower()
                ledger_balance = ledger.get_balance(recipient_norm)

            if ledger_balance >= amount_wei:
                # Debit the ledger so balance reflects the payout
                new_balance = ledger.debit_balance(
                    address=recipient_hex,
                    amount_wei=amount_wei,
                    reason="claim_payout",
                )
                logger.info(
                    "[ClaimPay] AI gate passed: debited %s from %s, new_balance=%s",
                    amount_wei, recipient_hex, new_balance,
                )
            else:
                logger.warning(
                    "[ClaimPay] AI gate: no ledger record for %s (balance=%s, requested=%s). "
                    "Proceeding with on-chain claim only (self-sovereign path).",
                    recipient_hex, ledger_balance, amount_wei,
                )
                # NOTE: We still allow the payout if the on-chain claim is valid.
                # This supports the self-sovereign path (Pool D users who bypassed
                # the vault intake). The gate logs a warning for audit.
                ledger._log_event(
                    ledger._db_connect(),
                    "claim_payout_no_ledger",
                    None,
                    {
                        "recipient": recipient_hex,
                        "amount_wei": str(amount_wei),
                        "claim_low": str(claim_low),
                        "ledger_balance": str(ledger_balance),
                    },
                )
    except HTTPException:
        raise
    except Exception as gate_err:
        logger.warning("[ClaimPay] AI gate check failed (non-fatal): %s", gate_err)
        # Non-fatal: if ledger is down, still honor the on-chain claim

    # ── Step 2: Transfer STRK from operator wallet to recipient ──────────
    try:
        from starknet_py.net.client_models import ResourceBoundsMapping as _RBM
        key_pair = KeyPair.from_private_key(admin_pk)
        account = Account(
            address=admin_addr,
            client=anon_client,
            key_pair=key_pair,
            chain=StarknetChainId.SEPOLIA,
        )
        # CRITICAL: pre-set cairo_version=1 to skip get_class_at("pending") RPC call.
        # Cartridge gateway rejects "pending" block with -32602 Invalid block id.
        account._cairo_version = 1

        U128 = 2 ** 128
        amt_lo = amount_wei % U128
        amt_hi = amount_wei // U128

        transfer_call = Call(
            to_addr=strk_addr,
            selector=_sel("transfer"),
            calldata=[recipient, amt_lo, amt_hi],
        )

        # Use the proven pattern from merkle_tree_onchain_sync._starkli_add_known_root:
        # manual nonce + prepare + estimate(block_number="latest") + execute_v3
        nonce = await account.get_nonce(block_number="latest")
        draft = await account._prepare_invoke_v3(
            [transfer_call], resource_bounds=_RBM.init_with_zeros(), nonce=nonce
        )
        estimated = await account.estimate_fee(draft, block_number="latest")
        rbm = estimated.to_resource_bounds()
        resp = await account.execute_v3(calls=transfer_call, resource_bounds=rbm, nonce=nonce)
        logger.info("[ClaimPay] Transfer submitted tx=%s", hex(resp.transaction_hash))
        tx_hash = hex(resp.transaction_hash)
        try:
            await account.client.wait_for_tx(resp.transaction_hash)
            logger.info("[ClaimPay] Payout confirmed tx=%s recipient=%s amount=%s", tx_hash, hex(recipient), amount_wei)
        except Exception as wait_err:
            # Cartridge gateway may return PRE_CONFIRMED or other non-standard
            # finality statuses that starknet-py doesn't recognize. The tx was
            # already submitted successfully — log and continue.
            logger.warning("[ClaimPay] wait_for_tx non-fatal error (tx already submitted): %s", wait_err)
    except Exception as e:
        logger.exception("[ClaimPay] Transfer failed: %s", e)
        raise HTTPException(status_code=502, detail=f"STRK transfer failed: {e}")

    return ClaimPayoutExecResponse(
        tx_hash=tx_hash,
        recipient=hex(recipient),
        amount_wei=str(amount_wei),
        message=f"Pool D claim paid. {amount_wei / 1e18:.6f} STRK sent to {hex(recipient)}.",
    )
