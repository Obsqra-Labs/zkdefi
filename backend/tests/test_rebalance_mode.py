"""
Tests for Phase 2: rebalance_mode in vault policy + GET/PUT endpoints.

Covers:
- Default rebalance_mode is "user"
- PUT to "oracle" succeeds
- PUT back to "user" succeeds
- Invalid value → 422
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.mission_control import router
from app.services.vault_policy_service import VaultPolicyService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def policy_file(tmp_path: Path):
    """Create a temp JSON file for vault policies."""
    pf = tmp_path / "vault_policies.json"
    pf.write_text("{}", encoding="utf-8")
    return pf


@pytest.fixture()
def policy_service(policy_file: Path):
    """Create a VaultPolicyService backed by the temp file."""
    svc = VaultPolicyService.__new__(VaultPolicyService)
    # Patch module-level file paths
    with patch("app.services.vault_policy_service.POLICY_FILE", policy_file):
        yield svc


@pytest.fixture()
def app(policy_service) -> FastAPI:
    _app = FastAPI()
    _app.include_router(router, prefix="/api/v1/zkdefi/mc")
    return _app


@pytest.fixture()
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


WALLET = "0xabc123"
WALLET_HEADER = {"X-Wallet-Address": WALLET}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRebalanceModeAPI:
    def test_default_is_user(self, client: TestClient, policy_service):
        """GET should return 'user' as default rebalance_mode."""
        resp = client.get(f"/api/v1/zkdefi/mc/rebalance-mode/{WALLET}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["rebalance_mode"] == "user"

    def test_set_oracle(self, client: TestClient, policy_service):
        """PUT rebalance_mode to oracle should succeed."""
        resp = client.put(
            f"/api/v1/zkdefi/mc/rebalance-mode/{WALLET}",
            json={"rebalance_mode": "oracle"},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 200
        assert resp.json()["rebalance_mode"] == "oracle"
        assert resp.json()["updated"] is True

        # Verify via GET
        get_resp = client.get(f"/api/v1/zkdefi/mc/rebalance-mode/{WALLET}")
        assert get_resp.json()["rebalance_mode"] == "oracle"

    def test_set_back_to_user(self, client: TestClient, policy_service):
        """Toggle oracle → user should work."""
        client.put(
            f"/api/v1/zkdefi/mc/rebalance-mode/{WALLET}",
            json={"rebalance_mode": "oracle"},
            headers=WALLET_HEADER,
        )
        resp = client.put(
            f"/api/v1/zkdefi/mc/rebalance-mode/{WALLET}",
            json={"rebalance_mode": "user"},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 200
        assert resp.json()["rebalance_mode"] == "user"

    def test_invalid_mode_422(self, client: TestClient, policy_service):
        """Invalid rebalance_mode should return 422."""
        resp = client.put(
            f"/api/v1/zkdefi/mc/rebalance-mode/{WALLET}",
            json={"rebalance_mode": "auto"},
            headers=WALLET_HEADER,
        )
        assert resp.status_code == 422
