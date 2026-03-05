"""
DEX API routes — Ekubo Sepolia read-only + quote/swap-calldata.

Phase 1: tokens, pairs, TVL, volume, price history (read-only).
Phase 3: quote, swap-calldata for real swaps.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, localcontext
from typing import Any, Optional, Literal

import httpx
import os

from app.services.ekubo_client import (
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
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.ekubo_config import get_ekubo_chain_id
from app.services.local_orchestrator import get_local_orchestrator

router = APIRouter(prefix="/dex", tags=["dex"])

_SN_SEPOLIA_CHAIN_ID = "0x534e5f5345504f4c4941"
_SN_SEPOLIA_CHAIN_ID_DEC = "393402133025997798000961"
_EKUBO_API_CHAIN_ID_ALIAS = "0x534e5f4d41494f"
_EKUBO_CHAIN_ID_ALIAS_DEC = "23448594291968335"
_AVNU_BASE_URL = os.getenv("AVNU_BASE_URL", "https://sepolia.api.avnu.fi").strip().rstrip("/")
_AVNU_TIMEOUT_S = float(os.getenv("AVNU_TIMEOUT_S", "15"))
_AVNU_MIN_ADV_BPS_FOR_BEST = int(os.getenv("AVNU_MIN_ADV_BPS_FOR_BEST", "125"))


def _require_chain_id() -> str:
    """Return raw EKUBO_CHAIN_ID (hex or decimal string) for Ekubo API path/query."""
    chain_id = get_ekubo_chain_id()
    if not chain_id:
        raise HTTPException(
            status_code=503,
            detail="EKUBO_CHAIN_ID not configured. Set EKUBO_CHAIN_ID for Starknet Sepolia.",
        )
    return str(chain_id).strip()


def _chain_id_opt() -> Optional[str]:
    chain_id = get_ekubo_chain_id()
    if not chain_id:
        return None
    return str(chain_id).strip()


def _chain_id_candidates(chain_id: Optional[str]) -> list[str]:
    if not chain_id:
        return []
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: Optional[str]) -> None:
        if not raw:
            return
        value = str(raw).strip()
        if not value:
            return
        key = value.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(value)

    add(chain_id)
    norm = str(chain_id).strip().lower()
    if norm in {_SN_SEPOLIA_CHAIN_ID.lower(), _SN_SEPOLIA_CHAIN_ID_DEC}:
        add(_EKUBO_API_CHAIN_ID_ALIAS)
        add(_EKUBO_CHAIN_ID_ALIAS_DEC)
    elif norm in {_EKUBO_API_CHAIN_ID_ALIAS.lower(), _EKUBO_CHAIN_ID_ALIAS_DEC}:
        add(_SN_SEPOLIA_CHAIN_ID)
        add(_SN_SEPOLIA_CHAIN_ID_DEC)
    return out


def _parse_int_like(raw: Any) -> int:
    if raw is None:
        return 0
    if isinstance(raw, int):
        return raw
    text = str(raw).strip().lower()
    if not text:
        return 0
    if text.startswith("0x"):
        try:
            return int(text, 16)
        except ValueError:
            return 0
    try:
        return int(text)
    except ValueError:
        return 0


def _to_hex_felt(value: int) -> str:
    if value <= 0:
        return "0x0"
    return hex(value)


def _avnu_error_detail(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        messages = payload.get("messages")
        if isinstance(messages, list) and messages:
            text = "; ".join(str(m) for m in messages if m is not None).strip()
            if text:
                return text
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message
    if isinstance(payload, list) and payload:
        text = "; ".join(str(m) for m in payload if m is not None).strip()
        if text:
            return text
    return fallback


def _as_quote_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        nested = payload.get("quotes")
        if isinstance(nested, list):
            return [item for item in nested if isinstance(item, dict)]
        return [payload]
    return []


def _pick_best_avnu_quote(quotes: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, int]:
    best: dict[str, Any] | None = None
    best_out = 0
    for row in quotes:
        out = _parse_int_like(row.get("buyAmount"))
        if out > best_out:
            best = row
            best_out = out
    return best, best_out


def _avnu_route_summary(quote: dict[str, Any]) -> list[str]:
    routes = quote.get("routes")
    if not isinstance(routes, list):
        return []
    out: list[str] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        label = str(route.get("name") or route.get("address") or "").strip()
        if not label:
            continue
        out.append(label)
    return out


def _choose_aggregated_venue(venues: list["VenueQuote"]) -> "VenueQuote":
    """Always prefer AVNU when a valid quote exists.

    AVNU routes through Ekubo pools internally when that is optimal, but its
    calldata encoding is more reliable than our direct Ekubo router path
    (which hits u256_sub Overflow on many pairs).  Only fall back to Ekubo
    direct when AVNU has no usable quote."""
    avnu_row = next((row for row in venues if row.venue == "avnu"), None)
    ekubo_row = next((row for row in venues if row.venue == "ekubo"), None)
    if avnu_row:
        avnu_out = _parse_int_like(avnu_row.amount_out)
        if avnu_out > 0 and avnu_row.quote_id:
            return avnu_row
    if ekubo_row:
        return ekubo_row
    return max(venues, key=lambda row: _parse_int_like(row.amount_out))


async def _fetch_avnu_quotes(
    token_in: str,
    token_out: str,
    amount_in: int,
    taker_address: Optional[str] = None,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "sellTokenAddress": token_in,
        "buyTokenAddress": token_out,
        "sellAmount": _to_hex_felt(amount_in),
        "size": "5",
    }
    if taker_address:
        params["takerAddress"] = taker_address

    url = f"{_AVNU_BASE_URL}/swap/v2/quotes"
    async with httpx.AsyncClient(timeout=_AVNU_TIMEOUT_S) as client:
        resp = await client.get(url, params=params)
    payload = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=503,
            detail=_avnu_error_detail(payload, f"AVNU quote API error: {resp.status_code}"),
        )
    quotes = _as_quote_list(payload)
    if not quotes:
        raise HTTPException(status_code=404, detail="No AVNU quote available for this pair/size.")
    return quotes


async def _fetch_ekubo_quote(
    token_in: str,
    token_out: str,
    amount_in: int,
    slippage_bps: int,
) -> dict[str, Any]:
    chain_id = _require_chain_id()
    swap = await build_swap_calldata(
        chain_id=chain_id,
        token_in=token_in,
        token_out=token_out,
        amount_in_wei=amount_in,
        slippage_bps=slippage_bps,
    )
    if swap.get("error"):
        raise HTTPException(status_code=404, detail=str(swap.get("error")))

    amount_out = _parse_int_like(swap.get("expected_out"))
    amount_out_min = _parse_int_like(swap.get("min_out"))
    if amount_out <= 0:
        raise HTTPException(
            status_code=404,
            detail=f"No executable Ekubo liquidity for pair {token_in[:10]}... / {token_out[:10]}...",
        )
    if amount_out_min <= 0:
        amount_out_min = int(amount_out * (1 - (max(0, min(10_000, slippage_bps)) / 10_000)))
    return {
        "amount_out": amount_out,
        "amount_out_min": max(0, amount_out_min),
        "pool_core_address": str(swap.get("contract_address") or ""),
        "message": f"On-chain route quote via Ekubo ({swap.get('entrypoint') or 'swap'}).",
        "route": [str(x) for x in (swap.get("route") or []) if x],
    }


# ---------- Phase 1: Read-only ----------

@router.get("/tokens")
async def dex_tokens(
    search: Optional[str] = Query(None),
    page_size: int = Query(100, ge=1, le=1000),
    all_chains: bool = Query(False),
):
    """List tokens for Ekubo (defaults to configured chain; set all_chains=true to aggregate)."""
    chain_id = None if all_chains else _chain_id_opt()
    try:
        data = await get_tokens(chain_id=chain_id, search=search, page_size=page_size)
    except httpx.HTTPStatusError as e:
        # Some Ekubo deployments reject chainId for /tokens. Fallback to all-chains,
        # then filter to chain candidates when possible.
        if not all_chains and chain_id and e.response.status_code >= 500:
            try:
                fallback = await get_tokens(chain_id=None, search=search, page_size=page_size)
                candidates = {c.lower() for c in _chain_id_candidates(chain_id)}
                if candidates:
                    filtered = [
                        row
                        for row in fallback
                        if str((row or {}).get("chain_id") or "").strip().lower() in candidates
                    ]
                    if filtered:
                        return {"tokens": filtered}
                return {"tokens": fallback}
            except Exception:
                pass
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return {"tokens": data}


@router.get("/pairs")
async def dex_pairs(
    min_tvl_usd: Optional[float] = Query(1000, ge=0),
    all_chains: bool = Query(False),
):
    """Top pairs with TVL/volume (defaults to configured chain; set all_chains=true to aggregate)."""
    chain_id = None if all_chains else _chain_id_opt()
    try:
        data = await get_overview_pairs(chain_id=chain_id, min_tvl_usd=min_tvl_usd)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/tvl")
async def dex_tvl(all_chains: bool = Query(False)):
    """Overview TVL (defaults to configured chain; set all_chains=true to aggregate)."""
    chain_id = None if all_chains else _chain_id_opt()
    try:
        data = await get_overview_tvl(chain_id=chain_id)
    except httpx.HTTPStatusError as e:
        if not all_chains and chain_id and e.response.status_code >= 500:
            try:
                data = await get_overview_tvl(chain_id=None)
                return data
            except Exception:
                pass
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/volume")
async def dex_volume(all_chains: bool = Query(False)):
    """Overview volume (defaults to configured chain; set all_chains=true to aggregate)."""
    chain_id = None if all_chains else _chain_id_opt()
    try:
        data = await get_overview_volume(chain_id=chain_id)
    except httpx.HTTPStatusError as e:
        if not all_chains and chain_id and e.response.status_code >= 500:
            try:
                data = await get_overview_volume(chain_id=None)
                return data
            except Exception:
                pass
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
    try:
        data = await get_pair_pools(chain_id, token_a, token_b, min_tvl_usd=min_tvl_usd)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/pair/{token_a}/{token_b}/tvl")
async def dex_pair_tvl(token_a: str, token_b: str):
    """Pair TVL. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    try:
        data = await get_pair_tvl(chain_id, token_a, token_b)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/pair/{token_a}/{token_b}/volume")
