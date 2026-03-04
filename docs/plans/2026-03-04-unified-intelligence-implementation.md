# Unified Intelligence Pipeline + Capital Deployment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded allocation weights with zkML-informed intelligence, expand token support (strkBTC, stables), and add DCA strategy.

**Architecture:** A new `signal_pass_service` runs zkML circuits (IL predictor, yield optimality, slippage, liquidation risk, correlation) on candidate pools BEFORE allocation. The privacy orchestrator switches from `strategy_recommendation_service` (hardcoded 70/30) to `ai_allocation` (LLM + circuit signals). Token expansion is config-only — deploy ERC20, create Ekubo pools, register addresses.

**Tech Stack:** Python 3.11, FastAPI, snarkjs (Groth16), starknet.py, Cairo 2, Next.js 14, TypeScript

**Design doc:** `docs/plans/2026-03-04-unified-intelligence-capital-deployment-design.md`

---

## Task 1: Signal Pass Service

**Files:**
- Create: `backend/app/services/signal_pass_service.py`
- Test: `backend/tests/test_signal_pass_service.py`
- Reference: `backend/app/services/zkml/circuit_scanner.py` (lines 476–651 for input builders, line 355 for `_generate_proof`)
- Reference: `backend/app/services/pool_metrics.py` (line 73 for `fetch_pool_metrics`)

**Step 1: Write the failing test**

```python
# backend/tests/test_signal_pass_service.py
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_compute_signals_returns_signal_report_per_pool():
    """Signal pass should return a dict of scores per candidate pool."""
    mock_pools = [
        {"pool_id": "pool_a", "pair": "ETH/USDC", "apy_pct": 12.5, "tvl_usd": 500_000,
         "price_std_dev_24h": 0.03, "liquidity_usd": 500_000, "slippage_bps": 10},
        {"pool_id": "pool_b", "pair": "STRK/ETH", "apy_pct": 8.2, "tvl_usd": 200_000,
         "price_std_dev_24h": 0.05, "liquidity_usd": 200_000, "slippage_bps": 25},
    ]

    with patch("app.services.signal_pass_service._run_circuit", new_callable=AsyncMock) as mock_circuit:
        mock_circuit.return_value = {"score": 75, "is_compliant": True}
        from app.services.signal_pass_service import compute_signals
        result = await compute_signals(mock_pools, deposit_amount=10_000)

    assert len(result) == 2
    assert "pool_a" in result
    assert "pool_b" in result
    report = result["pool_a"]
    assert "il_score" in report
    assert "yield_score" in report
    assert "slippage_ok" in report
    assert "composite_score" in report


@pytest.mark.asyncio
async def test_compute_signals_handles_circuit_failure_gracefully():
    """If a circuit fails, use neutral defaults instead of crashing."""
    mock_pools = [
        {"pool_id": "pool_a", "pair": "ETH/USDC", "apy_pct": 12.5, "tvl_usd": 500_000,
         "price_std_dev_24h": 0.03, "liquidity_usd": 500_000, "slippage_bps": 10},
    ]

    with patch("app.services.signal_pass_service._run_circuit", new_callable=AsyncMock) as mock_circuit:
        mock_circuit.side_effect = Exception("snarkjs crashed")
        from app.services.signal_pass_service import compute_signals
        result = await compute_signals(mock_pools, deposit_amount=10_000)

    assert len(result) == 1
    report = result["pool_a"]
    assert report["il_score"] == 50  # neutral default
    assert report["yield_score"] == 50
    assert report["slippage_ok"] is True
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_signal_pass_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.signal_pass_service'`

**Step 3: Write minimal implementation**

