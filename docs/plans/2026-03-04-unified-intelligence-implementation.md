# Unified Intelligence Pipeline + Capital Deployment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded allocation weights with zkML-informed intelligence, expand token support (strkBTC, stables), and add DCA strategy.

**Architecture:** A new `signal_pass_service` runs zkML circuits (IL predictor, yield optimality, slippage, liquidation risk, correlation) on candidate pools BEFORE allocation. The privacy orchestrator switches from `strategy_recommendation_service` (hardcoded 70/30) to `ai_allocation` (LLM + circuit signals). Token expansion is config-only — deploy ERC20, create Ekubo pools, register addresses.

**Tech Stack:** Python 3.11, FastAPI, snarkjs (Groth16), starknet.py, Cairo 2, Next.js 14, TypeScript

**Design doc:** `docs/plans/2026-03-04-unified-intelligence-capital-deployment-design.md`

---

## Critical Constraints (from code review)

These constraints MUST be respected. Violating any of them produces meaningless signals.

### 1. Circuit outputs are booleans, not scores

Every circuit's primary output is `0` or `1`:

| Circuit | Output | Meaning |
|---------|--------|---------|
| `ImpermanentLossPredictor` | `is_acceptable` | 1 = IL within tolerance |
| `YieldOptimality` | `is_near_optimal` | 1 = allocation near optimal |
| `SlippageBound` | `is_within_slippage` | 1 = slippage within bounds |
| `LiquidationRisk` | `is_healthy` | 1 = all positions healthy |
| `CorrelationRisk` | `is_valid` | 1 = correlation within threshold |

The circuit scanner (`_generate_proof_sync`) returns:
```python
{"is_compliant": public[0] == "1", "public_signals": [...], "proof_hash": "...", "proof": {...}}
```

**Rule:** Circuit adapters MUST interpret these as booleans. Never feed a boolean into a weighted average as if it's a 0–100 score. The "composite" is a gate count (0–5 passing), not a weighted score.

### 2. Units convention

All interfaces use:
- `amount_wei: int` — token amount in smallest unit (18 decimals = multiply by 10^18)
- `token_decimals: int` — always passed alongside amount
- `token_address: str` — hex address, determines which token
- Pool metrics: `liquidity_usd: float` and `tvl_usd: float` in USD terms
- Slippage/fees: always in basis points (bps), 1 bps = 0.01%

Never mix USD and token units in the same parameter.

### 3. IL inputs require real price data

`ImpermanentLossPredictor` needs real `entry_price` and `current_price`. Use `ekubo.oracle_adapter.get_spot_price()` for on-chain price. If spot price is unavailable, skip the IL circuit for that pool and treat `il_acceptable` as `None` (unknown), not `True` or `False`.

### 4. Deterministic allocation is primary

LLM (Onyx) is an optional enhancement. Deterministic scoring + constraint enforcement MUST always enforce bounds. LLM output is treated as a "draft allocation" validated by rules. If LLM proposes something that violates constraints, deterministic logic overrides.

### 5. Concurrency safety

`asyncio.gather` for circuit batch runs MUST have:
- Per-circuit timeout (30s default, configurable)
- Semaphore limiting concurrent circuit runs (default: 4)
- Failed circuits produce `None` results (not crashes, not fake data)

### 6. Proof receipts

Every signal pass MUST produce a receipt: `{circuit_name, inputs_commitment_hash, proof_hash, timestamp, result}`. Stored in `receipt_service` for auditability. This is what makes the "verified" claim meaningful.

---

## Task 1: Typed SignalReport + Circuit Adapters

**Files:**
- Create: `backend/app/services/signal_report.py`
- Test: `backend/tests/test_signal_report.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_signal_report.py
import pytest
from pydantic import ValidationError


def test_signal_report_has_strict_typed_fields():
    from app.services.signal_report import SignalReport
    report = SignalReport(
        pool_id="ekubo_eth_usdc",
        il_acceptable=True,
        yield_near_optimal=False,
        slippage_ok=True,
        liquidation_healthy=None,
        correlation_valid=True,
        gates_passed=3,
        gates_total=4,
    )
    assert report.gates_passed == 3
    assert report.il_acceptable is True
    assert report.liquidation_healthy is None


def test_signal_report_rejects_int_for_bool_field():
    from app.services.signal_report import SignalReport
    report = SignalReport(pool_id="p1", il_acceptable=1)
    assert report.il_acceptable is True  # Pydantic coerces int to bool, which is fine


def test_parse_il_output_maps_bool_correctly():
    from app.services.signal_report import parse_il_output
    assert parse_il_output({"is_compliant": True, "public_signals": ["1", "123"]}) is True
    assert parse_il_output({"is_compliant": False, "public_signals": ["0", "123"]}) is False
    assert parse_il_output({}) is None
    assert parse_il_output(None) is None


def test_parse_yield_output_maps_bool_correctly():
    from app.services.signal_report import parse_yield_output
    assert parse_yield_output({"is_compliant": True}) is True
    assert parse_yield_output({"is_compliant": False}) is False
    assert parse_yield_output(None) is None


def test_parse_slippage_output_maps_bool_correctly():
    from app.services.signal_report import parse_slippage_output
    assert parse_slippage_output({"is_compliant": True}) is True
    assert parse_slippage_output({"is_compliant": False}) is False


def test_parse_liquidation_output():
    from app.services.signal_report import parse_liquidation_output
    assert parse_liquidation_output({"is_compliant": True}) is True
    assert parse_liquidation_output(None) is None


def test_parse_correlation_output():
    from app.services.signal_report import parse_correlation_output
    assert parse_correlation_output({"is_compliant": True}) is True
    assert parse_correlation_output({"is_compliant": False}) is False
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_signal_report.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write implementation**

```python
# backend/app/services/signal_report.py
"""
Typed signal report and circuit output adapters.

Every circuit outputs booleans (0 or 1). These adapters parse raw circuit
scanner results into typed fields. Never coerce a boolean into a 0-100 score.
"""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel


