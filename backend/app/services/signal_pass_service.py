from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.services.signal_report import SignalReport, build_report

logger = logging.getLogger(__name__)

_CIRCUIT_TIMEOUT_S = 30
_MAX_CONCURRENT = 4
_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(_MAX_CONCURRENT)
    return _semaphore


async def _run_circuit_with_timeout(
    circuit_name: str,
    inputs: dict[str, Any],
    timeout_s: float = _CIRCUIT_TIMEOUT_S,
) -> dict[str, Any] | None:
    sem = _get_semaphore()
    async with sem:
        try:
            from app.services.zkml.circuit_scanner import _generate_proof

            result = await asyncio.wait_for(
                _generate_proof(circuit_name, inputs),
                timeout=timeout_s,
            )
            if not result or not result.get("success", False):
                logger.warning("Circuit %s failed: %s", circuit_name, result.get("error") if result else "empty")
                return None
            return result
        except asyncio.TimeoutError:
            logger.warning("Circuit %s timed out after %ss", circuit_name, timeout_s)
            return None
        except Exception as e:
            logger.warning("Circuit %s error: %s", circuit_name, e)
            return None


async def _get_spot_price(token0: str, token1: str) -> float | None:
    try:
        from app.services.ekubo.oracle_adapter import get_spot_price

        return await get_spot_price(token0, token1)
    except Exception as e:
        logger.debug("Spot price unavailable for %s/%s: %s", token0[:10], token1[:10], e)
        return None


def _build_il_inputs(pool: dict, amount_wei: int, token_decimals: int, spot_price: float) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_il_predictor_inputs

    amount_human = amount_wei / (10**token_decimals)
    price_scaled = int(spot_price * 10000)
    return build_il_predictor_inputs(
        position_size=int(amount_human),
        entry_price=price_scaled,
        current_price=price_scaled,
        fee_earned_bps=max(1, int(pool.get("apy_pct", 5) * 100 / 365)),
        max_il_tolerance_bps=500,
    )


def _build_yield_inputs(all_pools: list[dict]) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_yield_optimality_inputs

    total_tvl = sum(p.get("tvl_usd", 0) for p in all_pools) or 1
    allocations = []
    predicted_yields = []
    for p in (all_pools + [{}] * 8)[:8]:
        tvl = p.get("tvl_usd", 0)
        allocations.append(max(1, int(tvl / total_tvl * 100)))
        predicted_yields.append(int(p.get("apy_pct", 0) * 100))
    return build_yield_optimality_inputs(
        allocations=allocations,
        predicted_yields=predicted_yields,
    )


def _build_slippage_inputs(pool: dict, amount_wei: int, token_decimals: int) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_slippage_bound_inputs

    amount_human = amount_wei / (10**token_decimals)
    liquidity = int(pool.get("liquidity_usd", 1_000_000))
    return build_slippage_bound_inputs(
        trade_amount=int(amount_human),
        current_liquidity=max(liquidity, 1),
        max_slippage_bps=50,
    )


def _store_receipt(circuit_name: str, pool_id: str, proof_hash: str | None, result_bool: bool | None) -> None:
    try:
        from app.services.receipt_service import store_receipt

        store_receipt(
            category="signal_pass",
            fact_type=circuit_name,
            fact_hash=proof_hash or "none",
            metadata={"pool_id": pool_id, "result": result_bool, "timestamp": time.time()},
        )
    except Exception:
        pass


async def _safe_run_circuit(circuit_name: str, inputs: dict[str, Any]) -> dict[str, Any] | None:
    try:
        return await _run_circuit_with_timeout(circuit_name, inputs)
    except Exception as e:
        logger.warning("Circuit %s raised: %s", circuit_name, e)
        return None


async def compute_signals(
    candidate_pools: list[dict],
    amount_wei: int,
    token_decimals: int = 18,
) -> dict[str, SignalReport]:
    if not candidate_pools:
        return {}

    yield_inputs = _build_yield_inputs(candidate_pools)
    yield_result = await _safe_run_circuit("YieldOptimality", yield_inputs)

    flat_coros: list[Any] = []
    coro_map: list[tuple[str, str]] = []

    for pool in candidate_pools:
        pid = pool.get("pool_id", pool.get("pair", "unknown"))

        spot = await _get_spot_price(pool.get("token0", ""), pool.get("token1", ""))
        if spot is not None:
            il_inputs = _build_il_inputs(pool, amount_wei, token_decimals, spot)
            flat_coros.append(_safe_run_circuit("ImpermanentLossPredictor", il_inputs))
            coro_map.append((pid, "ImpermanentLossPredictor"))

        slip_inputs = _build_slippage_inputs(pool, amount_wei, token_decimals)
        flat_coros.append(_safe_run_circuit("SlippageBound", slip_inputs))
        coro_map.append((pid, "SlippageBound"))

    raw_results = await asyncio.gather(*flat_coros, return_exceptions=True)

    pool_circuits: dict[str, dict[str, Any]] = {}
    for i, (pid, circuit_key) in enumerate(coro_map):
        raw = raw_results[i]
        if isinstance(raw, BaseException):
            raw = None
        if pid not in pool_circuits:
            pool_circuits[pid] = {}
        pool_circuits[pid][circuit_key] = raw

    reports: dict[str, SignalReport] = {}
    for pool in candidate_pools:
        pid = pool.get("pool_id", pool.get("pair", "unknown"))
        circuits = pool_circuits.get(pid, {})
        circuits["YieldOptimality"] = yield_result
        report = build_report(pool_id=pid, raw_circuit_outputs=circuits)
        reports[pid] = report

        for cname, raw in circuits.items():
            proof_hash = raw.get("proof_hash") if isinstance(raw, dict) else None
            field = {"ImpermanentLossPredictor": "il_acceptable", "YieldOptimality": "yield_near_optimal",
                     "SlippageBound": "slippage_ok"}.get(cname)
            _store_receipt(cname, pid, proof_hash, getattr(report, field) if field else None)

    logger.info(
        "Signal pass: %d pools, %d total gate evaluations",
        len(reports),
        sum(r.gates_total for r in reports.values()),
    )
    return reports
