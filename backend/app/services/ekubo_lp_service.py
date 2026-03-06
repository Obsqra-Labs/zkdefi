"""Ekubo LP service: preview/build calldata and lightweight position tracking."""

from __future__ import annotations

import json
import logging
import math
import os
import uuid
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, localcontext
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.services.ekubo_client import get_pair_pools
from app.services.ekubo_config import (
    EKUBO_CORE_SEPOLIA,
    EKUBO_POSITIONS_SEPOLIA,
    EKUBO_POSITIONS_NFT_SEPOLIA,
)

logger = logging.getLogger(__name__)

_TWO_128 = 2**128
_DEFAULT_EXTENSION = "0"

# Risk-profile width in ticks for guided mode.
_RISK_WIDTH_TICKS: dict[str, int] = {
    "conservative": 6000,
    "neutral": 3000,
    "aggressive": 1200,
}

# Common tick-spacing defaults by fee tier (Uniswap-style fee tier encoding).
_FEE_TIER_TO_SPACING: dict[int, int] = {
    500: 1000,   # 0.05%
    3000: 60,    # 0.30%
    10000: 60,   # 1.00%
}


def _positions_store_path() -> Path:
    raw = os.getenv("EKUBO_POSITIONS_FILE")
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[2] / "data" / "ekubo_positions.json"


def _load_positions() -> list[dict[str, Any]]:
    path = _positions_store_path()
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = payload.get("positions")
    return rows if isinstance(rows, list) else []


def _save_positions(positions: list[dict[str, Any]]) -> None:
    path = _positions_store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "positions": positions,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_token_sort(token_a: str, token_b: str) -> tuple[str, str]:
    try:
        a = int(token_a, 16) if str(token_a).startswith("0x") else int(token_a)
        b = int(token_b, 16) if str(token_b).startswith("0x") else int(token_b)
    except Exception:
        return token_a, token_b
    return (token_a, token_b) if a <= b else (token_b, token_a)


def _fee_tier_to_fraction(fee_tier: int) -> float:
    """
    Convert fee tier to fraction.

    Supports typical values:
    - 500 -> 0.0005 (0.05%)
    - 3000 -> 0.003 (0.30%)
    - 10000 -> 0.01 (1.00%)
    """
    if fee_tier <= 0:
        return 0.003
    if fee_tier >= 100:
        return fee_tier / 1_000_000
    return fee_tier / 10_000


def _decimal_to_u128_fraction(fraction: Decimal) -> int:
    if fraction <= 0:
        return 0
    with localcontext() as ctx:
        ctx.prec = 100
        value = (fraction * Decimal(_TWO_128)).to_integral_value(rounding=ROUND_FLOOR)
    return int(value)


def _fee_to_u128_from_tier(fee_tier: int) -> int:
    return _decimal_to_u128_fraction(Decimal(str(_fee_tier_to_fraction(fee_tier))))


def _fee_to_u128_from_raw(fee_raw: Any, fallback_fee_tier: int) -> int:
    if fee_raw in (None, ""):
        return _fee_to_u128_from_tier(fallback_fee_tier)
    if isinstance(fee_raw, str):
        raw = fee_raw.strip().lower()
        if not raw:
            return _fee_to_u128_from_tier(fallback_fee_tier)
        if raw.startswith("0x"):
            try:
                return int(raw, 16)
            except ValueError:
                return _fee_to_u128_from_tier(fallback_fee_tier)
        if raw.isdigit():
            parsed_int = int(raw)
            if parsed_int > 100_000:
                return parsed_int
            if parsed_int in (500, 3000, 10000):
                return _decimal_to_u128_fraction(Decimal(parsed_int) / Decimal(1_000_000))
            if 0 < parsed_int <= 100:
                return _decimal_to_u128_fraction(Decimal(parsed_int) / Decimal(100))
            return _fee_to_u128_from_tier(fallback_fee_tier)
        try:
            parsed = Decimal(raw)
        except InvalidOperation:
            return _fee_to_u128_from_tier(fallback_fee_tier)
    else:
        try:
            parsed = Decimal(str(fee_raw))
        except (InvalidOperation, ValueError):
            return _fee_to_u128_from_tier(fallback_fee_tier)

    if parsed <= 0:
        return _fee_to_u128_from_tier(fallback_fee_tier)
    if parsed > 1:
        parsed = parsed / Decimal(100)
    return _decimal_to_u128_fraction(parsed)


