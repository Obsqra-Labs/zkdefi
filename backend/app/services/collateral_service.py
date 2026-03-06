"""
Collateral Service

Manages collateral positions for the lending system.
Builds calldata for CollateralVault on-chain interactions
and maintains a cached view of positions for fast API reads.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)

WEI_PER_ETH = 10**18

COLLATERAL_VAULT_ADDRESS = os.getenv(
    "COLLATERAL_VAULT_ADDRESS",
    "0x0",
)

ETH_TOKEN = os.getenv(
    "ETH_TOKEN_ADDRESS",
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
)

STRK_TOKEN = os.getenv(
    "STRK_TOKEN_ADDRESS",
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
)

CORE_TIER = "core"
BOOST_TIER = "boost"
BOOST_LOCK_SECONDS = 604800  # 7 days

CORE_WEIGHT = 0.8
BOOST_WEIGHT = 1.0

_collateral_store = JsonStore("collateral_positions")


def _felt_from_str(s: str) -> str:
    val = int.from_bytes(s.encode()[:31], "big")
    return hex(val % (2**251))


def get_user_positions(address: str) -> list[dict[str, Any]]:
    """Get all collateral positions for a user from cache."""
    key = address.lower().strip()
    data = _collateral_store.get(key)
    if not data:
        return []
    positions = data.get("positions", [])
    return [p for p in positions if p.get("active", True)]


def get_user_total_collateral(address: str) -> dict[str, Any]:
    """Get total collateral summary for a user."""
    positions = get_user_positions(address)
    total_wei = sum(int(p.get("amount_wei", 0)) for p in positions)
    total_eth = total_wei / WEI_PER_ETH

    core_wei = sum(int(p.get("amount_wei", 0)) for p in positions if p.get("pool_tier") == CORE_TIER)
    boost_wei = sum(int(p.get("amount_wei", 0)) for p in positions if p.get("pool_tier") == BOOST_TIER)

    weighted_eth = (core_wei * CORE_WEIGHT + boost_wei * BOOST_WEIGHT) / WEI_PER_ETH

    return {
        "address": address,
        "total_wei": total_wei,
        "total_eth": round(total_eth, 6),
        "core_wei": core_wei,
        "boost_wei": boost_wei,
        "weighted_collateral_eth": round(weighted_eth, 6),
        "position_count": len(positions),
    }


def build_deposit_calldata(
    token: str,
    amount_wei: int,
    pool_tier: str,
) -> dict[str, Any]:
    """
    Build multicall: [approve, deposit_collateral].
    Returns calldata for frontend wallet signing.
    """
    tier_felt = _felt_from_str(pool_tier)
    amount_low = amount_wei % (2**128)
    amount_high = amount_wei // (2**128)

    approve_call = {
        "contractAddress": token,
        "entrypoint": "approve",
        "calldata": [COLLATERAL_VAULT_ADDRESS, str(amount_low), str(amount_high)],
    }

    deposit_call = {
        "contractAddress": COLLATERAL_VAULT_ADDRESS,
        "entrypoint": "deposit_collateral",
        "calldata": [token, str(amount_low), str(amount_high), tier_felt],
    }

    return {
        "calls": [approve_call, deposit_call],
        "message": f"Deposit {amount_wei} wei as {pool_tier} collateral",
    }


def build_withdraw_calldata(position_id: int) -> dict[str, Any]:
    """Build calldata for withdraw_collateral."""
    return {
        "calls": [{
            "contractAddress": COLLATERAL_VAULT_ADDRESS,
            "entrypoint": "withdraw_collateral",
            "calldata": [str(position_id)],
        }],
        "message": f"Withdraw collateral position {position_id}",
    }


def record_deposit(
    address: str,
    position_id: int,
    token: str,
    amount_wei: int,
    pool_tier: str,
    tx_hash: Optional[str] = None,
) -> dict[str, Any]:
    """Record a deposit in the local cache after on-chain confirmation."""
    key = address.lower().strip()
    data = _collateral_store.get(key) or {"positions": []}
    now = int(time.time())

    locked_until = (now + BOOST_LOCK_SECONDS) if pool_tier == BOOST_TIER else 0

    position = {
        "position_id": position_id,
        "token": token,
        "amount_wei": amount_wei,
        "pool_tier": pool_tier,
        "locked_until": locked_until,
        "created_at": now,
        "active": True,
        "tx_hash": tx_hash,
    }
    data["positions"].append(position)
    _collateral_store.set(key, data)
    return position


def record_withdrawal(address: str, position_id: int) -> bool:
    """Mark a position as withdrawn in local cache."""
    key = address.lower().strip()
    data = _collateral_store.get(key)
    if not data:
        return False
    for p in data.get("positions", []):
        if p.get("position_id") == position_id:
            p["active"] = False
            _collateral_store.set(key, data)
            return True
    return False
