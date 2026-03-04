import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.signal_report import (
    SignalReport,
    parse_il_output,
    parse_yield_output,
    parse_slippage_output,
    parse_liquidation_output,
    parse_correlation_output,
    build_report,
)


def _ok_result(compliant: bool) -> dict:
    return {
        "circuit": "test",
        "success": True,
        "is_compliant": compliant,
        "public_signals": ["1" if compliant else "0"],
        "proof_hash": "0xabc",
        "proof": {},
    }


def _fail_result() -> dict:
    return {"circuit": "test", "success": False, "error": "witness failed"}


def test_signal_report_has_strict_typed_fields():
    r = SignalReport(pool_id="ekubo-eth-usdc")
    assert r.pool_id == "ekubo-eth-usdc"
    assert r.il_acceptable is None
    assert r.yield_near_optimal is None
    assert r.slippage_ok is None
    assert r.liquidation_healthy is None
    assert r.correlation_valid is None
    assert r.gates_passed == 0
    assert r.gates_total == 0
    assert r.raw_outputs is None


def test_signal_report_rejects_int_for_bool_field():
    r = SignalReport(pool_id="p", il_acceptable=1)
    assert r.il_acceptable is True
    assert isinstance(r.il_acceptable, bool)

    r2 = SignalReport(pool_id="p", il_acceptable=0)
    assert r2.il_acceptable is False
    assert isinstance(r2.il_acceptable, bool)


def test_parse_il_output_maps_bool_correctly():
    assert parse_il_output(_ok_result(True)) is True
    assert parse_il_output(_ok_result(False)) is False
    assert parse_il_output(None) is None
    assert parse_il_output({}) is None
    assert parse_il_output(_fail_result()) is None


def test_parse_yield_output_maps_bool_correctly():
    assert parse_yield_output(_ok_result(True)) is True
    assert parse_yield_output(_ok_result(False)) is False
    assert parse_yield_output(None) is None
    assert parse_yield_output({}) is None
    assert parse_yield_output(_fail_result()) is None


def test_parse_slippage_output_maps_bool_correctly():
    assert parse_slippage_output(_ok_result(True)) is True
    assert parse_slippage_output(_ok_result(False)) is False
    assert parse_slippage_output(None) is None
    assert parse_slippage_output({}) is None
    assert parse_slippage_output(_fail_result()) is None


def test_parse_liquidation_output():
    assert parse_liquidation_output(_ok_result(True)) is True
    assert parse_liquidation_output(_ok_result(False)) is False
    assert parse_liquidation_output(None) is None
    assert parse_liquidation_output({}) is None
    assert parse_liquidation_output(_fail_result()) is None


def test_parse_correlation_output():
    assert parse_correlation_output(_ok_result(True)) is True
    assert parse_correlation_output(_ok_result(False)) is False
    assert parse_correlation_output(None) is None
    assert parse_correlation_output({}) is None
    assert parse_correlation_output(_fail_result()) is None


def test_build_report_counts_gates_correctly():
    raw = {
        "ImpermanentLossPredictor": _ok_result(True),
        "YieldOptimality": _ok_result(True),
        "SlippageBound": _ok_result(False),
        "LiquidationRisk": _ok_result(True),
        "CorrelationRisk": None,
    }
    report = build_report("pool-abc", raw)
    assert report.il_acceptable is True
    assert report.yield_near_optimal is True
    assert report.slippage_ok is False
    assert report.liquidation_healthy is True
    assert report.correlation_valid is None
    assert report.gates_passed == 3
    assert report.gates_total == 4


def test_build_report_all_none_gives_zero_gates():
    raw = {
        "ImpermanentLossPredictor": None,
        "YieldOptimality": None,
        "SlippageBound": None,
        "LiquidationRisk": None,
        "CorrelationRisk": None,
    }
    report = build_report("pool-xyz", raw)
    assert report.gates_passed == 0
    assert report.gates_total == 0


def test_build_report_includes_raw_when_flagged():
    raw = {
        "ImpermanentLossPredictor": _ok_result(True),
        "YieldOptimality": _ok_result(False),
    }
    report_no_raw = build_report("pool-1", raw, include_raw=False)
    assert report_no_raw.raw_outputs is None

    report_with_raw = build_report("pool-1", raw, include_raw=True)
    assert report_with_raw.raw_outputs is not None
    assert "ImpermanentLossPredictor" in report_with_raw.raw_outputs
