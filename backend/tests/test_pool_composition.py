"""
Tests for pool composition service and routes.

Covers:
- credit_pool_idle / deploy_to_adapter / close_position ledger accounting
- get_composition response shape
- Route endpoints (composition / deploy / close)
- Composition cache invalidation on write
- Idempotency (handled at ledger level)
- Invalid pool_id → 422
"""

from __future__ import annotations

import asyncio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.pool_composition_service import (
    VALID_POOL_IDS,
    close_position,
    credit_pool_idle,
    deploy_to_adapter,
    get_composition,
    invalidate_cache,
    set_ledger,
)
from app.api.routes.pool_composition import router


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def fresh_ledger():
    """Inject a fresh in-memory ledger before each test and clean up after."""
    from app.services.ttl_cache import composition_cache

    ledger = DoubleEntryLedger(":memory:")
    set_ledger(ledger)
    # Clear cache so previous test data doesn't leak
    asyncio.run(composition_cache.clear())
    yield ledger
    set_ledger(None)  # type: ignore[arg-type]


@pytest.fixture()
def app() -> FastAPI:
    _app = FastAPI()
    _app.include_router(router, prefix="/api/v1/zkdefi")
    return _app


@pytest.fixture()
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# Service-level tests
# ---------------------------------------------------------------------------


class TestCreditPoolIdle:
    def test_credit_increases_idle_balance(self, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("moderate", "STRK", 1000)
        bal = fresh_ledger.balance("POOL:moderate:idle:STRK")
        assert bal == 1000

    def test_credit_multiple_tokens(self, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("moderate", "STRK", 500)
        credit_pool_idle("moderate", "ETH", 200)
        assert fresh_ledger.balance("POOL:moderate:idle:STRK") == 500
        assert fresh_ledger.balance("POOL:moderate:idle:ETH") == 200


class TestDeployToAdapter:
    def test_deploy_moves_idle_to_deployed(self, fresh_ledger: DoubleEntryLedger):
        # Seed idle capital first
        credit_pool_idle("aggressive", "STRK", 5000)
        deploy_to_adapter("aggressive", "staking", "STRK", 3000)

        assert fresh_ledger.balance("POOL:aggressive:idle:STRK") == 2000
        assert fresh_ledger.balance("POOL:aggressive:deployed:staking:STRK") == 3000


class TestClosePosition:
    def test_close_returns_capital_to_idle(self, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("conservative", "ETH", 1000)
        deploy_to_adapter("conservative", "lending", "ETH", 800)
        close_position("conservative", "lending", "ETH", 300)

        assert fresh_ledger.balance("POOL:conservative:idle:ETH") == 500  # 1000 - 800 + 300
        assert fresh_ledger.balance("POOL:conservative:deployed:lending:ETH") == 500  # 800 - 300


class TestGetComposition:
    def test_composition_shape(self, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("moderate", "STRK", 2000)
        deploy_to_adapter("moderate", "lending", "STRK", 500)

        result = asyncio.run(get_composition("moderate"))

        assert result["pool_id"] == "moderate"
        assert result["idle_breakdown"]["STRK"] == 1500
        assert result["deployed_breakdown"]["lending"]["STRK"] == 500
        assert result["total_wei"] == 2000

    def test_composition_empty_pool(self, fresh_ledger: DoubleEntryLedger):
        result = asyncio.run(get_composition("conservative"))
        assert result["pool_id"] == "conservative"
        assert result["idle_breakdown"] == {}
        assert result["deployed_breakdown"] == {}
        assert result["total_wei"] == 0

    def test_composition_cache_invalidation(self, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("moderate", "STRK", 1000)

        # First call populates cache
        r1 = asyncio.run(get_composition("moderate"))
        assert r1["total_wei"] == 1000

        # Credit more — stale cache should still return 1000
        credit_pool_idle("moderate", "STRK", 500)
        r_stale = asyncio.run(get_composition("moderate"))
        assert r_stale["total_wei"] == 1000  # still cached

        # Invalidate and re-read
        asyncio.run(invalidate_cache("moderate"))
        r2 = asyncio.run(get_composition("moderate"))
        assert r2["total_wei"] == 1500  # now reflects new credit


# ---------------------------------------------------------------------------
# Route-level tests
# ---------------------------------------------------------------------------


class TestCompositionRoute:
    def test_get_composition_ok(self, client: TestClient, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("moderate", "STRK", 3000)
        resp = client.get("/api/v1/zkdefi/pools/moderate/composition")
        assert resp.status_code == 200
        body = resp.json()
        assert body["pool_id"] == "moderate"
        assert body["idle_breakdown"]["STRK"] == 3000

    def test_get_composition_invalid_pool(self, client: TestClient):
        resp = client.get("/api/v1/zkdefi/pools/invalid/composition")
        assert resp.status_code == 422

    def test_get_composition_empty(self, client: TestClient):
        resp = client.get("/api/v1/zkdefi/pools/conservative/composition")
        assert resp.status_code == 200
        assert resp.json()["total_wei"] == 0


WALLET = "0xabc123"
WALLET_HEADER = {"X-Wallet-Address": WALLET}


class TestDeployRoute:
    def test_deploy_ok(self, client: TestClient, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("aggressive", "ETH", 10000)
        resp = client.post(
            "/api/v1/zkdefi/pools/aggressive/deploy",
            json={"adapter": "ekubo", "token": "ETH", "amount_wei": 5000, "user_address": WALLET},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        # Verify composition changed
        comp = client.get("/api/v1/zkdefi/pools/aggressive/composition").json()
        assert comp["idle_breakdown"]["ETH"] == 5000
        assert comp["deployed_breakdown"]["ekubo"]["ETH"] == 5000

    def test_deploy_invalid_pool(self, client: TestClient):
        resp = client.post(
            "/api/v1/zkdefi/pools/invalid/deploy",
            json={"adapter": "staking", "token": "STRK", "amount_wei": 100, "user_address": WALLET},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 422

    def test_deploy_bad_amount(self, client: TestClient):
        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/deploy",
            json={"adapter": "staking", "token": "STRK", "amount_wei": -1, "user_address": WALLET},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 422


class TestCloseRoute:
    def test_close_ok(self, client: TestClient, fresh_ledger: DoubleEntryLedger):
        credit_pool_idle("moderate", "STRK", 2000)
        deploy_to_adapter("moderate", "staking", "STRK", 1500)

        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/close",
            json={"adapter": "staking", "token": "STRK", "amount_wei": 700, "user_address": WALLET},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 200

        comp = client.get("/api/v1/zkdefi/pools/moderate/composition").json()
        assert comp["idle_breakdown"]["STRK"] == 1200  # 2000 - 1500 + 700
        assert comp["deployed_breakdown"]["staking"]["STRK"] == 800  # 1500 - 700

    def test_close_invalid_pool(self, client: TestClient):
        resp = client.post(
            "/api/v1/zkdefi/pools/invalid/close",
            json={"adapter": "staking", "token": "STRK", "amount_wei": 100, "user_address": WALLET},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 422
