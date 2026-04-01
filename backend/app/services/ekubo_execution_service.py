"""
Ekubo execution: build swap calldata (Router) for vault/orchestration; optional live submit.
Uses ekubo_config + ekubo_client; same logic as dex swap-calldata.
On-chain pool discovery: when Ekubo API fails, call Ekubo Core get_pool_price via RPC
(PoolKey: token0, token1, fee, tick_spacing, extension) to find an initialized pool.
"""
import logging
import os
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, localcontext
from typing import Any

import httpx

from app.services.ekubo_config import (
    EKUBO_CORE_SEPOLIA,
    EKUBO_ROUTER_SEPOLIA,
    SEPOLIA_ETH,
    SEPOLIA_STRK,
    SEPOLIA_USDC,
    get_ekubo_core_address,
    get_ekubo_chain_id,
    get_ekubo_router_address,
    get_starknet_rpc_for_chain,
)
from app.services.ekubo_client import get_pair_pools, get_pair_positions

logger = logging.getLogger(__name__)

# RPC fallback for on-chain Core get_pool_price discovery.
STARKNET_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia-rpc.publicnode.com")

# Ekubo Core view get_pool_price(PoolKey) -> PoolPrice; selector from starknet_py.hash.selector.get_selector_from_name("get_pool_price")
GET_POOL_PRICE_SELECTOR = 0x63ECB4395E589622A41A66715A0EAC930ABC9F0B92C0B1DCDA630ADFB2BF2D
# Ekubo Router view quote_swap(RouteNode, TokenAmount) -> Delta
ROUTER_QUOTE_SWAP_SELECTOR = 0x2904B7C28F3FD4556D8AA4F93483EA2077DD95E61C54DB86C2EA5FC1F3FFD54

# (fee_pct, tick_spacing) combos to probe when API has no pool data (EkuboProtocol/starknet-contracts PoolKey)
_POOL_DISCOVERY_COMBOS: list[tuple[float, int]] = [
    (0.0005, 1000),   # 0.05%
    (0.003, 60),      # 0.3%
    (0.01, 60),       # 1%
]

# Strategy pairs use Sepolia token addresses so Router.swap works on Starknet Sepolia
# (mainnet USDC 0x053c... is not deployed on Sepolia; we use Circle testnet USDC)
_STRATEGY_PAIR: dict[str, tuple[str, str]] = {
    "ekubo_eth_usdc": (SEPOLIA_USDC, SEPOLIA_ETH),
    "ekubo_strk_usdc": (SEPOLIA_USDC, SEPOLIA_STRK),
    "ekubo_strk_to_usdc": (SEPOLIA_STRK, SEPOLIA_USDC),  # swap STRK → USDC (e.g. get USDC from testnet STRK)
}
_MULTIHOP_INTERMEDIATES: tuple[str, ...] = (
    SEPOLIA_ETH,
    SEPOLIA_USDC,
    SEPOLIA_STRK,
)

_TWO_128 = 2**128


def _decimal_to_u128_fraction(fraction: Decimal) -> int:
    if fraction <= 0:
        return 0
    with localcontext() as ctx:
        ctx.prec = 100
        value = (fraction * Decimal(_TWO_128)).to_integral_value(rounding=ROUND_FLOOR)
    return int(value)


def _u128_from_float_fraction(fraction: float) -> int:
    if fraction <= 0:
        return 0
    return int(fraction * _TWO_128)


def _fee_candidates_from_raw(fee_raw: Any) -> list[int]:
    """
    Return candidate u128 fee values. We intentionally include:
    - precise decimal conversion
    - float-derived conversion (historically used in this codebase)
    to maximize compatibility with existing Sepolia pool keys.
    """
    seen: set[int] = set()
    out: list[int] = []

    def add(value: int) -> None:
        if value <= 0:
            return
        if value in seen:
            return
        seen.add(value)
        out.append(value)

    add(_fee_to_u128(fee_raw))
    try:
        f = float(fee_raw)
        if f > 1:
            f = f / 100.0
        add(_u128_from_float_fraction(f))
    except (TypeError, ValueError):
        pass

    return out


def _sorted_pair_tokens(token_a: str, token_b: str) -> tuple[str, str]:
    try:
        return (token_a, token_b) if int(token_a, 16) < int(token_b, 16) else (token_b, token_a)
    except (TypeError, ValueError):
        return token_a, token_b