def _estimate_mid_tick(best_pool: dict[str, Any]) -> int:
    tvl0 = float(best_pool.get("tvl0_total") or 0)
    tvl1 = float(best_pool.get("tvl1_total") or 0)
    if tvl0 <= 0 or tvl1 <= 0:
        return 0
    ratio = tvl1 / tvl0
    if ratio <= 0:
        return 0
    tick = int(math.log(ratio) / math.log(1.0001))
    return max(-887272, min(887272, tick))


def _align_tick(tick: int, tick_spacing: int, up: bool = False) -> int:
    spacing = max(1, int(tick_spacing or 1))
    if up:
        return int(math.ceil(tick / spacing) * spacing)
    return int(math.floor(tick / spacing) * spacing)


def _width_for_risk_profile(risk_profile: str | None) -> int:
    key = (risk_profile or "neutral").strip().lower()
    return _RISK_WIDTH_TICKS.get(key, _RISK_WIDTH_TICKS["neutral"])


def _select_best_pool(top_pools: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not top_pools:
        return None
    return max(
        top_pools,
        key=lambda p: float(p.get("tvl0_total", 0) or 0) + float(p.get("tvl1_total", 0) or 0),
    )


def _pool_params(best_pool: dict[str, Any] | None, fee_tier: int) -> tuple[int, int, str]:
    tick_spacing = _FEE_TIER_TO_SPACING.get(fee_tier, 60)
    extension = _DEFAULT_EXTENSION
    fee_u128 = _fee_to_u128_from_tier(fee_tier)

    if best_pool:
        try:
            tick_spacing = int(best_pool.get("tick_spacing") or tick_spacing)
        except Exception:
            pass
        extension = str(best_pool.get("extension") or extension)
        fee_u128 = _fee_to_u128_from_raw(best_pool.get("fee"), fee_tier)

    return fee_u128, tick_spacing, extension


async def _get_pool_current_tick(
    token0: str,
    token1: str,
    fee_u128: int,
    tick_spacing: int,
    extension: str = "0",
) -> int | None:
    """Fetch current tick for an exact pool key via Ekubo Core.get_pool_price."""
    from starknet_py.hash.selector import get_selector_from_name

    rpc_url = os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia")
    selector = hex(get_selector_from_name("get_pool_price"))

    sorted_t0, sorted_t1 = _parse_token_sort(token0, token1)
    calldata = [
        sorted_t0,
        sorted_t1,
        hex(int(fee_u128)),
        hex(int(tick_spacing)),
        hex(int(str(extension), 0) if str(extension).startswith("0x") else int(str(extension))),
    ]

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "starknet_call",
        "params": {
            "request": {
                "contract_address": EKUBO_CORE_SEPOLIA,
                "entry_point_selector": selector,
                "calldata": calldata,
            },
            "block_id": "latest",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.post(rpc_url, json=payload)
            data = r.json()
    except Exception:
        return None

    result = data.get("result") or []
    if len(result) < 4:
        return None
    tick_mag = int(result[2], 16)
    tick_sign = int(result[3], 16)
    return -tick_mag if tick_sign else tick_mag


async def preview_lp_position(
    chain_id: str,
    token0: str,
    token1: str,
    amount0: int,
    amount1: int,
    fee_tier: int,
    lower_tick: int | None = None,
    upper_tick: int | None = None,
    risk_profile: str | None = None,
) -> dict[str, Any]:
    warnings: list[str] = []
    top_pools: list[dict[str, Any]] = []

    try:
        pools = await get_pair_pools(chain_id, token0, token1, min_tvl_usd=0)
        raw_top = pools.get("topPools")
        if isinstance(raw_top, list):
            top_pools = [p for p in raw_top if isinstance(p, dict)]
    except httpx.HTTPStatusError as exc:
        warnings.append(f"Ekubo pool fetch failed (HTTP {exc.response.status_code}). Using local defaults.")
    except Exception:
        warnings.append("Ekubo pool fetch failed. Using local defaults.")

    best = _select_best_pool(top_pools)
    fee_u128, tick_spacing, extension = _pool_params(best, fee_tier)

    if lower_tick is not None and upper_tick is not None:
        lower = int(lower_tick)
        upper = int(upper_tick)
    else:
        mid = _estimate_mid_tick(best or {})
        width = _width_for_risk_profile(risk_profile)
        lower = mid - width
        upper = mid + width

    lower_aligned = _align_tick(lower, tick_spacing, up=False)
    upper_aligned = _align_tick(upper, tick_spacing, up=True)

    if lower_aligned >= upper_aligned:
        upper_aligned = lower_aligned + max(1, tick_spacing)
        warnings.append("Tick range was invalid and has been auto-adjusted.")

    tvl0 = float((best or {}).get("tvl0_total") or 0)
    tvl1 = float((best or {}).get("tvl1_total") or 0)
    total_tvl = max(tvl0 + tvl1, 1.0)
    deposited = max(amount0, 0) + max(amount1, 0)

    # Amounts may use token decimals; this is an approximate share metric for UI ranking.
    estimated_share = min(0.999999, max(0.0, deposited / (deposited + (total_tvl * 1e6))))

    volume0 = float((best or {}).get("volume0_24h") or 0)
    volume1 = float((best or {}).get("volume1_24h") or 0)
    volume = max(volume0 + volume1, 0)
    fee_fraction = _fee_tier_to_fraction(fee_tier)
    if best and best.get("fee") not in (None, ""):
        try:
            raw_fee = float(best.get("fee"))
            fee_fraction = raw_fee if raw_fee <= 0.05 else raw_fee / 100.0
        except Exception:
            pass

    est_fees_apr = max(0.0, (volume / max(total_tvl, 1.0)) * fee_fraction * 365.0 * 100.0)

    current_tick = await _get_pool_current_tick(
        token0=token0,
        token1=token1,
        fee_u128=fee_u128,
        tick_spacing=tick_spacing,
        extension=extension,
    )

    single_sided_expected = False
    single_sided_side = "none"
    if current_tick is not None:
        if current_tick < lower_aligned:
            single_sided_expected = True
            single_sided_side = "token0"
            warnings.append(
                f"Current tick {current_tick} is below your lower tick {lower_aligned}. "
                "This position is out of range and will be single-sided in token0 until price re-enters range."
            )
        elif current_tick > upper_aligned:
            single_sided_expected = True
            single_sided_side = "token1"
            warnings.append(
                f"Current tick {current_tick} is above your upper tick {upper_aligned}. "
                "This position is out of range and will be single-sided in token1 until price re-enters range."
            )

    if amount0 <= 0 or amount1 <= 0:
        warnings.append("Amounts should be positive for both tokens.")
    if amount0 > 0 and amount1 > 0:
        imbalance = max(amount0, amount1) / max(min(amount0, amount1), 1)
        if imbalance > 10:
            warnings.append("Token amounts are heavily imbalanced; capital efficiency may be reduced.")

    return {
        "lower_tick": int(lower_aligned),
        "upper_tick": int(upper_aligned),
        "current_tick": current_tick,
        "single_sided_expected": single_sided_expected,
        "single_sided_side": single_sided_side,
        "estimated_share": f"{estimated_share:.8f}",
        "estimated_fees_apr": round(est_fees_apr, 2),
        "warnings": warnings,
        "pool": {
            "fee_u128": str(fee_u128),
            "tick_spacing": int(tick_spacing),
            "extension": extension,
            "best_pool_core": (best or {}).get("core_address"),
        },
    }


async def build_lp_add(
    chain_id: str,
    owner: str,
    token0: str,
    token1: str,
    amount0: int,
    amount1: int,
    fee_tier: int,
    lower_tick: int,
    upper_tick: int,
    risk_profile: str | None = None,
) -> dict[str, Any]:
    preview = await preview_lp_position(
        chain_id=chain_id,
        token0=token0,
        token1=token1,
        amount0=amount0,
        amount1=amount1,
        fee_tier=fee_tier,
        lower_tick=lower_tick,
        upper_tick=upper_tick,
        risk_profile=risk_profile,
    )

    pool_meta = preview.get("pool") or {}
    fee_u128 = str(pool_meta.get("fee_u128") or _fee_to_u128_from_tier(fee_tier))
    tick_spacing = int(pool_meta.get("tick_spacing") or _FEE_TIER_TO_SPACING.get(fee_tier, 60))
    extension = str(pool_meta.get("extension") or _DEFAULT_EXTENSION)

    sorted_token0, sorted_token1 = _parse_token_sort(token0, token1)
    amount_for_sorted_0 = amount0
    amount_for_sorted_1 = amount1
    if sorted_token0 != token0:
        amount_for_sorted_0, amount_for_sorted_1 = amount1, amount0

    position_id = "0x" + uuid.uuid4().hex

    lower_tick_val = int(preview["lower_tick"])
    upper_tick_val = int(preview["upper_tick"])

    # Ekubo uses a push model: transfer tokens TO the Positions contract,
    # then call mint_and_deposit_and_clear_both(pool_key, bounds, min_liquidity).
    # Unused tokens are returned automatically.
    #
    # mint_and_deposit_and_clear_both ABI:
    #   pool_key: PoolKey (5 felts: token0, token1, fee u128, tick_spacing u128, extension)
    #   bounds: Bounds (4 felts: lower i129(mag,sign), upper i129(mag,sign))
    #   min_liquidity: u128 (1 felt)
    # Total: 10 felts
    calldata = [
        sorted_token0,
        sorted_token1,
        fee_u128,
        str(tick_spacing),
        extension,
        # bounds.lower (i129: mag, sign)
        str(abs(lower_tick_val)),
        "1" if lower_tick_val < 0 else "0",
        # bounds.upper (i129: mag, sign)
        str(abs(upper_tick_val)),
        "1" if upper_tick_val < 0 else "0",
        # min_liquidity (u128) — 0 means accept any amount
        "0",
    ]

    # Step 0: Ensure the pool is initialized on Ekubo Core.
    # maybe_initialize_pool is idempotent — no-op if pool already exists.
    # Args: pool_key (5 felts) + initial_tick i129 (2 felts) = 7 felts.
    # Use tick=0 as a safe default initial price for testnet.
    init_call = {
        "contract_address": EKUBO_CORE_SEPOLIA,
        "entrypoint": "maybe_initialize_pool",
        "calldata": [
            sorted_token0,
            sorted_token1,
            fee_u128,
            str(tick_spacing),
            extension,
            # initial_tick i129: mag=0, sign=0  →  price ratio ≈ 1:1
            "0",
            "0",
        ],
    }

    # Push model: transfer tokens to the Positions contract (not approve)
    transfers = [
        {
            "contract_address": token0 if sorted_token0 == token0 else token1,
            "entrypoint": "transfer",
            "calldata": [
                EKUBO_POSITIONS_SEPOLIA,
                str(max(0, amount_for_sorted_0)),
                "0",
            ],
        },
        {
            "contract_address": token1 if sorted_token1 == token1 else token0,
            "entrypoint": "transfer",
            "calldata": [
                EKUBO_POSITIONS_SEPOLIA,
                str(max(0, amount_for_sorted_1)),
                "0",
            ],
        },
    ]

    call = {
        "contract_address": EKUBO_POSITIONS_SEPOLIA,
        "entrypoint": "mint_and_deposit_and_clear_both",
        "calldata": calldata,
    }

    positions = _load_positions()
    now = _now_iso()
    positions.append(
        {
            "position_id": position_id,
            "owner": owner,
            "token0": token0,
            "token1": token1,
            "amount0": str(max(0, amount0)),
            "amount1": str(max(0, amount1)),
            "fee_tier": fee_tier,
            "lower_tick": int(preview["lower_tick"]),
            "upper_tick": int(preview["upper_tick"]),
            "current_tick_at_build": preview.get("current_tick"),
            "single_sided_expected": bool(preview.get("single_sided_expected", False)),
            "single_sided_side": str(preview.get("single_sided_side", "none")),
            "status": "built",
            "created_at": now,
            "updated_at": now,
            "estimated_fees_apr": preview.get("estimated_fees_apr"),
            "estimated_share": preview.get("estimated_share"),
        }
    )
    _save_positions(positions)

    return {
        "position_id": position_id,
        "approvals": [],
        "calls": [init_call] + transfers + [call],
        "warnings": preview.get("warnings", []),
        "preview": preview,
    }


async def build_lp_remove(
    owner: str,
    position_id: str,
    liquidity_bps: int,
) -> dict[str, Any]:
    """Build calldata for Ekubo Positions.withdraw().

    Ekubo Positions.withdraw ABI (Sepolia):
      id: u64              — the on-chain NFT token ID
      pool_key: PoolKey    — (token0, token1, fee, tick_spacing, extension) = 5 felts
      bounds: Bounds       — (lower i129(mag,sign), upper i129(mag,sign)) = 4 felts
      liquidity: u128      — amount of liquidity to remove
      min_token0: u128     — slippage protection
      min_token1: u128     — slippage protection
      collect_fees: felt252 — 1=true, 0=false
    Total: 1 + 5 + 4 + 1 + 1 + 1 + 1 = 14 felts
    """
    liquidity_bps_val = max(1, min(10_000, int(liquidity_bps)))

    positions = _load_positions()
    now = _now_iso()
    warnings: list[str] = []
    target: dict[str, Any] | None = None

    for row in positions:
        if str(row.get("position_id")) == str(position_id):
            target = row
            break

    if not target:
        warnings.append("Position not found in local index.")
        return {"approvals": [], "calls": [], "warnings": warnings}

    ekubo_nft_id = target.get("ekubo_nft_id")
    if not ekubo_nft_id:
        warnings.append(
            "No on-chain NFT token ID stored for this position. "
            "Cannot build withdraw calldata. Sync positions first."
        )
        return {"approvals": [], "calls": [], "warnings": warnings}

    # Reconstruct pool_key from stored position data
    t0, t1 = _parse_token_sort(
        str(target.get("token0", "")),
        str(target.get("token1", "")),
    )
    fee_u128 = _fee_to_u128_from_tier(int(target.get("fee_tier", 3000)))
    tick_spacing = int(target.get("tick_spacing", _FEE_TIER_TO_SPACING.get(int(target.get("fee_tier", 3000)), 60)))
    extension = str(target.get("extension", _DEFAULT_EXTENSION))

    lower_tick = int(target.get("lower_tick", 0))
    upper_tick = int(target.get("upper_tick", 0))

    # For full withdrawal (10000 bps), use a very large liquidity value.
    # For partial, we'd need to query on-chain liquidity first — use max u128 for full.
    if liquidity_bps_val >= 10_000:
        liq_amount = str(2**128 - 1)  # max u128 = withdraw everything
    else:
        # Partial withdrawal: would need on-chain query; for now use max and warn
        liq_amount = str(2**128 - 1)
        warnings.append("Partial withdrawal uses max liquidity — Ekubo returns actual amount.")

    calldata = [
        str(ekubo_nft_id),       # id: u64
        t0,                       # pool_key.token0
        t1,                       # pool_key.token1
        str(fee_u128),            # pool_key.fee
        str(tick_spacing),        # pool_key.tick_spacing
        extension,                # pool_key.extension
        str(abs(lower_tick)),     # bounds.lower.mag
        "1" if lower_tick < 0 else "0",  # bounds.lower.sign
        str(abs(upper_tick)),     # bounds.upper.mag
        "1" if upper_tick < 0 else "0",  # bounds.upper.sign
        liq_amount,               # liquidity: u128
        "0",                      # min_token0: u128 (no slippage protection)
        "0",                      # min_token1: u128
        "1",                      # collect_fees: true
    ]

    call = {
        "contract_address": EKUBO_POSITIONS_SEPOLIA,
        "entrypoint": "withdraw",
        "calldata": calldata,
    }

    target["updated_at"] = now
    target["status"] = "remove_built"
    target["last_remove_liquidity_bps"] = liquidity_bps_val
    _save_positions(positions)

    return {
        "approvals": [],
        "calls": [call],
        "warnings": warnings,
    }


def list_positions(owner: str) -> list[dict[str, Any]]:
    rows = [
        row
        for row in _load_positions()
        if str(row.get("owner", "")).lower() == str(owner or "").lower()
    ]
    return sorted(rows, key=lambda row: str(row.get("updated_at") or ""), reverse=True)


def update_position_status(
    position_id: str,
    status: str,
    tx_hash: str | None = None,
    ekubo_nft_id: int | None = None,
) -> dict[str, Any] | None:
    """Update a position's status (e.g. built → active) and optionally store tx_hash / NFT id."""
    positions = _load_positions()
    now = _now_iso()
    target = None
    for row in positions:
        if str(row.get("position_id")) == str(position_id):
            row["status"] = status
            row["updated_at"] = now
            if tx_hash:
                row["tx_hash"] = tx_hash
            if ekubo_nft_id is not None:
                row["ekubo_nft_id"] = ekubo_nft_id
            target = row
            break
    if target:
        _save_positions(positions)
    return target


def purge_stale_positions(
    owner: str,
    max_age_hours: int = 24,
) -> dict[str, Any]:
    """Remove 'built' positions older than max_age_hours that were never confirmed.

    Returns summary of purged vs kept.
    """
    positions = _load_positions()
    now_dt = datetime.now(timezone.utc)
    kept: list[dict[str, Any]] = []
    purged = 0

    for row in positions:
        is_stale_built = (
            str(row.get("owner", "")).lower() == str(owner).lower()
            and row.get("status") == "built"
            and not row.get("tx_hash")
        )
        if is_stale_built:
            try:
                created = datetime.fromisoformat(str(row.get("created_at", "")))
                age_h = (now_dt - created).total_seconds() / 3600
                if age_h > max_age_hours:
                    purged += 1
                    continue
            except Exception:
                purged += 1
                continue
        kept.append(row)

    _save_positions(kept)
    return {"purged": purged, "remaining": len(kept)}


async def sync_onchain_balance(owner: str) -> dict[str, Any]:
    """Query the Ekubo Positions NFT contract for the user's on-chain NFT balance.

    This provides a ground-truth count of how many LP positions the user holds
    on-chain, which can be compared against the local store.
    """
    from starknet_py.hash.selector import get_selector_from_name

    rpc_url = os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia")
    nft_address = EKUBO_POSITIONS_NFT_SEPOLIA
    sel_balance = hex(get_selector_from_name("balance_of"))

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "starknet_call",
                "params": {
                    "request": {
                        "contract_address": nft_address,
                        "entry_point_selector": sel_balance,
                        "calldata": [owner],
                    },
                    "block_id": "latest",
                },
            }
            r = await client.post(rpc_url, json=payload)
            data = r.json()
    except Exception as exc:
        logger.warning("sync_onchain_balance RPC error: %s", exc)
        return {"onchain_nft_balance": None, "error": str(exc)}

    if "result" not in data or not data["result"]:
        return {"onchain_nft_balance": None, "error": data.get("error", {}).get("message", "unknown")}

    bal_low = int(data["result"][0], 16)
    bal_high = int(data["result"][1], 16) if len(data["result"]) > 1 else 0
    nft_balance = bal_low | (bal_high << 128)

    # Compare with local store
    local_positions = list_positions(owner)
    local_active = [p for p in local_positions if p.get("status") in ("active", "confirmed")]
    local_built = [p for p in local_positions if p.get("status") == "built"]

    return {
        "onchain_nft_balance": nft_balance,
        "local_active": len(local_active),
        "local_built": len(local_built),
        "local_total": len(local_positions),
        "nft_contract": nft_address,
        "synced": nft_balance == len(local_active),
    }


async def import_onchain_positions(owner: str) -> dict[str, Any]:
    """Discover all Ekubo LP NFTs owned by *owner* on-chain.

    Scans Transfer events from the NFT contract for mints (from=0, to=owner),
    then looks up each tx receipt's Core contract event to extract pool_key and
    bounds.  Imports any newly-discovered positions into the local store.
    """
    from starknet_py.hash.selector import get_selector_from_name

    rpc_url = os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia")
    nft_address = EKUBO_POSITIONS_NFT_SEPOLIA
    core_address = EKUBO_CORE_SEPOLIA
    core_int = int(core_address, 16)
    owner_int = int(owner, 16)
    transfer_key = hex(get_selector_from_name("Transfer"))

    positions = _load_positions()
    existing_nft_ids = {p.get("ekubo_nft_id") for p in positions if p.get("ekubo_nft_id")}
    imported: list[dict[str, Any]] = []
    skipped = 0
    errors: list[str] = []

    # ── Step 1: Fetch all Transfer events from the NFT contract ──
    try:
        all_events: list[dict] = []
        continuation_token: str | None = None
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                params: dict[str, Any] = {
                    "filter": {
                        "from_block": {"block_number": 0},
                        "to_block": "latest",
                        "address": nft_address,
                        "keys": [[transfer_key]],
                        "chunk_size": 500,
                    }
                }
                if continuation_token:
                    params["filter"]["continuation_token"] = continuation_token
                r = await client.post(rpc_url, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "starknet_getEvents",
                    "params": params,
                })
                data = r.json()
                events = data.get("result", {}).get("events", [])
                all_events.extend(events)
                continuation_token = data.get("result", {}).get("continuation_token")
                if not continuation_token:
                    break

        # Filter mint events to our owner
        mint_events = []
        for ev in all_events:
            ev_data = [int(d, 16) for d in ev.get("data", [])]
            if len(ev_data) >= 3 and ev_data[0] == 0 and ev_data[1] == owner_int:
                token_low = ev_data[2]
                token_high = ev_data[3] if len(ev_data) > 3 else 0
                nft_id = token_low | (token_high << 128)
                mint_events.append({
                    "nft_id": nft_id,
                    "tx_hash": ev["transaction_hash"],
                    "block": ev.get("block_number", 0),
                })
        logger.info("import_onchain: found %d mint events for %s", len(mint_events), owner[:16])
    except Exception as exc:
        return {"imported": 0, "skipped": 0, "errors": [f"Event scan error: {exc}"]}

    # ── Step 2: For each NFT, get tx receipt → extract pool_key + bounds ──
    _TWO128 = 2**128
    now = _now_iso()

    for me in mint_events:
        nft_id = me["nft_id"]
        if nft_id in existing_nft_ids:
            skipped += 1
            continue

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(rpc_url, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "starknet_getTransactionReceipt",
                    "params": {"transaction_hash": me["tx_hash"]},
                })
                receipt = r.json().get("result", {})

            # Find Core event with >= 12 data fields (position update)
            core_ev = None
            for ev in receipt.get("events", []):
                if int(ev.get("from_address", "0x0"), 16) == core_int and len(ev.get("data", [])) >= 12:
                    core_ev = ev
                    break

            if not core_ev:
                # Empty NFT (minted with zero liquidity) — still import as placeholder
                position_id = "0x" + uuid.uuid4().hex
                positions.append({
                    "position_id": position_id,
                    "ekubo_nft_id": nft_id,
                    "owner": owner,
                    "token0": "", "token1": "",
                    "amount0": "0", "amount1": "0",
                    "fee_tier": 0, "lower_tick": 0, "upper_tick": 0,
                    "tick_spacing": 0,
                    "status": "active_empty",
                    "created_at": now, "updated_at": now,
                    "estimated_fees_apr": 0.0,
                    "estimated_share": "0",
                    "mint_tx_hash": me["tx_hash"],
                    "source": "onchain_import",
                })
                imported.append({"nft_id": nft_id, "status": "empty"})
                existing_nft_ids.add(nft_id)
                continue

            ev_data = [int(d, 16) for d in core_ev["data"]]
            # [locker, token0, token1, fee, tick_spacing, extension,
            #  id, lower_mag, lower_sign, upper_mag, upper_sign,
            #  liquidity_delta_mag, liquidity_delta_sign, ...]
            token0 = hex(ev_data[1])
            token1 = hex(ev_data[2])
            fee_raw = ev_data[3]
            tick_spacing = ev_data[4]
            lower_mag, lower_sign = ev_data[7], ev_data[8]
            upper_mag, upper_sign = ev_data[9], ev_data[10]
            liq_mag = ev_data[11]

            lower_tick = -lower_mag if lower_sign else lower_mag
            upper_tick = -upper_mag if upper_sign else upper_mag
            fee_bps = int((fee_raw / _TWO128) * 10_000)

            position_id = "0x" + uuid.uuid4().hex
            positions.append({
                "position_id": position_id,
                "ekubo_nft_id": nft_id,
                "owner": owner,
                "token0": token0,
                "token1": token1,
                "amount0": "0",  # we don't know current amounts, will query later
                "amount1": "0",
                "fee_tier": fee_bps,
                "fee_raw": str(fee_raw),
                "tick_spacing": tick_spacing,
                "lower_tick": lower_tick,
                "upper_tick": upper_tick,
                "liquidity": str(liq_mag),
                "status": "active",
                "created_at": now, "updated_at": now,
                "estimated_fees_apr": 0.0,
                "estimated_share": "0",
                "mint_tx_hash": me["tx_hash"],
                "source": "onchain_import",
            })
            imported.append({"nft_id": nft_id, "status": "active", "fee_bps": fee_bps})
            existing_nft_ids.add(nft_id)

        except Exception as exc:
            errors.append(f"NFT {nft_id}: {exc}")

    _save_positions(positions)
    return {
        "imported": len(imported),
        "skipped": skipped,
        "errors": errors,
        "positions_imported": imported,
        "total_local": len(positions),
    }


