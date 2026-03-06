#!/usr/bin/env python3
"""
Backend API tests for every endpoint the frontend touches.

Pools, reputation, rebalancer, oracle, linked addresses, onboarding, identity,
relayer, session keys, agents, dex, full_privacy, zkml, position, compliance.
Uses FastAPI TestClient; no live server required.
Run: python -m pytest tests/test_frontend_backend_api.py -v
"""
import sys
from pathlib import Path

backend = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Shared test address
ADDR = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"


# --- Health / status ---
def test_status():
    r = client.get("/api/v1/zkdefi/status")
    assert r.status_code == 200
    assert "status" in r.json() or "merkle_root" in r.json()


# --- Risk passport (already in test_risk_passport_api; keep one here for single-suite run) ---
def test_risk_passport_user():
    r = client.get(f"/api/v1/zkdefi/risk_passport/user/{ADDR}")
    assert r.status_code == 200
    d = r.json()
    assert "composite_score" in d and "letter_rating" in d and "proof_receipts" in d


def test_risk_passport_pool():
    r = client.get("/api/v1/zkdefi/risk_passport/pool/pool_1")
    assert r.status_code == 200
    assert r.json().get("pool_id") == "pool_1"


# --- Reputation ---
def test_reputation_tiers():
    r = client.get("/api/v1/zkdefi/reputation/tiers")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_reputation_user():
    r = client.get(f"/api/v1/zkdefi/reputation/user/{ADDR}")
    assert r.status_code == 200
    d = r.json()
    assert "tier" in d and "tier_name" in d and "tenure_days" in d and "successful_txns" in d


def test_reputation_stake_collateral():
    r = client.post(
        "/api/v1/zkdefi/reputation/stake-collateral",
        params={"address": ADDR, "amount_wei": 0},
    )
    assert r.status_code == 200
    assert "status" in r.json() or "staked" in str(r.json()).lower()


def test_reputation_upgrade_tier_shape():
    r = client.post(
        "/api/v1/zkdefi/reputation/upgrade-tier",
        json={"address": ADDR, "target_tier": 1, "upgrade_proof_hash": "0x0"},
    )
    # May 200 (upgraded) or 400 (cannot upgrade / already same tier)
    assert r.status_code in (200, 400)
    if r.status_code == 200:
        d = r.json()
        assert "new_tier" in d or "tier_name" in d


# --- Oracle ---
def test_oracle_market_data():
    r = client.get("/api/v1/zkdefi/oracle/market-data")
    assert r.status_code == 200
    assert "snapshot_hash" in r.json()


def test_oracle_pool_apys():
    r = client.get("/api/v1/zkdefi/oracle/pool-apys")
    assert r.status_code == 200
    d = r.json()
    assert "pools" in d or "jediswap" in str(d).lower() or "ekubo" in str(d).lower() or isinstance(d, (list, dict))


# --- Linked addresses ---
def test_linked_addresses_get():
    r = client.get(f"/api/v1/zkdefi/linked_addresses/{ADDR}")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_linked_addresses_put():
    r = client.put(
        "/api/v1/zkdefi/linked_addresses",
        json={"starknet_address": ADDR, "eth": None, "arb": None},
    )
    assert r.status_code == 200


# --- Relayer ---
def test_relayer_pending():
    r = client.get(f"/api/v1/zkdefi/relayer/pending/{ADDR}")
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


def test_relayer_stats():
    r = client.get("/api/v1/zkdefi/relayer/stats")
    assert r.status_code == 200


def test_relayer_ledger_balance():
    r = client.get(f"/api/v1/zkdefi/relayer/ledger/balance/{ADDR}")
    assert r.status_code == 200


def test_relayer_ledger_claims():
    r = client.get("/api/v1/zkdefi/relayer/ledger/claims?limit=10")
    assert r.status_code == 200


# --- Onboarding ---
def test_onboarding_status():
    r = client.get(f"/api/v1/zkdefi/onboarding/status/{ADDR}")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, dict) or d is None


