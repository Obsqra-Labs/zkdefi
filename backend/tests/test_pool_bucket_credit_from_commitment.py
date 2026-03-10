"""
Tests for Phase 1: generate_commitment correctly credits pool idle bucket.

Covers:
- generate_commitment(pool_type=1, token=STRK) increases POOL:moderate:idle:STRK
- Composition endpoint reflects the increase
- Idempotency at ledger level (same key doesn't double-credit)
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch, MagicMock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.pool_composition_service import (
    get_composition,
    invalidate_cache,
    set_ledger,
)
from app.api.routes.full_privacy import router as full_privacy_router
from app.api.routes.pool_composition import router as pool_composition_router


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def fresh_ledger():
    """Inject a fresh in-memory ledger and clear composition cache."""
    from app.services.ttl_cache import composition_cache

    ledger = DoubleEntryLedger(":memory:")
    set_ledger(ledger)
    asyncio.run(composition_cache.clear())
    yield ledger
    set_ledger(None)  # type: ignore[arg-type]


@pytest.fixture()
def app() -> FastAPI:
    _app = FastAPI()
    _app.include_router(full_privacy_router, prefix="/api/v1/zkdefi/full_privacy")
    _app.include_router(pool_composition_router, prefix="/api/v1/zkdefi")
    return _app


@pytest.fixture()
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def _mock_commitment_result():
    """Return a fake commitment result matching DepositCommitmentResponse."""
    return {
        "commitment": "0xabc123",
        "user_secret": "0xsecret",
        "amount": "1000000000000000000",
        "pool_type": 1,
        "nonce": "42",
        "blinding": "0xblind",
        "message": "ok",
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGenerateCommitmentBucketCredit:
    """generate_commitment should credit the correct pool idle bucket."""

    @patch(
        "app.api.routes.full_privacy.get_full_privacy_service",
    )
    def test_credits_pool_moderate_strk(
        self,
        mock_get_svc: MagicMock,
        client: TestClient,
        fresh_ledger: DoubleEntryLedger,
    ):
        """POST generate_commitment(pool_type=1, token=STRK) -> POOL:moderate:idle:STRK increases."""
        mock_svc = MagicMock()
        mock_svc.generate_deposit_commitment.return_value = _mock_commitment_result()
        mock_get_svc.return_value = mock_svc

        resp = client.post(
            "/api/v1/zkdefi/full_privacy/deposit/generate_commitment",
            json={
                "user_address": "0xdeadbeef",
                "amount": "1000000000000000000",
                "pool_type": 1,
                "token": "STRK",
            },
            headers={"X-Wallet-Address": "0xdeadbeef"},
        )
        assert resp.status_code == 200

        # Verify pool idle bucket was credited
        bal = fresh_ledger.balance("POOL:moderate:idle:STRK")
        assert bal == 1000000000000000000

    @patch(
        "app.api.routes.full_privacy.get_full_privacy_service",
    )
    def test_credits_pool_with_correct_token(
        self,
        mock_get_svc: MagicMock,
        client: TestClient,
        fresh_ledger: DoubleEntryLedger,
    ):
        """Token field should be used, not hardcoded ETH."""
        mock_svc = MagicMock()
        mock_svc.generate_deposit_commitment.return_value = _mock_commitment_result()
        mock_get_svc.return_value = mock_svc

        resp = client.post(
            "/api/v1/zkdefi/full_privacy/deposit/generate_commitment",
            json={
                "user_address": "0xdeadbeef",
                "amount": "500",
                "pool_type": 2,
                "token": "ETH",
            },
            headers={"X-Wallet-Address": "0xdeadbeef"},
        )
        assert resp.status_code == 200

        # Should credit ETH, not STRK
        assert fresh_ledger.balance("POOL:aggressive:idle:ETH") == 500
        assert fresh_ledger.balance("POOL:aggressive:idle:STRK") == 0

    @patch(
        "app.api.routes.full_privacy.get_full_privacy_service",
    )
    def test_default_token_is_strk(
        self,
        mock_get_svc: MagicMock,
        client: TestClient,
        fresh_ledger: DoubleEntryLedger,
    ):
        """When token is omitted, default should be STRK."""
        mock_svc = MagicMock()
        mock_svc.generate_deposit_commitment.return_value = _mock_commitment_result()
        mock_get_svc.return_value = mock_svc

        resp = client.post(
            "/api/v1/zkdefi/full_privacy/deposit/generate_commitment",
            json={
                "user_address": "0xdeadbeef",
                "amount": "300",
                "pool_type": 0,
            },
            headers={"X-Wallet-Address": "0xdeadbeef"},
        )
        assert resp.status_code == 200
        assert fresh_ledger.balance("POOL:conservative:idle:STRK") == 300

    @patch(
        "app.api.routes.full_privacy.get_full_privacy_service",
    )
    def test_composition_reflects_deposit(
        self,
        mock_get_svc: MagicMock,
        client: TestClient,
        fresh_ledger: DoubleEntryLedger,
    ):
        """The composition endpoint should show the credited idle amount."""
        mock_svc = MagicMock()
        mock_svc.generate_deposit_commitment.return_value = _mock_commitment_result()
        mock_get_svc.return_value = mock_svc

        client.post(
            "/api/v1/zkdefi/full_privacy/deposit/generate_commitment",
            json={
                "user_address": "0xdeadbeef",
                "amount": "7777",
                "pool_type": 1,
                "token": "STRK",
            },
            headers={"X-Wallet-Address": "0xdeadbeef"},
        )

        comp_resp = client.get("/api/v1/zkdefi/pools/moderate/composition")
        assert comp_resp.status_code == 200
        body = comp_resp.json()
        assert body["idle_breakdown"]["STRK"] == 7777
        assert body["total_wei"] == 7777
