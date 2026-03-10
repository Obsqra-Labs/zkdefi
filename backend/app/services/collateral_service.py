"""
Collateral Service

Manages collateral positions for the lending system.
Builds calldata for CollateralVault on-chain interactions
and maintains a cached view of positions for fast API reads.

Positions are sourced from *two* canonical stores:
  1. The local JsonStore (collateral_positions) — legacy direct deposits.
  2. The vault-v2 double-entry ledger + note store — vault deposits.
Both contribute to the unified position list so that collateral, vault,
and DAO voting power all share a single source of truth.
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

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_V2_DB_PATH = os.path.join(_DATA_DIR, "vault_v2.db")


def _felt_from_str(s: str) -> str:
    val = int.from_bytes(s.encode()[:31], "big")
    return hex(val % (2**251))


def _ledger_positions(address: str) -> list[dict[str, Any]]:
    """
    Read positions from the vault-v2 double-entry ledger + note store.

    Returns synthetic position dicts (same shape as JsonStore positions)
    for every token that has a non-zero VAULT_AVAILABLE or OPEN-note balance.
    """
    if not os.path.exists(_V2_DB_PATH):
        return []

    try:
        from app.services.double_entry_ledger import DoubleEntryLedger
        from app.services.vault_account_service import VaultAccountService
        from app.services.note_store import NoteStore

        ledger = DoubleEntryLedger(_V2_DB_PATH)
        vaults = VaultAccountService(_V2_DB_PATH)
        notes = NoteStore(_V2_DB_PATH)

        vault = vaults.get_vault_by_address(address)
        vault_id = vault.get("vault_id", "") if vault else ""
        if not vault_id:
            return []

        positions: list[dict[str, Any]] = []
        for token in ("ETH", "STRK", "USDC"):
            summary = ledger.vault_summary(vault_id, token)
            total_wei = summary["available"] + summary["pending"] + summary["deployed"]

            open_notes = notes.list_notes(vault_id, status="OPEN")
            for note in open_notes:
                if note.get("token") == token:
                    note_wei = int(note.get("amount_wei", 0))
                    if note_wei > total_wei:
                        total_wei = note_wei

            if total_wei > 0:
                positions.append({
                    "position_id": f"ledger:{vault_id}:{token}",
                    "token": token,
                    "amount_wei": total_wei,
                    "pool_tier": CORE_TIER,
                    "locked_until": 0,
                    "created_at": int(vault.get("created_at", 0)),
                    "active": True,
                    "tx_hash": None,
                    "source": "vault_v2_ledger",
                })
        return positions
    except Exception as exc:
        logger.debug("Ledger position lookup failed: %s", exc)
        return []


def get_user_positions(address: str) -> list[dict[str, Any]]:
    """
    Get all collateral positions for a user.

    Merges two canonical sources:
      1. JsonStore (collateral_positions) — direct collateral deposits
      2. Vault-v2 double-entry ledger — vault deposits
    """
    key = address.lower().strip()

    # Source 1: legacy JsonStore positions
    store_positions: list[dict[str, Any]] = []
    data = _collateral_store.get(key)
    if data:
        store_positions = [p for p in data.get("positions", []) if p.get("active", True)]

    # Source 2: vault-v2 ledger positions
    ledger_pos = _ledger_positions(key)

    return store_positions + ledger_pos


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
