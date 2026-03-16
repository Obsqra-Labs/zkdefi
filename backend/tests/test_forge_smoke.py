"""Smoke tests for forge explorer."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
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