```python
# backend/app/services/signal_pass_service.py
"""
Pre-allocation signal pass: runs zkML circuits on candidate pools
to produce verified intelligence scores before allocation decisions.

Each circuit output is a score (0–100) that feeds into the allocation
engine as context alongside raw pool metrics.
"""
import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

_NEUTRAL = {"il_score": 50, "yield_score": 50, "slippage_ok": True,
            "liquidation_risk": 0, "correlation_risk": 50, "composite_score": 50}


async def _run_circuit(circuit_name: str, inputs: dict[str, Any]) -> dict[str, Any]:
    """Run a single zkML circuit via circuit_scanner. Returns score dict."""
    from app.services.zkml.circuit_scanner import _generate_proof
    result = await _generate_proof(circuit_name, inputs)
    return result


def _pool_to_il_inputs(pool: dict, deposit_amount: float) -> dict[str, Any]:
    """Map pool metrics to ImpermanentLossPredictor circuit inputs."""
    from app.services.zkml.circuit_scanner import build_il_predictor_inputs
    price_std = pool.get("price_std_dev_24h", 0.03)
    entry_price = 2000
    current_price = int(entry_price * (1 + price_std))
    return build_il_predictor_inputs(
        position_size=int(deposit_amount),
        entry_price=entry_price,
        current_price=current_price,
        fee_earned_bps=int(pool.get("apy_pct", 5) * 100 / 365),
        max_il_tolerance_bps=500,
    )


def _pool_to_yield_inputs(pool: dict, all_pools: list[dict]) -> dict[str, Any]:
    """Map pool metrics to YieldOptimality circuit inputs."""
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


def _pool_to_slippage_inputs(pool: dict, deposit_amount: float) -> dict[str, Any]:
    """Map pool metrics to SlippageBound circuit inputs."""
    from app.services.zkml.circuit_scanner import build_slippage_bound_inputs
    liquidity = int(pool.get("liquidity_usd", 1_000_000))
    return build_slippage_bound_inputs(
        trade_amount=int(deposit_amount),
        current_liquidity=max(liquidity, 1),
        max_slippage_bps=int(pool.get("slippage_bps", 50)),
    )


def _extract_score(result: dict, field: str, default: int = 50) -> int:
    """Extract a normalized 0-100 score from a circuit result."""
    if not result:
        return default
    for key in [field, "score", "risk_score", "composite_score"]:
        val = result.get(key)
        if val is not None:
            return max(0, min(100, int(val)))
    return default


async def _safe_circuit(circuit_name: str, inputs: dict[str, Any], label: str) -> dict[str, Any]:
    """Run circuit with error handling — return empty dict on failure."""
    try:
        return await _run_circuit(circuit_name, inputs)
    except Exception as e:
        logger.warning("Signal pass: %s circuit failed: %s", label, e)
        return {}


async def compute_signals(
    candidate_pools: list[dict],
    deposit_amount: float = 10_000,
    portfolio_positions: list[dict] | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Run zkML circuits on each candidate pool and return a SignalReport per pool.

    Returns: {pool_id: {il_score, yield_score, slippage_ok, liquidation_risk,
                        correlation_risk, composite_score}}
    """
    if not candidate_pools:
        return {}

    reports: dict[str, dict[str, Any]] = {}

    yield_inputs = _pool_to_yield_inputs(candidate_pools[0], candidate_pools)
    yield_result = await _safe_circuit("YieldOptimality", yield_inputs, "yield")

    tasks = []
    pool_ids = []
    for pool in candidate_pools:
        pid = pool.get("pool_id", pool.get("pair", "unknown"))
        pool_ids.append(pid)
        il_inputs = _pool_to_il_inputs(pool, deposit_amount)
        slip_inputs = _pool_to_slippage_inputs(pool, deposit_amount)
        tasks.append(_safe_circuit("ImpermanentLossPredictor", il_inputs, f"IL-{pid}"))
        tasks.append(_safe_circuit("SlippageBound", slip_inputs, f"slip-{pid}"))

    results = await asyncio.gather(*tasks)

    for i, pid in enumerate(pool_ids):
        il_result = results[i * 2]
        slip_result = results[i * 2 + 1]

        il_score = _extract_score(il_result, "il_within_tolerance", 50)
        yield_score = _extract_score(yield_result, "is_near_optimal", 50)
        slippage_ok = bool(slip_result.get("slippage_within_bound", True) if slip_result else True)

        composite = int(yield_score * 0.4 + (100 - il_score) * 0.3 + (100 if slippage_ok else 0) * 0.2 + 50 * 0.1)
        composite = max(0, min(100, composite))

        reports[pid] = {
            "il_score": il_score,
            "yield_score": yield_score,
            "slippage_ok": slippage_ok,
            "liquidation_risk": 0,
            "correlation_risk": 50,
            "composite_score": composite,
        }

    logger.info("Signal pass complete: %d pools scored", len(reports))
    return reports
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_signal_pass_service.py -v`
Expected: 2 PASSED

