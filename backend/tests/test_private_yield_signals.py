import pytest
from unittest.mock import patch
from app.services.private_yield_service import compute_allocation_split


WEI = 10**18


def _make_signal(gates_passed, gates_total, slippage_ok=True, il_acceptable=True):
    from app.services.signal_report import SignalReport
    return SignalReport(
        pool_id="p1",
        gates_passed=gates_passed,
        gates_total=gates_total,
        slippage_ok=slippage_ok,
        il_acceptable=il_acceptable,
    )


@patch("app.services.lending_service.get_pool_stats", side_effect=Exception("no lending"))
def test_allocation_split_shifts_toward_ekubo_when_all_gates_pass(_):
    signals = {"p1": _make_signal(5, 5, slippage_ok=True, il_acceptable=True)}
    result = compute_allocation_split(100 * WEI, "balanced", signals=signals)
    base_ekubo = 45
    assert result["ekubo_pct"] > base_ekubo, f"ekubo_pct should exceed base {base_ekubo}, got {result['ekubo_pct']}"


@patch("app.services.lending_service.get_pool_stats", side_effect=Exception("no lending"))
def test_allocation_split_shifts_toward_lending_when_il_fails(_):
    signals = {"p1": _make_signal(3, 5, slippage_ok=True, il_acceptable=False)}
    result = compute_allocation_split(100 * WEI, "balanced", signals=signals)
    base_lending = 35
    assert result["lending_pct"] > base_lending, f"lending_pct should exceed base {base_lending}, got {result['lending_pct']}"


@patch("app.services.lending_service.get_pool_stats", side_effect=Exception("no lending"))
def test_allocation_split_defaults_without_signals(_):
    result = compute_allocation_split(100 * WEI, "balanced")
    assert result["ekubo_pct"] == 45
    assert result["lending_pct"] == 35
    assert result["reserve_pct"] == 20


@patch("app.services.lending_service.get_pool_stats", side_effect=Exception("no lending"))
def test_allocation_split_always_sums_to_100(_):
    for profile in ("conservative", "balanced", "aggressive"):
        for sig_set in (
            None,
            {"p1": _make_signal(5, 5)},
            {"p1": _make_signal(2, 5, slippage_ok=False, il_acceptable=False)},
        ):
            result = compute_allocation_split(100 * WEI, profile, signals=sig_set)
            total = result["ekubo_pct"] + result["lending_pct"] + result["reserve_pct"]
            assert total == 100, f"Expected 100, got {total} for profile={profile}, signals={sig_set}"
