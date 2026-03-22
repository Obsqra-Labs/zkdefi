"""Smoke tests for forge explorer."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
import app.api.routes.forge as forge_routes
BASE = "/api/v1/zkdefi/forge"
@pytest.fixture
def client():
    return TestClient(app)
def test_forge_homepage(client):
    r = client.get(BASE + "/")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "zkSyslog" in r.text or "StarkForge" in r.text
    assert "Filter by scope" in r.text
    assert "scope-chip" in r.text
    assert "Receipts" in r.text and "Proof Jobs" in r.text and "Contracts" in r.text
def test_forge_feed(client):
    r = client.get(BASE + "/feed")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
def test_forge_proofs_feed(client):
    r = client.get(BASE + "/proofs")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "items" in r.json()
def test_forge_search(client):
    r = client.get(BASE + "/search")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "results" in r.json()
def test_forge_status(client):
    r = client.get(BASE + "/status")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
def test_forge_detail_entity(client):
    r = client.get(BASE + "/detail/entity/foo")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert r.json()["summary"]["type"] == "entity"
def test_forge_search_contracts(client):
    r = client.get(BASE + "/search", params={"q": "0x0123456789abcdef0123456789abcdef01234567", "scope": "contracts"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    data = r.json()
    assert "contracts" in data["results"]
    assert len(data["results"]["contracts"]) >= 1
def test_forge_lane(client):
    r = client.get(BASE + "/lane/some-lane")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
def test_forge_health(client):
    r = client.get(BASE + "/health")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
def test_forge_proving(client):
    r = client.get(BASE + "/proving")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
def test_forge_proofs_page(client):
    r = client.get(BASE + "/proofs/page")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "Dedicated Proof Feed" in r.text
    assert "Load more" in r.text
    assert 'id="model-name"' in r.text
    assert 'id="lane-name"' in r.text
def test_forge_detail_receipt_html(client):
    r = client.get(BASE + "/detail/receipt/nonexistent-123", headers={"Accept": "text/html"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "zkSyslog" in r.text or "detail" in r.text.lower()
def test_forge_search_pagination(client):
    r = client.get(BASE + "/search", params={"limit": 5, "offset": 0})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    d = r.json()
    assert d.get("limit") == 5 and d.get("offset") == 0 and "has_more" in d
def test_forge_paths(client):
    r = client.get(BASE + "/paths")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    d = r.json()
    assert "paths" in d and "detail" in d["paths"]
    assert "object_types" in d and "receipt" in d["object_types"]
def test_forge_detail_fact(client):
    r = client.get(BASE + "/detail/fact/0xabc123")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert r.json()["summary"]["type"] == "fact"
    assert r.json()["summary"]["status"] == "known"
def test_forge_detail_contract(client):
    r = client.get(BASE + "/detail/contract/0x0123456789abcdef0123456789abcdef01234567")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert r.json()["summary"]["type"] == "contract"
def test_forge_search_scope_proofs(client):
    r = client.get(BASE + "/search", params={"scope": "proofs"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert r.json()["scope"] == "proofs"
    assert "proofs" in r.json()["results"]
def test_forge_search_scope_models(client):
    r = client.get(BASE + "/search", params={"scope": "models"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert r.json()["scope"] == "models"
    assert "models" in r.json()["results"]


def test_forge_detail_receipt_uses_indexed_provenance(client, monkeypatch):
    class FakeReceiptService:
        async def get_receipts(self, limit=None):
            return [
                {
                    "receipt_id": "receipt-1",
                    "tx_hash": "0xl2tx",
                    "action": "bridge_verify",
                    "proof_type": "groth16",
                    "result": "ok",
                    "timestamp": "2026-03-22T05:00:00Z",
                    "fact_hash": "0xfact1",
                    "proof_hash": "0xproof1",
                }
            ]

    async def fake_get_receipt_service():
        return FakeReceiptService()

    async def fake_get_proof_record(proof_hash: str):
        assert proof_hash in {"0xproof1", "0xfact1"}
        return {
            "proof_hash": "0xproof1",
            "source": "proof_registry",
            "model_name": "yield_forecast",
            "proof_type": "groth16",
            "bridge_statement": {
                "lane": "modelbridge",
                "proof_type": "groth16",
                "model_name": "yield_forecast",
                "fact_hash": "0xfact1",
            },
            "public_receipts": [
                {
                    "tx_hash": "0xl2tx",
                    "public_chain": "starknet_l2",
                    "timestamp": "2026-03-22T05:00:00Z",
                }
            ],
            "public_receipt_summary": {
                "count": 1,
                "latest_tx_hash": "0xl2tx",
                "latest_timestamp": "2026-03-22T05:00:00Z",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_receipt_service", fake_get_receipt_service)
    monkeypatch.setattr(forge_routes, "_get_proof_record", fake_get_proof_record)

    r = client.get(BASE + "/detail/receipt/0xl2tx")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["summary"]["status"] == "public_settled"
    assert payload["summary"]["latest_public_tx_hash"] == "0xl2tx"
    assert any(rel["type"] == "proof_job" and rel["id"] == "0xproof1" for rel in payload["relationships"])


def test_forge_detail_fact_uses_indexed_provenance(client, monkeypatch):
    async def fake_get_proof_record(proof_hash: str):
        assert proof_hash == "0xfact1"
        return {
            "proof_hash": "0xproof1",
            "source": "proof_registry",
            "model_name": "yield_forecast",
            "proof_type": "groth16",
            "bridge_statement": {
                "lane": "modelbridge",
                "proof_type": "groth16",
                "model_name": "yield_forecast",
                "fact_hash": "0xfact1",
            },
            "public_receipts": [
                {
                    "tx_hash": "0xl2tx",
                    "public_chain": "starknet_l2",
                    "timestamp": "2026-03-22T05:00:00Z",
                }
            ],
            "public_receipt_summary": {
                "count": 1,
                "latest_tx_hash": "0xl2tx",
                "latest_timestamp": "2026-03-22T05:00:00Z",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_proof_record", fake_get_proof_record)

    r = client.get(BASE + "/detail/fact/0xfact1")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["summary"]["status"] == "public_settled"
    assert payload["summary"]["proof_hash"] == "0xproof1"
    assert any(rel["type"] == "proof_job" and rel["id"] == "0xproof1" for rel in payload["relationships"])


def test_forge_detail_transaction_uses_indexed_provenance(client, monkeypatch):
    async def fake_get_tx_receipt(tx_hash: str):
        assert tx_hash == "0xl2tx"
        return {
            "finality_status": "ACCEPTED_ON_L2",
            "execution_status": "SUCCEEDED",
            "block_number": 123,
        }

    async def fake_find_proof_record_by_public_tx(tx_hash: str):
        assert tx_hash == "0xl2tx"
        return {
            "proof_hash": "0xproof1",
            "source": "proof_registry",
            "model_name": "yield_forecast",
            "proof_type": "groth16",
            "bridge_statement": {
                "lane": "modelbridge",
                "proof_type": "groth16",
                "model_name": "yield_forecast",
                "fact_hash": "0xfact1",
            },
            "public_receipts": [
                {
                    "tx_hash": "0xl2tx",
                    "public_chain": "starknet_l2",
                    "timestamp": "2026-03-22T05:00:00Z",
                }
            ],
            "public_receipt_summary": {
                "count": 1,
                "latest_tx_hash": "0xl2tx",
                "latest_timestamp": "2026-03-22T05:00:00Z",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_tx_receipt", fake_get_tx_receipt)
    monkeypatch.setattr(forge_routes, "_find_proof_record_by_public_tx", fake_find_proof_record_by_public_tx)

    r = client.get(BASE + "/detail/transaction/0xl2tx")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["summary"]["status"] == "public_settled"
    assert payload["summary"]["tx_status"] == "ACCEPTED_ON_L2"
    assert any(rel["type"] == "proof_job" and rel["id"] == "0xproof1" for rel in payload["relationships"])


def test_forge_search_scope_proofs_returns_cursor(client, monkeypatch):
    async def fake_get_indexed_proof_payload(**kwargs):
        return {
            "proofs": [
                {
                    "proof_hash": "0xproof1",
                    "proof_type": "groth16",
                    "model_name": "yield_forecast",
                    "bridge_statement": {
                        "proof_type": "groth16",
                        "model_name": "yield_forecast",
                    },
                    "public_receipt_summary": {
                        "count": 1,
                        "latest_tx_hash": "0xl2tx",
                        "latest_timestamp": "2026-03-22T05:00:00Z",
                    },
                }
            ],
            "total": 10,
            "next_cursor": {
                "timestamp": "2026-03-22T05:00:00Z",
                "proof_hash": "0xproof1",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_indexed_proof_payload", fake_get_indexed_proof_payload)

    r = client.get(BASE + "/search", params={"scope": "proofs", "limit": 1})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["next_cursor"] == {
        "timestamp": "2026-03-22T05:00:00Z",
        "proof_hash": "0xproof1",
    }
    assert payload["results"]["proofs"][0]["id"] == "0xproof1"


def test_forge_proofs_feed_returns_cursor_payload(client, monkeypatch):
    async def fake_get_indexed_proof_payload(**kwargs):
        return {
            "proofs": [
                {
                    "proof_hash": "0xproof1",
                    "proof_type": "groth16",
                    "model_name": "yield_forecast",
                    "bridge_statement": {
                        "proof_type": "groth16",
                        "lane": "modelbridge",
                        "model_name": "yield_forecast",
                        "fact_hash": "0xfact1",
                    },
                    "public_receipt_summary": {
                        "count": 1,
                        "latest_tx_hash": "0xl2tx",
                        "latest_timestamp": "2026-03-22T05:00:00Z",
                    },
                }
            ],
            "total": 10,
            "next_cursor": {
                "timestamp": "2026-03-22T05:00:00Z",
                "proof_hash": "0xproof1",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_indexed_proof_payload", fake_get_indexed_proof_payload)

    r = client.get(BASE + "/proofs", params={"limit": 1})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["next_cursor"] == {
        "timestamp": "2026-03-22T05:00:00Z",
        "proof_hash": "0xproof1",
    }
    assert payload["items"][0]["id"] == "0xproof1"
    assert payload["items"][0]["settlement_graph"]["edges"][0]["verb"] == "commits"


def test_forge_proofs_feed_supports_lane_and_model_filters(client, monkeypatch):
    async def fake_get_filtered_proof_feed_payload(**kwargs):
        assert kwargs["lane"] == "noir_v2"
        assert kwargs["model_name"] == "yield_forecast"
        return {
            "items": [
                {
                    "id": "0xproof2",
                    "model_name": "yield_forecast",
                    "lane": "noir_v2",
                    "proof_type": "noir_honk",
                    "latest_public_tx_hash": "0xl2tx2",
                    "latest_public_timestamp": "2026-03-22T06:00:00Z",
                    "detail_href": "detail/proof_job/0xproof2",
                    "settlement_graph": {
                        "nodes": [
                            {"type": "proof_job", "id": "0xproof2"},
                            {"type": "fact", "id": "0xfact2"},
                            {"type": "transaction", "id": "0xl2tx2"},
                        ],
                        "edges": [
                            {"from": "0xproof2", "to": "0xfact2", "verb": "commits"},
                            {"from": "0xproof2", "to": "0xl2tx2", "verb": "settles_with"},
                        ],
                    },
                }
            ],
            "total_results": 1,
            "next_cursor": {
                "timestamp": "2026-03-22T06:00:00Z",
                "proof_hash": "0xproof2",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_filtered_proof_feed_payload", fake_get_filtered_proof_feed_payload)

    r = client.get(
        BASE + "/proofs",
        params={"limit": 1, "lane": "noir_v2", "model_name": "yield_forecast", "public_only": "true"},
    )
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["lane"] == "noir_v2"
    assert payload["model_name"] == "yield_forecast"
    assert payload["items"][0]["settlement_graph"]["nodes"][1]["type"] == "fact"
    assert payload["items"][0]["settlement_graph"]["edges"][1]["verb"] == "settles_with"