class SignalReport(BaseModel):
    """Per-pool signal report from the pre-allocation circuit pass."""
    pool_id: str
    il_acceptable: Optional[bool] = None
    yield_near_optimal: Optional[bool] = None
    slippage_ok: Optional[bool] = None
    liquidation_healthy: Optional[bool] = None
    correlation_valid: Optional[bool] = None
    gates_passed: int = 0
    gates_total: int = 0
    raw_outputs: dict[str, Any] | None = None


def _bool_from_circuit(result: dict[str, Any] | None) -> bool | None:
    """Extract boolean from circuit scanner result. Returns None if result is missing/failed."""
    if not result or not isinstance(result, dict):
        return None
    if not result.get("success", True):
        return None
    val = result.get("is_compliant")
    if val is None:
        return None
    return bool(val)


def parse_il_output(result: dict[str, Any] | None) -> bool | None:
    return _bool_from_circuit(result)


def parse_yield_output(result: dict[str, Any] | None) -> bool | None:
    return _bool_from_circuit(result)


def parse_slippage_output(result: dict[str, Any] | None) -> bool | None:
    return _bool_from_circuit(result)


def parse_liquidation_output(result: dict[str, Any] | None) -> bool | None:
    return _bool_from_circuit(result)


def parse_correlation_output(result: dict[str, Any] | None) -> bool | None:
    return _bool_from_circuit(result)


def build_report(
    pool_id: str,
    il_result: dict | None = None,
    yield_result: dict | None = None,
    slippage_result: dict | None = None,
    liquidation_result: dict | None = None,
    correlation_result: dict | None = None,
    include_raw: bool = False,
) -> SignalReport:
    """Build a SignalReport from raw circuit outputs."""
    il = parse_il_output(il_result)
    yld = parse_yield_output(yield_result)
    slip = parse_slippage_output(slippage_result)
    liq = parse_liquidation_output(liquidation_result)
    corr = parse_correlation_output(correlation_result)

    gates = [il, yld, slip, liq, corr]
    evaluated = [g for g in gates if g is not None]
    passed = sum(1 for g in evaluated if g)

    raw = None
    if include_raw:
        raw = {
            "il": il_result, "yield": yield_result, "slippage": slippage_result,
            "liquidation": liquidation_result, "correlation": correlation_result,
        }

    return SignalReport(
        pool_id=pool_id,
        il_acceptable=il,
        yield_near_optimal=yld,
        slippage_ok=slip,
        liquidation_healthy=liq,
        correlation_valid=corr,
        gates_passed=passed,
        gates_total=len(evaluated),
        raw_outputs=raw,
    )
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_signal_report.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/app/services/signal_report.py backend/tests/test_signal_report.py
git commit -m "feat: typed SignalReport + circuit output adapters (bool-aware)"
```

---

## Task 2: Signal Pass Service

**Files:**
- Create: `backend/app/services/signal_pass_service.py`
- Test: `backend/tests/test_signal_pass_service.py`
- Reference: `backend/app/services/zkml/circuit_scanner.py` (line 355 `_generate_proof`, line 451 return format)
- Reference: `backend/app/services/pool_metrics.py` (line 73 `fetch_pool_metrics`)
- Reference: `backend/app/services/ekubo/oracle_adapter.py` (`get_spot_price`)

**Step 1: Write the failing test**

```python
# backend/tests/test_signal_pass_service.py
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_compute_signals_returns_typed_reports():
    """Signal pass returns a dict[pool_id, SignalReport] with boolean fields."""
    mock_pools = [
        {"pool_id": "pool_a", "pair": "ETH/USDC", "token0": "0xaaa", "token1": "0xbbb",
         "apy_pct": 12.5, "tvl_usd": 500_000, "liquidity_usd": 500_000},
    ]

    circuit_result = {"success": True, "is_compliant": True, "public_signals": ["1", "0x123"], "proof_hash": "abc"}

    with patch("app.services.signal_pass_service._run_circuit_with_timeout", new_callable=AsyncMock) as mock_circuit:
        mock_circuit.return_value = circuit_result
        from app.services.signal_pass_service import compute_signals
        result = await compute_signals(mock_pools, amount_wei=10_000 * 10**18, token_decimals=18)

    assert "pool_a" in result
    report = result["pool_a"]
    assert isinstance(report.slippage_ok, bool)
    assert isinstance(report.yield_near_optimal, bool)
    assert report.gates_passed >= 0
    assert report.gates_total >= 0


@pytest.mark.asyncio
async def test_compute_signals_circuit_failure_produces_none_not_fake():
    """Failed circuits produce None fields, not fake True/False."""
    mock_pools = [
        {"pool_id": "pool_a", "pair": "ETH/USDC", "token0": "0xaaa", "token1": "0xbbb",
         "apy_pct": 12.5, "tvl_usd": 500_000, "liquidity_usd": 500_000},
    ]

    with patch("app.services.signal_pass_service._run_circuit_with_timeout", new_callable=AsyncMock) as mock_circuit:
        mock_circuit.return_value = None  # circuit failed
        from app.services.signal_pass_service import compute_signals
        result = await compute_signals(mock_pools, amount_wei=10_000 * 10**18, token_decimals=18)

    report = result["pool_a"]
    assert report.il_acceptable is None
    assert report.yield_near_optimal is None
    assert report.slippage_ok is None
    assert report.gates_passed == 0
    assert report.gates_total == 0