def _fee_to_u128(fee_raw: Any) -> int:
    """
    Normalize fee into Ekubo's 0.128 fixed-point u128.
    Accepts:
    - hex/decimal u128 strings
    - decimal fractions (e.g. 0.003)
    - percentages (e.g. 0.3 -> 0.3%)
    - common fee tiers (500/3000/10000)
    """
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
                # Already a fixed-point u128.
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
        # 0.3 means 0.3%, not 30%.
        parsed = parsed / Decimal(100)
    return _decimal_to_u128_fraction(parsed)


def _felt_to_hex(value: int | str) -> str:
    """Normalize address/felt for starknet_call calldata (hex string)."""
    if isinstance(value, str):
        v = int(value, 16) if value.startswith("0x") else int(value)
    else:
        v = int(value)
    return hex(v)


def _pool_key_calldata_hex(
    token0: str, token1: str, fee_u128: int, tick_spacing: int, extension: str | int = "0"
) -> list[str]:
    """Build calldata for Core get_pool_price(pool_key). PoolKey: token0, token1, fee, tick_spacing, extension (5 felts)."""
    ext = int(extension, 16) if isinstance(extension, str) and extension.startswith("0x") else int(extension) if isinstance(extension, str) else int(extension)
    return [
        _felt_to_hex(token0),
        _felt_to_hex(token1),
        _felt_to_hex(fee_u128),
        _felt_to_hex(tick_spacing),
        _felt_to_hex(ext),
    ]


def _parse_felt(x: str | int) -> int:
    """Parse felt from RPC result (hex or decimal string, or int)."""
    if isinstance(x, int):
        return x
    s = str(x).strip()
    return int(s, 16) if s.startswith("0x") else int(s)


def _parse_int_any(x: Any, default: int = 0) -> int:
    try:
        if isinstance(x, int):
            return x
        if isinstance(x, str):
            s = x.strip()
            if not s:
                return default
            return int(s, 16) if s.startswith("0x") else int(s)
        if isinstance(x, float):
            return int(x)
        return int(str(x))
    except Exception:
        return default


def _is_negative_i129(mag: int, sign: int) -> bool:
    return mag != 0 and sign != 0


def _is_pool_initialized(result_felts: list[str]) -> bool:
    """
    PoolPrice is sqrt_ratio (u256) + tick (i129). Return can be 4 felts (low, high, tick_mag, sign)
    or 1 packed felt. Non-zero sqrt_ratio means pool is initialized.
    """
    if not result_felts:
        return False
    if len(result_felts) == 1:
        return _parse_felt(result_felts[0]) != 0
    low = _parse_felt(result_felts[0])
    high = _parse_felt(result_felts[1])
    return low != 0 or high != 0


