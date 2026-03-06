"""
Rebalancing Service — Phase E

Compares current LP positions against a fresh allocation decision.
When drift exceeds thresholds, generates remove + re-add calldata.

Pipeline:
  1. Read current positions from ekubo_lp_service JSON store
  2. Run fresh allocation (risk_engine → pool_metrics → ai_allocation)
  3. Compute drift per pool (current weight vs target weight)
  4. If max drift > threshold: generate remove calldata for over-weight,
     add calldata for under-weight positions
  5. Returns RebalancePlan with per-position actions

Depends on:
  - vault_allocation_executor (execute_allocation)
  - ekubo_lp_service (list_positions, build_lp_remove)
  - ai_allocation (compute_allocation)
  - risk_engine + pool_metrics
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

from app.services.real_pool_aggregator import _TOKEN_META, _TOKEN_SYMBOLS

logger = logging.getLogger(__name__)


# ── Data structures ─────────────────────────────────────────────────────

@dataclass
class RebalanceAction:
    """Single rebalance action for a position."""
    action: str                 # "remove" | "add" | "keep"
    pool_id: str
    pair: str
    current_weight_pct: float
    target_weight_pct: float
    drift_pct: float            # absolute difference
    position_id: str | None     # for remove actions
    amount_usd: float           # target amount after rebalance
    calldata: dict[str, Any] | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RebalancePlan:
    """Full rebalance plan."""
    timestamp: str
    risk_profile: str
    deposit_amount: float
    drift_threshold_pct: float
    max_drift_pct: float
    needs_rebalance: bool
    actions: list[RebalanceAction]
    new_attestation_hash: str

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["actions"] = [a.to_dict() for a in self.actions]
        return d


# ── Helpers ─────────────────────────────────────────────────────────────

def _sym_for_addr(addr: str) -> str:
    norm = str(addr).strip().lower()
    for k, v in _TOKEN_SYMBOLS.items():
        if k.lower() == norm:
            return v
    return "UNKNOWN"


def _wei_to_usd(amount_wei: int, symbol: str) -> float:
    meta = _TOKEN_META.get(symbol)
    if not meta:
        return 0.0
    decimals, price_usd = meta
    return (amount_wei / (10 ** decimals)) * price_usd


def _pair_name(token0: str, token1: str) -> str:
    return f"{_sym_for_addr(token0)}/{_sym_for_addr(token1)}"


# ── Core rebalance logic ───────────────────────────────────────────────

DEFAULT_DRIFT_THRESHOLD = 10.0  # % absolute drift before rebalancing


async def compute_rebalance_plan(
    owner: str,
    risk_profile: str = "balanced",
    deposit_amount: float | None = None,
    drift_threshold_pct: float = DEFAULT_DRIFT_THRESHOLD,
    time_horizon_days: int = 30,
) -> RebalancePlan:
    """
    Compare current positions vs fresh allocation target.
    Returns a plan with remove/add actions if drift exceeds threshold.
    """
    from app.services.ekubo_lp_service import list_positions as lp_list_positions
    from app.services.risk_engine import score_risk, label_from_string
    from app.services.pool_metrics import fetch_pool_metrics
    from app.services.ai_allocation import compute_allocation

    # 1. Read current positions
    positions = lp_list_positions(owner)
    current_portfolio = _aggregate_current_positions(positions)
    total_current_usd = sum(p["usd_value"] for p in current_portfolio.values())

    if deposit_amount is None:
        deposit_amount = max(total_current_usd, 1000.0)

    # 2. Get fresh allocation target
    risk_level = label_from_string(risk_profile)
    assessment = score_risk(risk_level=risk_level, time_horizon_days=time_horizon_days)
    pools = await fetch_pool_metrics(min_tvl_usd=100.0, limit=50)
    decision = await compute_allocation(
        assessment=assessment,
        pools=pools,
        deposit_amount=deposit_amount,
        user_address=owner,
    )

    # 3. Build target weight map
    target_weights: dict[str, float] = {}
    target_pairs: dict[str, str] = {}
    for alloc in decision.allocations:
        target_weights[alloc.pair] = alloc.weight_pct
        target_pairs[alloc.pair] = alloc.pool_id

    # 4. Compute current weights
    current_weights: dict[str, float] = {}
    if total_current_usd > 0:
        for pair, info in current_portfolio.items():
            current_weights[pair] = (info["usd_value"] / total_current_usd) * 100.0

    # 5. Calculate drift and generate actions
    all_pairs = set(list(current_weights.keys()) + list(target_weights.keys()))
    actions: list[RebalanceAction] = []
    max_drift = 0.0

    for pair in all_pairs:
        curr = current_weights.get(pair, 0.0)
        target = target_weights.get(pair, 0.0)
        drift = abs(curr - target)
        max_drift = max(max_drift, drift)

        if drift < drift_threshold_pct:
            action_type = "keep"
            calldata = None
        elif curr > target:
            action_type = "remove"
            # Build remove calldata for over-weight position
            pos_ids = current_portfolio.get(pair, {}).get("position_ids", [])
            calldata = await _build_remove_calldata(pos_ids, owner)
        else:
            action_type = "add"
            calldata = None  # Will be generated during execution

        actions.append(RebalanceAction(
            action=action_type,
            pool_id=target_pairs.get(pair, current_portfolio.get(pair, {}).get("pool_id", "")),
            pair=pair,
            current_weight_pct=round(curr, 2),
            target_weight_pct=round(target, 2),
            drift_pct=round(drift, 2),
            position_id=current_portfolio.get(pair, {}).get("position_ids", [None])[0] if action_type == "remove" else None,
            amount_usd=round(deposit_amount * target / 100.0, 2) if target > 0 else 0.0,
            calldata=calldata,
        ))

    needs_rebalance = max_drift >= drift_threshold_pct

    return RebalancePlan(
        timestamp=datetime.now(timezone.utc).isoformat(),
        risk_profile=risk_profile,
        deposit_amount=deposit_amount,
        drift_threshold_pct=drift_threshold_pct,
        max_drift_pct=round(max_drift, 2),
        needs_rebalance=needs_rebalance,
        actions=actions,
        new_attestation_hash=decision.attestation_hash,
    )


# ── Position aggregation ───────────────────────────────────────────────

def _aggregate_current_positions(positions: list[dict]) -> dict[str, dict]:
    """
    Aggregate LP positions by pair name.
    Returns {pair: {usd_value, position_ids, pool_id}}.
    """
    result: dict[str, dict] = {}
    for pos in positions:
        token0 = str(pos.get("token0", ""))
        token1 = str(pos.get("token1", ""))
        pair = _pair_name(token0, token1)

        sym0 = _sym_for_addr(token0)
        sym1 = _sym_for_addr(token1)
        usd0 = _wei_to_usd(int(pos.get("amount0") or 0), sym0)
        usd1 = _wei_to_usd(int(pos.get("amount1") or 0), sym1)

        if pair not in result:
            result[pair] = {
                "usd_value": 0.0,
                "position_ids": [],
                "pool_id": "",
            }
        result[pair]["usd_value"] += usd0 + usd1
        result[pair]["position_ids"].append(str(pos.get("position_id", "")))

    return result


async def _build_remove_calldata(
    position_ids: list[str],
    owner: str,
) -> dict[str, Any] | None:
    """Build remove-liquidity calldata for positions that need reduction."""
    if not position_ids:
        return None
    try:
        from app.services.ekubo_lp_service import build_lp_remove
        # Remove 100% of the first position (simplified; production would
        # calculate partial remove based on target drift)
        result = await build_lp_remove(
            owner=owner,
            position_id=position_ids[0],
            liquidity_bps=10_000,  # 100%
        )
        return result
    except Exception as e:
        logger.warning("build_lp_remove failed: %s", e)
        return None
