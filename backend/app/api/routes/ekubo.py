"""Canonical Ekubo routes for swap + LP operations."""

from __future__ import annotations

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
import httpx
from pydantic import BaseModel, Field
from starknet_py.hash.selector import get_selector_from_name

from app.services.contract_executor import ContractExecutor
from app.services.ekubo_config import (
    EKUBO_CORE_SEPOLIA,
    EKUBO_POSITIONS_SEPOLIA,
    EKUBO_ROUTER_SEPOLIA,
    SEPOLIA_FUSDC,
    SEPOLIA_STRK,
    SEPOLIA_USDC,
    SEPOLIA_ETH,
    get_ekubo_chain_id,
)
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.ekubo_lp_service import (
    build_collect_fees,
    build_lp_add,
    build_lp_remove,
    import_onchain_positions,
    list_positions,
    preview_lp_position,
    purge_stale_positions,
    sync_onchain_balance,
    update_position_status,
    verify_tx_and_extract_nft_id,
)
from app.services.receipt_service import get_receipt_service

router = APIRouter(prefix="/ekubo", tags=["ekubo"])
logger = logging.getLogger(__name__)

STARKNET_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia-rpc.publicnode.com")
BALANCE_OF_SELECTORS: tuple[str, ...] = (
    # Legacy selector used by existing integrations.
    "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
    # Canonical Starknet selector.
    hex(get_selector_from_name("balance_of")),
)

_TOKEN_DECIMALS: dict[str, int] = {
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18,
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18,
    "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": 6,
    "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": 6,
}

_TOKEN_SYMBOLS: dict[str, str] = {
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
    "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": "USDC",
    "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": "fUSDC",
}


ExecutionMode = Literal["wallet", "orchestrated"]
ExecutionModeRequest = Literal["wallet", "orchestrated", "auto"]
RiskProfile = Literal["conservative", "neutral", "aggressive"]


class SwapQuoteRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str
    slippage_bps: int = Field(default=9500, ge=0, le=10000)
    taker_address: str | None = None


class SwapQuoteResponse(BaseModel):
    expected_out: str
    min_out: str
    price_impact_bps: int
    route: list[str]
    expires_at: str
    warnings: list[str] = Field(default_factory=list)


class ContractCall(BaseModel):
    contract_address: str
    entrypoint: str
    calldata: list[str]


class ApprovalCall(BaseModel):
    token: str
    spender: str
    amount: str


class BuildTxResponse(BaseModel):
    execution_mode: ExecutionMode
    approvals: list[ApprovalCall]
    calls: list[ContractCall]
    receipt_id: str | None = None
    warnings: list[str] = Field(default_factory=list)


class SwapBuildRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str
    slippage_bps: int = Field(default=9500, ge=0, le=10000)
    taker_address: str | None = None
    user_address: str | None = None
    execution_mode: ExecutionModeRequest = "auto"
    wallet_connected: bool = False


class LpPreviewRequest(BaseModel):
    token0: str
    token1: str
    amount0: str
    amount1: str
    fee_tier: int
    lower_tick: int | None = None
    upper_tick: int | None = None
    risk_profile: RiskProfile | None = None


class LpPreviewResponse(BaseModel):
    lower_tick: int
    upper_tick: int
    current_tick: int | None = None
    single_sided_expected: bool = False
    single_sided_side: str = "none"
    estimated_share: str
    estimated_fees_apr: float
    warnings: list[str]


class LpBuildRequest(BaseModel):
    token0: str
    token1: str
    amount0: str
    amount1: str
    fee_tier: int
    lower_tick: int | None = None
    upper_tick: int | None = None
    risk_profile: RiskProfile | None = None
    owner: str | None = None
    execution_mode: ExecutionModeRequest = "auto"
    wallet_connected: bool = False


class LpBuildResponse(BuildTxResponse):
    position_id: str | None = None
    warnings: list[str] = Field(default_factory=list)


class LpRemoveBuildRequest(BaseModel):
    owner: str
    position_id: str
    liquidity_bps: int = Field(default=10_000, ge=1, le=10_000)
    execution_mode: ExecutionModeRequest = "auto"
    wallet_connected: bool = False


class PositionsResponse(BaseModel):
    owner: str
    positions: list[dict[str, Any]]
    count: int