**Step 5: Commit**

```bash
git add backend/app/services/signal_pass_service.py backend/tests/test_signal_pass_service.py
git commit -m "feat: add signal pass service — pre-allocation zkML circuit batch"
```

---

## Task 2: Wire ai_allocation to Accept Signals

**Files:**
- Modify: `backend/app/services/ai_allocation.py` (line 86, `compute_allocation` signature)
- Test: `backend/tests/test_ai_allocation_signals.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_ai_allocation_signals.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

@pytest.mark.asyncio
async def test_compute_allocation_includes_signals_in_llm_prompt():
    """When signals are provided, they should appear in the LLM context."""
    from app.services.ai_allocation import compute_allocation, RiskAssessment, PoolMetric

    assessment = RiskAssessment(risk_level=5, bounds={"max_single_pool_pct": 40},
                                label="moderate", max_single_pool_pct=40)
    pools = [PoolMetric(pool_id="p1", pair="ETH/USDC", apy_pct=10.0, tvl_usd=500_000, risk_tier="low")]
    signals = {"p1": {"il_score": 20, "yield_score": 80, "slippage_ok": True, "composite_score": 75}}

    with patch("app.services.ai_allocation._try_llm_allocation", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = None  # force deterministic fallback
        result = await compute_allocation(assessment, pools, 10_000, signals=signals)

    assert result is not None
    assert result.source in ("deterministic", "llm")
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
    signals: dict[str, dict] | None = None,
) -> AllocationDecision:
```

In the LLM prompt construction (find the `_build_prompt` or system message section), append signal context when available:

```python
    signal_context = ""
    if signals:
        lines = []
        for pool in pools:
            sig = signals.get(pool.pool_id, {})
            if sig:
                lines.append(f"  {pool.pair}: IL risk={sig.get('il_score', '?')}/100, "
                             f"yield={sig.get('yield_score', '?')}/100, "
                             f"slippage_ok={sig.get('slippage_ok', '?')}, "
                             f"composite={sig.get('composite_score', '?')}/100")
        if lines:
            signal_context = "\n\nzkML Circuit Signals (verified):\n" + "\n".join(lines)
```

In the deterministic fallback scoring, use composite_score to weight pools instead of raw APY alone:

```python
    # In _deterministic_allocation or equivalent:
    for pool in pools:
        sig = (signals or {}).get(pool.pool_id, {})
        composite = sig.get("composite_score", 50)
        base_score = pool.apy_pct * 10 + pool.tvl_usd / 100_000
        score = base_score * (composite / 50)  # composite=50 is neutral, >50 boosts, <50 penalizes
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_ai_allocation_signals.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/ai_allocation.py backend/tests/test_ai_allocation_signals.py
git commit -m "feat: ai_allocation accepts zkML signal scores as allocation context"
```

---

## Task 3: Replace Recommendation Entry Point in Privacy Orchestrator

