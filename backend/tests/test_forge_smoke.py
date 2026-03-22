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
def test_forge_facts_feed(client):
    r = client.get(BASE + "/facts")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "items" in r.json()
def test_forge_models_feed(client):
    r = client.get(BASE + "/models")
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
def test_forge_facts_page(client):
    r = client.get(BASE + "/facts/page")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "Dedicated Fact Feed" in r.text
    assert 'id="fact-query"' in r.text
    assert 'id="model-name"' in r.text
    assert 'id="lane-name"' in r.text
def test_forge_models_page(client):
    r = client.get(BASE + "/models/page")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "Dedicated Model Feed" in r.text
    assert 'id="model-query"' in r.text
    assert 'id="lane-name"' in r.text
def test_forge_detail_receipt_html(client):
    r = client.get(BASE + "/detail/receipt/nonexistent-123", headers={"Accept": "text/html"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "zkSyslog" in r.text or "detail" in r.text.lower()


def test_forge_detail_fact_html_uses_sibling_detail_links(client, monkeypatch):
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
                "binding_profile": {
                    "statement_version": "obsqra_bridge_statement_v1",
                    "binds_ezkl_proof_hash": True,
                    "binds_model_hash": True,
                    "binds_output_bounds": True,
                    "binds_output_commitment": True,
                    "binds_output_vector": True,
                    "binds_timestamp": True,
                },
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

    r = client.get(BASE + "/detail/fact/0xfact1", headers={"Accept": "text/html"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    assert "../proof_job/0xproof1" in r.text
    assert "../transaction/0xl2tx" in r.text
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
    assert "facts" in d["paths"] and "models" in d["paths"] and "graph" in d["paths"]
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


def test_forge_detail_model_uses_aggregated_bridge_state(client, monkeypatch):
    async def fake_get_model_info(model_id: str):
        assert model_id == "yield_forecast"
        return {
            "name": "yield_forecast",
            "ready": True,
            "accuracy": 0.99,
            "proving_key": True,
            "verification_key": True,
        }

    async def fake_get_model_row(model_id: str, *, public_only: bool = False, lane=None):
        assert model_id == "yield_forecast"
        return {
            "id": "yield_forecast",
            "proof_count": 4,
            "public_proof_count": 2,
            "lane_counts": {"modelbridge": 2, "noir_v2": 2},
            "binding_profiles": ["full / obsqra_bridge_statement_v1"],
            "latest_proof_hash": "0xproof_activity",
            "latest_lane": "noir_v2",
            "latest_binding_profile": {
                "statement_version": "obsqra_bridge_statement_v1",
                "binds_ezkl_proof_hash": True,
                "binds_model_hash": True,
                "binds_output_bounds": True,
                "binds_output_commitment": True,
                "binds_output_vector": True,
                "binds_timestamp": True,
            },
            "latest_activity_timestamp": "2026-03-22T07:00:00Z",
            "latest_public_proof_hash": "0xproof_public",
            "latest_public_lane": "modelbridge",
            "latest_public_binding_profile": {
                "statement_version": "obsqra_bridge_statement_v1",
                "binds_ezkl_proof_hash": True,
                "binds_model_hash": True,
                "binds_output_bounds": True,
                "binds_output_commitment": True,
                "binds_output_vector": True,
                "binds_timestamp": True,
            },
            "latest_public_tx_hash": "0xl2tx-model",
            "latest_public_timestamp": "2026-03-22T06:05:00Z",
        }

    async def fake_graph_neighborhood_for_model(model_name: str, *, limit: int = 3, public_only: bool = False):
        assert model_name == "yield_forecast"
        return {
            "center": {"type": "model", "id": "yield_forecast"},
            "nodes": [
                {"type": "model", "id": "yield_forecast", "href": "detail/model/yield_forecast"},
                {"type": "proof_job", "id": "0xproof_public", "href": "detail/proof_job/0xproof_public"},
                {"type": "transaction", "id": "0xl2tx-model", "href": "detail/transaction/0xl2tx-model"},
            ],
            "edges": [
                {"from": "0xproof_public", "to": "yield_forecast", "verb": "uses"},
                {"from": "0xproof_public", "to": "0xl2tx-model", "verb": "settles_with"},
            ],
        }

    monkeypatch.setattr(forge_routes, "_get_model_info", fake_get_model_info)
    monkeypatch.setattr(forge_routes, "_get_model_row", fake_get_model_row)
    monkeypatch.setattr(forge_routes, "_graph_neighborhood_for_model", fake_graph_neighborhood_for_model)

    r = client.get(BASE + "/detail/model/yield_forecast")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["summary"]["status"] == "ready"
    assert payload["summary"]["proof_count"] == 4
    assert payload["summary"]["public_proof_count"] == 2
    assert payload["summary"]["latest_public_tx_hash"] == "0xl2tx-model"
    assert payload["summary"]["latest_binding_profile_label"] == "full / obsqra_bridge_statement_v1"
    assert any(rel["type"] == "transaction" and rel["id"] == "0xl2tx-model" for rel in payload["relationships"])
    assert (payload.get("settlement_graph") or {}).get("center", {}).get("id") == "yield_forecast"


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


def test_forge_search_scope_proofs_supports_lane_and_model_filters(client, monkeypatch):
    async def fake_get_filtered_proof_feed_payload(**kwargs):
        assert kwargs["lane"] == "noir_v2"
        assert kwargs["model_name"] == "yield_forecast"
        assert kwargs["public_only"] is True
        return {
            "items": [
                {
                    "id": "0xproof_search",
                    "proof_type": "noir_honk",
                    "lane": "noir_v2",
                    "model_name": "yield_forecast",
                    "verified": True,
                    "latest_public_tx_hash": "0xl2tx-search",
                    "latest_public_timestamp": "2026-03-22T07:00:00Z",
                    "settlement_graph": {
                        "nodes": [{"type": "proof_job", "id": "0xproof_search"}],
                        "edges": [],
                    },
                    "detail_href": "detail/proof_job/0xproof_search",
                }
            ],
            "total_results": 1,
            "next_cursor": {
                "timestamp": "2026-03-22T07:00:00Z",
                "proof_hash": "0xproof_search",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_filtered_proof_feed_payload", fake_get_filtered_proof_feed_payload)

    r = client.get(
        BASE + "/search",
        params={
            "scope": "proofs",
            "limit": 1,
            "lane": "noir_v2",
            "model_name": "yield_forecast",
            "public_only": "true",
        },
    )
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["lane"] == "noir_v2"
    assert payload["model_name"] == "yield_forecast"
    assert payload["public_only"] is True
    assert payload["results"]["proofs"][0]["settlement_graph"]["nodes"][0]["type"] == "proof_job"


def test_forge_search_scope_models_includes_settlement_graph(client, monkeypatch):
    monkeypatch.setattr(
        forge_routes,
        "_list_models_for_search",
        lambda limit=50: [
            {"id": "anomaly_detector", "name": "anomaly_detector", "ready": True},
            {"id": "yield_forecast", "name": "yield_forecast", "ready": True},
        ],
    )

    async def fake_list_proofs_for_search(limit=50):
        return [
            {
                "id": "0xproof_model",
                "lane": "noir_v2",
                "model_name": "yield_forecast",
                "latest_public_tx_hash": "0xl2tx-model",
                "settlement_graph": {
                    "nodes": [{"type": "model", "id": "yield_forecast"}],
                    "edges": [],
                },
            }
        ]

    monkeypatch.setattr(forge_routes, "_list_proofs_for_search", fake_list_proofs_for_search)

    r = client.get(BASE + "/search", params={"scope": "models"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["results"]["models"][0]["id"] == "yield_forecast"
    assert payload["results"]["models"][0]["latest_lane"] == "noir_v2"
    assert payload["results"]["models"][0]["settlement_graph"]["nodes"][0]["type"] == "model"


def test_forge_model_rows_separate_activity_from_public_settlement(client, monkeypatch):
    monkeypatch.setattr(
        forge_routes,
        "_list_models_for_search",
        lambda limit=50: [
            {"id": "yield_forecast", "name": "yield_forecast", "ready": True},
        ],
    )

    async def fake_list_proofs_for_search(limit=5000):
        return [
            {
                "id": "0xproof_activity",
                "lane": "noir_v2",
                "binding_profile": "full",
                "model_name": "yield_forecast",
                "latest_activity_timestamp": "2026-03-22T07:00:00Z",
                "latest_public_tx_hash": None,
                "latest_public_timestamp": None,
                "settlement_graph": {
                    "nodes": [{"type": "proof_job", "id": "0xproof_activity"}],
                    "edges": [],
                },
            },
            {
                "id": "0xproof_public",
                "lane": "modelbridge",
                "binding_profile": "full",
                "model_name": "yield_forecast",
                "latest_activity_timestamp": "2026-03-22T06:00:00Z",
                "latest_public_tx_hash": "0xl2tx-model",
                "latest_public_timestamp": "2026-03-22T06:05:00Z",
                "settlement_graph": {
                    "nodes": [{"type": "transaction", "id": "0xl2tx-model"}],
                    "edges": [],
                },
            },
        ]

    monkeypatch.setattr(forge_routes, "_list_proofs_for_search", fake_list_proofs_for_search)

    r = client.get(BASE + "/models")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    row = r.json()["items"][0]
    assert row["latest_proof_hash"] == "0xproof_activity"
    assert row["latest_activity_timestamp"] == "2026-03-22T07:00:00Z"
    assert row["latest_public_proof_hash"] == "0xproof_public"
    assert row["latest_public_tx_hash"] == "0xl2tx-model"
    assert row["latest_public_timestamp"] == "2026-03-22T06:05:00Z"
    assert row["proof_count"] == 2
    assert row["public_proof_count"] == 1
    assert row["lane_counts"] == {"modelbridge": 1, "noir_v2": 1}
    assert row["settlement_graph"]["nodes"][0]["type"] == "transaction"


def test_forge_model_rows_public_only_filters_without_public_receipts(client, monkeypatch):
    monkeypatch.setattr(
        forge_routes,
        "_list_models_for_search",
        lambda limit=50: [
            {"id": "anomaly_detector", "name": "anomaly_detector", "ready": True},
            {"id": "yield_forecast", "name": "yield_forecast", "ready": True},
        ],
    )

    async def fake_list_proofs_for_search(limit=5000):
        return [
            {
                "id": "0xproof_public",
                "lane": "modelbridge",
                "binding_profile": "full",
                "model_name": "yield_forecast",
                "latest_activity_timestamp": "2026-03-22T06:00:00Z",
                "latest_public_tx_hash": "0xl2tx-model",
                "latest_public_timestamp": "2026-03-22T06:05:00Z",
                "settlement_graph": {
                    "nodes": [{"type": "transaction", "id": "0xl2tx-model"}],
                    "edges": [],
                },
            },
            {
                "id": "0xproof_internal",
                "lane": "noir_v2",
                "binding_profile": "full",
                "model_name": "anomaly_detector",
                "latest_activity_timestamp": "2026-03-22T07:00:00Z",
                "latest_public_tx_hash": None,
                "latest_public_timestamp": None,
                "settlement_graph": {
                    "nodes": [{"type": "proof_job", "id": "0xproof_internal"}],
                    "edges": [],
                },
            },
        ]

    monkeypatch.setattr(forge_routes, "_list_proofs_for_search", fake_list_proofs_for_search)

    r = client.get(BASE + "/models", params={"public_only": "true"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    rows = r.json()["items"]
    assert len(rows) == 1
    assert rows[0]["id"] == "yield_forecast"


def test_forge_search_scope_facts_includes_settlement_graph(client, monkeypatch):
    async def fake_get_indexed_proof_items(**kwargs):
        return [
            {
                "id": "0xproof_fact",
                "lane": "modelbridge",
                "model_name": "yield_forecast",
                "fact_hash": "0xfact_search",
                "latest_public_tx_hash": "0xl2tx-fact",
                "settlement_graph": {
                    "nodes": [{"type": "fact", "id": "0xfact_search"}],
                    "edges": [],
                },
            }
        ]

    monkeypatch.setattr(forge_routes, "_get_indexed_proof_items", fake_get_indexed_proof_items)

    r = client.get(BASE + "/search", params={"scope": "facts", "public_only": "true"})
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["results"]["facts"][0]["fact_hash"] == "0xfact_search"
    assert payload["results"]["facts"][0]["settlement_graph"]["nodes"][0]["type"] == "fact"


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


def test_forge_detail_proof_job_includes_settlement_graph(client, monkeypatch):
    async def fake_get_proof_record(proof_hash: str):
        assert proof_hash == "0xproof_graph"
        return {
            "proof_hash": "0xproof_graph",
            "source": "proof_registry",
            "model_name": "yield_forecast",
            "proof_type": "noir_honk",
            "bridge_statement": {
                "lane": "noir_v2",
                "proof_type": "noir_honk",
                "model_name": "yield_forecast",
                "fact_hash": "0xfact_graph",
            },
            "public_receipts": [
                {
                    "tx_hash": "0xl2tx-graph",
                    "public_chain": "starknet_l2",
                    "timestamp": "2026-03-22T07:15:00Z",
                }
            ],
            "public_receipt_summary": {
                "count": 1,
                "latest_tx_hash": "0xl2tx-graph",
                "latest_timestamp": "2026-03-22T07:15:00Z",
            },
        }

    monkeypatch.setattr(forge_routes, "_get_proof_record", fake_get_proof_record)

    r = client.get(BASE + "/detail/proof_job/0xproof_graph")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["summary"]["status"] == "public_settled"
    assert payload["settlement_graph"]["nodes"][1]["type"] == "fact"
    assert payload["settlement_graph"]["edges"][2]["verb"] == "settles_with"


def test_forge_graph_endpoint_returns_compact_neighborhood(client, monkeypatch):
    async def fake_graph_neighborhood_for_object(obj_type: str, obj_id: str, **kwargs):
        assert obj_type == "proof_job"
        assert obj_id == "0xproof_graph"
        return {
            "center": {"type": "proof_job", "id": "0xproof_graph"},
            "nodes": [{"type": "proof_job", "id": "0xproof_graph"}],
            "edges": [],
        }

    monkeypatch.setattr(forge_routes, "_graph_neighborhood_for_object", fake_graph_neighborhood_for_object)

    r = client.get(BASE + "/graph/proof_job/0xproof_graph")
    if r.status_code == 404:
        pytest.skip("forge router not mounted")
    assert r.status_code == 200
    payload = r.json()
    assert payload["graph"]["center"]["type"] == "proof_job"
    assert payload["graph"]["nodes"][0]["id"] == "0xproof_graph"
