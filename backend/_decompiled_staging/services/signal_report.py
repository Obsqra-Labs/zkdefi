from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class SignalReport(BaseModel):
    pool_id: str
    il_acceptable: Optional[bool] = None
    yield_near_optimal: Optional[bool] = None
    slippage_ok: Optional[bool] = None
    liquidation_healthy: Optional[bool] = None
    correlation_valid: Optional[bool] = None
    gates_passed: int = 0
    gates_total: int = 0
    raw_outputs: dict[str, Any] | None = None


def _parse_circuit_output(result: dict | None) -> bool | None:
    if not result or not isinstance(result, dict):
        return None
    if not result.get("success"):
        return None
    return bool(result["is_compliant"])


def parse_il_output(result: dict | None) -> bool | None:
    return _parse_circuit_output(result)


def parse_yield_output(result: dict | None) -> bool | None:
    return _parse_circuit_output(result)


def parse_slippage_output(result: dict | None) -> bool | None:
    return _parse_circuit_output(result)


def parse_liquidation_output(result: dict | None) -> bool | None:
    return _parse_circuit_output(result)


def parse_correlation_output(result: dict | None) -> bool | None:
    return _parse_circuit_output(result)


_FIELD_MAP: list[tuple[str, str, Any]] = [
    ("ImpermanentLossPredictor", "il_acceptable", parse_il_output),
    ("YieldOptimality", "yield_near_optimal", parse_yield_output),
    ("SlippageBound", "slippage_ok", parse_slippage_output),
    ("LiquidationRisk", "liquidation_healthy", parse_liquidation_output),
    ("CorrelationRisk", "correlation_valid", parse_correlation_output),
]


def build_report(
    pool_id: str,
    raw_circuit_outputs: dict[str, Any],
    include_raw: bool = False,
) -> SignalReport:
    fields: dict[str, Any] = {"pool_id": pool_id}
    passed = 0
    total = 0

    for circuit_key, field_name, parser in _FIELD_MAP:
        val = parser(raw_circuit_outputs.get(circuit_key))
        fields[field_name] = val
        if val is not None:
            total += 1
            if val:
                passed += 1

    fields["gates_passed"] = passed
    fields["gates_total"] = total

    if include_raw:
        fields["raw_outputs"] = raw_circuit_outputs

    return SignalReport(**fields)
