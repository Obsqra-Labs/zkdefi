from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes.zkgraph as zkgraph_routes

client = TestClient(app)


def _fake_report() -> dict:
    return {
        "prompt": "test prompt",
        "zkrag_queries": [
            {"query": "q1", "available": True, "results": 2, "fact_hash": "0xfact1"},
            {"query": "q2", "available": True, "results": 1, "fact_hash": None},
        ],
        "circuits": {
            "live_scan": {
                "all_pass": True,
                "summary": {
                    "compliant": 2,
                    "non_compliant": 0,
                    "failed": 0,
                    "skipped": 0,
                },
            },
        },
        "market_context": {"source": "zkrag"},
        "confidence": 0.91,
        "synthesis": {"model": "gpt-4o-mini"},
        "pool_id": "ekubo_eth_usdc",
    }


def test_agent_query_appends_receipt_when_user_address_present(monkeypatch):
    class FakeClient:
        async def query_agent_report(self, *args, **kwargs):
            return _fake_report()

    class FakeZkGraphClient:
        @staticmethod
        def get_instance():
            return FakeClient()

    class FakeReceiptService:
        def __init__(self):
            self.calls = []

        def append_proof_receipt(self, **kwargs):
            self.calls.append(kwargs)
            return {"receipt_id": "0xreceipt", "proof_type": kwargs.get("proof_type")}

    fake_receipts = FakeReceiptService()

    monkeypatch.setattr(zkgraph_routes, "ZkGraphClient", FakeZkGraphClient)
    monkeypatch.setattr(zkgraph_routes, "get_receipt_service", lambda: fake_receipts)

    response = client.post(
        "/api/v1/zkdefi/zkgraph/agent/query",
        json={
            "prompt": "run report",
            "user_address": "0xabc123",
            "run_live_circuits": True,
            "llm_synthesis": False,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("receipt", {}).get("receipt_id") == "0xreceipt"
    assert len(fake_receipts.calls) == 1
    assert fake_receipts.calls[0]["proof_type"] == "zkrag_agent_report"
    assert fake_receipts.calls[0]["user_address"] == "0xabc123"
    assert fake_receipts.calls[0]["fact_hash"] == "0xfact1"


def test_agent_query_skips_receipt_without_user_address(monkeypatch):
    class FakeClient:
        async def query_agent_report(self, *args, **kwargs):
            return _fake_report()

    class FakeZkGraphClient:
        @staticmethod
        def get_instance():
            return FakeClient()

    class FakeReceiptService:
        def append_proof_receipt(self, **kwargs):
            raise AssertionError("append_proof_receipt should not be called")

    monkeypatch.setattr(zkgraph_routes, "ZkGraphClient", FakeZkGraphClient)
    monkeypatch.setattr(zkgraph_routes, "get_receipt_service", lambda: FakeReceiptService())

    response = client.post(
        "/api/v1/zkdefi/zkgraph/agent/query",
        json={
            "prompt": "run report",
            "run_live_circuits": False,
            "llm_synthesis": False,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("receipt") is None
