"""
Integration tests for pools-rebalance-intent feature.

Covers the full rebalance mode enforcement matrix:
- mode=user: owner deploy allowed, operator denied
- mode=oracle: operator deploy with zkML pass allowed, user denied
- Deposit flow credits correct pool/token idle bucket
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.pool_composition_service import (
    credit_pool_idle,
    set_ledger,
)
from app.api.routes.pool_composition import router as pool_router
from app.api.routes.mission_control import router as mc_router


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

OWNER = "0xowner123"
OPERATOR_KEY = "test-admin-key"


@pytest.fixture(autouse=True)
def fresh_ledger(tmp_path: Path):
    """Fresh in-memory ledger + clear caches."""
    from app.services.ttl_cache import composition_cache

    ledger = DoubleEntryLedger(":memory:")
    set_ledger(ledger)
    asyncio.run(composition_cache.clear())
    yield ledger
    set_ledger(None)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def temp_policy_file(tmp_path: Path):
    """Use a temp policy file so tests don't pollute real data."""
    pf = tmp_path / "vault_policies.json"
    pf.write_text("{}", encoding="utf-8")
    with patch("app.services.vault_policy_service.POLICY_FILE", pf):
        yield pf


@pytest.fixture(autouse=True)
def admin_key_env():
    """Set ADMIN_API_KEY for oracle-mode tests."""
    with patch("app.middleware.auth.ADMIN_API_KEY", OPERATOR_KEY):
        with patch("app.api.routes.pool_composition.ADMIN_API_KEY", OPERATOR_KEY, create=True):
            yield


@pytest.fixture()
def app() -> FastAPI:
    _app = FastAPI()
    _app.include_router(pool_router, prefix="/api/v1/zkdefi")
    _app.include_router(mc_router, prefix="/api/v1/zkdefi/mc")
    return _app


