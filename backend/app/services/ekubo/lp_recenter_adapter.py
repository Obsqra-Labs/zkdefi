"""Ekubo LP recenter adapter — decide when to move a position and build calldata.

"Recentering" means:
1. Collect fees on the current position
2. Withdraw liquidity
3. Mint a new position centred around the current market tick

This adapter owns the *decision logic* and *calldata construction* only.
The actual signing / broadcasting happens in the worker or executor.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.services.ekubo_config import (
    EKUBO_POSITIONS_SEPOLIA,
    SEPOLIA_ETH,
    SEPOLIA_STRK,
)

logger = logging.getLogger(__name__)

# 0.30% fee in 0.128 fixed-point representation.
FEE_30PCT = 1020847100762815411640772995208708096


def _i129(value: int) -> dict[str, int]:
    """Encode signed tick into Ekubo i129 calldata shape."""
    v = int(value)
    return {"mag": abs(v), "sign": 1 if v < 0 else 0}


def align_tick(tick: int, spacing: int, *, floor: bool = True) -> int:
    """Align ticks to pool spacing."""
    s = max(1, int(spacing))
    t = int(tick)
    if floor:
        return (t // s) * s
    return ((t + s - 1) // s) * s

# ── Positions store (read-only from here) ─────────────────────────────────────
_POSITIONS_FILE = Path(__file__).resolve().parents[3] / "data" / "ekubo_positions.json"


def _load_positions() -> List[Dict[str, Any]]:
    if not _POSITIONS_FILE.exists():
        return []
    try:
        payload = json.loads(_POSITIONS_FILE.read_text(encoding="utf-8"))
        return payload.get("positions", []) if isinstance(payload, dict) else []
    except Exception:
        return []


# ── Decision logic ────────────────────────────────────────────────────────────

def should_recenter(
    position: Dict[str, Any],
    current_tick: int,
    *,
    drift_threshold_pct: float = 0.75,
) -> Tuple[bool, str]:
    """Return ``(True, reason)`` if the position should be recentered.

    ``drift_threshold_pct`` (0–1): fraction of range width the tick must
    drift beyond the range boundary before we trigger a recenter.
    E.g. 0.75 means we trigger when tick has moved 75 % of the range
    *outside* the position's bounds.
    """
    lower = position.get("lower_tick", 0)
    upper = position.get("upper_tick", 0)
    if lower >= upper:
        return False, "invalid_bounds"

    range_width = upper - lower

    if current_tick < lower:
        drift = lower - current_tick
        if drift >= range_width * drift_threshold_pct:
            return True, f"below_range_by_{drift}_ticks"
        return False, f"below_range_but_within_threshold_{drift}"

    if current_tick > upper:
        drift = current_tick - upper
        if drift >= range_width * drift_threshold_pct:
            return True, f"above_range_by_{drift}_ticks"
        return False, f"above_range_but_within_threshold_{drift}"

    # Still inside range
    mid = (lower + upper) // 2
    offset = abs(current_tick - mid)
    return False, f"in_range_offset_{offset}"


def compute_new_bounds(
    current_tick: int,
    half_width_ticks: int = 1000,
    tick_spacing: int = 1000,
) -> Tuple[int, int]:
    """Compute new (lower_tick, upper_tick) centred around ``current_tick``."""
    raw_lower = current_tick - half_width_ticks
    raw_upper = current_tick + half_width_ticks
    new_lower = align_tick(raw_lower, tick_spacing, floor=True)
    new_upper = align_tick(raw_upper, tick_spacing, floor=False)
    if new_upper <= new_lower:
        new_upper = new_lower + tick_spacing
    return new_lower, new_upper


# ── Calldata builders ────────────────────────────────────────────────────────

def build_recenter_calldata(
    *,
    position: Dict[str, Any],
    current_tick: int,
    half_width_ticks: int = 1000,
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
    fee: int = FEE_30PCT,
    tick_spacing: int = 1000,
) -> Dict[str, Any]:
    """Build a 3-step multicall: collect_fees → withdraw → mint_and_deposit.

    Returns ``{"calls": [...], "old_bounds": ..., "new_bounds": ..., "nft_id": ...}``.
    """
    nft_id = position.get("nft_id") or position.get("id")
    old_lower = position.get("lower_tick", 0)
    old_upper = position.get("upper_tick", 0)
    liquidity = position.get("liquidity", 0)

    pool_key = {
        "token0": int(token0, 16),
        "token1": int(token1, 16),
        "fee": fee,
        "tick_spacing": tick_spacing,
        "extension": 0,  # standard LP (no extension)
    }

    old_bounds = {
        "lower": _i129(old_lower),
        "upper": _i129(old_upper),
    }

    new_lower, new_upper = compute_new_bounds(current_tick, half_width_ticks, tick_spacing)
    new_bounds = {
        "lower": _i129(new_lower),
        "upper": _i129(new_upper),
    }

    calls: List[Dict[str, Any]] = [
        # 1. Collect accrued fees
        {
            "contract": EKUBO_POSITIONS_SEPOLIA,
            "entrypoint": "collect_fees",
            "calldata": {
                "id": nft_id,
                "pool_key": pool_key,
                "bounds": old_bounds,
            },
        },
        # 2. Withdraw all liquidity from old range
        {
            "contract": EKUBO_POSITIONS_SEPOLIA,
            "entrypoint": "withdraw",
            "calldata": {
                "id": nft_id,
                "pool_key": pool_key,
                "bounds": old_bounds,
                "liquidity": liquidity,
                "min_token0": 0,
                "min_token1": 0,
                "collect_fees": True,
            },
        },
        # 3. Mint new position centred on current tick
        {
            "contract": EKUBO_POSITIONS_SEPOLIA,
            "entrypoint": "mint_and_deposit",
            "calldata": {
                "pool_key": pool_key,
                "bounds": new_bounds,
                "min_liquidity": 0,
            },
        },
    ]

    return {
        "calls": calls,
        "old_bounds": {"lower": old_lower, "upper": old_upper},
        "new_bounds": {"lower": new_lower, "upper": new_upper},
        "nft_id": nft_id,
    }


def get_recenterable_positions(current_tick: int, drift_pct: float = 0.75) -> List[Dict[str, Any]]:
    """Return positions that should be recentered based on current tick."""
    results = []
    for pos in _load_positions():
        should, reason = should_recenter(pos, current_tick, drift_threshold_pct=drift_pct)
        if should:
            results.append({**pos, "_recenter_reason": reason})
    return results
