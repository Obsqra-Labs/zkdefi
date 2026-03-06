"""Unified privacy action routes (policy-compiled)."""

from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.ekubo_config import EKUBO_ROUTER_SEPOLIA, get_ekubo_chain_id
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.policy_compiler_service import get_policy_compiler_service
from app.services.receipt_service import get_receipt_service

router = APIRouter(prefix="/privacy", tags=["privacy"])


class PrivacyActionRequest(BaseModel):
    user_address: str
    amount: str
    token: str
    shared_pool_id: str | None = None
    member_address: str | None = None
    execution_intent: Literal["manual_wallet", "orchestrated", "autonomous", "session"] = "manual_wallet"
    wallet_connected: bool = False
    execution_mode: Literal["wallet", "orchestrated", "auto"] = "auto"
    execute_now: bool = False
    venue: str = "ekubo"
    withdraw_source: Literal["vault", "ai_pool"] | None = None
    extra_context: dict[str, Any] = Field(default_factory=dict)
    provided_proofs: dict[str, str] = Field(default_factory=dict)



def _enabled() -> bool:
    return os.getenv("PRIVACY_UNIFIED_ROUTES_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}


async def _run_action(action_type: Literal["deposit", "withdraw"], data: PrivacyActionRequest):
    compile_input = {
        "user_address": data.user_address,
        "member_address": data.member_address or data.user_address,
        "shared_pool_id": data.shared_pool_id,
        "action_type": action_type,
        "execution_intent": data.execution_intent,
        "wallet_connected": data.wallet_connected,
        "context": {
            "token_in": data.token if action_type == "deposit" else None,
            "token_out": data.token if action_type == "withdraw" else None,
            "amount": data.amount,
            "venue": data.venue,
            **(({"withdraw_source": data.withdraw_source} if data.withdraw_source else {})),
            **(data.extra_context or {}),
        },
    }
    compiled = get_policy_compiler_service().compile(compile_input)
    can_execute = bool(compiled.get("can_execute", False))
    required_proofs = [str(item) for item in (compiled.get("required_proofs") or []) if str(item).strip()]
    provided_proofs = data.provided_proofs or {}
    missing_required_proofs = [proof for proof in required_proofs if not str(provided_proofs.get(proof, "")).strip()]
    proof_gate_passed = can_execute and len(missing_required_proofs) == 0
    chain_id = get_ekubo_chain_id()

    receipt = get_receipt_service().append_proof_receipt(
        user_address=data.member_address or data.user_address,
        proof_type=f"privacy_{action_type}_compile",
        threshold_or_model="policy_compiler_v1",
        result="pass" if can_execute else "blocked",
        snapshot_hash=compiled.get("effective_policy_hash"),
        pool_id=data.shared_pool_id,
        withdraw_source=data.withdraw_source,
    )

    if data.execution_mode == "wallet":
        mode: Literal["wallet", "orchestrated"] = "wallet"
    elif data.execution_mode == "orchestrated":
        mode = "orchestrated"
    else:
        mode = "wallet" if data.wallet_connected else "orchestrated"

    approvals: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    execution_warnings: list[str] = []
    if not proof_gate_passed:
        if not can_execute:
            execution_warnings.append("policy_gate_blocked")
        if missing_required_proofs:
            execution_warnings.append("missing_required_proofs")

    if data.execute_now and not proof_gate_passed:
        raise HTTPException(
            status_code=403,
            detail={
                "message": "proof gate failed",
                "can_execute": can_execute,
                "missing_required_proofs": missing_required_proofs,
                "blocking_reasons": compiled.get("blocking_reasons") or [],
                "required_proofs": required_proofs,
            },
        )

    if data.execute_now and mode == "wallet":
        token_in = str((data.extra_context or {}).get("token_in") or data.token or "").strip()
        token_out = str((data.extra_context or {}).get("token_out") or data.token or "").strip()
        try:
            amount_in = int(str((data.extra_context or {}).get("amount_in") or data.amount))
        except ValueError:
            amount_in = 0

        if not chain_id:
            execution_warnings.append("execute_now_chain_unavailable")
        elif not token_in or not token_out or amount_in <= 0:
            execution_warnings.append("execute_now_requires_swap_context_v1")
        elif token_in == token_out:
            execution_warnings.append("execute_now_same_token_noop_v1")
        else:
            swap = await build_swap_calldata(
                chain_id=chain_id,
                token_in=token_in,
                token_out=token_out,
                amount_in_wei=amount_in,
                slippage_bps=50,
            )
            if swap.get("error"):
                execution_warnings.append(str(swap.get("error")))
            else:
                approvals.append(
                    {
                        "token": token_in,
                        "spender": str(swap.get("contract_address") or EKUBO_ROUTER_SEPOLIA),
                        "amount": str(amount_in),
                    }
                )
                calls.append(
                    {
                        "contract_address": str(swap.get("contract_address") or EKUBO_ROUTER_SEPOLIA),
                        "entrypoint": str(swap.get("entrypoint") or "swap"),
                        "calldata": [str(x) for x in (swap.get("calldata") or [])],
                    }
                )

    response = {
        "action": action_type,
        "advisory_only": bool(compiled.get("advisory_only", False)),
        "can_execute": can_execute,
        "path_label": compiled.get("execution_path"),
        "required_proofs": required_proofs,
        "missing_required_proofs": missing_required_proofs,
        "proof_gate_passed": proof_gate_passed,
        "requires_relayer": bool(compiled.get("requires_relayer", False)),
        "warnings": compiled.get("warnings") or [],
        "blocking_reasons": compiled.get("blocking_reasons") or [],
        "legacy_preset_label": compiled.get("legacy_preset_label"),
        "effective_policy_hash": compiled.get("effective_policy_hash"),
        "receipt_id": receipt.get("receipt_id"),
        "execution_ready": proof_gate_passed and compiled.get("execution_path") != "internal_ledger",
        "execution_mode": mode,
        "approvals": approvals,
        "calls": calls,
        "withdraw_source": data.withdraw_source,
    }

    if compiled.get("execution_path") == "internal_ledger":
        response["execution_ready"] = False
        response.setdefault("warnings", []).append("internal_ledger_not_available_v1")
    if execution_warnings:
        response.setdefault("warnings", []).extend(execution_warnings)

    return response


@router.post("/deposit")
async def privacy_deposit(data: PrivacyActionRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="privacy unified routes disabled")
    try:
        return await _run_action("deposit", data)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/withdraw")
async def privacy_withdraw(data: PrivacyActionRequest):
    if not _enabled():
        raise HTTPException(status_code=404, detail="privacy unified routes disabled")
    try:
        return await _run_action("withdraw", data)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
