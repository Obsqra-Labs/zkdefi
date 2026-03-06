"""
Private Yield Service

Manages the hybrid lending vault: tracks private deposits, share accounting,
yield attribution from Ekubo LP and LendingPool interest, and operator
capital deployment.

Option A design: backend ledger tracks deposits/shares; operator wallet
manages capital deployment. User privacy preserved via commitment-based
deposits/withdrawals with ZK proofs.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any, Optional

from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)

WEI_PER_ETH = 10**18

PRIVATE_YIELD_POOL_ADDRESS = os.getenv("PRIVATE_YIELD_POOL_ADDRESS", "0x0")
ETH_TOKEN = os.getenv(
    "ETH_TOKEN_ADDRESS",
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
)

_positions_store = JsonStore("private_yield_positions")
_vault_store = JsonStore("private_yield_vault")
_deployments_store = JsonStore("yield_vault_deployments")


def _ensure_vault_state() -> dict[str, Any]:
    """Ensure vault aggregate state exists and return it."""
    state = _vault_store.get("state")
    if state is None:
        state = {
            "total_deposits_wei": 0,
            "total_shares": 0,
            "total_yield_wei": 0,
            "ekubo_deployed_wei": 0,
            "lending_deployed_wei": 0,
            "idle_wei": 0,
            "share_price_wei": WEI_PER_ETH,
            "last_accrual": int(time.time()),
            "deposit_count": 0,
        }
        _vault_store.set("state", state)
    return state


def get_vault_stats() -> dict[str, Any]:
    """Public vault statistics."""
    state = _ensure_vault_state()
    total_deposits = int(state.get("total_deposits_wei", 0))
    total_yield = int(state.get("total_yield_wei", 0))
    ekubo_deployed = int(state.get("ekubo_deployed_wei", 0))
    lending_deployed = int(state.get("lending_deployed_wei", 0))
    idle = int(state.get("idle_wei", 0))
    total_shares = int(state.get("total_shares", 0))
    share_price = int(state.get("share_price_wei", WEI_PER_ETH))
    tvl = total_deposits + total_yield

    ekubo_pct = round(ekubo_deployed / tvl * 100, 2) if tvl > 0 else 0
    lending_pct = round(lending_deployed / tvl * 100, 2) if tvl > 0 else 0
    idle_pct = round(idle / tvl * 100, 2) if tvl > 0 else 0

    ekubo_apy_bps = _estimate_ekubo_apy_bps()
    lending_apy_bps = _estimate_lending_apy_bps()

    blended_apy_bps = 0
    if tvl > 0:
        blended_apy_bps = int(
            (ekubo_deployed * ekubo_apy_bps + lending_deployed * lending_apy_bps)
            / tvl
        )

    return {
        "pool_address": PRIVATE_YIELD_POOL_ADDRESS,
        "token": ETH_TOKEN,
        "tvl_wei": tvl,
        "tvl_eth": round(tvl / WEI_PER_ETH, 6),
        "total_deposits_wei": total_deposits,
        "total_deposits_eth": round(total_deposits / WEI_PER_ETH, 6),
        "total_yield_wei": total_yield,
        "total_yield_eth": round(total_yield / WEI_PER_ETH, 6),
        "ekubo_deployed_wei": ekubo_deployed,
        "ekubo_deployed_eth": round(ekubo_deployed / WEI_PER_ETH, 6),
        "ekubo_pct": ekubo_pct,
        "lending_deployed_wei": lending_deployed,
        "lending_deployed_eth": round(lending_deployed / WEI_PER_ETH, 6),
        "lending_pct": lending_pct,
        "idle_wei": idle,
        "idle_eth": round(idle / WEI_PER_ETH, 6),
        "idle_pct": idle_pct,
        "total_shares": total_shares,
        "share_price_wei": share_price,
        "share_price_eth": round(share_price / WEI_PER_ETH, 6),
        "ekubo_apy_bps": ekubo_apy_bps,
        "lending_apy_bps": lending_apy_bps,
        "blended_apy_bps": blended_apy_bps,
        "blended_apy_pct": round(blended_apy_bps / 100, 2),
        "deposit_count": int(state.get("deposit_count", 0)),
        "last_accrual": state.get("last_accrual"),
    }


def register_deposit(
    commitment: str,
    amount_wei: int,
    user_address: Optional[str] = None,
    pool_address: Optional[str] = None,
) -> dict[str, Any]:
    """
    Record a private deposit into the yield vault.

    Called after register_commitment when the deposit targets the ETH yield pool.
    """
    state = _ensure_vault_state()

    share_price = int(state.get("share_price_wei", WEI_PER_ETH))
    shares = (amount_wei * WEI_PER_ETH) // share_price if share_price > 0 else amount_wei

    position_id = f"pyp_{uuid.uuid4().hex[:12]}"
    position = {
        "position_id": position_id,
        "commitment": commitment,
        "amount_wei": amount_wei,
        "shares": shares,
        "deposited_at": int(time.time()),
        "yield_earned_wei": 0,
        "withdrawn": False,
        "user_address": user_address,
    }
    _positions_store.set(commitment, position)

    state["total_deposits_wei"] = int(state.get("total_deposits_wei", 0)) + amount_wei
    state["total_shares"] = int(state.get("total_shares", 0)) + shares
    state["idle_wei"] = int(state.get("idle_wei", 0)) + amount_wei
    state["deposit_count"] = int(state.get("deposit_count", 0)) + 1
    _vault_store.set("state", state)

    logger.info(
        "[PrivateYield] Deposit registered: commitment=%s amount=%s shares=%s",
        commitment[:20], amount_wei, shares,
    )

    return position


def get_position(commitment: str) -> Optional[dict[str, Any]]:
    """Retrieve a position by commitment hash."""
    return _positions_store.get(commitment)


def get_user_positions(user_address: str) -> list[dict[str, Any]]:
    """Get all positions for a given user address."""
    positions = []
    for pos in _positions_store.values():
        if isinstance(pos, dict) and pos.get("user_address") == user_address and not pos.get("withdrawn"):
            positions.append(pos)
    return positions


def record_deployment(
    target: str,
    amount_wei: int,
    position_nft_id: Optional[str] = None,
    pool_key: Optional[dict] = None,
    tx_hash: Optional[str] = None,
) -> dict[str, Any]:
    """
    Record an operator capital deployment to Ekubo or LendingPool.
    """
    state = _ensure_vault_state()
    deployment_id = f"deploy_{uuid.uuid4().hex[:12]}"

    deployment = {
        "deployment_id": deployment_id,
        "target": target,
        "amount_wei": amount_wei,
        "position_nft_id": position_nft_id,
        "pool_key": pool_key,
        "deployed_at": int(time.time()),
        "active": True,
        "yield_collected_wei": 0,
        "tx_hash": tx_hash,
    }
    _deployments_store.set(deployment_id, deployment)

    idle = int(state.get("idle_wei", 0))
    if target == "ekubo":
        state["ekubo_deployed_wei"] = int(state.get("ekubo_deployed_wei", 0)) + amount_wei
    elif target == "lending":
        state["lending_deployed_wei"] = int(state.get("lending_deployed_wei", 0)) + amount_wei

    state["idle_wei"] = max(0, idle - amount_wei)
    _vault_store.set("state", state)

    logger.info(
        "[PrivateYield] Deployment recorded: %s target=%s amount=%s",
        deployment_id, target, amount_wei,
    )
    return deployment


def record_yield(
    source: str,
    amount_wei: int,
    deployment_id: Optional[str] = None,
) -> None:
    """
    Record yield earned from a source (ekubo or lending).
    Distributes proportionally to all active positions.
    """
    state = _ensure_vault_state()
    total_shares = int(state.get("total_shares", 0))
    if total_shares == 0 or amount_wei <= 0:
        return

    state["total_yield_wei"] = int(state.get("total_yield_wei", 0)) + amount_wei
    state["idle_wei"] = int(state.get("idle_wei", 0)) + amount_wei

    old_price = int(state.get("share_price_wei", WEI_PER_ETH))
    tvl = int(state.get("total_deposits_wei", 0)) + int(state.get("total_yield_wei", 0))
    state["share_price_wei"] = (tvl * WEI_PER_ETH) // total_shares if total_shares > 0 else WEI_PER_ETH

    state["last_accrual"] = int(time.time())
    _vault_store.set("state", state)

    for key in _positions_store.keys():
        pos = _positions_store.get(key)
        if pos and not pos.get("withdrawn"):
            pos_shares = int(pos.get("shares", 0))
            pos_yield = (amount_wei * pos_shares) // total_shares
            pos["yield_earned_wei"] = int(pos.get("yield_earned_wei", 0)) + pos_yield
            _positions_store.set(key, pos)

    if deployment_id:
        dep = _deployments_store.get(deployment_id)
        if dep:
            dep["yield_collected_wei"] = int(dep.get("yield_collected_wei", 0)) + amount_wei
            _deployments_store.set(deployment_id, dep)

    logger.info("[PrivateYield] Yield recorded: source=%s amount=%s", source, amount_wei)


def prepare_withdrawal(commitment: str) -> dict[str, Any]:
    """
    Prepare withdrawal data: compute principal + yield for a commitment.
    Returns amount available. Actual withdrawal happens via ZK proof on-chain.
    """
    pos = _positions_store.get(commitment)
    if not pos:
        return {"available": False, "reason": "Position not found"}
    if pos.get("withdrawn"):
        return {"available": False, "reason": "Already withdrawn"}

    principal = int(pos.get("amount_wei", 0))
    yield_earned = int(pos.get("yield_earned_wei", 0))
    total = principal + yield_earned

    state = _ensure_vault_state()
    idle = int(state.get("idle_wei", 0))
    needs_unwind = total > idle

    return {
        "available": True,
        "commitment": commitment,
        "principal_wei": principal,
        "yield_earned_wei": yield_earned,
        "total_withdrawable_wei": total,
        "total_withdrawable_eth": round(total / WEI_PER_ETH, 6),
        "needs_unwind": needs_unwind,
        "idle_balance_wei": idle,
    }


def complete_withdrawal(commitment: str) -> bool:
    """Mark a position as withdrawn after ZK-proof withdrawal succeeds on-chain."""
    pos = _positions_store.get(commitment)
    if not pos:
        return False

    state = _ensure_vault_state()
    principal = int(pos.get("amount_wei", 0))
    yield_earned = int(pos.get("yield_earned_wei", 0))
    shares = int(pos.get("shares", 0))

    state["total_deposits_wei"] = max(0, int(state.get("total_deposits_wei", 0)) - principal)
    state["total_yield_wei"] = max(0, int(state.get("total_yield_wei", 0)) - yield_earned)
    state["total_shares"] = max(0, int(state.get("total_shares", 0)) - shares)
    state["idle_wei"] = max(0, int(state.get("idle_wei", 0)) - (principal + yield_earned))

    tvl = int(state.get("total_deposits_wei", 0)) + int(state.get("total_yield_wei", 0))
    total_shares = int(state.get("total_shares", 0))
    state["share_price_wei"] = (tvl * WEI_PER_ETH) // total_shares if total_shares > 0 else WEI_PER_ETH

    _vault_store.set("state", state)

    pos["withdrawn"] = True
    pos["withdrawn_at"] = int(time.time())
    _positions_store.set(commitment, pos)

    logger.info("[PrivateYield] Withdrawal completed: commitment=%s", commitment[:20])
    return True


def get_active_deployments() -> list[dict[str, Any]]:
    """Return all active capital deployments."""
    return [
        d for d in _deployments_store.values()
        if isinstance(d, dict) and d.get("active")
    ]


def recall_deployment(deployment_id: str, returned_wei: int) -> bool:
    """Record capital recall from a deployment (e.g., Ekubo LP removal)."""
    dep = _deployments_store.get(deployment_id)
    if not dep:
        return False

    state = _ensure_vault_state()
    target = dep.get("target", "ekubo")

    if target == "ekubo":
        state["ekubo_deployed_wei"] = max(
            0, int(state.get("ekubo_deployed_wei", 0)) - int(dep.get("amount_wei", 0))
        )
    elif target == "lending":
        state["lending_deployed_wei"] = max(
            0, int(state.get("lending_deployed_wei", 0)) - int(dep.get("amount_wei", 0))
        )

    state["idle_wei"] = int(state.get("idle_wei", 0)) + returned_wei
    _vault_store.set("state", state)

    dep["active"] = False
    dep["recalled_at"] = int(time.time())
    dep["returned_wei"] = returned_wei
    _deployments_store.set(deployment_id, dep)

    logger.info("[PrivateYield] Deployment recalled: %s returned=%s", deployment_id, returned_wei)
    return True


def accrue_yield() -> dict[str, Any]:
    """
    Run yield accrual across all active deployments.
    Checks Ekubo LP value changes and lending interest.
    Returns summary of accrued amounts.
    """
    ekubo_yield = _accrue_ekubo_yield()
    lending_yield = _accrue_lending_yield()

    total = ekubo_yield + lending_yield
    if total > 0:
        state = _ensure_vault_state()
        state["last_accrual"] = int(time.time())
        _vault_store.set("state", state)

    return {
        "ekubo_yield_wei": ekubo_yield,
        "lending_yield_wei": lending_yield,
        "total_yield_wei": total,
        "total_yield_eth": round(total / WEI_PER_ETH, 6),
        "timestamp": int(time.time()),
    }


def _accrue_ekubo_yield() -> int:
    """Check Ekubo LP deployments for accrued fees based on elapsed time and estimated APY."""
    total_yield = 0
    ekubo_apy_bps = _estimate_ekubo_apy_bps()
    seconds_per_year = 365 * 24 * 3600

    for dep in get_active_deployments():
        if dep.get("target") != "ekubo":
            continue
        try:
            amount = int(dep.get("amount_wei", 0))
            last_accrual = int(dep.get("last_yield_accrual", dep.get("deployed_at", time.time())))
            elapsed = int(time.time()) - last_accrual
            if elapsed <= 0 or amount <= 0:
                continue
            fees = (amount * ekubo_apy_bps * elapsed) // (10_000 * seconds_per_year)
            if fees > 0:
                record_yield("ekubo", fees, dep["deployment_id"])
                dep["last_yield_accrual"] = int(time.time())
                _deployments_store.set(dep["deployment_id"], dep)
                total_yield += fees
        except Exception as e:
            logger.warning("[PrivateYield] Ekubo accrual error for %s: %s", dep.get("deployment_id"), e)
    return total_yield


def _accrue_lending_yield() -> int:
    """Check lending pool for interest earned on supplied capital."""
    total_yield = 0
    seconds_per_year = 365 * 24 * 3600

    for dep in get_active_deployments():
        if dep.get("target") != "lending":
            continue
        try:
            from app.services.lending_service import get_pool_stats
            stats = get_pool_stats()
            supply_apy_bps = stats.get("supply_apy_bps", 300)
            amount = int(dep.get("amount_wei", 0))
            last_accrual = int(dep.get("last_yield_accrual", dep.get("deployed_at", time.time())))
            elapsed = int(time.time()) - last_accrual
            if elapsed <= 0 or amount <= 0:
                continue
            interest = (amount * supply_apy_bps * elapsed) // (10_000 * seconds_per_year)
            if interest > 0:
                record_yield("lending", interest, dep["deployment_id"])
                dep["last_yield_accrual"] = int(time.time())
                _deployments_store.set(dep["deployment_id"], dep)
                total_yield += interest
        except Exception as e:
            logger.warning("[PrivateYield] Lending accrual error for %s: %s", dep.get("deployment_id"), e)
    return total_yield


def _estimate_ekubo_apy_bps() -> int:
    """Estimate current Ekubo LP APY in basis points from active deployments."""
    try:
        from app.services.ekubo_yield_service import get_yield_summary
        summary = get_yield_summary()
        if summary and summary.get("blended_apy_bps"):
            return int(summary["blended_apy_bps"])
    except Exception:
        pass
    return 450  # 4.5% default


def _estimate_lending_apy_bps() -> int:
    """Get current lending supply APY."""
    try:
        from app.services.lending_service import get_pool_stats
        stats = get_pool_stats()
        return stats.get("supply_apy_bps", 300)
    except Exception:
        return 300


async def deploy_idle_capital(risk_profile: str = "balanced") -> dict[str, Any]:
    """
    Deploy idle vault capital to Ekubo and/or LendingPool based on allocation strategy.
    """
    state = _ensure_vault_state()
    idle = int(state.get("idle_wei", 0))

    min_deploy = WEI_PER_ETH // 100  # 0.01 ETH minimum
    if idle < min_deploy:
        return {"deployed": False, "reason": "Insufficient idle balance", "idle_wei": idle}

    allocation = compute_allocation_split(idle, risk_profile)

    results = []

    ekubo_amount = allocation.get("ekubo_wei", 0)
    if ekubo_amount >= min_deploy:
        ekubo_result = await _deploy_to_ekubo(ekubo_amount, risk_profile)
        results.append(ekubo_result)

    lending_amount = allocation.get("lending_wei", 0)
    if lending_amount >= min_deploy:
        lending_result = _deploy_to_lending(lending_amount)
        results.append(lending_result)

    return {
        "deployed": True,
        "idle_before_wei": idle,
        "allocation": allocation,
        "results": results,
    }


def compute_allocation_split(
    amount_wei: int,
    risk_profile: str = "balanced",
    signals: dict | None = None,
) -> dict[str, Any]:
    """
    Determine how to split capital between Ekubo LP and LendingPool supply.

    - Conservative: 30% Ekubo, 50% Lending, 20% idle reserve
    - Balanced: 45% Ekubo, 35% Lending, 20% idle reserve
    - Aggressive: 60% Ekubo, 25% Lending, 15% idle reserve

    Adjusted by current utilization: if lending has high utilization,
    shift more to lending (higher yield from borrower demand).

    When signals are provided, adjustments are applied based on gate results.
    """
    base_splits = {
        "conservative": {"ekubo_pct": 30, "lending_pct": 50, "reserve_pct": 20},
        "balanced": {"ekubo_pct": 45, "lending_pct": 35, "reserve_pct": 20},
        "aggressive": {"ekubo_pct": 60, "lending_pct": 25, "reserve_pct": 15},
    }
    split = base_splits.get(risk_profile, base_splits["balanced"]).copy()

    try:
        from app.services.lending_service import get_pool_stats
        stats = get_pool_stats()
        utilization = stats.get("utilization_bps", 0)
        if utilization > 7000:
            split["lending_pct"] += 10
            split["ekubo_pct"] -= 10
        elif utilization < 2000:
            split["ekubo_pct"] += 10
            split["lending_pct"] -= 10
    except Exception:
        pass

    if signals:
        total_gates = 0
        passed_gates = 0
        any_il_fail = False
        any_slippage_fail = False
        for sig in signals.values():
            total_gates += getattr(sig, "gates_total", 0)
            passed_gates += getattr(sig, "gates_passed", 0)
            if getattr(sig, "il_acceptable", None) is False:
                any_il_fail = True
            if getattr(sig, "slippage_ok", None) is False:
                any_slippage_fail = True

        pass_rate = passed_gates / total_gates if total_gates > 0 else 0
        if pass_rate >= 0.8:
            split["ekubo_pct"] += 5
            split["lending_pct"] -= 5
        if any_il_fail:
            split["ekubo_pct"] -= 10
            split["lending_pct"] += 10
        if any_slippage_fail:
            split["ekubo_pct"] -= 5
            split["reserve_pct"] += 5

        split["ekubo_pct"] = max(split["ekubo_pct"], 15)
        split["lending_pct"] = max(split["lending_pct"], 10)
        split["reserve_pct"] = max(split["reserve_pct"], 5)

        total = split["ekubo_pct"] + split["lending_pct"] + split["reserve_pct"]
        if total != 100:
            split["reserve_pct"] += 100 - total

    ekubo_wei = (amount_wei * split["ekubo_pct"]) // 100
    lending_wei = (amount_wei * split["lending_pct"]) // 100
    reserve_wei = amount_wei - ekubo_wei - lending_wei

    return {
        "ekubo_wei": ekubo_wei,
        "ekubo_pct": split["ekubo_pct"],
        "lending_wei": lending_wei,
        "lending_pct": split["lending_pct"],
        "reserve_wei": reserve_wei,
        "reserve_pct": split["reserve_pct"],
        "risk_profile": risk_profile,
    }


async def _deploy_to_ekubo(amount_wei: int, risk_profile: str) -> dict[str, Any]:
    """Deploy capital to Ekubo LP via the existing orchestrator."""
    try:
        from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
        result = await orchestrate_deploy(
            user_address="operator_vault",
            deployable_amount=amount_wei / WEI_PER_ETH,
            risk_profile=risk_profile,
        )
        deployment = record_deployment(
            target="ekubo",
            amount_wei=amount_wei,
            position_nft_id=result.get("deployment_id"),
            tx_hash=result.get("positions", [{}])[0].get("tx_hash") if result.get("positions") else None,
        )
        return {"target": "ekubo", "status": "deployed", "deployment": deployment, "orchestration": result}
    except Exception as e:
        logger.error("[PrivateYield] Ekubo deploy failed: %s", e)
        return {"target": "ekubo", "status": "failed", "error": str(e)}


def _deploy_to_lending(amount_wei: int) -> dict[str, Any]:
    """Deploy capital to LendingPool as supply."""
    try:
        from app.services.lending_service import build_supply_calldata, record_supply
        calldata = build_supply_calldata(amount_wei)
        record_supply(
            address="operator_vault",
            supply_id=int(time.time()),
            amount_wei=amount_wei,
        )
        deployment = record_deployment(
            target="lending",
            amount_wei=amount_wei,
        )
        return {"target": "lending", "status": "deployed", "deployment": deployment, "calldata": calldata}
    except Exception as e:
        logger.error("[PrivateYield] Lending deploy failed: %s", e)
        return {"target": "lending", "status": "failed", "error": str(e)}


def get_blended_apy() -> dict[str, Any]:
    """Unified yield calculation: Ekubo fees + lending interest = blended APY."""
    state = _ensure_vault_state()
    tvl = int(state.get("total_deposits_wei", 0)) + int(state.get("total_yield_wei", 0))
    ekubo_deployed = int(state.get("ekubo_deployed_wei", 0))
    lending_deployed = int(state.get("lending_deployed_wei", 0))

    ekubo_apy_bps = _estimate_ekubo_apy_bps()
    lending_apy_bps = _estimate_lending_apy_bps()

    ekubo_yield_annual = (ekubo_deployed * ekubo_apy_bps) // 10_000
    lending_yield_annual = (lending_deployed * lending_apy_bps) // 10_000
    total_yield_annual = ekubo_yield_annual + lending_yield_annual

    blended_apy_bps = (total_yield_annual * 10_000) // tvl if tvl > 0 else 0

    return {
        "blended_apy_bps": blended_apy_bps,
        "blended_apy_pct": round(blended_apy_bps / 100, 2),
        "ekubo_contribution": {
            "deployed_wei": ekubo_deployed,
            "apy_bps": ekubo_apy_bps,
            "annual_yield_wei": ekubo_yield_annual,
        },
        "lending_contribution": {
            "deployed_wei": lending_deployed,
            "apy_bps": lending_apy_bps,
            "annual_yield_wei": lending_yield_annual,
        },
        "tvl_wei": tvl,
        "tvl_eth": round(tvl / WEI_PER_ETH, 6),
    }