async def build_collect_fees(
    owner: str,
    position_id: str,
) -> dict[str, Any]:
    """Build calldata for Ekubo Positions.collect_fees().

    collect_fees ABI (from Ekubo Positions contract):
      id: u64              — the on-chain NFT token ID
      pool_key: PoolKey    — (token0, token1, fee, tick_spacing, extension) = 5 felts
      bounds: Bounds       — (lower i129(mag,sign), upper i129(mag,sign)) = 4 felts
    Total: 1 + 5 + 4 = 10 felts

    Returns tokens to the caller (the Positions contract handles the Core call).
    """
    positions = _load_positions()
    warnings: list[str] = []
    target: dict[str, Any] | None = None

    for row in positions:
        if str(row.get("position_id")) == str(position_id):
            target = row
            break

    if not target:
        warnings.append("Position not found in local index.")
        return {"approvals": [], "calls": [], "warnings": warnings}

    ekubo_nft_id = target.get("ekubo_nft_id")
    if not ekubo_nft_id:
        warnings.append("No on-chain NFT token ID. Import on-chain positions first.")
        return {"approvals": [], "calls": [], "warnings": warnings}

    t0, t1 = _parse_token_sort(
        str(target.get("token0", "")),
        str(target.get("token1", "")),
    )

    # Use stored fee_raw if available, otherwise compute from fee_tier
    fee_raw = target.get("fee_raw")
    if fee_raw:
        fee_u128 = str(int(fee_raw))
    else:
        fee_u128 = str(_fee_to_u128_from_tier(int(target.get("fee_tier", 3000))))

    tick_spacing = int(target.get("tick_spacing", _FEE_TIER_TO_SPACING.get(int(target.get("fee_tier", 3000)), 60)))
    extension = str(target.get("extension", _DEFAULT_EXTENSION))
    lower_tick = int(target.get("lower_tick", 0))
    upper_tick = int(target.get("upper_tick", 0))

    calldata = [
        str(ekubo_nft_id),          # id: u64
        t0,                          # pool_key.token0
        t1,                          # pool_key.token1
        fee_u128,                    # pool_key.fee
        str(tick_spacing),           # pool_key.tick_spacing
        extension,                   # pool_key.extension
        str(abs(lower_tick)),        # bounds.lower.mag
        "1" if lower_tick < 0 else "0",  # bounds.lower.sign
        str(abs(upper_tick)),        # bounds.upper.mag
        "1" if upper_tick < 0 else "0",  # bounds.upper.sign
    ]

    call = {
        "contract_address": EKUBO_POSITIONS_SEPOLIA,
        "entrypoint": "collect_fees",
        "calldata": calldata,
    }

    target["updated_at"] = _now_iso()
    _save_positions(positions)

    return {
        "approvals": [],
        "calls": [call],
        "warnings": warnings,
    }