async def _call_core_get_pool_price(
    rpc_url: str,
    core_address: str,
    token0: str,
    token1: str,
    fee_u128: int,
    tick_spacing: int,
    extension: str = "0",
    ) -> tuple[bool, list[str]]:
    """
    Call Ekubo Core get_pool_price(pool_key) via starknet_call.
    Returns (success, result_felts). On revert or RPC error, success=False.
    """
    calldata = _pool_key_calldata_hex(token0, token1, fee_u128, tick_spacing, extension)
    try:
        core_int = int(core_address, 16) if core_address.startswith("0x") else int(core_address)
    except ValueError:
        return False, []
    payload = {
        "jsonrpc": "2.0",
        "method": "starknet_call",
        "params": {
            "request": {
                "contract_address": hex(core_int),
                "entry_point_selector": hex(GET_POOL_PRICE_SELECTOR),
                "calldata": calldata,
            },
            "block_id": "latest",
        },
        "id": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(rpc_url, json=payload)
        data = response.json()
    except Exception as e:
        logger.debug("Core get_pool_price RPC request failed: %s", e)
        return False, []
    if "error" in data:
        logger.debug("Core get_pool_price RPC error: %s", data["error"])
        return False, []
    result = data.get("result") or []
    if not isinstance(result, list):
        return False, []
    felts = [str(x) for x in result]
    return True, felts


async def _call_router_quote_swap(
    rpc_url: str,
    router_address: str,
    token0: str,
    token1: str,
    fee_u128: int,
    tick_spacing: int,
    token_in: str,
    amount_in_wei: int,
    extension: str = "0",
) -> tuple[bool, list[str], str | None]:
    calldata = _pool_key_calldata_hex(token0, token1, fee_u128, tick_spacing, extension)
    if amount_in_wei < 0:
        amount_in_wei = 0
    # RouteNode = PoolKey + sqrt_ratio_limit(u256) + skip_ahead(u128)
    # TokenAmount = token + amount(i129 => mag, sign)
    calldata.extend(["0x0", "0x0", "0x0", _felt_to_hex(token_in), _felt_to_hex(amount_in_wei), "0x0"])

    payload = {
        "jsonrpc": "2.0",
        "method": "starknet_call",
        "params": {
            "request": {
                "contract_address": _felt_to_hex(router_address),
                "entry_point_selector": hex(ROUTER_QUOTE_SWAP_SELECTOR),
                "calldata": calldata,
            },
            "block_id": "latest",
        },
        "id": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(rpc_url, json=payload)
        data = response.json()
    except Exception as e:
        logger.debug("Router quote_swap RPC request failed: %s", e)
        return False, [], "RPC request failed"
    if "error" in data:
        err = data["error"]
        message = err.get("message") if isinstance(err, dict) else str(err)
        return False, [], str(message)
    result = data.get("result") or []
    if not isinstance(result, list):
        return False, [], "Invalid quote response"
    felts = [str(x) for x in result]
    return True, felts, None


async def quote_swap_output(
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    fee_u128: int,
    tick_spacing: int,
    extension: str = "0",
    rpc_url: str | None = None,
    chain_id: str | None = None,
) -> dict[str, Any]:
    """
    Quote Router.swap for a single pool key and return output amount for token_out.
    Returns {"ok": bool, "amount_out": int, "error": str | None}.
    """
    try:
        ti, to = token_in, token_out
        token0 = ti if int(ti, 16) < int(to, 16) else to
        token1 = to if token0 == ti else ti
    except (ValueError, TypeError):
        return {"ok": False, "amount_out": 0, "error": "Invalid token address"}

    resolved_chain_id = chain_id or get_ekubo_chain_id()
    url = rpc_url or get_starknet_rpc_for_chain(resolved_chain_id) or STARKNET_RPC_URL
    if not url:
        return {"ok": False, "amount_out": 0, "error": "RPC unavailable"}
    router_address = get_ekubo_router_address(resolved_chain_id)

    ok, result, err = await _call_router_quote_swap(
        rpc_url=url,
        router_address=router_address,
        token0=token0,
        token1=token1,
        fee_u128=fee_u128,
        tick_spacing=tick_spacing,
        token_in=token_in,
        amount_in_wei=amount_in_wei,
        extension=extension,
    )
    if not ok:
        return {"ok": False, "amount_out": 0, "error": err or "Quote failed"}
    if len(result) < 4:
        return {"ok": False, "amount_out": 0, "error": "Malformed quote response"}

    amount0_mag = _parse_felt(result[0])
    amount0_sign = _parse_felt(result[1])
    amount1_mag = _parse_felt(result[2])
    amount1_sign = _parse_felt(result[3])

    amount_out = 0
    if token_out.lower() == token0.lower() and _is_negative_i129(amount0_mag, amount0_sign):
        amount_out = amount0_mag
    elif token_out.lower() == token1.lower() and _is_negative_i129(amount1_mag, amount1_sign):
        amount_out = amount1_mag
    return {"ok": True, "amount_out": amount_out, "error": None}


async def quote_multihop_output(
    route_nodes: list[dict[str, Any]],
    token_in: str,
    amount_in_wei: int,
    rpc_url: str | None = None,
) -> dict[str, Any]:
    """
    Sequentially quote a multihop route by chaining quote_swap_output per node.
    Returns {"ok", "amount_out", "route", "error"}.
    """
    if amount_in_wei <= 0:
        return {"ok": False, "amount_out": 0, "route": [token_in], "error": "Invalid amount"}

    current_token = token_in
    current_amount = amount_in_wei
    route_tokens = [token_in]

    for node in route_nodes:
        token0 = str(node.get("token0") or "")
        token1 = str(node.get("token1") or "")
        if not token0 or not token1:
            return {"ok": False, "amount_out": 0, "route": route_tokens, "error": "Malformed multihop node"}
        if current_token.lower() == token0.lower():
            next_token = token1
        elif current_token.lower() == token1.lower():
            next_token = token0
        else:
            return {
                "ok": False,
                "amount_out": 0,
                "route": route_tokens,
                "error": f"Route token mismatch: {current_token} not in node {token0}/{token1}",
            }

        quote = await quote_swap_output(
            token_in=current_token,
            token_out=next_token,
            amount_in_wei=current_amount,
            fee_u128=int(node["fee_u128"]),
            tick_spacing=int(node["tick_spacing"]),
            extension=str(node.get("extension") or "0"),
            rpc_url=rpc_url,
        )
        if not quote.get("ok"):
            return {"ok": False, "amount_out": 0, "route": route_tokens, "error": quote.get("error")}
        out_amount = int(quote.get("amount_out") or 0)
        if out_amount <= 0:
            return {"ok": False, "amount_out": 0, "route": route_tokens, "error": "Zero output on route hop"}

        current_token = next_token
        current_amount = out_amount
        route_tokens.append(current_token)

    return {"ok": True, "amount_out": current_amount, "route": route_tokens, "error": None}


async def discover_pool_on_chain(
    token_in: str,
    token_out: str,
    amount_in_wei: int | None = None,
    rpc_url: str | None = None,
    chain_id: str | None = None,
) -> dict[str, Any] | None:
    """
    Discover an initialized Ekubo pool for (token_in, token_out) by calling Core get_pool_price
    for a set of (fee, tick_spacing) combos. token0 < token1 by integer value.
    Returns {"token0","token1","fee_u128","tick_spacing","extension","amount_out"} or None.
    """
    try:
        ti, to = token_in, token_out
        t0 = ti if int(ti, 16) < int(to, 16) else to
        t1 = to if t0 == ti else ti
    except (ValueError, TypeError):
        return None
    resolved_chain_id = chain_id or get_ekubo_chain_id()
    url = rpc_url or get_starknet_rpc_for_chain(resolved_chain_id) or STARKNET_RPC_URL
    if not url:
        return None
    core_address = get_ekubo_core_address(resolved_chain_id)
    for fee_pct, tick_spacing in _POOL_DISCOVERY_COMBOS:
        for fee_u128 in _fee_candidates_from_raw(str(fee_pct)):
            ok, felts = await _call_core_get_pool_price(
                url, core_address, t0, t1, fee_u128, tick_spacing, "0"
            )
            if not (ok and _is_pool_initialized(felts)):
                continue
            if amount_in_wei is not None and amount_in_wei > 0:
                quote = await quote_swap_output(
                    token_in=token_in,
                    token_out=token_out,
                    amount_in_wei=amount_in_wei,
                    fee_u128=fee_u128,
                    tick_spacing=tick_spacing,
                    extension="0",
                    rpc_url=url,
                    chain_id=resolved_chain_id,
                )
                if not quote.get("ok") or int(quote.get("amount_out") or 0) <= 0:
                    continue
                return {
                    "token0": t0,
                    "token1": t1,
                    "fee_u128": fee_u128,
                    "tick_spacing": tick_spacing,
                    "extension": "0",
                    "amount_out": int(quote.get("amount_out") or 0),
                }
            return {
                "token0": t0,
                "token1": t1,
                "fee_u128": fee_u128,
                "tick_spacing": tick_spacing,
                "extension": "0",
                "amount_out": None,
            }
    return None


async def discover_pool_from_positions(
    chain_id: str,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
) -> dict[str, Any] | None:
    """
    Discover viable pool params from pair top-positions endpoint, then verify executable output
    with on-chain Router.quote_swap for the requested amount.
    """
    try:
        payload = await get_pair_positions(chain_id, token_in, token_out)
    except httpx.HTTPStatusError as e:
        logger.warning("Ekubo API error for pair positions: %s", e.response.status_code)
        return None
    except Exception as e:
        logger.warning("Ekubo pair positions failed: %s", e)
        return None

    raw_positions = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(raw_positions, list):
        return None

    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int, int, str]] = set()
    for row in raw_positions:
        if not isinstance(row, dict):
            continue
        pool_key = row.get("pool_key")
        if not isinstance(pool_key, dict):
            continue
        token0 = str(pool_key.get("token0") or "")
        token1 = str(pool_key.get("token1") or "")
        if not token0 or not token1:
            continue
        fee_u128 = _parse_int_any(pool_key.get("fee"), 0)
        tick_spacing = _parse_int_any(pool_key.get("tick_spacing"), 0)
        extension = str(pool_key.get("extension") or "0")
        if fee_u128 <= 0 or tick_spacing <= 0:
            continue
        key = (token0.lower(), token1.lower(), fee_u128, tick_spacing, extension.lower())
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "token0": token0,
                "token1": token1,
                "fee_u128": fee_u128,
                "tick_spacing": tick_spacing,
                "extension": extension,
                "liquidity": _parse_int_any(row.get("liquidity"), 0),
            }
        )

    if not candidates:
        return None

    candidates.sort(key=lambda item: int(item.get("liquidity") or 0), reverse=True)
    best: dict[str, Any] | None = None
    for candidate in candidates:
        quote = await quote_swap_output(
            token_in=token_in,
            token_out=token_out,
            amount_in_wei=amount_in_wei,
            fee_u128=int(candidate["fee_u128"]),
            tick_spacing=int(candidate["tick_spacing"]),
            extension=str(candidate.get("extension") or "0"),
            chain_id=chain_id,
        )
        out_amount = int(quote.get("amount_out") or 0)
        if quote.get("ok") and out_amount > 0:
            if best is None or out_amount > int(best.get("amount_out") or 0):
                best = {
                    "token0": str(candidate["token0"]),
                    "token1": str(candidate["token1"]),
                    "fee_u128": int(candidate["fee_u128"]),
                    "tick_spacing": int(candidate["tick_spacing"]),
                    "extension": str(candidate.get("extension") or "0"),
                    "amount_out": out_amount,
                }
    return best