@pytest.fixture()
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def _set_mode(client: TestClient, mode: str) -> None:
    """Helper to set rebalance mode for OWNER."""
    resp = client.put(
        f"/api/v1/zkdefi/mc/rebalance-mode/{OWNER}",
        json={"rebalance_mode": mode},
        headers={"X-Wallet-Address": OWNER},
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Deposit flow credits correct bucket
# ---------------------------------------------------------------------------


class TestDepositBucketCredit:
    def test_credit_pool_idle_tracks_in_composition(
        self, client: TestClient, fresh_ledger: DoubleEntryLedger
    ):
        """Service-level credit_pool_idle is reflected in GET composition."""
        credit_pool_idle("moderate", "STRK", 5000)
        resp = client.get("/api/v1/zkdefi/pools/moderate/composition")
        assert resp.status_code == 200
        body = resp.json()
        assert body["idle_breakdown"]["STRK"] == 5000
        assert body["total_wei"] == 5000


# ---------------------------------------------------------------------------
# Rebalance mode enforcement matrix
# ---------------------------------------------------------------------------


class TestRebalanceModeEnforcement:
    """Full matrix of mode × caller role × expected outcome."""

    # --- mode=user ---

    def test_user_mode_owner_deploy_allowed(self, client: TestClient, fresh_ledger):
        """mode=user, wallet owner → deploy succeeds."""
        _set_mode(client, "user")
        credit_pool_idle("moderate", "STRK", 1000)

        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/deploy",
            json={
                "adapter": "staking",
                "token": "STRK",
                "amount_wei": 500,
                "user_address": OWNER,
            },
            headers={"X-Wallet-Address": OWNER},
        )
        assert resp.status_code == 200

    def test_user_mode_operator_deploy_denied(self, client: TestClient, fresh_ledger):
        """mode=user, operator (different address) → 403."""
        _set_mode(client, "user")
        credit_pool_idle("moderate", "STRK", 1000)

        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/deploy",
            json={
                "adapter": "staking",
                "token": "STRK",
                "amount_wei": 500,
                "user_address": OWNER,
            },
            headers={"X-Wallet-Address": "0xdifferent_operator"},
        )
        assert resp.status_code == 403

    def test_user_mode_no_wallet_header_401(self, client: TestClient, fresh_ledger):
        """mode=user, missing X-Wallet-Address → 401."""
        _set_mode(client, "user")
        credit_pool_idle("moderate", "STRK", 1000)

        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/deploy",
            json={
                "adapter": "staking",
                "token": "STRK",
                "amount_wei": 500,
                "user_address": OWNER,
            },
        )
        assert resp.status_code == 401

    # --- mode=oracle ---

    @patch("app.api.routes.pool_composition.policy_check", create=True)
    def test_oracle_mode_operator_deploy_allowed(
        self, mock_policy: MagicMock, client: TestClient, fresh_ledger
    ):
        """mode=oracle, admin key + zkML pass → deploy succeeds."""
        _set_mode(client, "oracle")
        credit_pool_idle("aggressive", "ETH", 2000)

        # Mock the policy_check to return allowed
        mock_check = AsyncMock(return_value={"allowed": True, "reason": "ok"})
        with patch(
            "app.services.policy_engine.check",
            mock_check,
        ):
            resp = client.post(
                "/api/v1/zkdefi/pools/aggressive/deploy",
                json={
                    "adapter": "ekubo",
                    "token": "ETH",
                    "amount_wei": 1000,
                    "user_address": OWNER,
                },
                headers={"X-Admin-Key": OPERATOR_KEY},
            )
        assert resp.status_code == 200

    def test_oracle_mode_user_deploy_denied(self, client: TestClient, fresh_ledger):
        """mode=oracle, wallet owner (no admin key) → 403."""
        _set_mode(client, "oracle")
        credit_pool_idle("aggressive", "ETH", 2000)

        resp = client.post(
            "/api/v1/zkdefi/pools/aggressive/deploy",
            json={
                "adapter": "ekubo",
                "token": "ETH",
                "amount_wei": 1000,
                "user_address": OWNER,
            },
            headers={"X-Wallet-Address": OWNER},
        )
        assert resp.status_code == 403

    def test_oracle_mode_bad_admin_key_denied(self, client: TestClient, fresh_ledger):
        """mode=oracle, bad admin key → 403."""
        _set_mode(client, "oracle")
        credit_pool_idle("aggressive", "ETH", 2000)

        resp = client.post(
            "/api/v1/zkdefi/pools/aggressive/deploy",
            json={
                "adapter": "ekubo",
                "token": "ETH",
                "amount_wei": 1000,
                "user_address": OWNER,
            },
            headers={"X-Admin-Key": "wrong-key"},
        )
        assert resp.status_code == 403

    # --- close uses same enforcement ---

    def test_user_mode_close_allowed(self, client: TestClient, fresh_ledger):
        """mode=user, owner close → succeeds."""
        _set_mode(client, "user")
        credit_pool_idle("moderate", "STRK", 2000)
        from app.services.pool_composition_service import deploy_to_adapter
        deploy_to_adapter("moderate", "staking", "STRK", 1500)

        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/close",
            json={
                "adapter": "staking",
                "token": "STRK",
                "amount_wei": 500,
                "user_address": OWNER,
            },
            headers={"X-Wallet-Address": OWNER},
        )
        assert resp.status_code == 200

    def test_user_mode_close_denied_for_operator(self, client: TestClient, fresh_ledger):
        """mode=user, operator close → 403."""
        _set_mode(client, "user")
        credit_pool_idle("moderate", "STRK", 2000)
        from app.services.pool_composition_service import deploy_to_adapter
        deploy_to_adapter("moderate", "staking", "STRK", 1500)

        resp = client.post(
            "/api/v1/zkdefi/pools/moderate/close",
            json={
                "adapter": "staking",
                "token": "STRK",
                "amount_wei": 500,
                "user_address": OWNER,
            },
            headers={"X-Wallet-Address": "0xdifferent"},
        )
        assert resp.status_code == 403
