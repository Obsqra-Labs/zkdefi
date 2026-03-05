"""
Vault API Routes — deposit verification, balance/status, and deposit history.

POST /deposit   — verify on-chain STRK transfer tx, credit internal ledger
GET  /status    — vault status (balance, deployed, APY, positions)
GET  /deposits  — deposit history for a user
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(tags=["vault"])


# ── Request / Response models ───────────────────────────────────────────

class VaultDepositRequest(BaseModel):
    """User submits tx_hash of STRK transfer to operator wallet."""
    user_address: str
    tx_hash: str


class VaultDepositResponse(BaseModel):
    deposit_id: Optional[int] = None
    user_address: str
    amount_wei: str
    tx_hash: str
    balance_wei: str
    duplicate: bool = False
    message: str
    proof_id: Optional[str] = None
    proof_status: str = "generated"  # generated | submitted | verified


class VaultAllocation(BaseModel):
    venue: str
    pair: Optional[str] = None
    amount_wei: str
    position_id: Optional[str] = None
    status: str = "active"


class VaultStatusResponse(BaseModel):
    user_address: str
    balance_wei: str
    total_deposited_wei: str
    total_withdrawn_wei: str
    deployed_wei: str
    liquid_wei: str
    total_yield_wei: str
    apy_estimate: float = 0.0
    allocations: List[VaultAllocation] = []
    proof_id: Optional[str] = None
    proof_status: str = "verified"  # vault state is always verified


class VaultDepositRecord(BaseModel):
    id: int
    amount_wei: str
    tx_hash: str
    status: str
    created_at: int


# ── Helpers ─────────────────────────────────────────────────────────────

def _parse_hex_int(value: str) -> int:
    """Parse a hex or decimal string to int."""
    v = value.strip()
    if v.startswith("0x") or v.startswith("0X"):
        return int(v, 16)
    return int(v)


def _normalize_address(addr: str) -> str:
    """Normalize a Starknet address to lowercase 0x-prefixed hex (no leading zeros)."""
    v = addr.strip()
    try:
        # Round-trip through int to strip leading zeros, then lowercase
        return hex(int(v, 16) if v.startswith("0x") or v.startswith("0X") else int(v)).lower()
    except (ValueError, TypeError):
        return v.lower()


# ── Operator address resolution ─────────────────────────────────────────

def _get_operator_address() -> str:
    """Return the operator wallet address that receives vault deposits."""
    addr = os.getenv(
        "VAULT_DEPOSIT_ADDRESS",
        os.getenv(
            "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS",
            os.getenv("EXECUTOR_ADDRESS", ""),
        ),
    )
    if not addr:
        raise HTTPException(status_code=503, detail="Operator wallet address not configured.")
    return _normalize_address(addr)


# ── On-chain transfer verification ──────────────────────────────────────

async def _verify_strk_transfer(tx_hash: str, expected_sender: str, expected_recipient: str) -> int:
    """Verify a STRK transfer on-chain and return the transferred amount in wei.

    Reads the transaction receipt, finds the Transfer event from STRK token,
    and validates sender/recipient match.
    """
    from starknet_py.net.full_node_client import FullNodeClient
    from starknet_py.net.client_models import TransactionReceipt

    rpc_url = os.getenv("STARKNET_RPC_URL_V08") or os.getenv("EXECUTOR_RPC_URL") or \
              "https://api.cartridge.gg/x/starknet/sepolia"
    strk_addr_str = os.getenv(
        "STRK_TOKEN_ADDRESS",
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    )
    strk_addr = _parse_hex_int(strk_addr_str)

    client = FullNodeClient(node_url=rpc_url)

    tx_hash_int = _parse_hex_int(tx_hash)

    # Wait for tx if still pending (up to 120s)
    try:
        await client.wait_for_tx(tx_hash_int, check_interval=3, retries=40)
    except Exception as exc:
        logger.warning("[VaultDeposit] wait_for_tx failed for %s: %s", tx_hash, exc)

    receipt = await client.get_transaction_receipt(tx_hash_int)

    # Normalize addresses for comparison
    sender_norm = _normalize_address(expected_sender)
    recipient_norm = _normalize_address(expected_recipient)

    # Look for Transfer event from STRK contract
    # Transfer event key = sn_keccak("Transfer") = 0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9
    transfer_key = 0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9

    transfer_amount = 0
    found_transfer = False

    for event in receipt.events:
        event_from = _normalize_address(hex(event.from_address))
        strk_norm = _normalize_address(hex(strk_addr))

        if event_from != strk_norm:
            continue

        if not event.keys or event.keys[0] != transfer_key:
            continue

        # STRK token uses the older ERC20 event format:
        #   keys = [Transfer_selector]
        #   data = [from, to, amount_low, amount_high]
        # Some tokens use the newer OZ 0.8+ format:
        #   keys = [Transfer_selector, from, to]
        #   data = [amount_low, amount_high]
        ev_sender = None
        ev_recipient = None
        amount = 0

        if len(event.keys) >= 3 and len(event.data) >= 2:
            # New format: keys = [selector, from, to], data = [amount_low, amount_high]
            ev_sender = _normalize_address(hex(event.keys[1]))
            ev_recipient = _normalize_address(hex(event.keys[2]))
            amount = event.data[0] + (event.data[1] << 128)
        elif len(event.keys) == 1 and len(event.data) >= 4:
            # Old format: keys = [selector], data = [from, to, amount_low, amount_high]
            ev_sender = _normalize_address(hex(event.data[0]))
            ev_recipient = _normalize_address(hex(event.data[1]))
            amount = event.data[2] + (event.data[3] << 128)
        else:
            continue

        if ev_sender == sender_norm and ev_recipient == recipient_norm:
                transfer_amount += amount
                found_transfer = True
                logger.info(
                    "[VaultDeposit] Found STRK transfer: from=%s to=%s amount=%s",
                    ev_sender, ev_recipient, amount,
                )

    if not found_transfer:
        raise HTTPException(
            status_code=400,
            detail=f"No STRK transfer found in tx {tx_hash} from {sender_norm} to {recipient_norm}. "
            "Make sure you transferred STRK to the operator wallet.",
        )

    return transfer_amount


# ── POST /deposit ────────────────────────────────────────────────────────

@router.post("/deposit", response_model=VaultDepositResponse)
async def vault_deposit(request: VaultDepositRequest):
    """Verify an on-chain STRK transfer to the operator wallet, then credit the user's internal ledger.

    Flow:
    1. User sends STRK to operator address via wallet
    2. User submits tx_hash here
    3. Backend verifies transfer on-chain (sender, recipient, amount)
    4. Credits internal ledger balance
    5. Returns confirmation
    """
    from app.services.ledger_service import get_ledger_service

    user_address = _normalize_address(request.user_address)
    operator_address = _get_operator_address()

    # Verify the transfer on-chain
    try:
        amount_wei = await _verify_strk_transfer(
            tx_hash=request.tx_hash,
            expected_sender=user_address,
            expected_recipient=operator_address,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[VaultDeposit] Verification failed: %s", e)
        raise HTTPException(status_code=502, detail=f"On-chain verification failed: {e}")

    # Record deposit and credit ledger
    ledger = get_ledger_service()
    result = ledger.record_vault_deposit(
        user_address=user_address,
        amount_wei=amount_wei,
        tx_hash=request.tx_hash,
    )

    return VaultDepositResponse(
        deposit_id=result.get("deposit_id"),
        user_address=user_address,
        amount_wei=str(amount_wei),
        tx_hash=request.tx_hash,
        balance_wei=str(result.get("balance_wei", 0)),
        duplicate=result.get("duplicate", False),
        message=(
            f"Deposit already recorded."
            if result.get("duplicate")
            else f"Vault deposit confirmed: {amount_wei / 1e18:.6f} STRK credited."
        ),
    )


# ── GET /status ──────────────────────────────────────────────────────────

@router.get("/status", response_model=VaultStatusResponse)
async def vault_status(user_address: str = Query(..., description="User's Starknet address")):
    """Return vault status: balance, deployed amount, positions, and estimated APY."""
    from app.services.ledger_service import get_ledger_service

    addr = _normalize_address(user_address)
    ledger = get_ledger_service()

    balance = ledger.get_balance(addr)
    total_deposited = ledger.get_total_deposited(addr)
    total_withdrawn = ledger.get_total_withdrawn(addr)
    deployed = ledger.get_deployed_amount(addr)
    total_yield = ledger.get_total_yield(addr)
    liquid = balance  # ledger balance IS the liquid portion
    active_allocs = ledger.list_active_allocations(addr)

    # Simple APY estimate based on yield vs total deposits
    apy_estimate = 0.0
    if total_deposited > 0 and total_yield > 0:
        # Annualize assuming 30-day window (simplified)
        apy_estimate = round((total_yield / total_deposited) * 365 / 30 * 100, 2)

    return VaultStatusResponse(
        user_address=addr,
        balance_wei=str(balance),
        total_deposited_wei=str(total_deposited),
        total_withdrawn_wei=str(total_withdrawn),
        deployed_wei=str(deployed),
        liquid_wei=str(liquid),
        total_yield_wei=str(total_yield),
        apy_estimate=apy_estimate,
        allocations=[
            VaultAllocation(
                venue=a["venue"],
                pair=a.get("pair"),
                amount_wei=a["amount_wei"],
                position_id=a.get("position_id"),
                status=a["status"],
            )
            for a in active_allocs
        ],
    )


# ── GET /deposits ────────────────────────────────────────────────────────

@router.get("/deposits", response_model=list[VaultDepositRecord])
async def vault_deposits(user_address: str = Query(..., description="User's Starknet address")):
    """List deposit history for a user."""
    from app.services.ledger_service import get_ledger_service

    addr = _normalize_address(user_address)
    ledger = get_ledger_service()
    records = ledger.list_vault_deposits(addr)

    return [
        VaultDepositRecord(
            id=r["id"],
            amount_wei=r["amount_wei"],
            tx_hash=r["tx_hash"],
            status=r["status"],
            created_at=r["created_at"],
        )
        for r in records
    ]


# ── GET /operator-address ───────────────────────────────────────────────

@router.get("/operator-address")
async def get_operator_address():
    """Return the operator wallet address for vault deposits (public info)."""
    return {"operator_address": _get_operator_address()}