async def dex_pair_volume(token_a: str, token_b: str):
    """Pair volume. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    try:
        data = await get_pair_volume(chain_id, token_a, token_b)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/price/{base_token}/{quote_token}/history")
async def dex_price_history(
    base_token: str,
    quote_token: str,
    interval: Optional[int] = Query(None, ge=60),
):
    """VWAP price history for a pair. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    try:
        data = await get_price_history(chain_id, base_token, quote_token, interval=interval)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
    return data


@router.get("/token/{token_address}")
async def dex_token(token_address: str):
    """Token metadata. Requires EKUBO_CHAIN_ID."""
    chain_id = _require_chain_id()
    try:
        data = await get_token(chain_id, token_address)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=503, detail=f"Ekubo API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")
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


class AvnuQuoteRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str  # wei as string
    slippage_bps: int = Field(default=9500, ge=0, le=10000)
    taker_address: Optional[str] = None


class AvnuQuoteResponse(BaseModel):
    venue: Literal["avnu"] = "avnu"
    quote_id: str
    amount_out: str
    amount_out_min: str
    route: list[str] = Field(default_factory=list)
    message: Optional[str] = None


class VenueQuote(BaseModel):
    venue: Literal["ekubo", "avnu"]
    amount_out: str
    amount_out_min: str
    quote_id: Optional[str] = None
    route: list[str] = Field(default_factory=list)
    message: Optional[str] = None


