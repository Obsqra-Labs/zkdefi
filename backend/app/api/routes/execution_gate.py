"""
Stable execution gate API for the mainnet-v1 `/portfolio` lane.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.portfolio_execution_gate import get_portfolio_execution_gate_service
from app.services.execution_policy_service import get_execution_policy_service

router = APIRouter(tags=["execution-gate"])
service = get_portfolio_execution_gate_service()
policy_service = get_execution_policy_service()


class RebalanceDelta(BaseModel):
    from_asset: str
    to_asset: str
    value_usd: float = Field(..., ge=0)


class ActionIntentRequest(BaseModel):
    type: Literal["swap", "rebalance"]
    network_id: str = "starknet_mainnet"
    token_in: str | None = None
    token_out: str | None = None
    amount_wei: int | None = Field(default=None, ge=0)
    deadline: int | None = Field(default=None, ge=0)
    nonce: int | None = Field(default=None, ge=0)
    block_number: int | None = Field(default=None, ge=0)
    max_slippage_bps: int = Field(default=50, ge=0, le=5_000)
    route_hash: str | None = None
    adapter_target: str = "ekubo"
    target_allocations: dict[str, float] | None = None
    delta_list: list[RebalanceDelta] | None = None
    execute_live: bool = False
    allow_advisory_override: bool = False
    session_key_id: str | None = None


class GateCheckRequest(BaseModel):
    owner_address: str
    portfolio_id: str | None = None
    intent: ActionIntentRequest
    policy_snapshot: dict[str, Any] | None = None
    prepare_preview: bool = False


class ReceiptConfirmRequest(BaseModel):
    owner_address: str
    receipt_id: str
    tx_hash: str


class PolicyUpdateRequest(BaseModel):
    paused: bool | None = None
    max_value_per_action_usd: float | None = Field(default=None, ge=0)
    max_slippage_bps: int | None = Field(default=None, ge=0, le=5_000)
    cooldown_seconds: int | None = Field(default=None, ge=0, le=86_400)
    max_swaps_per_rebalance: int | None = Field(default=None, ge=1, le=10)
    min_amounts: dict[str, float] | None = None


@router.get("/policy/{owner_address}")
async def get_execution_gate_policy(owner_address: str) -> dict[str, Any]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return await service.get_policy_snapshot(owner_address)


@router.put("/policy/{owner_address}")
async def put_execution_gate_policy(owner_address: str, body: PolicyUpdateRequest) -> dict[str, Any]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    before_snapshot = await service.get_policy_snapshot(owner_address)
    current = policy_service.get_policy(owner_address).data
    exec_rules = dict(current.get("executionRules", {}))
    if body.max_value_per_action_usd is not None:
        exec_rules["dailyLimitUSD"] = body.max_value_per_action_usd
    if body.max_slippage_bps is not None:
        exec_rules["maxSlippageBps"] = body.max_slippage_bps
    if body.cooldown_seconds is not None:
        exec_rules["cooldownSeconds"] = body.cooldown_seconds
    if body.max_swaps_per_rebalance is not None:
        exec_rules["maxSwapsPerRebalance"] = body.max_swaps_per_rebalance
    if body.min_amounts is not None:
        exec_rules["minAmounts"] = body.min_amounts

    updated = policy_service.set_policy(
        owner_address,
        {
            **current,
            "executionRules": exec_rules,
            "isActive": not bool(body.paused) if body.paused is not None else current.get("isActive", True),
        },
    )
    snapshot = await service.get_policy_snapshot(owner_address)
    receipt = await service.record_policy_update_receipt(
        owner_address,
        before=before_snapshot,
        after=snapshot,
    )
    return {"policy": updated.data, "snapshot": snapshot, "receipt_id": receipt["receipt_id"]}


@router.get("/receipts/{owner_address}")
async def get_execution_gate_receipts(owner_address: str) -> list[dict[str, Any]]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return await service.get_gate_receipts(owner_address)


@router.get("/recommendation/{owner_address}")
async def get_execution_gate_recommendation(owner_address: str) -> dict[str, Any]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return await service.recommend(owner_address)


@router.get("/readiness/{network_id}")
async def get_execution_gate_readiness(network_id: str) -> dict[str, Any]:
    return service.get_executor_readiness(network_id)


@router.get("/telemetry/{owner_address}")
async def get_execution_gate_telemetry(owner_address: str) -> dict[str, Any]:
    if not owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return await service.get_telemetry_summary(owner_address)


@router.post("/check")
async def check_execution_gate(request: GateCheckRequest) -> dict[str, Any]:
    if not request.owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    return await service.check_intent(
        request.owner_address,
        request.intent.model_dump(exclude_none=True),
        portfolio_id=request.portfolio_id,
        policy_override=request.policy_snapshot,
        persist=True,
        prepare_preview=request.prepare_preview,
    )


@router.post("/execute")
async def execute_execution_gate(request: GateCheckRequest) -> dict[str, Any]:
    if not request.owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    intent = request.intent.model_dump(exclude_none=True)
    return await service.execute_intent(
        request.owner_address,
        intent,
        portfolio_id=request.portfolio_id,
        policy_override=request.policy_snapshot,
        execute_live=bool(intent.get("execute_live")),
    )


@router.post("/confirm")
async def confirm_execution_gate_receipt(request: ReceiptConfirmRequest) -> dict[str, Any]:
    if not request.owner_address.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Address must start with 0x")
    if not request.receipt_id.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Receipt ID must start with 0x")
    if not request.tx_hash.strip().startswith("0x"):
        raise HTTPException(status_code=400, detail="Tx hash must start with 0x")
    try:
        return await service.confirm_wallet_execution_receipt(
            request.owner_address,
            request.receipt_id,
            request.tx_hash,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
