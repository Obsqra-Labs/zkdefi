"""State and timeline routes for Vault OS convergence."""

from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner
from starknet_py.hash.selector import get_selector_from_name

from app.services.ekubo_config import (
    EKUBO_ROUTER_SEPOLIA,
    SEPOLIA_ETH,
    SEPOLIA_FUSDC,
    SEPOLIA_STRK,
    SEPOLIA_USDC,
    get_ekubo_chain_id,
)
from app.api.routes.dex import _fetch_avnu_quotes, _pick_best_avnu_quote
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.ekubo_client import get_tokens
from app.services.market_surface_service import get_market_surface
from app.services.receipt_service import get_receipt_service
from app.services.shared_pool_service import POOLS_FILE
from app.services.vault_policy_service import get_vault_policy_service

router = APIRouter(tags=["state"])

STARKNET_RPC_URL = (
    os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia-rpc.publicnode.com")
)

BALANCE_OF_SELECTORS: tuple[str, ...] = (
    # Legacy selector used in existing ekubo route.
    "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
    # Canonical starknet selector.
    hex(get_selector_from_name("balance_of")),
)
ALLOWANCE_SELECTOR = hex(get_selector_from_name("allowance"))

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LOCAL_COMMITMENTS_FILE = DATA_DIR / "local_commitments_imports.json"

TOKEN_DECIMALS: dict[str, int] = {
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18,
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18,
    "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": 6,
    "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": 6,
}

TOKEN_SYMBOLS: dict[str, str] = {
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
    "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": "USDC",
    "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": "fUSDC",
}


class ExecutionPreflightRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str
    slippage_bps: int = Field(default=9500, ge=0, le=10000)
    venue_pref: Literal["best", "ekubo", "avnu"] = "best"
    user_address: str


class LocalCommitmentsMigrationRequest(BaseModel):
    user_address: str
    commitments: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    apply_policy_preset: bool = True


class ManualWalletEventRequest(BaseModel):
    user_address: str
    action_type: Literal["deposit", "withdraw", "swap", "lp_add", "lp_remove", "deploy"]
    venue: str = "privacy"
    execution_path: str | None = None
    tx_hash: str
    amount_wei: str | None = None
    asset: str | None = None
    capital_source: Literal["wallet_mode", "private_capital"] | None = None
    title: str | None = None
    details: str | None = None
    status: Literal["pending", "confirmed", "failed", "info"] = "confirmed"


class WalletStateToken(BaseModel):
    token: str
    symbol: str
    decimals: int
    balance_raw: str | None = None
    balance: str | None = None
    allowance_raw: str | None = None
    allowance: str | None = None
    spender: str | None = None
    last_sync: str


class WalletStateResponse(BaseModel):
    user_address: str
    spender: str
    last_sync: str
    tokens: list[WalletStateToken]


class TimelineEvent(BaseModel):
    id: str
    timestamp: str
    type: str
    title: str
    status: Literal["pending", "confirmed", "failed", "info"]
    tx_hash: str | None = None
    receipt_id: str | None = None
    venue: str | None = None
    execution_path: str | None = None
    policy_hash: str | None = None
    details: str | None = None
    meta: dict[str, Any] | None = None


class TimelineResponse(BaseModel):
    user_address: str
    events: list[TimelineEvent]
    count: int


class ExecutionPreflightResponse(BaseModel):
    can_submit: bool
    max_safe_input_raw: str
    expected_out_usd: float
    impact_bps: int
    warnings: list[str] = Field(default_factory=list)
    blocking_reasons: list[str] = Field(default_factory=list)
    liquidity_depth_usd: float | None = None


class ManualWalletEventResponse(BaseModel):
    user_address: str
    receipt_id: str
    tx_hash: str
    status: str


class WithdrawReadyEntry(BaseModel):
    id: str
    execution_path: str
    route_label: str
    source: Literal["local_commitment_import", "manual_wallet_receipt"]
    action_type: Literal["deposit", "withdraw"]
    created_at: str
    amount_wei: str
    tx_hash: str | None = None
    title: str | None = None
    status: Literal["pending", "confirmed", "failed", "info"] = "info"
    local_key: str | None = None
    has_local_commitment_data: bool = False


class WithdrawReadyRoute(BaseModel):
    execution_path: str
    route_label: str
    entry_count: int
    local_commitment_count: int
    estimated_withdrawable_amount_wei: str
    missing_commitment_data_count: int
    can_withdraw_direct: bool
    notes: list[str] = Field(default_factory=list)


class WithdrawReadyResponse(BaseModel):
    user_address: str
    last_sync: str
    routes: list[WithdrawReadyRoute]
    entries: list[WithdrawReadyEntry]


class CommitmentLedgerRoute(BaseModel):
    execution_path: str
    route_label: str
    source_keys: list[str]
    entries: list[dict[str, Any]]