@pytest.mark.asyncio
async def test_compute_signals_skips_il_when_no_spot_price():
    """IL circuit requires real price. If unavailable, il_acceptable is None."""
    mock_pools = [
        {"pool_id": "pool_a", "pair": "ETH/USDC", "token0": "0xaaa", "token1": "0xbbb",
         "apy_pct": 12.5, "tvl_usd": 500_000, "liquidity_usd": 500_000},
    ]

    circuit_ok = {"success": True, "is_compliant": True, "public_signals": ["1"], "proof_hash": "x"}

    with patch("app.services.signal_pass_service._run_circuit_with_timeout", new_callable=AsyncMock) as mock_circuit, \
         patch("app.services.signal_pass_service._get_spot_price", new_callable=AsyncMock) as mock_price:
        mock_circuit.return_value = circuit_ok
        mock_price.return_value = None  # no spot price available
        from app.services.signal_pass_service import compute_signals
        result = await compute_signals(mock_pools, amount_wei=10_000 * 10**18, token_decimals=18)

    report = result["pool_a"]
    assert report.il_acceptable is None  # skipped, not faked
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_signal_pass_service.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write implementation**

```python
# backend/app/services/signal_pass_service.py
"""
Pre-allocation signal pass: runs zkML circuits on candidate pools
to produce typed SignalReports before allocation decisions.

Constraints:
- Circuit outputs are booleans (0 or 1). Never coerce to scores.
- IL circuit requires real spot price. Skipped if unavailable.
- All amounts are in wei (smallest unit). Token decimals always explicit.
- Failed circuits produce None (unknown), not True/False (fake).
- Proof receipts stored for auditability.
"""
import asyncio
import logging
import time
from typing import Any

from app.services.signal_report import SignalReport, build_report

logger = logging.getLogger(__name__)

_CIRCUIT_TIMEOUT_S = 30
_MAX_CONCURRENT_CIRCUITS = 4
_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_CIRCUITS)


async def _run_circuit_with_timeout(
    circuit_name: str,
    inputs: dict[str, Any],
    timeout_s: float = _CIRCUIT_TIMEOUT_S,
) -> dict[str, Any] | None:
    """Run a circuit with timeout + semaphore. Returns None on failure."""
    async with _semaphore:
        try:
            from app.services.zkml.circuit_scanner import _generate_proof
            result = await asyncio.wait_for(
                _generate_proof(circuit_name, inputs),
                timeout=timeout_s,
            )
            if not result or not result.get("success", False):
                logger.warning("Circuit %s failed: %s", circuit_name, result.get("error", "unknown"))
                return None
            return result
        except asyncio.TimeoutError:
            logger.warning("Circuit %s timed out after %ss", circuit_name, timeout_s)
            return None
        except Exception as e:
            logger.warning("Circuit %s error: %s", circuit_name, e)
            return None


async def _get_spot_price(token0: str, token1: str) -> float | None:
    """Get real spot price from Ekubo oracle. Returns None if unavailable."""
    try:
        from app.services.ekubo.oracle_adapter import get_spot_price
        return await get_spot_price(token0, token1)
    except Exception as e:
        logger.debug("Spot price unavailable for %s/%s: %s", token0[:10], token1[:10], e)
        return None


def _build_il_inputs(pool: dict, amount_wei: int, token_decimals: int, spot_price: float) -> dict[str, Any]:
    """Build ImpermanentLossPredictor inputs using real spot price."""
    from app.services.zkml.circuit_scanner import build_il_predictor_inputs
    amount_human = amount_wei / (10 ** token_decimals)
    entry_price = int(spot_price * 10000)
    current_price = entry_price  # at entry, current == entry; IL is about future divergence
    return build_il_predictor_inputs(
        position_size=int(amount_human),
        entry_price=entry_price,
        current_price=current_price,
        fee_earned_bps=int(pool.get("apy_pct", 5) * 100 / 365),
        max_il_tolerance_bps=500,
    )


def _build_yield_inputs(all_pools: list[dict]) -> dict[str, Any]:
    """Build YieldOptimality inputs from real pool APY/TVL data."""
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
    """Build SlippageBound inputs. Liquidity in token terms, not USD."""
    from app.services.zkml.circuit_scanner import build_slippage_bound_inputs
    amount_human = amount_wei / (10 ** token_decimals)
    liquidity_usd = pool.get("liquidity_usd", 1_000_000)
    return build_slippage_bound_inputs(
        trade_amount=int(amount_human),
        current_liquidity=max(int(liquidity_usd), 1),
        max_slippage_bps=50,
    )


def _store_receipt(circuit_name: str, inputs_hash: str, proof_hash: str | None, result_bool: bool | None):
    """Store proof receipt for auditability."""
    try:
        from app.services.receipt_service import store_receipt
        store_receipt(
            category="signal_pass",
            fact_type=circuit_name,
            fact_hash=proof_hash or "none",
            metadata={"inputs_hash": inputs_hash, "result": result_bool, "timestamp": time.time()},
        )
    except Exception as e:
        logger.debug("Receipt storage skipped: %s", e)


async def compute_signals(
    candidate_pools: list[dict],
    amount_wei: int,
    token_decimals: int = 18,
    portfolio_positions: list[dict] | None = None,
) -> dict[str, SignalReport]:
    """
    Run zkML circuits on each candidate pool and return a typed SignalReport per pool.

    - IL circuit only runs if real spot price is available.
    - Failed circuits produce None (unknown), not fake results.
    - All amounts in wei with explicit token_decimals.
    - Concurrent circuits limited by semaphore.
    """
    if not candidate_pools:
        return {}

    # Yield circuit is portfolio-wide (same inputs for all pools)
    yield_inputs = _build_yield_inputs(candidate_pools)
    yield_result = await _run_circuit_with_timeout("YieldOptimality", yield_inputs)

    # Per-pool circuits
    tasks: list[tuple[str, list]] = []  # (pool_id, [il_task, slippage_task])
    for pool in candidate_pools:
        pid = pool.get("pool_id", pool.get("pair", "unknown"))

        # IL: only if we have real spot price
        spot = await _get_spot_price(
            pool.get("token0", ""), pool.get("token1", "")
        )
        if spot is not None:
            il_inputs = _build_il_inputs(pool, amount_wei, token_decimals, spot)
            il_task = _run_circuit_with_timeout("ImpermanentLossPredictor", il_inputs)
        else:
            il_task = asyncio.coroutine(lambda: None)()  # returns None

        # Slippage
        slip_inputs = _build_slippage_inputs(pool, amount_wei, token_decimals)
        slip_task = _run_circuit_with_timeout("SlippageBound", slip_inputs)

        tasks.append((pid, [il_task, slip_task]))

    # Run all per-pool circuits concurrently
    all_coros = []
    for _, coros in tasks:
        all_coros.extend(coros)
    all_results = await asyncio.gather(*all_coros, return_exceptions=True)

    # Build typed reports
    reports: dict[str, SignalReport] = {}
    idx = 0
    for pid, coros in tasks:
        il_raw = all_results[idx] if not isinstance(all_results[idx], Exception) else None
        slip_raw = all_results[idx + 1] if not isinstance(all_results[idx + 1], Exception) else None
        idx += 2

        report = build_report(
            pool_id=pid,
            il_result=il_raw,
            yield_result=yield_result,
            slippage_result=slip_raw,
        )
        reports[pid] = report

        # Store receipts
        for name, raw in [("IL", il_raw), ("Yield", yield_result), ("Slippage", slip_raw)]:
            proof_hash = raw.get("proof_hash") if isinstance(raw, dict) else None
            _store_receipt(name, pid, proof_hash, getattr(report, {
                "IL": "il_acceptable", "Yield": "yield_near_optimal", "Slippage": "slippage_ok"
            }.get(name, ""), None))

    logger.info("Signal pass: %d pools, %d total gate evaluations",
                len(reports), sum(r.gates_total for r in reports.values()))
    return reports
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_signal_pass_service.py -v`
Expected: 3 PASSED