def _sorted_pool_candidates(top_pools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        top_pools,
        key=lambda p: float(p.get("tvl0_total", 0) or 0) + float(p.get("tvl1_total", 0) or 0),
        reverse=True,
    )


def _calc_min_out(expected_out: int | None, slippage_bps: int) -> int:
    if expected_out is None:
        return 0
    try:
        out = max(0, int(expected_out))
    except Exception:
        return 0
    bps = max(0, min(10_000, int(slippage_bps or 0)))
    return max(0, (out * (10_000 - bps)) // 10_000)


def _build_swap_calldata_with_pool_params(
    router_address: str,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    fee_u128: int,
    tick_spacing: int,
    extension: str = "0",
    expected_out: int | None = None,
    route: list[str] | None = None,
    slippage_bps: int = 50,
) -> dict[str, Any]:
    """Build Router.swap calldata using given pool params (from API or on-chain discovery)."""
    try:
        ti, to = token_in, token_out
        t0 = ti if int(ti, 16) < int(to, 16) else to
        t1 = to if t0 == ti else ti
    except ValueError:
        t0, t1 = token_in, token_out
    sqrt_low, sqrt_high, skip_ahead = 0, 0, 0
    min_out_wei = _calc_min_out(expected_out, slippage_bps)
    if amount_in_wei < 0:
        amount_in_wei = 0
    # Router.swap(RouteNode, TokenAmount) expects i129 sign (bool) as final felt.
    # For exact-input swaps we always use sign=0 (positive amount).
    calldata = [
        t0, t1, str(fee_u128), str(tick_spacing), extension,
        str(sqrt_low), str(sqrt_high), str(skip_ahead),
        token_in, str(amount_in_wei), "0",
    ]
    result: dict[str, Any] = {
        "contract_address": router_address,
        "entrypoint": "swap",
        "calldata": calldata,
        "error": None,
        "route": route or [token_in, token_out],
    }
    if expected_out is not None:
        result["expected_out"] = str(expected_out)
        result["min_out"] = str(min_out_wei)
    return result


def _build_multihop_calldata(
    router_address: str,
    token_in: str,
    amount_in_wei: int,
    route_nodes: list[dict[str, Any]],
    route_tokens: list[str],
    expected_out: int,
    slippage_bps: int = 50,
) -> dict[str, Any]:
    min_out_wei = _calc_min_out(expected_out, slippage_bps)
    if amount_in_wei < 0:
        amount_in_wei = 0
    calldata: list[str] = [str(len(route_nodes))]
    for node in route_nodes:
        token0 = str(node["token0"])
        token1 = str(node["token1"])
        calldata.extend(
            [
                token0,
                token1,
                str(int(node["fee_u128"])),
                str(int(node["tick_spacing"])),
                str(node.get("extension") or "0"),
                "0",
                "0",
                "0",
            ]
        )
    # Router.multihop_swap(Array<RouteNode>, TokenAmount): final felt is i129 sign.
    # Keep min_out as metadata for UI only; it is not part of this entrypoint calldata.
    calldata.extend([token_in, str(amount_in_wei), "0"])
    return {
        "contract_address": router_address,
        "entrypoint": "multihop_swap",
        "calldata": calldata,
        "error": None,
        "route": route_tokens,
        "expected_out": str(expected_out),
        "min_out": str(min_out_wei),
    }


async def _discover_multihop_route(
    chain_id: str,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    token_in_l = token_in.lower()
    token_out_l = token_out.lower()

    for intermediate in _MULTIHOP_INTERMEDIATES:
        mid_l = intermediate.lower()
        if mid_l in {token_in_l, token_out_l}:
            continue

        hop1 = await discover_pool_from_positions(
            chain_id=chain_id,
            token_in=token_in,
            token_out=intermediate,
            amount_in_wei=amount_in_wei,
        )
        if not hop1:
            hop1 = await discover_pool_on_chain(
                token_in=token_in,
                token_out=intermediate,
                amount_in_wei=amount_in_wei,
                chain_id=chain_id,
            )
        if not hop1:
            continue
        out1 = int(hop1.get("amount_out") or 0)
        if out1 <= 0:
            continue

        hop2 = await discover_pool_from_positions(
            chain_id=chain_id,
            token_in=intermediate,
            token_out=token_out,
            amount_in_wei=out1,
        )
        if not hop2:
            hop2 = await discover_pool_on_chain(
                token_in=intermediate,
                token_out=token_out,
                amount_in_wei=out1,
                chain_id=chain_id,
            )
        if not hop2:
            continue
        out2 = int(hop2.get("amount_out") or 0)
        if out2 <= 0:
            continue

        route_nodes = [
            {
                "token0": str(hop1["token0"]),
                "token1": str(hop1["token1"]),
                "fee_u128": int(hop1["fee_u128"]),
                "tick_spacing": int(hop1["tick_spacing"]),
                "extension": str(hop1.get("extension") or "0"),
            },
            {
                "token0": str(hop2["token0"]),
                "token1": str(hop2["token1"]),
                "fee_u128": int(hop2["fee_u128"]),
                "tick_spacing": int(hop2["tick_spacing"]),
                "extension": str(hop2.get("extension") or "0"),
            },
        ]
        route_tokens = [token_in, intermediate, token_out]
        candidates.append(
            {
                "route_nodes": route_nodes,
                "route_tokens": route_tokens,
                "expected_out": out2,
            }
        )

    if not candidates:
        return None

    return max(candidates, key=lambda c: int(c.get("expected_out") or 0))


async def build_swap_calldata(
    chain_id: str,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    slippage_bps: int = 50,
) -> dict[str, Any]:
    """
    Build Router.swap calldata for Ekubo Sepolia.
    Returns { "contract_address", "entrypoint", "calldata" } for frontend to sign, or for executor to submit.
    """
    top_pools: list[dict[str, Any]] = []
    router_address = get_ekubo_router_address(chain_id)
    try:
        pools_data = await get_pair_pools(chain_id, token_in, token_out, min_tvl_usd=0)
        raw_top = pools_data.get("topPools")
        if isinstance(raw_top, list):
            top_pools = [p for p in raw_top if isinstance(p, dict)]
    except httpx.HTTPStatusError as e:
        logger.warning("Ekubo API error for pair pools: %s", e.response.status_code)
    except Exception as e:
        logger.warning("Ekubo pair pools failed: %s", e)

    if top_pools:
        for candidate in _sorted_pool_candidates(top_pools):
            tick_spacing = _parse_int_any(candidate.get("tick_spacing"), 60)
            extension = (candidate.get("extension") or "0").strip() or "0"
            for fee_u128 in _fee_candidates_from_raw(candidate.get("fee")):
                quote = await quote_swap_output(
                    token_in=token_in,
                    token_out=token_out,
                    amount_in_wei=amount_in_wei,
                    fee_u128=fee_u128,
                    tick_spacing=tick_spacing,
                    extension=extension,
                    chain_id=chain_id,
                )
                if quote.get("ok") and int(quote.get("amount_out") or 0) > 0:
                    return _build_swap_calldata_with_pool_params(
                        router_address=router_address,
                        token_in=token_in,
                        token_out=token_out,
                        amount_in_wei=amount_in_wei,
                        fee_u128=fee_u128,
                        tick_spacing=tick_spacing,
                        extension=extension,
                        expected_out=int(quote.get("amount_out") or 0),
                        route=[token_in, token_out],
                        slippage_bps=slippage_bps,
                    )
                logger.info(
                    "Skipping non-viable Ekubo API pool candidate fee=%s spacing=%s (quote_out=%s err=%s)",
                    fee_u128,
                    tick_spacing,
                    quote.get("amount_out"),
                    quote.get("error"),
                )

    discovered_from_positions = await discover_pool_from_positions(
        chain_id=chain_id,
        token_in=token_in,
        token_out=token_out,
        amount_in_wei=amount_in_wei,
    )
    if discovered_from_positions:
        logger.info(
            "Ekubo swap calldata: using position-derived pool params fee_u128=%s spacing=%s",
            discovered_from_positions.get("fee_u128"),
            discovered_from_positions.get("tick_spacing"),
        )
        return _build_swap_calldata_with_pool_params(
            router_address=router_address,
            token_in=token_in,
            token_out=token_out,
            amount_in_wei=amount_in_wei,
            fee_u128=int(discovered_from_positions["fee_u128"]),
            tick_spacing=int(discovered_from_positions["tick_spacing"]),
            extension=str(discovered_from_positions.get("extension") or "0"),
            expected_out=int(discovered_from_positions.get("amount_out") or 0),
            route=[token_in, token_out],
            slippage_bps=slippage_bps,
        )

    discovered = await discover_pool_on_chain(
        token_in,
        token_out,
        amount_in_wei=amount_in_wei,
        chain_id=chain_id,
    )
    if discovered:
        logger.info(
            "Ekubo swap calldata fallback: using discovered pool params fee_u128=%s spacing=%s",
            discovered.get("fee_u128"),
            discovered.get("tick_spacing"),
        )
        return _build_swap_calldata_with_pool_params(
            router_address=router_address,
            token_in=token_in,
            token_out=token_out,
            amount_in_wei=amount_in_wei,
            fee_u128=int(discovered["fee_u128"]),
            tick_spacing=int(discovered["tick_spacing"]),
            extension=str(discovered.get("extension") or "0"),
            expected_out=int(discovered.get("amount_out") or 0),
            route=[token_in, token_out],
            slippage_bps=slippage_bps,
        )

    multihop = await _discover_multihop_route(
        chain_id=chain_id,
        token_in=token_in,
        token_out=token_out,
        amount_in_wei=amount_in_wei,
    )
    if multihop:
        logger.info(
            "Ekubo multihop route found %s with expected_out=%s",
            " -> ".join(multihop["route_tokens"]),
            multihop["expected_out"],
        )
        return _build_multihop_calldata(
            router_address=router_address,
            token_in=token_in,
            amount_in_wei=amount_in_wei,
            route_nodes=multihop["route_nodes"],
            route_tokens=multihop["route_tokens"],
            expected_out=int(multihop["expected_out"]),
            slippage_bps=slippage_bps,
        )

    logger.warning("No executable Ekubo pool route found for %s -> %s", token_in, token_out)
    return {
        "contract_address": None,
        "entrypoint": None,
        "calldata": None,
        "error": "No executable Ekubo liquidity for this pair on the selected network (quote output is zero or pool uninitialized).",
    }


def strategy_to_pair(strategy: str) -> tuple[str, str] | None:
    """Return (token_in, token_out) for a strategy id, or None."""
    return _STRATEGY_PAIR.get((strategy or "").strip().lower())


def _build_swap_calldata_fallback(
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    router_address: str = EKUBO_ROUTER_SEPOLIA,
) -> dict[str, Any]:
    """
    Build Router.swap calldata using fixed Sepolia pool params when Ekubo API is unavailable.
    Uses 0.05% fee, tick_spacing 1000 (mainnet-style). If you get NOT_INITIALIZED on-chain,
    no such pool exists on Sepolia yet; use Ekubo UI to confirm which pools are live.
    """
    try:
        ti, to = token_in, token_out
        t0 = ti if int(ti, 16) < int(to, 16) else to
        t1 = to if t0 == ti else ti
    except ValueError:
        t0, t1 = token_in, token_out
    # 0.05% fee (mainnet-style); tick_spacing 1000
    fee_u128 = _decimal_to_u128_fraction(Decimal("0.0005"))
    tick_spacing = 1000
    extension = "0"
    sqrt_low, sqrt_high, skip_ahead = 0, 0, 0
    if amount_in_wei < 0:
        amount_in_wei = 0
    calldata = [
        t0, t1, str(fee_u128), str(tick_spacing), extension,
        str(sqrt_low), str(sqrt_high), str(skip_ahead),
        token_in, str(amount_in_wei), "0",
    ]
    return {
        "contract_address": router_address,
        "entrypoint": "swap",
        "calldata": calldata,
        "error": None,
    }


async def build_calldata_for_allocation(
    strategy: str,
    amount_in_wei: int,
    chain_id: str | None = None,
) -> dict[str, Any]:
    """
    Build swap calldata for one allocation (strategy + amount in wei).
    Uses Ekubo API first. When API fails (e.g. 500 for Sepolia), runs on-chain pool discovery
    via Ekubo Core get_pool_price; if an initialized pool is found, returns swap calldata with
    that pool. Otherwise returns error and suggests app.ekubo.org.
    """
    chain_id = chain_id or get_ekubo_chain_id()
    if not chain_id:
        return {"error": "EKUBO_CHAIN_ID not set", "contract_address": None, "entrypoint": None, "calldata": None}
    pair = strategy_to_pair(strategy)
    if not pair:
        return {"error": f"Unknown strategy: {strategy}", "contract_address": None, "entrypoint": None, "calldata": None}
    token_in, token_out = pair
    result = await build_swap_calldata(chain_id, token_in, token_out, amount_in_wei)
    if not result.get("error"):
        return result
    # API failed: try on-chain discovery (Core get_pool_price for known fee/tick_spacing combos)
    discovered = await discover_pool_on_chain(
        token_in,
        token_out,
        amount_in_wei=amount_in_wei,
        chain_id=chain_id,
    )
    if discovered:
        return _build_swap_calldata_with_pool_params(
            get_ekubo_router_address(chain_id),
            token_in,
            token_out,
            amount_in_wei,
            discovered["fee_u128"],
            discovered["tick_spacing"],
            discovered.get("extension") or "0",
            expected_out=int(discovered.get("amount_out") or 0) if discovered.get("amount_out") is not None else None,
        )
    return {
        "error": "Ekubo API unavailable for Sepolia; no pool data. Swap at app.ekubo.org (Starknet Sepolia).",
        "contract_address": None,
        "entrypoint": None,
        "calldata": None,
    }


async def submit_swap(
    contract_address: str,
    entrypoint: str,
    calldata: list[str],
    *,
    network_id: str = "starknet_sepolia",
) -> str | None:
    """
    Submit a swap via ContractExecutor when EXECUTOR_LIVE_SUBMIT and account are set.
    Returns tx hash or None (e.g. not configured or invoke failed).
    """
    if not contract_address or not entrypoint or not calldata:
        return None
    try:
        from app.services.contract_executor import ContractExecutor
        ex = ContractExecutor()
        if not ex.can_submit_live(network_id):
            return None
        return await ex._invoke(
            contract_address,
            entrypoint,
            [str(x) for x in calldata],
            network_id=network_id,
        )
    except Exception as e:
        logger.warning("submit_swap failed: %s", e)
        return None


async def build_lp_add_calldata(
    chain_id: str,
    owner: str,
    token0: str,
    token1: str,
    amount0_wei: int,
    amount1_wei: int,
    fee_tier: int,
    lower_tick: int | None = None,
    upper_tick: int | None = None,
    risk_profile: str | None = None,
) -> dict[str, Any]:
    """
    Build Ekubo LP add-liquidity calldata via ekubo_lp_service.
    Returns approvals + calls compatible with frontend wallet execute.
    """
    from app.services.ekubo_lp_service import build_lp_add, preview_lp_position

    if lower_tick is None or upper_tick is None:
        preview = await preview_lp_position(
            chain_id=chain_id,
            token0=token0,
            token1=token1,
            amount0=amount0_wei,
            amount1=amount1_wei,
            fee_tier=fee_tier,
            lower_tick=None,
            upper_tick=None,
            risk_profile=risk_profile,
        )
        lower_tick = int(preview["lower_tick"])
        upper_tick = int(preview["upper_tick"])

    return await build_lp_add(
        chain_id=chain_id,
        owner=owner,
        token0=token0,
        token1=token1,
        amount0=amount0_wei,
        amount1=amount1_wei,
        fee_tier=fee_tier,
        lower_tick=lower_tick,
        upper_tick=upper_tick,
        risk_profile=risk_profile,
    )


async def build_lp_remove_calldata(owner: str, position_id: str, liquidity_bps: int = 10_000) -> dict[str, Any]:
    """Build Ekubo LP remove-liquidity calldata via ekubo_lp_service."""
    from app.services.ekubo_lp_service import build_lp_remove

    return await build_lp_remove(owner=owner, position_id=position_id, liquidity_bps=liquidity_bps)