def _fallback_swap_quote(
    token_in: str,
    token_out: str,
    amount_in: int,
    slippage_bps: int,
) -> SwapQuoteResponse:
    # Conservative fallback quote when Ekubo pool API is unavailable.
    # Keeps UX/action flow alive while preserving a realistic safety haircut.
    expected_out = max(1, int(amount_in * 0.995))
    min_out = int(expected_out * (1 - (slippage_bps / 10_000)))
    amount_norm = amount_in / 1e18
    price_impact_bps = int(min(2500, max(25, amount_norm * 10)))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=20)).isoformat()
    return SwapQuoteResponse(
        expected_out=str(expected_out),
        min_out=str(max(0, min_out)),
        price_impact_bps=price_impact_bps,
        route=[token_in, EKUBO_ROUTER_SEPOLIA, token_out],
        expires_at=expires_at,
    )


def _normalize_hex_addr(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    without_prefix = raw[2:] if raw.startswith("0x") else raw
    stripped = without_prefix.lstrip("0")
    return f"0x{stripped or '0'}"


def _token_decimals(token_addr: str) -> int:
    return _TOKEN_DECIMALS.get(_normalize_hex_addr(token_addr), 18)


def _token_symbol(token_addr: str) -> str:
    return _TOKEN_SYMBOLS.get(_normalize_hex_addr(token_addr), "token")


def _format_units(amount_raw: int, decimals: int) -> str:
    if amount_raw <= 0:
        return "0"
    whole = amount_raw // (10**decimals)
    frac = amount_raw % (10**decimals)
    if decimals == 0:
        return str(whole)
    frac_text = str(frac).rjust(decimals, "0").rstrip("0")
    return f"{whole}.{frac_text}" if frac_text else str(whole)


async def _read_erc20_balance(token_address: str, owner: str) -> int | None:
    token = _normalize_hex_addr(token_address)
    user = _normalize_hex_addr(owner)
    if not token or token == "0x0" or not user or user == "0x0":
        return None

    async with httpx.AsyncClient(timeout=10.0) as client:
        for selector in BALANCE_OF_SELECTORS:
            payload = {
                "jsonrpc": "2.0",
                "method": "starknet_call",
                "params": {
                    "request": {
                        "contract_address": token,
                        "entry_point_selector": selector,
                        "calldata": [user],
                    },
                    "block_id": "latest",
                },
                "id": 1,
            }
            try:
                response = await client.post(STARKNET_RPC_URL, json=payload)
                data = response.json()
            except Exception:
                continue

            result = data.get("result")
            if not isinstance(result, list) or len(result) == 0:
                continue

            try:
                if len(result) == 1:
                    low = int(str(result[0]), 16) if str(result[0]).startswith("0x") else int(str(result[0]))
                    return max(0, low)
                low = int(str(result[0]), 16) if str(result[0]).startswith("0x") else int(str(result[0]))
                high = int(str(result[1]), 16) if str(result[1]).startswith("0x") else int(str(result[1]))
                return max(0, low + (high << 128))
            except Exception:
                continue
    return None


def _amount_to_units(amount_raw: int, decimals: int) -> float:
    if amount_raw <= 0:
        return 0.0
    return float(amount_raw) / float(10 ** max(0, decimals))


def _swap_quote_sanity_warning(token_in: str, token_out: str, amount_in: int, expected_out: int) -> str | None:
    """
    Return a human-readable sanity error for obviously unhealthy rates.
    This protects manual users from draining into near-zero output testnet routes.
    """
    in_addr = _normalize_hex_addr(token_in)
    out_addr = _normalize_hex_addr(token_out)
    strk = _normalize_hex_addr("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d")
    eth = _normalize_hex_addr("0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7")
    usdc = _normalize_hex_addr(SEPOLIA_USDC)
    fusdc = _normalize_hex_addr(SEPOLIA_FUSDC)
    stable_like = {usdc, fusdc}

    min_usdc_out = float(os.getenv("SWAP_MIN_USDC_OUT", "0.1"))
    min_eth_usdc_rate = float(os.getenv("SWAP_MIN_ETH_USDC_RATE", "100"))
    max_eth_usdc_rate = float(os.getenv("SWAP_MAX_ETH_USDC_RATE", "100000"))
    min_strk_usdc_rate = float(os.getenv("SWAP_MIN_STRK_USDC_RATE", "0.05"))
    max_strk_usdc_rate = float(os.getenv("SWAP_MAX_STRK_USDC_RATE", "1000"))

    if in_addr in {strk, eth} and out_addr in stable_like:
        amount_in_units = _amount_to_units(amount_in, 18)
        amount_out_units = _amount_to_units(expected_out, 6)
        if amount_out_units < min_usdc_out:
            return (
                f"Liquidity warning: expected output is about ${amount_out_units:.6f} {_token_symbol(out_addr)}, "
                f"below the ${min_usdc_out:.6f} threshold."
            )
        if amount_in_units <= 0:
            return "Liquidity warning: invalid input amount."
        implied_usdc_per_token = amount_out_units / amount_in_units
        if in_addr == eth and implied_usdc_per_token < min_eth_usdc_rate:
            return (
                f"Liquidity warning: implied ETH rate is about ${implied_usdc_per_token:.4f} per ETH, "
                f"below floor ${min_eth_usdc_rate:.4f}."
            )
        if in_addr == strk and implied_usdc_per_token < min_strk_usdc_rate:
            return (
                f"Liquidity warning: implied STRK rate is about ${implied_usdc_per_token:.6f} per STRK, "
                f"below floor ${min_strk_usdc_rate:.6f}."
            )

    if in_addr in stable_like and out_addr in {eth, strk}:
        amount_in_units = _amount_to_units(amount_in, 6)
        amount_out_units = _amount_to_units(expected_out, 18)
        if amount_out_units <= 0:
            return "Liquidity warning: expected output is zero for this route."
        implied_usdc_per_token = amount_in_units / amount_out_units
        if out_addr == eth and (
            implied_usdc_per_token < min_eth_usdc_rate or implied_usdc_per_token > max_eth_usdc_rate
        ):
            return (
                f"Liquidity warning: implied ETH rate is about ${implied_usdc_per_token:.4f} per ETH, "
                f"outside band ${min_eth_usdc_rate:.4f}-${max_eth_usdc_rate:.4f}."
            )
        if out_addr == strk and (
            implied_usdc_per_token < min_strk_usdc_rate or implied_usdc_per_token > max_strk_usdc_rate
        ):
            return (
                f"Liquidity warning: implied STRK rate is about ${implied_usdc_per_token:.6f} per STRK, "
                f"outside band ${min_strk_usdc_rate:.6f}-${max_strk_usdc_rate:.6f}."
            )

    return None


@router.get("/capabilities")
async def ekubo_capabilities() -> dict[str, Any]:
    executor = ContractExecutor()
    return {
        "chain_id": get_ekubo_chain_id(),
        "router_address": EKUBO_ROUTER_SEPOLIA,
        "positions_address": EKUBO_POSITIONS_SEPOLIA,
        "lp_enabled": _lp_enabled(),
        "market_surface_enabled": _market_surface_enabled(),
        "executor_live_submit_enabled": os.getenv("EXECUTOR_LIVE_SUBMIT", "false").strip().lower() == "true",
        "executor_can_submit_live": executor.can_submit_live(),
        "default_slippage_bps": 50,
    }


@router.get("/positions", response_model=PositionsResponse)
async def ekubo_positions(owner: str = Query(..., min_length=3)):
    positions = list_positions(owner)
    return {
        "owner": owner,
        "positions": positions,
        "count": len(positions),
    }


@router.post("/swap/quote", response_model=SwapQuoteResponse)
async def ekubo_swap_quote(body: SwapQuoteRequest):
    chain_id = _require_chain_id()
    amount_in = _parse_positive_int(body.amount_in, "amount_in")
    swap = await build_swap_calldata(
        chain_id=chain_id,
        token_in=body.token_in,
        token_out=body.token_out,
        amount_in_wei=amount_in,
        slippage_bps=body.slippage_bps,
    )
    if swap.get("error"):
        raise HTTPException(status_code=503, detail=str(swap.get("error")))

    expected_out = int(str(swap.get("expected_out") or "0"))
    if expected_out <= 0:
        raise HTTPException(
            status_code=503,
            detail="No executable output for this pair on Ekubo Sepolia at current liquidity.",
        )

    sanity_warning = _swap_quote_sanity_warning(
        token_in=body.token_in,
        token_out=body.token_out,
        amount_in=amount_in,
        expected_out=expected_out,
    )

    min_out = int(expected_out * (1 - (body.slippage_bps / 10_000)))
    price_impact_bps = 0

    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=20)).isoformat()
    route = [str(x) for x in (swap.get("route") or []) if x]
    if not route:
        route = [body.token_in, EKUBO_ROUTER_SEPOLIA, body.token_out]

    return SwapQuoteResponse(
        expected_out=str(expected_out),
        min_out=str(max(0, min_out)),
        price_impact_bps=price_impact_bps,
        route=route,
        expires_at=expires_at,
        warnings=[sanity_warning] if sanity_warning else [],
    )


