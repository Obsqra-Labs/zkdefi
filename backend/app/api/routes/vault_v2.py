"""
Vault V2 API Routes

Unified vault account management with double-entry ledger, privacy notes,
deposit intents, deploy lifecycle, withdrawals, and sweep operations.
"""

from __future__ import annotations

import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/vault/v2", tags=["vault-v2"])

from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.vault_account_service import VaultAccountService
from app.services.note_store import NoteStore
from app.services.deposit_intent_service import DepositIntentService
from app.services.vault_deploy_service import VaultDeployService
from app.services.withdrawal_service import WithdrawalService
from app.services.sweep_service import SweepService

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
DB_PATH = os.path.join(DATA_DIR, "vault_v2.db")

_ledger = None
_vaults = None
_notes = None
_deposit_svc = None
_deploy_svc = None
_withdrawal_svc = None
_sweep_svc = None


def _get_services():
    global _ledger, _vaults, _notes, _deposit_svc, _deploy_svc, _withdrawal_svc, _sweep_svc
    if _ledger is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        _ledger = DoubleEntryLedger(DB_PATH)
        _vaults = VaultAccountService(DB_PATH)
        _notes = NoteStore(DB_PATH)
        _deposit_svc = DepositIntentService(
            ledger=_ledger, vaults=_vaults, notes=_notes, db_path=DB_PATH
        )
        _deploy_svc = VaultDeployService(ledger=_ledger, db_path=DB_PATH)
        _withdrawal_svc = WithdrawalService(ledger=_ledger, db_path=DB_PATH)
        _sweep_svc = SweepService(ledger=_ledger, notes=_notes)
    return _ledger, _vaults, _notes, _deposit_svc, _deploy_svc, _withdrawal_svc, _sweep_svc


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class CreateAccountRequest(BaseModel):
    owner_address: str
    mode: str = "OPERATOR_MANAGED"


class DepositIntentRequest(BaseModel):
    vault_id: str
    amount_wei: str
    token: str = "STRK"
    rail: str = "NULLIFIER_SET"
    idempotency_key: Optional[str] = None


class DepositConfirmRequest(BaseModel):
    intent_id: str
    tx_hash: str
    commitment_hash: str


class DeployIntentRequest(BaseModel):
    vault_id: str
    adapters: List[str]
    amounts: List[str]
    token: str = "STRK"
    idempotency_key: Optional[str] = None


class DeployCommitRequest(BaseModel):
    proposal_hash: str
    tx_hash: str


class DeploySettleRequest(BaseModel):
    proposal_hash: str
    tx_hash: str


class WithdrawRequest(BaseModel):
    vault_id: str
    amount_wei: str
    token: str = "STRK"
    destination: str
    route: str = "DIRECT_TRANSFER"
    idempotency_key: Optional[str] = None


class SweepToLedgerRequest(BaseModel):
    vault_id: str
    note_id: str
    amount_wei: str
    token: str = "STRK"
    idempotency_key: Optional[str] = None


class SweepToVaultRequest(BaseModel):
    vault_id: str
    amount_wei: str
    token: str = "STRK"
    target_rail: str
    idempotency_key: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/account")
def create_or_get_account(req: CreateAccountRequest):
    _, vaults, *_ = _get_services()
    try:
        return vaults.get_vault_by_address(req.owner_address)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{vault_id}/balance")
def get_balance(vault_id: str):
    ledger, vaults, *_ = _get_services()
    vault = vaults.get_vault(vault_id)
    if vault is None:
        raise HTTPException(status_code=404, detail=f"Vault {vault_id} not found")

    tokens = ["STRK", "ETH", "USDC"]
    available: dict = {}
    pending: dict = {}
    by_token: dict = {}

    for token in tokens:
        summary = ledger.vault_summary(vault_id, token)
        if summary["available"] or summary["pending"] or summary["deployed"]:
            available[token] = summary["available"]
            pending[token] = summary["pending"]
            by_token[token] = summary

    return {
        "vault_id": vault_id,
        "available": available,
        "pending": pending,
        "by_token": by_token,
    }


