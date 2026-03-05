"""
Ledger API — transfers feed for Vault ledger UI.

GET /transfers — list ledger transfers for a user (paginated).
POST /demo-credit — credit user ledger (demo mode only; requires X-Demo-Mode: true).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, List, Optional

from fastapi import APIRouter, Query, Request, HTTPException
from pydantic import BaseModel, Field

from app.api import relayer as relayer_api
from app.services.ledger_service import get_ledger_service
from app.services.receipt_service import get_receipt_service
from app.services.zkdefi_agent_service import ZkdefiAgentService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ledger", tags=["ledger"])

SUPPORTED_ASSETS = ("STRK", "zkdETH", "zkdAI")
SUPPORTED_CAPITAL_SOURCES = ("wallet_mode", "private_capital")


def _normalize_address(addr: str) -> str:
    text = str(addr or "").strip()
    try:
        if text.startswith(("0x", "0X")):
            return hex(int(text, 16)).lower()
        return hex(int(text)).lower()
    except Exception:
        return text.lower()


def _normalize_asset(asset: Optional[str]) -> str:
    raw = str(asset or "STRK").strip()
    if raw.upper() == "STRK":
        return "STRK"
    if raw.upper() == "ZKDETH":
        return "zkdETH"
    if raw.upper() == "ZKDAI":
        return "zkdAI"
    return raw


def _split_u256(value: int) -> tuple[int, int]:
    low = value % (2**128)
    high = value // (2**128)
    return low, high


def _parse_int(value: str) -> int:
    text = str(value or "").strip()
    if text.startswith(("0x", "0X")):
        return int(text, 16)
    return int(text)


def _token_address_for_asset(asset: str) -> str:
    mapping = {
        "STRK": os.getenv("STRK_TOKEN_ADDRESS")
        or "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "zkdETH": os.getenv("ZKDETH_TOKEN_ADDRESS")
        or "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121",
        "zkdAI": os.getenv("ZKDAI_TOKEN_ADDRESS")
        or "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637",
    }
    value = mapping.get(asset)
    if not value:
        raise HTTPException(status_code=400, detail=f"Unsupported asset: {asset}")
    return value


def _get_operator_address() -> str:
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


async def _verify_erc20_transfer(
    *,
    tx_hash: str,
    expected_sender: str,
    expected_recipient: str,
    token_address: str,
) -> int:
    """
    Verify ERC20 Transfer in tx receipt and return total amount matching sender->recipient.
    Supports both old and OZ-style Starknet Transfer event layouts.
    """
    from starknet_py.net.full_node_client import FullNodeClient

    rpc_url = (
        os.getenv("STARKNET_RPC_URL_V08")
        or os.getenv("EXECUTOR_RPC_URL")
        or "https://api.cartridge.gg/x/starknet/sepolia"
    )
    transfer_key = 0x99CD8BDE557814842A3121E8DDFD433A539B8C9F14BF31EBF108D12E6196E9

    sender_norm = _normalize_address(expected_sender)
    recipient_norm = _normalize_address(expected_recipient)
    token_norm = _normalize_address(token_address)
    tx_hash_int = _parse_int(tx_hash)

    client = FullNodeClient(node_url=rpc_url)
    try:
        await client.wait_for_tx(tx_hash_int, check_interval=3, retries=40)
    except Exception:
        # Non-fatal: if already accepted but index lagging, get_transaction_receipt may still work.
        pass

    receipt = await client.get_transaction_receipt(tx_hash_int)
    transfer_amount = 0
    found = False

    def _felt_to_int(value: Any) -> int:
        if isinstance(value, int):
            return value
        text = str(value)
        if text.startswith(("0x", "0X")):
            return int(text, 16)
        return int(text)

    for event in getattr(receipt, "events", []):
        event_from = _normalize_address(hex(event.from_address))
        if event_from != token_norm:
            continue
        if not event.keys:
            continue
        try:
            key0 = _felt_to_int(event.keys[0])
        except Exception:
            continue
        if key0 != transfer_key:
            continue

        ev_sender = None
        ev_recipient = None
        amount = 0
        if len(event.keys) >= 3 and len(event.data) >= 2:
            ev_sender = _normalize_address(hex(event.keys[1]))
            ev_recipient = _normalize_address(hex(event.keys[2]))
            amount = int(event.data[0]) + (int(event.data[1]) << 128)
        elif len(event.keys) == 1 and len(event.data) >= 4:
            ev_sender = _normalize_address(hex(event.data[0]))
            ev_recipient = _normalize_address(hex(event.data[1]))
            amount = int(event.data[2]) + (int(event.data[3]) << 128)
        else:
            continue

        if ev_sender == sender_norm and ev_recipient == recipient_norm:
            transfer_amount += amount
            found = True

    if not found:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No transfer found in tx {tx_hash} from {sender_norm} to {recipient_norm} "
                f"for token {token_norm}."
            ),
        )
    return transfer_amount


def _append_capital_flow_receipt(
    *,
    user_address: str,
    action_type: str,
    status: str,
    venue: str,
    execution_path: str,
    amount_wei: str,
    asset: str,
    capital_source: str,
    tx_hash: Optional[str] = None,
    destination_mode: Optional[str] = None,
    note: Optional[str] = None,
) -> str:
    payload: dict[str, Any] = {
        "action_type": action_type,
        "venue": venue,
        "execution_path": execution_path,
        "status": status,
        "amount_wei": amount_wei,
        "asset": asset,
        "capital_source": capital_source,
    }
    if destination_mode:
        payload["destination_mode"] = destination_mode
    if note:
        payload["details"] = note
    result = f"event:{json.dumps(payload, separators=(',', ':'), sort_keys=True)}"
    receipt = get_receipt_service().append_proof_receipt(
        user_address=user_address,
        proof_type="manual_wallet_action",
        threshold_or_model=action_type,
        result=result,
        tx_hash=tx_hash,
        pool_id=venue,
    )
    return str(receipt.get("receipt_id") or "")


async def _has_manual_wallet_receipt_for_tx(
    *,
    user_address: str,
    tx_hash: str,
    action_type: Optional[str] = None,
) -> bool:
    """
    Idempotency guard for manually recorded capital-flow receipts.
    Prevents replay-crediting the same transfer tx hash.
    """
    tx_norm = str(tx_hash or "").strip().lower()
    if not tx_norm:
        return False
    action_norm = str(action_type or "").strip().lower()
    rows = await get_receipt_service().get_user_receipts(user_address)
    for row in rows:
        if str(row.get("proof_type") or "") != "manual_wallet_action":
            continue
        existing_tx = str(row.get("tx_hash") or "").strip().lower()
        if existing_tx != tx_norm:
            continue
        if not action_norm:
            return True
        raw_result = str(row.get("result") or "")
        blob = raw_result[len("event:") :] if raw_result.startswith("event:") else raw_result
        payload: dict[str, Any] = {}
        if blob:
            try:
                payload = json.loads(blob)
            except Exception:
                payload = {}
        existing_action = str(
            payload.get("action_type") or row.get("threshold_or_model") or ""
        ).strip().lower()
        if existing_action == action_norm:
            return True
    return False


class TransferEntry(BaseModel):
    id: int
    address: str
    asset: str = "STRK"
    amount_wei: str
    direction: str
    request_id: int | None
    reason: str | None
    tx_hash: str | None = None
    capital_source: str | None = None
    created_at: int
    # Proof enrichment fields (populated when a receipt correlates)
    proof_hash: str | None = None
    proof_status: str | None = None  # "verified" | "pending" | "mock" | None
    receipt_id: str | None = None


class TransfersResponse(BaseModel):
    transfers: List[TransferEntry]
    limit: int
    offset: int


@router.get("/transfers", response_model=TransfersResponse)
async def get_transfers(
    user_address: str = Query(..., description="User's Starknet address"),
    asset: str | None = Query(None, description="Optional asset filter: STRK | zkdETH | zkdAI"),
    limit: int = Query(50, ge=1, le=500, description="Max entries to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> dict[str, Any]:
    """
    List ledger transfers for the given address (Vault ledger feed).
    Enriches each transfer with proof_hash / proof_status / receipt_id
    by correlating with the user's constraint receipts.
    """
    ledger = get_ledger_service()
    norm_addr = _normalize_address(user_address)
    raw = ledger.list_transfers(
        address=norm_addr,
        asset=_normalize_asset(asset) if asset else None,
        limit=limit,
        offset=offset,
    )

    # Build proof lookup from user's receipts (keyed by action_type)
    from app.services.receipt_service import get_receipt_service
    receipt_svc = get_receipt_service()
    # Receipt service stores addresses as-is (lowercased), so try both
    # normalized and original forms to ensure correlation works.
    user_receipts = await receipt_svc.get_user_receipts(norm_addr)
    if not user_receipts and norm_addr != user_address.strip().lower():
        user_receipts = await receipt_svc.get_user_receipts(user_address.strip().lower())
    # Index receipts by action_type for quick correlation
    receipts_by_action: dict[str, list[dict]] = {}
    for rc in user_receipts:
        act = rc.get("action_type") or rc.get("proof_type") or "unknown"
        receipts_by_action.setdefault(act, []).append(rc)

    def _correlate_proof(transfer: dict) -> tuple[str | None, str | None, str | None]:
        """Find the best matching receipt for a ledger transfer."""
        reason = (transfer.get("reason") or "").lower()
        # Map ledger reasons to receipt action_types
        action_map = {
            "deposit": "deposit", "demo_deposit": "deposit",
            "withdraw": "withdraw", "deploy": "deploy", "demo_deploy": "deploy",
            "rebalance": "rebalance", "allocation": "deploy",
            "ai_allocation": "deploy", "yield_accrual": "deposit",
        }
        target_action = action_map.get(reason)
        if not target_action:
            # Try matching by tx_hash
            tx = transfer.get("tx_hash")
            if tx:
                for rcs in receipts_by_action.values():
                    for rc in rcs:
                        if rc.get("tx_hash") == tx:
                            status = "verified" if rc.get("on_chain") else ("pending" if rc.get("proof_hash", "").startswith("0x") else "mock")
                            return rc.get("proof_hash"), status, rc.get("receipt_id")
            return None, None, None
        candidates = receipts_by_action.get(target_action, [])
        if not candidates:
            return None, None, None
        # Pick closest receipt by timestamp
        best = candidates[-1]  # most recent
        proof_hash = best.get("proof_hash")
        on_chain = best.get("on_chain", False)
        status = "verified" if on_chain else ("pending" if proof_hash else "mock")
        return proof_hash, status, best.get("receipt_id")

    transfers = []
    for r in raw:
        ph, ps, rid = _correlate_proof(r)
        transfers.append({
            "id": r["id"],
            "address": r["address"],
            "asset": r.get("asset", "STRK"),
            "amount_wei": r["amount_wei"],
            "direction": r["direction"],
            "request_id": r.get("request_id"),
            "reason": r.get("reason"),
            "tx_hash": r.get("tx_hash"),
            "capital_source": r.get("capital_source"),
            "created_at": r["created_at"],
            "proof_hash": ph,
            "proof_status": ps,
            "receipt_id": rid,
        })

    return {
        "transfers": transfers,
        "limit": limit,
        "offset": offset,
    }


class DemoCreditRequest(BaseModel):
    """Credit ledger for paper/demo mode. Only accepted when X-Demo-Mode: true."""
    user_address: str = Field(..., description="Starknet address to credit")
    amount_wei: str = Field(..., description="Amount in wei (decimal or hex string)")


class DemoCreditResponse(BaseModel):
    asset: str = "STRK"
    balance_wei: str
    message: str


@router.post("/demo-credit", response_model=DemoCreditResponse)
async def demo_credit(request: Request, body: DemoCreditRequest) -> dict[str, Any]:
    """
    Credit the internal ledger for the given address. Only allowed when X-Demo-Mode: true.
    Used in paper/demo mode to simulate deposits without on-chain txs.
    Also seeds several demo ledger entries and receipts so the demo UX isn't empty.
    """
    if not getattr(request.state, "demo_mode", False):
        raise HTTPException(
            status_code=403,
            detail="Demo credit is only allowed when X-Demo-Mode: true",
        )
    try:
        amount = int(body.amount_wei, 0)  # supports hex (0x...) or decimal
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid amount_wei: {e}") from e
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    ledger = get_ledger_service()
    try:
        new_balance = ledger.credit_balance(
            body.user_address,
            amount,
            request_id=None,
            reason="demo_deposit",
            settlement_type="demo",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # ── Seed demo activity so ledger isn't empty ────────────────────────
    import hashlib as _hl, uuid as _uuid, time as _time
    from app.services.receipt_service import get_receipt_service
    receipt_svc = get_receipt_service()
    addr = body.user_address
    now = int(_time.time())
    demo_events = [
        # Simulated AI allocation (30% of deposit)
        {"reason": "ai_allocation", "direction": "debit", "amount": str(int(amount * 0.30)),
         "settlement": "demo", "offset": -300, "capital_source": "private_capital"},
        # Simulated rebalance yield accrual
        {"reason": "yield_accrual", "direction": "credit", "amount": str(int(amount * 0.002)),
         "settlement": "demo", "offset": -200, "capital_source": None},
        # Simulated ZK proof-verified rebalance
        {"reason": "rebalance", "direction": "debit", "amount": str(int(amount * 0.05)),
         "settlement": "demo", "offset": -100, "capital_source": "private_capital"},
    ]
    for evt in demo_events:
        try:
            if evt["direction"] == "credit":
                ledger.credit_balance(
                    addr, int(evt["amount"]), request_id=None,
                    reason=evt["reason"], settlement_type=evt["settlement"],
                    capital_source=evt.get("capital_source"),
                )
            else:
                ledger.debit_balance(
                    addr, int(evt["amount"]), request_id=None,
                    reason=evt["reason"], settlement_type=evt["settlement"],
                )
        except ValueError:
            pass  # Skip if insufficient balance for debit

    # Seed demo receipts so proof status shows up
    demo_receipts = [
        {"action": "deposit", "proof_type": "risk_score"},
        {"action": "deploy", "proof_type": "allocation"},
        {"action": "rebalance", "proof_type": "rebalance"},
    ]
    for dr in demo_receipts:
        try:
            proof_hash = "0x" + _hl.sha256(f"demo_{addr}_{dr['action']}_{_uuid.uuid4().hex}".encode()).hexdigest()
            await receipt_svc.create_receipt(
                user_address=addr,
                constraints_hash=f"demo_{dr['proof_type']}",
                proof_hash=proof_hash,
                action_type=dr["action"],
                protocol_id=1,
                amount=int(amount * 0.3),
            )
        except Exception:
            pass  # Best-effort seeding

    return {
        "asset": "STRK",
        "balance_wei": str(new_balance),
        "message": "Ledger credited (demo) with seeded activity history.",
    }


class LedgerAssetAccount(BaseModel):
    asset: str
    available_wei: str
    pending_out_wei: str
    deployed_wei: str = "0"


class LedgerAccountResponse(BaseModel):
    address: str
    default_destination_mode: str = "shielded"
    wallet_opt_out_enabled: bool = True
    total_earned_wei: str
    assets: List[LedgerAssetAccount]


@router.get("/account/{address}", response_model=LedgerAccountResponse)
async def get_ledger_account(address: str) -> dict[str, Any]:
    """
    Return ledger account snapshot for the UI:
    available balance, pending outgoing requests, and deployed amount hints.
    """
    addr = _normalize_address(address)
    ledger = get_ledger_service()
    balances = ledger.list_asset_balances(addr)
    pending = relayer_api.get_pending_outgoing_by_asset(addr)
    deployed_strk = ledger.get_deployed_amount(addr)
    total_earned = ledger.get_total_yield(addr)

    assets: list[dict[str, str]] = []
    seen: set[str] = set()
    for symbol in SUPPORTED_ASSETS:
        seen.add(symbol)
        assets.append(
            {
                "asset": symbol,
                "available_wei": str(int(balances.get(symbol, "0"))),
                "pending_out_wei": str(int(pending.get(symbol, 0))),
                "deployed_wei": str(deployed_strk if symbol == "STRK" else 0),
            }
        )

    for symbol, amount in balances.items():
        if symbol in seen:
            continue
        assets.append(
            {
                "asset": symbol,
                "available_wei": str(int(amount)),
                "pending_out_wei": str(int(pending.get(symbol, 0))),
                "deployed_wei": "0",
            }
        )

    return {
        "address": addr,
        "default_destination_mode": "shielded",
        "wallet_opt_out_enabled": True,
        "total_earned_wei": str(total_earned),
        "assets": assets,
    }


class TransferOutRequest(BaseModel):
    user_address: str = Field(..., description="Source ledger account address")
    amount_wei: str = Field(..., description="Amount in wei (decimal or hex)")
    asset: str = Field("STRK", description="Asset symbol: STRK | zkdETH | zkdAI")
    capital_source: str = Field(
        "private_capital",
        description="Capital source label for timeline context",
    )
    destination_mode: str = Field(
        "shielded",
        description="Settlement rail: shielded (default) or wallet",
    )
    recipient: Optional[str] = Field(
        None,
        description="Optional wallet recipient; defaults to user_address",
    )


class TransferOutResponse(BaseModel):
    status: str
    destination_mode: str
    request_id: int
    asset: str
    capital_source: str
    amount_wei: str
    recipient: str
    ledger_balance_wei: str
    receipt_id: str
    message: str


class TransferInRequest(BaseModel):
    user_address: str = Field(..., description="Destination ledger account address")
    tx_hash: str = Field(..., description="Wallet tx hash transferring asset to operator wallet")
    asset: str = Field("STRK", description="Asset symbol: STRK | zkdETH | zkdAI")
    capital_source: str = Field(
        "wallet_mode",
        description="Capital source label for timeline context",
    )


class TransferInResponse(BaseModel):
    status: str
    asset: str
    capital_source: str
    tx_hash: str
    amount_wei: str
    balance_wei: str
    receipt_id: str
    message: str


@router.post("/transfer_in/request", response_model=TransferInResponse)
async def request_transfer_in(body: TransferInRequest) -> dict[str, Any]:
    """
    Verify wallet transfer to operator vault wallet, then credit internal ledger.
    This enforces wallet -> vault -> ledger flow for external deposits.
    """
    ledger = get_ledger_service()
    user_address = _normalize_address(body.user_address)
    tx_hash = str(body.tx_hash or "").strip()
    asset = _normalize_asset(body.asset)
    capital_source = str(body.capital_source or "wallet_mode").strip().lower()

    if asset not in SUPPORTED_ASSETS:
        raise HTTPException(status_code=400, detail=f"Unsupported asset: {asset}")
    if capital_source not in SUPPORTED_CAPITAL_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"capital_source must be one of: {', '.join(SUPPORTED_CAPITAL_SOURCES)}",
        )
    if not tx_hash:
        raise HTTPException(status_code=400, detail="tx_hash is required")
    if await _has_manual_wallet_receipt_for_tx(
        user_address=user_address,
        tx_hash=tx_hash,
        action_type="deposit",
    ):
        raise HTTPException(
            status_code=409,
            detail="tx_hash already processed for transfer_in",
        )

    operator = _get_operator_address()
    token_address = _token_address_for_asset(asset)
    amount_wei = await _verify_erc20_transfer(
        tx_hash=tx_hash,
        expected_sender=user_address,
        expected_recipient=operator,
        token_address=token_address,
    )

    try:
        new_balance = ledger.credit_balance(
            address=user_address,
            amount_wei=amount_wei,
            reason="transfer_in_wallet_verified",
            asset=asset,
            capital_source=capital_source,
            tx_hash=tx_hash,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    receipt_id = _append_capital_flow_receipt(
        user_address=user_address,
        action_type="deposit",
        status="confirmed",
        venue="vault",
        execution_path="internal_ledger",
        amount_wei=str(amount_wei),
        asset=asset,
        capital_source=capital_source,
        tx_hash=tx_hash,
        note="Wallet transfer verified and credited to internal ledger.",
    )

    return {
        "status": "credited",
        "asset": asset,
        "capital_source": capital_source,
        "tx_hash": tx_hash,
        "amount_wei": str(amount_wei),
        "balance_wei": str(new_balance),
        "receipt_id": receipt_id,
        "message": "Transfer verified and ledger credited.",
    }


@router.post("/transfer_out/request", response_model=TransferOutResponse)
async def request_transfer_out(body: TransferOutRequest) -> dict[str, Any]:
    """
    Queue a transfer out from internal ledger:
    - `shielded` (default): debit ledger then enqueue relayed private deposit.
    - `wallet`: debit ledger then enqueue direct wallet payout transfer.
    """
    ledger = get_ledger_service()
    user_address = _normalize_address(body.user_address)
    recipient = _normalize_address(body.recipient or user_address)
    destination_mode = str(body.destination_mode or "shielded").strip().lower()
    asset = _normalize_asset(body.asset)
    capital_source = str(body.capital_source or "private_capital").strip().lower()

    if destination_mode not in {"shielded", "wallet"}:
        raise HTTPException(status_code=400, detail="destination_mode must be 'shielded' or 'wallet'")
    if asset not in SUPPORTED_ASSETS:
        raise HTTPException(status_code=400, detail=f"Unsupported asset: {asset}")
    if capital_source not in SUPPORTED_CAPITAL_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"capital_source must be one of: {', '.join(SUPPORTED_CAPITAL_SOURCES)}",
        )
    if destination_mode == "shielded" and asset != "STRK":
        raise HTTPException(
            status_code=400,
            detail="Shielded transfer_out currently supports STRK only. Use destination_mode='wallet' for this asset.",
        )

    try:
        amount = int(str(body.amount_wei), 0)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid amount_wei: {e}") from e
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")

    try:
        new_balance = ledger.debit_balance(
            address=user_address,
            amount_wei=amount,
            reason=f"transfer_out_{destination_mode}",
            asset=asset,
            capital_source=capital_source,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        if destination_mode == "wallet":
            entry = relayer_api.enqueue_wallet_payout(
                requester=user_address,
                amount_wei=str(amount),
                recipient=recipient,
                asset=asset,
                reason="ledger_transfer_out_wallet",
            )
            request_id = int(entry["payout_id"])
            message = "Wallet payout queued. Funds will be transferred by relayer."
        else:
            proof_service = ZkdefiAgentService()
            proof = proof_service.generate_shielded_deposit_proof(
                user_address=user_address,
                pool_type="neutral",
                amount=amount,
            )
            commitment_raw = proof.get("commitment_felt") or proof.get("commitment")
            if not commitment_raw:
                raise ValueError("Proof response missing commitment")
            commitment_int = int(str(commitment_raw), 16) if str(commitment_raw).startswith("0x") else int(str(commitment_raw))
            commitment_low, commitment_high = _split_u256(commitment_int)
            proof_calldata = [str(v) for v in (proof.get("proof_calldata") or [])]
            if not proof_calldata:
                raise ValueError("Proof response missing proof_calldata")
            entry = relayer_api.enqueue_ledger_withdraw(
                requester=user_address,
                commitment_low=str(commitment_low),
                commitment_high=str(commitment_high),
                amount_wei=str(amount),
                proof_calldata=proof_calldata,
                reason="ledger_transfer_out_shielded",
                asset=asset,
            )
            request_id = int(entry["withdraw_id"])
            message = "Shielded transfer queued. Relayer will settle into private rail."
    except Exception as e:
        # Roll back ledger debit if queue/proof creation fails.
        try:
            ledger.credit_balance(
                address=user_address,
                amount_wei=amount,
                reason="transfer_out_rollback",
                asset=asset,
                capital_source=capital_source,
            )
        except Exception:
            logger.exception("Failed to rollback ledger debit for transfer_out")
        raise HTTPException(status_code=502, detail=f"Failed to queue transfer_out: {e}") from e

    receipt_id = _append_capital_flow_receipt(
        user_address=user_address,
        action_type="withdraw",
        status="pending",
        venue="vault",
        execution_path="internal_ledger",
        amount_wei=str(amount),
        asset=asset,
        capital_source=capital_source,
        destination_mode=destination_mode,
        note=f"Queued transfer out via {destination_mode} rail. request_id={request_id}",
    )

    return {
        "status": "queued",
        "destination_mode": destination_mode,
        "request_id": request_id,
        "asset": asset,
        "capital_source": capital_source,
        "amount_wei": str(amount),
        "recipient": recipient,
        "ledger_balance_wei": str(new_balance),
        "receipt_id": receipt_id,
        "message": message,
    }