@router.post("/swap/build", response_model=BuildTxResponse)
async def ekubo_swap_build(body: SwapBuildRequest):
    chain_id = _require_chain_id()
    amount_in = _parse_positive_int(body.amount_in, "amount_in")
    mode = _resolve_execution_mode(body.execution_mode, body.wallet_connected)

    if mode == "wallet":
        taker = body.taker_address or body.user_address
        if not taker:
            raise HTTPException(
                status_code=400,
                detail="Wallet execution requires taker_address/user_address for balance precheck.",
            )
        balance_raw = await _read_erc20_balance(body.token_in, taker)
        if balance_raw is not None and balance_raw < amount_in:
            decimals = _token_decimals(body.token_in)
            symbol = _token_symbol(body.token_in)
            have = _format_units(balance_raw, decimals)
            need = _format_units(amount_in, decimals)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient {symbol} balance for wallet execution. "
                    f"Need {need} {symbol}, have {have} {symbol}."
                ),
            )

    swap = await build_swap_calldata(
        chain_id=chain_id,
        token_in=body.token_in,
        token_out=body.token_out,
        amount_in_wei=amount_in,
        slippage_bps=body.slippage_bps,
    )
    if swap.get("error"):
        raise HTTPException(status_code=503, detail=str(swap.get("error")))

    expected_out = int(str(swap.get("expected_out") or "0"))
    warnings: list[str] = []
    if expected_out > 0:
        sanity_warning = _swap_quote_sanity_warning(
            token_in=body.token_in,
            token_out=body.token_out,
            amount_in=amount_in,
            expected_out=expected_out,
        )
        if sanity_warning:
            warnings.append(sanity_warning)

    approvals = [
        ApprovalCall(
            token=body.token_in,
            spender=EKUBO_CORE_SEPOLIA,
            amount=str(amount_in),
        )
    ]
    calls = [
        ContractCall(
            contract_address=str(swap["contract_address"]),
            entrypoint=str(swap["entrypoint"]),
            calldata=[str(x) for x in (swap.get("calldata") or [])],
        )
    ]

    receipt_id: str | None = None
    if mode == "orchestrated":
        receipt_svc = get_receipt_service()
        receipt = await receipt_svc.create_receipt(
            user_address=body.user_address or body.taker_address or "orchestrated",
            constraints_hash=f"ekubo_swap_{body.token_in}_{body.token_out}",
            proof_hash="0x" + "0" * 64,
            action_type="swap",
            protocol_id=1,
            amount=amount_in,
        )
        receipt_id = receipt.get("receipt_id")

    return BuildTxResponse(
        execution_mode=mode,
        approvals=approvals,
        calls=calls,
        receipt_id=receipt_id,
        warnings=warnings,
    )