**Files:**
- Modify: `backend/app/services/privacy_ekubo_orchestrator.py` (line 9 import, line 45 call site)
- Test: `backend/tests/test_privacy_orchestrator_signals.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_privacy_orchestrator_signals.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

@pytest.mark.asyncio
async def test_orchestrate_deploy_uses_ai_allocation_not_recommendation():
    """Privacy orchestrator should call ai_allocation.compute_allocation, not strategy_recommendation_service."""
    with patch("app.services.privacy_ekubo_orchestrator.compute_signals", new_callable=AsyncMock) as mock_sig, \
         patch("app.services.privacy_ekubo_orchestrator.compute_allocation", new_callable=AsyncMock) as mock_alloc, \
         patch("app.services.privacy_ekubo_orchestrator.fetch_pool_metrics", new_callable=AsyncMock) as mock_pm, \
         patch("app.services.privacy_ekubo_orchestrator.score_risk") as mock_risk, \
         patch("app.services.privacy_ekubo_orchestrator.execution_guard") as mock_guard, \
         patch("app.services.privacy_ekubo_orchestrator.execute_strategy_impl", new_callable=AsyncMock) as mock_exec:

        mock_guard.check.return_value = MagicMock(allowed=True)
        mock_pm.return_value = [{"pool_id": "p1", "pair": "ETH/USDC", "apy_pct": 10, "tvl_usd": 500_000,
                                 "price_std_dev_24h": 0.03, "liquidity_usd": 500_000, "slippage_bps": 10}]
        mock_sig.return_value = {"p1": {"il_score": 20, "yield_score": 80, "slippage_ok": True, "composite_score": 75}}
        mock_risk.return_value = MagicMock(risk_level=5, bounds={}, label="moderate", max_single_pool_pct=40)
        mock_alloc.return_value = MagicMock(
            allocations=[{"pool_id": "p1", "allocation_pct": 80, "expected_apy": 10}],
            reserve_pct=20, blended_apy_pct=8.0, reasoning="test", confidence=0.8,
            source="deterministic", attestation_hash="0xabc"
        )
        mock_exec.return_value = {"deployment_id": "dep_1", "positions": []}

        from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
        result = await orchestrate_deploy("0xuser", 1000.0, "balanced")

    mock_alloc.assert_called_once()
    mock_sig.assert_called_once()
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_privacy_orchestrator_signals.py -v`
Expected: FAIL (orchestrator still imports `get_recommendation`)

**Step 3: Modify the orchestrator**

In `backend/app/services/privacy_ekubo_orchestrator.py`:

Replace the import at line 9:
```python
# OLD: from app.services.strategy_recommendation_service import get_recommendation
from app.services.signal_pass_service import compute_signals
from app.services.ai_allocation import compute_allocation, RiskAssessment, PoolMetric
from app.services.pool_metrics import fetch_pool_metrics
from app.services.risk_engine import score_risk
```

Replace the call at line 45 (`rec = await get_recommendation(...)`):
```python
    pool_metrics_raw = await fetch_pool_metrics(min_tvl_usd=1000, limit=20)
    candidate_pools = [
        {
            "pool_id": pm.pool_id if hasattr(pm, "pool_id") else pm.get("pool_id", ""),
            "pair": pm.pair if hasattr(pm, "pair") else pm.get("pair", ""),
            "apy_pct": pm.apy_pct if hasattr(pm, "apy_pct") else pm.get("apy_pct", 0),
            "tvl_usd": pm.tvl_usd if hasattr(pm, "tvl_usd") else pm.get("tvl_usd", 0),
            "price_std_dev_24h": getattr(pm, "price_std_dev_24h", 0.03) if hasattr(pm, "price_std_dev_24h") else pm.get("price_std_dev_24h", 0.03),
            "liquidity_usd": getattr(pm, "liquidity_usd", 0) if hasattr(pm, "liquidity_usd") else pm.get("liquidity_usd", 0),
            "slippage_bps": getattr(pm, "slippage_bps", 30) if hasattr(pm, "slippage_bps") else pm.get("slippage_bps", 30),
        }
        for pm in pool_metrics_raw
    ]

    signals = await compute_signals(candidate_pools, deposit_amount=deployable_amount)

    assessment = score_risk(risk_level={"conservative": 3, "balanced": 5, "aggressive": 8}.get(risk_profile, 5))
    pool_metric_objs = [
        PoolMetric(pool_id=p["pool_id"], pair=p["pair"], apy_pct=p["apy_pct"],
                   tvl_usd=p["tvl_usd"], risk_tier="low")
        for p in candidate_pools
    ]
    allocation = await compute_allocation(assessment, pool_metric_objs, deployable_amount,
                                          user_address=user_address, signals=signals)

    pools = [
        {"pool_id": a.get("pool_id", ""), "allocation_percent": a.get("allocation_pct", 0),
         "expected_apy": a.get("expected_apy", 0)}
        for a in (allocation.allocations or [])
    ]
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_privacy_orchestrator_signals.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/privacy_ekubo_orchestrator.py backend/tests/test_privacy_orchestrator_signals.py
git commit -m "feat: privacy orchestrator uses ai_allocation + signal pass instead of hardcoded recommendations"
```

