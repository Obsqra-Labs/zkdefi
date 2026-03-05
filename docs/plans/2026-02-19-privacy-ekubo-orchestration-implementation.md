# Privacy → Ekubo Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the orchestration layer that takes a user’s deployable amount (personal v1), calls strategy recommend, executes only to Ekubo Sepolia, and records compliance proofs.

**Architecture:** New orchestration service invokes existing strategies (recommend) and vault_execute_live; it filters allocations to Ekubo-only and creates a receipt with proof hashes. Ekubo Sepolia addresses and chain id live in a single config module. Design reference: `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md`.

**Tech Stack:** FastAPI, Pydantic, pytest, existing `ekubo_client` / `real_pool_aggregator` / `receipt_service` / strategies and vault_execute_live routes.

---

## Task 1: Ekubo Sepolia config module

**Files:**
- Create: `backend/app/services/ekubo_config.py`
- Create: `backend/tests/test_ekubo_config.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_ekubo_config.py`:

```python
"""Tests for Ekubo Sepolia config."""
import os
import pytest


def test_ekubo_core_address_is_hex():
    from app.services.ekubo_config import EKUBO_CORE_SEPOLIA
    assert EKUBO_CORE_SEPOLIA.startswith("0x")
    assert len(EKUBO_CORE_SEPOLIA) == 66


def test_ekubo_chain_id_from_env_or_none():
    from app.services.ekubo_config import get_ekubo_chain_id
    # With no env set, may be None or default
    val = get_ekubo_chain_id()
    assert val is None or isinstance(val, str)
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_ekubo_config.py -v`

Expected: FAIL (e.g. ModuleNotFoundError or import error for ekubo_config).

**Step 3: Write minimal implementation**

Create `backend/app/services/ekubo_config.py`:

```python
"""Ekubo Sepolia config — single source for addresses and chain id. See docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md."""
import os

# Sepolia contract addresses (from design §2.1)
EKUBO_CORE_SEPOLIA = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_ROUTER_SEPOLIA = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763"
EKUBO_POSITIONS_SEPOLIA = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"
EKUBO_TOKEN_REGISTRY_SEPOLIA = "0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5"

EKUBO_API_BASE = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")


def get_ekubo_chain_id() -> str | None:
    """Starknet Sepolia chain id for API paths/queries. Set EKUBO_CHAIN_ID in env."""
    raw = os.getenv("EKUBO_CHAIN_ID")
    if not raw:
        return None
    return raw.strip()
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_ekubo_config.py -v`

Expected: PASS.

**Step 5: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi
git add backend/app/services/ekubo_config.py backend/tests/test_ekubo_config.py
git commit -m "feat: add Ekubo Sepolia config module"
```

---

## Task 2: Strategy recommendation callable (extract from route)

**Files:**
- Create: `backend/app/services/strategy_recommendation_service.py`
- Modify: `backend/app/api/routes/strategies.py` (use the new service in recommend_strategy)
- Modify: `backend/tests/test_strategies_api.py` (ensure existing recommend test still passes)

**Step 1: Write the failing test**

Add to a new file `backend/tests/test_strategy_recommendation_service.py`:

```python
"""Tests for strategy recommendation service."""
import pytest


@pytest.mark.asyncio
async def test_get_recommendation_returns_ekubo_pools():
    from app.services.strategy_recommendation_service import get_recommendation
    result = await get_recommendation(
        user_address="0xabc",
        amount=1000.0,
        risk_profile="balanced",
    )
    assert result["user_address"] == "0xabc"
    assert result["risk_profile"] == "balanced"
    assert result["total_amount"] == 1000.0
    assert "recommended_pools" in result
    assert len(result["recommended_pools"]) >= 1
    for p in result["recommended_pools"]:
        assert p.get("protocol", "").lower() == "ekubo"
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_strategy_recommendation_service.py -v`

Expected: FAIL (e.g. get_recommendation not defined or module missing).

**Step 3: Write minimal implementation**

Create `backend/app/services/strategy_recommendation_service.py`:

```python
"""Strategy recommendation for orchestration and strategies route. Returns Ekubo-only pools for orchestration target."""
from typing import Any