class AggregatedQuoteRequest(BaseModel):
    token_in: str
    token_out: str
    amount_in: str  # wei as string
    slippage_bps: int = Field(default=9500, ge=0, le=10000)
    taker_address: Optional[str] = None


class AggregatedQuoteResponse(BaseModel):
    selected_venue: Literal["ekubo", "avnu"]
    amount_out: str
    amount_out_min: str
    selected_quote_id: Optional[str] = None
    selected_route: list[str] = Field(default_factory=list)
    message: Optional[str] = None
    venues: list[VenueQuote] = Field(default_factory=list)


class DexContractCall(BaseModel):
    contract_address: str
    entrypoint: str
    calldata: list[str]


class AvnuBuildRequest(BaseModel):
    quote_id: str
    taker_address: str
    slippage_bps: int = Field(default=9500, ge=0, le=10000)
    include_approve: bool = True


class AvnuBuildResponse(BaseModel):
    venue: Literal["avnu"] = "avnu"
    chain_id: Optional[str] = None
    calls: list[DexContractCall] = Field(default_factory=list)
    message: Optional[str] = None


class DexBrainCheckRequest(BaseModel):
    user_address: str
    token0: str
    token1: str
    tvl0_total: str = "0"
    tvl1_total: str = "0"
    volume0_24h: str = "0"
    volume1_24h: str = "0"
    decision_logic: Literal["AND", "OR"] = "AND"
    include_slow_models: bool = False