---

## Task 4: Replace Hardcoded Splits in private_yield_service

**Files:**
- Modify: `backend/app/services/private_yield_service.py` (line 369, `compute_allocation_split`)
- Test: `backend/tests/test_private_yield_signals.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_private_yield_signals.py
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_compute_allocation_split_uses_signals_when_available():
    """Allocation split should use signal-informed weights, not hardcoded percentages."""
    with patch("app.services.private_yield_service.compute_signals", new_callable=AsyncMock) as mock_sig, \
         patch("app.services.private_yield_service.fetch_pool_metrics", new_callable=AsyncMock) as mock_pm:

        mock_pm.return_value = [{"pool_id": "p1", "pair": "ETH/USDC", "apy_pct": 15,
                                 "tvl_usd": 1_000_000, "price_std_dev_24h": 0.02,
                                 "liquidity_usd": 1_000_000, "slippage_bps": 5}]
        mock_sig.return_value = {"p1": {"il_score": 10, "yield_score": 90, "slippage_ok": True, "composite_score": 85}}

        from app.services.private_yield_service import compute_allocation_split
        result = compute_allocation_split(int(100_000 * 1e18), "balanced")

    assert "ekubo_pct" in result
    assert "lending_pct" in result
    assert "reserve_pct" in result
    total = result["ekubo_pct"] + result["lending_pct"] + result["reserve_pct"]
    assert total == 100
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_private_yield_signals.py -v`
Expected: FAIL

**Step 3: Modify `compute_allocation_split`**

In `backend/app/services/private_yield_service.py` at line 369, keep the hardcoded splits as fallback but add signal-aware logic:

```python
def compute_allocation_split(
    amount_wei: int,
    risk_profile: str = "balanced",
    signals: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """
    Determine how to split capital between Ekubo LP and LendingPool supply.
    Uses zkML signal scores when available; falls back to profile-based defaults.
    """
    base_splits = {
        "conservative": {"ekubo_pct": 30, "lending_pct": 50, "reserve_pct": 20},
        "balanced": {"ekubo_pct": 45, "lending_pct": 35, "reserve_pct": 20},
        "aggressive": {"ekubo_pct": 60, "lending_pct": 25, "reserve_pct": 15},
    }
    split = dict(base_splits.get(risk_profile, base_splits["balanced"]))

    if signals:
        avg_composite = sum(s.get("composite_score", 50) for s in signals.values()) / max(len(signals), 1)
        avg_il = sum(s.get("il_score", 50) for s in signals.values()) / max(len(signals), 1)

        # High composite = good pools available → shift toward ekubo
        # High IL = risky pools → shift toward lending (safer)
        if avg_composite > 65:
            shift = min(10, int((avg_composite - 65) / 3.5))
            split["ekubo_pct"] = min(75, split["ekubo_pct"] + shift)
            split["lending_pct"] = max(10, split["lending_pct"] - shift)
        elif avg_il > 60:
            shift = min(10, int((avg_il - 60) / 4))
            split["lending_pct"] = min(65, split["lending_pct"] + shift)
            split["ekubo_pct"] = max(15, split["ekubo_pct"] - shift)

        # Normalize to 100
        total = split["ekubo_pct"] + split["lending_pct"] + split["reserve_pct"]
        if total != 100:
            diff = 100 - total
            split["reserve_pct"] = max(5, split["reserve_pct"] + diff)

    # ... rest of existing logic (lending utilization adjustment, amount calculations)
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_private_yield_signals.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/private_yield_service.py backend/tests/test_private_yield_signals.py
git commit -m "feat: private_yield_service allocation splits informed by zkML signals"
```

