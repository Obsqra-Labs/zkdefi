"""Unified pre-transaction execution guard.

Every path that writes to chain — rebalancer, vault_execute, privacy orchestrator,
strategy workers — calls ``check(intent)`` before signing.  The guard loads the
user's VaultPolicy, runs 7 deterministic checks, and returns a ``GuardResult``.

No external I/O beyond reading the JSON policy file.

Gating from Risk Profile: see docs/GATING_FROM_PROFILE.md. Policy can optionally
be validated or derived from the Risk Profile bundle when needed.
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.models.action_intent import ActionIntent, GuardResult
from app.services.vault_policy_service import VaultPolicyService, get_vault_policy_service


# ---------------------------------------------------------------------------
# In-memory trackers (reset on process restart — acceptable for Sepolia)
# ---------------------------------------------------------------------------

# user_address -> cumulative notional_wei executed today (UTC day boundary)
_daily_notional: Dict[str, Dict[str, int]] = defaultdict(lambda: {"date": "", "total": 0})

# user_address -> last execution epoch (seconds)
_last_exec_ts: Dict[str, float] = {}


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _reset_if_new_day(user: str) -> None:
    today = _today_str()
    entry = _daily_notional[user]
    if entry["date"] != today:
        entry["date"] = today
        entry["total"] = 0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def check(intent: ActionIntent, *, policy_svc: Optional[VaultPolicyService] = None) -> GuardResult:
    """Run all guard checks against the user's active VaultPolicy.

    Returns ``GuardResult.allowed == True`` only when *every* check passes.
    """
    svc = policy_svc or get_vault_policy_service()
    policy = svc.get_policy(intent.user_address, create_if_missing=True)
    if not policy:
        return GuardResult(allowed=False, reason="no_policy_found", checks={})

    p_hash = VaultPolicyService.policy_hash(policy)
    checks: Dict[str, bool] = {}

    # 1. Emergency pause -------------------------------------------------------
    ep = policy.get("execution_policy", {})
    paused = bool(ep.get("emergency_pause", False))
    checks["emergency_pause"] = not paused
    if paused:
        return GuardResult(allowed=False, reason="emergency_pause_active", policy_hash=p_hash, checks=checks)

    # 2. Strategy allowed ------------------------------------------------------
    sp = policy.get("strategy_permissions", {})
    strategy_map = {
        "lp_recenter": "enable_lp",
        "limit_grid": "enable_lp",
        "rebalance": "enable_rebalance",
        "dca": "enable_dca",
        "rotation": "enable_rotation",
        "manual": None,  # always allowed
    }
    perm_key = strategy_map.get(intent.strategy)
    if perm_key is not None:
        checks["strategy_allowed"] = sp.get(perm_key, False)
    else:
        checks["strategy_allowed"] = True  # unknown strategies default allow (manual, etc.)

    # 3. Allowed strategies list (if policy has one) ---------------------------
    allowed_list = ep.get("allowed_strategies")
    if isinstance(allowed_list, list) and len(allowed_list) > 0:
        checks["strategy_in_allowlist"] = intent.strategy in allowed_list
    else:
        checks["strategy_in_allowlist"] = True  # no allowlist = all allowed

    # 4. Cooldown --------------------------------------------------------------
    cooldown_sec = ep.get("cooldown_seconds", 300)
    user = (intent.user_address or "").strip().lower()
    last = _last_exec_ts.get(user, 0)
    elapsed = time.time() - last
    checks["cooldown"] = elapsed >= cooldown_sec

    # 5. Daily notional budget -------------------------------------------------
    _reset_if_new_day(user)
    daily_max = ep.get("max_daily_notional_wei", 0)
    if daily_max > 0:
        projected = _daily_notional[user]["total"] + intent.notional_wei
        checks["daily_notional"] = projected <= daily_max
    else:
        checks["daily_notional"] = True  # no limit configured

    # 6. Single-trade notional cap ---------------------------------------------
    trade_max = ep.get("max_trade_notional_wei", 0)
    if trade_max > 0:
        checks["trade_notional"] = intent.notional_wei <= trade_max
    else:
        checks["trade_notional"] = True

    # 7. Minimum expected edge (bps) -------------------------------------------
    min_edge = ep.get("min_expected_edge_bps", 0)
    if min_edge > 0 and intent.expected_edge_bps > 0:
        checks["min_edge"] = intent.expected_edge_bps >= min_edge
    else:
        checks["min_edge"] = True  # no constraint or no claim

    # 8. Policy hash match (optional: caller can pin a hash) -------------------
    if intent.policy_hash and intent.policy_hash != p_hash:
        checks["policy_hash_match"] = False
    else:
        checks["policy_hash_match"] = True

    # Aggregate -----------------------------------------------------------------
    all_ok = all(checks.values())
    if not all_ok:
        failed = [k for k, v in checks.items() if not v]
        reason = "blocked:" + ",".join(failed)
        return GuardResult(allowed=False, reason=reason, policy_hash=p_hash, checks=checks)

    return GuardResult(allowed=True, reason="all_checks_passed", policy_hash=p_hash, checks=checks)


def record_execution(intent: ActionIntent) -> None:
    """Call *after* a successful on-chain execution to update trackers."""
    user = (intent.user_address or "").strip().lower()
    _last_exec_ts[user] = time.time()
    _reset_if_new_day(user)
    _daily_notional[user]["total"] += intent.notional_wei


def get_guard_status(user_address: str) -> Dict[str, Any]:
    """Return current guard state for a user (for dashboard / debug)."""
    user = (user_address or "").strip().lower()
    _reset_if_new_day(user)
    svc = get_vault_policy_service()
    policy = svc.get_policy(user_address, create_if_missing=False)
    ep = (policy or {}).get("execution_policy", {})

    return {
        "user_address": user,
        "emergency_pause": ep.get("emergency_pause", False),
        "cooldown_seconds": ep.get("cooldown_seconds", 300),
        "last_exec_ts": _last_exec_ts.get(user),
        "daily_notional_spent_wei": _daily_notional[user]["total"],
        "daily_notional_limit_wei": ep.get("max_daily_notional_wei", 0),
        "policy_hash": VaultPolicyService.policy_hash(policy) if policy else None,
    }