async def verify_tx_and_extract_nft_id(tx_hash: str, owner: str) -> dict[str, Any]:
    """Verify a transaction receipt and extract the Ekubo NFT token_id from mint events.

    After a successful LP add, the tx receipt contains a Transfer event from the
    Ekubo NFT contract (0x0 → owner, token_id). This extracts that token_id.
    """
    rpc_url = os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia")
    nft_address = EKUBO_POSITIONS_NFT_SEPOLIA
    nft_norm = int(nft_address, 16)
    owner_int = int(owner, 16)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "starknet_getTransactionReceipt",
                "params": {"transaction_hash": tx_hash},
            }
            r = await client.post(rpc_url, json=payload)
            data = r.json()
    except Exception as exc:
        return {"verified": False, "error": str(exc)}

    if "result" not in data:
        return {"verified": False, "error": data.get("error", {}).get("message", "unknown")}

    receipt = data["result"]
    exec_status = receipt.get("execution_status", "")
    if exec_status != "SUCCEEDED":
        return {"verified": False, "execution_status": exec_status, "error": f"Tx {exec_status}"}

    # Find NFT Transfer event: address=NFT, data=[from, to, token_id_low, token_id_high]
    # Cairo 0 ERC721: Transfer(from, to, tokenId) all in data
    ekubo_nft_id = None
    for event in receipt.get("events", []):
        from_addr = event.get("from_address", "")
        if int(from_addr, 16) != nft_norm:
            continue
        ev_data = event.get("data", [])
        if len(ev_data) >= 4:
            from_field = int(ev_data[0], 16)
            to_field = int(ev_data[1], 16)
            # Mint event: from=0, to=owner
            if from_field == 0 and to_field == owner_int:
                token_low = int(ev_data[2], 16)
                token_high = int(ev_data[3], 16) if len(ev_data) > 3 else 0
                ekubo_nft_id = token_low | (token_high << 128)
                break

    return {
        "verified": True,
        "execution_status": exec_status,
        "ekubo_nft_id": ekubo_nft_id,
        "tx_hash": tx_hash,
    }
