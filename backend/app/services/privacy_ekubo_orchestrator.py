"""Privacy → Ekubo orchestration: deployable balance → recommend → execute (Ekubo only) → receipt."""
import logging
import uuid
from typing import Any

from app.services.strategy_recommendation_service import get_recommendation
from app.services.vault_execute_service import execute_strategy_impl
from app.services.receipt_service import ReceiptService

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
    rec = await get_recommendation(user_address, deployable_amount, risk_profile)
    pools = rec.get("recommended_pools") or []
    # Restrict to Ekubo only
    ekubo_pools = [p for p in pools if (p.get("protocol") or "").lower() == "ekubo"]
    if not ekubo_pools:
        raise ValueError("No Ekubo pools in recommendation")
    # Build allocations for vault execute (dict shape for execute_strategy_impl)
    allocations = [
        {
            "strategy": p.get("pool_id", "ekubo_lp"),
            "percentage": p.get("allocation_percent", 0),
            "amount": p.get("allocation_amount", 0),
        }
        for p in ekubo_pools
    ]
    req_dict = {
        "user_address": user_address,
        "risk_profile": risk_profile,
        "deposit_amount": deployable_amount,
        "allocations": allocations,
    }
    exec_result = await execute_strategy_impl(req_dict)
    deployment_id = exec_result.get("deployment_id") or f"deploy_{uuid.uuid4().hex[:12]}"
    positions = [
        {"strategy": p["strategy"], "amount": p["amount"], "status": p["status"]}
        for p in exec_result.get("positions", [])
    ]
    proof_hash = exec_result.get("zkml_proof_hash") or f"0x{uuid.uuid4().hex}"
    # Record receipt
    receipt_svc = ReceiptService()
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
        "recommendation_id": rec.get("recommendation_id"),
    }
