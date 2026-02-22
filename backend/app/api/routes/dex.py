"""
DEX API routes — Ekubo Sepolia read-only + quote/swap-calldata.

Phase 1: tokens, pairs, TVL, volume, price history (read-only).
Phase 3: quote, swap-calldata for real swaps.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Any, Optional

import httpx

from app.services.ekubo_client import (
    EKUBO_CHAIN_ID_SEPOLIA,
    get_tokens,
    get_token,
    get_overview_pairs,
    get_overview_tvl,
    get_overview_volume,
    get_pair_pools,
    get_pair_tvl,
    get_pair_volume,
    get_price_history,
)

router = APIRouter(prefix="/dex", tags=["dex"])


def _require_chain_id() -> str:
    """Return raw EKUBO_CHAIN_ID (hex or decimal string) for Ekubo API path/query."""
    if not EKUBO_CHAIN_ID_SEPOLIA:
        raise HTTPException(
            status_code=503,
            detail="EKUBO_CHAIN_ID not configured. Set EKUBO_CHAIN_ID for Starknet Sepolia.",
        )
    return str(EKUBO_CHAIN_ID_SEPOLIA).strip()


def _chain_id_opt() -> Optional[str]:
    if not EKUBO_CHAIN_ID_SEPOLIA:
        return None
    return str(EKUBO_CHAIN_ID_SEPOLIA).strip()


# ---------- Phase 1: Read-only ----------

@router.get("/tokens")
async def dex_tokens(
    search: Optional[str] = Query(None),
    page_size: int = Query(100, ge=1, le=1000),
):
    """List tokens for Ekubo (Sepolia if EKUBO_CHAIN_ID set)."""
    try:
        data = await get_tokens(chain_id=None, search=search, page_size=page_size)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return {"tokens": data}


@router.get("/pairs")
async def dex_pairs(
    min_tvl_usd: Optional[float] = Query(1000, ge=0),
):
    """Top pairs with TVL/volume (all chains). Quote/swap require a pair on EKUBO_CHAIN_ID chain."""
    try:
        data = await get_overview_pairs(chain_id=None, min_tvl_usd=min_tvl_usd)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/tvl")
async def dex_tvl():
    """Overview TVL."""
    try:
        data = await get_overview_tvl(chain_id=None)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/volume")
async def dex_volume():
    """Overview volume."""
    try:
        data = await get_overview_volume(chain_id=None)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/pair/{token_a}/{token_b}/pools")
async def dex_pair_pools(
    token_a: str,
    token_b: str,
    min_tvl_usd: Optional[float] = Query(0, ge=0),
):
    """Pools for a token pair (for routing). Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    data = await get_pair_pools(chain_id, token_a, token_b, min_tvl_usd=min_tvl_usd)
    return data


@router.get("/pair/{token_a}/{token_b}/tvl")
async def dex_pair_tvl(token_a: str, token_b: str):
    """Pair TVL. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    data = await get_pair_tvl(chain_id, token_a, token_b)
    return data


@router.get("/pair/{token_a}/{token_b}/volume")
async def dex_pair_volume(token_a: str, token_b: str):
    """Pair volume. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    data = await get_pair_volume(chain_id, token_a, token_b)
    return data


@router.get("/price/{base_token}/{quote_token}/history")
async def dex_price_history(
    base_token: str,
    quote_token: str,
    interval: Optional[int] = Query(None, ge=60),
):
    """VWAP price history for a pair. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    data = await get_price_history(chain_id, base_token, quote_token, interval=interval)
    return data


@router.get("/token/{token_address}")
async def dex_token(token_address: str):
    """Token metadata. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    data = await get_token(chain_id, token_address)
    return data


# ---------- Phase 3: Quote + swap-calldata ----------

class QuoteRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str  # wei as string


class QuoteResponse(BaseModel):
    amount_out: str
    amount_out_min: str  # with slippage
    pool_fee: Optional[str] = None
    pool_core_address: Optional[str] = None
    message: Optional[str] = None


