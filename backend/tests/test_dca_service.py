import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import time
from unittest.mock import AsyncMock, patch


def test_should_run_dca_respects_interval():
    from app.services.dca_service import should_run_dca
    now = time.time()
    assert should_run_dca(now, last_run=0, interval_secs=3600) is True
    assert should_run_dca(now, last_run=now - 1800, interval_secs=3600) is False
    assert should_run_dca(now, last_run=now - 3601, interval_secs=3600) is True


def test_should_run_dca_first_run():
    from app.services.dca_service import should_run_dca
    assert should_run_dca(time.time(), last_run=None, interval_secs=60) is True


def test_get_token_decimals_returns_correct_values():
    from app.services.dca_service import get_token_decimals
    assert get_token_decimals("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d") == 18
    assert get_token_decimals("0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080") == 6
    assert get_token_decimals("0xunknown") == 18


def test_amount_to_wei_uses_correct_decimals():
    from app.services.dca_service import amount_to_wei
    assert amount_to_wei(100.0, 18) == 100 * 10**18
    assert amount_to_wei(100.0, 6) == 100 * 10**6


@pytest.mark.asyncio
async def test_execute_dca_checks_interval_before_swap():
    """DCA should skip if interval hasn't elapsed."""
    from app.services.dca_service import execute_dca_step

    config = {
        "token_in": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "token_out": "0xstrkbtc",
        "amount_per_interval": 100,
        "interval_secs": 3600,
        "max_slippage_bps": 50,
    }
    state = {"last_run": time.time() - 100}

    result = await execute_dca_step("0xuser", config, state)
    assert result["skipped"] is True
    assert result["reason"] == "interval_not_elapsed"


@pytest.mark.asyncio
async def test_execute_dca_runs_signal_check_before_swap():
    """DCA should run signal pass (slippage check) before executing swap."""
    from app.services.dca_service import execute_dca_step
    from app.services.signal_report import SignalReport

    config = {
        "token_in": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "token_out": "0xstrkbtc",
        "amount_per_interval": 100,
        "interval_secs": 3600,
        "max_slippage_bps": 50,
    }
    state = {"last_run": 0}

    with patch("app.services.signal_pass_service.compute_signals", new_callable=AsyncMock) as mock_sig, \
         patch("app.services.dca_service._submit_swap", new_callable=AsyncMock) as mock_swap:

        mock_sig.return_value = {"dca_pair": SignalReport(
            pool_id="dca_pair", slippage_ok=False, gates_passed=0, gates_total=1)}
        result = await execute_dca_step("0xuser", config, state)

    assert result["skipped"] is True
    assert result["reason"] == "slippage_exceeded"
    mock_swap.assert_not_called()


@pytest.mark.asyncio
async def test_execute_dca_submits_swap_when_gates_pass():
    """DCA should submit swap when interval elapsed and slippage is ok."""
    from app.services.dca_service import execute_dca_step
    from app.services.signal_report import SignalReport

    config = {
        "token_in": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "token_out": "0xstrkbtc",
        "amount_per_interval": 50,
        "interval_secs": 3600,
        "max_slippage_bps": 50,
    }
    state = {"last_run": 0}

    with patch("app.services.signal_pass_service.compute_signals", new_callable=AsyncMock) as mock_sig, \
         patch("app.services.dca_service._submit_swap", new_callable=AsyncMock) as mock_swap:

        mock_sig.return_value = {"dca_pair": SignalReport(
            pool_id="dca_pair", slippage_ok=True, gates_passed=1, gates_total=1)}
        mock_swap.return_value = {"tx_hash": "0xabc123"}

        result = await execute_dca_step("0xuser", config, state)

    assert result["skipped"] is False
    assert result["tx_hash"] == "0xabc123"
    assert result["amount_wei"] == 50 * 10**18
    assert state["last_run"] > 0
    mock_swap.assert_called_once()