@router.post("/deposit/intent")
def create_deposit_intent(req: DepositIntentRequest):
    _, _, _, deposit_svc, *_ = _get_services()
    idem = req.idempotency_key or uuid.uuid4().hex
    try:
        return deposit_svc.create_intent(
            vault_id=req.vault_id,
            amount_wei=int(req.amount_wei),
            token=req.token,
            rail=req.rail,
            idempotency_key=idem,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/deposit/confirm")
def confirm_deposit(req: DepositConfirmRequest):
    _, _, _, deposit_svc, *_ = _get_services()
    try:
        return deposit_svc.confirm_deposit(
            intent_id=req.intent_id,
            tx_hash=req.tx_hash,
            commitment_hash=req.commitment_hash,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{vault_id}/notes")
def list_notes(vault_id: str, status: Optional[str] = None):
    _, vaults, notes, *_ = _get_services()
    vault = vaults.get_vault(vault_id)
    if vault is None:
        raise HTTPException(status_code=404, detail=f"Vault {vault_id} not found")
    return notes.list_notes(vault_id, status=status)


@router.post("/deploy/intent")
def create_deploy_intent(req: DeployIntentRequest):
    _, _, _, _, deploy_svc, *_ = _get_services()
    idem = req.idempotency_key or uuid.uuid4().hex
    try:
        amounts_int = [int(a) for a in req.amounts]
        return deploy_svc.create_deploy_intent(
            vault_id=req.vault_id,
            adapters=req.adapters,
            amounts=amounts_int,
            token=req.token,
            idempotency_key=idem,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/deploy/commit")
def deploy_commit(req: DeployCommitRequest):
    _, _, _, _, deploy_svc, *_ = _get_services()
    try:
        deploy_svc.mark_committed(req.proposal_hash, req.tx_hash)
        return {"status": "COMMITTED", "proposal_hash": req.proposal_hash}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/deploy/settle")
def deploy_settle(req: DeploySettleRequest):
    _, _, _, _, deploy_svc, *_ = _get_services()
    try:
        deploy_svc.settle_execution(req.proposal_hash, req.tx_hash)
        return {"status": "EXECUTED", "proposal_hash": req.proposal_hash}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/withdraw/request")
def request_withdrawal(req: WithdrawRequest):
    *_, withdrawal_svc, _ = _get_services()
    idem = req.idempotency_key or uuid.uuid4().hex
    try:
        return withdrawal_svc.request_withdrawal(
            vault_id=req.vault_id,
            amount_wei=int(req.amount_wei),
            token=req.token,
            destination=req.destination,
            route=req.route,
            idempotency_key=idem,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sweep/to-ledger")
def sweep_to_ledger(req: SweepToLedgerRequest):
    *_, sweep_svc = _get_services()
    idem = req.idempotency_key or uuid.uuid4().hex
    try:
        return sweep_svc.sweep_to_ledger(
            vault_id=req.vault_id,
            note_id=req.note_id,
            amount_wei=int(req.amount_wei),
            token=req.token,
            idempotency_key=idem,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sweep/to-vault")
def sweep_to_vault(req: SweepToVaultRequest):
    *_, sweep_svc = _get_services()
    idem = req.idempotency_key or uuid.uuid4().hex
    try:
        return sweep_svc.sweep_to_vault(
            vault_id=req.vault_id,
            amount_wei=int(req.amount_wei),
            token=req.token,
            target_rail=req.target_rail,
            idempotency_key=idem,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/zkd/portfolio/{address}")
async def get_zkd_portfolio(address: str, refresh: bool = False):
    """
    Live zkdETH/zkdAI portfolio: on-chain balances (Starknet Sepolia node) +
    LP position summaries from market-maker-sim data.
    """
    from app.services.zkd_lp_reader import get_zkd_portfolio as _read_portfolio
    portfolio = await _read_portfolio(address, force_refresh=refresh)
    return portfolio.to_dict()


@router.get("/yield-chart")
async def get_yield_chart(days: int = 30):
    """
    Yield performance chart — aggregated from strategy_performance.json.
    Returns daily cumulative yield % and APY bps for the chart.
    """
    import json as _json
    import math
    from datetime import datetime, timedelta, timezone
    from pathlib import Path as _Path

    perf_file = _Path(__file__).resolve().parents[3] / "data" / "strategy_performance.json"
    raw: list[dict] = []
    if perf_file.exists():
        try:
            raw = _json.loads(perf_file.read_text())
            if not isinstance(raw, list):
                raw = []
        except Exception:
            raw = []

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    # Build daily buckets
    daily: dict[str, list[float]] = {}
    for snap in raw:
        ts_str = snap.get("timestamp") or snap.get("created_at") or ""
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            continue
        if ts < cutoff:
            continue
        day_key = ts.strftime("%Y-%m-%d")
        apy = snap.get("apy_bps", snap.get("apy", 0))
        if isinstance(apy, (int, float)) and not math.isnan(apy):
            daily.setdefault(day_key, []).append(float(apy))

    # If no real data, synthesise a plausible yield curve from current known APYs
    if not daily:
        base_apy_bps = 420  # 4.2% baseline
        points = []
        cumulative = 0.0
        for i in range(days):
            day = (cutoff + timedelta(days=i + 1)).strftime("%Y-%m-%d")
            ts = (cutoff + timedelta(days=i + 1)).isoformat()
            import random
            daily_yield = (base_apy_bps / 365) / 100
            noise = random.gauss(0, daily_yield * 0.15)
            daily_yield = max(0, daily_yield + noise)
            cumulative += daily_yield * 100
            points.append({
                "date": day,
                "timestamp": ts,
                "cumulative_yield": round(cumulative, 4),
                "apy_bps": base_apy_bps,
            })
        return {"points": points, "source": "synthesised", "days": days}

    points = []
    cumulative = 0.0
    for day_key in sorted(daily.keys()):
        avg_apy = sum(daily[day_key]) / len(daily[day_key])
        daily_yield = (avg_apy / 365) / 100
        cumulative += daily_yield * 100
        points.append({
            "date": day_key,
            "timestamp": f"{day_key}T00:00:00+00:00",
            "cumulative_yield": round(cumulative, 4),
            "apy_bps": int(avg_apy),
        })

    return {"points": points, "source": "strategy_performance", "days": days}


@router.get("/{vault_id}/receipts")
def list_receipts(vault_id: str):
    ledger, vaults, *_ = _get_services()
    vault = vaults.get_vault(vault_id)
    if vault is None:
        raise HTTPException(status_code=404, detail=f"Vault {vault_id} not found")

    tokens = ["STRK", "ETH", "USDC"]
    all_entries = []
    seen_ids = set()
    for token in tokens:
        for acct_prefix in ("VAULT_AVAILABLE", "VAULT_PENDING"):
            account = f"{acct_prefix}:{vault_id}:{token}"
            for entry in ledger.entries(account, limit=200):
                if entry["entry_id"] not in seen_ids:
                    seen_ids.add(entry["entry_id"])
                    all_entries.append(entry)

    all_entries.sort(key=lambda e: e["created_at"], reverse=True)
    return all_entries