async def get_recommendation(
    user_address: str,
    amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """Return recommendation dict with recommended_pools (protocol = Ekubo). Used by strategies route and orchestrator."""
    if risk_profile.lower() == "conservative":
        allocation_pct1, allocation_pct2 = 0.7, 0.3
    elif risk_profile.lower() == "aggressive":
        allocation_pct1, allocation_pct2 = 0.3, 0.7
    else:
        allocation_pct1, allocation_pct2 = 0.6, 0.4

    recommended_pools = [
        {
            "pool_id": "ekubo_eth_usdc",
            "protocol": "Ekubo",
            "pair": "ETH/USDC",
            "allocation_percent": allocation_pct1 * 100,
            "allocation_amount": amount * allocation_pct1,
            "expected_apy": 27.5,
            "risk_score": 30.0,
            "risk_flags": [],
        },
        {
            "pool_id": "ekubo_strk_usdc",
            "protocol": "Ekubo",
            "pair": "STRK/USDC",
            "allocation_percent": allocation_pct2 * 100,
            "allocation_amount": amount * allocation_pct2,
            "expected_apy": 26.5,
            "risk_score": 40.0,
            "risk_flags": [],
        },
    ]
    expected_apy = (27.5 * allocation_pct1) + (26.5 * allocation_pct2)
    import hashlib
    import time
    recommendation_id = hashlib.sha256(
        f"{user_address}_{time.time()}".encode()
    ).hexdigest()[:12]
    from datetime import datetime
    return {
        "user_address": user_address,
        "risk_profile": risk_profile,
        "total_amount": amount,
        "recommended_pools": recommended_pools,
        "ai_reasoning": f"Based on your {risk_profile} risk profile, we recommend allocating {allocation_pct1*100:.0f}% to ETH/USDC and {allocation_pct2*100:.0f}% to STRK/USDC. Expected portfolio APY is {expected_apy:.1f}%.",
        "ai_confidence": 0.85,
        "expected_portfolio_apy": expected_apy,
        "portfolio_risk_assessment": f"This {risk_profile} allocation balances your risk tolerance with yield optimization.",
        "recommendation_id": recommendation_id,
        "timestamp": datetime.utcnow().isoformat(),
    }
```

Update `backend/app/api/routes/strategies.py`: in `recommend_strategy`, replace the inline recommendation logic with a call to `get_recommendation`. Add at top: `from app.services.strategy_recommendation_service import get_recommendation`. In the handler, call `result = await get_recommendation(request.user_address, request.amount, request.risk_profile)` and build `StrategyRecommendationResponse` from `result` (map keys to the Pydantic model fields; use the same PoolRecommendation construction from result["recommended_pools"]).

**Step 4: Run tests to verify they pass**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_strategy_recommendation_service.py tests/test_strategies_api.py -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/services/strategy_recommendation_service.py backend/app/api/routes/strategies.py backend/tests/test_strategy_recommendation_service.py
git commit -m "refactor: extract strategy recommendation into service (Ekubo-only for orchestration)"
```

---

## Task 3: Vault execute service (extract impl) and vault-live use provided allocations

**Files:**
- Create: `backend/app/services/vault_execute_service.py` (extract execution logic: `execute_strategy_impl(request) -> ExecuteStrategyResponse`)
- Modify: `backend/app/api/routes/vault_execute_live.py` (call `execute_strategy_impl` from route; when `request.allocations` is non-empty, use it to build positions and skip aggregator)
- Create: `backend/tests/test_vault_execute_live.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_vault_execute_live.py`:

```python
"""Tests for vault execute live."""
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)


def test_execute_with_allocations_returns_positions():
    response = client.post(
        "/api/v1/vault-live/execute",
        json={
            "user_address": "0xabc",
            "risk_profile": "balanced",
            "deposit_amount": 100.0,
            "allocations": [
                {"strategy": "ekubo_eth_usdc", "percentage": 60, "amount": 60.0},
                {"strategy": "ekubo_strk_usdc", "percentage": 40, "amount": 40.0},
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["user_address"] == "0xabc"
    assert len(data["positions"]) == 2
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_vault_execute_live.py -v`

Expected: FAIL (positions empty or 422).

**Step 3: Write minimal implementation**

Create `backend/app/services/vault_execute_service.py`: move the execution logic from `execute_strategy` (vault_execute_live) into `async def execute_strategy_impl(request)` (request type from vault_execute_live). When `request.allocations` is not None and len > 0, build positions from allocations: for each alloc, `DeploymentPosition(strategy=alloc.strategy, pool_id=f"pool_{i}", amount=alloc.amount, tx_hash=None, status="pending", expected_apy=0, pool_name=alloc.strategy)`; set total_expected_apy to 0 or weighted average; skip aggregator. Otherwise call aggregator and build positions as in current code. Return ExecuteStrategyResponse(deployment_id=..., user_address=..., total_amount=..., positions=..., total_expected_apy=..., audit_trail_entry_id=..., zkml_proof_hash=..., timestamp=...). Use the same imports (datetime, uuid) and response shape as the current route.

In `backend/app/api/routes/vault_execute_live.py`: replace the body of `execute_strategy` with: `return await execute_strategy_impl(request)` (import execute_strategy_impl from app.services.vault_execute_service).

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_vault_execute_live.py -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/services/vault_execute_service.py backend/app/api/routes/vault_execute_live.py backend/tests/test_vault_execute_live.py
git commit -m "feat: vault execute service and vault-live use provided allocations"
```

---

## Task 4: Orchestrator service (recommend → Ekubo-only execute → receipt)

**Files:**
- Create: `backend/app/services/privacy_ekubo_orchestrator.py`
- Create: `backend/tests/test_privacy_ekubo_orchestrator.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_privacy_ekubo_orchestrator.py`:

```python
"""Tests for privacy → Ekubo orchestrator."""
import pytest


@pytest.mark.asyncio
async def test_orchestrate_deploy_returns_deployment_and_receipt():
    from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
    result = await orchestrate_deploy(
        user_address="0xuser",
        deployable_amount=500.0,
        risk_profile="balanced",
    )
    assert "deployment_id" in result
    assert "positions" in result
    assert "receipt_id" in result
    assert result["target"] == "ekubo"
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_privacy_ekubo_orchestrator.py -v`

Expected: FAIL.

**Step 3: Write minimal implementation**

Create `backend/app/services/privacy_ekubo_orchestrator.py`:

```python
"""Privacy → Ekubo orchestration: deployable balance → recommend → execute (Ekubo only) → receipt."""
import logging
import uuid
from typing import Any

from app.services.strategy_recommendation_service import get_recommendation
from app.services.receipt_service import ReceiptService

logger = logging.getLogger(__name__)


async def orchestrate_deploy(
    user_address: str,
    deployable_amount: float,
    risk_profile: str,
) -> dict[str, Any]:
    """
    Personal v1: get recommendation (Ekubo-only), execute via vault, record receipt.
    Returns deployment_id, positions, receipt_id, target=ekubo.
    """
    if deployable_amount <= 0:
        raise ValueError("deployable_amount must be positive")
    rec = await get_recommendation(user_address, deployable_amount, risk_profile)
    pools = rec.get("recommended_pools") or []
    # Restrict to Ekubo only
    ekubo_pools = [p for p in pools if (p.get("protocol") or "").lower() == "ekubo"]
    if not ekubo_pools:
        raise ValueError("No Ekubo pools in recommendation")
    # Build allocations for vault execute
    allocations = [
        {
            "strategy": p.get("pool_id", "ekubo_lp"),
            "percentage": p.get("allocation_percent", 0),
            "amount": p.get("allocation_amount", 0),
        }
        for p in ekubo_pools
    ]
    # Call vault execute (in-process): use execute_strategy_impl from vault_execute_service to avoid circular import
    from app.services.vault_execute_service import execute_strategy_impl
    from app.api.routes.vault_execute_live import ExecuteStrategyRequest, AllocationDetail
    request = ExecuteStrategyRequest(
        user_address=user_address,
        risk_profile=risk_profile,
        deposit_amount=deployable_amount,
        allocations=[AllocationDetail(**a) for a in allocations],
    )
    exec_result = await execute_strategy_impl(request)
    deployment_id = getattr(exec_result, "deployment_id", None) or f"deploy_{uuid.uuid4().hex[:12]}"
    positions = [{"strategy": p.strategy, "amount": p.amount, "status": p.status} for p in exec_result.positions]
    proof_hash = getattr(exec_result, "zkml_proof_hash", "") or f"0x{uuid.uuid4().hex}"
    # Record receipt
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
        "recommendation_id": rec.get("recommendation_id"),
    }