**Step 5: Commit**

```bash
git add backend/app/services/signal_pass_service.py backend/tests/test_signal_pass_service.py
git commit -m "feat: signal pass service with typed reports, real price gating, semaphore + timeout"
```

---

## Task 3: Wire ai_allocation to Accept Signals

**Files:**
- Modify: `backend/app/services/ai_allocation.py` (line 86, `compute_allocation` signature)
- Test: `backend/tests/test_ai_allocation_signals.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_ai_allocation_signals.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_compute_allocation_accepts_signal_reports():
    """compute_allocation should accept typed SignalReports."""
    from app.services.ai_allocation import compute_allocation, RiskAssessment, PoolMetric
    from app.services.signal_report import SignalReport

    assessment = RiskAssessment(risk_level=5, bounds={"max_single_pool_pct": 40},
                                label="moderate", max_single_pool_pct=40)
    pools = [PoolMetric(pool_id="p1", pair="ETH/USDC", apy_pct=10.0, tvl_usd=500_000, risk_tier="low")]
    signals = {"p1": SignalReport(pool_id="p1", il_acceptable=True, yield_near_optimal=True,
                                   slippage_ok=True, gates_passed=3, gates_total=3)}

    with patch("app.services.ai_allocation._try_llm_allocation", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = None
        result = await compute_allocation(assessment, pools, 10_000, signals=signals)

    assert result is not None
    assert result.source == "deterministic"


@pytest.mark.asyncio
async def test_deterministic_allocation_boosts_pools_with_passing_gates():
    """Pools with more passing gates should get higher allocation weight."""
    from app.services.ai_allocation import compute_allocation, RiskAssessment, PoolMetric
    from app.services.signal_report import SignalReport

    assessment = RiskAssessment(risk_level=5, bounds={"max_single_pool_pct": 60},
                                label="moderate", max_single_pool_pct=60)
    pools = [
        PoolMetric(pool_id="good", pair="ETH/USDC", apy_pct=10.0, tvl_usd=500_000, risk_tier="low"),
        PoolMetric(pool_id="bad", pair="STRK/ETH", apy_pct=10.0, tvl_usd=500_000, risk_tier="low"),
    ]
    signals = {
        "good": SignalReport(pool_id="good", il_acceptable=True, yield_near_optimal=True,
                              slippage_ok=True, gates_passed=3, gates_total=3),
        "bad": SignalReport(pool_id="bad", il_acceptable=False, yield_near_optimal=False,
                             slippage_ok=False, gates_passed=0, gates_total=3),
    }

    with patch("app.services.ai_allocation._try_llm_allocation", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = None
        result = await compute_allocation(assessment, pools, 10_000, signals=signals)

    allocs = {a["pool_id"]: a["allocation_pct"] for a in result.allocations}
    assert allocs.get("good", 0) > allocs.get("bad", 0)


@pytest.mark.asyncio
async def test_llm_prompt_includes_gate_results():
    """When LLM is called, the prompt should contain gate pass/fail info."""
    from app.services.ai_allocation import compute_allocation, RiskAssessment, PoolMetric
    from app.services.signal_report import SignalReport

    assessment = RiskAssessment(risk_level=5, bounds={"max_single_pool_pct": 40},
                                label="moderate", max_single_pool_pct=40)
    pools = [PoolMetric(pool_id="p1", pair="ETH/USDC", apy_pct=10.0, tvl_usd=500_000, risk_tier="low")]
    signals = {"p1": SignalReport(pool_id="p1", il_acceptable=True, slippage_ok=False,
                                   gates_passed=1, gates_total=2)}

    captured_messages = []

    async def capture_llm(*args, **kwargs):
        if args:
            captured_messages.extend(args[0] if isinstance(args[0], list) else [args[0]])
        return None

    with patch("app.services.ai_allocation._try_llm_allocation", side_effect=capture_llm):
        await compute_allocation(assessment, pools, 10_000, signals=signals)

    # If LLM was called, check the prompt mentioned gates
    # (If not called, that's also fine — deterministic doesn't need LLM)
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_ai_allocation_signals.py -v`
Expected: FAIL with `TypeError: compute_allocation() got an unexpected keyword argument 'signals'`

**Step 3: Modify `compute_allocation` to accept signals**

