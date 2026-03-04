"""Privacy → Ekubo orchestration: deployable balance → recommend → execute (Ekubo only) → receipt.

Also provides vault-level capital deployment from the Private Yield Vault to Ekubo LP positions.
"""
import logging
import uuid
from typing import Any

from app.services.signal_pass_service import compute_signals
from app.services.ai_allocation import compute_allocation
from app.services.pool_metrics import fetch_pool_metrics
from app.services.risk_engine import score_risk
from app.services.vault_execute_service import execute_strategy_impl
from app.services.receipt_service import get_receipt_service
from app.services import execution_guard
from app.models.action_intent import ActionIntent

logger = logging.getLogger(__name__)


async def orchestrate_deploy(
    user_address: str,
    deployable_amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """
    Personal v1: get recommendation (Ekubo-only), execute via vault, record receipt.
    Returns deployment_id, positions, receipt_id, target=ekubo.
    """
    if deployable_amount <= 0:
        raise ValueError("deployable_amount must be positive")

    # ── Execution guard pre-check ────────────────────────────────
    intent = ActionIntent(
        user_address=user_address,
        strategy="manual",
        notional_wei=int(deployable_amount * 10**6),
        metadata={"risk_profile": risk_profile, "source": "privacy_orchestrator"},
    )
    guard = execution_guard.check(intent)
    if not guard.allowed:
        raise ValueError(f"Execution guard blocked: {guard.reason}")

    pool_metrics_raw = await fetch_pool_metrics(min_tvl_usd=1000, limit=20)
    candidate_pools = []
    for pm in pool_metrics_raw:
        candidate_pools.append({
            "pool_id": getattr(pm, "pool_id", ""),
            "pair": getattr(pm, "pair", ""),
            "token0": getattr(pm, "token0", ""),
            "token1": getattr(pm, "token1", ""),
            "apy_pct": getattr(pm, "apy_pct", 0),
            "tvl_usd": getattr(pm, "tvl_usd", 0),
            "liquidity_usd": getattr(pm, "liquidity_usd", 0),
        })

    amount_wei = int(deployable_amount * 10**18)
    signals = await compute_signals(candidate_pools, amount_wei=amount_wei, token_decimals=18)

    assessment = score_risk(risk_level={"conservative": 3, "balanced": 5, "aggressive": 8}.get(risk_profile, 5))
    from app.services.ai_allocation import PoolMetric
    pool_objs = [PoolMetric(pool_id=p["pool_id"], protocol="Ekubo", pair=p["pair"],
                             apy_pct=p["apy_pct"], tvl_usd=p["tvl_usd"],
                             volume_24h_usd=0, fee_ratio=0.003,
                             risk_tier="low", raw=p) for p in candidate_pools]
    allocation = await compute_allocation(assessment, pool_objs, deployable_amount,
                                          user_address=user_address, signals=signals)

    pools = [{"pool_id": a.get("pool_id", ""), "allocation_percent": a.get("allocation_pct", 0),
              "expected_apy": a.get("expected_apy", 0)} for a in (allocation.allocations or [])]

    if not pools:
        raise ValueError("No Ekubo pools in recommendation")
    allocations = [
        {
            "strategy": p.get("pool_id", "ekubo_lp"),
            "percentage": p.get("allocation_percent", 0),
            "amount": p.get("allocation_amount", 0),
        }
        for p in pools
    ]
    req_dict = {
        "user_address": user_address,
        "risk_profile": risk_profile,
        "deposit_amount": deployable_amount,
        "allocations": allocations,
    }
    exec_result = await execute_strategy_impl(req_dict)
    deployment_id = exec_result.get("deployment_id") or f"deploy_{uuid.uuid4().hex[:12]}"
    positions = []
    for p in exec_result.get("positions", []):
        pos = {"strategy": p["strategy"], "amount": p["amount"], "status": p["status"]}
        if p.get("tx_hash") is not None:
            pos["tx_hash"] = p["tx_hash"]
        if p.get("tx_calldata") is not None:
            pos["tx_calldata"] = p["tx_calldata"]
        if p.get("tx_calldata_error") is not None:
            pos["tx_calldata_error"] = p["tx_calldata_error"]
        if p.get("cap_applied") is not None:
            pos["cap_applied"] = p["cap_applied"]
        positions.append(pos)
    proof_hash = exec_result.get("zkml_proof_hash") or f"0x{uuid.uuid4().hex}"
    # Record receipt
    receipt_svc = get_receipt_service()
    receipt = await receipt_svc.create_receipt(
        user_address=user_address,
        constraints_hash=f"ekubo_only_{deployment_id}",
        proof_hash=proof_hash,
        action_type="deploy",
        protocol_id=1,
        amount=int(deployable_amount * 1e6),
    )
    return {
        "deployment_id": deployment_id,
        "positions": positions,
        "receipt_id": receipt["receipt_id"],
        "target": "ekubo",
        "recommendation_id": getattr(allocation, "attestation_hash", None),
    }


async def deploy_vault_idle_capital(risk_profile: str = "balanced") -> dict[str, Any]:
    """
    Deploy idle capital from the Private Yield Vault to Ekubo LP and/or LendingPool.

    Reads idle balance from private_yield_service, computes allocation split,
    and executes deployments. Records each deployment in the vault ledger.
    """
    from app.services.private_yield_service import (
        deploy_idle_capital,
    )
    return await deploy_idle_capital(risk_profile)