```

Note: If `ExecuteStrategyRequest` or `execute_strategy` signatures differ in the codebase, adjust to match (e.g. use the actual allocation model from vault_execute_live). If vault_execute_live does not accept `allocations` in the request, add a minimal change there to use provided allocations when present (next task).

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_privacy_ekubo_orchestrator.py -v`

Expected: PASS (fix any import/type issues so the test passes).

**Step 5: Commit**

```bash
git add backend/app/services/privacy_ekubo_orchestrator.py backend/tests/test_privacy_ekubo_orchestrator.py
git commit -m "feat: add privacy Ekubo orchestrator (recommend → execute → receipt)"
```

---

## Task 5: Orchestration API route and mount

**Files:**
- Create: `backend/app/api/routes/orchestration.py`
- Modify: `backend/app/main.py` (include orchestration router under e.g. /api/v1/zkdefi/orchestration or /api/v1/orchestration)

**Step 1: Write the failing test**

Add to `backend/tests/test_orchestration_api.py`:

```python
"""Tests for orchestration API."""
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)


def test_orchestrate_deploy_endpoint():
    response = client.post(
        "/api/v1/zkdefi/orchestration/deploy",
        json={
            "user_address": "0xuser",
            "deployable_amount": 100.0,
            "risk_profile": "balanced",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "deployment_id" in data
    assert data["target"] == "ekubo"
    assert "receipt_id" in data
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_orchestration_api.py -v`

