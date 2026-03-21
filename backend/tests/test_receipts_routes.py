from __future__ import annotations

import pytest

import app.api.routes.receipts as receipt_routes


@pytest.mark.asyncio
async def test_on_chain_receipts_merge_tx_backed_decision_events(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return [
                {
                    "tx_hash": None,
                    "fact_hash": "0xreceiptfact",
                    "proof_type": "receipt_only",
                    "result": "ok",
                    "timestamp": "2026-03-21T00:00:00Z",
                    "user": address,
                }
            ]

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return [
                {
                    "event_type": "proof_generated",
                    "gate": "ml_inference",
                    "outcome": "success",
                    "proof_mode": "EZKL_BRIDGE",
                    "verification_mode": "groth16_garaga",
                    "verified_on_chain": True,
                    "l3_tx_hash": "0xl3",
                    "l2_tx_hash": "0xl2",
                    "metadata": {
                        "proof_type": "credit_eligibility",
                        "proof_hash": "0xfact",
                    },
                    "created_at": "2026-03-21T01:02:03Z",
                }
            ]

    monkeypatch.setattr(receipt_routes, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(receipt_routes, "get_decision_store", lambda: FakeDecisionStore())

    payload = await receipt_routes.get_on_chain_receipts("0xabc")

    assert payload["count"] == 3
    tx_rows = [row for row in payload["receipts"] if row.get("tx_hash")]
    assert len(tx_rows) == 2
    assert {row["tx_hash"] for row in tx_rows} == {"0xl3", "0xl2"}
    assert all(row["proof_type"] == "credit_eligibility" for row in tx_rows)
    assert {row["meta"]["tx_source"] for row in tx_rows} == {"l3", "l2"}
    assert all(row["fact_hash"] == "0xfact" for row in tx_rows)


@pytest.mark.asyncio
async def test_list_receipts_merges_decision_events_and_backfills_fact_hash(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return [
                {
                    "receipt_id": "0xreceipt",
                    "timestamp": "2026-03-21T00:00:00Z",
                    "action_type": "deposit",
                    "adapter": "ekubo",
                    "amount": 123,
                    "user": address,
                    "tx_hash": None,
                    "proof_hash": None,
                    "fact_hash": None,
                }
            ]

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return [
                {
                    "id": 77,
                    "event_type": "proof_generated",
                    "gate": "ml_inference",
                    "outcome": "success",
                    "proof_mode": "EZKL_BRIDGE",
                    "verification_mode": "native_kzg",
                    "verified_on_chain": True,
                    "l3_tx_hash": "0xl3only",
                    "l2_tx_hash": None,
                    "metadata": {
                        "proof_type": "ml_bridge",
                        "proof_hash": "0xbridgefact",
                    },
                    "created_at": "2026-03-21T01:02:03Z",
                }
            ]

    monkeypatch.setattr(receipt_routes, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(receipt_routes, "get_decision_store", lambda: FakeDecisionStore())

    payload = await receipt_routes.list_receipts(address="0xabc", type=None, adapter=None)

    assert len(payload) == 2
    merged = next(row for row in payload if row.get("source") == "decision_store")
    assert merged["id"] == "decision:77:l3"
    assert merged["tx_hash"] == "0xl3only"
    assert merged["proof_hash"] == "0xbridgefact"
    assert merged["fact_hash"] == "0xbridgefact"
    assert merged["proof_type"] == "ml_bridge"
    assert merged["adapter"] == "ml_inference"