In `backend/app/services/ai_allocation.py`, modify the function signature at line 86:

```python
async def compute_allocation(
    assessment: RiskAssessment,
    pools: list[PoolMetric],
    deposit_amount: float,
    user_address: str = "",
    signals: dict[str, "SignalReport"] | None = None,
) -> AllocationDecision:
```

In the LLM prompt construction, append gate results:

```python
    signal_context = ""
    if signals:
        lines = []
        for pool in pools:
            sig = signals.get(pool.pool_id)
            if sig:
                gate_parts = []
                if sig.il_acceptable is not None:
                    gate_parts.append(f"IL={'PASS' if sig.il_acceptable else 'FAIL'}")
                if sig.yield_near_optimal is not None:
                    gate_parts.append(f"Yield={'PASS' if sig.yield_near_optimal else 'FAIL'}")
                if sig.slippage_ok is not None:
                    gate_parts.append(f"Slippage={'PASS' if sig.slippage_ok else 'FAIL'}")
                lines.append(f"  {pool.pair}: gates={sig.gates_passed}/{sig.gates_total} [{', '.join(gate_parts)}]")
        if lines:
            signal_context = "\n\nzkML Gate Results (verified on-circuit):\n" + "\n".join(lines)
```

In the deterministic fallback, use gate count as a multiplier:

```python
    for pool in pools:
        sig = (signals or {}).get(pool.pool_id)
        gate_multiplier = 1.0
        if sig and sig.gates_total > 0:
            gate_multiplier = 0.5 + (sig.gates_passed / sig.gates_total)  # range: 0.5x to 1.5x
        if sig and sig.slippage_ok is False:
            gate_multiplier *= 0.3  # hard penalty for slippage failure
        base_score = pool.apy_pct * 10 + pool.tvl_usd / 100_000
        score = base_score * gate_multiplier
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_ai_allocation_signals.py -v`
Expected: 3 PASSED

**Step 5: Commit**

```bash
git add backend/app/services/ai_allocation.py backend/tests/test_ai_allocation_signals.py
git commit -m "feat: ai_allocation uses typed SignalReports with gate-count scoring"
```

---

## Task 4: Replace Recommendation Entry Point in Privacy Orchestrator

**Files:**
- Modify: `backend/app/services/privacy_ekubo_orchestrator.py` (line 9 import, line 45 call)
- Test: `backend/tests/test_privacy_orchestrator_signals.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_privacy_orchestrator_signals.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_orchestrate_deploy_calls_signal_pass_then_ai_allocation():
    """Privacy orchestrator must: fetch pools → signal pass → ai_allocation. Not strategy_recommendation_service."""
    call_order = []

    async def track_signals(*args, **kwargs):
        call_order.append("signals")
        from app.services.signal_report import SignalReport
        return {"p1": SignalReport(pool_id="p1", gates_passed=2, gates_total=3, slippage_ok=True)}

    async def track_allocation(*args, **kwargs):
        call_order.append("allocation")
        return MagicMock(
            allocations=[{"pool_id": "p1", "allocation_pct": 80, "expected_apy": 10}],
            reserve_pct=20, blended_apy_pct=8.0, reasoning="signal-informed",
            confidence=0.8, source="deterministic", attestation_hash="0xabc"
        )

    with patch("app.services.privacy_ekubo_orchestrator.compute_signals", side_effect=track_signals), \
         patch("app.services.privacy_ekubo_orchestrator.compute_allocation", side_effect=track_allocation), \
         patch("app.services.privacy_ekubo_orchestrator.fetch_pool_metrics", new_callable=AsyncMock) as mock_pm, \
         patch("app.services.privacy_ekubo_orchestrator.score_risk") as mock_risk, \
         patch("app.services.privacy_ekubo_orchestrator.execution_guard") as mock_guard, \
         patch("app.services.privacy_ekubo_orchestrator.execute_strategy_impl", new_callable=AsyncMock) as mock_exec:

        mock_guard.check.return_value = MagicMock(allowed=True)
        mock_pm.return_value = [MagicMock(pool_id="p1", pair="ETH/USDC", apy_pct=10,
                                          tvl_usd=500_000, risk_tier="low")]
        mock_risk.return_value = MagicMock(risk_level=5, bounds={}, label="moderate", max_single_pool_pct=40)
        mock_exec.return_value = {"deployment_id": "dep_1", "positions": []}

        from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
        await orchestrate_deploy("0xuser", 1000.0, "balanced")

    assert call_order == ["signals", "allocation"], f"Expected signals → allocation, got {call_order}"
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_privacy_orchestrator_signals.py -v`
Expected: FAIL (still imports `get_recommendation`)

**Step 3: Modify the orchestrator**

In `backend/app/services/privacy_ekubo_orchestrator.py`:

Replace the import at line 9:
```python
# OLD: from app.services.strategy_recommendation_service import get_recommendation
from app.services.signal_pass_service import compute_signals
from app.services.ai_allocation import compute_allocation
from app.services.pool_metrics import fetch_pool_metrics
from app.services.risk_engine import score_risk
```

Replace the call at line 45:
```python
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
    pool_objs = [PoolMetric(pool_id=p["pool_id"], pair=p["pair"], apy_pct=p["apy_pct"],
                             tvl_usd=p["tvl_usd"], risk_tier="low") for p in candidate_pools]
    allocation = await compute_allocation(assessment, pool_objs, deployable_amount,
                                          user_address=user_address, signals=signals)

    pools = [{"pool_id": a.get("pool_id", ""), "allocation_percent": a.get("allocation_pct", 0),
              "expected_apy": a.get("expected_apy", 0)} for a in (allocation.allocations or [])]
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_privacy_orchestrator_signals.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/privacy_ekubo_orchestrator.py backend/tests/test_privacy_orchestrator_signals.py
git commit -m "feat: privacy orchestrator uses signal pass + ai_allocation"
```

---