class DexBrainProcessorResult(BaseModel):
    processor_id: str
    passed: bool
    score: Optional[int] = None
    threshold: Optional[int] = None
    has_proof: bool = False
    execution_time_ms: int = 0
    error: Optional[str] = None


class DexBrainCheckResponse(BaseModel):
    should_execute: bool
    decision_logic: str
    processors_run: list[str] = Field(default_factory=list)
    skipped_processors: list[str] = Field(default_factory=list)
    processor_results: list[DexBrainProcessorResult] = Field(default_factory=list)
    total_time_ms: int = 0
    constraints: dict[str, int] = Field(default_factory=dict)
    portfolio_summary: dict[str, Any] = Field(default_factory=dict)


@router.post("/quote", response_model=QuoteResponse)
async def dex_quote(body: QuoteRequest):
    """
    Get expected amount out for a swap (quote) using executable Ekubo route discovery.
    This uses the same on-chain-aware path as /ekubo/swap/build so UI quality checks are realistic.
    """
    try:
        amount_in = int(body.amount_in)
    except ValueError:
        raise HTTPException(status_code=400, detail="amount_in must be a decimal string (wei).")
    if amount_in <= 0:
        raise HTTPException(status_code=400, detail="amount_in must be positive.")

    try:
        ekubo = await _fetch_ekubo_quote(
            token_in=body.token_in,
            token_out=body.token_out,
            amount_in=amount_in,
            slippage_bps=50,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DEX unavailable: {e!s}")

    return QuoteResponse(
        amount_out=str(ekubo["amount_out"]),
        amount_out_min=str(ekubo["amount_out_min"]),
        pool_fee=None,
        pool_core_address=ekubo["pool_core_address"],
        message=ekubo["message"],
    )


@router.post("/avnu/quote", response_model=AvnuQuoteResponse)
async def dex_avnu_quote(body: AvnuQuoteRequest):
    try:
        amount_in = int(body.amount_in)
    except ValueError:
        raise HTTPException(status_code=400, detail="amount_in must be a decimal string (wei).")
    if amount_in <= 0:
        raise HTTPException(status_code=400, detail="amount_in must be positive.")

    quotes = await _fetch_avnu_quotes(
        token_in=body.token_in,
        token_out=body.token_out,
        amount_in=amount_in,
        taker_address=body.taker_address,
    )
    best, best_out = _pick_best_avnu_quote(quotes)
    if best is None or best_out <= 0:
        raise HTTPException(status_code=404, detail="No AVNU liquidity for this pair/size.")

    min_out = int(best_out * (1 - (body.slippage_bps / 10_000)))
    route = _avnu_route_summary(best)
    return AvnuQuoteResponse(
        quote_id=str(best.get("quoteId") or ""),
        amount_out=str(best_out),
        amount_out_min=str(max(0, min_out)),
        route=route,
        message=f"AVNU {str(best.get('liquiditySource') or 'DEX_AGGREGATOR')} quote.",
    )


@router.post("/aggregated-quote", response_model=AggregatedQuoteResponse)
async def dex_aggregated_quote(body: AggregatedQuoteRequest):
    try:
        amount_in = int(body.amount_in)
    except ValueError:
        raise HTTPException(status_code=400, detail="amount_in must be a decimal string (wei).")
    if amount_in <= 0:
        raise HTTPException(status_code=400, detail="amount_in must be positive.")

    venues: list[VenueQuote] = []
    errors: list[str] = []

    try:
        ekubo = await _fetch_ekubo_quote(
            token_in=body.token_in,
            token_out=body.token_out,
            amount_in=amount_in,
            slippage_bps=body.slippage_bps,
        )
        venues.append(
            VenueQuote(
                venue="ekubo",
                amount_out=str(ekubo["amount_out"]),
                amount_out_min=str(ekubo["amount_out_min"]),
                route=list(ekubo.get("route") or []),
                message=ekubo.get("message"),
            )
        )
    except HTTPException as e:
        errors.append(f"Ekubo: {e.detail}")
    except Exception as e:
        errors.append(f"Ekubo: {e!s}")

    try:
        quotes = await _fetch_avnu_quotes(
            token_in=body.token_in,
            token_out=body.token_out,
            amount_in=amount_in,
            taker_address=body.taker_address,
        )
        best, best_out = _pick_best_avnu_quote(quotes)
        if best and best_out > 0:
            min_out = int(best_out * (1 - (body.slippage_bps / 10_000)))
            venues.append(
                VenueQuote(
                    venue="avnu",
                    amount_out=str(best_out),
                    amount_out_min=str(max(0, min_out)),
                    quote_id=str(best.get("quoteId") or ""),
                    route=_avnu_route_summary(best),
                    message=f"AVNU {str(best.get('liquiditySource') or 'DEX_AGGREGATOR')} quote.",
                )
            )
    except HTTPException as e:
        errors.append(f"AVNU: {e.detail}")
    except Exception as e:
        errors.append(f"AVNU: {e!s}")

    if not venues:
        detail = "; ".join(errors) if errors else "No executable quote available."
        raise HTTPException(status_code=404, detail=detail)

    selected = _choose_aggregated_venue(venues)
    return AggregatedQuoteResponse(
        selected_venue=selected.venue,
        amount_out=selected.amount_out,
        amount_out_min=selected.amount_out_min,
        selected_quote_id=selected.quote_id,
        selected_route=selected.route,
        message=selected.message,
        venues=venues,
    )


@router.post("/avnu/build", response_model=AvnuBuildResponse)
async def dex_avnu_build(body: AvnuBuildRequest):
    taker = str(body.taker_address or "").strip()
    if not taker:
        raise HTTPException(status_code=400, detail="taker_address is required.")
    slippage = body.slippage_bps / 10_000
    if slippage < 0:
        slippage = 0
    if slippage > 1:
        slippage = 1

    req = {
        "quoteId": body.quote_id,
        "takerAddress": taker,
        "slippage": slippage,
        "includeApprove": body.include_approve,
    }
    url = f"{_AVNU_BASE_URL}/swap/v2/build"
    async with httpx.AsyncClient(timeout=_AVNU_TIMEOUT_S) as client:
        resp = await client.post(url, json=req)
    payload = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=503,
            detail=_avnu_error_detail(payload, f"AVNU build API error: {resp.status_code}"),
        )

    raw_calls = payload.get("calls")
    if not isinstance(raw_calls, list) or not raw_calls:
        raise HTTPException(status_code=503, detail="AVNU build returned no executable calls.")

    calls: list[DexContractCall] = []
    for row in raw_calls:
        if not isinstance(row, dict):
            continue
        contract_address = str(row.get("contractAddress") or row.get("contract_address") or "").strip()
        entrypoint = str(row.get("entrypoint") or row.get("entryPoint") or "").strip()
        calldata = row.get("calldata")
        if not contract_address or not entrypoint or not isinstance(calldata, list):
            continue
        calls.append(
            DexContractCall(
                contract_address=contract_address,
                entrypoint=entrypoint,
                calldata=[str(x) for x in calldata],
            )
        )
    if not calls:
        raise HTTPException(status_code=503, detail="AVNU build produced malformed calls.")

    return AvnuBuildResponse(
        chain_id=str(payload.get("chainId") or ""),
        calls=calls,
        message="AVNU build calldata ready for wallet execution.",
    )


