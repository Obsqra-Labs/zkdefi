"""
Allocation execution service.

Normalizes strategy allocations and optionally submits live protocol calls via
`ContractExecutor`. When live submission is not configured, it records a
deterministic "recorded" execution status (no fake tx hashes).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

from app.services.contract_executor import ContractExecutor, get_executor
from app.services.real_pool_aggregator import EkuboPoolAggregator

logger = logging.getLogger(__name__)


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


@dataclass
class AllocationExecution:
    strategy: str
    pool_id: str
    amount: float
    tx_hash: Optional[str]
    status: str
    expected_apy: float
    pool_name: str
    protocol: str

    def to_position_dict(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy,
            "pool_id": self.pool_id,
            "amount": self.amount,
            "tx_hash": self.tx_hash,
            "status": self.status,
            "expected_apy": self.expected_apy,
            "pool_name": self.pool_name,
            "protocol": self.protocol,
        }


class AllocationExecutor:
    def __init__(
        self,
        executor: Optional[ContractExecutor] = None,
        aggregator: Optional[EkuboPoolAggregator] = None,
    ) -> None:
        self.executor = executor or get_executor()
        self.aggregator = aggregator or EkuboPoolAggregator()

    async def execute_allocations(
        self,
        user_address: str,
        allocations: list[dict[str, Any]],
    ) -> list[AllocationExecution]:
        # Best effort fetch for richer labels/APY context; failures are non-fatal.
        pool_index: dict[str, dict[str, Any]] = {}
        try:
            top = await self.aggregator.get_top_pools(min_tvl_usd=0.0, limit=200)
            pool_index = {str(p.get("pool_id")): p for p in top}
        except Exception as exc:
            logger.warning("Failed to fetch live pool index, continuing without it: %s", exc)

        executions: list[AllocationExecution] = []
        for raw in allocations:
            strategy = str(raw.get("strategy") or raw.get("pool_id") or "allocation")
            pool_id = str(raw.get("pool_id") or strategy)
            protocol = str(raw.get("protocol") or ("ekubo" if "ekubo" in strategy.lower() else "unknown"))
            amount = _as_float(raw.get("amount"), 0.0)
            expected_apy = _as_float(raw.get("expected_apy"), 0.0)

            live_pool = pool_index.get(pool_id)
            if live_pool and expected_apy <= 0:
                expected_apy = _as_float(live_pool.get("estimated_fee_apy_pct"), 0.0)
            pool_name = str(raw.get("pool_name") or raw.get("token_pair") or (live_pool or {}).get("pair") or pool_id)

            tx_hash = await self.executor.maybe_submit_allocation(
                pool_id=pool_id,
                amount_wei=int(amount * 1e18),
                protocol=protocol,
            )
            status = "deployed" if tx_hash else "recorded"

            executions.append(
                AllocationExecution(
                    strategy=strategy,
                    pool_id=pool_id,
                    amount=amount,
                    tx_hash=tx_hash,
                    status=status,
                    expected_apy=expected_apy,
                    pool_name=pool_name,
                    protocol=protocol,
                )
            )

        return executions


_ALLOCATION_EXECUTOR: Optional[AllocationExecutor] = None


def get_allocation_executor() -> AllocationExecutor:
    global _ALLOCATION_EXECUTOR
    if _ALLOCATION_EXECUTOR is None:
        _ALLOCATION_EXECUTOR = AllocationExecutor()
    return _ALLOCATION_EXECUTOR