@router.post("/lp/preview", response_model=LpPreviewResponse)
async def ekubo_lp_preview(body: LpPreviewRequest):
    if not _lp_enabled():
        raise HTTPException(status_code=503, detail="LP endpoints disabled (EKUBO_LP_ENABLED=false).")

    chain_id = _require_chain_id()
    amount0 = _parse_non_negative_int(body.amount0, "amount0")
    amount1 = _parse_non_negative_int(body.amount1, "amount1")

    preview = await preview_lp_position(
        chain_id=chain_id,
        token0=body.token0,
        token1=body.token1,
        amount0=amount0,
        amount1=amount1,
        fee_tier=body.fee_tier,
        lower_tick=body.lower_tick,
        upper_tick=body.upper_tick,
        risk_profile=body.risk_profile,
    )

    return LpPreviewResponse(
        lower_tick=int(preview["lower_tick"]),
        upper_tick=int(preview["upper_tick"]),
        current_tick=(int(preview["current_tick"]) if preview.get("current_tick") is not None else None),
        single_sided_expected=bool(preview.get("single_sided_expected", False)),
        single_sided_side=str(preview.get("single_sided_side", "none")),
        estimated_share=str(preview["estimated_share"]),
        estimated_fees_apr=float(preview["estimated_fees_apr"]),
        warnings=list(preview.get("warnings") or []),
    )