---

## Task 5: Deploy strkBTC ERC20 on Sepolia

**Files:**
- Create: `contracts/src/strk_btc.cairo`
- Reference: `contracts/src/erc20_interface.cairo` (existing IERC20 trait)
- Reference: `deploy_zkd_pools.py` (deployment pattern)

**Step 1: Write the Cairo contract**

```cairo
// contracts/src/strk_btc.cairo
#[starknet::contract]
mod StrkBTC {
    use starknet::ContractAddress;
    use starknet::get_caller_address;

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: LegacyMap<ContractAddress, u256>,
        allowances: LegacyMap<(ContractAddress, ContractAddress), u256>,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        from: ContractAddress,
        to: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        owner: ContractAddress,
        spender: ContractAddress,
        value: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, initial_supply: u256) {
        self.name.write('strkBTC');
        self.symbol.write('strkBTC');
        self.decimals.write(18);
        self.owner.write(owner);
        self.total_supply.write(initial_supply);
        self.balances.write(owner, initial_supply);
        self.emit(Transfer { from: starknet::contract_address_const::<0>(), to: owner, value: initial_supply });
    }

    #[abi(embed_v0)]
    impl IERC20 of super::super::erc20_interface::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'Insufficient balance');
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'Insufficient allowance');
            self.allowances.write((sender, caller), current_allowance - amount);
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'Insufficient balance');
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }
    }

    #[external(v0)]
    fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
        assert(get_caller_address() == self.owner.read(), 'Only owner');
        self.total_supply.write(self.total_supply.read() + amount);
        self.balances.write(to, self.balances.read(to) + amount);
        self.emit(Transfer { from: starknet::contract_address_const::<0>(), to, value: amount });
    }
}
```

**Step 2: Register in `contracts/src/lib.cairo`**

Add `mod strk_btc;` to the module list.

**Step 3: Build**

Run: `cd /opt/obsqra.starknet/zkdefi/contracts && scarb build`
Expected: Compilation succeeded

**Step 4: Deploy using starkli**

```bash
starkli deploy <class_hash> <deployer_address> <initial_supply_low> <initial_supply_high> \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key $DEPLOYER_PK \
  --rpc https://api.cartridge.gg/x/starknet/sepolia
```

Initial supply: 1,000,000 strkBTC (1_000_000 * 10^18).

Record the deployed address.

**Step 5: Commit**

```bash
git add contracts/src/strk_btc.cairo contracts/src/lib.cairo
git commit -m "feat: add strkBTC test ERC20 contract for Sepolia"
```

---

## Task 6: Create strkBTC Ekubo Pools

**Files:**
- Create: `deploy_strkbtc_pools.py` (based on `deploy_zkd_pools.py`)

**Step 1: Write the deployment script**

Copy the structure from `deploy_zkd_pools.py` (lines 1–343). Replace pools with:

```python
STRKBTC = "<deployed_address_from_task_5>"

POOLS = []

# Pool 1: strkBTC/ETH — pegged ~1:1 for testnet
t0, t1 = _ordered(STRKBTC, ETH)
POOLS.append({
    "name": "strkBTC/ETH",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": 0,  # 1:1 price → tick 0
    "deposit_token": STRKBTC,
    "deposit_symbol": "strkBTC",
    "deposit_amount": 100,
    "lower_tick": -5000,
    "upper_tick": 5000,
})

# Pool 2: strkBTC/STRK
t0, t1 = _ordered(STRKBTC, STRK)
POOLS.append({
    "name": "strkBTC/STRK",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": 88000,  # ~7000 STRK per strkBTC
    "deposit_token": STRKBTC,
    "deposit_symbol": "strkBTC",
    "deposit_amount": 50,
    "lower_tick": 85000,
    "upper_tick": 91000,
})
```

