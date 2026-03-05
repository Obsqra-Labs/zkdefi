"""Ekubo Limit Orders Extension adapter — place / cancel / query limit orders.

The Limit Orders contract (Sepolia: 0x00c4c8…) allows users to place limit
orders at specific ticks.  When price crosses the order tick, the order is
filled automatically by Ekubo's AMM.

Flow:
1. Approve token to the Limit Orders contract
2. Call ``place_order(pool_key, bounds, amount, …)``
3. Poll ``get_order`` or listen for fills
4. ``cancel_order`` to withdraw unfilled amount

This adapter builds calldata only — the actual signing happens via the vault
account in the worker or executor.
"""

from __future__ import annotations

import json
import logging
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.ekubo_config import (
    EKUBO_LIMIT_ORDERS_SEPOLIA,
    SEPOLIA_ETH,
    SEPOLIA_STRK,
)
from app.services.ekubo_executor import _i129, FEE_30PCT, align_tick

logger = logging.getLogger(__name__)

# ── Persistent order store ────────────────────────────────────────────────────
_ORDERS_FILE = Path(__file__).resolve().parents[3] / "data" / "limit_orders.json"


def _load_orders() -> List[Dict[str, Any]]:
    if not _ORDERS_FILE.exists():
        return []
    try:
        payload = json.loads(_ORDERS_FILE.read_text(encoding="utf-8"))
        return payload.get("orders", []) if isinstance(payload, dict) else []
    except Exception:
        return []


def _save_orders(orders: List[Dict[str, Any]]) -> None:
    _ORDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    from datetime import datetime, timezone
    data = {"orders": orders, "updated_at": datetime.now(timezone.utc).isoformat()}
    _ORDERS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


# ── Calldata builders ────────────────────────────────────────────────────────

def build_place_limit_order_calldata(
    *,
    sell_token: str,
    buy_token: str,
    amount_wei: int,
    limit_tick: int,
    tick_spacing: int = 1000,
    fee: int = FEE_30PCT,
) -> List[Dict[str, Any]]:
    """Build a multicall: [approve, place_order].

    ``limit_tick`` is the tick at which the order should be filled.
    ``sell_token`` is transferred to the Limit Orders contract.

    Returns a list of call dicts: [{contract, entrypoint, calldata}, …]
    """
    # Ensure token ordering: token0 < token1
    t0_int = int(sell_token, 16) if sell_token.startswith("0x") else int(sell_token)
    t1_int = int(buy_token, 16) if buy_token.startswith("0x") else int(buy_token)
    if t0_int > t1_int:
        token0, token1 = buy_token, sell_token
        is_token1 = False  # selling token0
    else:
        token0, token1 = sell_token, buy_token
        is_token1 = True  # selling token1

    aligned_tick = align_tick(limit_tick, tick_spacing)

    # Build PoolKey (with extension = Limit Orders contract)
    pool_key = {
        "token0": int(token0, 16),
        "token1": int(token1, 16),
        "fee": fee,
        "tick_spacing": tick_spacing,
        "extension": int(EKUBO_LIMIT_ORDERS_SEPOLIA, 16),
    }

    # Bounds: single-tick range
    bounds = {
        "lower": _i129(aligned_tick),
        "upper": _i129(aligned_tick + tick_spacing),
    }

    calls = [
        # 1. Approve sell_token → Limit Orders contract
        {
            "contract": sell_token,
            "entrypoint": "approve",
            "calldata": [
                int(EKUBO_LIMIT_ORDERS_SEPOLIA, 16),
                amount_wei,  # low
                0,           # high (u256)
            ],
        },
        # 2. Place order
        {
            "contract": EKUBO_LIMIT_ORDERS_SEPOLIA,
            "entrypoint": "place_order",
            "calldata": {
                "pool_key": pool_key,
                "bounds": bounds,
                "amount": amount_wei,
                "is_token1": is_token1,
            },
        },
    ]
    return calls


def build_cancel_order_calldata(
    *,
    order_id: int,
    token0: str = SEPOLIA_STRK,
    token1: str = SEPOLIA_ETH,
    tick: int = 0,
    tick_spacing: int = 1000,
    fee: int = FEE_30PCT,
) -> List[Dict[str, Any]]:
    """Build calldata to cancel an open limit order and withdraw tokens."""
    pool_key = {
        "token0": int(token0, 16),
        "token1": int(token1, 16),
        "fee": fee,
        "tick_spacing": tick_spacing,
        "extension": int(EKUBO_LIMIT_ORDERS_SEPOLIA, 16),
    }
    bounds = {
        "lower": _i129(tick),
        "upper": _i129(tick + tick_spacing),
    }
    return [
        {
            "contract": EKUBO_LIMIT_ORDERS_SEPOLIA,
            "entrypoint": "cancel_order",
            "calldata": {
                "order_id": order_id,
                "pool_key": pool_key,
                "bounds": bounds,
            },
        },
    ]


# ── Order tracking ────────────────────────────────────────────────────────────

def record_order(
    *,
    order_id: Optional[int] = None,
    sell_token: str,
    buy_token: str,
    amount_wei: int,
    limit_tick: int,
    tx_hash: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist a newly placed order to the local store."""
    from datetime import datetime, timezone
    orders = _load_orders()
    entry = {
        "order_id": order_id,
        "sell_token": sell_token,
        "buy_token": buy_token,
        "amount_wei": amount_wei,
        "limit_tick": limit_tick,
        "status": "open",
        "tx_hash": tx_hash,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "filled_at": None,
        "cancelled_at": None,
    }
    orders.append(entry)
    _save_orders(orders)
    return entry


def get_active_orders() -> List[Dict[str, Any]]:
    """Return all orders with status == 'open'."""
    return [o for o in _load_orders() if o.get("status") == "open"]


def mark_order_filled(order_id: int) -> bool:
    """Mark an order as filled. Returns True if found."""
    from datetime import datetime, timezone
    orders = _load_orders()
    for o in orders:
        if o.get("order_id") == order_id and o.get("status") == "open":
            o["status"] = "filled"
            o["filled_at"] = datetime.now(timezone.utc).isoformat()
            _save_orders(orders)
            return True
    return False


def mark_order_cancelled(order_id: int) -> bool:
    """Mark an order as cancelled. Returns True if found."""
    from datetime import datetime, timezone
    orders = _load_orders()
    for o in orders:
        if o.get("order_id") == order_id and o.get("status") == "open":
            o["status"] = "cancelled"
            o["cancelled_at"] = datetime.now(timezone.utc).isoformat()
            _save_orders(orders)
            return True
    return False
