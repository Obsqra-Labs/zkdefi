#!/usr/bin/env python3
"""
Rebalancer unit tests.

Tests lock contention: second concurrent check for same proposal_id gets 503 (RuntimeError).
Run from repo root: python -m pytest tests/test_rebalancer.py -v
Or: cd backend && python -m pytest ../tests/test_rebalancer.py -v
"""
import sys
from pathlib import Path

backend = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend))

import asyncio
from unittest.mock import patch

import pytest

from app.services.agent_rebalancer import get_rebalancer, RebalanceStatus


@pytest.mark.asyncio
async def test_execute_rebalance_returns_execution_error_when_submit_fails():
    """When submit_rebalance returns error, execute_rebalance returns execution_error and sets proposal.error."""
    rebalancer = get_rebalancer()
    proposal = await rebalancer.propose_rebalance(
        user_address="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        from_protocol=0,
        to_protocol=1,
        amount=100,
        reason="test exec error",
    )
    proposal_id = proposal.proposal_id
    proposal.status = RebalanceStatus.READY_TO_EXECUTE
    proposal.risk_proof = {"proof_calldata": []}
    proposal.anomaly_proof = {"proof_calldata": []}
    proposal.commitment_hash = "0x0"
    proposal.execution_proof_hash = "0x0"

    with patch.object(rebalancer.agent_service, "submit_rebalance", return_value={"tx_hash": None, "error": "Simulated revert"}):
        result = await rebalancer.execute_rebalance(proposal_id=proposal_id, session_id="test-session")

    assert "execution_error" in result
    assert result["execution_error"] == "Simulated revert"
    assert result["tx_hash"] is not None  # fallback simulated
    assert rebalancer._proposals[proposal_id].error == "Simulated revert"


@pytest.mark.asyncio
async def test_check_zkml_gates_503_when_lock_held():
    """When the proposal lock is already held, check_zkml_gates raises RuntimeError with 'retry later' (API returns 503)."""
    rebalancer = get_rebalancer()
    proposal = await rebalancer.propose_rebalance(
        user_address="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        from_protocol=0,
        to_protocol=1,
        amount=100,
        reason="test 503",
    )
    proposal_id = proposal.proposal_id
    portfolio = [50, 50, 0, 0, 0, 0, 0, 0]

    async with rebalancer._lock_meta:
        plock = rebalancer._get_proposal_lock(proposal_id)
    await plock.acquire()
    try:
        with pytest.raises(RuntimeError, match="retry later"):
            await rebalancer.check_zkml_gates(proposal_id, portfolio, "pool_1")
    finally:
        plock.release()