@router.post("/lp/add/build", response_model=LpBuildResponse)
async def ekubo_lp_add_build(body: LpBuildRequest):
    if not _lp_enabled():
        raise HTTPException(status_code=503, detail="LP endpoints disabled (EKUBO_LP_ENABLED=false).")

    chain_id = _require_chain_id()
    amount0 = _parse_non_negative_int(body.amount0, "amount0")
    amount1 = _parse_non_negative_int(body.amount1, "amount1")
    mode = _resolve_execution_mode(body.execution_mode, body.wallet_connected)

    lower_tick = body.lower_tick
    upper_tick = body.upper_tick
    if lower_tick is None or upper_tick is None:
        preview = await preview_lp_position(
            chain_id=chain_id,
            token0=body.token0,
            token1=body.token1,
            amount0=amount0,
            amount1=amount1,
            fee_tier=body.fee_tier,
            lower_tick=None,
            upper_tick=None,
            risk_profile=body.risk_profile,
        )
        lower_tick = int(preview["lower_tick"])
        upper_tick = int(preview["upper_tick"])

    payload = await build_lp_add(
        chain_id=chain_id,
        owner=body.owner or "",
        token0=body.token0,
        token1=body.token1,
        amount0=amount0,
        amount1=amount1,
        fee_tier=body.fee_tier,
        lower_tick=int(lower_tick),
        upper_tick=int(upper_tick),
        risk_profile=body.risk_profile,
    )

    receipt_id: str | None = None
    if mode == "orchestrated":
        receipt = await get_receipt_service().create_receipt(
            user_address=body.owner or "orchestrated",
            constraints_hash=f"ekubo_lp_add_{body.token0}_{body.token1}",
            proof_hash="0x" + "0" * 64,
            action_type="deposit",
            protocol_id=1,
            amount=amount0 + amount1,
        )
        receipt_id = receipt.get("receipt_id")

    return LpBuildResponse(
        execution_mode=mode,
        approvals=[ApprovalCall(**a) for a in (payload.get("approvals") or [])],
        calls=[ContractCall(**c) for c in (payload.get("calls") or [])],
        receipt_id=receipt_id,
        position_id=payload.get("position_id"),
        warnings=list(payload.get("warnings") or []),
    )


@router.post("/lp/remove/build", response_model=LpBuildResponse)
async def ekubo_lp_remove_build(body: LpRemoveBuildRequest):
    if not _lp_enabled():
        raise HTTPException(status_code=503, detail="LP endpoints disabled (EKUBO_LP_ENABLED=false).")

    mode = _resolve_execution_mode(body.execution_mode, body.wallet_connected)

    payload = await build_lp_remove(
        owner=body.owner,
        position_id=body.position_id,
        liquidity_bps=body.liquidity_bps,
    )

    receipt_id: str | None = None
    if mode == "orchestrated":
        receipt = await get_receipt_service().create_receipt(
            user_address=body.owner,
            constraints_hash=f"ekubo_lp_remove_{body.position_id}",
            proof_hash="0x" + "0" * 64,
            action_type="withdraw",
            protocol_id=1,
            amount=body.liquidity_bps,
        )
        receipt_id = receipt.get("receipt_id")

    return LpBuildResponse(
        execution_mode=mode,
        approvals=[],
        calls=[ContractCall(**c) for c in (payload.get("calls") or [])],
        receipt_id=receipt_id,
        position_id=body.position_id,
        warnings=list(payload.get("warnings") or []),
    )


class PositionStatusUpdateRequest(BaseModel):
    position_id: str
    status: str = "active"
    tx_hash: str | None = None
    ekubo_nft_id: int | None = None