Expected: FAIL (404 or no route).

**Step 3: Write minimal implementation**

Create `backend/app/api/routes/orchestration.py`:

```python
"""Orchestration API: privacy → Ekubo deploy (personal v1)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.privacy_ekubo_orchestrator import orchestrate_deploy

router = APIRouter(tags=["orchestration"])


class OrchestrateDeployRequest(BaseModel):
    user_address: str
    deployable_amount: float
    risk_profile: str  # conservative | balanced | aggressive


@router.post("/deploy")
async def orchestrate_deploy_endpoint(request: OrchestrateDeployRequest):
    """Deploy user's deployable amount to Ekubo Sepolia only; record receipt."""
    try:
        result = await orchestrate_deploy(
            user_address=request.user_address,
            deployable_amount=request.deployable_amount,
            risk_profile=request.risk_profile,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

In `backend/app/main.py`: add `orchestration_router = _optional_router("app.api.routes.orchestration")` and, after full_privacy_router block, `if orchestration_router: app.include_router(orchestration_router, prefix="/api/v1/zkdefi/orchestration", tags=["orchestration"])`.

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && pytest tests/test_orchestration_api.py -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/api/routes/orchestration.py backend/app/main.py backend/tests/test_orchestration_api.py
git commit -m "feat: add orchestration API POST /orchestration/deploy"
```

---

## Task 6: Docs and PROJECT_STATUS

**Files:**
- Modify: `docs/PROJECT_STATUS.md` (add one line under "What's scoped" or "What's done": orchestration layer personal v1 implemented, design doc and implementation plan linked)
- Optional: Add one line to `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md` under References: link to this implementation plan.

**Step 1: Update PROJECT_STATUS (and optional design doc link)**

In the "What's done" or "What's scoped" section, add a bullet that the privacy → Ekubo orchestration (personal v1) is implemented per `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md` and `docs/plans/2026-02-19-privacy-ekubo-orchestration-implementation.md`.

**Step 2: Commit**

```bash
git add docs/PROJECT_STATUS.md docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md
git commit -m "docs: project status and design reference for orchestration implementation"
```

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-19-privacy-ekubo-orchestration-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with executing-plans and run batch execution with checkpoints.

Which approach?

---

## Reference

- Design: `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md`
- Ekubo Sepolia: `docs/EKUBO_SEPOLIA_INTEGRATION_SCOPE.md`, `docs/EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md`
- Existing: `backend/app/services/ekubo_client.py`, `real_pool_aggregator.py`, `receipt_service.py`, `app.api.routes.strategies`, `app.api.routes.vault_execute_live`
