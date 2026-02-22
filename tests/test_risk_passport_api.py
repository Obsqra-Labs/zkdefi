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
    assert data["letter_rating"] in ("A", "B", "C", "D")
    assert 0 <= data["composite_score"] <= 100


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
    r2 = client.put(
        "/api/v1/zkdefi/linked_addresses",
        json={"starknet_address": addr, "eth": "0x0000000000000000000000000000000000000001"},
    )
    assert r2.status_code == 200
    out = r2.json()
    assert out.get("eth") == "0x0000000000000000000000000000000000000001"
    # Clear for next run
    client.put("/api/v1/zkdefi/linked_addresses", json={"starknet_address": addr, "eth": None})


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