@router.post("/lp/status")
async def ekubo_lp_status_update(body: PositionStatusUpdateRequest):
    """Update a position's status after on-chain confirmation."""
    allowed = {"active", "confirmed", "failed", "closed", "built", "remove_built"}
    if body.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {allowed}")
    updated = update_position_status(
        body.position_id, body.status, body.tx_hash, body.ekubo_nft_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Position not found.")
    return {"ok": True, "position_id": body.position_id, "status": body.status}


@router.post("/lp/sync")
async def ekubo_lp_sync(owner: str = Query(...)):
    """Sync local positions against on-chain NFT balance."""
    result = await sync_onchain_balance(owner)
    return result


@router.post("/lp/purge-stale")
async def ekubo_lp_purge_stale(
    owner: str = Query(...),
    max_age_hours: int = Query(default=1, ge=0),
):
    """Purge old 'built' positions that were never confirmed on-chain."""
    result = purge_stale_positions(owner, max_age_hours)
    return {"ok": True, **result}


@router.post("/lp/verify-tx")
async def ekubo_lp_verify_tx(
    tx_hash: str = Query(...),
    owner: str = Query(...),
    position_id: str | None = Query(default=None),
):
    """Verify a tx receipt and extract the on-chain NFT token_id.

    If position_id is provided, auto-update the position with the extracted NFT id.
    """
    result = await verify_tx_and_extract_nft_id(tx_hash, owner)
    if result.get("verified") and result.get("ekubo_nft_id") is not None and position_id:
        update_position_status(
            position_id, "active", tx_hash, result["ekubo_nft_id"],
        )
        result["position_updated"] = True
    return result


@router.post("/lp/import-onchain")
async def ekubo_lp_import_onchain(owner: str = Query(...)):
    """Scan on-chain NFT Transfer events and import all positions owned by *owner*.

    Discovers NFT IDs, fetches tx receipts, extracts pool/bounds data, and
    imports any new positions into the local store.
    """
    result = await import_onchain_positions(owner)
    return result


@router.post("/lp/collect-fees/build", response_model=LpBuildResponse)
async def ekubo_lp_collect_fees_build(
    owner: str = Query(...),
    position_id: str = Query(...),
):
    """Build calldata for collecting accrued fees from an Ekubo LP position."""
    result = await build_collect_fees(owner, position_id)
    return LpBuildResponse(
        execution_mode="wallet",
        position_id=position_id,
        approvals=[ApprovalCall(**a) for a in result.get("approvals", [])],
        calls=[ContractCall(**c) for c in result.get("calls", [])],
        warnings=result.get("warnings", []),
    )


def _require_chain_id() -> str:
    chain_id = get_ekubo_chain_id()
    if not chain_id:
        raise HTTPException(status_code=503, detail="EKUBO_CHAIN_ID not configured.")
    return str(chain_id).strip()


def _parse_positive_int(raw: str, field_name: str) -> int:
    try:
        value = int(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a decimal string.")
    if value <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be positive.")
    return value


def _parse_non_negative_int(raw: str, field_name: str) -> int:
    try:
        value = int(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a decimal string.")
    if value < 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be non-negative.")
    return value


def _resolve_execution_mode(mode: ExecutionModeRequest, wallet_connected: bool) -> ExecutionMode:
    if mode == "wallet":
        return "wallet"
    if mode == "orchestrated":
        return "orchestrated"
    return "wallet" if wallet_connected else "orchestrated"


def _lp_enabled() -> bool:
    return os.getenv("EKUBO_LP_ENABLED", "true").strip().lower() == "true"


def _market_surface_enabled() -> bool:
    return os.getenv("EKUBO_MARKET_SURFACE_ENABLED", "true").strip().lower() == "true"


# ═══════════════════════════════════════════════════════════════════
# LP Recommendation (LLM-powered)
# ═══════════════════════════════════════════════════════════════════

class LpRecommendationRequest(BaseModel):
    user_address: str
    risk_profile: Literal["conservative", "neutral", "aggressive"] = "neutral"


class LpRecommendationPool(BaseModel):
    pair: str
    token0: str
    token1: str
    token0_symbol: str
    token1_symbol: str
    suggested_amount0: str
    suggested_amount1: str
    suggested_amount0_human: str
    suggested_amount1_human: str
    fee_tier: int
    tvl_usd: float
    estimated_apy_pct: float
    confidence: str
    reasoning: str


class LpRecommendationResponse(BaseModel):
    recommendations: list[LpRecommendationPool]
    summary: str
    portfolio_context: str
    generated_at: str
    source: str = "deterministic_engine"
    model: str | None = None


@router.post("/lp/recommend", response_model=LpRecommendationResponse)
async def ekubo_lp_recommend(body: LpRecommendationRequest):
    """Generate AI LP recommendations based on user wallet balances and market conditions."""
    from app.services.market_surface_service import get_market_surface
    from app.services.ekubo.oracle_adapter import get_live_prices

    chain_id = _require_chain_id()

    # 1. Fetch user balances for known tokens
    known_tokens = {
        "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": ("STRK", 18),
        "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": ("ETH", 18),
        "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": ("USDC", 6),
        "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": ("fUSDC", 6),
    }

    balances: dict[str, dict[str, Any]] = {}
    for addr, (symbol, decimals) in known_tokens.items():
        raw = await _read_erc20_balance(addr, body.user_address)
        if raw is not None and raw > 0:
            human = _format_units(raw, decimals)
            usd_value = 0.0
            balances[_normalize_hex_addr(addr)] = {
                "symbol": symbol,
                "decimals": decimals,
                "raw": raw,
                "human": human,
                "usd_value": usd_value,
            }

    # 2. Fetch live prices
    try:
        prices = await get_live_prices()
        eth_usd = float(prices.get("eth_usd") or 0)
        strk_usd = float(prices.get("strk_usd") or 0)
    except Exception:
        eth_usd = 1900.0
        strk_usd = 0.04

    # Apply USD values
    for addr, info in balances.items():
        sym = info["symbol"]
        units = float(info["raw"]) / (10 ** info["decimals"])
        if sym == "ETH":
            info["usd_value"] = units * eth_usd
        elif sym == "STRK":
            info["usd_value"] = units * strk_usd
        elif sym in ("USDC", "fUSDC"):
            info["usd_value"] = units

    total_usd = sum(b["usd_value"] for b in balances.values())

    # 3. Fetch market surface
    try:
        surface = await get_market_surface(chain_id=chain_id)
        opportunities = surface.get("opportunities", [])
    except Exception:
        opportunities = []

    # 4. Find pools where user has BOTH tokens
    user_symbols = {b["symbol"] for b in balances.values()}
    symbol_to_addr = {b["symbol"]: addr for addr, b in balances.items()}

    viable_pools: list[dict[str, Any]] = []
    for opp in opportunities:
        pair_parts = opp.get("pair", "").split("/")
        if len(pair_parts) != 2:
            continue
        sym0, sym1 = pair_parts[0].strip(), pair_parts[1].strip()
        if sym0 in user_symbols and sym1 in user_symbols:
            viable_pools.append({**opp, "_sym0": sym0, "_sym1": sym1})

    # 5. Generate recommendations
    recommendations: list[LpRecommendationPool] = []

    risk_alloc = {"conservative": 0.15, "neutral": 0.30, "aggressive": 0.50}
    alloc_pct = risk_alloc.get(body.risk_profile, 0.30)

    # Sort by TVL (prefer deeper pools) then by APY
    viable_pools.sort(key=lambda p: (p.get("tvl_usd", 0), p.get("estimated_apy_pct", 0)), reverse=True)

    for pool in viable_pools[:3]:
        sym0 = pool["_sym0"]
        sym1 = pool["_sym1"]
        addr0 = _normalize_hex_addr(pool.get("token0", ""))
        addr1 = _normalize_hex_addr(pool.get("token1", ""))
        bal0 = balances.get(addr0) or balances.get(symbol_to_addr.get(sym0, ""), {})
        bal1 = balances.get(addr1) or balances.get(symbol_to_addr.get(sym1, ""), {})

        if not bal0 or not bal1:
            continue

        dec0 = bal0["decimals"]
        dec1 = bal1["decimals"]

        # Allocate proportional to risk profile
        raw0 = int(bal0["raw"] * alloc_pct)
        raw1 = int(bal1["raw"] * alloc_pct)

        human0 = _format_units(raw0, dec0)
        human1 = _format_units(raw1, dec1)

        tvl = pool.get("tvl_usd", 0)
        apy = pool.get("estimated_apy_pct", 0.0)
        spread = pool.get("spread_bps", 0)
        confidence = pool.get("confidence", "low")

        # Generate reasoning based on data
        if tvl > 100_000:
            depth_note = "Deep liquidity reduces impermanent loss risk."
        elif tvl > 10_000:
            depth_note = "Moderate liquidity — reasonable for this pair."
        else:
            depth_note = "Low liquidity — higher risk but potential for larger fee share."

        if body.risk_profile == "conservative":
            fee_tier = 500 if spread < 10 else 3000
            strategy_note = f"Conservative: using {alloc_pct*100:.0f}% of holdings with wide price range."
        elif body.risk_profile == "aggressive":
            fee_tier = 3000 if spread > 5 else 10000
            strategy_note = f"Aggressive: deploying {alloc_pct*100:.0f}% of holdings for maximum yield."
        else:
            fee_tier = 3000
            strategy_note = f"Balanced: deploying {alloc_pct*100:.0f}% of holdings across the standard fee tier."

        reasoning = f"{pool['pair']} pool on {pool.get('best_venue', 'Ekubo')}. TVL ${tvl:,.0f}. {depth_note} {strategy_note}"

        recommendations.append(LpRecommendationPool(
            pair=pool["pair"],
            token0=pool.get("token0", ""),
            token1=pool.get("token1", ""),
            token0_symbol=sym0,
            token1_symbol=sym1,
            suggested_amount0=str(raw0),
            suggested_amount1=str(raw1),
            suggested_amount0_human=human0,
            suggested_amount1_human=human1,
            fee_tier=fee_tier,
            tvl_usd=tvl,
            estimated_apy_pct=apy,
            confidence=confidence,
            reasoning=reasoning,
        ))

    # Build portfolio context string
    balance_lines = [f"{b['human']} {b['symbol']} (~${b['usd_value']:.2f})" for b in balances.values() if b["raw"] > 0]
    portfolio_ctx = f"Wallet holds {', '.join(balance_lines)}. Total ~${total_usd:.2f}."

    # ── Try LLM-enhanced reasoning ──────────────────────────────────
    source = "deterministic_engine"
    model_name: str | None = None

    if recommendations:
        try:
            from app.services.llm_engine import LLMEngine
            engine = LLMEngine()
            if engine.use_llm and engine.client:
                # Build a concise prompt for the LLM
                pool_descriptions = []
                for r in recommendations:
                    pool_descriptions.append(
                        f"- {r.pair}: deposit {r.suggested_amount0_human} {r.token0_symbol} + "
                        f"{r.suggested_amount1_human} {r.token1_symbol}, "
                        f"TVL ${r.tvl_usd:,.0f}, APY {r.estimated_apy_pct:.1f}%, "
                        f"fee tier {r.fee_tier}, confidence {r.confidence}"
                    )
                llm_prompt = (
                    f"User risk profile: {body.risk_profile}\n"
                    f"Portfolio: {portfolio_ctx}\n\n"
                    f"Candidate LP positions:\n" + "\n".join(pool_descriptions) + "\n\n"
                    f"For each pool, write 1-2 sentences of reasoning explaining why this is or isn't "
                    f"a good fit for this user's risk profile. Then write a concise overall summary (2-3 sentences).\n\n"
                    f"Return ONLY valid JSON:\n"
                    f'{{"pool_reasoning": ["reasoning for pool 1", "reasoning for pool 2", ...], '
                    f'"summary": "overall recommendation summary"}}'
                )

                import json as _json
                response = engine.client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": (
                            "You are a DeFi liquidity provision advisor on Starknet. "
                            "Give concise, actionable advice. Be specific about risks like "
                            "impermanent loss, low TVL, and volatile pairs. Keep it under 200 words total."
                        )},
                        {"role": "user", "content": llm_prompt},
                    ],
                    temperature=0.3,
                    max_tokens=500,
                )
                content = response.choices[0].message.content or ""
                # Strip markdown code fences if present
                content = content.strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[-1]
                if content.endswith("```"):
                    content = content.rsplit("```", 1)[0]
                content = content.strip()

                llm_result = _json.loads(content)
                pool_reasons = llm_result.get("pool_reasoning", [])
                llm_summary = llm_result.get("summary", "")

                # Apply LLM reasoning to each recommendation
                for i, rec in enumerate(recommendations):
                    if i < len(pool_reasons) and pool_reasons[i]:
                        rec.reasoning = pool_reasons[i]

                if llm_summary:
                    source = "llm"
                    model_name = "onyx-defi-v1"
                    logger.info("LLM recommendation generated successfully")
        except Exception as e:
            logger.warning(f"LLM enhancement failed, using deterministic: {e}")
            # Keep deterministic recommendations as-is

    if recommendations:
        top = recommendations[0]
        if source == "llm":
            summary = llm_summary  # type: ignore[possibly-undefined]
        else:
            summary = (
                f"Based on your {body.risk_profile} risk profile, I recommend providing liquidity to "
                f"{top.pair} ({top.suggested_amount0_human} {top.token0_symbol} + {top.suggested_amount1_human} {top.token1_symbol}). "
                f"This pool has ${top.tvl_usd:,.0f} TVL and {top.estimated_apy_pct:.1f}% estimated APY. "
                f"You have both tokens in your wallet, so no swaps needed."
            )
    else:
        summary = (
            "No viable LP pools found matching your wallet tokens. "
            "Consider swapping to get both sides of a trading pair."
        )

    return LpRecommendationResponse(
        recommendations=recommendations,
        summary=summary,
        portfolio_context=portfolio_ctx,
        generated_at=datetime.now(timezone.utc).isoformat(),
        source=source,
        model=model_name,
    )
