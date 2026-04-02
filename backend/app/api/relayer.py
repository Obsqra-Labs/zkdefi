"""
Relayer API and queue state helpers.

Supports:
- Tier-2 relayed withdraw queue
- Tier-3 relayed deposit queue
- Tier-2H claim payout queue
- Internal ledger withdraw queue

Also exposes helper functions used by `app.services.relayer_runner`.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field

from app.services.ledger_service import get_ledger_service

router = APIRouter(prefix="/relayer", tags=["relayer"])

_STATE_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "relayer_state.json"
_STATE_LOCK = threading.RLock()
_STATE: dict[str, Any] = {}


def _norm_addr(addr: str) -> str:
    text = str(addr or "").strip()
    try:
        if text.startswith(("0x", "0X")):
            return hex(int(text, 16)).lower()
        return hex(int(text)).lower()
    except Exception:
        return text.lower()


def _default_state() -> dict[str, Any]:
    return {
        "relay_queue": {},
        "deposit_queue": {},
        "claim_queue": {},
        "ledger_withdraw_queue": {},
        "wallet_payout_queue": {},
        "mist_withdraw_queue": {},
        "next_request_id": 1,
        "next_deposit_id": 1,
        "next_claim_id": 1,
        "next_withdraw_id": 1,
        "next_wallet_payout_id": 1,
        "next_mist_id": 1,
    }


def _normalize_state(data: dict[str, Any]) -> dict[str, Any]:
    state = _default_state()
    for key in ("relay_queue", "deposit_queue", "claim_queue", "ledger_withdraw_queue", "wallet_payout_queue", "mist_withdraw_queue"):
        value = data.get(key, {})
        if isinstance(value, dict):
            state[key] = value
    for key in ("next_request_id", "next_deposit_id", "next_claim_id", "next_withdraw_id", "next_wallet_payout_id", "next_mist_id"):
        raw = data.get(key, state[key])
        try:
            parsed = int(raw)
        except Exception:
            parsed = state[key]
        state[key] = parsed if parsed > 0 else state[key]
    return state


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="relayer_state_", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"), sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def reload_state() -> None:
    """Reload queue state from disk."""
    global _STATE
    with _STATE_LOCK:
        if not _STATE_FILE.exists():
            _STATE = _default_state()
            _atomic_write_json(_STATE_FILE, _STATE)
            return
        try:
            data = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
            _STATE = _normalize_state(data)
        except Exception:
            _STATE = _default_state()


def _save_state_locked() -> None:
    _atomic_write_json(_STATE_FILE, _STATE)


def _queue_pending(entry: dict[str, Any]) -> bool:
    return not entry.get("executed", False) and not entry.get("cancelled", False)


def _queue_ready(entry: dict[str, Any]) -> bool:
    if not _queue_pending(entry):
        return False
    ready_time = int(entry.get("ready_time", 0) or 0)
    return int(time.time()) >= ready_time


def _sorted_ready(queue: dict[str, dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    ready = [entry for entry in queue.values() if isinstance(entry, dict) and _queue_ready(entry)]
    ready.sort(key=lambda e: int(e.get("request_time", 0) or 0))
    return ready[: max(0, int(limit))]


def get_ready_relay_requests(limit: int = 20) -> list[dict[str, Any]]:
    with _STATE_LOCK:
        return _sorted_ready(_STATE.get("relay_queue", {}), limit)


def get_ready_deposit_requests(limit: int = 20) -> list[dict[str, Any]]:
    with _STATE_LOCK:
        return _sorted_ready(_STATE.get("deposit_queue", {}), limit)


def get_ready_claim_requests(limit: int = 20) -> list[dict[str, Any]]:
    with _STATE_LOCK:
        return _sorted_ready(_STATE.get("claim_queue", {}), limit)


def get_ready_ledger_withdraw_requests(limit: int = 20) -> list[dict[str, Any]]:
    with _STATE_LOCK:
        return _sorted_ready(_STATE.get("ledger_withdraw_queue", {}), limit)


def get_ready_wallet_payout_requests(limit: int = 20) -> list[dict[str, Any]]:
    with _STATE_LOCK:
        return _sorted_ready(_STATE.get("wallet_payout_queue", {}), limit)


def _mark_executed(queue_key: str, id_key: str, item_id: int, tx_hash: Optional[str] = None) -> None:
    with _STATE_LOCK:
        queue = _STATE.get(queue_key, {})
        key = str(int(item_id))
        if key not in queue:
            return
        entry = queue[key]
        entry["executed"] = True
        entry["status"] = "executed"
        entry["execution_time"] = int(time.time())
        if tx_hash:
            entry["tx_hash"] = tx_hash
        queue[key] = entry
        _STATE[queue_key] = queue
        _save_state_locked()


def _mark_cancelled(queue_key: str, item_id: int, reason: Optional[str] = None) -> None:
    with _STATE_LOCK:
        queue = _STATE.get(queue_key, {})
        key = str(int(item_id))
        if key not in queue:
            raise HTTPException(status_code=404, detail="Request not found")
        entry = queue[key]
        if entry.get("executed"):
            raise HTTPException(status_code=409, detail="Request already executed")
        entry["cancelled"] = True
        entry["status"] = "cancelled"
        entry["cancel_time"] = int(time.time())
        if reason:
            entry["cancel_reason"] = reason
        queue[key] = entry
        _STATE[queue_key] = queue
        _save_state_locked()


def mark_relay_executed(request_id: int, tx_hash: Optional[str] = None) -> None:
    _mark_executed("relay_queue", "request_id", request_id, tx_hash=tx_hash)


def mark_deposit_executed(request_id: int, tx_hash: Optional[str] = None) -> None:
    _mark_executed("deposit_queue", "request_id", request_id, tx_hash=tx_hash)


def mark_claim_executed(request_id: int, tx_hash: Optional[str] = None) -> None:
    _mark_executed("claim_queue", "request_id", request_id, tx_hash=tx_hash)
    ledger = get_ledger_service()
    ledger.mark_claim_executed(int(request_id), tx_hash=tx_hash)


def mark_ledger_withdraw_executed(withdraw_id: int, tx_hash: Optional[str] = None) -> None:
    _mark_executed("ledger_withdraw_queue", "withdraw_id", withdraw_id, tx_hash=tx_hash)


def mark_wallet_payout_executed(payout_id: int, tx_hash: Optional[str] = None) -> None:
    _mark_executed("wallet_payout_queue", "payout_id", payout_id, tx_hash=tx_hash)


def get_ready_mist_withdraw_requests(limit: int = 20) -> list[dict[str, Any]]:
    with _STATE_LOCK:
        return _sorted_ready(_STATE.get("mist_withdraw_queue", {}), limit)


def mark_mist_withdraw_executed(request_id: int, tx_hash: Optional[str] = None) -> None:
    _mark_executed("mist_withdraw_queue", "request_id", request_id, tx_hash=tx_hash)


def _get_user_tier(address: str) -> int:
    """Resolve user tier from reputation module if available, otherwise default to Tier 0."""
    try:
        from app.api.reputation import get_user_data

        user = get_user_data(address)
        return int(user.get("tier", 0))
    except Exception:
        return 0


async def _get_user_tier_for_gating(address: str, base_url: Optional[str] = None) -> int:
    """Resolve tier for relayer gating. Optionally from Risk Profile when available (see docs/GATING_FROM_PROFILE.md)."""
    if base_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(
                    f"{base_url.rstrip('/')}/api/v1/zkdefi/risk_profile/{address}",
                )
                if r.status_code == 200:
                    data = r.json()
                    rep = data.get("reputation")
                    if isinstance(rep, dict) and "tier" in rep:
                        return int(rep["tier"])
        except Exception:
            pass
    return _get_user_tier(address)


async def _get_relayer_gate(address: str, base_url: Optional[str] = None) -> dict[str, Any]:
    """Resolve relayer decision context from Risk Profile v2 when available."""
    tier = _get_user_tier(address)
    mode = "allow" if tier >= 1 else "block"
    reasons = [] if tier >= 1 else ["tier_below_standard"]

    if not base_url:
        return {"tier": tier, "mode": mode, "reason_codes": reasons}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{base_url.rstrip('/')}/api/v1/zkdefi/risk_profile/v2/{address}")
            if r.status_code == 200:
                payload = r.json()
                rep = payload.get("reputation")
                if isinstance(rep, dict) and "tier" in rep:
                    tier = int(rep["tier"])
                decisions = payload.get("decisions")
                if isinstance(decisions, dict):
                    relayer = decisions.get("relayer")
                    if isinstance(relayer, dict):
                        mode = str(relayer.get("mode") or mode)
                        rc = relayer.get("reason_codes")
                        if isinstance(rc, list):
                            reasons = [str(x) for x in rc]
    except Exception:
        pass

    return {"tier": tier, "mode": mode, "reason_codes": reasons}


def _tier_delay_seconds(tier: int) -> int:
    if tier <= 0:
        return 0
    if tier == 1:
        return 3600
    return 0


def _tier_fee_bps(tier: int) -> int:
    if tier <= 0:
        return 100
    if tier == 1:
        return 50
    return 10


class RelayWithdrawRequest(BaseModel):
    requester: str
    nullifier_low: str
    nullifier_high: str
    root_low: str
    root_high: str
    pool_type: int = 1
    proof_calldata: list[str] = Field(default_factory=list)


class RelayDepositRequest(BaseModel):
    requester: str
    commitment_low: str
    commitment_high: str
    amount_wei: str
    pool_type: int = 1


class ClaimPayoutRequest(BaseModel):
    requester: str
    claim_hash: str
    amount_wei: str
    commitment_low: str
    commitment_high: str
    proof_calldata: list[str] = Field(default_factory=list)
    recipient: Optional[str] = None
    claim_salt: Optional[str] = None
    payout_nonce: Optional[str] = None


class LedgerWithdrawRequest(BaseModel):
    requester: str
    commitment_low: str
    commitment_high: str
    amount_wei: str
    asset: str = "STRK"
    proof_calldata: list[str] = Field(default_factory=list)
    reason: str = "tier2h_payout"


class WalletPayoutRequest(BaseModel):
    requester: str
    amount_wei: str
    recipient: str
    asset: str = "STRK"
    reason: str = "ledger_transfer_out_wallet"


class MistWithdrawRequest(BaseModel):
    """Request to relay a MIST Chamber handle_zkp call via the funded relayer account."""
    requester: str
    proof_calldata: list[str] = Field(default_factory=list)


class RelayExecuteRequest(BaseModel):
    request_id: int
    tx_hash: Optional[str] = None


class RelayCancelRequest(BaseModel):
    request_id: int
    reason: Optional[str] = None


def _enqueue(
    queue_key: str,
    id_counter_key: str,
    id_field: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    with _STATE_LOCK:
        item_id = int(_STATE.get(id_counter_key, 1))
        _STATE[id_counter_key] = item_id + 1
        payload[id_field] = item_id
        queue = _STATE.setdefault(queue_key, {})
        queue[str(item_id)] = payload
        _STATE[queue_key] = queue
        _save_state_locked()
        return payload


def enqueue_ledger_withdraw(
    *,
    requester: str,
    commitment_low: str,
    commitment_high: str,
    amount_wei: str,
    proof_calldata: list[str],
    reason: str = "tier2h_payout",
    asset: str = "STRK",
) -> dict[str, Any]:
    now = int(time.time())
    requester_norm = _norm_addr(requester)
    return _enqueue(
        "ledger_withdraw_queue",
        "next_withdraw_id",
        "withdraw_id",
        {
            "requester": requester_norm,
            "commitment_low": commitment_low,
            "commitment_high": commitment_high,
            "amount_wei": amount_wei,
            "asset": asset,
            "proof_calldata": proof_calldata,
            "reason": reason,
            "request_time": now,
            "ready_time": now,
            "executed": False,
            "cancelled": False,
            "status": "pending",
        },
    )


def enqueue_wallet_payout(
    *,
    requester: str,
    amount_wei: str,
    recipient: str,
    asset: str = "STRK",
    reason: str = "ledger_transfer_out_wallet",
) -> dict[str, Any]:
    now = int(time.time())
    requester_norm = _norm_addr(requester)
    recipient_norm = _norm_addr(recipient)
    return _enqueue(
        "wallet_payout_queue",
        "next_wallet_payout_id",
        "payout_id",
        {
            "requester": requester_norm,
            "amount_wei": amount_wei,
            "recipient": recipient_norm,
            "asset": asset,
            "reason": reason,
            "request_time": now,
            "ready_time": now,
            "executed": False,
            "cancelled": False,
            "status": "pending",
        },
    )


def get_pending_outgoing_by_asset(address: str) -> dict[str, int]:
    """
    Sum pending ledger outflows for an address, grouped by asset.
    Includes shielded ledger withdraw queue and wallet payout queue.
    """
    out: dict[str, int] = {}
    addr = _norm_addr(address)
    with _STATE_LOCK:
        for queue_key in ("ledger_withdraw_queue", "wallet_payout_queue"):
            queue = _STATE.get(queue_key, {})
            if not isinstance(queue, dict):
                continue
            for entry in queue.values():
                if not isinstance(entry, dict):
                    continue
                if _norm_addr(str(entry.get("requester") or "")) != addr:
                    continue
                if not _queue_pending(entry):
                    continue
                try:
                    amount = int(str(entry.get("amount_wei") or "0"), 0)
                except Exception:
                    amount = 0
                if amount <= 0:
                    continue
                asset = str(entry.get("asset") or "STRK")
                out[asset] = int(out.get(asset, 0)) + amount
    return out


@router.post("/request")
async def create_withdraw_request(req: RelayWithdrawRequest, request: Request):
    base = str(request.base_url).rstrip("/") if request.base_url else None
    gate = await _get_relayer_gate(req.requester, base)
    tier = int(gate.get("tier", 0))
    if str(gate.get("mode") or "allow") == "block":
        reason = ",".join(gate.get("reason_codes") or [])
        raise HTTPException(status_code=403, detail=f"Relayer withdraw blocked ({reason or 'policy'}).")
    now = int(time.time())
    entry = _enqueue(
        "relay_queue",
        "next_request_id",
        "request_id",
        {
            "tier": tier,
            "decision_mode": gate.get("mode"),
            "decision_reasons": gate.get("reason_codes") or [],
            "requester": req.requester,
            "nullifier_low": req.nullifier_low,
            "nullifier_high": req.nullifier_high,
            "root_low": req.root_low,
            "root_high": req.root_high,
            "pool_type": int(req.pool_type),
            "proof_calldata": req.proof_calldata,
            "request_time": now,
            "ready_time": now + _tier_delay_seconds(tier),
            "fee_bps": _tier_fee_bps(tier),
            "executed": False,
            "cancelled": False,
            "status": "pending",
        },
    )
    return entry


@router.get("/request/{request_id}")
async def get_withdraw_request(request_id: int):
    with _STATE_LOCK:
        entry = _STATE.get("relay_queue", {}).get(str(int(request_id)))
        if not entry:
            raise HTTPException(status_code=404, detail="Request not found")
        status = "ready" if _queue_ready(entry) else "pending"
        if entry.get("executed"):
            status = "executed"
        if entry.get("cancelled"):
            status = "cancelled"
        out = dict(entry)
        out["status"] = status
        return out


@router.post("/deposit/request")
async def create_deposit_request(req: RelayDepositRequest, request: Request):
    base = str(request.base_url).rstrip("/") if request.base_url else None
    gate = await _get_relayer_gate(req.requester, base)
    tier = int(gate.get("tier", 0))
    if str(gate.get("mode") or "allow") == "block":
        reason = ",".join(gate.get("reason_codes") or [])
        raise HTTPException(status_code=403, detail=f"Relayer deposit blocked ({reason or 'policy'}).")
    now = int(time.time())
    entry = _enqueue(
        "deposit_queue",
        "next_deposit_id",
        "request_id",
        {
            "tier": tier,
            "decision_mode": gate.get("mode"),
            "decision_reasons": gate.get("reason_codes") or [],
            "requester": req.requester,
            "commitment_low": req.commitment_low,
            "commitment_high": req.commitment_high,
            "amount_wei": req.amount_wei,
            "pool_type": int(req.pool_type),
            "request_time": now,
            "ready_time": now + _tier_delay_seconds(tier),
            "fee_bps": _tier_fee_bps(tier),
            "executed": False,
            "cancelled": False,
            "status": "pending",
        },
    )
    return entry


@router.get("/deposit/{request_id}")
async def get_deposit_request(request_id: int):
    with _STATE_LOCK:
        entry = _STATE.get("deposit_queue", {}).get(str(int(request_id)))
        if not entry:
            raise HTTPException(status_code=404, detail="Request not found")
        status = "ready" if _queue_ready(entry) else "pending"
        if entry.get("executed"):
            status = "executed"
        if entry.get("cancelled"):
            status = "cancelled"
        out = dict(entry)
        out["status"] = status
        return out


@router.post("/claim/request")
async def create_claim_request(req: ClaimPayoutRequest, request: Request):
    base = str(request.base_url).rstrip("/") if request.base_url else None
    gate = await _get_relayer_gate(req.requester, base)
    tier = int(gate.get("tier", 0))
    if str(gate.get("mode") or "allow") == "block":
        reason = ",".join(gate.get("reason_codes") or [])
        raise HTTPException(status_code=403, detail=f"Relayer claim blocked ({reason or 'policy'}).")
    now = int(time.time())
    entry = _enqueue(
        "claim_queue",
        "next_claim_id",
        "request_id",
        {
            "tier": tier,
            "decision_mode": gate.get("mode"),
            "decision_reasons": gate.get("reason_codes") or [],
            "requester": req.requester,
            "claim_hash": req.claim_hash,
            "claim_salt": req.claim_salt,
            "recipient": req.recipient,
            "amount_wei": req.amount_wei,
            "payout_nonce": req.payout_nonce,
            "commitment_low": req.commitment_low,
            "commitment_high": req.commitment_high,
            "proof_calldata": req.proof_calldata,
            "request_time": now,
            "ready_time": now + _tier_delay_seconds(tier),
            "fee_bps": _tier_fee_bps(tier),
            "executed": False,
            "cancelled": False,
            "status": "pending",
        },
    )
    ledger = get_ledger_service()
    ledger.record_claim_request(entry)
    return entry


@router.get("/claim/{request_id}")
async def get_claim_request(request_id: int):
    with _STATE_LOCK:
        entry = _STATE.get("claim_queue", {}).get(str(int(request_id)))
        if not entry:
            raise HTTPException(status_code=404, detail="Request not found")
        status = "ready" if _queue_ready(entry) else "pending"
        if entry.get("executed"):
            status = "executed"
        if entry.get("cancelled"):
            status = "cancelled"
        out = dict(entry)
        out["status"] = status
        return out


@router.post("/ledger/withdraw/request")
async def create_ledger_withdraw_request(req: LedgerWithdrawRequest):
    entry = enqueue_ledger_withdraw(
        requester=req.requester,
        commitment_low=req.commitment_low,
        commitment_high=req.commitment_high,
        amount_wei=req.amount_wei,
        proof_calldata=req.proof_calldata,
        reason=req.reason,
        asset=req.asset,
    )
    return entry


@router.post("/ledger/payout/request")
async def create_wallet_payout_request(req: WalletPayoutRequest):
    entry = enqueue_wallet_payout(
        requester=req.requester,
        amount_wei=req.amount_wei,
        recipient=req.recipient,
        asset=req.asset,
        reason=req.reason,
    )
    return entry


@router.post("/execute/withdraw")
async def mark_withdraw(request: RelayExecuteRequest):
    mark_relay_executed(request.request_id, tx_hash=request.tx_hash)
    return {"status": "executed", "request_id": request.request_id, "tx_hash": request.tx_hash}


@router.post("/execute/deposit")
async def mark_deposit(request: RelayExecuteRequest):
    mark_deposit_executed(request.request_id, tx_hash=request.tx_hash)
    return {"status": "executed", "request_id": request.request_id, "tx_hash": request.tx_hash}


@router.post("/execute/claim")
async def mark_claim(request: RelayExecuteRequest):
    mark_claim_executed(request.request_id, tx_hash=request.tx_hash)
    return {"status": "executed", "request_id": request.request_id, "tx_hash": request.tx_hash}


@router.post("/execute/ledger-withdraw")
async def mark_ledger_withdraw(request: RelayExecuteRequest):
    mark_ledger_withdraw_executed(request.request_id, tx_hash=request.tx_hash)
    return {"status": "executed", "withdraw_id": request.request_id, "tx_hash": request.tx_hash}


@router.post("/execute/wallet-payout")
async def mark_wallet_payout(request: RelayExecuteRequest):
    mark_wallet_payout_executed(request.request_id, tx_hash=request.tx_hash)
    return {"status": "executed", "payout_id": request.request_id, "tx_hash": request.tx_hash}


@router.post("/cancel/withdraw")
async def cancel_withdraw(request: RelayCancelRequest):
    _mark_cancelled("relay_queue", request.request_id, request.reason)
    return {"status": "cancelled", "request_id": request.request_id}


@router.post("/cancel/deposit")
async def cancel_deposit(request: RelayCancelRequest):
    _mark_cancelled("deposit_queue", request.request_id, request.reason)
    return {"status": "cancelled", "request_id": request.request_id}


@router.post("/cancel/claim")
async def cancel_claim(request: RelayCancelRequest):
    _mark_cancelled("claim_queue", request.request_id, request.reason)
    ledger = get_ledger_service()
    ledger.mark_claim_cancelled(int(request.request_id), reason=request.reason)
    return {"status": "cancelled", "request_id": request.request_id}


@router.post("/cancel/ledger-withdraw")
async def cancel_ledger_withdraw(request: RelayCancelRequest):
    _mark_cancelled("ledger_withdraw_queue", request.request_id, request.reason)
    return {"status": "cancelled", "withdraw_id": request.request_id}


@router.post("/cancel/wallet-payout")
async def cancel_wallet_payout(request: RelayCancelRequest):
    _mark_cancelled("wallet_payout_queue", request.request_id, request.reason)
    return {"status": "cancelled", "payout_id": request.request_id}


# ---------------------------------------------------------------------------
# MIST Chamber relay (execution-privacy: relayer calls handle_zkp, not user)
# ---------------------------------------------------------------------------

_MIST_RELAY_FEE_BPS = int(os.getenv("MIST_RELAY_FEE_BPS", "0"))


@router.post("/mist/withdraw")
async def create_mist_withdraw_request(req: MistWithdrawRequest):
    if not req.proof_calldata:
        raise HTTPException(status_code=400, detail="proof_calldata is required.")
    now = int(time.time())
    entry = _enqueue(
        "mist_withdraw_queue",
        "next_mist_id",
        "request_id",
        {
            "requester": _norm_addr(req.requester),
            "proof_calldata": req.proof_calldata,
            "fee_bps": _MIST_RELAY_FEE_BPS,
            "request_time": now,
            "ready_time": now,
            "executed": False,
            "cancelled": False,
            "status": "pending",
        },
    )
    return entry


@router.get("/mist/status/{request_id}")
async def get_mist_withdraw_status(request_id: int):
    with _STATE_LOCK:
        entry = _STATE.get("mist_withdraw_queue", {}).get(str(int(request_id)))
        if not entry:
            raise HTTPException(status_code=404, detail="Request not found")
        status = "ready" if _queue_ready(entry) else "pending"
        if entry.get("executed"):
            status = "executed"
        if entry.get("cancelled"):
            status = "cancelled"
        out = dict(entry)
        out["status"] = status
        return out


@router.post("/cancel/mist-withdraw")
async def cancel_mist_withdraw(request: RelayCancelRequest):
    _mark_cancelled("mist_withdraw_queue", request.request_id, request.reason)
    return {"status": "cancelled", "request_id": request.request_id}


@router.get("/pending/{address}")
async def pending_for_user(address: str):
    addr = _norm_addr(address)
    with _STATE_LOCK:
        pending_withdraw = [
            r
            for r in _STATE.get("relay_queue", {}).values()
            if isinstance(r, dict) and _norm_addr(str(r.get("requester") or "")) == addr and _queue_pending(r)
        ]
        pending_deposit = [
            r
            for r in _STATE.get("deposit_queue", {}).values()
            if isinstance(r, dict) and _norm_addr(str(r.get("requester") or "")) == addr and _queue_pending(r)
        ]
        pending_claim = [
            r
            for r in _STATE.get("claim_queue", {}).values()
            if isinstance(r, dict) and _norm_addr(str(r.get("requester") or "")) == addr and _queue_pending(r)
        ]
        pending_ledger_withdraw = [
            r
            for r in _STATE.get("ledger_withdraw_queue", {}).values()
            if isinstance(r, dict) and _norm_addr(str(r.get("requester") or "")) == addr and _queue_pending(r)
        ]
        pending_wallet_payout = [
            r
            for r in _STATE.get("wallet_payout_queue", {}).values()
            if isinstance(r, dict) and _norm_addr(str(r.get("requester") or "")) == addr and _queue_pending(r)
        ]
        pending_mist_withdraw = [
            r
            for r in _STATE.get("mist_withdraw_queue", {}).values()
            if isinstance(r, dict) and _norm_addr(str(r.get("requester") or "")) == addr and _queue_pending(r)
        ]
    return {
        "address": address,
        "withdraw_pending": len(pending_withdraw),
        "deposit_pending": len(pending_deposit),
        "claim_pending": len(pending_claim),
        "ledger_withdraw_pending": len(pending_ledger_withdraw),
        "wallet_payout_pending": len(pending_wallet_payout),
        "mist_withdraw_pending": len(pending_mist_withdraw),
        "requests": {
            "withdraw": pending_withdraw,
            "deposit": pending_deposit,
            "claim": pending_claim,
            "ledger_withdraw": pending_ledger_withdraw,
            "wallet_payout": pending_wallet_payout,
            "mist_withdraw": pending_mist_withdraw,
        },
    }


@router.get("/ledger/claims")
async def list_ledger_claims(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    ledger = get_ledger_service()
    return {"claims": ledger.list_claims(status=status, limit=limit, offset=offset)}


@router.get("/ledger/events")
async def list_ledger_events(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    request_id: Optional[int] = Query(None),
):
    ledger = get_ledger_service()
    return {"events": ledger.list_events(limit=limit, offset=offset, request_id=request_id)}


@router.get("/stats")
async def get_relayer_stats():
    with _STATE_LOCK:
        relay_queue = _STATE.get("relay_queue", {})
        deposit_queue = _STATE.get("deposit_queue", {})
        claim_queue = _STATE.get("claim_queue", {})
        ledger_withdraw_queue = _STATE.get("ledger_withdraw_queue", {})
        wallet_payout_queue = _STATE.get("wallet_payout_queue", {})

        withdraw_pending = sum(1 for e in relay_queue.values() if isinstance(e, dict) and _queue_pending(e))
        deposit_pending = sum(1 for e in deposit_queue.values() if isinstance(e, dict) and _queue_pending(e))
        claim_pending = sum(1 for e in claim_queue.values() if isinstance(e, dict) and _queue_pending(e))
        ledger_withdraw_pending = sum(
            1 for e in ledger_withdraw_queue.values() if isinstance(e, dict) and _queue_pending(e)
        )
        wallet_payout_pending = sum(
            1 for e in wallet_payout_queue.values() if isinstance(e, dict) and _queue_pending(e)
        )
        mist_withdraw_queue = _STATE.get("mist_withdraw_queue", {})
        mist_withdraw_pending = sum(
            1 for e in mist_withdraw_queue.values() if isinstance(e, dict) and _queue_pending(e)
        )

        withdraw_executed = sum(1 for e in relay_queue.values() if isinstance(e, dict) and e.get("executed"))
        deposit_executed = sum(1 for e in deposit_queue.values() if isinstance(e, dict) and e.get("executed"))
        claim_executed = sum(1 for e in claim_queue.values() if isinstance(e, dict) and e.get("executed"))
        mist_withdraw_executed = sum(1 for e in mist_withdraw_queue.values() if isinstance(e, dict) and e.get("executed"))

    return {
        "relayer_address": os.getenv("RELAYER_ADDRESS"),
        "withdraw_pending": withdraw_pending,
        "deposit_pending": deposit_pending,
        "claim_pending": claim_pending,
        "ledger_withdraw_pending": ledger_withdraw_pending,
        "wallet_payout_pending": wallet_payout_pending,
        "mist_withdraw_pending": mist_withdraw_pending,
        "withdraw_executed": withdraw_executed,
        "deposit_executed": deposit_executed,
        "claim_executed": claim_executed,
        "mist_withdraw_executed": mist_withdraw_executed,
        "total_requests": (
            withdraw_pending
            + withdraw_executed
            + deposit_pending
            + deposit_executed
            + claim_pending
            + claim_executed
            + ledger_withdraw_pending
            + wallet_payout_pending
            + mist_withdraw_pending
            + mist_withdraw_executed
        ),
    }


# Ensure state is initialized on import.
reload_state()