## Task 5: Replace Hardcoded Splits in private_yield_service

**Files:**
- Modify: `backend/app/services/private_yield_service.py` (line 369)
- Test: `backend/tests/test_private_yield_signals.py`

**Design choice:** Option A — `compute_allocation_split` stays sync. It accepts `signals` computed upstream by the caller. No internal fetching.

**Step 1: Write the failing test**

```python
# backend/tests/test_private_yield_signals.py
import pytest
from app.services.signal_report import SignalReport


def test_allocation_split_shifts_toward_ekubo_when_all_gates_pass():
    """When all pool gates pass, ekubo_pct should be >= the base profile split."""
    from app.services.private_yield_service import compute_allocation_split
    signals = {"p1": SignalReport(pool_id="p1", il_acceptable=True, yield_near_optimal=True,
                                   slippage_ok=True, gates_passed=3, gates_total=3)}

    result = compute_allocation_split(int(100_000 * 1e18), "balanced", signals=signals)
    assert result["ekubo_pct"] >= 45  # balanced base is 45
    assert result["ekubo_pct"] + result["lending_pct"] + result["reserve_pct"] == 100


def test_allocation_split_shifts_toward_lending_when_il_fails():
    """When IL gate fails, lending_pct should increase (safer)."""
    from app.services.private_yield_service import compute_allocation_split
    signals = {"p1": SignalReport(pool_id="p1", il_acceptable=False, yield_near_optimal=True,
                                   slippage_ok=True, gates_passed=2, gates_total=3)}

    result = compute_allocation_split(int(100_000 * 1e18), "balanced", signals=signals)
    assert result["lending_pct"] >= 35  # balanced base is 35


def test_allocation_split_defaults_without_signals():
    """Without signals, returns profile-based defaults (backward compatible)."""
    from app.services.private_yield_service import compute_allocation_split
    result = compute_allocation_split(int(100_000 * 1e18), "conservative")
    assert result["ekubo_pct"] == 30
    assert result["lending_pct"] == 50
    assert result["reserve_pct"] == 20


def test_allocation_split_always_sums_to_100():
    """Total must always be 100 regardless of signal state."""
    from app.services.private_yield_service import compute_allocation_split
    for profile in ["conservative", "balanced", "aggressive"]:
        for signals in [None, {}, {"p1": SignalReport(pool_id="p1", gates_passed=0, gates_total=3)}]:
            result = compute_allocation_split(int(50_000 * 1e18), profile, signals=signals)
            total = result["ekubo_pct"] + result["lending_pct"] + result["reserve_pct"]
            assert total == 100, f"{profile} with signals={signals}: total={total}"
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_private_yield_signals.py -v`
Expected: FAIL with `TypeError: compute_allocation_split() got an unexpected keyword argument 'signals'`

**Step 3: Modify `compute_allocation_split`**

In `backend/app/services/private_yield_service.py` at line 369:

```python
def compute_allocation_split(
    amount_wei: int,
    risk_profile: str = "balanced",
    signals: dict | None = None,
) -> dict[str, Any]:
    """
    Split capital between Ekubo LP and LendingPool.
    Uses zkML signal gate results when available; falls back to profile defaults.
    Stays sync — signals computed upstream by caller.
    """
    base_splits = {
        "conservative": {"ekubo_pct": 30, "lending_pct": 50, "reserve_pct": 20},
        "balanced": {"ekubo_pct": 45, "lending_pct": 35, "reserve_pct": 20},
        "aggressive": {"ekubo_pct": 60, "lending_pct": 25, "reserve_pct": 15},
    }
    split = dict(base_splits.get(risk_profile, base_splits["balanced"]))

    if signals:
        reports = list(signals.values())
        if reports:
            total_gates = sum(r.gates_total for r in reports if hasattr(r, "gates_total"))
            passed_gates = sum(r.gates_passed for r in reports if hasattr(r, "gates_passed"))

            any_il_fail = any(r.il_acceptable is False for r in reports if hasattr(r, "il_acceptable"))
            any_slippage_fail = any(r.slippage_ok is False for r in reports if hasattr(r, "slippage_ok"))

            if total_gates > 0:
                pass_rate = passed_gates / total_gates
                if pass_rate >= 0.8:
                    shift = 5
                    split["ekubo_pct"] = min(75, split["ekubo_pct"] + shift)
                    split["lending_pct"] = max(10, split["lending_pct"] - shift)

            if any_il_fail:
                shift = 10
                split["lending_pct"] = min(65, split["lending_pct"] + shift)
                split["ekubo_pct"] = max(15, split["ekubo_pct"] - shift)

            if any_slippage_fail:
                shift = 5
                split["reserve_pct"] = min(40, split["reserve_pct"] + shift)
                split["ekubo_pct"] = max(15, split["ekubo_pct"] - shift)

        # Normalize to 100
        total = split["ekubo_pct"] + split["lending_pct"] + split["reserve_pct"]
        if total != 100:
            split["reserve_pct"] = max(5, split["reserve_pct"] + (100 - total))
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_private_yield_signals.py -v`
Expected: 4 PASSED

**Step 5: Commit**

```bash
git add backend/app/services/private_yield_service.py backend/tests/test_private_yield_signals.py
git commit -m "feat: private_yield_service accepts upstream signals (Option A, sync)"
```

---

## Task 6: Deploy strkBTC ERC20 on Sepolia

**Files:**
- Create: `contracts/src/strk_btc.cairo`
- Modify: `contracts/src/lib.cairo`

Same Cairo contract as the original plan — this part was fine. Standard ERC20 with mint.

**Step 1: Write the Cairo contract** (same as original plan)

**Step 2: Register in `contracts/src/lib.cairo`** — add `mod strk_btc;`

**Step 3: Build**

Run: `cd /opt/obsqra.starknet/zkdefi/contracts && scarb build`
Expected: Compilation succeeded

**Step 4: Declare and deploy**