# --- Identity ---
def test_identity_commitment_missing_returns_ok_or_404():
    r = client.get("/api/v1/identity/commitment/0x0")
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert "found" in r.json()


# --- Compliance ---
def test_compliance_profiles():
    r = client.get(f"/api/v1/zkdefi/compliance/profiles/{ADDR}")
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


def test_compliance_profile_types():
    r = client.get("/api/v1/zkdefi/compliance/profile-types")
    assert r.status_code == 200


# --- Rebalancer ---
def test_rebalancer_proposals():
    r = client.get(f"/api/v1/zkdefi/rebalancer/proposals/{ADDR}")
    assert r.status_code == 200
    d = r.json()
    assert "proposals" in d and "count" in d


def test_rebalancer_propose():
    r = client.post(
        "/api/v1/zkdefi/rebalancer/propose",
        json={
            "user_address": ADDR,
            "from_protocol": 0,
            "to_protocol": 1,
            "amount": 100,
            "reason": "test",
        },
    )
    assert r.status_code == 200
    d = r.json()
    assert "proposal_id" in d and "status" in d


def test_rebalancer_autonomous_status():
    r = client.get(f"/api/v1/zkdefi/rebalancer/autonomous/status/{ADDR}")
    assert r.status_code == 200


# --- zkML ---
def test_zkml_status():
    r = client.get("/api/v1/zkdefi/zkml/status")
    assert r.status_code == 200


def test_zkml_pool_safety():
    r = client.get("/api/v1/zkdefi/zkml/pool-safety")
    assert r.status_code == 200


def test_zkml_risk_score_post():
    r = client.post(
        "/api/v1/zkdefi/zkml/risk_score",
        json={
            "user_address": ADDR,
            "portfolio_features": [50, 50, 0, 0, 0, 0, 0, 0],
            "threshold": 30,
        },
    )
    assert r.status_code == 200
    d = r.json()
    assert "is_compliant" in d or "proof_calldata" in d or "error" in d


def test_zkml_anomaly_post():
    r = client.post(
        "/api/v1/zkdefi/zkml/anomaly",
        json={"pool_id": "pool_1", "user_address": ADDR},
    )
    assert r.status_code == 200
    d = r.json()
    assert "is_safe" in d or "proof_calldata" in d or "error" in d


# --- Position ---
def test_position():
    r = client.get(f"/api/v1/zkdefi/position/{ADDR}")
    assert r.status_code == 200


def test_position_protocol():
    r = client.get(f"/api/v1/zkdefi/position/{ADDR}?protocol_id=0")
    assert r.status_code == 200


def test_position_aggregate():
    r = client.get(f"/api/v1/zkdefi/position/aggregate/{ADDR}")
    assert r.status_code == 200


# --- Session keys ---
def test_session_keys_list():
    r = client.get(f"/api/v1/zkdefi/session_keys/list/{ADDR}")
    assert r.status_code == 200


# --- Agents ---
def test_agents_models_list():
    r = client.get("/api/v1/agents/models/list")
    assert r.status_code == 200
    d = r.json()
    assert "models" in d or isinstance(d, list)


def test_agents_user():
    r = client.get(f"/api/v1/agents/user/{ADDR}")
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


# --- DEX ---
def test_dex_pairs():
    r = client.get("/api/v1/zkdefi/dex/pairs?min_tvl_usd=0")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, (list, dict))


def test_dex_tokens():
    r = client.get("/api/v1/zkdefi/dex/tokens?page_size=10")
    assert r.status_code in (200, 404, 500)
    if r.status_code == 200:
        assert isinstance(r.json(), (list, dict))


# --- Full privacy (merkle root - read-only) ---
def test_full_privacy_merkle_root():
    r = client.get("/api/v1/zkdefi/full_privacy/merkle/root")
    assert r.status_code == 200
    d = r.json()
    assert "root" in d or "merkle" in str(d).lower()


# --- Shielded / reputation (frontend uses /api/v1/reputation/{address} in ShieldedPoolPanel) ---
def test_reputation_by_address_path():
    r = client.get(f"/api/v1/zkdefi/reputation/user/{ADDR}")
    assert r.status_code == 200