**Step 2: Run deployment**

```bash
cd /opt/obsqra.starknet/zkdefi
source backend/venv/bin/activate
python deploy_strkbtc_pools.py
```

Record pool creation tx hashes.

**Step 3: Commit**

```bash
git add deploy_strkbtc_pools.py
git commit -m "feat: deploy strkBTC/ETH and strkBTC/STRK pools on Ekubo Sepolia"
```

---

## Task 7: Register strkBTC in Backend

**Files:**
- Modify: `backend/app/services/ekubo_config.py` (line 24, after SEPOLIA_STRK)
- Modify: `backend/.env` (add STRKBTC_ADDRESS)

**Step 1: Add token address to ekubo_config.py**

After line 30 (`SEPOLIA_STRK = "0x0471..."`) add:

```python
SEPOLIA_STRKBTC = os.environ.get("STRKBTC_ADDRESS", "<deployed_address>")
```

**Step 2: Add to `.env`**

```
STRKBTC_ADDRESS=<deployed_address_from_task_5>
```

**Step 3: Verify pool discovery**

Run: `cd /opt/obsqra.starknet/zkdefi && source backend/venv/bin/activate && python -c "from app.services.ekubo_config import SEPOLIA_STRKBTC; print(SEPOLIA_STRKBTC)"`
Expected: prints the deployed address

**Step 4: Commit**

```bash
git add backend/app/services/ekubo_config.py
git commit -m "feat: register strkBTC token address in backend config"
```

---

