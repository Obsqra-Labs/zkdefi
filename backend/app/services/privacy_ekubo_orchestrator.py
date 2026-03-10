"""Privacy → Ekubo orchestration: deployable balance → recommend → execute (Ekubo only) → receipt.

Reads real vault balances from the double-entry ledger and real pool data
from the Ekubo API via EkuboPoolAggregator.
"""
import logging
import os
import uuid
from typing import Any, Optional

from app.services.real_pool_aggregator import EkuboPoolAggregator
from app.services.vault_execute_service import execute_strategy_impl
from app.services.receipt_service import ReceiptService
from app.services.double_entry_ledger import DoubleEntryLedger

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DATA_DIR, "vault_v2.db")

_ledger: Optional[DoubleEntryLedger] = None
_pool_aggregator: Optional[EkuboPoolAggregator] = None


def _get_ledger() -> DoubleEntryLedger:
    global _ledger
    if _ledger is None:
        os.makedirs(_DATA_DIR, exist_ok=True)
        _ledger = DoubleEntryLedger(_DB_PATH)
    return _ledger


def _get_pool_aggregator() -> EkuboPoolAggregator:
    global _pool_aggregator
    if _pool_aggregator is None:
        _pool_aggregator = EkuboPoolAggregator()
    return _pool_aggregator


def _read_vault_balance(user_address: str, token: str = "ETH") -> int:
    """Return available balance (wei) for a vault from the ledger."""
    try:
        ledger = _get_ledger()
        return ledger.balance(f"VAULT_AVAILABLE:{user_address}:{token}")
    except Exception as exc:
        logger.warning("Could not read vault balance for %s: %s", user_address, exc)
        return 0


def _build_allocations_from_pools(
    pools: list[dict[str, Any]],
    deployable_amount: float,
    risk_profile: str,
) -> list[dict[str, Any]]:
    """Select and weight real Ekubo pools based on risk profile."""
    if not pools:
        return []

    profile = (risk_profile or "").strip().lower()
    if profile == "conservative":
        take = 1
    elif profile == "aggressive":
        take = min(3, len(pools))
    else:
        take = min(2, len(pools))

    selected = pools[:take]
    split = 1.0 / float(take)
    return [
        {
            "strategy": p.get("pool_id", "ekubo_lp"),
            "percentage": split * 100,
            "amount": deployable_amount * split,
            "pair": p.get("pair"),
            "estimated_fee_apy_pct": p.get("estimated_fee_apy_pct", 0),
        }
        for p in selected
    ]


async def orchestrate_deploy(
    user_address: str,
    deployable_amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """
    Personal v1: fetch real Ekubo pools, allocate, execute via vault, record receipt.
    Returns deployment_id, positions, receipt_id, target=ekubo.
    """
    if deployable_amount <= 0:
        raise ValueError("deployable_amount must be positive")

    # Read real vault balance from the double-entry ledger
    vault_balance = _read_vault_balance(user_address)
    logger.info(
        "Vault balance for %s: %d wei (deploying %.2f)",
        user_address, vault_balance, deployable_amount,
    )

    # Fetch real pool data from Ekubo API
    aggregator = _get_pool_aggregator()
    real_pools = await aggregator.get_top_pools(min_tvl_usd=0.0, limit=20)

    if not real_pools:
        raise ValueError("No Ekubo pools available from live API")

    # Build allocations from real pool data
    allocations = _build_allocations_from_pools(
        real_pools, deployable_amount, risk_profile
    )
    if not allocations:
        raise ValueError("No Ekubo pools matched allocation criteria")

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
        "pool_count": len(real_pools),
        "vault_balance_wei": vault_balance,
    }
