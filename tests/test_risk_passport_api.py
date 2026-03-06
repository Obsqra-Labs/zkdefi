#!/usr/bin/env python3
"""
Risk Passport API smoke tests.

Uses FastAPI TestClient so no live server is required.
Run from repo root: python tests/test_risk_passport_api.py
Or: cd backend && python -m pytest ../tests/test_risk_passport_api.py -v
"""
import sys
from pathlib import Path

# Ensure backend app is importable
backend = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend))

from fastapi.testclient import TestClient
from eth_account import Account
from eth_account.messages import encode_defunct

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/v1/zkdefi/status")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data or "merkle_root" in data


def test_user_passport_returns_200():
    r = client.get("/api/v1/zkdefi/risk_passport/user/0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7")
    assert r.status_code == 200
    data = r.json()
    assert "composite_score" in data
    assert "letter_rating" in data
    assert "tier" in data
    assert "proof_receipts" in data
    assert "aggregation_sources" in data
    assert "chain_id" in data
    assert data["letter_rating"] in ("A", "B", "C", "D")
    assert 0 <= data["composite_score"] <= 100
    assert isinstance(data["aggregation_sources"], list)
    assert len(data["aggregation_sources"]) >= 1


def test_pool_passport_no_data_returns_200():
    r = client.get("/api/v1/zkdefi/risk_passport/pool/pool_1")
    assert r.status_code == 200
    data = r.json()
    assert data["pool_id"] == "pool_1"
    assert "safe" in data
    assert "passport" in data or "message" in data


def test_oracle_market_data_has_snapshot_hash():
    r = client.get("/api/v1/zkdefi/oracle/market-data")
    assert r.status_code == 200
    data = r.json()
    assert "snapshot_hash" in data
    assert data["snapshot_hash"] is None or (isinstance(data["snapshot_hash"], str) and data["snapshot_hash"].startswith("0x"))


def test_linked_addresses_get_put():
    addr = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    r = client.get(f"/api/v1/zkdefi/linked_addresses/{addr}")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    unverified = client.put(
        "/api/v1/zkdefi/linked_addresses",
        json={"starknet_address": addr, "eth": "0x0000000000000000000000000000000000000001"},
    )
    assert unverified.status_code == 403

    test_key = "0x59c6995e998f97a5a0044966f0945382d7c8f6f8f4ddfbd2dcef7d2d7c5ed6d5"
    test_addr = Account.from_key(test_key).address

    start = client.post(
        "/api/v1/zkdefi/linked_addresses/verify/start",
        json={"starknet_address": addr, "chain": "ethereum", "address": test_addr},
    )
    assert start.status_code == 200
    start_payload = start.json()
    challenge = start_payload.get("challenge")
    nonce_id = start_payload.get("nonce_id")
    assert isinstance(challenge, str) and challenge
    assert isinstance(nonce_id, str) and nonce_id

    signature = Account.sign_message(encode_defunct(text=challenge), private_key=test_key).signature.hex()
    complete = client.post(
        "/api/v1/zkdefi/linked_addresses/verify/complete",
        json={
            "starknet_address": addr,
            "chain": "ethereum",
            "address": test_addr,
            "nonce_id": nonce_id,
            "signature": signature,
        },
    )
    assert complete.status_code == 200
    complete_payload = complete.json()
    assert complete_payload.get("verified") is True

    r2 = client.put(
        "/api/v1/zkdefi/linked_addresses",
        json={"starknet_address": addr, "eth": test_addr},
    )
    assert r2.status_code == 200
    out = r2.json()
    assert str(out.get("eth", "")).lower() == test_addr.lower()
    assert isinstance(out.get("verification"), dict)
    assert out["verification"].get("eth", {}).get("verified") is True
    # Clear for next run
    client.put("/api/v1/zkdefi/linked_addresses", json={"starknet_address": addr, "eth": ""})


def test_risk_profile_v2_and_passport_v2():
    addr = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    p = client.get(f"/api/v1/zkdefi/risk_profile/v2/{addr}")
    assert p.status_code == 200
    profile = p.json()
    assert profile.get("profile_version") == "2.0"
    assert "identity" in profile and "reputation" in profile and "passport" in profile
    assert "decisions" in profile
    assert "dual_wallet_session" in profile["identity"]
    assert isinstance(profile["identity"]["dual_wallet_session"], dict)
    assert "active" in profile["identity"]["dual_wallet_session"]
    assert "relayer" in profile["decisions"]
    assert "execution" in profile["decisions"]
    assert "lending" in profile["decisions"]

    pass_v2 = client.get(f"/api/v1/zkdefi/risk_passport/v2/user/{addr}")
    assert pass_v2.status_code == 200
    payload = pass_v2.json()
    assert payload.get("profile_version") == "2.0"
    assert "lending_context" in payload
    assert "receipt_summary" in payload

    active = client.get(f"/api/v1/zkdefi/risk_passport/v2/user/{addr}/attestation/active")
    assert active.status_code == 200
    active_payload = active.json()
    assert "found" in active_payload

    first_issue = client.post(f"/api/v1/zkdefi/risk_passport/v2/user/{addr}/attestation/issue")
    assert first_issue.status_code == 200
    first_payload = first_issue.json()
    assert "issued_new" in first_payload
    assert "attestation" in first_payload

    second_issue = client.post(f"/api/v1/zkdefi/risk_passport/v2/user/{addr}/attestation/issue")
    assert second_issue.status_code == 200
    second_payload = second_issue.json()
    assert second_payload.get("issued_new") is False

    force_issue = client.post(f"/api/v1/zkdefi/risk_passport/v2/user/{addr}/attestation/issue?force=true")
    assert force_issue.status_code == 200
    force_payload = force_issue.json()
    assert force_payload.get("force") is True
    assert "attestation" in force_payload


if __name__ == "__main__":
    test_health()
    print("health ok")
    test_user_passport_returns_200()
    print("user passport ok")
    test_pool_passport_no_data_returns_200()
    print("pool passport ok")
    test_oracle_market_data_has_snapshot_hash()
    print("oracle snapshot_hash ok")
    test_linked_addresses_get_put()
    print("linked_addresses ok")
    print("All Risk Passport API smoke tests passed.")