@router.post("/brain-check", response_model=DexBrainCheckResponse)
async def dex_brain_check(body: DexBrainCheckRequest):
    """
    Run relevant marketplace zkML checks for a DEX pair snapshot.
    Fast path by default excludes slow models (e.g. credit_scoring).
    """
    tvl0 = max(0, _parse_int_like(body.tvl0_total))
    tvl1 = max(0, _parse_int_like(body.tvl1_total))
    vol0 = max(0, _parse_int_like(body.volume0_24h))
    vol1 = max(0, _parse_int_like(body.volume1_24h))

    total_tvl = max(1, tvl0 + tvl1)
    total_vol = max(0, vol0 + vol1)
    concentration = int(min(100, max(tvl0, tvl1) * 100 / total_tvl))
    diversity = 100 - concentration
    turnover = int(min(100, (total_vol * 100) / total_tvl)) if total_tvl > 0 else 0
    volatility = max(5, min(100, turnover))
    liquidity = max(10, min(100, 100 - int(max(0, 50 - (total_tvl.bit_length() * 2)))))
    drawdown = max(5, min(95, int(volatility * 0.6)))
    correlation = max(10, min(95, int(concentration * 0.8)))

    # Normalize to a bounded feature domain so risk_scoring remains interpretable.
    # The risk model expects compact magnitudes (roughly 0-100 scale features).
    base_total_assets = max(2_000, min(9_000, 2_500 + (turnover * 40)))
    asset0 = max(1, int((base_total_assets * concentration) / 100))
    asset1 = max(1, int(base_total_assets - asset0))
    avg_tvl_scaled = max(1, (asset0 + asset1) // 2)
    twap_daily_base = max(1_000, min(20_000, 1_000 + (turnover * 120)))
    daily_positions = [twap_daily_base + (twap_daily_base // 20 if i % 2 == 0 else 0) for i in range(7)]

    constraints = {
        "max_risk": 75,
        "max_correlation": 80,
        "min_diversification": 35,
        "max_twap": max(10_000, avg_tvl_scaled * 12),
        "min_credit": 600,
    }

    portfolio = {
        "assets": {
            body.token0.lower(): int(asset0),
            body.token1.lower(): int(asset1),
        },
        "volatility": int(volatility),
        "liquidity": int(liquidity),
        "drawdown": int(drawdown),
        "correlation": int(correlation),
        "daily_positions": daily_positions,
        "transaction_count": int(min(10_000, max(10, turnover * 10))),
        "successful_txns": int(min(10_000, max(8, turnover * 8))),
        "failed_txns": int(min(500, max(0, turnover // 10))),
        "tenure_days": 90,
        "repayment_rate": 95,
    }

    orchestrator = get_local_orchestrator()
    models = orchestrator.list_models()
    processors = [str(row.get("id")) for row in models if row.get("id")]
    skipped: list[str] = []
    if not body.include_slow_models:
        slow = {"credit_scoring"}
        skipped = [p for p in processors if p in slow]
        processors = [p for p in processors if p not in slow]

    if not processors:
        raise HTTPException(status_code=503, detail="No marketplace processors are available for brain checks.")

    result = await orchestrator.execute_agent(
        processors=processors,
        decision_logic={"type": body.decision_logic},
        user_address=body.user_address,
        portfolio=portfolio,
        constraints=constraints,
    )

    rows = [
        DexBrainProcessorResult(
            processor_id=r.processor_id,
            passed=bool(r.passed),
            score=r.score,
            threshold=r.threshold,
            has_proof=bool(r.proof_calldata),
            execution_time_ms=int(r.execution_time_ms or 0),
            error=r.error,
        )
        for r in result.processor_results
    ]

    return DexBrainCheckResponse(
        should_execute=bool(result.should_execute),
        decision_logic=result.decision_logic,
        processors_run=processors,
        skipped_processors=skipped,
        processor_results=rows,
        total_time_ms=int(result.total_time_ms or 0),
        constraints=constraints,
        portfolio_summary={
            "total_tvl_raw": str(total_tvl),
            "total_volume_24h_raw": str(total_vol),
            "concentration_pct": concentration,
            "diversification_pct": diversity,
            "turnover_pct": turnover,
        },
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


def _decimal_to_u128_fraction(fraction: Decimal) -> int:
    if fraction <= 0:
        return 0
    with localcontext() as ctx:
        ctx.prec = 100
        value = (fraction * Decimal(_TWO_128)).to_integral_value(rounding=ROUND_FLOOR)
    return int(value)


def _fee_to_u128(fee_raw: Any) -> int:
    """Convert fee value into Ekubo 0.128 fixed point, without float precision loss."""
    default_fee = _decimal_to_u128_fraction(Decimal("0.003"))
    if fee_raw is None or fee_raw == "":
        return default_fee

    if isinstance(fee_raw, str):
        raw = fee_raw.strip().lower()
        if not raw:
            return default_fee
        if raw.startswith("0x"):
            try:
                return int(raw, 16)
            except ValueError:
                return default_fee
        if raw.isdigit():
            parsed_int = int(raw)
            if parsed_int > 100_000:
                return parsed_int
            if parsed_int in (500, 3000, 10000):
                return _decimal_to_u128_fraction(Decimal(parsed_int) / Decimal(1_000_000))
            if 0 < parsed_int <= 100:
                return _decimal_to_u128_fraction(Decimal(parsed_int) / Decimal(100))
            return default_fee
        try:
            parsed = Decimal(raw)
        except InvalidOperation:
            return default_fee
    elif isinstance(fee_raw, int):
        if fee_raw > 100_000:
            return fee_raw
        if fee_raw in (500, 3000, 10000):
            return _decimal_to_u128_fraction(Decimal(fee_raw) / Decimal(1_000_000))
        if 0 < fee_raw <= 100:
            return _decimal_to_u128_fraction(Decimal(fee_raw) / Decimal(100))
        return default_fee
    else:
        try:
            parsed = Decimal(str(fee_raw))
        except (InvalidOperation, ValueError):
            return default_fee

    if parsed <= 0:
        return default_fee
    if parsed > 1:
        parsed = parsed / Decimal(100)
    return _decimal_to_u128_fraction(parsed)


@router.post("/swap-calldata", response_model=SwapCalldataResponse)
async def dex_swap_calldata(body: SwapCalldataRequest):
    """
    Build calldata for Router.swap(RouteNode, TokenAmount) per EkuboProtocol/starknet-contracts.
    Recommended wallet flow is transfer(token_in -> router) -> swap(...) -> clear(token_out/token_in).
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
        message="Router.swap(RouteNode, TokenAmount). Use transfer->swap->clear wallet flow for Sepolia reliability.",
    )