class CommitmentLedgerResponse(BaseModel):
    user_address: str
    last_sync: str
    total_entries: int
    routes: list[CommitmentLedgerRoute]



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _normalize_address(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    without_prefix = raw[2:] if raw.startswith("0x") else raw
    stripped = without_prefix.lstrip("0")
    return f"0x{stripped or '0'}"



def _parse_int(value: str, field_name: str) -> int:
    try:
        parsed = int(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a decimal string") from exc
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be positive")
    return parsed



def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback



def _format_units(amount_raw: int | None, decimals: int) -> str | None:
    if amount_raw is None:
        return None
    value = max(0, int(amount_raw))
    base = 10**max(0, decimals)
    whole = value // base
    frac = value % base
    if decimals == 0:
        return str(whole)
    frac_text = str(frac).rjust(decimals, "0").rstrip("0")
    return f"{whole}.{frac_text}" if frac_text else str(whole)



def _load_local_commitments() -> dict[str, Any]:
    if not LOCAL_COMMITMENTS_FILE.exists():
        return {}
    try:
        payload = json.loads(LOCAL_COMMITMENTS_FILE.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return {}
    return {}



def _save_local_commitments(payload: dict[str, Any]) -> None:
    LOCAL_COMMITMENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_COMMITMENTS_FILE.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")



def _resolve_import_user(
    payload: dict[str, Any],
    address: str,
) -> tuple[str | None, dict[str, Any] | None]:
    direct = payload.get(address)
    if isinstance(direct, dict):
        return address, direct
    for key, value in payload.items():
        if _normalize_address(str(key)) == address and isinstance(value, dict):
            return str(key), value
    return None, None


def _merge_commitment_rows(
    existing_rows: list[Any],
    incoming_rows: list[Any],
) -> tuple[list[dict[str, Any]], int]:
    merged: list[dict[str, Any]] = [dict(row) for row in existing_rows if isinstance(row, dict)]
    added_count = 0
    for row in incoming_rows:
        if not isinstance(row, dict):
            continue
        candidate = dict(row)
        commitment = str(candidate.get("commitment") or "").strip()
        if commitment:
            idx = next(
                (
                    i
                    for i, existing in enumerate(merged)
                    if str(existing.get("commitment") or "").strip() == commitment
                ),
                -1,
            )
            if idx >= 0:
                merged[idx] = {**merged[idx], **candidate}
            else:
                merged.append(candidate)
                added_count += 1
        else:
            merged.append(candidate)
            added_count += 1
    return merged, added_count


def _merge_commitment_payloads(
    existing: dict[str, Any],
    incoming: dict[str, Any],
) -> tuple[dict[str, list[dict[str, Any]]], int]:
    merged: dict[str, list[dict[str, Any]]] = {}
    for key, rows in existing.items():
        if isinstance(rows, list):
            merged[str(key)] = [dict(row) for row in rows if isinstance(row, dict)]

    added_count = 0
    for key, rows in incoming.items():
        if not isinstance(rows, list):
            continue
        source_key = str(key)
        current_rows = merged.get(source_key, [])
        next_rows, added = _merge_commitment_rows(current_rows, rows)
        merged[source_key] = next_rows
        added_count += added
    return merged, added_count


def _status_from_text(value: str) -> Literal["pending", "confirmed", "failed", "info"]:
    normalized = (value or "").strip().lower()
    if normalized in {"executed", "confirmed", "pass", "success", "ok"}:
        return "confirmed"
    if normalized in {"blocked", "failed", "error", "reject", "rejected"}:
        return "failed"
    if normalized in {"pending", "queued", "proposed"}:
        return "pending"
    return "info"



def _parse_timestamp(raw: Any) -> datetime:
    text = str(raw or "").strip()
    if not text:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _route_from_hint(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return "unknown"
    if "full_privacy" in raw or "fullprivacy" in raw or "pool_c" in raw or "poolc" in raw:
        return "full_privacy_pool"
    if "shielded" in raw or "stealth" in raw or "unlinkable" in raw:
        return "shielded_pool"
    if "hashed" in raw or "pool_d" in raw or "poold" in raw or "claim" in raw:
        return "hashed_withdraw_pool"
    if "internal_ledger" in raw:
        return "internal_ledger"
    return raw


def _route_label(path: str) -> str:
    key = str(path or "").strip().lower()
    if key == "full_privacy_pool":
        return "Full Privacy"
    if key == "shielded_pool":
        return "Shielded"
    if key == "hashed_withdraw_pool":
        return "Hashed Claims"
    if key == "internal_ledger":
        return "Internal Ledger"
    return key.replace("_", " ").title() if key else "Unknown"


def _extract_amount_wei(row: dict[str, Any]) -> int:
    for field in ("amount", "balance", "amount_wei", "withdraw_amount", "change_amount"):
        value = row.get(field)
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        try:
            return max(0, int(text))
        except Exception:
            continue
    return 0


async def _starknet_call(contract: str, selector: str, calldata: list[str]) -> list[str] | None:
    payload = {
        "jsonrpc": "2.0",
        "method": "starknet_call",
        "params": {
            "request": {
                "contract_address": contract,
                "entry_point_selector": selector,
                "calldata": calldata,
            },
            "block_id": "latest",
        },
        "id": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(STARKNET_RPC_URL, json=payload)
        data = response.json()
    except Exception:
        return None
    result = data.get("result")
    if not isinstance(result, list):
        return None
    return [str(x) for x in result]



def _parse_u256(result: list[str] | None) -> int | None:
    if not isinstance(result, list) or len(result) < 2:
        return None
    try:
        low = int(result[0], 16) if result[0].startswith("0x") else int(result[0])
        high = int(result[1], 16) if result[1].startswith("0x") else int(result[1])
    except Exception:
        return None
    return low + (high << 128)


@router.get("/history/timeline/{user_address}", response_model=TimelineResponse)
async def history_timeline(user_address: str):
    address = _normalize_address(user_address)
    if not address:
        raise HTTPException(status_code=400, detail="user_address is required")

    receipt_service = get_receipt_service()
    receipts = await receipt_service.get_user_receipts(address)
    events: list[TimelineEvent] = []

    for row in receipts:
        if not isinstance(row, dict):
            continue
        receipt_id = str(row.get("receipt_id") or "")
        if not receipt_id:
            continue
        proof_type = str(row.get("proof_type") or "")
        timestamp = str(row.get("timestamp") or _now_iso())
        tx_hash = row.get("tx_hash") if isinstance(row.get("tx_hash"), str) else None
        status: Literal["pending", "confirmed", "failed", "info"] = "pending"
        title = "Receipt"
        details = None
        venue = None
        execution_path = None
        policy_hash = row.get("snapshot_hash") if isinstance(row.get("snapshot_hash"), str) else None
        meta: dict[str, Any] | None = None

        if proof_type == "policy_compile":
            raw_result = str(row.get("result") or "")
            status_key, _, detail_blob = raw_result.partition(":")
            status = _status_from_text(status_key)
            parsed_details: dict[str, Any] = {}
            if detail_blob:
                try:
                    parsed_details = json.loads(detail_blob)
                except Exception:
                    parsed_details = {}
            action_type = str(parsed_details.get("action_type") or "action")
            title = f"Policy compile • {action_type}"
            execution_path = (
                str(parsed_details.get("execution_path")) if parsed_details.get("execution_path") else None
            )
            venue = str(parsed_details.get("venue")) if parsed_details.get("venue") else None
            detail_parts = []
            blocking = parsed_details.get("blocking_reasons")
            warnings = parsed_details.get("warnings")
            if isinstance(blocking, list) and blocking:
                detail_parts.append("blocking: " + ", ".join(str(x) for x in blocking))
            if isinstance(warnings, list) and warnings:
                detail_parts.append("warnings: " + ", ".join(str(x) for x in warnings))
            details = " | ".join(detail_parts) if detail_parts else None
        elif proof_type == "shared_pool_execution":
            raw_result = str(row.get("result") or "")
            status_key, _, reason = raw_result.partition(":")
            status = _status_from_text(status_key)
            proposal_id = str(row.get("threshold_or_model") or "")
            title = f"Shared pool execution • {proposal_id or 'proposal'}"
            details = reason or None
        elif proof_type.startswith("privacy_"):
            status = _status_from_text(str(row.get("result") or "pending"))
            title = proof_type.replace("_", " ").title()
            detail_parts: list[str] = []
            result_val = str(row.get("result") or "")
            if result_val:
                detail_parts.append(result_val)
            if receipt_id:
                detail_parts.append(f"gate_proof_id: {receipt_id}")
            snap = row.get("snapshot_hash")
            if snap:
                detail_parts.append(f"policy_version: {snap}")
            fact = row.get("fact_hash")
            if fact:
                detail_parts.append(f"proof_hash: {fact}")
            withdraw_src = row.get("withdraw_source")
            if withdraw_src:
                detail_parts.append(f"source: {withdraw_src}")
            details = " | ".join(detail_parts) if detail_parts else None
        elif proof_type == "manual_wallet_action":
            raw_result = str(row.get("result") or "")
            detail_blob = raw_result
            if raw_result.startswith("event:"):
                detail_blob = raw_result[len("event:") :]
            payload: dict[str, Any] = {}
            try:
                if detail_blob:
                    payload = json.loads(detail_blob)
            except Exception:
                payload = {}
            action_type = str(payload.get("action_type") or row.get("threshold_or_model") or "action")
            title = str(payload.get("title") or f"Manual {action_type}")
            status = _status_from_text(str(payload.get("status") or "confirmed"))
            venue = str(payload.get("venue") or row.get("pool_id") or "").strip() or None
            execution_path = str(payload.get("execution_path") or "").strip() or None
            amount_wei = str(payload.get("amount_wei") or "").strip()
            amount_detail = f"amount_wei={amount_wei}" if amount_wei else ""
            asset = str(payload.get("asset") or "").strip()
            asset_detail = f"asset={asset}" if asset else ""
            capital_source = str(payload.get("capital_source") or "").strip()
            source_detail = f"capital_source={capital_source}" if capital_source else ""
            destination_mode = str(payload.get("destination_mode") or "").strip()
            destination_detail = f"destination_mode={destination_mode}" if destination_mode else ""
            details_text = str(payload.get("details") or "").strip()
            details = " | ".join(
                part
                for part in [details_text, amount_detail, asset_detail, source_detail, destination_detail]
                if part
            ) or None
            meta = payload
        elif proof_type.startswith("disclosure"):
            status = _status_from_text(str(row.get("result") or "pending"))
            title = proof_type.replace("_", " ").title()
            details = f"threshold/model: {row.get('threshold_or_model') or 'n/a'}"
        elif row.get("action_type"):
            action_type = str(row.get("action_type"))
            status = "confirmed" if bool(row.get("on_chain")) else "pending"
            title = f"{action_type.title()} receipt"
            details = f"protocol {row.get('protocol_id')}"
        else:
            status = _status_from_text(str(row.get("result") or "pending"))
            title = (proof_type or "receipt").replace("_", " ").title()
            details = str(row.get("result") or "") or None

        if tx_hash:
            status = "confirmed"

        events.append(
            TimelineEvent(
                id=receipt_id,
                timestamp=timestamp,
                type=proof_type or str(row.get("action_type") or "receipt"),
                title=title,
                status=status,
                tx_hash=tx_hash,
                receipt_id=receipt_id,
                venue=venue,
                execution_path=execution_path,
                policy_hash=policy_hash,
                details=details,
                meta=meta,
            )
        )

    # Include shared pool proposal lifecycle rows for manager/member visibility.
    try:
        if POOLS_FILE.exists():
            pools_payload = json.loads(POOLS_FILE.read_text(encoding="utf-8"))
            if isinstance(pools_payload, dict):
                for pool in pools_payload.values():
                    if not isinstance(pool, dict):
                        continue
                    proposals = pool.get("proposals")
                    if not isinstance(proposals, list):
                        continue
                    for proposal in proposals:
                        if not isinstance(proposal, dict):
                            continue
                        manager = _normalize_address(str(pool.get("manager_address") or ""))
                        executed_by = _normalize_address(str(proposal.get("executed_by") or ""))
                        blocked_for = _normalize_address(str(proposal.get("blocked_for") or ""))
                        if address not in {manager, executed_by, blocked_for}:
                            continue
                        proposal_id = str(proposal.get("proposal_id") or "")
                        if not proposal_id:
                            continue
                        proposal_status = str(proposal.get("status") or "proposed")
                        event_status = _status_from_text(proposal_status)
                        timestamp = (
                            str(proposal.get("updated_at") or proposal.get("created_at") or _now_iso())
                        )
                        details = f"Pool {pool.get('shared_pool_id')}"
                        reason = proposal.get("reason")
                        if reason:
                            details = f"{details} | {reason}"
                        events.append(
                            TimelineEvent(
                                id=f"proposal_{proposal_id}",
                                timestamp=timestamp,
                                type="shared_pool_proposal",
                                title=f"Shared pool proposal • {proposal_status}",
                                status=event_status,
                                details=details,
                            )
                        )
    except Exception:
        # Non-fatal timeline enrichment.
        pass

    dedup: dict[str, TimelineEvent] = {}
    for event in events:
        dedup[event.id] = event

    sorted_events = sorted(
        dedup.values(),
        key=lambda item: _parse_timestamp(item.timestamp),
        reverse=True,
    )

    return TimelineResponse(user_address=address, events=sorted_events, count=len(sorted_events))


@router.get("/state/withdraw-ready/{user_address}", response_model=WithdrawReadyResponse)
async def state_withdraw_ready(user_address: str):
    address = _normalize_address(user_address)
    if not address or address == "0x0":
        raise HTTPException(status_code=400, detail="user_address is required")

    now_iso = _now_iso()
    entries: list[WithdrawReadyEntry] = []
    estimated_by_route: dict[str, int] = defaultdict(int)
    local_count_by_route: dict[str, int] = defaultdict(int)
    missing_count_by_route: dict[str, int] = defaultdict(int)

    # 1) Local commitment imports (backend-authoritative mirror of legacy browser commitments).
    imported_payload = _load_local_commitments()
    _, user_import = (
        _resolve_import_user(imported_payload, address)
        if isinstance(imported_payload, dict)
        else (None, None)
    )
    imported_commitments = {}
    if isinstance(user_import, dict):
        raw_commitments = user_import.get("commitments")
        if isinstance(raw_commitments, dict):
            imported_commitments = raw_commitments

    for local_key, rows in imported_commitments.items():
        if not isinstance(rows, list):
            continue
        route = _route_from_hint(local_key)
        route_label = _route_label(route)
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            amount_wei = _extract_amount_wei(row)
            if amount_wei <= 0:
                continue
            created_at = (
                str(row.get("timestamp") or row.get("created_at") or user_import.get("imported_at") or now_iso)
                if isinstance(user_import, dict)
                else now_iso
            )
            tx_hash = str(row.get("tx_hash") or "").strip() or None
            entry = WithdrawReadyEntry(
                id=f"local_{route}_{str(local_key).replace(' ', '_')}_{idx}",
                execution_path=route,
                route_label=route_label,
                source="local_commitment_import",
                action_type="deposit",
                created_at=created_at,
                amount_wei=str(amount_wei),
                tx_hash=tx_hash,
                title=str(row.get("title") or "").strip() or "Imported commitment",
                status="confirmed",
                local_key=str(local_key),
                has_local_commitment_data=True,
            )
            entries.append(entry)
            estimated_by_route[route] += amount_wei
            local_count_by_route[route] += 1

    # 2) Manual wallet events from unified receipts (captures vault funding deposits/withdrawals).
    receipt_service = get_receipt_service()
    receipts = await receipt_service.get_user_receipts(address)
    for row in receipts:
        if not isinstance(row, dict):
            continue
        if str(row.get("proof_type") or "") != "manual_wallet_action":
            continue

        raw_result = str(row.get("result") or "")
        payload_blob = raw_result[len("event:") :] if raw_result.startswith("event:") else raw_result
        payload: dict[str, Any] = {}
        try:
            if payload_blob:
                payload = json.loads(payload_blob)
        except Exception:
            payload = {}

        action_type = str(payload.get("action_type") or row.get("threshold_or_model") or "").strip().lower()
        if action_type not in {"deposit", "withdraw"}:
            continue

        route = _route_from_hint(payload.get("execution_path") or row.get("pool_id") or payload.get("venue"))
        if route == "unknown":
            continue
        route_label = _route_label(route)
        amount_wei_text = str(payload.get("amount_wei") or "").strip()
        try:
            amount_wei = max(0, int(amount_wei_text)) if amount_wei_text else 0
        except Exception:
            amount_wei = 0

        created_at = str(row.get("timestamp") or now_iso)
        tx_hash = str(payload.get("tx_hash") or row.get("tx_hash") or "").strip() or None
        status = _status_from_text(str(payload.get("status") or row.get("result") or "info"))
        title = str(payload.get("title") or f"Manual {action_type}").strip()

        entries.append(
            WithdrawReadyEntry(
                id=f"receipt_{str(row.get('receipt_id') or '')}",
                execution_path=route,
                route_label=route_label,
                source="manual_wallet_receipt",
                action_type="withdraw" if action_type == "withdraw" else "deposit",
                created_at=created_at,
                amount_wei=str(amount_wei),
                tx_hash=tx_hash,
                title=title or None,
                status=status,
                local_key=None,
                has_local_commitment_data=False,
            )
        )

        if amount_wei > 0:
            if action_type == "deposit":
                estimated_by_route[route] += amount_wei
                # Receipt-only deposits usually do not include withdraw secrets/paths.
                missing_count_by_route[route] += 1
            else:
                estimated_by_route[route] = max(0, estimated_by_route[route] - amount_wei)
                if missing_count_by_route[route] > 0:
                    missing_count_by_route[route] -= 1

    # 2.5) Cross-link receipt deposit entries to unmatched local commitment imports.
    #
    # A deposit can arrive in two independent channels:
    #   • Step 1 (local import): the backend has the commitment secret/proof but no tx_hash.
    #   • Step 2 (receipt scan): the backend found the tx on-chain but has no commitment secret.
    # When both channels describe the SAME deposit (same route + amount_wei), merge them so
    # the frontend gets the on-chain tx_hash AND the withdraw-ready local commitment data.
    # FIFO matching (oldest local entry first) is used when multiple local entries share the
    # same amount.
    avail_local: dict[str, list[int]] = defaultdict(list)
    for i, entry in enumerate(entries):
        if entry.source == "local_commitment_import" and entry.has_local_commitment_data:
            key = f"{entry.execution_path}:{entry.amount_wei}"
            avail_local[key].append(i)

    consumed_local_idxs: set[int] = set()
    for receipt_entry in entries:
        if (
            receipt_entry.source != "manual_wallet_receipt"
            or receipt_entry.action_type != "deposit"
            or receipt_entry.has_local_commitment_data
        ):
            continue
        key = f"{receipt_entry.execution_path}:{receipt_entry.amount_wei}"
        candidates = [i for i in avail_local.get(key, []) if i not in consumed_local_idxs]
        if not candidates:
            continue
        # FIFO: pick the oldest unmatched local commitment
        best_i = min(candidates, key=lambda i: _parse_timestamp(entries[i].created_at))
        local_entry = entries[best_i]
        consumed_local_idxs.add(best_i)
        # Transfer commitment metadata (secret key reference) to the receipt entry
        receipt_entry.local_key = local_entry.local_key
        receipt_entry.has_local_commitment_data = True
        route = receipt_entry.execution_path
        amount_int = int(receipt_entry.amount_wei or 0)
        # The same deposit was counted twice in estimated_by_route (both local + receipt
        # paths incremented it).  Remove the local entry's share to avoid double-counting.
        estimated_by_route[route] = max(0, estimated_by_route.get(route, 0) - amount_int)
        # Receipt is no longer "missing" commitment data
        if missing_count_by_route.get(route, 0) > 0:
            missing_count_by_route[route] -= 1
        # local_count is net-zero: one local entry removed, its data promoted to receipt entry.

    # Drop consumed local entries — they are now represented by the merged receipt entries.
    entries = [e for i, e in enumerate(entries) if i not in consumed_local_idxs]

    # Build route summaries.
    route_order = ["shielded_pool", "full_privacy_pool", "hashed_withdraw_pool", "internal_ledger"]
    present_routes = {entry.execution_path for entry in entries}
    for route in list(present_routes):
        if route not in route_order:
            route_order.append(route)

    routes: list[WithdrawReadyRoute] = []
    for route in route_order:
        route_entries = [entry for entry in entries if entry.execution_path == route]
        if not route_entries:
            continue
        local_count = int(local_count_by_route.get(route, 0))
        missing_count = int(missing_count_by_route.get(route, 0))
        estimated_amount = max(0, int(estimated_by_route.get(route, 0)))
        notes: list[str] = []
        if local_count == 0 and missing_count > 0:
            notes.append(
                "Deposits found from wallet receipts, but withdraw secrets/commitments are missing. "
                "Use route-specific commitment sync or redeposit through the unified flow."
            )
        if route == "internal_ledger":
            notes.append("Internal ledger mode is preview-only and not executable in V1.")
        if local_count > 0:
            notes.append("Route has local commitment data and can be withdrawn via route panel.")

        routes.append(
            WithdrawReadyRoute(
                execution_path=route,
                route_label=_route_label(route),
                entry_count=len(route_entries),
                local_commitment_count=local_count,
                estimated_withdrawable_amount_wei=str(estimated_amount),
                missing_commitment_data_count=missing_count,
                can_withdraw_direct=local_count > 0 and route != "internal_ledger",
                notes=notes,
            )
        )

    sorted_entries = sorted(entries, key=lambda item: _parse_timestamp(item.created_at), reverse=True)
    return WithdrawReadyResponse(
        user_address=address,
        last_sync=now_iso,
        routes=routes,
        entries=sorted_entries,
    )


@router.get("/state/commitment-ledger/{user_address}", response_model=CommitmentLedgerResponse)
async def state_commitment_ledger(user_address: str):
    """
    Return backend-imported commitment rows grouped by execution route.
    This is used by unified withdraw UX to restore local commitment cache
    for legacy route-specific withdraw panels.
    """
    address = _normalize_address(user_address)
    if not address or address == "0x0":
        raise HTTPException(status_code=400, detail="user_address is required")

    imported_payload = _load_local_commitments()
    _, user_import = (
        _resolve_import_user(imported_payload, address)
        if isinstance(imported_payload, dict)
        else (None, None)
    )
    imported_commitments = {}
    if isinstance(user_import, dict):
        raw_commitments = user_import.get("commitments")
        if isinstance(raw_commitments, dict):
            imported_commitments = raw_commitments

    grouped_keys: dict[str, set[str]] = defaultdict(set)
    grouped_entries: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for source_key, rows in imported_commitments.items():
        if not isinstance(rows, list):
            continue
        route = _route_from_hint(source_key)
        grouped_keys[route].add(str(source_key))
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            payload = dict(row)
            payload["_source_key"] = str(source_key)
            payload["_source_index"] = idx
            grouped_entries[route].append(payload)

    route_order = ["shielded_pool", "full_privacy_pool", "hashed_withdraw_pool", "internal_ledger"]
    for route in sorted(grouped_entries.keys()):
        if route not in route_order:
            route_order.append(route)

    routes: list[CommitmentLedgerRoute] = []
    total_entries = 0
    for route in route_order:
        entries = grouped_entries.get(route) or []
        if not entries:
            continue
        source_keys = sorted(grouped_keys.get(route) or set())
        total_entries += len(entries)
        routes.append(
            CommitmentLedgerRoute(
                execution_path=route,
                route_label=_route_label(route),
                source_keys=source_keys,
                entries=entries,
            )
        )

    return CommitmentLedgerResponse(
        user_address=address,
        last_sync=_now_iso(),
        total_entries=total_entries,
        routes=routes,
    )


@router.get("/wallet/state/{user_address}", response_model=WalletStateResponse)
async def wallet_state(
    user_address: str,
    token: list[str] | None = Query(default=None),
):
    address = _normalize_address(user_address)
    if not address or address == "0x0":
        raise HTTPException(status_code=400, detail="user_address is required")

    requested = [_normalize_address(t) for t in (token or []) if _normalize_address(t)]
    tracked_tokens: list[str] = [
        _normalize_address(SEPOLIA_STRK),
        _normalize_address(SEPOLIA_ETH),
        _normalize_address(SEPOLIA_USDC),
        _normalize_address(SEPOLIA_FUSDC),
    ]
    for item in requested:
        if item not in tracked_tokens:
            tracked_tokens.append(item)

    # Add active route tokens from market opportunities.
    try:
        surface = await get_market_surface(chain_id=get_ekubo_chain_id())
        opportunities = surface.get("opportunities") if isinstance(surface, dict) else []
        if isinstance(opportunities, list):
            for row in opportunities[:8]:
                if not isinstance(row, dict):
                    continue
                for key in ("token0", "token1"):
                    token_addr = _normalize_address(row.get(key))
                    if token_addr and token_addr not in tracked_tokens:
                        tracked_tokens.append(token_addr)
    except Exception:
        pass

    now_iso = _now_iso()
    rows: list[WalletStateToken] = []
    spender = _normalize_address(EKUBO_ROUTER_SEPOLIA)

    for token_addr in tracked_tokens:
        symbol = TOKEN_SYMBOLS.get(token_addr, token_addr)
        decimals = TOKEN_DECIMALS.get(token_addr, 18)

        balance_raw_int: int | None = None
        for selector in BALANCE_OF_SELECTORS:
            result = await _starknet_call(token_addr, selector, [address])
            parsed = _parse_u256(result)
            if parsed is not None:
                balance_raw_int = parsed
                break

        allowance_result = await _starknet_call(
            token_addr,
            ALLOWANCE_SELECTOR,
            [address, spender],
        )
        allowance_raw_int = _parse_u256(allowance_result)

        rows.append(
            WalletStateToken(
                token=token_addr,
                symbol=symbol,
                decimals=decimals,
                balance_raw=str(balance_raw_int) if balance_raw_int is not None else None,
                balance=_format_units(balance_raw_int, decimals),
                allowance_raw=str(allowance_raw_int) if allowance_raw_int is not None else None,
                allowance=_format_units(allowance_raw_int, decimals),
                spender=spender,
                last_sync=now_iso,
            )
        )

    return WalletStateResponse(
        user_address=address,
        spender=spender,
        last_sync=now_iso,
        tokens=rows,
    )


@router.post("/execution/preflight", response_model=ExecutionPreflightResponse)
async def execution_preflight(data: ExecutionPreflightRequest, _caller: str = WalletOwner):
    chain_id = get_ekubo_chain_id()
    if not chain_id:
        raise HTTPException(status_code=503, detail="EKUBO_CHAIN_ID not configured")

    amount_in_raw = _parse_int(data.amount_in, "amount_in")
    token_in = _normalize_address(data.token_in)
    token_out = _normalize_address(data.token_out)

    warnings: list[str] = []
    blocking_reasons: list[str] = []
    ekubo_out_raw = 0
    avnu_out_raw = 0
    ekubo_error: str | None = None
    avnu_error: str | None = None
    selected_source: Literal["ekubo", "avnu"] = "ekubo"

    if data.venue_pref in {"ekubo", "best"}:
        swap = await build_swap_calldata(
            chain_id=str(chain_id),
            token_in=token_in,
            token_out=token_out,
            amount_in_wei=amount_in_raw,
            slippage_bps=data.slippage_bps,
        )
        if swap.get("error"):
            ekubo_error = str(swap.get("error"))
        else:
            ekubo_out_raw = int(str(swap.get("expected_out") or "0"))
            if ekubo_out_raw <= 0:
                ekubo_error = "no_executable_output_for_pair"

    if data.venue_pref in {"avnu", "best"}:
        try:
            quotes = await _fetch_avnu_quotes(
                token_in=token_in,
                token_out=token_out,
                amount_in=amount_in_raw,
                taker_address=data.user_address,
            )
            _, best_out = _pick_best_avnu_quote(quotes)
            avnu_out_raw = max(0, int(best_out))
            if avnu_out_raw <= 0:
                avnu_error = "no_avnu_liquidity_for_pair"
        except HTTPException as exc:
            avnu_error = str(exc.detail)
        except Exception as exc:
            avnu_error = str(exc)

    if data.venue_pref == "ekubo":
        selected_source = "ekubo"
    elif data.venue_pref == "avnu":
        selected_source = "avnu"
    else:
        selected_source = "avnu" if avnu_out_raw > ekubo_out_raw else "ekubo"
        if ekubo_error:
            warnings.append(f"Ekubo quote unavailable: {ekubo_error}")
        if avnu_error:
            warnings.append(f"AVNU quote unavailable: {avnu_error}")

    expected_out_raw = avnu_out_raw if selected_source == "avnu" else ekubo_out_raw
    if expected_out_raw <= 0:
        reason = avnu_error if selected_source == "avnu" else ekubo_error
        blocking_reasons.append(reason or "no_executable_output_for_pair")
        if data.venue_pref == "best":
            if ekubo_error and ekubo_error not in blocking_reasons:
                blocking_reasons.append(f"ekubo:{ekubo_error}")
            if avnu_error and avnu_error not in blocking_reasons:
                blocking_reasons.append(f"avnu:{avnu_error}")
    else:
        warnings.append(f"Preflight source: {selected_source.upper()}.")

    try:
        token_rows = await get_tokens(chain_id=str(chain_id), page_size=500)
    except Exception:
        token_rows = []

    price_by_token: dict[str, float] = {}
    decimals_by_token: dict[str, int] = dict(TOKEN_DECIMALS)
    for row in token_rows:
        if not isinstance(row, dict):
            continue
        addr = _normalize_address(row.get("address"))
        if not addr:
            continue
        usd_price = _safe_float(row.get("usd_price"), 0.0)
        if usd_price > 0:
            price_by_token[addr] = usd_price
        raw_decimals = row.get("decimals")
        try:
            if raw_decimals is not None:
                decimals_by_token[addr] = max(0, int(raw_decimals))
        except Exception:
            pass

    in_decimals = decimals_by_token.get(token_in, 18)
    out_decimals = decimals_by_token.get(token_out, 18)
    in_price = price_by_token.get(token_in)
    out_price = price_by_token.get(token_out)

    amount_in_units = amount_in_raw / float(10 ** max(0, in_decimals))
    expected_out_units = expected_out_raw / float(10 ** max(0, out_decimals)) if expected_out_raw > 0 else 0.0

    input_usd = amount_in_units * in_price if in_price else None
    expected_out_usd = expected_out_units * out_price if out_price else 0.0
    if input_usd is None:
        warnings.append("Input token USD price unavailable; using liquidity-only checks.")
    if out_price is None:
        warnings.append("Output token USD price unavailable; expected output USD is approximate.")

    liquidity_depth_usd: float | None = None
    max_safe_input_usd = 0.0
    try:
        surface = await get_market_surface(chain_id=str(chain_id))
        opportunities = surface.get("opportunities") if isinstance(surface, dict) else []
        if isinstance(opportunities, list):
            for row in opportunities:
                if not isinstance(row, dict):
                    continue
                t0 = _normalize_address(row.get("token0"))
                t1 = _normalize_address(row.get("token1"))
                if {t0, t1} == {token_in, token_out}:
                    tvl_usd = _safe_float(row.get("tvl_usd"), 0.0)
                    volume_usd = _safe_float(row.get("volume_24h_usd"), 0.0)
                    liquidity_depth_usd = tvl_usd
                    max_safe_input_usd = max(0.5, min(tvl_usd * 0.004, max(1.0, volume_usd * 0.015)))
                    if str(row.get("source") or "") in {"fallback", "synthetic"}:
                        warnings.append("Market data is fallback/synthetic. Route is advisory until fresh quote/build confirms.")
                    break
    except Exception:
        pass

    if max_safe_input_usd <= 0:
        if input_usd is not None:
            max_safe_input_usd = max(0.5, input_usd * 0.5)
        else:
            max_safe_input_usd = 1.0

    if input_usd is not None and input_usd > max_safe_input_usd:
        warnings.append(
            "Requested size is above recommended safe size "
            f"({max_safe_input_usd:.2f} USD). Consider splitting into smaller chunks."
        )

    impact_bps = 0
    if input_usd is not None and input_usd > 0 and expected_out_usd > 0:
        impact_bps = int(max(0.0, (1.0 - (expected_out_usd / input_usd)) * 10_000))
        if impact_bps > 500:
            warnings.append(
                f"Estimated impact is high ({impact_bps} bps). Expect slippage or route degradation."
            )

    if input_usd is not None and expected_out_usd > 0 and expected_out_usd < 0.01:
        warnings.append("Expected output is dust (< $0.01).")

    max_safe_input_raw = "0"
    if in_price and in_price > 0:
        safe_units = max_safe_input_usd / in_price
        max_safe_input_raw = str(max(1, int(safe_units * (10 ** max(0, in_decimals)))))
    else:
        max_safe_input_raw = str(max(1, amount_in_raw // 2))

    return ExecutionPreflightResponse(
        can_submit=len(blocking_reasons) == 0,
        max_safe_input_raw=max_safe_input_raw,
        expected_out_usd=round(expected_out_usd, 8),
        impact_bps=impact_bps,
        warnings=warnings,
        blocking_reasons=blocking_reasons,
        liquidity_depth_usd=round(liquidity_depth_usd, 4) if liquidity_depth_usd is not None else None,
    )


@router.post("/state/migrate/local-commitments")
async def migrate_local_commitments(data: LocalCommitmentsMigrationRequest, _caller: str = WalletOwner):
    address = _normalize_address(data.user_address)
    if not address:
        raise HTTPException(status_code=400, detail="user_address is required")

    payload = _load_local_commitments()
    entries = data.commitments if isinstance(data.commitments, dict) else {}
    _, existing_user = _resolve_import_user(payload, address)
    existing_commitments = (
        existing_user.get("commitments")
        if isinstance(existing_user, dict) and isinstance(existing_user.get("commitments"), dict)
        else {}
    )
    merged_commitments, added_count = _merge_commitment_payloads(existing_commitments, entries)

    imported_count = 0
    for rows in entries.values():
        if isinstance(rows, list):
            imported_count += len(rows)

    inferred_preset: str | None = None
    for key in merged_commitments.keys():
        k = str(key).lower()
        if "poold" in k or "hashed" in k:
            inferred_preset = "hashed_claims"
        elif inferred_preset != "hashed_claims" and ("fullprivacy" in k or "poolc" in k):
            inferred_preset = "hidden_flow"
        elif inferred_preset is None and ("shielded" in k or "stealth" in k or "commitment" in k):
            inferred_preset = "unlinkable_basic"

    migrated_at = _now_iso()
    total_count = sum(
        len(rows) for rows in merged_commitments.values() if isinstance(rows, list)
    )
    payload[address] = {
        "user_address": address,
        "imported_at": migrated_at,
        "count": total_count,
        "inferred_preset": inferred_preset,
        "commitments": merged_commitments,
    }
    _save_local_commitments(payload)

    policy_updated = False
    if data.apply_policy_preset and inferred_preset:
        try:
            svc = get_vault_policy_service()
            current = svc.get_policy(address, create_if_missing=True)
            if current and str((current.get("privacy_policy") or {}).get("preset") or "") != inferred_preset:
                svc.put_policy(
                    address,
                    {
                        "privacy_policy": {
                            **(current.get("privacy_policy") or {}),
                            "preset": inferred_preset,
                        }
                    },
                )
                policy_updated = True
        except Exception:
            policy_updated = False

    get_receipt_service().append_proof_receipt(
        user_address=address,
        proof_type="local_commitment_migration",
        threshold_or_model="legacy_localstorage_import_v1",
        result=f"imported:{imported_count}",
        snapshot_hash=None,
    )

    return {
        "user_address": address,
        "imported_count": imported_count,
        "inferred_preset": inferred_preset,
        "policy_updated": policy_updated,
        "migrated_at": migrated_at,
        "note": (
            f"Local commitments merged for backend visibility. Added {added_count} new rows; "
            "on-chain commitments remain canonical."
        ),
    }


@router.post("/state/manual-wallet-event", response_model=ManualWalletEventResponse)
async def state_manual_wallet_event(data: ManualWalletEventRequest, _caller: str = WalletOwner):
    address = _normalize_address(data.user_address)
    if not address or address == "0x0":
        raise HTTPException(status_code=400, detail="user_address is required")

    tx_hash = str(data.tx_hash or "").strip()
    if not tx_hash:
        raise HTTPException(status_code=400, detail="tx_hash is required")

    amount_wei: int | None = None
    if data.amount_wei is not None:
        amount_text = str(data.amount_wei).strip()
        if amount_text:
            try:
                amount_wei = max(0, int(amount_text))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="amount_wei must be an integer string") from exc

    payload = {
        "action_type": data.action_type,
        "venue": str(data.venue or "").strip().lower() or "privacy",
        "execution_path": str(data.execution_path or "").strip() or None,
        "status": data.status,
        "amount_wei": str(amount_wei) if amount_wei is not None else None,
        "asset": str(data.asset or "").strip() or None,
        "capital_source": str(data.capital_source or "").strip().lower() or None,
        "title": str(data.title or "").strip() or None,
        "details": str(data.details or "").strip() or None,
        "tx_hash": tx_hash,
    }
    result = f"event:{json.dumps(payload, separators=(',', ':'), sort_keys=True)}"

    receipt = get_receipt_service().append_proof_receipt(
        user_address=address,
        proof_type="manual_wallet_action",
        threshold_or_model=data.action_type,
        result=result,
        tx_hash=tx_hash,
        pool_id=payload["venue"],
    )
    return ManualWalletEventResponse(
        user_address=address,
        receipt_id=str(receipt.get("receipt_id") or ""),
        tx_hash=tx_hash,
        status=data.status,
    )