@router.post("/quote", response_model=QuoteResponse)
async def dex_quote(body: QuoteRequest):
    """
    Get expected amount out for a swap (quote).
    Uses Ekubo API pair pools to pick best pool; amount_out is estimated from pool liquidity/price.
    For exact quote we would need Ekubo quote endpoint or on-chain simulation; here we return
    a best-effort estimate from pool TVL/price data.
    """
    chain_id = _require_chain_id()
    try:
        amount_in = int(body.amount_in)
    except ValueError:
        raise HTTPException(status_code=400, detail="amount_in must be a decimal string (wei).")
    if amount_in <= 0:
        raise HTTPException(status_code=400, detail="amount_in must be positive.")

    pools_data = await get_pair_pools(chain_id, body.token_in, body.token_out, min_tvl_usd=0)
    top_pools = pools_data.get("topPools") or []
    if not top_pools:
        raise HTTPException(
            status_code=404,
            detail=f"No Ekubo pools found for pair {body.token_in[:10]}... / {body.token_out[:10]}...",
        )
    # Pick pool with highest TVL (simple routing)
    best = max(
        top_pools,
        key=lambda p: float(p.get("tvl0_total", 0) or 0) + float(p.get("tvl1_total", 0) or 0),
    )
    # Rough estimate: use ratio from TVL (constant product style: amount_out ~ amount_in * (tvl1/tvl0))
    tvl0 = float(best.get("tvl0_total") or 0)
    tvl1 = float(best.get("tvl1_total") or 0)
    if tvl0 <= 0:
        amount_out = 0
    else:
        # Very rough: out = in * (tvl1/tvl0); real quote needs pool curve
        amount_out = int(amount_in * (tvl1 / tvl0))
    # Slippage 0.5% default for amount_out_min
    amount_out_min = int(amount_out * 0.995)
    return QuoteResponse(
        amount_out=str(amount_out),
        amount_out_min=str(amount_out_min),
        pool_fee=best.get("fee"),
        pool_core_address=best.get("core_address"),
        message="Estimate from pool TVL; for exact quote use Ekubo UI or on-chain simulation.",
    )


class SwapCalldataRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str
    slippage_bps: int = 50  # 0.5%
    user_address: Optional[str] = None


class SwapCalldataResponse(BaseModel):
    contract_address: str
    entrypoint: str
    calldata: list[str]
    message: str


# Ekubo Sepolia Router V3.0.13 (from viability report)
# Router exposes IRouter.swap(node: RouteNode, token_amount: TokenAmount)
# RouteNode = { pool_key: PoolKey, sqrt_ratio_limit: u256, skip_ahead: u128 }
# PoolKey = { token0, token1, fee, tick_spacing, extension } with token0 < token1
# TokenAmount = { token: address, amount: i129 } with i129 = { mag: u128, sign: bool }
# Fee is 0.128 fixed point: 1% = 2^128/100 (see Ekubo types/keys.cairo, types/i129.cairo)
EKUBO_ROUTER_SEPOLIA = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763"

# 2^128 for fee conversion (0.128 fixed point: fee_u128 = floor(percent * 2^128))
_TWO_128 = 2**128


def _fee_to_u128(fee_raw: Any) -> int:
    """Convert API fee to Ekubo 0.128 fixed point. 1% = 2^128/100."""
    if fee_raw is None or fee_raw == "":
        return int(0.003 * _TWO_128)  # default 0.3%
    try:
        pct = float(fee_raw)
    except (TypeError, ValueError):
        return int(0.003 * _TWO_128)
    if pct <= 0:
        return int(0.003 * _TWO_128)
    return int(pct * _TWO_128)


@router.post("/swap-calldata", response_model=SwapCalldataResponse)
async def dex_swap_calldata(body: SwapCalldataRequest):
    """
    Build calldata for Router.swap(RouteNode, TokenAmount) per EkuboProtocol/starknet-contracts.
    User must approve token_in for the Router before invoking.
    """
    chain_id = _require_chain_id()
    if body.slippage_bps < 0 or body.slippage_bps > 10000:
        raise HTTPException(status_code=400, detail="slippage_bps must be 0-10000.")

    pools_data = await get_pair_pools(chain_id, body.token_in, body.token_out, min_tvl_usd=0)
    top_pools = pools_data.get("topPools") or []
    if not top_pools:
        raise HTTPException(status_code=404, detail="No pools for this pair.")

    best = max(
        top_pools,
        key=lambda p: float(p.get("tvl0_total", 0) or 0) + float(p.get("tvl1_total", 0) or 0),
    )
    # PoolKey requires token0 < token1 (by integer address)
    ti, to = body.token_in, body.token_out
    try:
        token0 = ti if int(ti, 16) < int(to, 16) else to
        token1 = to if token0 == ti else ti
    except ValueError:
        token0, token1 = ti, to
    fee_u128 = _fee_to_u128(best.get("fee"))
    tick_spacing = int(best.get("tick_spacing") or 60)
    extension = (best.get("extension") or "0").strip() or "0"
    # RouteNode: pool_key (5 felts), sqrt_ratio_limit (u256 = 2 felts), skip_ahead (1 felt)
    sqrt_low, sqrt_high = 0, 0  # 0 = no limit
    skip_ahead = 0
    # TokenAmount: token (1), amount i129: mag (1), sign (1) — positive = sign 0
    amount_in = int(body.amount_in)
    if amount_in < 0:
        amount_in = 0
    # Calldata = RouteNode then TokenAmount (flattened Serde order)
    calldata = [
        token0,
        token1,
        str(fee_u128),
        str(tick_spacing),
        extension,
        str(sqrt_low),
        str(sqrt_high),
        str(skip_ahead),
        body.token_in,  # token we pay
        str(amount_in),
        "0",  # i129 sign: 0 = positive
    ]
    return SwapCalldataResponse(
        contract_address=EKUBO_ROUTER_SEPOLIA,
        entrypoint="swap",
        calldata=calldata,
        message="Router.swap(RouteNode, TokenAmount). Approve token_in for Router before invoking.",
    )