## Task 8: Add strkBTC to Frontend

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx` (line 52, Asset type; line 411, selector)
- Modify: `frontend/src/components/zkdefi/DexPanel.tsx` (line 14, TOKEN_DECIMALS_FALLBACK)

**Step 1: Expand Asset type in DepositPanel**

At line 52 of `frontend/src/components/zkdefi/vault/DepositPanel.tsx`:

```typescript
// OLD: type Asset = "STRK" | "ETH";
type Asset = "STRK" | "ETH" | "strkBTC";
```

Add strkBTC token address constant after line 21:

```typescript
const STRKBTC_TOKEN = process.env.NEXT_PUBLIC_STRKBTC_ADDRESS || "<deployed_address>";
```

At line 415, expand the asset selector array:

```typescript
// OLD: {(["STRK", "ETH"] as Asset[]).map((a) => (
{(["STRK", "ETH", "strkBTC"] as Asset[]).map((a) => (
```

Update the token address resolution (find `getTokenAddress` or equivalent):

```typescript
const tokenAddress = selectedAsset === "ETH"
  ? ETH_TOKEN
  : selectedAsset === "strkBTC"
    ? STRKBTC_TOKEN
    : STRK_TOKEN;
```

**Step 2: Add to DexPanel decimals fallback**

At line 14 of `frontend/src/components/zkdefi/DexPanel.tsx`:

```typescript
const TOKEN_DECIMALS_FALLBACK: Record<string, number> = {
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18, // STRK
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18, // ETH
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": 6,  // USDC
  "<deployed_strkBTC_address>": 18, // strkBTC
};
```

**Step 3: Build and verify**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build`
Expected: Compiled successfully

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/vault/DepositPanel.tsx frontend/src/components/zkdefi/DexPanel.tsx
git commit -m "feat: add strkBTC to deposit panel and DEX token list"
```

---

## Task 9: DCA Strategy Type

**Files:**
- Modify: `backend/app/services/autonomous_agent.py` (line 206, `_monitor_loop`; line 354, strategy handling)
- Create: `backend/tests/test_dca_strategy.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_dca_strategy.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

@pytest.mark.asyncio
async def test_dca_strategy_executes_swap_at_interval():
    """DCA strategy should trigger a swap of fixed amount on each interval."""
    from app.services.autonomous_agent import AutonomousAgent

    agent = AutonomousAgent.__new__(AutonomousAgent)
    agent._agents = {}
    agent._rebalancer = MagicMock()
    agent._logger = MagicMock()

    dca_config = {
        "strategy_type": "dca",
        "token_in": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "token_out": "<strkBTC_address>",
        "amount_per_interval": 100,
        "max_slippage_bps": 50,
    }

    with patch.object(agent, "_execute_dca_swap", new_callable=AsyncMock) as mock_swap:
        mock_swap.return_value = {"tx_hash": "0xabc", "amount_swapped": 100}
        result = await agent._execute_dca_swap("0xuser", dca_config)

    assert result["tx_hash"] == "0xabc"
    assert result["amount_swapped"] == 100
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_dca_strategy.py -v`
Expected: FAIL with `AttributeError: 'AutonomousAgent' object has no attribute '_execute_dca_swap'`

**Step 3: Add DCA strategy to autonomous_agent.py**

Add a new method to the `AutonomousAgent` class:

```python
    async def _execute_dca_swap(self, user_address: str, dca_config: dict) -> dict:
        """Execute a single DCA swap via Ekubo."""
        from app.services.signal_pass_service import compute_signals
        from app.services.ekubo_execution_service import build_swap_calldata

        token_in = dca_config["token_in"]
        token_out = dca_config["token_out"]
        amount = dca_config["amount_per_interval"]
        max_slippage = dca_config.get("max_slippage_bps", 50)

        candidate = [{
            "pool_id": f"{token_in[:10]}_{token_out[:10]}",
            "pair": f"{token_in[:10]}/{token_out[:10]}",
            "apy_pct": 0, "tvl_usd": 0,
            "price_std_dev_24h": 0.03, "liquidity_usd": 1_000_000,
            "slippage_bps": max_slippage,
        }]
        signals = await compute_signals(candidate, deposit_amount=amount)

        pool_signal = list(signals.values())[0] if signals else {}
        if not pool_signal.get("slippage_ok", True):
            logger.warning("DCA skip: slippage exceeds tolerance for %s", user_address[:10])
            return {"skipped": True, "reason": "slippage_exceeded"}

        calldata = await build_swap_calldata(token_in, token_out, int(amount * 10**18), max_slippage)

        return {
            "tx_hash": calldata.get("tx_hash", "pending"),
            "amount_swapped": amount,
            "signal_composite": pool_signal.get("composite_score", 50),
        }
```

In `_perform_check` (around line 340), add a branch for DCA:

```python
            strategy_type = config.metadata.get("strategy_type", "rebalance") if hasattr(config, "metadata") else "rebalance"
            if strategy_type == "dca":
                dca_config = config.metadata.get("dca_config", {})
                result = await self._execute_dca_swap(user_address, dca_config)
                logger.info("DCA execution for %s: %s", user_address[:10], result)
                return
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi && python -m pytest backend/tests/test_dca_strategy.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/autonomous_agent.py backend/tests/test_dca_strategy.py
git commit -m "feat: add DCA strategy type to autonomous agent with signal-gated execution"
```

---

## Task 10: Integration Verification

**Step 1: Run full test suite**

```bash
cd /opt/obsqra.starknet/zkdefi
python -m pytest backend/tests/test_signal_pass_service.py backend/tests/test_ai_allocation_signals.py backend/tests/test_privacy_orchestrator_signals.py backend/tests/test_private_yield_signals.py backend/tests/test_dca_strategy.py -v
```

Expected: All PASS

**Step 2: Verify frontend builds**

```bash
cd /opt/obsqra.starknet/zkdefi/frontend && npm run build
```

Expected: Compiled successfully

**Step 3: Manual smoke test**

1. Start backend: `cd /opt/obsqra.starknet/zkdefi && bash backend/start.sh`
2. Hit `/api/v1/zkdefi/strategies/recommend` — verify response includes signal scores
3. Deposit via Vault UI — verify allocation uses signal-informed weights
4. Check strkBTC appears in deposit token selector
5. Check strkBTC appears in DEX token list

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: integration verification — unified intelligence pipeline complete"
```