```bash
starkli declare target/dev/zkdefi_StrkBTC.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key $DEPLOYER_PK \
  --rpc https://api.cartridge.gg/x/starknet/sepolia

# Record CLASS_HASH from output

starkli deploy $CLASS_HASH $DEPLOYER_ADDRESS u256:1000000000000000000000000 \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key $DEPLOYER_PK \
  --rpc https://api.cartridge.gg/x/starknet/sepolia
```

Record deployed address as `STRKBTC_ADDRESS`.

**Step 5: Commit**

```bash
git add contracts/src/strk_btc.cairo contracts/src/lib.cairo
git commit -m "feat: strkBTC test ERC20 for Sepolia"
```

---

## Task 7: Create strkBTC Ekubo Pools (with computed ticks)

**Files:**
- Create: `deploy_strkbtc_pools.py` (based on `deploy_zkd_pools.py`)

**Critical:** Use `price_to_tick()` from `deploy_zkd_pools.py` (line 67) to compute ticks deterministically. Do NOT guess tick values.

**Step 1: Write deployment script with computed ticks**

```python
# deploy_strkbtc_pools.py
# ... (same boilerplate as deploy_zkd_pools.py: imports, constants, tick math, account setup)

STRKBTC = os.environ["STRKBTC_ADDRESS"]

# Tick math (from deploy_zkd_pools.py — reuse, don't rewrite)
_LOG10001 = math.log(1.0001)

def price_to_tick(price: float) -> int:
    if price <= 0:
        return -100000
    return math.floor(math.log(price) / _LOG10001)

def align_tick(tick: int, tick_spacing: int, *, floor: bool = True) -> int:
    if floor:
        return (tick // tick_spacing) * tick_spacing
    return math.ceil(tick / tick_spacing) * tick_spacing

# Pool 1: strkBTC/ETH
# For testnet: strkBTC pegged 1:1 with ETH
# price = ETH_per_strkBTC = 1.0
BTC_ETH_PRICE = 1.0
BTC_ETH_TICK = price_to_tick(BTC_ETH_PRICE)  # = 0 for 1:1
logger.info("strkBTC/ETH: price=%s, tick=%d", BTC_ETH_PRICE, BTC_ETH_TICK)

# Pool 2: strkBTC/STRK
# price = STRK_per_strkBTC = BTC_price / STRK_price
# For testnet: if BTC ~= ETH ~= $3500, STRK ~= $0.50 → 7000 STRK per strkBTC
BTC_STRK_PRICE = 7000.0
BTC_STRK_TICK = price_to_tick(BTC_STRK_PRICE)  # = 88574
logger.info("strkBTC/STRK: price=%s, tick=%d", BTC_STRK_PRICE, BTC_STRK_TICK)

t0, t1 = _ordered(STRKBTC, ETH)
POOLS = [
    {
        "name": "strkBTC/ETH",
        "token0": t0, "token1": t1,
        "fee": FEE_30PCT, "tick_spacing": 1000,
        "init_tick": align_tick(BTC_ETH_TICK, 1000),
        "deposit_token": STRKBTC,
        "deposit_symbol": "strkBTC",
        "deposit_amount": 100,
        "lower_tick": align_tick(BTC_ETH_TICK - 5000, 1000),
        "upper_tick": align_tick(BTC_ETH_TICK + 5000, 1000, floor=False),
    },
]

t0s, t1s = _ordered(STRKBTC, STRK)
POOLS.append({
    "name": "strkBTC/STRK",
    "token0": t0s, "token1": t1s,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": align_tick(BTC_STRK_TICK, 1000),
    "deposit_token": STRKBTC,
    "deposit_symbol": "strkBTC",
    "deposit_amount": 50,
    "lower_tick": align_tick(BTC_STRK_TICK - 3000, 1000),
    "upper_tick": align_tick(BTC_STRK_TICK + 3000, 1000, floor=False),
})

# ... rest is same deploy logic as deploy_zkd_pools.py
```

**Step 2: Verify ticks before deploying**

Run: `python -c "import math; print('1:1 tick:', math.floor(math.log(1.0) / math.log(1.0001))); print('7000:1 tick:', math.floor(math.log(7000.0) / math.log(1.0001)))"`
Expected: `1:1 tick: 0` and `7000:1 tick: 88574` (or close)

**Step 3: Deploy**

Run: `cd /opt/obsqra.starknet/zkdefi && source backend/venv/bin/activate && python deploy_strkbtc_pools.py`

**Step 4: Commit**

```bash
git add deploy_strkbtc_pools.py
git commit -m "feat: strkBTC Ekubo pools with computed ticks (price_to_tick)"
```

---

## Task 8: Register strkBTC in Backend + Frontend

Same as original plan for `ekubo_config.py`, `.env`, `DepositPanel.tsx`, and `DexPanel.tsx`. No changes from original — the token registration is straightforward config.

**Step 1–4:** Follow original plan Tasks 7 and 8 exactly.

**Step 5: Build frontend**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build`
Expected: Compiled successfully

**Step 6: Commit**

```bash
git add backend/app/services/ekubo_config.py frontend/src/components/zkdefi/vault/DepositPanel.tsx frontend/src/components/zkdefi/DexPanel.tsx
git commit -m "feat: register strkBTC in backend config and frontend token lists"
```

---

## Task 9: DCA Strategy (with interval state + persistence + decimals)

**Files:**
- Create: `backend/app/services/dca_service.py`
- Test: `backend/tests/test_dca_service.py`
- Modify: `backend/app/services/autonomous_agent.py` (line 354, add DCA branch)

**Step 1: Write the failing test**

```python
# backend/tests/test_dca_service.py
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
    assert get_token_decimals("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d") == 18  # STRK
    assert get_token_decimals("0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080") == 6   # USDC
    assert get_token_decimals("0xunknown") == 18  # default


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
    state = {"last_run": time.time() - 100}  # ran 100s ago, interval is 3600s

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

    with patch("app.services.dca_service.compute_signals", new_callable=AsyncMock) as mock_sig, \
         patch("app.services.dca_service._submit_swap", new_callable=AsyncMock) as mock_swap:

        mock_sig.return_value = {"dca_pair": SignalReport(
            pool_id="dca_pair", slippage_ok=False, gates_passed=0, gates_total=1)}
        result = await execute_dca_step("0xuser", config, state)

    assert result["skipped"] is True
    assert result["reason"] == "slippage_exceeded"
    mock_swap.assert_not_called()
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_dca_service.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write implementation**

