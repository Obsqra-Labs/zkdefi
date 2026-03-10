"""
Pool Composition Service

Canonical helpers for tracking pool bucket capital via the DoubleEntryLedger.
Provides credit/deploy/close (sync) and get_composition (async, cached).

Account naming:
    POOL:{pool_id}:idle:{token}               – idle capital awaiting deployment
    POOL:{pool_id}:deployed:{adapter}:{token}  – capital deployed to an adapter
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any, Dict, Optional

from app.services.double_entry_ledger import DoubleEntryLedger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared ledger singleton (reuses the same vault_v2.db as the rest of the app)
# ---------------------------------------------------------------------------

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DATA_DIR, "vault_v2.db")

_ledger: Optional[DoubleEntryLedger] = None

VALID_POOL_IDS = {"conservative", "moderate", "aggressive"}


def _get_ledger() -> DoubleEntryLedger:
    global _ledger
    if _ledger is None:
        os.makedirs(_DATA_DIR, exist_ok=True)
        _ledger = DoubleEntryLedger(_DB_PATH)
    return _ledger


def set_ledger(ledger: DoubleEntryLedger) -> None:
    """Override the ledger instance (useful for tests)."""
    global _ledger
    _ledger = ledger


# ---------------------------------------------------------------------------
# Sync write helpers (called without await by autonomous_agent & full_privacy)
# ---------------------------------------------------------------------------


def _idem_key(pool_id: str, op: str, token: str) -> str:
    """Generate a unique idempotency key for pool ledger entries."""
    return f"pool:{pool_id}:{op}:{token}:{int(time.time() * 1000)}:{uuid.uuid4().hex[:8]}"


def credit_pool_idle(
    pool_id: str,
    token: str,
    amount_wei: int,
    source_account: str = "USER_DEPOSIT",
    refs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Credit idle capital to a pool bucket.
    Debits ``source_account``, credits ``POOL:{pool_id}:idle:{token}``.
    """
    ledger = _get_ledger()
    cr_account = f"POOL:{pool_id}:idle:{token}"
    return ledger.post_entry(
        idempotency_key=_idem_key(pool_id, "credit", token),
        tx_type="pool_credit_idle",
        amount_wei=amount_wei,
        token=token,
        dr_account=source_account,
        cr_account=cr_account,
        refs=refs,
    )


def deploy_to_adapter(
    pool_id: str,
    adapter: str,
    token: str,
    amount_wei: int,
    refs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Move idle capital from a pool bucket into a deployed adapter position.
    Debits ``POOL:{pool_id}:idle:{token}``,
    credits ``POOL:{pool_id}:deployed:{adapter}:{token}``.
    """
    ledger = _get_ledger()
    dr_account = f"POOL:{pool_id}:idle:{token}"
    cr_account = f"POOL:{pool_id}:deployed:{adapter}:{token}"
    return ledger.post_entry(
        idempotency_key=_idem_key(pool_id, "deploy", token),
        tx_type="pool_deploy",
        amount_wei=amount_wei,
        token=token,
        dr_account=dr_account,
        cr_account=cr_account,
        refs=refs,
    )


def close_position(
    pool_id: str,
    adapter: str,
    token: str,
    amount_wei: int,
    refs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Return deployed capital back to idle.
    Debits ``POOL:{pool_id}:deployed:{adapter}:{token}``,
    credits ``POOL:{pool_id}:idle:{token}``.
    """
    ledger = _get_ledger()
    dr_account = f"POOL:{pool_id}:deployed:{adapter}:{token}"
    cr_account = f"POOL:{pool_id}:idle:{token}"
    return ledger.post_entry(
        idempotency_key=_idem_key(pool_id, "close", token),
        tx_type="pool_close",
        amount_wei=amount_wei,
        token=token,
        dr_account=dr_account,
        cr_account=cr_account,
        refs=refs,
    )


# ---------------------------------------------------------------------------
# Async read helper (cached via composition_cache)
# ---------------------------------------------------------------------------


async def get_composition(pool_id: str) -> Dict[str, Any]:
    """
    Return the current capital composition for a pool bucket.

    Returns::

        {
          "pool_id": "moderate",
          "idle_breakdown": {"STRK": 1000, "ETH": 500},
          "deployed_breakdown": {"staking": {"STRK": 800}},
          "total_wei": 2300,
        }
    """
    from app.services.ttl_cache import composition_cache

    cache_key = f"composition:{pool_id}"
    cached = await composition_cache.get(cache_key)
    if cached is not None:
        return cached

    ledger = _get_ledger()
    raw = ledger.pool_balances(pool_id)

    idle_breakdown: Dict[str, int] = {}
    deployed_breakdown: Dict[str, Dict[str, int]] = {}
    total = 0

    for sub_account, balance in raw.items():
        parts = sub_account.split(":")
        if parts[0] == "idle" and len(parts) == 2:
            # idle:{token}
            token = parts[1]
            idle_breakdown[token] = balance
            total += balance
        elif parts[0] == "deployed" and len(parts) == 3:
            # deployed:{adapter}:{token}
            adapter = parts[1]
            token = parts[2]
            deployed_breakdown.setdefault(adapter, {})[token] = balance
            total += balance
        else:
            # Unknown sub-account structure — still count toward total
            total += balance

    result = {
        "pool_id": pool_id,
        "idle_breakdown": idle_breakdown,
        "deployed_breakdown": deployed_breakdown,
        "total_wei": total,
    }

    await composition_cache.set(cache_key, result)
    return result


async def invalidate_cache(pool_id: str) -> None:
    """Clear the cached composition for a pool (call after writes)."""
    from app.services.ttl_cache import composition_cache

    await composition_cache.delete(f"composition:{pool_id}")
