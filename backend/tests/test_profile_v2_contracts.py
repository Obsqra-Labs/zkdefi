"""Contract tests for Capital OS profile/reputation v2 additions."""

from __future__ import annotations

import uuid
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

backend = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend))

from app.main import app
from app.services.session_key_service import SessionKeyService

client = TestClient(app)


def _rand_addr() -> str:
    return "0x" + uuid.uuid4().hex + uuid.uuid4().hex[:24]


def test_risk_profile_v2_includes_governance_and_trust_tuple() -> None:
    address = _rand_addr()

    response = client.get(f"/api/v1/zkdefi/risk_profile/v2/{address}")
    assert response.status_code == 200
    payload = response.json()

    assert payload.get("profile_version") == "2.0"
    assert isinstance(payload.get("governance"), dict)
    assert isinstance(payload.get("trust_tuple"), dict)

    trust_tuple = payload["trust_tuple"]
    for key in ("reputation", "credit", "governance", "execution", "identity"):
        assert key in trust_tuple


def test_profile_snapshot_and_diff_contract() -> None:
    address = _rand_addr()

    first = client.get(f"/api/v1/zkdefi/profile/snapshot/{address}")
    assert first.status_code == 200
    first_payload = first.json()
    first_snapshot_id = first_payload.get("snapshot_id")
    assert isinstance(first_snapshot_id, str) and first_snapshot_id.startswith("0x")

    # Create a deterministic profile change.
    stake = client.post(
        "/api/v1/zkdefi/reputation/stake-collateral",
        headers={"X-Wallet-Address": address},
        params={"address": address, "amount_wei": 10**17},
    )
    assert stake.status_code == 200

    second = client.get(f"/api/v1/zkdefi/profile/snapshot/{address}")
    assert second.status_code == 200
    second_payload = second.json()
    second_snapshot_id = second_payload.get("snapshot_id")
    assert isinstance(second_snapshot_id, str) and second_snapshot_id.startswith("0x")
    assert second_snapshot_id != first_snapshot_id

    diff = client.get(
        f"/api/v1/zkdefi/profile/diff/{address}",
        params={"from": first_snapshot_id, "to": second_snapshot_id},
    )
    assert diff.status_code == 200
    diff_payload = diff.json()
    assert diff_payload.get("from_snapshot_id") == first_snapshot_id
    assert diff_payload.get("to_snapshot_id") == second_snapshot_id
    assert isinstance(diff_payload.get("changed_fields"), list)
    assert isinstance(diff_payload.get("summary"), dict)
    assert diff_payload["summary"].get("changed_count", 0) >= 1


@pytest.mark.asyncio
async def test_session_key_state_persists_across_restart() -> None:
    owner = _rand_addr()
    session_key = _rand_addr()

    service = SessionKeyService()
    created = await service.generate_session_request(
        owner_address=owner,
        session_key_address=session_key,
        max_position=123,
        allowed_protocols=["pools", "ekubo"],
        duration_hours=2,
    )
    session_id = created["session_id"]

    restarted = SessionKeyService()
    assert restarted.get_session_owner(session_id) == owner

    sessions = await restarted.list_user_sessions(owner)
    assert any(s.get("session_id") == session_id for s in sessions)


@pytest.mark.asyncio
async def test_reputation_uses_verified_links_only_for_cross_chain_baseline(monkeypatch) -> None:
    address = _rand_addr()

    class _DummyVerifier:
        def filter_verified(self, _stark: str, _linked: dict[str, str]) -> dict[str, str]:
            return {}

    async def _fake_combined(_stark: str, eth: str | None, arb: str | None, base: str | None):
        # If verified addresses are missing, no cross-chain score should be counted.
        if eth or arb or base:
            return {"account_age_days": 365, "total_transactions": 99}
        return {"account_age_days": 0, "total_transactions": 0}

    monkeypatch.setattr(
        "app.services.linked_address_verification_service.get_linked_address_verification_service",
        lambda: _DummyVerifier(),
    )
    monkeypatch.setattr(
        "app.services.cross_chain_fetcher.fetch_combined_history",
        _fake_combined,
    )

    response = client.get(f"/api/v1/zkdefi/reputation/user/{address}")
    assert response.status_code == 200
    payload = response.json()

    # No verified links -> no imported cross-chain tx count.
    assert payload.get("successful_txns") == 0
    assert payload.get("transaction_count") == 0