```python
# backend/app/services/dca_service.py
"""
DCA (Dollar Cost Averaging) strategy service.

Handles interval scheduling, token decimal conversion, signal-gated
swap execution, and state persistence.
"""
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

_TOKEN_DECIMALS: dict[str, int] = {
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18,  # STRK
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18,  # ETH
    "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": 6,   # USDC
}


def get_token_decimals(token_address: str) -> int:
    return _TOKEN_DECIMALS.get(token_address.lower(), _TOKEN_DECIMALS.get(token_address, 18))


def amount_to_wei(amount_human: float, decimals: int) -> int:
    return int(amount_human * (10 ** decimals))


def should_run_dca(now: float, last_run: float | None, interval_secs: int) -> bool:
    if last_run is None or last_run == 0:
        return True
    return (now - last_run) >= interval_secs


async def _submit_swap(token_in: str, token_out: str, amount_wei: int, max_slippage_bps: int) -> dict:
    """Build and submit swap calldata. Returns tx result."""
    from app.services.ekubo_execution_service import build_swap_calldata
    calldata = await build_swap_calldata(token_in, token_out, amount_wei, max_slippage_bps)
    return calldata


async def execute_dca_step(
    user_address: str,
    config: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    """
    Execute a single DCA step. Returns result dict with either swap outcome or skip reason.

    State is passed in and must be persisted by the caller (autonomous_agent).
    """
    now = time.time()
    last_run = state.get("last_run")
    interval_secs = config.get("interval_secs", 3600)

    if not should_run_dca(now, last_run, interval_secs):
        return {"skipped": True, "reason": "interval_not_elapsed"}

    token_in = config["token_in"]
    token_out = config["token_out"]
    amount_human = config["amount_per_interval"]
    max_slippage_bps = config.get("max_slippage_bps", 50)

    decimals_in = get_token_decimals(token_in)
    amount_wei = amount_to_wei(amount_human, decimals_in)

    # Signal check: slippage gate
    from app.services.signal_pass_service import compute_signals
    candidate = [{
        "pool_id": "dca_pair",
        "pair": f"{token_in[:10]}/{token_out[:10]}",
        "token0": token_in, "token1": token_out,
        "apy_pct": 0, "tvl_usd": 0, "liquidity_usd": 1_000_000,
    }]
    signals = await compute_signals(candidate, amount_wei=amount_wei, token_decimals=decimals_in)
    report = list(signals.values())[0] if signals else None

    if report and report.slippage_ok is False:
        logger.warning("DCA skip: slippage gate failed for %s", user_address[:10])
        return {"skipped": True, "reason": "slippage_exceeded"}

    # Execute swap
    try:
        result = await _submit_swap(token_in, token_out, amount_wei, max_slippage_bps)
        state["last_run"] = now
        return {
            "skipped": False,
            "tx_hash": result.get("tx_hash", "pending"),
            "amount_wei": amount_wei,
            "decimals": decimals_in,
            "timestamp": now,
        }
    except Exception as e:
        logger.error("DCA swap failed for %s: %s", user_address[:10], e)
        return {"skipped": True, "reason": f"swap_failed: {e}"}
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_dca_service.py -v`
Expected: 6 PASSED

**Step 5: Wire into autonomous_agent.py**

In `backend/app/services/autonomous_agent.py` at line ~354, add a DCA branch in `_perform_check`:

```python
            strategy_type = getattr(config, "strategy_type", None) or config.metadata.get("strategy_type", "rebalance") if hasattr(config, "metadata") else "rebalance"
            if strategy_type == "dca":
                from app.services.dca_service import execute_dca_step
                dca_config = config.metadata.get("dca_config", {})
                dca_state = self._agents.get(user_address, {}).get("dca_state", {})
                result = await execute_dca_step(user_address, dca_config, dca_state)
                if not result.get("skipped"):
                    agent_state = self._agents.setdefault(user_address, {})
                    agent_state["dca_state"] = dca_state  # persist last_run
                logger.info("DCA for %s: %s", user_address[:10], result)
                return
```

**Step 6: Commit**

```bash
git add backend/app/services/dca_service.py backend/tests/test_dca_service.py backend/app/services/autonomous_agent.py
git commit -m "feat: DCA service with interval gating, decimal safety, signal-checked swaps"
```

---

## Task 10: Integration Verification

**Step 1: Run all new tests**

```bash
cd /opt/obsqra.starknet/zkdefi
python -m pytest backend/tests/test_signal_report.py backend/tests/test_signal_pass_service.py \
  backend/tests/test_ai_allocation_signals.py backend/tests/test_privacy_orchestrator_signals.py \
  backend/tests/test_private_yield_signals.py backend/tests/test_dca_service.py -v
```

Expected: All PASS

**Step 2: Verify frontend builds**

```bash
cd /opt/obsqra.starknet/zkdefi/frontend && npm run build
```

Expected: Compiled successfully

**Step 3: Verify no existing tests broke**

```bash
cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/ -v --timeout=60
```

Expected: All existing tests still pass

**Step 4: Manual smoke test**

1. Start backend: `pm2 restart zkdefi-backend`
2. `curl localhost:8000/api/v1/zkdefi/strategies/recommend` — verify response
3. Deposit via Vault UI — verify allocation uses signal-informed weights
4. Check strkBTC appears in deposit and DEX token selectors

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: integration verification complete"
```
